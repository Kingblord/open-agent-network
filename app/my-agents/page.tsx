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
}

export default function MyAgentsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [myAgentsLoading, setMyAgentsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    capabilities: '',
    costPerExecution: 10,
  });
  const [isCreating, setIsCreating] = useState(false);

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
      fetchMyAgents();
    }
  }, [user]);

  const fetchMyAgents = async () => {
    try {
      const response = await fetch('/api/agents?my=true');
      if (response.ok) {
        const data = await response.json();
        setAgents(data.agents);
      }
    } catch (error) {
      console.error('[v0] Failed to fetch agents:', error);
    } finally {
      setMyAgentsLoading(false);
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          capabilities: formData.capabilities.split(',').map(c => c.trim()),
          costPerExecution: parseFloat(String(formData.costPerExecution)),
        }),
      });

      if (response.ok) {
        alert('Agent created successfully!');
        setFormData({ name: '', description: '', capabilities: '', costPerExecution: 10 });
        setShowForm(false);
        await fetchMyAgents();
      } else {
        const error = await response.json();
        alert('Error: ' + error.error);
      }
    } catch (error) {
      console.error('[v0] Creation error:', error);
      alert('Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  if (loading || !user) {
    return <div />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold text-foreground mb-2">My Agents</h1>
            <p className="text-muted-foreground">Create and manage your AI agents</p>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            {showForm ? 'Cancel' : 'Create Agent'}
          </Button>
        </div>

        {showForm && (
          <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <form onSubmit={handleCreateAgent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Agent Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Agent"
                  className="w-full px-3 py-2 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What does this agent do?"
                  className="w-full px-3 py-2 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  rows={3}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Capabilities (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.capabilities}
                  onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
                  placeholder="analysis, reasoning, coding"
                  className="w-full px-3 py-2 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Cost Per Execution (credits)
                </label>
                <input
                  type="number"
                  value={formData.costPerExecution}
                  onChange={(e) => setFormData({ ...formData, costPerExecution: parseFloat(e.target.value) })}
                  placeholder="10"
                  className="w-full px-3 py-2 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                  min="1"
                  step="1"
                />
              </div>

              <Button
                type="submit"
                disabled={isCreating}
                className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {isCreating ? 'Creating...' : 'Create Agent'}
              </Button>
            </form>
          </div>
        )}

        {myAgentsLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin mb-4">
              <div className="h-8 w-8 border-4 border-accent border-t-transparent rounded-full"></div>
            </div>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12 bg-card border border-border rounded-lg">
            <p className="text-muted-foreground mb-4">You haven&apos;t created any agents yet</p>
            <Button
              onClick={() => setShowForm(true)}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              Create Your First Agent
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {agents.map((agent) => (
              <div key={agent.id} className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-xl font-bold text-foreground mb-2">{agent.name}</h3>
                <p className="text-muted-foreground text-sm mb-4">{agent.description}</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {agent.capabilities.map((cap) => (
                    <span key={cap} className="px-2 py-1 bg-accent/20 text-accent text-xs rounded">
                      {cap}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">
                  Cost: <span className="text-accent font-bold">{agent.costPerExecution} credits</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
