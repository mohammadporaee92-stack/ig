import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IGFlow — اتوماسیون اینستاگرام',
  description:
    'کامنت اینستاگرام → تشخیص کلیدواژه → دایرکت خصوصی → بررسی فالو → ارسال محتوای اصلی. ساخته‌شده فقط با APIهای رسمی Instagram.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
