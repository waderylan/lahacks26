// Static builds (GitHub Pages) send `/api` calls through the hosted API's tunnel; local dev leaves fetch alone.
// Vercel spreads requests across instances with separate databases, so this tab holds the latest state and hands it
// to any instance that is behind (server/vercel.ts). sessionStorage only keeps it across reloads of the hosted demo.
const base = import.meta.env.VITE_API_BASE?.replace(/\/$/, '');

interface Envelope { stale?: true; status: number; contentType?: string; body: string; version: number; state?: string }
const KEY = 'hosted-demo-state';

if (base) {
  let saved: { version: number; state?: string } = { version: 0 };
  try { saved = JSON.parse(sessionStorage.getItem(KEY) ?? '') ?? saved; } catch { /* first visit or storage blocked */ }
  const original = window.fetch.bind(window);
  const send = (path: string, init: RequestInit | undefined, withState: boolean) => original(`${base}/api/_tunnel`, {
    method: 'POST', signal: init?.signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, method: init?.method ?? 'GET', contentType: new Headers(init?.headers).get('content-type') ?? undefined,
      body: typeof init?.body === 'string' ? init.body : undefined, version: saved.version, ...(withState && { state: saved.state }) }),
  });
  window.fetch = async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api')) return original(input, init);
    let response = await send(input, init, false);
    if (!response.ok) return response;
    let envelope = await response.json() as Envelope;
    if (envelope.stale) {
      response = await send(input, init, true);
      if (!response.ok) return response;
      envelope = await response.json() as Envelope;
    }
    if (envelope.state && envelope.version > saved.version) {
      saved = { version: envelope.version, state: envelope.state };
      try { sessionStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage full or blocked; memory copy still works */ }
    }
    const empty = [101, 204, 205, 304].includes(envelope.status);
    return new Response(empty ? null : envelope.body, { status: envelope.status, headers: envelope.contentType ? { 'content-type': envelope.contentType } : {} });
  };
}
