import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActionStore} from './actionStore.ts';
import {WorkspaceData} from './workspaceData.ts';
import {loadCompanyBills} from './data.ts';
import {visibleInput} from './evaluator.ts';
import {decisionMessages} from './modelContract.ts';
import {ModelFeedbackService,VeriFeedbackClient,feedbackRoutes,type Observation} from './modelFeedback.ts';
import {sameOriginApi} from './actionRoutes.ts';
import express from 'express';
import {createServer} from 'node:http';

function setup(t: {after:(fn:()=>void)=>void}) {
 const db=new ActionStore(':memory:'),original=loadCompanyBills('company-101');const data=new WorkspaceData(db,()=>original,()=>[]),row=data.bills('company-101').rows[0];
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'model-feedback-'));t.after(()=>{db.db.close();fs.rmSync(folder,{recursive:true,force:true});});
 const old=process.env.VERI_DEPLOYMENT_ID;process.env.VERI_DEPLOYMENT_ID='abc123';t.after(()=>{if(old===undefined)delete process.env.VERI_DEPLOYMENT_ID;else process.env.VERI_DEPLOYMENT_ID=old;});
 const input=visibleInput({name:original.company.name,industry:original.company.industry},'Anything electronic or tech-related',row);
 const o:Observation={id:'observation-1',companyId:row.companyId,rowId:row.id,vendor:row.vendor,criterion:input.criterion,deploymentId:'abc123',input,messages:decisionMessages(input),result:'no_match',createdAt:new Date().toISOString()};db.put('model-observation',o.id,o.companyId,o);
 const calls:{route:string;method:string;body:any}[]=[];let sourceGets=0;const originalRows=[{messages:[...decisionMessages({...input,criterion:'Original training criterion'}),{role:'assistant',content:'B'}]}];
 const client={call:async(route:string,method='GET',body?:any)=>{calls.push({route,method,body});if(route.startsWith('/deployments/'))return{source:'training_job',model:'parent-job'};if(route==='/training_jobs/parent-job')return{status:'completed',dataset_snapshot_id:'parent@snap-1',base_model:'Qwen/Qwen3-1.7B'};if(route.startsWith('/datasets/parent/rows')){sourceGets++;return{rows:[{row_id:1,row:originalRows[0]}],next_cursor:null};}if(route==='/datasets')return{id:body.format==='chat'?'replay':'preferences'};if(route.endsWith('/rows'))return{head_row:2};if(route.endsWith('/snapshots'))return{id:route.includes('replay')?'replay@snap-1':'preferences@snap-1'};if(route.startsWith('/cost/estimate'))return{estimated_cost_usd:3.15};if(route==='/billing/balance')return{balance_usd:10};if(route.startsWith('/training_jobs?'))return{data:[],has_more:false};if(route==='/training_jobs'&&method==='POST')return{id:'new-job',status:'queued'};throw new Error('Unexpected route '+route);}};
 const service=new ModelFeedbackService(db,data,client as unknown as VeriFeedbackClient,folder);
 const correction={rowId:row.id,version:String(row.sourceVersion),criterion:input.criterion,chosen:'match' as const,observed:'no_match' as const,actor:'emp-ap'};
 return{db,data,row,o,input,calls,service,correction,folder,originalRows};
}
test('corrections use frozen server observations, deduplicate, export exact A/B preferences and never call Veri',t=>{
 const x=setup(t);x.service.correct(x.row.companyId,x.correction);x.service.correct(x.row.companyId,x.correction);
 const s=x.service.state(x.row.companyId);assert.equal(s.entries.length,1);assert.equal(x.calls.length,0);assert.ok(!('observation' in s.entries[0]));
 const pair=JSON.parse(x.service.export(x.row.companyId));assert.deepEqual(pair,{prompt:x.o.messages,chosen:'A',rejected:'B'});assert.equal(fs.readFileSync(path.join(x.folder,x.row.companyId,'preferences.jsonl'),'utf8'),x.service.export(x.row.companyId));
 assert.throws(()=>x.service.correct(x.row.companyId,{...x.correction,observed:'match'}));assert.throws(()=>x.service.record('company-102',{observationId:x.o.id,chosen:'match',observed:'no_match',actor:'emp-ap'}));
 const changed={...x.row,memo:'Edited after evaluation'};x.db.write(changed,x.row.sourceVersion!);assert.throws(()=>x.service.correct(x.row.companyId,x.correction),/transaction changed/);
 x.service.include(x.row.companyId,s.entries[0].id,false);assert.equal(x.service.export(x.row.companyId),'');
});
test('upload retains source SFT examples, separates preference format, freezes snapshots and does not train',async t=>{
 const x=setup(t);x.service.correct(x.row.companyId,x.correction);const p=x.service.uploadPlan(x.row.companyId);
 await assert.rejects(x.service.upload(x.row.companyId,'stale'),/Corrections changed/);const op=await x.service.upload(x.row.companyId,p.hash);
 assert.equal(op.status,'completed');assert.equal(op.baseRows,1);assert.equal(op.totalRows,2);assert.equal(op.replaySnapshot,'replay@snap-1');assert.equal(x.calls.filter(c=>c.route==='/training_jobs'&&c.method==='POST').length,0);
 const replay=x.calls.find(c=>c.route==='/datasets/replay/rows')!.body.rows;assert.deepEqual(replay[0],x.originalRows[0]);assert.equal(replay[1].messages.at(-1).content,'A');
 const prefs=x.calls.find(c=>c.route==='/datasets/preferences/rows')!.body.rows;assert.equal(prefs[0].chosen,'A');assert.ok(!('messages' in prefs[0]));
});
test('paid training requires a valid separate confirmation, pins replay snapshot and is idempotent',async t=>{
 const x=setup(t);x.service.correct(x.row.companyId,x.correction);const uploaded=await x.service.upload(x.row.companyId,x.service.uploadPlan(x.row.companyId).hash);
 const plan=await x.service.trainingPlan(x.row.companyId,uploaded.id);assert.equal(x.calls.some(c=>c.route==='/training_jobs'&&c.method==='POST'),false);
 await assert.rejects(x.service.train(x.row.companyId,plan.token,false),/explicitly confirm/);const op=await x.service.train(x.row.companyId,plan.token,true);assert.equal(op.jobId,'new-job');
 const submit=x.calls.find(c=>c.route==='/training_jobs'&&c.method==='POST')!.body;assert.equal(submit.dataset_id,'replay@snap-1');assert.equal(submit.base_model,'Qwen/Qwen3-1.7B');assert.equal(submit.method,'sft_text');assert.equal(submit.requires_heartbeat,false);
 await assert.rejects(x.service.train(x.row.companyId,plan.token,true));const p2=await x.service.trainingPlan(x.row.companyId,uploaded.id);assert.equal((await x.service.train(x.row.companyId,p2.token,true)).jobId,'new-job');assert.equal(x.calls.filter(c=>c.route==='/training_jobs'&&c.method==='POST').length,1);assert.equal(x.calls.some(c=>c.method==='POST'&&c.route==='/deployments'),false);
});
test('feedback routes reject missing confirmations and foreign-origin mutations',async t=>{
 const x=setup(t);const app=express();app.use(express.json());app.use('/api',sameOriginApi);feedbackRoutes(app,x.service);const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/api/companies/${x.row.companyId}/model-feedback`;
 const bad=await fetch(url,{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify(x.correction)});assert.equal(bad.status,403);
 const noConfirm=await fetch(url+'/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noConfirm.status,400);assert.equal(x.calls.length,0);
});

test('excluding corrections invalidates an old upload confirmation',async t=>{
 const x=setup(t);x.service.correct(x.row.companyId,x.correction);const plan=x.service.uploadPlan(x.row.companyId);const entry=x.service.state(x.row.companyId).entries[0];x.service.include(x.row.companyId,entry.id,false);
 await assert.rejects(x.service.upload(x.row.companyId,plan.hash));assert.equal(x.calls.length,0);
});
test('an upload failure never starts training or changes the deployment',async t=>{
 const x=setup(t);x.service.correct(x.row.companyId,x.correction);
 const client={call:async()=>{throw new Error('Veri HTTP 503');}};
 const failed=new ModelFeedbackService(x.db,x.data,client as unknown as VeriFeedbackClient,x.folder);
 await assert.rejects(failed.upload(x.row.companyId,failed.uploadPlan(x.row.companyId).hash),/503/);
 const op=failed.state(x.row.companyId).operations[0];assert.equal(op.status,'failed');assert.equal(op.type,'upload');assert.equal(process.env.VERI_DEPLOYMENT_ID,'abc123');
 await assert.rejects(failed.trainingPlan(x.row.companyId,op.id),/completed upload/);
});

test('stale interrupted operations can be unlocked without submitting training',async t=>{
 const x=setup(t);x.db.put('feedback-operation','interrupted',x.row.companyId,{id:'interrupted',companyId:x.row.companyId,type:'train',status:'running',stage:'Submitting',createdAt:'2020-01-01T00:00:00Z',count:1,feedbackHash:'old',outputName:'unsubmitted'});
 const s=await x.service.reconcile(x.row.companyId,'interrupted');assert.equal(s.operations[0].status,'failed');assert.equal(x.calls.some(c=>c.method==='POST'),false);
});

test('corrections survive remounts and fresh observation ids without duplicating proposals',t=>{
 const x=setup(t);x.service.correct(x.row.companyId,x.correction);
 const initial=x.service.state(x.row.companyId).entries[0];assert.equal(initial.current,true);
 const next={...x.o,id:'new-evaluation',result:'uncertain' as const,createdAt:'2099-01-01T00:00:00Z'};x.db.put('model-observation',next.id,next.companyId,next);
 x.service.correct(x.row.companyId,{...x.correction,observed:'uncertain',chosen:'no_match'});
 const reopened=new ModelFeedbackService(x.db,x.data,undefined,x.folder);let state=reopened.state(x.row.companyId);
 assert.equal(state.entries.length,1);assert.equal(state.entries[0].id,initial.id);assert.equal(state.entries[0].chosen,'no_match');assert.equal(state.entries[0].current,true);
 reopened.include(x.row.companyId,initial.id,false);reopened.correct(x.row.companyId,{...x.correction,observed:'uncertain',chosen:'no_match'});
 assert.equal(reopened.state(x.row.companyId).entries[0].included,false);assert.equal(reopened.export(x.row.companyId),'');
 const legacy=x.db.get<any>('model-feedback',initial.id)!;x.db.put('model-feedback','legacy-duplicate',x.row.companyId,{...legacy,id:'legacy-duplicate',createdAt:'2000-01-01T00:00:00Z',included:true});
 assert.equal(reopened.state(x.row.companyId).entries.length,1);assert.equal(reopened.export(x.row.companyId),'');
 const changed={...x.row,memo:'New evidence'};x.db.write(changed,x.row.sourceVersion!);state=reopened.state(x.row.companyId);assert.equal(state.entries[0].current,false);
});
