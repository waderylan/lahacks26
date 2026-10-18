import fs from 'node:fs';
import { adjustedProbability } from '../server/calibration.ts';
const dir='training/semantic-review';
const prefix=process.argv[2]??'qwen';
if(!['qwen','qwen17'].includes(prefix))throw new Error('Unknown model');
const report=JSON.parse(fs.readFileSync(`${dir}/${prefix}-validation-benchmark.json`,'utf8'));
const attempts=fs.readFileSync(`${dir}/${prefix}-validation-predictions.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s));
const rows=[...new Map(attempts.map(r=>[r.caseId,r])).values()].filter(r=>!r.error&&typeof r.pMatch==='number'&&Number.isFinite(r.pMatch));
const n=rows.length, positives=rows.filter(r=>r.expected==='match').length;
if(n<100||n/report.n<.9||positives<10||n-positives<10) { console.log('Calibration skipped: insufficient valid validation scores');process.exit(0); }
const logit=(p:number)=>{const x=Math.max(1e-6,Math.min(1-1e-6,p));return Math.log(x/(1-x));};
const raw=rows.map(r=>logit(r.pMatch));const mean=raw.reduce((a,b)=>a+b,0)/n;const sd=Math.max(.01,Math.sqrt(raw.reduce((a,b)=>a+(b-mean)**2,0)/n));
let w=1,b=0;
for(let step=0;step<4000;step++){
 let dw=0,db=0;
 for(let i=0;i<n;i++){const x=(raw[i]-mean)/sd;const z=Math.max(-40,Math.min(40,w*x+b));const y=rows[i].expected==='match'?1:0;const e=1/(1+Math.exp(-z))-y;dw+=e*x;db+=e;}
 w=Math.max(0,w-.05*(dw/n+.001*w));b-=.05*db/n;
}
const a=w/sd,intercept=b-w*mean/sd;
const brier=(calibrated:boolean)=>rows.reduce((sum,r)=>sum+((calibrated?adjustedProbability(r.pMatch,a,intercept):r.pMatch)-(r.expected==='match'?1:0))**2,0)/n;
const calibration={deploymentId:report.model,a,b:intercept,n,validationHash:report.runHash,source:'authored_validation_only',method:'Monotonic Platt scaling; no test labels used',validationBrierBefore:brier(false),validationBrierAfter:brier(true),note:'Fit on held-out authored synthetic cases. This is not evidence of calibration on real accounting data.'};
fs.writeFileSync(`${dir}/${prefix==='qwen17'?'qwen17/':''}calibration.json`,JSON.stringify(calibration,null,2));console.log('Calibration fit',n,'validation cases; Brier',calibration.validationBrierBefore,'->',calibration.validationBrierAfter);
