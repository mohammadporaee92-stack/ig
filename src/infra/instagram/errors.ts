/** طبقه‌بندی خطاهای Graph API برای تصمیم‌گیری retry / gate */
export type IgErrorKind =
  | 'rate_limit'
  | 'token_invalid'
  | 'permission'
  | 'consent_required'
  | 'outside_window'
  | 'already_replied'
  | 'not_found'
  | 'transient'
  | 'validation'
  | 'unknown';

export interface IgErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

export class InstagramApiError extends Error {
  readonly kind: IgErrorKind;
  readonly httpStatus: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly retryAfterMs?: number;
  readonly fbtraceId?: string;

  constructor(opts: {
    message: string;
    kind: IgErrorKind;
    httpStatus: number;
    code?: number;
    subcode?: number;
    retryAfterMs?: number;
    fbtraceId?: string;
  }) {
    super(opts.message);
    this.name = 'InstagramApiError';
    this.kind = opts.kind;
    this.httpStatus = opts.httpStatus;
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.retryAfterMs = opts.retryAfterMs;
    this.fbtraceId = opts.fbtraceId;
  }

  /** آیا ارزش retry دارد؟ */
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'transient';
  }
}

export function classifyIgError(httpStatus: number, body: IgErrorBody): IgErrorKind {
  const code = body.error?.code;
  const sub = body.error?.error_subcode;
  const msg = (body.error?.message ?? '').toLowerCase();

  // consent — مستند رسمی User Profile API
  if (msg.includes('user consent is required')) return 'consent_required';
  // rate limits (کدهای رسمی متا)
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80007) return 'rate_limit';
  if (httpStatus === 429) return 'rate_limit';
  // توکن
  if (code === 190 || httpStatus === 401) return 'token_invalid';
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code <= 299)) return 'permission';
  // پنجرهٔ پیام‌رسانی ۲۴ ساعته / محدودیت private reply
  if (code === 551 || sub === 2534022 || msg.includes('outside of allowed window') || msg.includes('24 hour'))
    return 'outside_window';
  if (msg.includes('already') && msg.includes('repl')) return 'already_replied';
  if (httpStatus === 404 || code === 803) return 'not_found';
  if (httpStatus >= 500) return 'transient';
  if (code === 1 || code === 2) return 'transient';
  if (httpStatus === 400) return 'validation';
  return 'unknown';
}
