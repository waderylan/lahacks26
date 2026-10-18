import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { ActionStore } from './actionStore.ts';

/**
 * Hosted demo state that travels with the browser. Vercel spreads one user's requests across many instances, each
 * with its own /tmp SQLite, so the browser holds the latest user state and any instance that is behind loads it.
 * Semantic judgments are a cache and stay per-instance. Bills are sent only where they differ from the seed.
 */
interface Snapshot { documents: [string, string, string, string][]; bills: [string, string, string, number][] }

const CACHE_KINDS = "('semantic-judgment')";

export class HostedState {
  private baseline: Map<string, { body: string; revision: number }>;
  private baselineDocuments: Snapshot['documents'];
  private changes = -1;
  version = 0;
  private hash: string;

  constructor(private store: ActionStore) {
    const bills = store.db.prepare('SELECT company,id,body,revision FROM bills').all() as { company: string; id: string; body: string; revision: number }[];
    this.baseline = new Map(bills.map(row => [`${row.company}\n${row.id}`, { body: row.body, revision: row.revision }]));
    this.baselineDocuments = this.documents();
    this.hash = this.digest(this.snapshot());
  }

  private documents() {
    return (this.store.db.prepare(`SELECT kind,id,company,body FROM documents WHERE kind NOT IN ${CACHE_KINDS} ORDER BY kind,id`).all() as { kind: string; id: string; company: string; body: string }[])
      .map(row => [row.kind, row.id, row.company, row.body] as Snapshot['documents'][number]);
  }

  private snapshot(): Snapshot {
    const bills = (this.store.db.prepare('SELECT company,id,body,revision FROM bills ORDER BY company,id').all() as { company: string; id: string; body: string; revision: number }[])
      .filter(row => { const base = this.baseline.get(`${row.company}\n${row.id}`); return !base || base.body !== row.body || base.revision !== row.revision; })
      .map(row => [row.company, row.id, row.body, row.revision] as Snapshot['bills'][number]);
    return { documents: this.documents(), bills };
  }

  private digest(snapshot: Snapshot) { return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'); }

  /** Replace user state with the browser's copy (or the seed when it has none), keeping the semantic cache. */
  load(version: number, encoded?: string) {
    const snapshot: Snapshot = encoded ? JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')) : { documents: this.baselineDocuments, bills: [] };
    const target = new Map(snapshot.bills.map(([company, id, body, revision]) => [`${company}\n${id}`, { body, revision }]));
    const update = this.store.db.prepare('UPDATE bills SET body=?,revision=? WHERE company=? AND id=? AND (body!=? OR revision!=?)');
    const insert = this.store.db.prepare('INSERT INTO documents VALUES(?,?,?,?)');
    this.store.atomic(() => {
      for (const [key, base] of this.baseline) {
        const [company, id] = key.split('\n'), want = target.get(key) ?? base;
        update.run(want.body, want.revision, company, id, want.body, want.revision);
      }
      this.store.db.exec(`DELETE FROM documents WHERE kind NOT IN ${CACHE_KINDS}`);
      for (const document of snapshot.documents) insert.run(...document);
    });
    this.version = version;
    this.hash = this.digest(this.snapshot());
    this.changes = this.totalChanges();
  }

  private totalChanges() { return (this.store.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n; }

  /** If anything changed since the last check, bump the version and return the encoded state for the browser. */
  collect(seenVersion: number): string | undefined {
    const changes = this.totalChanges();
    if (changes === this.changes) return undefined;
    this.changes = changes;
    const snapshot = this.snapshot(), hash = this.digest(snapshot);
    if (hash === this.hash) return undefined;
    this.hash = hash;
    this.version = Math.max(Date.now(), this.version + 1, seenVersion + 1);
    return zlib.gzipSync(JSON.stringify(snapshot)).toString('base64');
  }
}
