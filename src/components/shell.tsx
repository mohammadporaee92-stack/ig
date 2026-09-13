'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '~/lib/utils';
import { apiPost } from '~/lib/api-client';

export function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </Link>
  );
}

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await apiPost('/api/auth/logout');
        window.location.assign('/login');
      }}
      className="mt-2 w-full rounded-lg px-3 py-2 text-right text-sm text-slate-500 hover:bg-slate-50 hover:text-red-600"
    >
      خروج
    </button>
  );
}
