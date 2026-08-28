'use client';

import { useState } from 'react';
import Link from 'next/link';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useToast } from '@/components/toast-provider';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const toast = useToast();

  const emailError = touched && !EMAIL_RE.test(email) ? 'Enter a valid email address.' : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (!EMAIL_RE.test(email.trim())) {
      const msg = 'Enter a valid email address.';
      setStatus('error');
      setMessage(msg);
      toast.error({ title: 'Invalid email', description: msg });
      return;
    }

    if (!auth) {
      const msg = 'Password reset is not configured. Please contact support.';
      setStatus('error');
      setMessage(msg);
      toast.error({ title: 'Reset unavailable', description: msg });
      return;
    }

    setStatus('sending');
    setMessage('');
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setStatus('sent');
      const msg = 'If an account exists for that email, a reset link has been sent.';
      setMessage(msg);
      toast.success({ title: 'Reset link sent', description: msg });
    } catch (err) {
      const invalid =
        err instanceof Error && err.message === 'Firebase: Error (auth/invalid-email).';
      const msg = invalid
        ? 'Please enter a valid email address.'
        : 'If an account exists for that email, a reset link has been sent.';
      setStatus('error');
      setMessage(msg);
      toast.error({ title: 'Reset request', description: msg });
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
          <div className="hidden border-l-4 border-accent pl-6 lg:block">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-accent">BAN // RECOVERY</p>
            <h1 className="max-w-xl text-6xl font-black uppercase leading-[0.9] tracking-[-0.06em] text-foreground">Restore operator access.</h1>
            <p className="mt-6 max-w-md font-mono text-sm leading-6 text-muted-foreground">DETERMINISTIC POLICY // NO FABRICATED METRICS // SESSION-BOUNDED AUTHORITY</p>
          </div>
          <div className="w-full">
            <div className="mb-4 flex items-center justify-between border-b-2 border-border pb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              <span>13 / ACCOUNT RECOVERY</span><span>STATUS: READY</span>
            </div>
            <div className="brutal-panel p-6 sm:p-8">
              <h2 className="mb-2 text-3xl font-black uppercase tracking-tight text-foreground">Forgot Password</h2>
              <p className="mb-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">Request reset link</p>

              {status === 'sent' ? (
                <div className="border-2 border-accent/40 bg-accent/10 p-4">
                  <p className="text-sm text-accent">{message}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setTouched(true); }}
                      onBlur={() => setTouched(true)}
                      className={`brutal-input w-full placeholder:text-muted-foreground ${emailError && 'border-destructive'}`}
                      placeholder="your@email.com"
                      required
                    />
                    {emailError && <p className="mt-1.5 text-xs text-destructive">{emailError}</p>}
                  </div>

                  {status === 'error' && (
                    <div className="border-2 border-destructive/40 bg-destructive/10 p-3">
                      <p className="text-sm text-destructive">{message}</p>
                    </div>
                  )}

                  <button type="submit" disabled={status === 'sending'} className="brutal-button w-full">
                    {status === 'sending' ? 'Sending link...' : 'Send reset link'}
                  </button>
                </form>
              )}

              <p className="mt-6 text-center font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Remembered it?{' '}
                <Link href="/login" className="font-bold text-accent underline underline-offset-4">
                  Back to sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}