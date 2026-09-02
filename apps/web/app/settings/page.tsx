'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { useToast } from '@/components/toast-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingButton } from '@/components/ui/loading-button';
import { WalletConnectCard } from '@/components/wallet-connect-card';

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  isRevoked: boolean;
}

interface PendingAction {
  type: 'revoke' | 'logout';
  keyId?: string;
}

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'API' | 'SECURITY'>('GENERAL');
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [credits, setCredits] = useState<number | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

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
      setName(user.name || '');
      loadApiKeys();
      loadCredits();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadApiKeys = async () => {
    setKeysLoading(true);
    try {
      const res = await fetch('/api/developers/keys');
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      } else {
        setApiKeys([]);
      }
    } catch (err) {
      console.error('Failed to load API keys:', err);
      setApiKeys([]);
    } finally {
      setKeysLoading(false);
    }
  };

  const loadCredits = async () => {
    try {
      const res = await fetch('/api/developers/credits');
      if (res.ok) {
        const data = await res.json();
        setCredits(data.balance);
      }
    } catch (err) {
      console.error('Failed to load credits:', err);
    }
  };

  const handleUpdateProfile = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/developers/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        toast.success({ title: 'Profile updated', description: 'Your changes have been saved.' });
      } else {
        const err = await res.json();
        const msg = err.error || 'Failed to update profile.';
        setSaveMessage(msg);
        toast.error({ title: 'Update failed', description: msg });
      }
    } catch (err) {
      console.error('Profile update error:', err);
      const msg = 'Failed to update profile.';
      setSaveMessage(msg);
      toast.error({ title: 'Update failed', description: msg });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await fetch('/api/developers/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setRevealedKey(data.apiKey);
        setNewKeyName('');
        setShowCreateKey(false);
        await loadApiKeys();
        toast.success({ title: 'API key created', description: 'Copy it now â€” it will not be shown again.' });
      } else {
        const err = await res.json();
        const msg = err.error || 'Failed to create API key.';
        toast.error({ title: 'Key creation failed', description: msg });
      }
    } catch (err) {
      console.error('API key creation error:', err);
      toast.error({ title: 'Key creation failed', description: 'An unexpected error occurred.' });
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/developers/keys/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await loadApiKeys();
        toast.success({ title: 'API key revoked', description: 'The key can no longer be used for requests.' });
      } else {
        const err = await res.json();
        toast.error({ title: 'Revoke failed', description: err.error || 'Failed to revoke API key.' });
      }
    } catch (err) {
      console.error('Revoke API key error:', err);
      toast.error({ title: 'Revoke failed', description: 'An unexpected error occurred.' });
    } finally {
      setActionLoading(false);
      setPendingAction(null);
    }
  };

  const handleLogout = async () => {
    setActionLoading(true);
    try {
      const { signOut } = await import('firebase/auth');
      const { auth } = await import('@/lib/firebase');
      if (auth) await signOut(auth);
      toast.info({ title: 'Signed out', description: 'You have been logged out of BAN.' });
      await new Promise((r) => setTimeout(r, 300));
      window.location.href = '/login';
    } catch (err) {
      console.error('Logout error:', err);
      toast.error({ title: 'Sign out failed', description: 'An unexpected error occurred.' });
      setActionLoading(false);
      setPendingAction(null);
    }
  };

  const handleConfirm = () => {
    if (!pendingAction) return;
    if (pendingAction.type === 'revoke' && pendingAction.keyId) {
      handleRevokeKey(pendingAction.keyId);
    } else if (pendingAction.type === 'logout') {
      handleLogout();
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">
            <div className="h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
          </div>
          <p className="text-[#F0B90B] font-mono text-xs uppercase tracking-widest">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <div className="pb-20">
        <header className="bg-background px-5 pt-6 pb-4 flex items-center justify-between border-b border-[#1A1A1A]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/profile')}
              className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div>
              <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">SETTINGS</h2>
            </div>
          </div>
        </header>

        <div className="mx-5 mt-4 bg-[#1A1A1A] rounded-xl p-1 flex gap-1">
          {(['GENERAL', 'API', 'SECURITY'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-[10px] font-black tracking-wider uppercase rounded-lg transition ${
                activeTab === tab
                  ? 'bg-[#F0B90B] text-black'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'GENERAL' && (
          <div className="mx-5 mt-4 space-y-4">
            {/* Connected wallet â€” replaces the old mislabeled "Wallet Address" (developer ID) field */}
            <WalletConnectCard />

            <div className="bg-card rounded-xl p-5 border border-border">
              <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Profile Information</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">Display Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-gray-600 focus:outline-none focus:border-[#F0B90B]"
                    placeholder="Enter your name"
                  />
                </div>

                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">Email</label>
                  <input
                    type="email"
                    value={user.email || ''}
                    disabled
                    className="w-full bg-[#1A1A1A] border border-border rounded-lg px-3 py-2.5 text-sm text-muted-foreground cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">Developer ID</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={user.id || ''}
                      disabled
                      className="flex-1 bg-[#1A1A1A] border border-border rounded-lg px-3 py-2.5 text-sm text-muted-foreground font-mono cursor-not-allowed"
                    />
                    <button
                      onClick={() => { navigator.clipboard.writeText(user.id || ''); toast.success({ title: 'Copied', description: 'Developer ID copied to clipboard.' }); }}
                      className="px-3 py-2.5 bg-[#1A1A1A] border border-border rounded-lg text-[#F0B90B] hover:border-[#F0B90B] transition"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                  </div>
                </div>

                {saveMessage && (
                  <div className="p-3 bg-[#F0B90B]/10 border border-[#F0B90B]/30 rounded-lg text-xs text-[#F0B90B]">
                    {saveMessage}
                  </div>
                )}

                <LoadingButton
                  onClick={handleUpdateProfile}
                  loading={isSaving}
                  loadingLabel="Saving..."
                  variant="primary"
                >
                  SAVE CHANGES
                </LoadingButton>
              </div>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border">
              <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Account</h3>
              <div className="flex items-center justify-between py-2.5 border-b border-border">
                <span className="text-sm text-gray-300">Credits balance</span>
                <span className="text-sm font-black text-[#F0B90B]">{credits != null ? credits : 'â€”'}</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-gray-300">Developer ID</span>
                <span className="text-sm font-mono text-foreground">{user.id.slice(0, 16)}...</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'API' && (
          <div className="mx-5 mt-4 space-y-4">
            <div className="bg-card rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase">API Keys</h3>
                <button
                  onClick={() => setShowCreateKey(true)}
                  className="bg-[#F0B90B] text-black text-[10px] font-black px-3 py-1.5 uppercase tracking-wider rounded"
                >
                  + CREATE KEY
                </button>
              </div>

              {showCreateKey && (
                <div className="mb-4 p-3 bg-[#1A1A1A] rounded-lg border border-border">
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Key name (e.g., Production)"
                    className="w-full bg-background border border-border rounded px-3 py-2 text-xs text-foreground placeholder-gray-600 focus:outline-none focus:border-[#F0B90B] mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowCreateKey(false)}
                      disabled={creatingKey}
                      className="flex-1 bg-[#222] text-foreground text-xs font-black py-2 uppercase tracking-wider rounded disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <LoadingButton
                      onClick={handleCreateKey}
                      loading={creatingKey}
                      loadingLabel="Creating..."
                      variant="primary"
                    >
                      Create
                    </LoadingButton>
                  </div>
                </div>
              )}

              {revealedKey && (
                <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                  <p className="text-xs text-emerald-400 font-bold mb-1">API Key created â€” copy it now, it won&apos;t be shown again.</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-background text-emerald-300 font-mono text-xs px-3 py-2 rounded break-all">{revealedKey}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(revealedKey); toast.success({ title: 'Copied', description: 'API key copied to clipboard.' }); }}
                      className="px-3 py-2 bg-[#1A1A1A] border border-border text-[#F0B90B] text-xs font-black uppercase rounded hover:border-[#F0B90B]"
                    >
                      Copy
                    </button>
                  </div>
                  <button
                    onClick={() => setRevealedKey(null)}
                    className="mt-2 text-[10px] font-black text-muted-foreground uppercase"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {keysLoading ? (
                  <p className="text-center py-4 text-muted-foreground text-xs">Loading API keys...</p>
                ) : (
                  apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg border border-border">
                      <div>
                        <div className="text-sm font-bold text-foreground">{key.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          Created {new Date(key.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => setPendingAction({ type: 'revoke', keyId: key.id })}
                        disabled={key.isRevoked}
                        className="text-red-400 text-[10px] font-black uppercase tracking-wider px-2 py-1 border border-red-400/30 rounded hover:bg-red-400/10 transition disabled:opacity-40"
                      >
                        {key.isRevoked ? 'Revoked' : 'Revoke'}
                      </button>
                    </div>
                  ))
                )}

                {!keysLoading && apiKeys.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground text-xs">
                    No API keys created yet
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'SECURITY' && (
          <div className="mx-5 mt-4 space-y-4">
            <div className="bg-card rounded-xl p-5 border border-border">
              <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Security Settings</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2.5 border-b border-border">
                  <span className="text-sm text-gray-300">Two-Factor Authentication</span>
                  <span className="text-sm font-black text-muted-foreground">Managed by BAN</span>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-border">
                  <span className="text-sm text-gray-300">Agent Policy Enforcement</span>
                  <span className="text-sm font-black text-emerald-400">ALWAYS ON</span>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-border">
                  <span className="text-sm text-gray-300">Transaction Signing</span>
                  <span className="text-sm font-black text-emerald-400">SESSION-KEY BOUND</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-gray-300">AI Key Access</span>
                  <span className="text-sm font-black text-emerald-400">NONE (REASONING ONLY)</span>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border">
              <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Danger Zone</h3>
              <button
                onClick={() => setPendingAction({ type: 'logout' })}
                className="w-full bg-red-400/10 border border-red-400/30 text-red-400 font-black text-xs py-3 tracking-wider uppercase rounded-lg hover:bg-red-400/20 transition"
              >
                LOG OUT
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.type === 'logout' ? 'Log out?' : 'Revoke API key?'}
        description={
          pendingAction?.type === 'logout'
            ? 'You will need to sign in again to access your dashboard.'
            : 'This key will immediately stop working. This cannot be undone.'
        }
        confirmLabel={pendingAction?.type === 'logout' ? 'Log out' : 'Revoke key'}
        cancelLabel="Cancel"
        dangerous={pendingAction?.type === 'logout' ? false : true}
        loading={actionLoading}
        onConfirm={handleConfirm}
        onCancel={() => setPendingAction(null)}
      />

      <MobileBottomNav />
    </div>
  );
}