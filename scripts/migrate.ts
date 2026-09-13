/**
 * Migrate — اعمال schema.sql روی دیتابیس هدف.
 *   npm run db:migrate
 *
 * ایدمپوتنت است: همهٔ DDLها به‌صورت IF NOT EXISTS نوشته شده‌اند،
 * و اجرای هر فایل در جدول schema_migrations ثبت می‌شود.
 */
import { getDb } from '~/infra/db/client';
import { env } from '~/lib/env';
import { createLogger } from '~/lib/logger';

const log = createLogger('migrate');

async function main(): Promise<void> {
  const db = await getDb(); // getDb خودش migrate را اجرا می‌کند
  const res = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  log.info('مهاجرت کامل شد', {
    driver: db.driver,
    target: env().DATABASE_URL ? 'PostgreSQL' : `PGlite (${env().PGLITE_DIR})`,
    tables: res.rows.length,
  });
  // eslint-disable-next-line no-console
  console.log(`\n  ✅ ${res.rows.length} جدول آماده است:\n${res.rows.map((r) => `     - ${r.table_name}`).join('\n')}\n`);
  await db.close();
}

void main().catch((e: Error) => {
  log.error('مهاجرت ناموفق بود', { error: e.message });
  process.exitCode = 1;
});
