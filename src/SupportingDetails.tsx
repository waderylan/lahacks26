import { useState } from 'react';
import type { Row } from './types';

export function SupportingDetails({ row, save, busy }: { row: Row; save: (row: Row, title: string, text: string) => Promise<boolean>; busy: boolean }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  return <section className="supporting-details" aria-label="Add supporting details"><h3>Add supporting details</h3>
    <p className="small muted">Add the receipt details, approval, or explanation needed to review this transaction. Enabled rules will check it again.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setSaved(false); setError('');
      try { if (await save(row, title, text)) { setTitle(''); setText(''); setSaved(true); } }
      catch (error) { setError((error as Error).message); }
    }}>
      <label className="wizard-field">Title<input aria-label="Supporting details title" value={title} onChange={event => { setSaved(false); setTitle(event.target.value); }} maxLength={160} required placeholder="For example: Receipt from October 1" /></label>
      <label className="wizard-field">Details<textarea aria-label="Supporting details text" value={text} onChange={event => { setSaved(false); setText(event.target.value); }} maxLength={8000} rows={4} required placeholder="Describe what was purchased and the records that support it." /></label>
      <button type="submit" disabled={busy || !title.trim() || !text.trim()}>{busy ? 'Saving...' : 'Save supporting details'}</button>
      {saved && <p className="small" role="status">Details saved. Enabled rules will check the updated transaction; you can also run the rule again.</p>}
      {error && <p className="wizard-validation" role="alert">{error}</p>}
    </form>
  </section>;
}
