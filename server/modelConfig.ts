import fs from 'node:fs';
import path from 'node:path';

/** Runtime configuration is explicit and independent of the immutable training archive. */
export function runtimeModelConfig(): { deploymentId?: string; name?: string; calibrationFile?: string } {
  const file = process.env.MODEL_CONFIG_FILE;
  if (!file) return {};
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!value || typeof value !== 'object') throw new Error('Invalid runtime model configuration.');
  for (const key of ['deploymentId', 'name', 'calibrationFile']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('Invalid runtime model configuration.');
  return { ...value, ...(value.calibrationFile && { calibrationFile: path.resolve(path.dirname(path.resolve(file)), value.calibrationFile) }) };
}
