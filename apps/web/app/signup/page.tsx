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

export default function SignupPage() {
  const [name, setName] = useState<FieldState>({ value: '', touched: false });
  const [email, setEmail] = useState<FieldState>({ value: '', touched: false });
  const [password, setPassword] = useState<FieldState>({ value: '', touched: false });
  const [confirmPassword, setConfirmPassword] = useState<FieldState>({ value: '', touched: false });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signup } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const nameError = name.touched && name.value.trim().length < 2 ? 'Enter your name (at least 2 characters).' : '';
  const emailError = email.touched && !EMAIL_RE.test(email.value) ? 'Enter a valid email address.' : '';
  const passwordError = password.touched
    ? password.value.length < 8
      ? 'Password must be at least 8 characters.'
      : !/[A-Z]/.test(password.value)
        ? 'Password must include an uppercase letter.'
        : !/[0-9]/.test(password.value)
          ? 'Password must include a number.'
          : ''
    : '';
  const confirmError =
    confirmPassword.touched && confirmPassword.value !== password.value ? 'Passwords do not match.' : '';

  const valid =
    name.value.trim().length >= 2 &&
    EMAIL_RE.test(email.value) &&
    password.value.length >= 8 &&
    /[A-Z]/.test(password.value) &&
    /[0-9]/.test(password.value) &&
    password.value === confirmPassword.value;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!valid) {
      setName((p) => ({ ...p, touched: true }));
      setEmail((p) => ({ ...p, touched: true }));
      setPassword((p) => ({ ...p, touched: true }));
      setConfirmPassword((p) => ({ ...p, touched: true }));
      const first = nameError || emailError || passwordError || confirmError;
      setError(first || 'Please complete the form correctly.');
      return;
    }

    setIsLoading(true);

    try {
      await signup(name.value, email.value, password.value);
      toast.success({ title: 'Account created', description: 'Welcome to BAN.' });
      router.push('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
      setError(msg);
      toast.error({ title: 'Sign up failed', description: msg });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
          <div className="hidden border-l-4 border-accent pl-6 lg:block">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-accent">BAN // NEW OPERATOR</p>
            <h1 className="max-w-xl text-6xl font-black uppercase leading-[0.9] tracking-[-0.06em] text-foreground">Deploy your first agent identity.</h1>
            <p className="mt-6 max-w-md font-mono text-sm leading-6 text-muted-foreground">DETERMINISTIC POLICY // NO FABRICATED METRICS // SESSION-BOUNDED AUTHORITY</p>
          </div>
          <div className="w-full">
            <div className="mb-4 flex items-center justify-between border-b-2 border-border pb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              <span>02 / SIGN UP</span><span>STATUS: READY</span>
            </div>
            <div className="brutal-panel p-6 sm:p-8">
              <h2 className="mb-2 text-3xl font-black uppercase tracking-tight text-foreground">Create Account</h2>
              <p className="mb-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">Register operator</p>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-medium text-foreground">
                    Full Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name.value}
                    onChange={(e) => setName({ value: e.target.value, touched: true })}
                    onBlur={() => setName((p) => ({ ...p, touched: true }))}
                    className={`brutal-input w-full placeholder:text-muted-foreground ${nameError && 'border-destructive'}`}
                    placeholder="Your name"
                    required
                  />
                  {nameError && <p className="mt-1.5 text-xs text-destructive">{nameError}</p>}
                </div>

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
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-foreground">
                    Password
                  </label>
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

                <div>
                  <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-foreground">
                    Confirm Password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword.value}
                    onChange={(e) => setConfirmPassword({ value: e.target.value, touched: true })}
                    onBlur={() => setConfirmPassword((p) => ({ ...p, touched: true }))}
                    className={`brutal-input w-full placeholder:text-muted-foreground ${confirmError && 'border-destructive'}`}
                    placeholder="••••••••"
                    required
                  />
                  {confirmError && <p className="mt-1.5 text-xs text-destructive">{confirmError}</p>}
                </div>

                {error && (
                  <div className="border-2 border-destructive/40 bg-destructive/10 p-3">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="brutal-button w-full"
                >
                  {isLoading ? 'Creating account...' : 'Sign Up'}
                </button>
              </form>

              <p className="mt-6 text-center font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Already have an account?{' '}
                <Link href="/login" className="font-bold text-accent underline underline-offset-4">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}