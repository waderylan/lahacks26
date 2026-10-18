import fs from 'node:fs';
import { loadCompanyBills } from '../server/data.ts';
import { visibleInput } from '../server/evaluator.ts';
import { evaluateJevInputs } from '../server/jev.ts';
import { decisionMessages } from '../server/modelContract.ts';
const dir='training/semantic-review';
const splits=JSON.parse(fs.readFileSync(`${dir}/splits.json`,'utf8'));
const criteria=['Anything electronic or tech-related','Anything you could wear','Bills for electricity, water, or other utilities','Bills where the memo mentions a delay or something not arriving yet','Descriptions that are blank or just a placeholder',"Descriptions that don't say what was bought",'Memos that contradict the description','The line items describe an ongoing service or overhead charge rather than physical goods.','The memo describes a standing overhead or monthly service charge.','The transaction description and memo are both informative and consistent.'];
const target=`${dir}/teacher-cases.jsonl`;
const prior=fs.existsSync(target)?fs.readFileSync(target,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
const completed=new Set(prior.map(x=>x.group));let cost=0n;
for(let i=0;i<20;i++){
 const companyId=splits.train[i];const group=`${companyId}:${i}`;if(completed.has(group))continue;
 const data=loadCompanyBills(companyId);const rows=data.rows.filter((_,j)=>j%Math.max(1,Math.floor(data.rows.length/10))===0).slice(0,10);
 const criterion=criteria[i%criteria.length];const company={name:data.company.name,industry:data.company.industry};
 const inputs=rows.map(r=>visibleInput(company,criterion,r));
 try {
  const result=await evaluateJevInputs(inputs,AbortSignal.timeout(60000));cost+=BigInt(result.costNanoUsd);
  const examples=inputs.map((input,j)=>({input,label:result.results[j].state,family:`teacher-${i%criteria.length}`,origin:'jev_teacher_unreviewed',companyId,caseId:`teacher:${rows[j].id}:${i}`,group}));
  fs.appendFileSync(target,examples.map(e=>JSON.stringify(e)).join('\n')+'\n');
  console.log('Teacher batch',i+1,examples.length,'cases');
 }catch(e){ console.log('Teacher batch failed',i+1,(e as Error).name); fs.writeFileSync(`${dir}/teacher-error.txt`,(e as Error).message.slice(0,600)); throw new Error('Jev teacher unavailable; inspect local teacher-error.txt'); }
}
const synthetic=fs.readFileSync(`${dir}/train-cases.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s));
const teacher=fs.readFileSync(target,'utf8').trim().split('\n').map(s=>JSON.parse(s));
const combined=[...synthetic,...teacher];
fs.writeFileSync(`${dir}/train.jsonl`,combined.map(e=>JSON.stringify({messages:[...decisionMessages(e.input),{role:'assistant',content:{match:'A',no_match:'B',uncertain:'C'}[e.label as 'match'|'no_match'|'uncertain']}]})).join('\n')+'\n');
fs.writeFileSync(`${dir}/teacher-summary.json`,JSON.stringify({count:teacher.length,costNanoUsd:cost>0n?cost.toString():null,labels:'Jev teacher predictions, not independent ground truth',totalTraining:combined.length},null,2));
console.log('Training set ready:',combined.length,'cases');
