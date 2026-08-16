'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
          <div className="hidden border-l-4 border-accent pl-6 lg:block">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-accent">OAN // ACCESS GATE</p>
            <h1 className="max-w-xl text-6xl font-black uppercase leading-[0.9] tracking-[-0.06em] text-foreground">Operate on the open agent network.</h1>
            <p className="mt-6 max-w-md font-mono text-sm leading-6 text-muted-foreground">LOCAL AUTH // NO FIRESTORE // SESSION PERSISTED IN BROWSER STORAGE</p>
          </div>
          <div className="w-full">
            <div className="mb-4 flex items-center justify-between border-b-2 border-border pb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              <span>01 / LOGIN</span><span>STATUS: READY</span>
            </div>
            <div className="brutal-panel p-6 sm:p-8">
              <h2 className="mb-2 text-3xl font-black uppercase tracking-tight text-foreground">Sign In</h2>
              <p className="mb-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">Identify operator</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="brutal-input w-full placeholder:text-muted-foreground"
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="brutal-input w-full placeholder:text-muted-foreground"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="brutal-button w-full"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

              <p className="mt-6 text-center font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="font-bold text-accent underline underline-offset-4">
                  Sign up
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
