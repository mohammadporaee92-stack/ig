import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '~/server/auth';
import { getContainer } from '~/server/container';
import { LogoutButton, NavLink } from '~/components/shell';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/dashboard', label: 'داشبورد', icon: '📊' },
  { href: '/automations', label: 'اتوماسیون‌ها', icon: '⚡' },
  { href: '/analytics', label: 'تحلیل‌ها', icon: '📈' },
  { href: '/instagram', label: 'اینستاگرام', icon: '📸' },
  { href: '/settings', label: 'تنظیمات', icon: '⚙️' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { repos } = await getContainer();
  const account = await repos.accounts.getPrimary(user.sub);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-pink-500 text-sm font-bold text-white">
            IG
          </div>
          <span className="text-lg font-bold text-slate-900">IGFlow</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
          ))}
        </nav>

        <div className="border-t border-slate-100 p-3">
          {account ? (
            <div className="mb-2 rounded-lg bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span className="truncate text-sm font-medium text-slate-800">@{account.username}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">متصل ✅</p>
            </div>
          ) : (
            <Link
              href="/instagram"
              className="mb-2 block rounded-lg bg-brand-50 p-3 text-center text-sm font-medium text-brand-700 hover:bg-brand-100"
            >
              اتصال اینستاگرام
            </Link>
          )}
          <div className="truncate px-1 text-xs text-slate-400">{user.email}</div>
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <span className="font-bold text-slate-900">IGFlow</span>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap text-sm text-slate-600 hover:text-brand-600">
              {n.label}
            </Link>
          ))}
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
