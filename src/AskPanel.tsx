import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { pMatchFor } from './jevClient';
import { EMPLOYEES, employeeById } from './employees';
import { draftSender, uid, type DraftMessage } from './rules';
import type { ActionPlan, BillAction, ReviewTask } from './actionTypes';
import type { Mail } from './mailTypes';
import { CHAT_MODELS, combineUnderstanding, modelLabel, runSemanticGemini, type ChatModel, groupTotals, money, monthLabel, openCents, parseQuestion, runSemantic, spend, suggestQuestions, sumCents, upcomingPayables, useFullBills, type Intent, type ParsedQuestion, type SemanticRun, type Understanding } from './insights';
import type { CompanyBills, Row } from './types';

/** What the signed-in employee has waiting, read fresh from SQLite when they ask. */
interface Plate { tasks: ReviewTask[]; assignedIds: string[]; unread: Pick<Mail, 'id' | 'from' | 'subject' | 'sentAt'>[]; approvals: number }

/** reading: the model's understanding of the question; 'choose' while waiting for the user to pick a model, 'pending' while it reads, 'rules' when the text-rule fallback was used. */
interface Turn { id: string; model: ChatModel; createdAt: string; question: string; parsed: ParsedQuestion; scope: Row[]; run: SemanticRun | null; reading: Understanding | 'choose' | 'pending' | 'rules'; plate?: Plate | 'loading' | { error: string } }

/** Compact form saved in SQLite; rebuilt into a Turn against the company's current bills. */
interface StoredTurn {
  id: string; as: string; createdAt: string; question: string;
  intent: Intent; topic: string; criterion: string | null; periodLabel: string | null;
  scopeIds: string[]; outcomes: Record<string, 'true' | 'uncertain'>; costNano: string; ms: number;
  reading: Understanding | 'rules'; plate?: Plate;
  model?: ChatModel; tokens?: number;
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, { ...init, ...(init?.json !== undefined && { body: JSON.stringify(init.json), headers: { 'content-type': 'application/json' } }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
const understand = (question: string, model: ChatModel) => api<Understanding>('/api/understand', { method: 'POST', json: { question, model }, signal: AbortSignal.timeout(model === 'jev' ? 15000 : 90000) });

// Chosen model, remembered per browser. Jev uses the AI Gateway key; Gemini models use GEMINI_API_KEY.
const MODEL_KEY = 'chat.model.v1';
let currentModel: ChatModel = (() => { try { const m = localStorage.getItem(MODEL_KEY); return CHAT_MODELS.some(x => x.id === m) ? m as ChatModel : 'jev'; } catch { return 'jev'; } })();
const modelListeners = new Set<() => void>();
function setModel(m: ChatModel) { currentModel = m; try { localStorage.setItem(MODEL_KEY, m); } catch {} modelListeners.forEach(l => l()); }
// Unless the user ticks "use this for the rest of the chat", every question asks which model should answer.
const REMEMBER_KEY = 'chat.model.remember.v1';
let rememberModel = (() => { try { return localStorage.getItem(REMEMBER_KEY) === '1'; } catch { return false; } })();
function setRemember(on: boolean) { rememberModel = on; try { localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'); } catch {} modelListeners.forEach(l => l()); }
function useRemember() { return useSyncExternalStore(cb => { modelListeners.add(cb); return () => modelListeners.delete(cb); }, () => rememberModel); }
function useModel() { return useSyncExternalStore(cb => { modelListeners.add(cb); return () => modelListeners.delete(cb); }, () => currentModel); }
let availability: Promise<{ jev: boolean; gemini: boolean }> | null = null;
function useAvailability() {
  const [a, setA] = useState<{ jev: boolean; gemini: boolean } | null>(null);
  useEffect(() => { (availability ??= api<{ jev: boolean; gemini: boolean }>('/api/chat/models').catch(() => ({ jev: false, gemini: false }))).then(setA); }, []);
  return a;
}

// One conversation per company and employee, shared by the Ask tab and the floating widget, saved in SQLite.
const conversations = new Map<string, Turn[]>();
const loaded = new Set<string>();
const listeners = new Set<() => void>();
const EMPTY: Turn[] = [];
function setTurns(key: string, update: (turns: Turn[]) => Turn[]) {
  conversations.set(key, update(conversations.get(key) ?? EMPTY));
  listeners.forEach(l => l());
}
function useTurns(key: string) {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => conversations.get(key) ?? EMPTY);
}

function toStored(turn: Turn, as: string): StoredTurn {
  const outcomes: StoredTurn['outcomes'] = {};
  for (const [id, o] of Object.entries(turn.run?.outcomes ?? {})) if (o === 'true' || o === 'uncertain') outcomes[id] = o;
  return {
    id: turn.id, as, createdAt: turn.createdAt, question: turn.question, intent: turn.parsed.intent, topic: turn.parsed.topic,
    criterion: turn.parsed.criterion, periodLabel: turn.parsed.period?.label ?? null, scopeIds: turn.scope.map(r => r.id), outcomes,
    costNano: String(turn.run?.costNano ?? 0n), ms: turn.run && turn.run.finishedAt !== null ? Math.round(turn.run.finishedAt - turn.run.startedAt) : 0,
    model: turn.model, tokens: turn.run?.tokens,
    reading: turn.reading === 'pending' || turn.reading === 'choose' ? 'rules' : turn.reading, ...(turn.plate && typeof turn.plate === 'object' && 'tasks' in turn.plate && { plate: turn.plate }),
  };
}
function fromStored(s: StoredTurn, rows: Row[]): Turn {
  const byId = new Map(rows.map(r => [r.id, r]));
  const scope = s.scopeIds.map(id => byId.get(id)).filter((r): r is Row => !!r);
  return {
    id: s.id, model: s.model ?? 'jev', createdAt: s.createdAt, question: s.question, reading: s.reading, plate: s.plate,
    parsed: { intent: s.intent, topic: s.topic, criterion: s.criterion, period: s.periodLabel ? { label: s.periodLabel, test: () => true } : null },
    scope,
    run: s.criterion ? { outcomes: s.outcomes, done: scope.length, total: scope.length, costNano: BigInt(s.costNano), startedAt: 0, finishedAt: s.ms, error: null, tokens: s.tokens } : null,
  };
}
const save = (companyId: string, as: string, turn: Turn) => void api(`/api/companies/${companyId}/chat`, { method: 'POST', json: toStored(turn, as) }).catch(() => {});

function BillList({ rows, onOpen, amount }: { rows: Row[]; onOpen: (row: Row) => void; amount?: (r: Row) => number }) {
  return (
    <div className="bill-list">
      {rows.map(r => (
        <button key={r.id} className="bill" onClick={() => onOpen(r)}>
          <span className="bill-date">{r.date.slice(5)}</span>
          <span className="bill-main"><b>{r.vendor}</b><small>{r.description || r.itemNames.join(', ') || '(blank description)'}</small></span>
          <span className="bill-amt">{money(amount ? amount(r) : r.amountCents)}</span>
        </button>
      ))}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const firstName = (id: string) => employeeById(id)?.name.split(' ')[0] ?? id;
/** Team task owners are free text; match the employee's full name, first name or id. */
const isOwner = (owner: string | undefined, as: string) => {
  const e = employeeById(as); const o = (owner ?? '').trim().toLowerCase();
  return !!e && !!o && (o === e.name.toLowerCase() || o === e.name.split(' ')[0].toLowerCase() || o === e.id);
};

interface ChatProps { companyId: string; as: string; jevReady: boolean; onOpenBill: (row: Row) => void; onChanged?: () => void; /** Sit above a bottom action bar. */ lifted?: boolean }

/** Floating "Ask your books" assistant in the bottom-right corner, on every tab. */
export function ChatWidget(props: ChatProps) {
  const [open, setOpen] = useState(false);
  const { data } = useFullBills(props.companyId);
  const key = `${props.companyId}|${props.as}`;
  const turns = useTurns(key);
  const clear = () => { setTurns(key, () => EMPTY); void api(`/api/companies/${props.companyId}/chat?as=${encodeURIComponent(props.as)}`, { method: 'DELETE' }).catch(() => {}); };
  return (
    <>
      {open && (
        <div className={`chat-pop ${props.lifted ? 'lifted' : ''}`} role="dialog" aria-label="Ask your books">
          <div className="chat-pop-head">
            <span className="bot-avatar">✦</span>
            <div><b>Ask your books</b><small>{data?.company.name ?? 'Loading…'} · as {firstName(props.as)}</small></div>
            <span className="spacer" />
            <HeaderModel />
            {turns.length > 0 && <button className="icon-btn" title="Clear conversation" onClick={clear}>↺</button>}
            <button className="icon-btn" aria-label="Close chat" onClick={() => setOpen(false)}>✕</button>
          </div>
          {data ? <Chat {...props} data={data} compact /> : <div className="state"><span className="spinner" /></div>}
        </div>
      )}
      <button className={`chat-fab ${open ? 'open' : ''} ${props.lifted ? 'lifted' : ''}`} onClick={() => setOpen(o => !o)} aria-label={open ? 'Close chat' : 'Ask your books'}>
        {open ? '✕' : <><span className="fab-icon">✦</span><span className="fab-label">Ask your books</span></>}
      </button>
    </>
  );
}

async function loadPlate(companyId: string, as: string): Promise<Plate> {
  const [ws, mail, rules] = await Promise.all([
    api<{ tasks: ReviewTask[]; rows: { id: string; dashboard?: Row['dashboard'] }[] }>(`/api/companies/${companyId}/workspace`),
    api<{ inbox: Mail[] }>(`/api/companies/${companyId}/mail?as=${encodeURIComponent(as)}`),
    api<{ store?: { messages?: DraftMessage[] } }>(`/api/companies/${companyId}/rules`).catch(() => ({ store: { messages: [] } })),
  ]);
  return {
    tasks: ws.tasks.filter(t => t.status === 'open' && isOwner(t.owner, as)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    assignedIds: ws.rows.filter(r => isOwner(r.dashboard?.owner, as) && !r.dashboard?.reviewed).map(r => r.id),
    unread: mail.inbox.filter(m => !m.readAt).map(({ id, from, subject, sentAt }) => ({ id, from, subject, sentAt })),
    approvals: (rules.store?.messages ?? []).filter(m => draftSender(m) === as && m.status === 'pending').length,
  };
}

/** When a model is remembered, the header shows it and lets the user change it or go back to being asked. */
function HeaderModel() {
  const remember = useRemember();
  if (!remember) return null;
  return <><ModelPicker /><button className="icon-btn" title="Ask me which model for every question" onClick={() => setRemember(false)}>?</button></>;
}

function ModelPicker() {
  const model = useModel();
  const avail = useAvailability();
  return (
    <label className="model-pick" title="Jev uses the AI Gateway key; Gemini models use the Gemini key">
      <span className="sr-only">Model</span>
      <select aria-label="Model" value={model} onChange={e => setModel(e.target.value as ChatModel)}>
        {CHAT_MODELS.map(m => <option key={m.id} value={m.id} disabled={!!avail && (m.id === 'jev' ? !avail.jev : !avail.gemini)}>{m.label} · {m.note}</option>)}
      </select>
    </label>
  );
}

function Chat({ data, companyId, as, jevReady, onOpenBill, onChanged, compact }: ChatProps & { data: CompanyBills; compact?: boolean }) {
  const model = useModel();
  const avail = useAvailability();
  const readyFor = (m: ChatModel) => (m === 'jev' ? jevReady : !!avail?.gemini);
  const key = `${companyId}|${as}`;
  const turns = useTurns(key);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const latest = data.rows.reduce((m, r) => (r.date > m ? r.date : m), '');
  const suggestions = useMemo(() => suggestQuestions(data.rows), [data.rows]);
  const lastRun = turns[turns.length - 1]?.run;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns.length, lastRun?.finishedAt]);
  useEffect(() => {
    if (loaded.has(key)) return;
    loaded.add(key);
    api<StoredTurn[]>(`/api/companies/${companyId}/chat?as=${encodeURIComponent(as)}`)
      .then(saved => setTurns(key, current => [...saved.filter(s => !current.some(t => t.id === s.id)).map(s => fromStored(s, data.rows)), ...current]))
      .catch(() => loaded.delete(key));
  }, [key, companyId, as, data.rows]);

  const remember = useRemember();
  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    setInput('');
    const turn: Turn = { id: uid(), model, createdAt: new Date().toISOString(), question: q, parsed: parseQuestion(q, latest), scope: [], run: null, reading: 'choose' };
    setTurns(key, t => [...t, turn]);
    // Ask which model should answer, unless the user chose to keep one for the rest of the chat.
    if (remember) answerWith(turn, model);
  };
  const choose = (turnId: string, m: ChatModel, keep: boolean) => {
    setModel(m);
    if (keep) setRemember(true);
    const turn = (conversations.get(key) ?? EMPTY).find(t => t.id === turnId);
    if (turn && turn.reading === 'choose') answerWith(turn, m);
  };
  const answerWith = (base: Turn, m: ChatModel) => {
    const q = base.question, id = base.id;
    const rules = parseQuestion(q, latest);
    const ready = readyFor(m);
    let turn: Turn = { ...base, model: m, parsed: rules, reading: ready ? 'pending' : 'rules' };
    const inScope = (p: ParsedQuestion) => (p.intent === 'my_work' || p.intent === 'upcoming' ? [] : p.period ? data.rows.filter(r => p.period!.test(r.date)) : data.rows);
    const patch = (fields: Partial<Turn>) => { turn = { ...turn, ...fields }; setTurns(key, ts => ts.map(t => (t.id === id ? turn : t))); };
    const start = (parsed: ParsedQuestion, reading: Turn['reading']) => {
      const scope = inScope(parsed);
      patch({ parsed, scope, reading });
      if (parsed.intent === 'my_work') {
        patch({ plate: 'loading' });
        loadPlate(companyId, as).then(plate => { patch({ plate }); save(companyId, as, turn); }, e => patch({ plate: { error: (e as Error).message } }));
      } else if (parsed.criterion && ready) {
        const onRun = (run: SemanticRun) => { patch({ run }); if (run.finishedAt !== null && !run.error) save(companyId, as, turn); };
        void (m === 'jev' ? runSemantic(data.company, scope, parsed.criterion, onRun) : runSemanticGemini(data.company, scope, parsed.criterion, m, onRun));
      } else save(companyId, as, turn);
    };
    setTurns(key, ts => ts.map(t => (t.id === id ? turn : t)));
    if (!ready) return start(rules, 'rules');
    // The chosen model reads the whole question first; if that call fails, the text rules answer instead.
    understand(q, m).then(u => start(combineUnderstanding(q, rules, u, latest), u), () => start(rules, 'rules'));
  };
  const busy = turns.some(t => (t.run && t.run.finishedAt === null) || t.reading === 'pending');

  return (
    <div className={`chat ${compact ? 'compact' : ''}`}>
      <div className="chat-log">
        {turns.length === 0 && (
          <div className="chat-empty">
            <div className="hero-orb">✦</div>
            <h2>Ask {data.company.name}'s books</h2>
            <p>Ask in plain English, {firstName(as)}. {modelLabel(model)} reads your question and all {data.rows.length} bills; every number is added up exactly from the bills it finds, and you can act on them right here.</p>
            <div className="suggest-grid">
              {suggestions.map(s => <button key={s} className="suggest" onClick={() => ask(s)}>{s}<span>→</span></button>)}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={t.id} className="turn">
            <div className="msg user">{t.question}</div>
            <div className="msg-row"><span className="bot-avatar sm">✦</span><Answer turn={t} data={data} as={as} jevReady={readyFor(t.model)} onChoose={choose} availability={avail} onOpenBill={onOpenBill} onAsk={ask} onChanged={onChanged} isLast={i === turns.length - 1} suggestions={suggestions} /></div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={e => { e.preventDefault(); ask(input); }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder={busy ? 'Working…' : `Ask about ${data.company.name}'s spending…`} maxLength={300} autoFocus />
        <button className="send" disabled={!input.trim()} aria-label="Send">↑</button>
      </form>
    </div>
  );
}

function Answer({ turn, data, as, jevReady, onChoose, availability, onOpenBill, onAsk, onChanged, isLast, suggestions }: { turn: Turn; data: CompanyBills; as: string; jevReady: boolean; onChoose: (turnId: string, model: ChatModel, keep: boolean) => void; availability: { jev: boolean; gemini: boolean } | null; onOpenBill: (row: Row) => void; onAsk: (q: string) => void; onChanged?: () => void; isLast: boolean; suggestions: string[] }) {
  const { parsed, scope, run, reading } = turn;
  const [now, setNow] = useState(performance.now());
  const [showAll, setShowAll] = useState(false);
  const running = !!run && run.finishedAt === null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  const followUps = suggestions.filter(s => s !== turn.question).slice(0, 3);
  const footer = <><HowTo turn={turn} secs={run ? ((run.finishedAt ?? now) - run.startedAt) / 1000 : 0} />{isLast && <FollowUps items={followUps} onAsk={onAsk} />}</>;
  if (reading === 'choose') return <ModelChoice turn={turn} availability={availability} onChoose={onChoose} />;
  if (reading === 'pending') return <div className="msg bot scanning"><div className="scan-line"><span className="dots"><i /><i /><i /></span> {modelLabel(turn.model)} is reading your question…</div></div>;
  if (parsed.intent === 'my_work') return <PlateAnswer turn={turn} data={data} as={as} onOpenBill={onOpenBill} footer={footer} />;
  if (parsed.intent === 'upcoming') return <UpcomingAnswer data={data} as={as} model={turn.model} question={turn.question} onOpenBill={onOpenBill} onChanged={onChanged} footer={footer} />;

  const periodText = parsed.period ? ` in ${parsed.period.label}` : ' this year';
  if (parsed.criterion && !jevReady) return <div className="msg bot"><span className="err">{turn.model === 'jev' ? 'Jev is not configured (AI_GATEWAY_API_KEY missing)' : `${modelLabel(turn.model)} needs GEMINI_API_KEY in .env`}, so I can't judge bills by meaning.</span></div>;
  if (!scope.length) return <div className="msg bot">There are no bills{periodText}.</div>;

  const matches = parsed.criterion ? scope.filter(r => run?.outcomes[r.id] === 'true') : scope;
  const unsure = parsed.criterion ? scope.filter(r => run?.outcomes[r.id] === 'uncertain') : [];
  const done = !parsed.criterion || (run !== null && run.finishedAt !== null);
  const cents = sumCents(matches);
  const secs = run ? ((run.finishedAt ?? now) - run.startedAt) / 1000 : 0;

  if (!done) {
    const pctDone = run ? run.done / Math.max(run.total, 1) : 0;
    return (
      <div className="msg bot scanning">
        <div className="scan-line"><span className="dots"><i /><i /><i /></span> Reading {run ? `${run.done} of ${run.total}` : scope.length} bills{periodText} against your question…</div>
        <div className="scan-bar"><span style={{ width: `${pctDone * 100}%` }} /></div>
        <div className="scan-meta">{matches.length} matches so far · {money(cents)} · {secs.toFixed(1)}s</div>
      </div>
    );
  }

  // A failed model call is not a "no": say the check didn't finish, and never present partial results as the answer.
  const failed = parsed.criterion ? scope.filter(r => run?.outcomes[r.id] === 'error') : [];
  if (failed.length) {
    return (
      <div className="msg bot">
        <p className="lead"><span className="err">{modelLabel(turn.model)} couldn't check {failed.length === scope.length ? 'any' : `${failed.length} of the ${scope.length}`} bills</span>, so I don't have a reliable answer yet.</p>
        <p className="muted small">{run?.error ? `${turn.model === 'jev' ? 'The AI Gateway' : 'Gemini'} returned: ${run.error}. ` : ''}This is usually temporary. Nothing was counted.</p>
        {matches.length > 0 && <p className="muted small">So far {plural(matches.length, 'bill')} ({money(cents)}) matched among the bills that were checked.</p>}
        <button className="primary" onClick={() => onAsk(turn.question)}>Try again</button>
        {footer}
      </div>
    );
  }

  // Nothing matched: say so plainly, then show the closest bills and what the company actually pays for.
  if (parsed.criterion && matches.length === 0) {
    const near = scope.map(r => ({ r, p: pMatchFor(r, parsed.criterion!) ?? 0 })).sort((a, b) => b.p - a.p).filter(x => x.p >= 0.3).slice(0, 3);
    const top = groupTotals(scope, r => r.account || '(none)').sort((a, b) => b.cents - a.cents).slice(0, 4);
    return (
      <div className="msg bot">
        <p className="lead">I checked all {plural(scope.length, 'bill')}{periodText}, and <b>none of them match your question</b>.</p>
        {unsure.length > 0 && <p className="muted small">◐ {plural(unsure.length, 'bill')} ({money(sumCents(unsure))}) {unsure.length === 1 ? 'was' : 'were'} too vague to decide.</p>}
        {near.length > 0 && <><div className="sub-h">Closest bills (not counted)</div><BillList rows={near.map(x => x.r)} onOpen={onOpenBill} /></>}
        <div className="sub-h">What {data.company.name} does pay for{periodText}</div>
        <div className="stat-chips">{top.map(t => <span key={t.label}><b>{t.label}</b>{money(t.cents)}</span>)}</div>
        {footer}
      </div>
    );
  }

  let headline: React.ReactNode;
  let detail: React.ReactNode = null;
  // Show the parsed topic only when it reads cleanly; otherwise refer back to the user's own question.
  const shortTopic = parsed.topic && parsed.topic !== 'your question' && parsed.topic.split(' ').length <= 3 ? parsed.topic : '';
  const topicLabel = shortTopic ? <> for <b>{shortTopic}</b></> : parsed.criterion ? ' matching your question' : null;
  if (parsed.intent === 'count') headline = <><span className="big">{matches.length}</span> {matches.length === 1 ? 'bill' : 'bills'}{topicLabel}{periodText}, totalling {money(cents)}.</>;
  else if (parsed.intent === 'vendors') {
    const vendors = groupTotals(matches, r => r.vendor).sort((a, b) => b.cents - a.cents);
    headline = <><span className="big">{vendors.length}</span> {vendors.length === 1 ? 'vendor' : 'vendors'}{topicLabel}{periodText}, {money(cents)} in total.</>;
    detail = <Breakdown items={vendors.slice(0, 8)} />;
  } else if (parsed.intent === 'months') {
    const months = groupTotals(matches, r => r.date.slice(0, 7)).sort((a, b) => (a.label < b.label ? -1 : 1)).map(m => ({ ...m, label: monthLabel(m.label) }));
    headline = <><span className="big">{money(cents)}</span>{topicLabel}{periodText}, across {plural(months.length, 'month')}.</>;
    detail = <MiniColumns items={months} />;
  } else if (parsed.intent === 'list') headline = <><span className="big">{matches.length}</span> matching {matches.length === 1 ? 'bill' : 'bills'}{periodText}, {money(cents)} in total.</>;
  else headline = <><span className="big">{money(cents)}</span>{shortTopic ? <> on <b>{shortTopic}</b></> : parsed.criterion ? ' matching your question' : ' in total'}{periodText}, across {plural(matches.length, 'bill')}.</>;

  const sorted = [...matches].sort((a, b) => b.amountCents - a.amountCents);
  return (
    <div className="msg bot">
      <p className="lead">{headline}</p>
      {detail}
      {unsure.length > 0 && <p className="muted small">◐ {plural(unsure.length, 'more bill')} ({money(sumCents(unsure))}) {unsure.length === 1 ? 'was' : 'were'} too vague to decide and {unsure.length === 1 ? 'is' : 'are'} not counted.</p>}
      {matches.length > 0 && (
        <>
          <div className="sub-h">Largest bills</div>
          <BillList rows={showAll ? sorted : sorted.slice(0, 4)} onOpen={onOpenBill} />
          {sorted.length > 4 && <button className="linkish" onClick={() => setShowAll(s => !s)}>{showAll ? 'Show fewer' : `Show all ${sorted.length}`}</button>}
          <ActOnBills companyId={data.company.companyId} as={as} model={turn.model} rows={matches} label={shortTopic || turn.question} onChanged={onChanged} />
        </>
      )}
      {footer}
    </div>
  );
}

function ModelChoice({ turn, availability, onChoose }: { turn: Turn; availability: { jev: boolean; gemini: boolean } | null; onChoose: (turnId: string, model: ChatModel, keep: boolean) => void }) {
  const [keep, setKeep] = useState(false);
  return (
    <div className="msg bot">
      <p>Which model should answer this?</p>
      <div className="model-choice">
        {CHAT_MODELS.map(m => {
          const off = !!availability && (m.id === 'jev' ? !availability.jev : !availability.gemini);
          return (
            <button key={m.id} className={m.id === turn.model ? 'primary' : ''} disabled={off} title={off ? (m.id === 'jev' ? 'AI_GATEWAY_API_KEY is not set' : 'GEMINI_API_KEY is not set') : undefined} onClick={() => onChoose(turn.id, m.id, keep)}>
              <b>{m.label}</b><small>{m.blurb}</small>
            </button>
          );
        })}
      </div>
      <label className="model-keep"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> Use this for the rest of the chat (don't ask again)</label>
    </div>
  );
}

function PlateAnswer({ turn, data, as, onOpenBill, footer }: { turn: Turn; data: CompanyBills; as: string; onOpenBill: (row: Row) => void; footer: React.ReactNode }) {
  const plate = turn.plate;
  if (!plate || plate === 'loading') return <div className="msg bot scanning"><div className="scan-line"><span className="dots"><i /><i /><i /></span> Checking your tasks, bills and inbox…</div></div>;
  if ('error' in plate) return <div className="msg bot"><span className="err">Couldn't load your work: {plate.error}</span></div>;
  const byId = new Map(data.rows.map(r => [r.id, r]));
  const assigned = plate.assignedIds.map(id => byId.get(id)).filter((r): r is Row => !!r);
  const nothing = !plate.tasks.length && !assigned.length && !plate.unread.length && !plate.approvals;
  return (
    <div className="msg bot">
      <p className="lead">{nothing ? <>Nothing is waiting for you, {firstName(as)}. 🎉</> : <>{firstName(as)}, you have <b>{plural(plate.tasks.length, 'open task')}</b>, <b>{plural(assigned.length, 'bill')}</b> assigned to you, <b>{plural(plate.unread.length, 'unread message')}</b> and <b>{plural(plate.approvals, 'draft')}</b> awaiting your approval.</>}</p>
      {plate.tasks.length > 0 && <><div className="sub-h">Open tasks</div><div className="bill-list">{plate.tasks.slice(0, 6).map(t => <button key={t.id} className="bill" onClick={() => { const r = byId.get(t.billId); if (r) onOpenBill(r); }}><span className="bill-date">{t.dueDate.slice(5)}</span><span className="bill-main"><b>{t.title}</b><small>{t.vendor}</small></span><span className="bill-amt">{byId.get(t.billId) ? money(byId.get(t.billId)!.amountCents) : ''}</span></button>)}</div></>}
      {assigned.length > 0 && <><div className="sub-h">Bills assigned to you, not yet reviewed</div><BillList rows={assigned.slice(0, 6)} onOpen={onOpenBill} /></>}
      {plate.unread.length > 0 && <><div className="sub-h">Unread messages (open the Messages tab)</div><div className="bill-list">{plate.unread.slice(0, 5).map(m => <div key={m.id} className="bill static"><span className="bill-date">{m.sentAt.slice(5, 10)}</span><span className="bill-main"><b>{m.subject}</b><small>from {employeeById(m.from)?.name ?? m.from}</small></span><span /></div>)}</div></>}
      {footer}
    </div>
  );
}

function UpcomingAnswer({ data, as, model, question, onOpenBill, onChanged, footer }: { data: CompanyBills; as: string; model: ChatModel; question: string; onOpenBill: (row: Row) => void; onChanged?: () => void; footer: React.ReactNode }) {
  const p = useMemo(() => upcomingPayables(data.rows), [data.rows]);
  const overdue = p.windows.find(w => w.id === 'overdue')!;
  return (
    <div className="msg bot">
      <p className="lead">{p.open.length ? <><span className="big">{money(p.total)}</span> is still open across {plural(p.open.length, 'bill')} as of {p.asOf}{overdue.bills.length ? <>, and <b>{money(overdue.cents)}</b> of it is overdue</> : ''}.</> : <>Every bill is paid as of {p.asOf}. 🎉</>}</p>
      {p.open.length > 0 && <>
        <Breakdown items={p.windows.filter(w => w.bills.length).map(w => ({ label: w.label, cents: w.cents, count: w.bills.length }))} />
        <div className="sub-h">Next due</div>
        <BillList rows={p.open.slice(0, 5)} onOpen={onOpenBill} amount={openCents} />
        <ActOnBills companyId={data.company.companyId} as={as} model={model} rows={p.open} label={question} onChanged={onChanged} />
      </>}
      {footer}
    </div>
  );
}

// ---------- #1 Take action on an answer's bills (team's action engine; previews before applying) ----------
type ActKind = 'task' | 'assign' | 'flag' | 'tag' | 'review' | 'message';
const ACT_LABELS: Record<ActKind, string> = { task: '✓ Create tasks', assign: '👤 Assign', flag: '⚑ Flag', tag: '# Tag', review: '✔ Mark reviewed', message: '✉ Message a teammate' };
const nextWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

function ActOnBills({ companyId, as, model, rows, label, onChanged }: { companyId: string; as: string; model: ChatModel; rows: Row[]; label: string; onChanged?: () => void }) {
  const ai = modelLabel(model);
  const [kind, setKind] = useState<ActKind | null>(null);
  const [owner, setOwner] = useState(as);
  /** Who Jev picked when the owner is "Let Jev choose", shown in the preview before anything is applied. */
  const [picked, setPicked] = useState<{ employeeId: string; probability: number } | null>(null);
  const [text, setText] = useState('');
  const [due, setDue] = useState(nextWeek);
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const ids = rows.slice(0, 1000).map(r => r.id);
  const choose = (k: ActKind) => {
    setKind(kind === k ? null : k); setPlan(null); setDone(''); setError('');
    setText(k === 'flag' ? 'Needs review' : k === 'tag' ? label.slice(0, 60) : k === 'task' ? `Review: ${label}`.slice(0, 200) : '');
    setOwner(k === 'message' || k === 'task' || k === 'assign' ? 'jev' : as); setPicked(null);
  };
  const nameOf = (id: string) => employeeById(id)?.name ?? id;
  const action = (ownerId = owner): BillAction => kind === 'task' ? { type: 'task', title: text, owner: nameOf(ownerId), dueDate: due } : kind === 'assign' ? { type: 'assign', owner: nameOf(ownerId) } : kind === 'review' ? { type: 'review', reviewed: true } : { type: kind as 'flag' | 'tag', label: text };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const preview = () => run(async () => {
    // "Let Jev choose" (tasks and assignments): Jev reads the bills, picks the owner, and the preview shows who before anything is saved.
    let ownerId = owner;
    if ((kind === 'task' || kind === 'assign') && owner === 'jev') {
      const request = kind === 'task' && text.trim() ? text.trim() : `Own and review these bills about: ${label}`;
      const choice = await api<{ employeeId: string; probability: number }>(`/api/companies/${companyId}/route`, { method: 'POST', json: { ids, request, model } });
      setPicked(choice); ownerId = choice.employeeId;
    } else setPicked(null);
    setPlan(await api<ActionPlan>(`/api/companies/${companyId}/actions/preview`, { method: 'POST', json: { selection: { ids, scope: 'selected' }, action: action(ownerId) } }));
  });
  const apply = () => run(async () => {
    const { plan: receipt } = await api<{ plan: ActionPlan }>(`/api/companies/${companyId}/actions/${plan!.id}/apply`, { method: 'POST', json: {} });
    setDone(`${receipt.items.filter(i => i.status === 'succeeded').length} ${receipt.action.type === 'task' ? `tasks created for ${receipt.action.owner}` : receipt.action.type === 'assign' ? `bills assigned to ${receipt.action.owner}` : 'bills updated'}. Undo any of them in Tasks & activity.`); setPlan(null); setKind(null); onChanged?.();
  });
  const send = () => run(async () => {
    const lines = rows.slice(0, 25).map(r => `- ${r.docNumber || r.billId} · ${r.vendor} · ${money(r.amountCents)} · ${r.date}`).join('\n');
    const request = text.trim() || `Please take a look at these bills about: ${label}`;
    const to = owner === 'jev' ? (await api<{ employeeId: string }>(`/api/companies/${companyId}/route`, { method: 'POST', json: { ids, request, model } })).employeeId : owner;
    await api(`/api/companies/${companyId}/mail`, { method: 'POST', json: { from: as, to, subject: `${rows.length} ${rows.length === 1 ? 'bill' : 'bills'}: ${label}`.slice(0, 200), body: `Hi ${firstName(to)},\n\n${request}\n\n${lines}${rows.length > 25 ? `\n…and ${rows.length - 25} more` : ''}\n\n${employeeById(as)?.name ?? ''}`, items: rows.slice(0, 25).map(r => ({ transactionId: r.id, billId: r.billId })) } });
    setDone(`Sent to ${employeeById(to)?.name ?? to}${owner === 'jev' ? ` (picked by ${ai})` : ''}. It's in their Messages inbox.`); setKind(null); onChanged?.();
  });
  const ready = plan ? plan.items.filter(i => i.status === 'ready').length : 0;
  return (
    <div className="act">
      <div className="act-head">Act on {plural(ids.length, 'bill')}</div>
      <div className="act-buttons">{(Object.keys(ACT_LABELS) as ActKind[]).map(k => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => choose(k)}>{ACT_LABELS[k]}</button>)}</div>
      {kind && (
        <div className="act-form">
          {(kind === 'task' || kind === 'assign' || kind === 'message') && <label>{kind === 'message' ? 'To' : 'Owner'}<select value={owner} onChange={e => { setOwner(e.target.value); setPlan(null); }}>{(kind === 'message' || kind === 'task' || kind === 'assign') && <option value="jev">✦ Let {ai} choose the right person</option>}{EMPLOYEES.map(e => <option key={e.id} value={e.id}>{e.name} · {e.title}</option>)}</select></label>}
          {(kind === 'task' || kind === 'flag' || kind === 'tag' || kind === 'message') && <label>{kind === 'task' ? 'Task' : kind === 'message' ? 'Your ask' : 'Label'}<input value={text} maxLength={kind === 'task' ? 200 : kind === 'message' ? 500 : 100} placeholder={kind === 'message' ? `Please take a look at these bills about: ${label}` : ''} onChange={e => { setText(e.target.value); setPlan(null); }} /></label>}
          {kind === 'task' && <label>Due<input type="date" value={due} onChange={e => { setDue(e.target.value); setPlan(null); }} /></label>}
          {kind === 'message'
            ? <button className="primary" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send message'}</button>
            : !plan ? <button className="primary" disabled={busy || ((kind === 'flag' || kind === 'tag' || kind === 'task') && !text.trim())} onClick={() => void preview()}>{busy ? 'Checking…' : 'Preview'}</button>
            : <div className="act-preview">{picked && <span>{ai} picked <b>{nameOf(picked.employeeId)}</b> ({employeeById(picked.employeeId)?.title}{Number.isFinite(picked.probability) ? `, ${Math.round(picked.probability * 100)}% sure` : ''}).</span>}<span>{ready} will change{plan.items.length - ready ? `, ${plan.items.length - ready} skipped (already set)` : ''}.</span><button className="primary" disabled={busy || !ready} onClick={() => void apply()}>{busy ? 'Applying…' : `Apply to ${ready}`}</button><button className="ghost" onClick={() => setPlan(null)}>Cancel</button></div>}
        </div>
      )}
      {done && <p className="act-done" role="status">✓ {done}</p>}
      {error && <p className="err small">{error}</p>}
    </div>
  );
}

const INTENT_TEXT: Record<Intent, string> = { total: 'a total', count: 'a count', vendors: 'a vendor breakdown', months: 'a monthly breakdown', list: 'a list of bills', my_work: 'your own work', upcoming: 'what is due' };
function HowTo({ turn: { model, parsed, scope, run, reading }, secs }: { turn: Turn; secs: number }) {
  const understood = typeof reading === 'object' ? reading : null;
  const ai = modelLabel(model);
  const gemini = model !== 'jev';
  const usage = gemini ? `${((run?.tokens ?? 0) + (understood?.tokens ?? 0)).toLocaleString()} tokens on the Gemini key` : spend((run?.costNano ?? 0n) + BigInt(understood?.costNanoUsd ?? '0'));
  const local = parsed.intent === 'my_work' || parsed.intent === 'upcoming';
  const sure = understood && Number.isFinite(understood.confidence.intent) ? ` (${Math.round(understood.confidence.intent * 100)}% sure)` : '';
  return (
    <details className="howto">
      <summary>⚡ {understood ? `${ai} read your question in ${(understood.ms / 1000).toFixed(2)}s` : 'Text rules read your question'}{run ? ` · then ${run.done}/${run.total} bills in ${secs.toFixed(1)}s` : local ? ' · answered from saved data' : ' · exact sum'} · {usage}</summary>
      <ul>
        <li>Model: {ai} ({gemini ? 'Gemini key' : 'AI Gateway key'}).</li>
        {understood
          ? <li>{ai} understood: you want {INTENT_TEXT[understood.intent]}{sure}{local ? '' : <>, about {understood.scope === 'specific' ? 'a specific kind of spending' : 'all spending'}, period “{understood.period.replace(/_/g, ' ')}”</>}.</li>
          : <li>{ai} wasn't used to read the question; the built-in text rules were.</li>}
        {parsed.intent === 'my_work' && <li>Read from the shared workspace: open tasks and unreviewed bills whose owner is you, your unread inbox, and rule drafts waiting for your approval.</li>}
        {parsed.intent === 'upcoming' && <li>Open balance = bill total minus payments applied, grouped by due date relative to the latest date in the books. No AI involved.</li>}
        {!local && <li>Period: {parsed.period ? `${parsed.period.label} (${scope.length} bills)` : `whole year (${scope.length} bills)`}, filtered by date, not AI.</li>}
        {!local && (parsed.criterion ? <li>{ai} then judged each bill against your question{understood ? ' itself' : <> as: <q>{parsed.criterion}</q></>}{gemini ? ', up to 100 bills per request' : ', one judgment per bill'}. Only definite matches count.</li> : <li>No topic, so every bill in the period counts.</li>)}
        {!local && <li>Totals are exact integer-cent sums of the bills listed.</li>}
        {run?.error && <li className="err">Some bills failed: {run.error}</li>}
      </ul>
    </details>
  );
}

function FollowUps({ items, onAsk }: { items: string[]; onAsk: (q: string) => void }) {
  return <div className="followups">{items.map(s => <button key={s} className="chip" onClick={() => onAsk(s)}>{s}</button>)}</div>;
}

function Breakdown({ items }: { items: { label: string; cents: number; count: number }[] }) {
  const max = Math.max(...items.map(i => i.cents), 1);
  return (
    <ul className="hbars compact">
      {items.map(i => (
        <li key={i.label} title={`${i.label}: ${money(i.cents)} · ${i.count} bills`}>
          <span className="hb-label">{i.label}</span>
          <span className="hb-track"><span className="hb-fill" style={{ width: `${(i.cents / max) * 100}%` }} /></span>
          <span className="hb-val">{money(i.cents)}</span>
        </li>
      ))}
    </ul>
  );
}

function MiniColumns({ items }: { items: { label: string; cents: number; count: number }[] }) {
  const max = Math.max(...items.map(i => i.cents), 1);
  return (
    <div className="mini-cols">
      {items.map(i => (
        <div key={i.label} className="mini-col" title={`${i.label}: ${money(i.cents)} · ${i.count} bills`}>
          <span className="mc-bar" style={{ height: `${Math.max(4, (i.cents / max) * 100)}%` }} />
          <small>{i.label.split(' ')[0]}</small>
        </div>
      ))}
    </div>
  );
}
