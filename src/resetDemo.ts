import { importBrowserWorkspace } from './workspaceMigration';

// The URL resets shared database state for this company, regardless of browser.
export async function applyDemoResetFromUrl() {
  const url = new URL(window.location.href), companyId = url.searchParams.get('resetDemo');
  if (!companyId || !/^company-\d{3}$/.test(companyId)) return;
  await importBrowserWorkspace(companyId);
  const response = await fetch(`/api/companies/${companyId}/rules/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'reset', full: true }) });
  if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Could not reset the workspace.'); }
  url.searchParams.delete('resetDemo'); url.searchParams.delete('resetToken');
  window.history.replaceState(null, '', url);
}
