'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';

interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  costPerExecution: number;
  rating: number;
  reviewCount: number;
}

interface HiringResponse {
  hiringId: string;
  taskId: string;
  creditsCost: number;
  newBalance: number;
}

export default function AgentsPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [taskDesc, setTaskDesc] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && !user) {
      router.push('/login');
    }
  }, [mounted, user, loading, router]);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const response = await fetch('/api/agents');
      if (response.ok) {
        const data = await response.json();
        setAgents(data.agents);
      }
    } catch (error) {
      console.error('[v0] Failed to fetch agents:', error);
    } finally {
      setAgentsLoading(false);
    }
  };

  const handleHireAgent = async (agent: Agent) => {
    if (!taskDesc.trim()) {
      alert('Please enter a task description');
      return;
    }

    try {
      const response = await fetch('/api/hirings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          taskDescription: taskDesc,
          input: { description: taskDesc },
        }),
      });

      if (response.ok) {
        const data: HiringResponse = await response.json();
        setHiringId(data.hiringId);
        setTaskDesc('');
        setSelectedAgent(null);
        await refreshUser();
        
        // Auto-refresh agents list after hire
        setTimeout(() => {
          fetchAgents();
          setHiringId(null);
        }, 2000);
      } else {
        const error = await response.json();
        alert('Error: ' + error.error);
      }
    } catch (error) {
      console.error('[v0] Hiring error:', error);
      alert('Failed to hire agent');
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
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Available Agents</h1>
          <p className="text-muted-foreground">Browse and hire AI agents</p>
        </div>

        {hiringId && (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-green-400">Agent hired successfully! ID: {hiringId.slice(0, 8)}...</p>
          </div>
        )}

        {agentsLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin mb-4">
              <div className="h-8 w-8 border-4 border-accent border-t-transparent rounded-full"></div>
            </div>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No agents available yet. Create one to get started!</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {agents.map((agent) => (
              <div key={agent.id} className="bg-card border border-border rounded-lg p-6 space-y-4">
                <div>
                  <h3 className="text-xl font-bold text-foreground">{agent.name}</h3>
                  <p className="text-muted-foreground text-sm mt-1">{agent.description}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-1 bg-accent/20 text-accent text-xs rounded"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm text-muted-foreground">Cost per execution</div>
                    <div className="text-2xl font-bold text-accent">{agent.costPerExecution} credits</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Rating</div>
                    <div className="text-lg font-bold text-foreground">
                      {agent.rating}/5 ({agent.reviewCount})
                    </div>
                  </div>
                </div>

                {selectedAgent?.id === agent.id ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <textarea
                      value={taskDesc}
                      onChange={(e) => setTaskDesc(e.target.value)}
                      placeholder="Describe the task for this agent..."
                      className="w-full px-3 py-2 rounded bg-background border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleHireAgent(agent)}
                        className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground"
                      >
                        Confirm Hire
                      </Button>
                      <Button
                        onClick={() => setSelectedAgent(null)}
                        variant="outline"
                        className="flex-1 border-border text-foreground"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    onClick={() => setSelectedAgent(agent)}
                    className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
                  >
                    Hire Agent
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
