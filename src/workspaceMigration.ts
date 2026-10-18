// Read old browser data once per company/session, only to import it into SQLite.
// All normal reads and writes use the server; no app state is written here.
const imports = new Map<string, Promise<void>>();
export function importBrowserWorkspace(companyId: string): Promise<void> {
  if (imports.has(companyId)) return imports.get(companyId)!;
  const work = (async () => {
    let raw: string | null, reviewed: string | null;
    try { raw = localStorage.getItem('tr.rules.v1'); reviewed = localStorage.getItem('tr.reviewed.v1'); }
    catch { return; } // Browser storage can be disabled entirely.
    if (!raw && !reviewed) return;
    const response = await fetch(`/api/companies/${companyId}/rules/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: raw ? JSON.parse(raw) : { rules: [] }, reviewed: reviewed ? JSON.parse(reviewed) : [] }) });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Could not migrate the old browser workspace.'); }
  })();
  imports.set(companyId, work);
  void work.catch(() => imports.delete(companyId));
  return work;
}
