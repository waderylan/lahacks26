// Static builds (GitHub Pages) point `/api` calls at the hosted API; local dev leaves fetch alone.
const base = import.meta.env.VITE_API_BASE?.replace(/\/$/, '');
if (base) {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => original(typeof input === 'string' && input.startsWith('/api') ? base + input : input, init);
}
