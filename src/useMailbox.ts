import { useCallback, useEffect, useRef, useState } from 'react';
import type { MailboxView, MailInput } from './mailTypes';

const EMPTY: MailboxView = { inbox: [], sent: [], unread: {} };

/** The signed-in employee's mail for one company. Polls like useRules so other tabs' sends show up. */
export function useMailbox(companyId: string, as: string) {
  const [view, setView] = useState<MailboxView>(EMPTY);
  const [error, setError] = useState('');
  const scope = useRef(''); scope.current = `${companyId}|${as}`;
  const accept = useCallback((key: string, next: MailboxView) => {
    if (scope.current !== key) return;
    setView(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); setError('');
  }, []);
  const call = useCallback(async (path: string, init?: RequestInit) => {
    const key = `${companyId}|${as}`;
    const response = await fetch(`/api/companies/${companyId}/mail${path}`, init);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not load messages.');
    accept(key, body);
  }, [companyId, as, accept]);
  const refresh = useCallback(() => call(`?as=${encodeURIComponent(as)}`).catch(e => setError((e as Error).message)), [call, as]);
  useEffect(() => {
    setView(EMPTY);
    if (!companyId || !as) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [companyId, as, refresh]);
  const post = (path: string, body: unknown) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    ...view, error, refresh,
    /** Throws so the composer can keep the draft on failure. */
    send: (input: Omit<MailInput, 'from'>) => post('', { ...input, from: as }),
    markRead: (id: string) => post(`/${encodeURIComponent(id)}/read`, { as }).catch(e => setError((e as Error).message)),
  };
}
export type MailboxController = ReturnType<typeof useMailbox>;
