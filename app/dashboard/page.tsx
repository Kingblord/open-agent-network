'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';

interface Hiring {
  id: string;
  agentId: string;
  status: string;
  creditsCost: number;
  createdAt: string;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [hirings, setHirings] = useState<Hiring[]>([]);
  const [hiringsLoading, setHiringsLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && !user) {
      router.push('/login');
    }
  }, [mounted, user, loading, router]);

  useEffect(() => {
    if (user) {
      fetchHirings();
    }
  }, [user]);

  const fetchHirings = async () => {
    try {
      const response = await fetch('/api/hirings');
      if (response.ok) {
        const data = await response.json();
        setHirings(data.hirings.slice(0, 5)); // Show last 5
      }
    } catch (error) {
      console.error('[v0] Failed to fetch hirings:', error);
    } finally {
      setHiringsLoading(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">
            <div className="h-8 w-8 border-4 border-accent border-t-transparent rounded-full"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Welcome back, {user.name}!</h1>
          <p className="text-muted-foreground">Manage your agents and credits</p>
        </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="brutal-panel p-6">
            <div className="text-sm text-muted-foreground mb-1">Credit Balance</div>
            <div className="text-3xl font-bold text-foreground">{user.credits}</div>
            <div className="text-xs text-muted-foreground mt-2">Available credits</div>
          </div>

          <div className="brutal-panel p-6">
            <div className="text-sm text-muted-foreground mb-1">Account Tier</div>
            <div className="text-3xl font-bold text-accent capitalize">{user.tier}</div>
            <div className="text-xs text-muted-foreground mt-2">Free account</div>
          </div>

          <div className="brutal-panel p-6">
            <div className="text-sm text-muted-foreground mb-1">Member Since</div>
            <div className="text-lg font-bold text-foreground">
              {new Date(user.createdAt).toLocaleDateString()}
            </div>
            <div className="text-xs text-muted-foreground mt-2">Account created</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-foreground">Quick Actions</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Link href="/agents">
              <div className="brutal-panel p-6 hover:border-accent transition cursor-pointer">
                <h3 className="text-lg font-semibold text-foreground mb-2">Browse Agents</h3>
                <p className="text-muted-foreground mb-4">Discover and hire AI agents from the network</p>
                <Button className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                  Browse Now
                </Button>
              </div>
            </Link>

            <Link href="/my-agents">
              <div className="brutal-panel p-6 hover:border-accent transition cursor-pointer">
                <h3 className="text-lg font-semibold text-foreground mb-2">Create Agent</h3>
                <p className="text-muted-foreground mb-4">Deploy your own agent and earn credits</p>
                <Button className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                  Get Started
                </Button>
              </div>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        {hirings.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-foreground">Recent Activity</h2>
            <div className="brutal-panel overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                      Hiring ID
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                      Credits
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hirings.map((hiring) => (
                    <tr key={hiring.id} className="border-b border-border last:border-b-0 hover:bg-background/50">
                      <td className="px-6 py-3 text-sm text-foreground font-mono">
                        {hiring.id.slice(0, 8)}...
                      </td>
                      <td className="px-6 py-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            hiring.status === 'completed'
                              ? 'bg-sky-500/20 text-sky-400'
                              : hiring.status === 'pending'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {hiring.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-foreground">{hiring.creditsCost}</td>
                      <td className="px-6 py-3 text-sm text-muted-foreground">
                        {new Date(hiring.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Link href="/history">
              <Button variant="outline" className="border-border text-foreground hover:bg-card">
                View All History
              </Button>
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}