import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompanyBills } from './types';

export function useFullRecords(companyId: string) {
  const [data, setData] = useState<CompanyBills | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current; setBusy(true);
    try {
      const response = await fetch(`/api/companies/${companyId}/bills?limit=0`), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load transactions.');
      if (seq === sequence.current) { setData(body); setError(''); }
    } catch (error) { if (seq === sequence.current) setError((error as Error).message); }
    finally { if (seq === sequence.current) setBusy(false); }
  }, [companyId]);
  useEffect(() => {
    setData(null); void refresh();
    const update = () => { void refresh(); };
    window.addEventListener('focus', update); window.addEventListener('workspace-changed', update);
    return () => { sequence.current++; window.removeEventListener('focus', update); window.removeEventListener('workspace-changed', update); };
  }, [refresh]);
  return { data: data?.company.companyId === companyId ? data : null, error, busy, refresh };
}
