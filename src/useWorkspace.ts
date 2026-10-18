import { useCallback, useEffect, useRef, useState } from 'react';
import type { Row } from './types';
import type { AccountOption, ActionPlan, ActionSelection, ActionState, BillAction, ReviewTask } from './actionTypes';

export type RowPatch = Pick<Row, 'id' | 'companyId'> & Partial<Row>;
type State = ActionState & { accounts: AccountOption[]; owners: string[] };
const empty = (): State => ({ tasks: [], runs: [], automations: [], accounts: [], owners: [] });
export function useWorkspace(companyId: string, onRows: (rows: RowPatch[]) => void) {
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
  useEffect(() => {
    setState(empty()); setError(''); setBusy(false); pollFailed.current = false;
    const poll = () => refresh().catch(error => { if (current.current === companyId) { pollFailed.current = true; setError(error.message); } });
    void poll();
    const timer = setInterval(() => void poll(), 10_000);
    return () => { clearInterval(timer); sequence.current++; };
  }, [companyId, refresh]);
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
    preview: (selection: ActionSelection, action: BillAction) => request<ActionPlan>('/actions/preview', { selection, action }),
    apply: async (planId: string) => (await request<{ plan: ActionPlan }>(`/actions/${planId}/apply`, {})).plan,
    undo: (planId: string, billId: string) => request(`/actions/${planId}/undo`, { billId }),
    review: (ids: string[], reviewed: boolean) => request('/actions/review', { ids, reviewed }),
    updateTask: (task: ReviewTask, status: ReviewTask['status']) => request(`/tasks/${task.id}`, { status, updatedAt: task.updatedAt }, 'PATCH'),
    automate: (selection: ActionSelection, action: BillAction) => request('/automations', { selection, action }),
    pause: (id: string) => request(`/automations/${id}/pause`, {}),
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
