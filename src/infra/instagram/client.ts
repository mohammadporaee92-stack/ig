import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';
import { classifyIgError, InstagramApiError, type IgErrorBody } from './errors';

const log = createLogger('ig-client');

/* ─────────────────────── Types ─────────────────────── */

export interface IgProfile {
  id: string;
  username: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count?: number;
  media_count?: number;
}

export interface IgUserProfile {
  id?: string;
  name?: string;
  username?: string;
  profile_pic?: string;
  follower_count?: number;
  is_verified_user?: boolean;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
}

export interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  media?: { id?: string };
  from?: { id?: string; username?: string };
  parent_id?: string;
}

export interface QuickReply {
  content_type: 'text' | 'user_phone_number' | 'user_email';
  title: string;
  payload: string;
}

export type Attachment =
  | { type: 'image' | 'video' | 'audio' | 'file'; payload: { url: string } }
  | { type: 'image' | 'video' | 'audio' | 'file'; payload: { attachment_id: string } };

export interface SendMessageResult {
  recipient_id?: string;
  message_id?: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  userId: string;
  permissions: string[];
}

export interface LongLivedTokenResult {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
}

/* ─────────────────── HTTP wrapper ─────────────────── */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  accessToken?: string;
  /** برای OAuth endpointها که روی api.instagram.com هستند */
  absoluteUrl?: string;
  form?: Record<string, string>;
  timeoutMs?: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class InstagramClient {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private base(): string {
    const e = env();
    return `${e.IG_GRAPH_HOST.replace(/\/$/, '')}/${e.IG_GRAPH_VERSION}`;
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const url = new URL(opts.absoluteUrl ?? `${this.base()}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {};
    if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

    let body: BodyInit | undefined;
    if (opts.form) {
      const fd = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.form)) fd.set(k, v);
      body = fd;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers, body, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new InstagramApiError({
        message: `خطای شبکه در تماس با Instagram API: ${(e as Error).message}`,
        kind: 'transient',
        httpStatus: 0,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const errBody = json as IgErrorBody;
      const kind = classifyIgError(res.status, errBody);
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      // ⚠️ هرگز access token را لاگ نمی‌کنیم — logger هم redaction دارد
      log.warn('پاسخ خطا از Instagram API', {
        path,
        status: res.status,
        kind,
        code: errBody.error?.code,
        subcode: errBody.error?.error_subcode,
        message: errBody.error?.message,
      });
      throw new InstagramApiError({
        message: errBody.error?.message ?? `Instagram API خطا داد (HTTP ${res.status})`,
        kind,
        httpStatus: res.status,
        code: errBody.error?.code,
        subcode: errBody.error?.error_subcode,
        retryAfterMs,
        fbtraceId: errBody.error?.fbtrace_id,
      });
    }

    return json as T;
  }

  /* ══════════════ OAuth — Business Login for Instagram ══════════════ */

  /**
   * ساخت URL مرحلهٔ Authorization.
   * مستند: /instagram-platform/instagram-api-with-instagram-login/business-login
   */
  buildAuthorizeUrl(state: string, opts?: { forceReauth?: boolean; enableFbLogin?: boolean }): string {
    const e = env();
    const url = new URL(e.IG_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', e.IG_APP_ID);
    url.searchParams.set('redirect_uri', e.IG_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', e.igScopes.join(','));
    url.searchParams.set('state', state);
    // کاربر نباید مجبور به استفاده از Facebook شود → گزینهٔ FB Login پنهان
    url.searchParams.set('enable_fb_login', opts?.enableFbLogin ? 'true' : 'false');
    if (opts?.forceReauth) url.searchParams.set('force_reauth', 'true');
    return url.toString();
  }

  /** مرحله ۲: code → short-lived token */
  async exchangeCodeForToken(code: string): Promise<TokenExchangeResult> {
    const e = env();
    const raw = await this.request<
      | { access_token: string; user_id: string | number; permissions?: string | string[] }
      | { data: Array<{ access_token: string; user_id: string | number; permissions?: string | string[] }> }
    >('', {
      method: 'POST',
      absoluteUrl: e.IG_OAUTH_TOKEN_URL,
      form: {
        client_id: e.IG_APP_ID,
        client_secret: e.IG_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: e.IG_REDIRECT_URI,
        code,
      },
    });

    // مستندات رسمی هر دو شکل (flat و data[]) را نشان داده‌اند؛ هر دو را پشتیبانی می‌کنیم.
    const node = 'data' in raw && Array.isArray(raw.data) ? raw.data[0] : (raw as { access_token: string; user_id: string | number; permissions?: string | string[] });
    if (!node?.access_token) {
      throw new InstagramApiError({
        message: 'پاسخ تبادل code فاقد access_token بود',
        kind: 'validation',
        httpStatus: 200,
      });
    }
    const perms = node.permissions;
    return {
      accessToken: node.access_token,
      userId: String(node.user_id),
      permissions: Array.isArray(perms) ? perms : (perms ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  }

  /** مرحله ۳: short-lived → long-lived (۶۰ روز) */
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedTokenResult> {
    const e = env();
    const res = await this.request<{ access_token: string; token_type?: string; expires_in: number }>(
      '/access_token',
      {
        method: 'GET',
        absoluteUrl: `${e.IG_GRAPH_HOST.replace(/\/$/, '')}/access_token`,
        query: {
          grant_type: 'ig_exchange_token',
          client_secret: e.IG_APP_SECRET,
          access_token: shortLivedToken,
        },
      },
    );
    return {
      accessToken: res.access_token,
      tokenType: res.token_type ?? 'bearer',
      expiresInSeconds: res.expires_in,
    };
  }

  /** تمدید long-lived token (حداقل ۲۴ ساعت عمر داشته باشد و منقضی نشده باشد) */
  async refreshLongLivedToken(longLivedToken: string): Promise<LongLivedTokenResult> {
    const e = env();
    const res = await this.request<{ access_token: string; token_type?: string; expires_in: number }>(
      '/refresh_access_token',
      {
        method: 'GET',
        absoluteUrl: `${e.IG_GRAPH_HOST.replace(/\/$/, '')}/refresh_access_token`,
        query: { grant_type: 'ig_refresh_token', access_token: longLivedToken },
      },
    );
    return {
      accessToken: res.access_token,
      tokenType: res.token_type ?? 'bearer',
      expiresInSeconds: res.expires_in,
    };
  }

  /* ══════════════════════ Account ══════════════════════ */

  async getMe(accessToken: string): Promise<IgProfile> {
    return this.request<IgProfile>('/me', {
      accessToken,
      query: {
        fields: 'id,username,name,account_type,profile_picture_url,followers_count,media_count',
      },
    });
  }

  async getMedia(accessToken: string, igId: string, limit = 25) {
    return this.request<{ data: Array<{ id: string; media_type?: string; permalink?: string; caption?: string; thumbnail_url?: string; media_url?: string; timestamp?: string }> }>(
      `/${igId}/media`,
      { accessToken, query: { fields: 'id,media_type,permalink,caption,thumbnail_url,media_url,timestamp', limit } },
    );
  }

  /** فعال‌سازی webhook برای حساب: POST /me/subscribed_apps?subscribed_fields=... */
  async subscribeWebhooks(accessToken: string, igId: string, fields: string[]): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/${igId}/subscribed_apps`, {
      method: 'POST',
      accessToken,
      query: { subscribed_fields: fields.join(',') },
    });
  }

  async unsubscribeWebhooks(accessToken: string, igId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/${igId}/subscribed_apps`, {
      method: 'DELETE',
      accessToken,
    });
  }

  /* ══════════════════════ Comments ══════════════════════ */

  async getComment(accessToken: string, commentId: string): Promise<IgComment> {
    return this.request<IgComment>(`/${commentId}`, {
      accessToken,
      query: { fields: 'id,text,username,timestamp,parent_id,from{id,username},media{id}' },
    });
  }

  /** پاسخ عمومی زیر کامنت: POST /<IG_COMMENT_ID>/replies */
  async replyToComment(accessToken: string, commentId: string, message: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/${commentId}/replies`, {
      method: 'POST',
      accessToken,
      body: { message },
    });
  }

  async hideComment(accessToken: string, commentId: string, hide: boolean): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/${commentId}`, {
      method: 'POST',
      accessToken,
      query: { hide },
    });
  }

  /* ══════════════════════ Messaging ══════════════════════ */

  /**
   * Private Reply به کامنت.
   * POST /<IG_ID>/messages  { recipient: { comment_id }, message: { text } }
   * محدودیت رسمی: فقط ۱ پیام به ازای هر کامنت، تا ۷ روز.
   */
  async sendPrivateReply(
    accessToken: string,
    igId: string,
    commentId: string,
    message: { text?: string; quick_replies?: QuickReply[] },
  ): Promise<SendMessageResult> {
    return this.request<SendMessageResult>(`/${igId}/messages`, {
      method: 'POST',
      accessToken,
      body: { recipient: { comment_id: commentId }, message },
    });
  }

  /**
   * پیام مستقیم داخل پنجرهٔ ۲۴ ساعته.
   * POST /<IG_ID>/messages  { recipient: { id: IGSID }, message: {...} }
   */
  async sendMessage(
    accessToken: string,
    igId: string,
    igsid: string,
    message: {
      text?: string;
      quick_replies?: QuickReply[];
      attachment?: Attachment;
      attachments?: Attachment[];
    },
  ): Promise<SendMessageResult> {
    return this.request<SendMessageResult>(`/${igId}/messages`, {
      method: 'POST',
      accessToken,
      body: { recipient: { id: igsid }, message },
    });
  }

  /**
   * ══════════════ Follow Check رسمی ══════════════
   * GET /<IGSID>?fields=is_user_follow_business,...
   * ⚠️ نیازمند USER CONSENT (کاربر باید پیام داده / دکمه زده باشد).
   * منبع: Instagram User Profile API (مستندات رسمی).
   */
  async getUserProfile(accessToken: string, igsid: string): Promise<IgUserProfile> {
    return this.request<IgUserProfile>(`/${igsid}`, {
      accessToken,
      query: {
        fields:
          'name,username,profile_pic,follower_count,is_verified_user,is_user_follow_business,is_business_follow_user',
      },
    });
  }
}

export const instagramClient = new InstagramClient();
