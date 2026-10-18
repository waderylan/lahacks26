import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function discover(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? discover(file) : entry.name.endsWith('.test.ts') ? [file] : [];
  });
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...discover('src'), ...discover('server')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
