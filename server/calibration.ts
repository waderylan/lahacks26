import fs from 'node:fs';
import path from 'node:path';
import { runtimeModelConfig } from './modelConfig.ts';
export interface Calibration { deploymentId: string; a: number; b: number; n: number; validationHash: string; source: 'authored_validation_only' }
export function adjustedProbability(p: number, a: number, b: number) {
  if (!Number.isFinite(p) || p < 0 || p > 1 || !Number.isFinite(a) || !Number.isFinite(b) || a < 0) throw new Error('Invalid calibration');
  const clipped=Math.max(1e-6,Math.min(1-1e-6,p));const z=Math.max(-40,Math.min(40,a*Math.log(clipped/(1-clipped))+b));
  return 1/(1+Math.exp(-z));
}
export function readCalibration(deploymentId: string | undefined): Calibration | null {
  try {
    const file = process.env.QWEN_CALIBRATION_FILE ?? runtimeModelConfig().calibrationFile;
    if (!file) return null;
    const x=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
    return x.deploymentId===deploymentId && x.source==='authored_validation_only' && Number.isFinite(x.a) && x.a>=0 && Number.isFinite(x.b) && Number.isInteger(x.n) && x.n>=100 ? x : null;
  } catch { return null; }
}
