// Builds the API as a Vercel Build Output API function (.vercel/output). The frontend is on GitHub Pages.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const out = path.resolve('.vercel/output');
const fn = path.join(out, 'functions/api.func');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ['server/vercel.ts'], outfile: path.join(fn, 'index.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
// Read at runtime relative to cwd (/var/task).
for (const dir of ['synthetic/extension-v1', 'training/semantic-review']) fs.cpSync(dir, path.join(fn, dir), { recursive: true });

// Starting state: a copy of the local workspace trimmed to the demo companies (101-104). The live DB is only read.
const SEED_COMPANIES = ['company-101', 'company-102', 'company-103', 'company-104'];
const live = path.resolve(process.env.WORKSPACE_DB || 'workspace/actions.sqlite');
const seed = path.resolve('server/seed/actions.sqlite');
if (fs.existsSync(live)) {
  fs.mkdirSync(path.dirname(seed), { recursive: true });
  fs.rmSync(seed, { force: true });
  new DatabaseSync(live, { readOnly: true }).exec(`VACUUM INTO '${seed.replaceAll("'", "''")}'`);
  const db = new DatabaseSync(seed), keep = SEED_COMPANIES.map(() => '?').join(',');
  db.prepare(`DELETE FROM bills WHERE company NOT IN (${keep})`).run(...SEED_COMPANIES);
  db.prepare(`DELETE FROM documents WHERE company NOT IN (${keep})`).run(...SEED_COMPANIES);
  db.exec('PRAGMA journal_mode=DELETE; VACUUM;'); db.close();
}
if (fs.existsSync(seed)) fs.cpSync(seed, path.join(fn, 'seed/actions.sqlite'));
fs.writeFileSync(path.join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2));
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ version: 3, routes: [
  { src: '/api(?:/.*)?', dest: '/api' },
  { src: '/', status: 308, headers: { Location: 'https://waderylan.github.io/lahacks26/app/' } },
] }, null, 2));
console.log('Built', path.relative(process.cwd(), fn));
