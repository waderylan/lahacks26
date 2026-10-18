import type { ActivityEvent } from './activity';

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One list for every kind of activity. Undo is offered only where the source allows it. */
export function ActivityList({ events, onInspect, onUndo, busy, limit = 50, empty }: {
  events: ActivityEvent[]; onInspect?: (transactionId: string) => void; onUndo: (event: ActivityEvent) => void; busy: boolean; limit?: number; empty: string;
}) {
  if (!events.length) return <p className="dashboard-empty">{empty}</p>;
  return <>
    <ul className="activity-list">{events.slice(0, limit).map(event => <li key={event.id} data-event-id={event.id} className={`tone-${event.tone}`}>
      <span className="activity-dot" aria-hidden="true" />
      <div>
        <b>{event.label}</b>
        {event.detail && <p className="small muted">{event.detail}</p>}
        <span className="small muted">{when(event.at)}{onInspect && event.transactionIds.length > 0 && <> · {event.transactionIds.slice(0, 3).map(id => <button key={id} className="bill-inspect" onClick={() => onInspect(id)}>{id.split(':').pop()}</button>)}{event.transactionIds.length > 3 && ` +${event.transactionIds.length - 3} more`}</>}</span>
      </div>
      {event.undo && <button disabled={busy} onClick={() => onUndo(event)}>Undo</button>}
    </li>)}</ul>
    {events.length > limit && <p className="small muted">Showing the latest {limit} of {events.length}.</p>}
  </>;
}
