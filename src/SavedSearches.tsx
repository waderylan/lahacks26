import { useState } from 'react';
import type { SavedSearch, SearchDefinition } from './savedSearchTypes';
import { useSavedSearches } from './useSavedSearches';
import './savedSearches.css';

export function SavedSearches({ companyId, companyName, definition, onOpen }: { companyId: string; companyName: string; definition: SearchDefinition; onOpen: (definition: SearchDefinition) => void }) {
  const c = useSavedSearches(companyId);
  const [selected, setSelected] = useState<SavedSearch>();
  const [editing, setEditing] = useState(false), [name, setName] = useState('');
  const [message, setMessage] = useState(''), [error, setError] = useState('');
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
  return <section className="saved-searches" aria-label="Search library">
    <div className="saved-search-row">
      <label>Saved searches<select aria-label="Saved searches" value={selected?.id ?? ''} disabled={!c.ready || c.busy} onChange={event => {
        const search = c.searches.find(search => search.id === event.target.value);
        if (search) open(search); else { setSelected(undefined); setMessage(''); setError(''); setEditing(false); }
      }}><option value="">{c.ready ? c.searches.length ? 'Choose a search' : 'No saved searches yet' : 'Loading…'}</option>{c.searches.map(search => <option key={search.id} value={search.id}>{search.name}</option>)}</select></label>
      <button disabled={!c.ready || c.busy} onClick={() => { setName(selected?.name ?? (definition.query.trim().slice(0, 80) || 'New search')); setEditing(true); setError(''); setMessage(''); }}>{selected ? changed ? 'Save changes' : 'Edit search' : 'Save search'}</button>
      {changed && <span className="saved-search-note">Unsaved changes</span>}
      {message && <span className="saved-search-note" role="status">{message}</span>}
    </div>
    {editing && <form className="saved-search-editor" aria-label="Save search" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>Save this query and filters for {companyName}.</p>
      <label>Search name<input aria-label="Search name" value={name} maxLength={80} autoFocus onChange={event => setName(event.target.value)} /></label>
      <div className="saved-search-buttons"><button className="primary" disabled={c.busy || !name.trim()} type="submit">{c.busy ? 'Saving…' : selected ? 'Save changes' : 'Save search'}</button>
        {selected && <button disabled={c.busy || !name.trim()} type="button" onClick={() => { void save(true); }}>Save as new</button>}
        <button disabled={c.busy} className="ghost" type="button" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
        {selected && <button disabled={c.busy} className="ghost saved-search-delete" type="button" onClick={() => { void remove(); }}>Delete search</button>}
      </div>
    </form>}
    {(error || c.error) && <p className="saved-search-error" role="alert">{error || c.error} {error && selected ? <button onClick={() => { void reopen(); }} disabled={c.busy}>Reopen saved search</button> : c.error && <button onClick={() => { void c.refresh(); }}>Retry</button>}</p>}
  </section>;
}
