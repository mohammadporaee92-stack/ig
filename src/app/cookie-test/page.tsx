import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { env } from '~/lib/env';

export const dynamic = 'force-dynamic';

const LABELS: Record<string, string> = {
  ct_a: 'SameSite=None; Secure; HttpOnly; Partitioned',
  ct_b: 'SameSite=None; Secure; HttpOnly',
  ct_c: 'SameSite=Lax; Secure; HttpOnly',
  ct_d: 'SameSite=None; Secure; Partitioned (بدون HttpOnly)',
};

export default async function CookieTestPage() {
  // ابزار تشخیصی — نباید در production در دسترس باشد
  if (env().isProd) notFound();

  const jar = await cookies();
  const present = new Set(jar.getAll().map((c) => c.name));
  const anyWorks = Object.keys(LABELS).some((k) => present.has(k));

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, direction: 'rtl', lineHeight: 2 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>تشخیص کوکی مرورگر</h1>
      <p style={{ color: '#475569' }}>
        نتیجه نشان می‌دهد مرورگر شما کدام نوع کوکی را در این قاب می‌پذیرد.
      </p>

      <table style={{ borderCollapse: 'collapse', marginTop: 16, minWidth: 420 }}>
        <tbody>
          {Object.entries(LABELS).map(([name, label]) => {
            const ok = present.has(name);
            return (
              <tr key={name}>
                <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px', fontFamily: 'monospace' }}>{name}</td>
                <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}>{label}</td>
                <td
                  style={{
                    border: '1px solid #e2e8f0',
                    padding: '8px 12px',
                    fontWeight: 700,
                    color: ok ? '#059669' : '#dc2626',
                  }}
                >
                  {ok ? '✅ ذخیره شد' : '❌ مسدود شد'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p style={{ marginTop: 20, padding: 12, background: anyWorks ? '#ecfdf5' : '#fef2f2', borderRadius: 8 }}>
        {anyWorks
          ? 'حداقل یک نوع کوکی کار می‌کند — احراز هویت با همان تنظیم قابل انجام است.'
          : 'هیچ کوکی‌ای ذخیره نشد. مرورگر تمام کوکی‌های شخص‌ثالث را در این قاب مسدود می‌کند؛ باید از روش بدون کوکی استفاده شود.'}
      </p>

      <p style={{ marginTop: 12 }}>
        کوکی‌های دریافتی: <code>{JSON.stringify(jar.getAll().map((c) => c.name))}</code>
      </p>
    </main>
  );
}
