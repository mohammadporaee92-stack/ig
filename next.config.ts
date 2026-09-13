import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // اپ ممکن است از دامنه‌ای غیر از localhost سرو شود:
  //   • محیط پیش‌نمایش:  3000-<id>.e2b.app
  //   • تونل توسعه (برای OAuth و webhook اینستاگرام): ngrok / cloudflare / …
  // بدون این تنظیم، Next.js درخواست‌های /_next/* را cross-origin تشخیص می‌دهد و هشدار می‌دهد.
  allowedDevOrigins: [
    '*.e2b.app',
    '*.ngrok-free.app',
    '*.ngrok-free.dev',
    '*.ngrok.io',
    '*.ngrok.app',
    '*.trycloudflare.com',
    '*.loca.lt',
    '*.lhr.life',
    ...(process.env.TUNNEL_HOST ? [process.env.TUNNEL_HOST] : []),
  ],
  // PGlite و درایورهای native نباید در باندل سرور bundle شوند
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'bullmq', 'ioredis'],
  async headers() {
    // وقتی داشبورد عمداً داخل iframe میزبان دیگری نمایش داده می‌شود (محیط پیش‌نمایش)،
    // هدر X-Frame-Options: SAMEORIGIN خودِ نمایش را مسدود می‌کند و باید حذف شود.
    const embedded = process.env.AUTH_COOKIE_CROSS_SITE === 'true';
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          ...(embedded ? [] : [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }]),
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
