const handleLifecycle = async (action: LifecycleAction) => {
    setActionLoading(action);
    try {
      const response = await fetch(`/api/agents/${params.id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (response.ok) {
        const data = await response.json();
        setAgent(data.agent);
        fetchActivity();
        const label = action === 'activate' ? 'Agent activated' : action === 'pause' ? 'Agent paused' : 'Agent revoked';
        toast.success({
          title: label,
          description:
            action === 'activate'
              ? 'Your agent is now active and can execute within its session limits.'
              : action === 'pause'
                ? 'Your agent has been paused and will not execute new actions.'
                : 'Access has been permanently revoked.',
        });
      } else {
        const error = await response.json();
        toast.error({ title: 'Action failed', description: error.error || 'An unexpected error occurred.' });
      }
    } catch (error) {
      console.error('Lifecycle error:', error);
      toast.error({ title: 'Action failed', description: 'An unexpected error occurred.' });
    } finally {
      setActionLoading(null);
      setRevokeOpen(false);
    }
  };

  const handleRunCycle = async () => {
    setActionLoading('run');
    try {
      const response = await fetch(`/api/agents/${params.id}/run`, { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        const stage = data.result?.stage ?? 'unknown';
        const ok = !!data.ok;
        const messages: Record<string, string> = {
          observed: 'Observation complete (no action needed).',
          decided: 'Cycle complete — agent passed.',
          awaited: 'Agent is awaiting execution (ensure an ACTIVE session and funded wallet).',
          confirmed: 'Trade confirmed on-chain!',
        };
        if (ok) {
          toast.success({
            title: 'Cycle complete',
            description: messages[stage] || 'Closed-loop cycle finished.',
          });
        } else {
          toast.error({
            title: 'Cycle result',
            description: (data.result?.reason) || 'The cycle did not complete successfully.',
          });
        }
        fetchActivity();
        fetchPerformance();
        fetchSessions();
      } else {
        const error = await response.json();
        toast.error({ title: 'Run failed', description: error.error || 'An unexpected error occurred.' });
      }
    } catch (error) {
      console.error('Run cycle error:', error);
      toast.error({ title: 'Run failed', description: 'An unexpected error occurred.' });
    } finally {
      setActionLoading(null);
    }
  };