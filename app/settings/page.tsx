'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  isRevoked: boolean;
}

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ id: string; apiKey: string } | null>(null);
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      fetchApiKeys();
      setName(user.name);
    }
  }, [user]);

  const fetchApiKeys = async () => {
    try {
      const response = await fetch('/api/developers/keys');
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.keys);
      }
    } catch (error) {
      console.error('[v0] Failed to fetch API keys:', error);
    } finally {
      setKeysLoading(false);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      const response = await fetch('/api/developers/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName }),
      });

      if (response.ok) {
        const data = await response.json();
        setNewKey({ id: data.keyId, apiKey: data.apiKey });
        setKeyName('');
        await fetchApiKeys();
      } else {
        alert('Failed to create API key');
      }
    } catch (error) {
      console.error('[v0] Creation error:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure? This cannot be undone.')) return;

    try {
      const response = await fetch(`/api/developers/keys/${id}`, { method: 'DELETE' });
      if (response.ok) {
        await fetchApiKeys();
      }
    } catch (error) {
      console.error('[v0] Revoke error:', error);
    }
  };

  const handleUpdateProfile = async () => {
    if (!name.trim()) {
      alert('Name is required');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/developers/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        alert('Profile updated successfully!');
      } else {
        alert('Failed to update profile');
      }
    } catch (error) {
      console.error('[v0] Update error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading || !user) {
    return <div />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-2xl">
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Settings</h1>
          <p className="text-muted-foreground">Manage your account and API keys</p>
        </div>

        {/* Profile Section */}
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <h2 className="text-2xl font-bold text-foreground">Profile</h2>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Email</label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full px-4 py-2 rounded-lg bg-background border border-border text-muted-foreground cursor-not-allowed"
            />
          </div>

          <Button
            onClick={handleUpdateProfile}
            disabled={isSaving}
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        {/* API Keys Section */}
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-foreground">API Keys</h2>
            <Button
              onClick={() => setShowForm(!showForm)}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              {showForm ? 'Cancel' : 'Create Key'}
            </Button>
          </div>

          {newKey && (
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg space-y-2">
              <p className="text-sm text-green-400 font-medium">API Key Created! Copy it now (you won&apos;t see it again):</p>
              <div className="font-mono text-xs text-foreground break-all bg-background p-3 rounded border border-border">
                {newKey.apiKey}
              </div>
              <Button
                onClick={() => setNewKey(null)}
                variant="outline"
                className="border-border text-foreground"
              >
                Done
              </Button>
            </div>
          )}

          {showForm && (
            <form onSubmit={handleCreateKey} className="space-y-3 border-t border-border pt-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Key Name</label>
                <input
                  type="text"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="My API Key"
                  className="w-full px-3 py-2 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isCreating}
                className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {isCreating ? 'Creating...' : 'Create Key'}
              </Button>
            </form>
          )}

          {keysLoading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin mb-4">
                <div className="h-6 w-6 border-3 border-accent border-t-transparent rounded-full"></div>
              </div>
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="text-muted-foreground text-sm">No API keys created yet</p>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((key) => (
                <div key={key.id} className="flex justify-between items-center p-3 bg-background rounded border border-border">
                  <div>
                    <div className="text-sm font-medium text-foreground">{key.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(key.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleRevokeKey(key.id)}
                    variant="outline"
                    className="border-destructive text-destructive hover:bg-destructive/10"
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
