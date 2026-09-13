/**
 * ساخت یک بستهٔ تمیز برای تحویل/دانلود.
 *
 * چرا لازم است: کپی‌کردن پوشهٔ پروژه، فایل `.gitignore` را نادیده می‌گیرد و
 * مواردی را با خود می‌برد که *نباید* منتقل شوند — مهم‌تر از همه:
 *
 *   • `.data/`      دیتابیس زندهٔ PGlite. روی ماشین مقصد باز نمی‌شود و
 *                   `RuntimeError: Aborted()` می‌دهد (Postgres روی WASM
 *                   بازیابی WAL ندارد؛ datadirِ بسته‌نشده = خراب).
 *   • `.env.local`  کلیدهای رمزنگاری و تنظیمات مخصوص همین ماشین.
 *   • `node_modules` باینری‌های کامپایل‌شده برای سیستم‌عامل مبدأ.
 *
 * خروجی: igflow.zip در ریشهٔ پروژه.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'igflow.zip');

const EXCLUDE = [
  'node_modules/*',
  '.next/*',
  '.data/*',
  '.data.corrupt-*/*',
  '.git/*',
  '.env.local',
  '*.tsbuildinfo',
  '*.log',
  'igflow.zip',
];

rmSync(OUT, { force: true });

const args = ['-r', '-q', OUT, '.', '-x', ...EXCLUDE];

try {
  execFileSync('zip', args, { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.error(
    '\n  ✗ دستور zip در دسترس نیست.\n' +
      '    Linux/macOS:  sudo apt install zip   |   brew install zip\n' +
      '    ویندوز: پوشه را دستی فشرده کنید و قبلش .data و .env.local و node_modules را حذف کنید.\n',
  );
  process.exit(1);
}

const mb = (statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`\n  ✓ بستهٔ تمیز ساخته شد: igflow.zip (${mb} MB)`);

for (const leak of ['.data', '.env.local', 'node_modules']) {
  const listed = execFileSync('unzip', ['-Z1', OUT], { encoding: 'utf8' })
    .split('\n')
    .some((l) => l === leak || l.startsWith(`${leak}/`));
  console.log(`    ${listed ? '✗ نشتی!' : '✓ حذف شد'}  ${leak}`);
  if (listed) process.exitCode = 1;
}

if (existsSync(join(ROOT, '.data'))) {
  console.log('\n  ℹ دیتابیس محلی شما دست‌نخورده باقی ماند (فقط از بسته حذف شد).');
}
console.log('\n  گیرندهٔ بسته باید اجرا کند:  npm install  →  npm run setup  →  npm run dev\n');
