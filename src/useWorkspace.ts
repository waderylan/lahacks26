import { useCallback, useEffect, useRef, useState } from 'react';
import type { Row } from './types';
import type { AccountOption, ActionState, ReviewTask } from './actionTypes';
import { usePolling } from './usePolling';

export type RowPatch = Pick<Row, 'id' | 'companyId'> & Partial<Row>;
type State = Pick<ActionState, 'tasks' | 'runs'> & { accounts: AccountOption[]; owners: string[] };
const empty = (): State => ({ tasks: [], runs: [], accounts: [], owners: [] });
/** `pollMs` is how often tasks and receipts are re-read while the tab is visible; 0 pauses polling. */
export function useWorkspace(companyId: string, onRows: (rows: RowPatch[]) => void, pollMs = 10_000) {
  const [state, setState] = useState<State>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(companyId); current.current = companyId;
  const rowCallback = useRef(onRows); rowCallback.current = onRows;
  const sequence = useRef(0);
  // Set when the background poll fails, so the next successful poll can clear that error (and only that one).
  const pollFailed = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const response = await fetch(`/api/companies/${companyId}/workspace`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not load dashboard actions.');
    if (current.current === companyId && request === sequence.current) {
      setState(body); rowCallback.current(body.rows ?? []);
      if (pollFailed.current) { pollFailed.current = false; setError(''); }
    }
  }, [companyId]);
  const poll = useCallback(() => refresh().catch(error => { if (current.current === companyId) { pollFailed.current = true; setError(error.message); } }), [companyId, refresh]);
  useEffect(() => {
    setState(empty()); setError(''); setBusy(false); pollFailed.current = false;
    void poll();
    return () => { sequence.current++; };
  }, [companyId, refresh, poll]);
  usePolling(() => void poll(), pollMs);
  const request = async <T,>(path: string, body: unknown, method = 'POST'): Promise<T> => {
    if (busy) throw new Error('Wait for the current action to finish.');
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/companies/${companyId}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not complete the action.');
      if (current.current !== companyId) throw new Error('Company changed. The action receipt is available in its original company.');
      if (result.state) setState(previous => ({ ...previous, ...result.state }));
      if (result.rows) rowCallback.current(result.rows);
      // The action already succeeded; a failed follow-up refresh is left to the next poll.
      await refresh().catch(() => {});
      return result;
    } catch (error) { if (current.current === companyId) setError((error as Error).message); throw error; }
    finally { if (current.current === companyId) setBusy(false); }
  };
  return {
    ...state, busy, error, clearError: () => setError(''), refresh,
    undo: (planId: string, billId: string) => request(`/actions/${planId}/undo`, { billId }),
    /** Manual human review of explicit records. Separate from task status and rule results. */
    review: (ids: string[], reviewed: boolean, expectedVersions?: Record<string, string>) => request('/actions/review', { ids, reviewed, expectedVersions }),
    updateTask: (task: ReviewTask, status: ReviewTask['status']) => request(`/tasks/${task.id}`, { status, updatedAt: task.updatedAt }, 'PATCH'),
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
