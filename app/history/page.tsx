'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@/components/dashboard-layout';

interface Transaction {
  id: string;
  amount: number;
  type: string;
  reason: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: string;
}

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

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
      fetchTransactions();
    }
  }, [user]);

  const fetchTransactions = async () => {
    try {
      const response = await fetch('/api/credits/transactions');
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions);
      }
    } catch (error) {
      console.error('[v0] Failed to fetch transactions:', error);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (loading || !user) {
    return <div />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Transaction History</h1>
          <p className="text-muted-foreground">View all your credit transactions</p>
        </div>

        {historyLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin mb-4">
              <div className="h-8 w-8 border-4 border-accent border-t-transparent rounded-full"></div>
            </div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12 brutal-panel">
            <p className="text-muted-foreground">No transactions yet</p>
          </div>
        ) : (
          <div className="brutal-panel overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-border bg-background/50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Date</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Type</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Reason</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">Amount</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-foreground">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border last:border-b-0 hover:bg-background/50">
                    <td className="px-6 py-3 text-sm text-foreground">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          tx.type === 'earned'
                            ? 'bg-green-500/20 text-green-400'
                            : tx.type === 'spent'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted-foreground">{tx.reason}</td>
                    <td
                      className={`px-6 py-3 text-sm text-right font-semibold ${
                        tx.amount > 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {tx.amount > 0 ? '+' : ''}{tx.amount}
                    </td>
                    <td className="px-6 py-3 text-sm text-right text-foreground">{tx.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
