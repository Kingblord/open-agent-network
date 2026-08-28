'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

const navigation = [
  { href: '/dashboard', label: 'Overview', code: '00' },
  { href: '/agents', label: 'Browse agents', code: '01' },
  { href: '/my-agents', label: 'My agents', code: '02' },
  { href: '/history', label: 'Credit ledger', code: '03' },
  { href: '/settings', label: 'Settings', code: '04' },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b-2 border-border bg-sidebar lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[260px] lg:flex-col lg:border-b-0 lg:border-r-2">
        <div className="flex items-start justify-between border-b-2 border-border p-5 lg:block">
          <div>
            <Link href="/dashboard" className="font-sans text-3xl font-black tracking-[-0.08em] text-foreground">
              OAN<span className="text-accent">_</span>
            </Link>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Open Agent Network</p>
          </div>
          <span className="border border-accent px-2 py-1 font-mono text-[10px] font-bold text-accent">LIVE</span>
        </div>

        <nav aria-label="Primary navigation" className="grid grid-cols-2 gap-px bg-border p-px lg:flex lg:flex-1 lg:flex-col lg:gap-0 lg:bg-transparent lg:p-4">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className={`group flex min-h-11 items-center gap-3 px-4 py-3 font-mono text-xs uppercase tracking-wider ${isActive(item.href) ? 'bg-accent font-bold text-accent-foreground' : 'bg-sidebar text-muted-foreground hover:bg-card hover:text-foreground'}`}>
              <span className="text-[10px] opacity-60">{item.code}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="border-t-2 border-border p-4">
          {user && <div className="mb-4 border-l-2 border-accent pl-3"><p className="truncate text-sm font-bold text-foreground">{user.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{user.email}</p></div>}
          <Button onClick={handleLogout} variant="outline" className="h-11 w-full border-2 border-border bg-transparent font-mono text-xs uppercase tracking-wider text-foreground hover:border-accent hover:bg-transparent hover:text-accent">Sign out / exit</Button>
        </div>
      </aside>

      <div className="min-w-0 lg:col-start-2 lg:ml-0">
        <header className="sticky top-0 z-40 border-b-2 border-border bg-background/95 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between px-5 py-3 lg:px-8">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Console / {pathname.slice(1) || 'overview'}</p><p className="mt-1 text-sm font-bold text-foreground">Network control surface</p></div>
            {user && <div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="font-mono text-[10px] uppercase text-muted-foreground">Available credits</p><p className="font-sans text-xl font-black text-accent">{user.credits}</p></div><div aria-hidden="true" className="grid size-10 place-items-center border-2 border-accent bg-accent font-sans font-black text-accent-foreground">{user.name.charAt(0).toUpperCase()}</div></div>}
          </div>
        </header>
        <main className="p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
