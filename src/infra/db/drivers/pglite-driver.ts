import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * درایور PGlite — Postgres کامپایل‌شده به WASM.
 * فقط برای development/test استفاده می‌شود تا پروژه بدون نصب سرور Postgres
 * قابل اجرا و تست باشد. در production `DATABASE_URL` ست می‌شود و درایور `pg` فعال است.
 */
export interface RawDriver {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  transaction<T>(fn: (tx: { query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * فایل‌های قفل که هنگام بسته‌شدن ناگهانی فرایند باقی می‌مانند.
 * اگر دیتابیس از سیستم دیگری کپی شده باشد هم همین‌ها باعث خطا می‌شوند.
 */
function clearStaleLocks(dir: string): void {
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.s.PGSQL') || name === 'postmaster.pid' || name === 'postmaster.opts') {
        rmSync(join(dir, name), { force: true, recursive: true });
      }
    }
  } catch {
    // اگر پوشه خوانده نشد، مرحلهٔ بعد خودش خطا می‌دهد
  }
}

async function open(dir?: string): Promise<PGlite> {
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return pg;
}

export async function createPgliteDriver(dir?: string): Promise<RawDriver> {
  if (dir) {
    // PGlite خودش مسیر تودرتو را نمی‌سازد
    mkdirSync(dir, { recursive: true });
    clearStaleLocks(dir);
  }

  let pg: PGlite;
  try {
    pg = await open(dir);
  } catch (err) {
    // PGlite (Postgres روی WASM) قابلیت بازیابی WAL ندارد. اگر datadir با kill
    // ناگهانی بسته شده باشد — یا از یک سیستم‌عامل دیگر کپی شده باشد — با
    // `RuntimeError: Aborted()` می‌میرد و تنها راه، بازسازی است.
    if (!dir || !existsSync(dir)) throw err;

    const backup = `${dir}.corrupt-${Date.now()}`;
    console.warn(
      `[pglite] دیتابیس محلی قابل باز شدن نبود و بازسازی شد.\n` +
        `         نسخهٔ معیوب برای بررسی اینجا نگه داشته شد: ${backup}\n` +
        `         برای بازگرداندن دادهٔ نمونه:  npm run db:seed`,
    );
    try {
      rmSync(backup, { recursive: true, force: true });
      const { renameSync } = await import('node:fs');
      renameSync(dir, backup);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(dir, { recursive: true });
    pg = await open(dir);
  }
  return {
    async query(sql, params) {
      const res = await pg.query(sql, params as never[]);
      return { rows: res.rows as unknown[] };
    },
    async transaction(fn) {
      return pg.transaction(async (tx) =>
        fn({
          async query(sql, params) {
            const res = await tx.query(sql, params as never[]);
            return { rows: res.rows as unknown[] };
          },
        }),
      ) as never;
    },
    async close() {
      await pg.close();
    },
  };
}
