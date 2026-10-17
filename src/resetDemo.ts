import { resetCompanyDemo } from './rules';
import { readRuleStore } from './useRules';

// A reset URL runs inside the user's actual browser profile, where demo state lives.
export function applyDemoResetFromUrl() {
  const url = new URL(window.location.href);
  const companyId = url.searchParams.get('resetDemo');
  if (!companyId || !/^company-\d{3}$/.test(companyId)) return;
  const store = resetCompanyDemo(readRuleStore(), companyId);
  const reviewed: string[] = JSON.parse(localStorage.getItem('tr.reviewed.v1') ?? '[]');
  localStorage.setItem('tr.rules.v1', JSON.stringify(store));
  localStorage.setItem('tr.reviewed.v1', JSON.stringify(reviewed.filter(id => !id.startsWith(`${companyId}:`))));
  const receipt = {
    companyId, token: url.searchParams.get('resetToken'), timestamp: new Date().toISOString(),
    actions: Object.keys(store.transactions).filter(id => id.startsWith(`${companyId}:`)).length,
    history: store.history.filter(entry => entry.companyId === companyId).length,
    arrivals: store.arrivals[companyId].length,
    enabledRules: store.rules.filter(rule => rule.companyId === companyId && rule.enabled).length,
    humanReviewed: JSON.parse(localStorage.getItem('tr.reviewed.v1') ?? '[]').filter((id: string) => id.startsWith(`${companyId}:`)).length,
  };
  localStorage.setItem('tr.demo-reset.receipt.v1', JSON.stringify(receipt));
  url.searchParams.delete('resetDemo'); url.searchParams.delete('resetToken');
  window.history.replaceState(null, '', url);
  void fetch('/api/demo-reset/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(receipt) }).catch(() => {});
}

// Refresh other open app tabs after the reset so stale in-memory state cannot return.
window.addEventListener('storage', event => {
  if (event.key === 'tr.demo-reset.receipt.v1' && event.newValue) window.location.reload();
});
