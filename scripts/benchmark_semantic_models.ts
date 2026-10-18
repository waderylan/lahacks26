import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { evaluateJevInputs, criterionInstructions } from '../server/jev.ts';
import { evaluateQwen, qwenDeploymentId } from '../server/qwen.ts';
import { evaluateGeminiInputs } from '../server/llm.ts';
import { POLICY, type DecisionInput, type MatchState } from '../server/modelContract.ts';
interface Case {input:DecisionInput;label:MatchState;caseId:string;family:string;origin:string;companyId:string}
const dir='training/semantic-review';
const provider=process.argv[2]??'jev';if(!['jev','qwen','base','heuristic','qwen17','base17','gemini','gemini-lite'].includes(provider))throw new Error('Unknown provider');
// Gemini baselines run on GEMINI_API_KEY (the AI Gateway key is for Jev only).
const GEMINI:Record<string,'gemini-3.5-flash'|'gemini-3.5-flash-lite'>={gemini:'gemini-3.5-flash','gemini-lite':'gemini-3.5-flash-lite'};
if(provider==='qwen'){process.env.VERI_DEPLOYMENT_ID=JSON.parse(fs.readFileSync(`${dir}/qwen-deployment.json`,'utf8')).id;process.env.QWEN_CALIBRATION_FILE=`${dir}/calibration.json`;}
if(provider==='base')process.env.VERI_DEPLOYMENT_ID=JSON.parse(fs.readFileSync(`${dir}/base-deployment.json`,'utf8')).id;
if(provider==='base17')process.env.VERI_DEPLOYMENT_ID=JSON.parse(fs.readFileSync(`${dir}/qwen17/base-deployment.json`,'utf8')).id;
if(provider==='qwen17'){process.env.VERI_DEPLOYMENT_ID=JSON.parse(fs.readFileSync(`${dir}/qwen17/qwen-deployment.json`,'utf8')).id;process.env.QWEN_CALIBRATION_FILE=`${dir}/qwen17/calibration.json`;}
const synthetic=fs.readFileSync(`${dir}/test-cases.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s) as Case);
const byFamily=new Map<string,Case[]>();for(const c of synthetic){const a=byFamily.get(c.family)??[];a.push(c);byFamily.set(c.family,a);}
const sample=synthetic; // Evaluate every held-out overlay, not only four per family.
const demo=fs.readFileSync(`${dir}/demo-holdout.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s) as Case);
const phase=process.argv[3]??'test';
if(phase==='validation')process.env.QWEN_RAW_SCORES='1';
if(!['test','validation'].includes(phase))throw new Error('Unknown evaluation phase');
const runName=provider+(phase==='validation'?'-validation':'');
const cases:Case[]=phase==='validation'?fs.readFileSync(`${dir}/validation-cases.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s)): [...demo,...sample];
const modelIdentity=provider==='jev'?'typesafe-ai/jev':provider==='heuristic'?'keyword-v1':GEMINI[provider]?`google/${GEMINI[provider]}`:qwenDeploymentId();
const calibrationFile=process.env.QWEN_CALIBRATION_FILE??`${dir}/calibration.json`;
const calibration=['qwen','qwen17'].includes(provider)&&phase==='test'&&fs.existsSync(calibrationFile)?JSON.parse(fs.readFileSync(calibrationFile,'utf8')):null;
const runHash=createHash('sha256').update(JSON.stringify({modelIdentity,policy:POLICY,jevPolicy:criterionInstructions.toString(),cases,...(calibration?.deploymentId===modelIdentity?{calibration}: {})})).digest('hex');
const metadataFile=`${dir}/${runName}-run.json`;
if(fs.existsSync(metadataFile)&&JSON.parse(fs.readFileSync(metadataFile,'utf8')).runHash!==runHash)throw new Error('Model or evaluation data changed: archive prediction log and run metadata before a fresh benchmark');
fs.writeFileSync(metadataFile,JSON.stringify({runHash,modelIdentity,createdAt:new Date().toISOString()},null,2));
const file=`${dir}/${runName}-predictions.jsonl`;
const prior=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
const complete=new Set(prior.filter(r=>!r.error).map(r=>r.caseId));let requestCost=0n;
const groups=new Map<string,Case[]>();for(const c of cases.filter(c=>!complete.has(c.caseId))){const k=JSON.stringify([c.input.company,c.input.criterion]);const a=groups.get(k)??[];a.push(c);groups.set(k,a);}
function heuristic(c:Case):MatchState {
 const t=c.input.transaction;const blank=!t.description.trim()||/^(n\/?a|tbd|[-—.]+)$/i.test(t.description.trim());
 const vague=/^(payment|miscellaneous|monthly charge|vendor services|purchase|invoice attached)$/i.test(t.description.trim());
 if(c.family==='effectively_blank'||c.family==='blank')return blank?'match':'no_match';
 if(c.family==='nonempty_uninformative'||c.family==='vague')return vague?'match':'no_match';
 if(blank||vague)return c.family==='needs_attention'||c.family==='attention'?'match':'uncertain';
 const both=(t.description+' '+t.memo+' '+t.item_names.join(' ')).toLowerCase();
 if(c.family==='electronics')return /computer|laptop|router|monitor|keyboard/.test(both)?'match':'no_match';
 if(c.family==='clothing')return /shirt|jacket|sweater|coverall/.test(both)?'match':'no_match';
 if(c.family==='utilities')return /electricity|water|utility/.test(both)?'match':'no_match';
 if(c.family==='delay')return /delay|backorder|awaiting/.test(t.memo)?'match':'no_match';
 return 'no_match';
}
let count=prior.length;let tokens=0;
for(const group of groups.values())for(let start=0;start<group.length;start+=20){
 const batch=group.slice(start,start+20);const begin=performance.now();
 try {
  let results:any[];let modelMs:number|null=null;
  if(provider==='jev'){const r=await evaluateJevInputs(batch.map(c=>c.input),AbortSignal.timeout(60000));results=r.results;requestCost+=BigInt(r.costNanoUsd);}
  else if(provider==='heuristic')results=batch.map(c=>({state:heuristic(c),pMatch:null}));
  else if(GEMINI[provider]){const r=await evaluateGeminiInputs(batch.map(c=>c.input),GEMINI[provider]);results=r.results;tokens+=r.tokens;modelMs=r.ms;}
  else {results=new Array(batch.length);let next=0;await Promise.all(Array.from({length:Math.min(3,batch.length)},async()=>{while(next<batch.length){const i=next++;try { results[i]=await evaluateQwen(batch[i].input,AbortSignal.timeout(60000)); } catch(e) { results[i]={state:null,pMatch:null,error:(e as Error).name,errorMessage:(e as Error).message.slice(0,180)}; }}}));}
  // Gemini: the model's own response time, not free-tier rate-limit waits.
  const ms=modelMs??performance.now()-begin;
  const records=batch.map((c,i)=>({caseId:c.caseId,expected:c.label,prediction:results[i].state,pMatch:results[i].pMatch,rawPMatch:results[i].rawPMatch??results[i].pMatch,scoreKind:results[i].scoreKind??null,...(results[i].error?{error:results[i].error,errorMessage:results[i].errorMessage}:{}),family:c.family,origin:c.origin,companyId:c.companyId,batchMs:ms,batchSize:batch.length,provider}));
  fs.appendFileSync(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');count+=records.length;console.log(provider,count,'/',cases.length);
 }catch(e){
  // Missing answers remain errors, never semantic false. Do not print credentials or request objects.
  const records=batch.map(c=>({caseId:c.caseId,expected:c.label,prediction:null,pMatch:null,family:c.family,origin:c.origin,companyId:c.companyId,error:(e as Error).name,provider}));
  fs.appendFileSync(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');console.log(provider,'failed batch',batch.length,(e as Error).name);
 }
}
// Last attempt wins; missing answers count as wrong.
const records=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));const map=new Map(records.map(r=>[r.caseId,r]));
const rows=cases.map(c=>map.get(c.caseId)??{caseId:c.caseId,expected:c.label,prediction:null,family:c.family,origin:c.origin});
const slices=(key:'family'|'origin')=>Object.fromEntries([...new Set(rows.map(r=>r[key]))].map(k=>{const a=rows.filter(r=>r[key]===k);return[k,{n:a.length,accuracy:a.filter(r=>r.expected===r.prediction).length/a.length}]}));
const batchTimes=[...new Map(rows.filter(r=>r.batchMs!==undefined).map(r=>[r.caseId.split(':').slice(0,1).join(':')+r.batchMs,r.batchMs])).values()].sort((a,b)=>a-b);
const costFile=`${dir}/${runName}-request-cost.json`;
if(requestCost>0n)fs.writeFileSync(costFile,JSON.stringify({runHash,requestCostNanoUsd:requestCost.toString()}));
const recordedCost=fs.existsSync(costFile)?JSON.parse(fs.readFileSync(costFile,'utf8')):null;
// Gemini reports tokens, not dollars; keep a running total across resumed runs.
const tokenFile=`${dir}/${runName}-tokens.json`;
if(GEMINI[provider]){const prev=fs.existsSync(tokenFile)?JSON.parse(fs.readFileSync(tokenFile,'utf8')):null;fs.writeFileSync(tokenFile,JSON.stringify({runHash,tokens:(prev?.runHash===runHash?prev.tokens:0)+tokens}));}
const recordedTokens=fs.existsSync(tokenFile)?JSON.parse(fs.readFileSync(tokenFile,'utf8')):null;
const labels:MatchState[]=['match','no_match','uncertain'];
const perClass=Object.fromEntries(labels.map(label=>{const tp=rows.filter(r=>r.expected===label&&r.prediction===label).length;const fp=rows.filter(r=>r.expected!==label&&r.prediction===label).length;const fn=rows.filter(r=>r.expected===label&&r.prediction!==label).length;return[label,{precision:tp/Math.max(1,tp+fp),recall:tp/Math.max(1,tp+fn),f1:2*tp/Math.max(1,2*tp+fp+fn)}]}));
const confusion=Object.fromEntries(labels.map(label=>[label,Object.fromEntries([...labels,'error'].map(pred=>[pred,rows.filter(r=>r.expected===label&&(pred==='error'?!r.prediction:r.prediction===pred)).length]))]));
const scored=rows.filter(r=>typeof r.pMatch==='number'&&Number.isFinite(r.pMatch));
const report={phase,runHash,rawMatchBrier:scored.length?scored.reduce((sum,r)=>sum+((r.rawPMatch??r.pMatch)-(r.expected==='match'?1:0))**2,0)/scored.length:null,perClass,macroF1:labels.reduce((sum,k)=>sum+perClass[k].f1,0)/3,confusion,scoreCoverage:scored.length/rows.length,matchBrier:scored.length?scored.reduce((sum,r)=>sum+(r.pMatch-(r.expected==='match'?1:0))**2,0)/scored.length:null,provider,model:provider==='jev'?'typesafe-ai/jev':provider==='heuristic'?'keyword baseline':GEMINI[provider]?`google/${GEMINI[provider]}`:process.env.VERI_DEPLOYMENT_ID,...(GEMINI[provider]?{geminiTokens:recordedTokens?.runHash===runHash?recordedTokens.tokens:null}:{}),n:rows.length,accuracy:rows.filter(r=>r.expected===r.prediction).length/rows.length,errors:rows.filter(r=>!r.prediction).length,falseMatches:rows.filter(r=>r.prediction==='match'&&r.expected!=='match').length,uncertainRecall:rows.filter(r=>r.expected==='uncertain'&&r.prediction==='uncertain').length/Math.max(1,rows.filter(r=>r.expected==='uncertain').length),byFamily:slices('family'),byOrigin:slices('origin'),requestCostNanoUsd:provider==='jev'?(requestCost>0n?requestCost.toString():recordedCost?.runHash===runHash?recordedCost.requestCostNanoUsd:null):null,costNote:provider==='jev'?'null means gateway cost metadata unavailable, not free':GEMINI[provider]?'Billed to GEMINI_API_KEY by tokens; see geminiTokens':'GPU time is billed separately; no fabricated per-request price',latencyNote:'Batch end-to-end timings; Same cases in batches up to 20. Jev uses native multi-question requests; Qwen uses three concurrent record requests, as in the app adapter. These are product-workload timings, not equal-token engine benchmarks.',batchP50Ms:batchTimes[Math.floor(batchTimes.length*.5)]??null,batchP95Ms:batchTimes[Math.floor(batchTimes.length*.95)]??null};
fs.writeFileSync(`${dir}/${runName}-benchmark.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
