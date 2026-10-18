import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadCompanyBills } from '../server/data.ts';
import { centsText } from '../server/modelContract.ts';
const dir='training/semantic-review';const splits=JSON.parse(fs.readFileSync(`${dir}/splits.json`,'utf8'));const audit:any[]=[];
for(const split of ['train','validation','test']){
 const contexts=splits[split].flatMap((id:string)=>loadCompanyBills(id).rows.slice(0,4));
 const cases=fs.readFileSync(`${dir}/${split}-cases.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s));
 for(const example of cases){
  const serial=Number(example.caseId.split('-').at(-1));const source=contexts[serial%contexts.length];const tx=example.input.transaction;
  assert.equal(source.companyId,example.companyId);assert.equal(source.date,tx.date);assert.equal(source.vendor,tx.vendor);assert.equal(source.account,tx.account);assert.equal(centsText(source.amountCents),tx.amount);assert.equal(source.expenseKind,tx.expense_kind);
  audit.push({caseId:example.caseId,split,companyId:source.companyId,sourceBillId:source.billId,sourceRecordId:source.id,changedFields:{description:{before:source.description,after:tx.description},memo:{before:source.memo,after:tx.memo},item_names:{before:source.itemNames,after:tx.item_names}},purpose:`Authored semantic review example for ${example.family}; not a defect found in source books.`,neverSendToModel:true});
 }
}
fs.writeFileSync(`${dir}/overlay-audit.jsonl`,audit.map(x=>JSON.stringify(x)).join('\n')+'\n');console.log('Verified unchanged dates, vendors, accounts, amounts and company-scoped source IDs for',audit.length,'overlays');
