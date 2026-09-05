'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/toast-provider';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldState = {
  value: string;
  touched: boolean;
};

export default function LoginPage() {
  const [email, setEmail] = useState<FieldState>({ value: '', touched: false });
  const [password, setPassword] = useState<FieldState>({ value: '', touched: false });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const { login } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const emailError = email.touched && !EMAIL_RE.test(email.value) ? 'Enter a valid email address.' : '';
  const passwordError = password.touched && password.value.length < 8 ? 'Password must be at least 8 characters.' : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!EMAIL_RE.test(email.value)) {
      setEmail((p) => ({ ...p, touched: true }));
      setError('Enter a valid email address.');
      return;
    }
    if (password.value.length < 8) {
      setPassword((p) => ({ ...p, touched: true }));
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);

    try {
      await login(email.value, password.value);
      toast.success({ title: 'Signed in', description: 'Welcome back to BAN.' });
      router.push('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      toast.error({ title: 'Sign in failed', description: msg });
      // Cooldown on quota exceeded
      if (msg.includes('Quota') || msg.includes('RESOURCE_EXHAUSTED')) {
        setCooldown(30);
        const interval = setInterval(() => {
          setCooldown((prev) => {
            if (prev <= 1) { clearInterval(interval); return 0; }
            return prev - 1;
          });
        }, 1000);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
          <div className="hidden border-l-4 border-accent pl-6 lg:block">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-accent">BAN // ACCESS GATE</p>
            <h1 className="max-w-xl text-6xl font-black uppercase leading-[0.9] tracking-[-0.06em] text-foreground">Operate on the BNB agent network.</h1>
            <p className="mt-6 max-w-md font-mono text-sm leading-6 text-muted-foreground">DETERMINISTIC POLICY // NO FABRICATED METRICS // SESSION-BOUNDED AUTHORITY</p>
          </div>
          <div className="w-full">
            <div className="mb-4 flex items-center justify-between border-b-2 border-border pb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              <span>01 / LOGIN</span><span>STATUS: READY</span>
            </div>
            <div className="brutal-panel p-6 sm:p-8">
              <h2 className="mb-2 text-3xl font-black uppercase tracking-tight text-foreground">Sign In</h2>
              <p className="mb-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">Identify operator</p>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email.value}
                    onChange={(e) => setEmail({ value: e.target.value, touched: true })}
                    onBlur={() => setEmail((p) => ({ ...p, touched: true }))}
                    className={`brutal-input w-full placeholder:text-muted-foreground ${emailError && 'border-destructive'}`}
                    placeholder="your@email.com"
                    required
                  />
                  {emailError && <p className="mt-1.5 text-xs text-destructive">{emailError}</p>}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="password" className="block text-sm font-medium text-foreground">
                      Password
                    </label>
                    <Link href="/forgot-password" className="font-mono text-xs uppercase tracking-wide text-accent underline underline-offset-4">
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password.value}
                    onChange={(e) => setPassword({ value: e.target.value, touched: true })}
                    onBlur={() => setPassword((p) => ({ ...p, touched: true }))}
                    className={`brutal-input w-full placeholder:text-muted-foreground ${passwordError && 'border-destructive'}`}
                    placeholder="••••••••"
                    required
                  />
                  {passwordError && <p className="mt-1.5 text-xs text-destructive">{passwordError}</p>}
                </div>

                {error && (
                  <div className="border-2 border-destructive/40 bg-destructive/10 p-3">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || cooldown > 0}
                  className="brutal-button w-full"
                >
                  {isLoading ? 'Signing in...' : cooldown > 0 ? `Wait ${cooldown}s` : 'Sign In'}
                </button>
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