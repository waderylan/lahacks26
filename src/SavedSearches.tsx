import { useRef, useState } from 'react';
import type { NewSearchMatch, SavedSearch, SearchDefinition } from './savedSearchTypes';
import { useSavedSearches } from './useSavedSearches';
import { NewSearchMatches, SavedSearchLibrary, SearchMonitorControls } from './SavedSearchLibrary';
import './savedSearches.css';

export function SavedSearches({ companyId, companyName, definition, onOpen, onInspect }: { companyId: string; companyName: string; definition: SearchDefinition; onOpen: (definition: SearchDefinition) => void; onInspect: (id: string) => void }) {
  const c = useSavedSearches(companyId);
  const [selected, setSelected] = useState<SavedSearch>();
  const [editing, setEditing] = useState(false), [name, setName] = useState('');
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [library, setLibrary] = useState(false), [loadingNew, setLoadingNew] = useState(false);
  const [newResults, setNewResults] = useState<{ search: SavedSearch; matches: NewSearchMatch[]; changedSinceCheck: boolean }>();
  const newRequest = useRef(0);
  const liveSelected = c.searches.find(search => search.id === selected?.id);
  const totalNew = c.searches.reduce((total, search) => total + search.tracking.newMatches, 0);
  const changed = selected && JSON.stringify(selected.definition) !== JSON.stringify(definition);
  const open = (search: SavedSearch) => { setSelected(search); onOpen(structuredClone(search.definition)); setEditing(false); setError(''); setMessage(''); };
  const save = async (asNew = false) => {
    setError(''); setMessage('');
    try {
      const result = await c.save(name, definition, asNew ? undefined : selected);
      if (!result?.search) return;
      setSelected(result.search); setEditing(false); setMessage('Search saved.');
    } catch (error) { setError((error as Error).message); }
  };
  const remove = async () => {
    if (!selected) return;
    setError('');
    try { if (await c.remove(selected)) { setSelected(undefined); setEditing(false); setMessage('Saved search deleted.'); } }
    catch (error) { setError((error as Error).message); }
  };
  const reopen = async () => {
    const searches = await c.refresh();
    const latest = searches?.find(search => search.id === selected?.id);
    if (latest) open(latest);
    else if (searches) { setSelected(undefined); setEditing(false); setError('This saved search was deleted. Your current query and filters are still here.'); }
  };
  const acceptMonitor = (before: SavedSearch, next?: SavedSearch) => { if (next) setSelected(current => current?.id === before.id && current.revision === before.revision ? next : current); };
  const toggle = async (search: SavedSearch) => {
    setError('');
    try { const result = await c.toggle(search, !search.enabled); acceptMonitor(search, result?.search); }
    catch (error) { setError((error as Error).message); }
  };
  const check = async (search: SavedSearch) => {
    setError('');
    try { const result = await c.check(search); acceptMonitor(search, result?.search); }
    catch (error) { setError((error as Error).message); }
  };
  const viewNew = async (search: SavedSearch) => {
    const request = ++newRequest.current;
    setLibrary(true); setLoadingNew(true); setError(''); setNewResults(undefined);
    try { const result = await c.newMatches(search); if (result && request === newRequest.current) setNewResults({ search, ...result }); }
    catch (error) { if (request === newRequest.current) setError((error as Error).message); }
    finally { if (request === newRequest.current) setLoadingNew(false); }
  };
  const markSeen = async () => {
    if (!newResults) return;
    try { if (await c.seen(newResults.search, newResults.matches)) { setNewResults(undefined); setMessage('Matches marked as seen.'); } }
    catch (error) { setError((error as Error).message); }
  };
  const closeLibrary = () => { newRequest.current++; setLoadingNew(false); setLibrary(false); setNewResults(undefined); setError(''); };
  return <section className="saved-searches" aria-label="Search library">
    <div className="saved-search-row">
      <label>Saved searches<select aria-label="Saved searches" value={selected?.id ?? ''} disabled={!c.ready || c.busy} onChange={event => {
        const search = c.searches.find(search => search.id === event.target.value);
        if (search) open(search); else { setSelected(undefined); setMessage(''); setError(''); setEditing(false); }
      }}><option value="">{c.ready ? c.searches.length ? 'Choose a search' : 'No saved searches yet' : 'Loading…'}</option>{c.searches.map(search => <option key={search.id} value={search.id}>{search.name}</option>)}</select></label>
      <button disabled={!c.ready || c.busy} onClick={() => { setName(selected?.name ?? (definition.query.trim().slice(0, 80) || 'New search')); setEditing(true); setError(''); setMessage(''); }}>{selected ? changed ? 'Save changes' : 'Edit search' : 'Save search'}</button>
      <button disabled={!c.ready} onClick={() => { setLibrary(true); setError(''); }}>All saved searches{totalNew > 0 && <b className="search-new-count">{totalNew} new</b>}</button>
      {changed && <span className="saved-search-note">Unsaved changes</span>}
      {message && <span className="saved-search-note" role="status">{message}</span>}
    </div>
    {!library && liveSelected && <><SearchMonitorControls search={liveSelected} busy={c.busy} onToggle={search => { void toggle(search); }} onCheck={search => { void check(search); }} onNew={search => { void viewNew(search); }} /><p className="saved-search-note">{liveSelected.enabled ? 'On checks all new or changed company records every 10 seconds while the server runs.' : 'Off: use Check now to check manually.'}</p></>}
    {editing && <form className="saved-search-editor" aria-label="Save search" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>Save this query and filters for {companyName}.</p>
      <label>Search name<input aria-label="Search name" value={name} maxLength={80} autoFocus onChange={event => setName(event.target.value)} /></label>
      <div className="saved-search-buttons"><button className="primary" disabled={c.busy || !name.trim()} type="submit">{c.busy ? 'Saving…' : selected ? 'Save changes' : 'Save search'}</button>
        {selected && <button disabled={c.busy || !name.trim()} type="button" onClick={() => { void save(true); }}>Save as new</button>}
        <button disabled={c.busy} className="ghost" type="button" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
        {selected && <button disabled={c.busy} className="ghost saved-search-delete" type="button" onClick={() => { void remove(); }}>Delete search</button>}
      </div>
    </form>}
    {!library && (error || c.error) && <p className="saved-search-error" role="alert">{error || c.error} {error && selected ? <button onClick={() => { void reopen(); }} disabled={c.busy}>Reopen saved search</button> : c.error && <button onClick={() => { void c.refresh(); }}>Retry</button>}</p>}
    {library && <SavedSearchLibrary companyName={companyName} searches={c.searches} busy={c.busy} onToggle={search => { void toggle(search); }} onCheck={search => { void check(search); }} onNew={search => { void viewNew(search); }} onClose={closeLibrary}
      onOpen={search => { closeLibrary(); open(search); }} onEdit={search => { closeLibrary(); open(search); setName(search.name); setEditing(true); }}>
      {error && <p className="saved-search-error" role="alert">{error}</p>}
      {loadingNew && <p role="status">Loading new matches…</p>}
      {newResults && <NewSearchMatches name={newResults.search.name} matches={newResults.matches} changedSinceCheck={newResults.changedSinceCheck} busy={c.busy} onSeen={() => { void markSeen(); }} onInspect={id => { closeLibrary(); onInspect(id); }} />}
    </SavedSearchLibrary>}
  </section>;
}
