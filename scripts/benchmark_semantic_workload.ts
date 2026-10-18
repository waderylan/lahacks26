import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { loadCompanyBills } from '../server/data.ts';
import { evaluateSelected, type Provider } from '../server/evaluator.ts';
const model=process.argv[2]??'jev';
const provider:Provider=model==='qwen17'?'qwen':model as Provider;if(!['jev','qwen'].includes(provider))throw new Error('Choose jev, qwen or qwen17');
if(model==='qwen17'){process.env.VERI_DEPLOYMENT_ID=JSON.parse(fs.readFileSync('training/semantic-review/qwen17/qwen-deployment.json','utf8')).id;process.env.QWEN_CALIBRATION_FILE='training/semantic-review/qwen17/calibration.json';}
const size=process.argv[3]??'50';
if(!['50','all'].includes(size))throw new Error('Use 50 or all');
const data=loadCompanyBills('company-101');
if (size !== 'all') data.rows = Array.from({ length: 50 }, (_,i) => data.rows[Math.floor(i * data.rows.length / 50)]);
const criterion='Anything electronic or tech-related';const batches:string[][]=[];
for(let i=0;i<data.rows.length;i+=20)batches.push(data.rows.slice(i,i+20).map(r=>r.id));
let next=0;const results:any[]=[];let cost=0n;
const begin=performance.now();
await Promise.all(Array.from({length:Math.min(3,batches.length)},async()=>{
 while(next<batches.length){const i=next++;const r=await evaluateSelected(provider,{company:{name:data.company.name,industry:data.company.industry},criterion,ids:batches[i]},AbortSignal.timeout(60000));results.push(...r.results);cost+=BigInt(r.costNanoUsd);}
}));
const report={provider,model,companyId:'company-101',criterion,n:results.length,totalMs:performance.now()-begin,concurrency:'3 batches of up to 20; Qwen uses 3 concurrent record calls per batch',requestCostNanoUsd:provider==='jev'&&cost>0n?cost.toString():null,costNote:provider==='qwen'?'GPU-hour billing, not a free request':'Gateway metadata if available',results,note:'Original records. Jev/Qwen agreement is not independent accounting accuracy. One warm-server run; not a statistical latency benchmark.'};
fs.writeFileSync(`training/semantic-review/${model}-workload${size==='all'?'-all':''}.json`,JSON.stringify(report,null,2));console.log(provider,results.length,Math.round(report.totalMs),'ms');
