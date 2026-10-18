// The URL restores one company's shared database state, regardless of browser: ?resetDemo=company-101
export async function applyDemoResetFromUrl() {
  const url = new URL(window.location.href), companyId = url.searchParams.get('resetDemo');
  if (!companyId || !/^company-\d{3}$/.test(companyId)) return;
  const response = await fetch(`/api/companies/${companyId}/rules/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'reset', full: true }) });
  if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? 'Could not restore the company.'); }
  url.searchParams.delete('resetDemo'); url.searchParams.delete('resetToken');
  window.history.replaceState(null, '', url);
}
