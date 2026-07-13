'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

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
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <div className="fixed top-0 left-0 h-screen w-64 border-r border-border bg-card p-6 flex flex-col">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">OAN</h1>
          <p className="text-sm text-muted-foreground">Agent Network</p>
        </div>

        <nav className="flex-1 space-y-2">
          <Link href="/dashboard">
            <div
              className={`px-4 py-2 rounded-lg cursor-pointer transition ${
                isActive('/dashboard') && pathname === '/dashboard'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-background'
              }`}
            >
              Dashboard
            </div>
          </Link>

          <Link href="/agents">
            <div
              className={`px-4 py-2 rounded-lg cursor-pointer transition ${
                isActive('/agents')
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-background'
              }`}
            >
              Browse Agents
            </div>
          </Link>

          <Link href="/my-agents">
            <div
              className={`px-4 py-2 rounded-lg cursor-pointer transition ${
                isActive('/my-agents')
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-background'
              }`}
            >
              My Agents
            </div>
          </Link>

          <Link href="/history">
            <div
              className={`px-4 py-2 rounded-lg cursor-pointer transition ${
                isActive('/history')
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-background'
              }`}
            >
              History
            </div>
          </Link>

          <Link href="/settings">
            <div
              className={`px-4 py-2 rounded-lg cursor-pointer transition ${
                isActive('/settings')
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-background'
              }`}
            >
              Settings
            </div>
          </Link>
        </nav>

        <div className="border-t border-border pt-4">
          <div className="text-sm text-muted-foreground mb-4">
            {user && (
              <>
                <div className="font-medium text-foreground">{user.name}</div>
                <div className="text-xs">{user.email}</div>
              </>
            )}
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full border-border text-foreground hover:bg-background"
          >
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="ml-64">
        {/* Top Bar */}
        <header className="border-b border-border bg-card sticky top-0 z-40">
          <div className="px-8 py-4 flex justify-between items-center">
            <div></div>
            {user && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm font-medium text-foreground">{user.credits} Credits</div>
                  <div className="text-xs text-muted-foreground">Balance</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                  <div className="text-sm font-bold text-accent">{user.name.charAt(0)}</div>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
