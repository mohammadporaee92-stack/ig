import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getContainer, type Container } from '~/server/container';
import { getCurrentUser, type SessionClaims } from '~/server/auth';
import { createLogger } from '~/lib/logger';

const log = createLogger('api');

export interface ApiContext {
  user: SessionClaims;
  container: Container;
  request: Request;
}

export function json(data: unknown, status = 200): Response {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * هر route محافظت‌شده از اینجا رد می‌شود:
 *  - احراز هویت اجباری
 *  - بررسی CSRF برای mutationها (هدر x-requested-with + SameSite کوکی)
 *  - مدیریت خطای یکنواخت بدون افشای جزئیات داخلی
 */
export function withAuth(
  handler: (ctx: ApiContext) => Promise<Response>,
  opts: { mutation?: boolean } = {},
) {
  return async (request: Request): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) return error('احراز هویت لازم است', 401);

      if (opts.mutation) {
        // دفاع سادهٔ CSRF: درخواست باید از fetch خودِ اپ بیاید
        const xrw = request.headers.get('x-requested-with');
        if (xrw !== 'igflow') return error('درخواست نامعتبر (CSRF)', 403);
      }

      const container = await getContainer();
      return await handler({ user, container, request });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return error('ورودی نامعتبر است', 422, { issues: e.issues.map((i) => ({ path: i.path, message: i.message })) });
      }
      log.error('خطای پردازش‌نشده در API', { error: (e as Error).message });
      // هرگز stack trace یا جزئیات داخلی به کلاینت نمی‌دهیم
      return error('خطای داخلی سرور', 500);
    }
  };
}

export async function readJson<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  const body: unknown = await request.json().catch(() => ({}));
  return schema.parse(body) as z.infer<S>;
}
