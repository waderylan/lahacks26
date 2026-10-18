import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { ActionStore } from './actionStore.ts';
import type { WorkspaceData } from './workspaceData.ts';
import { employeeById } from '../src/employees.ts';
import { qwenDeploymentId } from './qwen.ts';
import { evaluationEvidence } from '../src/jevEvidence.ts';
import { LABELS, POLICY, decisionMessages, type DecisionInput } from './modelContract.ts';
import type { DecisionLabel, FeedbackEntry, FeedbackOperation, TrainingPlan } from '../src/modelFeedbackTypes.ts';
export interface Observation {
  id: string; companyId: string; rowId: string; vendor: string; criterion: string;
  deploymentId: string; input: DecisionInput; messages: ReturnType<typeof decisionMessages>;
  result: DecisionLabel; createdAt: string;
}
type Entry = FeedbackEntry & { observation: Observation };
type Plan = TrainingPlan & { companyId: string; feedbackHash: string; used?: boolean };
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const letter = (x: DecisionLabel) => Object.entries(LABELS).find(([,v])=>v===x)![0];
const valid = (x: unknown): x is DecisionLabel => ['match','no_match','uncertain'].includes(String(x));
const jsonl = (rows: unknown[]) => rows.map(x=>JSON.stringify(x)).join('\n') + (rows.length?'\n':'');
export class VeriFeedbackClient {
  private next = 0;
  constructor(private request: typeof fetch = fetch) {}
  async call(route: string, method = 'GET', body?: unknown): Promise<any> {
    if (!process.env.VERI_API_KEY) throw new Error('VERI_API_KEY is not configured on this server.');
    for(let attempt=0;attempt<3;attempt++) {
      const at=Math.max(Date.now(),this.next);this.next=at+550;
      if(at>Date.now())await new Promise(r=>setTimeout(r,at-Date.now()));
      const response=await this.request('https://api.veri.studio/v1'+route,{method,headers:{Authorization:`Bearer ${process.env.VERI_API_KEY}`,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
      if(!response.ok) {
        const info=await response.json().catch(()=>({}));const code=String(info.error?.code??'').replace(/[^a-zA-Z0-9_]/g,'').slice(0,80);
        if(response.status===429&&attempt<2&&(code.toUpperCase()==='RATE_LIMITED'||response.headers.has('retry-after'))) {
          const wait=Math.min(60,Math.max(1,Number(response.headers.get('retry-after'))||Number(info.error?.retry_after_seconds)||10));await new Promise(r=>setTimeout(r,wait*1000));continue;
        }
        throw new Error(`Veri HTTP ${response.status}${code?' ('+code+')':''}. No deployment was changed. Review the operation before retrying.`);
      }
      return response.json();
    }
    throw new Error('Veri rate limit. Retry later.');
  }
}
export class ModelFeedbackService {
  constructor(private db: ActionStore, private data: WorkspaceData, private client = new VeriFeedbackClient(), private directory = path.resolve('workspace/model-feedback')) {}
  private company(id: string) { if(!/^company-\d{3}$/.test(id))throw new Error('Invalid company');return this.data.bills(id).company; }
  private identity(o: Observation) {return hash([o.companyId,o.rowId,o.deploymentId,o.messages]);}
  private entries(id: string) { this.company(id);const unique=new Map<string,Entry>();for(const e of this.db.list<Entry>('model-feedback',id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))if(!unique.has(this.identity(e.observation)))unique.set(this.identity(e.observation),e);return [...unique.values()]; }
  private current(e: Entry) {try {const row=this.data.row(e.companyId,e.rowId);return e.deploymentId===qwenDeploymentId()&&e.observation.messages[0]?.content===POLICY&&hash(e.observation.input.transaction)===hash(evaluationEvidence(row));}catch{return false;}}
  state(id: string) {
    return {entries:this.entries(id).map(e=>{const {observation,...entry}=e;return {...entry,current:this.current(e)};}),operations:this.db.list<FeedbackOperation>('feedback-operation',id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),configured:Boolean(process.env.VERI_API_KEY&&qwenDeploymentId()),deploymentId:qwenDeploymentId()??null,exportPath:`workspace/model-feedback/${id}/preferences.jsonl`};
  }
  private active(id: string) {
    const byPrompt = new Map<string,Entry>();
    for(const entry of this.entries(id).slice().reverse())if(entry.included)byPrompt.set(hash(entry.observation.messages),entry);
    return [...byPrompt.values()];
  }
  private preferences(entries: Entry[]) { return entries.map(e=>({prompt:e.observation.messages,chosen:letter(e.chosen),rejected:letter(e.rejected)})); }
  export(id: string) {return jsonl(this.preferences(this.active(id)));}
  private materialize(id: string) {
    const folder=path.join(this.directory,id);fs.mkdirSync(folder,{recursive:true});const target=path.join(folder,'preferences.jsonl'),temp=target+'.'+randomUUID()+'.tmp';
    fs.writeFileSync(temp,this.export(id),{mode:0o600});fs.renameSync(temp,target);
  }
  record(id: string, value: {observationId: string; chosen: DecisionLabel; observed: DecisionLabel; actor: string; note?: string}) {
    this.company(id);
    const o=this.db.get<Observation>('model-observation',value.observationId);
    if(!o||o.companyId!==id)throw new Error('Evaluate this condition with Qwen before correcting it.');
    if(!valid(value.chosen)||value.observed!==o.result||value.chosen===o.result)throw new Error('Choose a different valid result.');
    if(!employeeById(value.actor)||typeof value.actor!=='string'||value.actor.length>100||!value.actor.trim()||typeof (value.note??'')!=='string'||(value.note??'').length>1000)throw new Error('Invalid reviewer or note.');
    const old=this.entries(id).find(e=>this.identity(e.observation)===this.identity(o));const key=old?.id??this.identity(o);
    if(old&&old.chosen===value.chosen&&old.note===(value.note??'')){this.materialize(id);return this.state(id);}
    const entry:Entry={id:key,companyId:id,rowId:o.rowId,vendor:o.vendor,criterion:o.criterion,chosen:value.chosen,rejected:o.result,deploymentId:o.deploymentId,createdAt:new Date().toISOString(),actor:value.actor,note:value.note??'',included:true,observation:o};
    this.db.atomic(()=>{this.db.put('model-feedback',key,id,{...old,...entry});this.db.put('model-feedback-event',randomUUID(),id,{entryId:key,actor:value.actor,chosen:value.chosen,previous:old?.chosen??null,at:entry.createdAt});});this.materialize(id);return this.state(id);
  }
  correct(id: string, value: {rowId: string; criterion: string; version: string; chosen: DecisionLabel; observed: DecisionLabel; actor: string; note?: string}) {
    this.company(id);const row=this.data.row(id,value.rowId);
    if(value.version!==String(row.sourceVersion??'0'))throw new Error('The transaction changed. Refresh before correcting it.');
    const observations=this.db.list<Observation>('model-observation',id).filter(o=>o.rowId===value.rowId&&o.criterion===value.criterion&&o.deploymentId===qwenDeploymentId()&&o.messages[0]?.content===POLICY&&hash(o.input.transaction)===hash(evaluationEvidence(row)));
    const o=observations.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    if(!o)throw new Error('No current Qwen evaluation exists for this condition and transaction. Refresh the preview first.');
    return this.record(id,{...value,observationId:o.id});
  }
  include(id: string, key: string, included: boolean) {const e=this.db.get<Entry>('model-feedback',key);if(!e||e.companyId!==id||typeof included!=='boolean')throw new Error('Unknown correction');this.db.put('model-feedback',key,id,{...e,included});this.materialize(id);return this.state(id);}
  private update(op: FeedbackOperation) {op.updatedAt=new Date().toISOString();this.db.put('feedback-operation',op.id,op.companyId,op);}
  private claim(id: string, type: 'upload'|'train', feedbackHash: string, count: number) {
    this.company(id);return this.db.atomic(()=>{
      if(this.db.list<FeedbackOperation>('feedback-operation',id).some(o=>o.status==='running'))throw new Error('An operation is already running for this company.');
      const op:FeedbackOperation={id:randomUUID(),companyId:id,type,status:'running',stage:'Preparing',createdAt:new Date().toISOString(),feedbackHash,count};this.update(op);return op;
    });
  }
  uploadPlan(id: string) {const entries=this.active(id);if(!entries.length)throw new Error('Save at least one correction first.');return {hash:hash(this.preferences(entries)),count:entries.length,destination:'Veri — https://api.veri.studio',notice:'Uploads corrected transaction text and creates separate preference and cumulative SFT snapshots. Does not start training.'};}
  async upload(id: string, confirmedHash: string) {
    const entries=this.active(id),plan=this.uploadPlan(id);if(confirmedHash!==plan.hash)throw new Error('Corrections changed. Review the upload again.');
    const deployment=qwenDeploymentId();if(!deployment)throw new Error('Qwen is not configured');
    const op=this.claim(id,'upload',plan.hash,entries.length);
    try {
      const dep=await this.client.call('/deployments/'+deployment);if(dep.source!=='training_job')throw new Error('The deployed model must originate from a completed Veri training job.');
      const job=await this.client.call('/training_jobs/'+dep.model);if(job.status!=='completed')throw new Error('Parent training job is not complete.');
      const parent=job.dataset_snapshot_id??job.dataset_id;if(!parent||!job.base_model)throw new Error('Parent dataset metadata unavailable.');
      op.parentSnapshot=parent;op.baseModel=job.base_model;op.stage='Reading original SFT examples';this.update(op);
      const [parentId,snapshot]=String(parent).split('@');let cursor:number|undefined;const base:any[]=[];
      do {
        const query=new URLSearchParams({limit:'100'});if(snapshot)query.set('snapshot',snapshot);if(cursor!==undefined)query.set(snapshot?'since':'cursor',String(cursor));
        const page=await this.client.call(`/datasets/${parentId}/rows?${query}`);
        if(!Array.isArray(page.rows))throw new Error('Invalid source dataset page');
        for(const wrapper of page.rows){const row=wrapper.row??wrapper;if(!Array.isArray(row.messages)||row.messages.at(-1)?.role!=='assistant')throw new Error('Parent dataset must contain SFT chat messages. Preference rows cannot be mixed into it.');base.push(row);}
        if(base.length>100000)throw new Error('Source dataset exceeds this demo pipeline limit.');
        const next=page.next_cursor;if(next===cursor&&next!=null)throw new Error('Dataset pagination did not advance');cursor=next??undefined;
        op.stage=`Reading original examples: ${base.length}`;this.update(op);
      }while(cursor!==undefined);
      if(!base.length)throw new Error('Original dataset is empty; refusing correction-only training.');
      op.baseRows=base.length;
      const rows=new Map<string,any>();for(const row of base)rows.set(hash(row.messages.slice(0,-1)),row);
      for(const e of entries)rows.set(hash(e.observation.messages),{messages:[...e.observation.messages,{role:'assistant',content:letter(e.chosen)}]});
      op.totalRows=rows.size;
      const snapshotUpload=async (format:'preference'|'chat',data:any[],suffix:string) => {
        const ds=await this.client.call('/datasets','POST',{name:`feedback-${op.id}-${suffix}`,format});
        for(let start=0;start<data.length;start+=200){await this.client.call(`/datasets/${ds.id}/rows`,'POST',{rows:data.slice(start,start+200)});op.stage=`Uploading ${suffix}: ${Math.min(start+200,data.length)}/${data.length}`;this.update(op);}
        return this.client.call(`/datasets/${ds.id}/snapshots`,'POST',{note:`Parent ${parent}; feedback hash ${op.feedbackHash}; originals retained, identical prompts replaced by reviewer correction.`});
      };
      op.preferencesSnapshot=(await snapshotUpload('preference',this.preferences(entries),'preferences')).id;
      op.replaySnapshot=(await snapshotUpload('chat',[...rows.values()],'sft-replay')).id;
      op.stage='Uploaded. Training has not started.';op.status='completed';this.update(op);return op;
    }catch(error){op.status='failed';op.error=error instanceof Error?error.message:'Upload failed';op.stage='Upload stopped. No training started.';this.update(op);throw error;}
  }
  async trainingPlan(id:string,uploadId:string):Promise<TrainingPlan> {
    const op=this.db.get<FeedbackOperation>('feedback-operation',uploadId);if(!op||op.companyId!==id||op.type!=='upload'||op.status!=='completed'||!op.replaySnapshot||!op.totalRows||!op.baseModel)throw new Error('Choose a completed upload.');
    if(!['Qwen/Qwen3-0.6B','Qwen/Qwen3-1.7B'].includes(op.baseModel))throw new Error('The parent base model cannot be used by this replay pipeline.');
    const estimateMinutes=Math.max(30,Math.ceil(op.totalRows/80));const estimate=await this.client.call('/cost/estimate?gpu_type=L4-24GB&gpu_count=1&provider=aws&duration_minutes='+estimateMinutes);
    const plan:Plan={token:randomUUID(),companyId:id,uploadId,feedbackHash:op.feedbackHash,examples:op.totalRows,maxSteps:Math.ceil(op.totalRows/8),baseModel:op.baseModel,estimateUsd:estimate.estimated_cost_usd,estimateMinutes,expiresAt:new Date(Date.now()+600000).toISOString()};
    this.db.put('feedback-training-plan',plan.token,id,plan);const {companyId,feedbackHash,...view}=plan;return view;
  }
  async train(id:string,token:string,confirmed:boolean) {
    const p=this.db.get<Plan>('feedback-training-plan',token);if(!confirmed||!p||p.companyId!==id||p.used||Date.parse(p.expiresAt)<Date.now())throw new Error('Review a fresh training estimate and explicitly confirm paid training.');
    const upload=this.db.get<FeedbackOperation>('feedback-operation',p.uploadId)!;
    const prior=this.db.list<FeedbackOperation>('feedback-operation',id).find(o=>o.type==='train'&&o.datasetId===upload.replaySnapshot&&o.jobId);if(prior)return prior;
    const op=this.claim(id,'train',p.feedbackHash,upload.count);op.datasetId=upload.replaySnapshot;op.outputName=`feedback-replay-${p.uploadId}`;this.db.atomic(()=>{const current=this.db.get<Plan>('feedback-training-plan',token)!;if(current.used)throw new Error('Training already confirmed');this.db.put('feedback-training-plan',token,id,{...current,used:true});this.update(op);});
    try {
      const balance=await this.client.call('/billing/balance');if(balance.balance_usd<p.estimateUsd)throw new Error('Insufficient credits for the displayed planning estimate.');
      // Stable output name recovers an accepted submission after an interrupted HTTP response.
      let job:any,after:string|undefined;
      for(let page=0;page<20;page++) {
        const existing=await this.client.call('/training_jobs?limit=100'+(after?'&after='+encodeURIComponent(after):''));
        job=existing.data?.find((j:any)=>j.output_name===op.outputName);if(job||!existing.has_more)break;
        after=existing.data?.at(-1)?.id;if(!after||page===19)throw new Error('Cannot safely verify earlier submissions. Check Veri before retrying.');
      }
      if(!job)job=await this.client.call('/training_jobs','POST',{base_model:p.baseModel,dataset_id:upload.replaySnapshot,output_name:op.outputName,method:'sft_text',hyperparameters:{learning_rate:2e-5,num_epochs:1,max_steps:p.maxSteps,max_seq_length:1024,micro_batch_size:1,gradient_accumulation_steps:8,gradient_checkpointing:true},gpu:{gpu_type:'L4-24GB',gpu_count:1},provider:'aws',requires_heartbeat:false});
      op.jobId=job.id;op.jobStatus=job.status;op.status='completed';op.stage='Training submitted. Existing deployment unchanged.';this.update(op);return op;
    }catch(error){op.status='failed';op.error=error instanceof Error?error.message:'Training submission failed';op.stage='Submission stopped; check Veri before retrying.';this.update(op);throw error;}
  }
  async reconcile(id:string,operationId:string) {
    const op=this.db.get<FeedbackOperation>('feedback-operation',operationId);
    if(!op||op.companyId!==id||op.status!=='running')throw new Error('Unknown running operation');
    if(Date.now()-Date.parse(op.updatedAt??op.createdAt)<600000)throw new Error('This operation has recent progress. Recheck after ten minutes without progress.');
    if(op.type==='train'&&op.outputName) {
      let after:string|undefined;
      for(let page=0;page<20;page++) {
        const list=await this.client.call('/training_jobs?limit=100'+(after?'&after='+encodeURIComponent(after):''));
        const job=list.data?.find((j:any)=>j.output_name===op.outputName);
        if(job){op.jobId=job.id;op.jobStatus=job.status;op.status='completed';op.stage='Recovered existing Veri job. No new training submitted.';this.update(op);return this.state(id);}
        if(!list.has_more)break;after=list.data?.at(-1)?.id;if(!after||page===19)throw new Error('Cannot safely check remote jobs. Inspect Veri before retrying.');
      }
    }
    op.status='failed';op.error='Local operation interrupted. Remote datasets were preserved; no automatic retry or training was started.';op.stage='Interrupted; review and confirm a new operation if needed.';this.update(op);return this.state(id);
  }
  async refreshJob(id:string,operationId:string) {const op=this.db.get<FeedbackOperation>('feedback-operation',operationId);if(!op||op.companyId!==id||!op.jobId)throw new Error('Unknown training job');const j=await this.client.call('/training_jobs/'+op.jobId);op.jobStatus=j.status;op.stage=`Training: ${j.status}${j.current_step!=null?' · step '+j.current_step:''}`;this.update(op);return this.state(id);}
}
export function feedbackRoutes(app:Express, service:ModelFeedbackService) {
  const route=(fn:(req:Request,res:Response)=>Promise<unknown>|unknown)=>(req:Request,res:Response)=>{Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(400).json({error:e instanceof Error?e.message:'Feedback operation failed'}));};
  const company=(req:Request)=>String(req.params.id);
  app.get('/api/companies/:id/model-feedback',route((req,res)=>res.json(service.state(company(req)))));
  app.get('/api/companies/:id/model-feedback/export',route((req,res)=>res.type('application/x-ndjson').attachment('model-feedback.jsonl').send(service.export(company(req)))));
  app.post('/api/companies/:id/model-feedback',route((req,res)=>res.json(service.correct(company(req),req.body))));
  app.patch('/api/companies/:id/model-feedback/:entryId',route((req,res)=>res.json(service.include(company(req),String(req.params.entryId),req.body.included))));
  app.post('/api/companies/:id/model-feedback/upload-plan',route((req,res)=>res.json(service.uploadPlan(company(req)))));
  app.post('/api/companies/:id/model-feedback/upload',route(async(req,res)=>{if(req.body.confirm!==true)throw new Error('Confirm the upload first.');res.json(await service.upload(company(req),req.body.hash));}));
  app.post('/api/companies/:id/model-feedback/training-plan',route(async(req,res)=>res.json(await service.trainingPlan(company(req),req.body.uploadId))));
  app.post('/api/companies/:id/model-feedback/train',route(async(req,res)=>res.json(await service.train(company(req),req.body.token,req.body.confirm===true))));
  app.post('/api/companies/:id/model-feedback/reconcile',route(async(req,res)=>res.json(await service.reconcile(company(req),req.body.operationId))));
  app.post('/api/companies/:id/model-feedback/job-status',route(async(req,res)=>res.json(await service.refreshJob(company(req),req.body.operationId))));
}
