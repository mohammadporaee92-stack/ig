/**
 * Message Renderer — جایگزینی Dynamic Variables در قالب پیام.
 *
 * متغیرهای پشتیبانی‌شده:
 *   {{username}}    نام کاربری کامنت‌گذار
 *   {{first_name}}  نام کوچک (از فیلد name رسمی، اگر در دسترس باشد)
 *   {{comment}}     متن کامنت
 *   {{keyword}}     کلیدواژهٔ تطبیق‌یافته
 *   {{link}}        لینک اصلی تعریف‌شده در Automation
 *   {{account}}     نام کاربری حساب Professional
 *
 * متغیر ناشناخته با رشتهٔ خالی جایگزین می‌شود (هرگز `undefined` در پیام).
 */

export interface RenderContext {
  username?: string | null;
  firstName?: string | null;
  name?: string | null;
  comment?: string | null;
  keyword?: string | null;
  link?: string | null;
  account?: string | null;
  [key: string]: string | null | undefined;
}

export const SUPPORTED_VARIABLES = [
  'username',
  'first_name',
  'comment',
  'keyword',
  'link',
  'account',
] as const;

/** حداکثر طول متن پیام طبق مستندات رسمی: ۱۰۰۰ بایت UTF-8 */
export const MAX_MESSAGE_BYTES = 1000;

function firstNameOf(ctx: RenderContext): string {
  if (ctx.firstName) return ctx.firstName;
  const n = (ctx.name ?? '').trim();
  if (n) return n.split(/\s+/)[0] ?? '';
  return ctx.username ?? '';
}

export function renderTemplate(template: string, ctx: RenderContext): string {
  if (!template) return '';
  const values: Record<string, string> = {
    username: ctx.username ?? '',
    first_name: firstNameOf(ctx),
    comment: ctx.comment ?? '',
    keyword: ctx.keyword ?? '',
    link: ctx.link ?? '',
    account: ctx.account ?? '',
  };
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === 'string' && !(k in values)) values[k] = v;
  }
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) => values[name] ?? '');
}

/** برش امن بر اساس بایت (نه کاراکتر) تا محدودیت ۱۰۰۰ بایت نقض نشود */
export function truncateToBytes(text: string, maxBytes = MAX_MESSAGE_BYTES): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  // برش روی مرز کاراکتر معتبر
  let end = maxBytes - 1;
  while (end > 0 && ((buf[end] as number) & 0xc0) === 0x80) end--;
  const sliced = buf.subarray(0, end).toString('utf8');
  return `${sliced.replace(/\uFFFD$/, '')}…`;
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** استخراج متغیرهای استفاده‌شده — برای هشدار در UI */
export function extractVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}
