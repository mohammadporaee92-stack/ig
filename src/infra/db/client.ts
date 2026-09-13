import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '~/lib/env';
import { createPgliteDriver } from './drivers/pglite-driver';

/**
 * لایهٔ دسترسی به دیتابیس.
 *
 * - اگر DATABASE_URL ست باشد → PostgreSQL واقعی (درایور `pg`).
 * - در غیر این صورت → PGlite (همان Postgres، کامپایل‌شده به WASM) تا پروژه
 *   بدون نصب سرور دیتابیس هم واقعاً اجرا و تست شود. SQL دقیقاً یکسان است.
 *
 * تمام کوئری‌ها parameterized هستند (هیچ string concat → بدون SQL Injection).
 */

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: 'pg' | 'pglite';
}

/**
 * ⚠️ Singleton روی globalThis نگه‌داشته می‌شود.
 * در Next.js هر route segment ماژول‌ها را در باندل جداگانه‌ای ارزیابی می‌کند و
 * hot-reload هم ماژول‌ها را دوباره اجرا می‌کند؛ بدون این کار، برای هر مسیر یک
 * نمونهٔ جدید PGlite/Pool ساخته می‌شود و حافظه و اتصال‌ها نشت می‌کنند.
 */
interface DbGlobal {
  __igflowDb?: Db | null;
  __igflowDbInit?: Promise<Db> | null;
}
const g = globalThis as unknown as DbGlobal;

async function createPgLite(dir?: string): Promise<Db> {
  const raw = await createPgliteDriver(dir);
  const db: Db = {
    driver: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await raw.query(sql, params);
      const rows = res.rows as T[];
      return { rows, rowCount: rows.length };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return raw.transaction(async (tx) => {
        const txDb: Db = {
          driver: 'pglite',
          async query<U>(sql: string, params: unknown[] = []) {
            const r = await tx.query(sql, params);
            const rows = r.rows as U[];
            return { rows, rowCount: rows.length };
          },
          transaction: (f) => f(txDb),
          close: async () => undefined,
        };
        return fn(txDb);
      });
    },
    close: () => raw.close(),
  };
  return db;
}

async function createPg(url: string): Promise<Db> {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool ?? (pgMod as unknown as { Pool: typeof import('pg').Pool }).Pool;
  // در محیط سرورلس هر instance جدا یک Pool می‌سازد. با max=10 و چند instance
  // هم‌زمان، سقف اتصال‌های Postgres (روی Supabase رایگان: ۶۰) خیلی زود پر
  // می‌شود و خطای «remaining connection slots reserved» می‌گیریم.
  // راه‌حل: روی سرورلس فقط ۱ اتصال + استفاده از Connection Pooler سمت سرور.
  const pool = new Pool({
    connectionString: url,
    max: env().serverless ? 1 : 10,
    idleTimeoutMillis: env().serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    ...(url.includes('sslmode=require') || url.includes('supabase.')
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });

  const fromClient = (client: { query: (s: string, p?: unknown[]) => Promise<unknown> }): Db => ({
    driver: 'pg',
    async query<T>(sql: string, params: unknown[] = []) {
      const res = (await client.query(sql, params)) as { rows: T[]; rowCount: number | null };
      return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      // تراکنش تودرتو: در همان client ادامه می‌دهیم
      return fn(fromClient(client));
    },
    async close() {
      /* client متعلق به pool است */
    },
  });

  return {
    driver: 'pg',
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params as never[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(fromClient(client as never));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function getDb(): Promise<Db> {
  if (g.__igflowDb) return g.__igflowDb;
  if (g.__igflowDbInit) return g.__igflowDbInit;

  g.__igflowDbInit = (async () => {
    const url = env().DATABASE_URL;
    const db = url ? await createPg(url) : await createPgLite(env().isTest ? undefined : env().PGLITE_DIR);
    await migrate(db);
    g.__igflowDb = db;
    return db;
  })();

  return g.__igflowDbInit;
}

function schemaPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, 'schema.sql');
  } catch {
    return join(process.cwd(), 'src/infra/db/schema.sql');
  }
}

/** خواندن schema.sql در همهٔ محیط‌ها (dev/worker/test) */
function readSchema(): string {
  const candidates = [schemaPath(), join(process.cwd(), 'src/infra/db/schema.sql')];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* next */
    }
  }
  throw new Error('schema.sql پیدا نشد');
}

export async function migrate(db: Db): Promise<void> {
  const sql = readSchema();
  // حذف کامنت‌های خطی، سپس split روی ';'
  const stripped = sql
    .split('\n')
    .map((line) => (line.trim().startsWith('--') ? '' : line))
    .join('\n');

  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await db.query(stmt);
  }
  await db.query(
    `INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
    ['0001_init'],
  );
}

/** فقط برای تست‌ها: نمونهٔ مستقل و درون‌حافظه‌ای */
export async function createTestDb(): Promise<Db> {
  const db = await createPgLite();
  await migrate(db);
  return db;
}

export function __setDbForTests(db: Db | null): void {
  g.__igflowDb = db;
  g.__igflowDbInit = null;
}
