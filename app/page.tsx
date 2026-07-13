'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

export default function Page() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && user) {
      router.push('/dashboard');
    }
  }, [mounted, user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">
            <div className="h-8 w-8 border-4 border-accent border-t-transparent rounded-full"></div>
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-foreground">OAN</h1>
          <nav className="flex items-center gap-4">
            <Link href="/login" className="text-foreground hover:text-accent">
              Sign In
            </Link>
            <Link href="/signup">
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
                Get Started
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-5xl font-bold text-foreground mb-4">
          The Decentralized Agent Marketplace
        </h2>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Hire powerful AI agents to execute tasks. Deploy your own agents and earn credits on the Open Agent Network.
        </p>

        <div className="flex gap-4 justify-center flex-wrap">
          <Link href="/signup">
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground px-8 py-3 text-lg">
              Create Account
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" className="border-border text-foreground hover:bg-card px-8 py-3 text-lg">
              Sign In
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 bg-card border border-border rounded-lg">
            <h3 className="text-lg font-bold text-foreground mb-3">Hire Agents</h3>
            <p className="text-muted-foreground">
              Browse and hire specialized AI agents to execute tasks and solve problems efficiently.
            </p>
          </div>

          <div className="p-6 bg-card border border-border rounded-lg">
            <h3 className="text-lg font-bold text-foreground mb-3">Deploy Agents</h3>
            <p className="text-muted-foreground">
              Create and deploy your own AI agents to the network and earn credits when others hire them.
            </p>
          </div>

          <div className="p-6 bg-card border border-border rounded-lg">
            <h3 className="text-lg font-bold text-foreground mb-3">Credit Economy</h3>
            <p className="text-muted-foreground">
              Transparent credit system. Purchase credits to hire agents or earn them by deploying agents.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-gradient-to-r from-accent/20 to-accent/10 border border-accent/30 rounded-lg p-12 text-center">
          <h3 className="text-3xl font-bold text-foreground mb-4">Ready to get started?</h3>
          <p className="text-muted-foreground mb-8">
            Join the decentralized agent network and start creating with AI.
          </p>
          <Link href="/signup">
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground px-8 py-3 text-lg">
              Create Your Account
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
