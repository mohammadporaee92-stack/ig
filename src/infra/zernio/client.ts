import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

const log = createLogger('zernio-client');

export type ZernioFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ZernioAccount {
  id: string;
  profileId: string;
  platform: string;
  username: string;
  displayName?: string;
  profileUrl?: string;
  profilePictureUrl?: string;
  isActive: boolean;
}

export interface ZernioAccountHealth {
  accountId: string;
  platform: string;
  username: string;
  displayName?: string;
  status: string;
  tokenStatus?: {
    valid?: boolean;
    expiresAt?: string;
    expiresIn?: string;
    needsRefresh?: boolean;
  };
  permissions?: {
    canPost?: boolean;
    canFetchAnalytics?: boolean;
    missingRequired?: string[];
  };
  issues?: string[];
  recommendations?: string[];
}

export class ZernioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ZernioApiError';
  }
}

interface RawAccount {
  _id?: string;
  id?: string;
  platform?: string;
  username?: string;
  displayName?: string;
  profileUrl?: string;
  profilePictureUrl?: string;
  profileImageUrl?: string;
  isActive?: boolean;
  status?: string;
  profileId?: string | { _id?: string; id?: string };
}

function profileIdOf(value: RawAccount['profileId']): string {
  if (typeof value === 'string') return value;
  return value?._id ?? value?.id ?? '';
}

/**
 * REST client کوچک و server-only برای Zernio.
 * API key هیچ‌وقت به مرورگر، پاسخ API یا logger فرستاده نمی‌شود.
 */
export class ZernioClient {
  constructor(private readonly fetchImpl: ZernioFetch = (input, init) => fetch(input, init)) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const e = env();
    if (!e.ZERNIO_API_KEY) {
      throw new ZernioApiError('ZERNIO_API_KEY تنظیم نشده است', 503, 'not_configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set('accept', 'application/json');
      headers.set('authorization', `Bearer ${e.ZERNIO_API_KEY}`);
      response = await this.fetchImpl(`${e.ZERNIO_BASE_URL.replace(/\/$/, '')}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } catch (error) {
      throw new ZernioApiError(`ارتباط با Zernio برقرار نشد: ${(error as Error).message}`, 0, 'network_error');
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = { raw };
    }

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const message =
        (typeof body.error === 'string' && body.error) ||
        (typeof body.message === 'string' && body.message) ||
        `Zernio API خطا داد (HTTP ${response.status})`;
      const code = typeof body.code === 'string' ? body.code : undefined;
      log.warn('پاسخ خطا از Zernio', { path, status: response.status, code, message });
      throw new ZernioApiError(
        message,
        response.status,
        code,
        retryAfter ? Number(retryAfter) * 1000 : undefined,
      );
    }

    return body as T;
  }

  async listInstagramAccounts(): Promise<ZernioAccount[]> {
    const response = await this.request<{ accounts?: RawAccount[] }>('/accounts');
    return (response.accounts ?? [])
      .filter((account) => account.platform === 'instagram')
      .map((account) => ({
        id: account._id ?? account.id ?? '',
        profileId: profileIdOf(account.profileId),
        platform: 'instagram',
        username: account.username ?? '',
        displayName: account.displayName,
        profileUrl: account.profileUrl,
        profilePictureUrl: account.profilePictureUrl ?? account.profileImageUrl,
        isActive: account.isActive ?? account.status !== 'disconnected',
      }))
      .filter((account) => Boolean(account.id && account.username));
  }

  async getAccountHealth(accountId: string): Promise<ZernioAccountHealth> {
    return this.request<ZernioAccountHealth>(`/accounts/${encodeURIComponent(accountId)}/health`);
  }
}
