import fs from 'node:fs';
const dir='training/semantic-review';
const read=(f:string)=>fs.existsSync(`${dir}/${f}`)?JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8')):null;
const models=['heuristic','jev','gemini-lite','base','qwen','base17','qwen17'].map(name=>({name,quality:read(`${name}-benchmark.json`),workload:read(`${name}-workload.json`)}));
const dollars=(nano:string)=>{const n=BigInt(nano);return `${n/1_000_000_000n}.${(n%1_000_000_000n).toString().padStart(9,'0')}`;};
const f=(n:number|undefined|null)=>n==null?'Pending':`${(n*100).toFixed(1)}%`;
let text='# Semantic review: Jev vs Gemini Flash-Lite vs Qwen vs keyword rules\n\n';
text+='Same 370 authored-reference cases: 150 existing demo cases and all 220 held-out synthetic overlays. Original records are not modified. Teacher labels are training-only imitation targets. This is a limited hackathon evaluation, not production accounting validation.\n\n';
text+='| Model | Exact state accuracy | Errors | False matches | Uncertain recall | 50-row app workload |\n|---|---:|---:|---:|---:|---:|\n';
const names:Record<string,string>={heuristic:'Keyword rules',jev:'Jev',gemini:'Gemini 3.5 Flash (Gemini key)','gemini-lite':'Gemini 3.5 Flash-Lite (Gemini key)',base:'Qwen3-0.6B original',qwen:'Qwen3-0.6B SFT',base17:'Qwen3-1.7B original',qwen17:'Qwen3-1.7B SFT'};
for(const m of models)text+=`| ${names[m.name]} | ${f(m.quality?.accuracy)} | ${m.quality?.errors??'Pending'} | ${m.quality?.falseMatches??'Pending'} | ${f(m.quality?.uncertainRecall)} | ${m.workload?`${(m.workload.totalMs/1000).toFixed(2)} s`:'Not measured'} |\n`;
text+='\nGemini baselines get the same visible fields, Jev\'s judging instructions and answer options in one batch prompt per group of up to 20 cases, on GEMINI_API_KEY (the AI Gateway key is Jev-only). Gemini returns labels without probabilities; its batch times are model response times, excluding free-tier rate-limit waits.\n';
for(const name of ['gemini-lite']){const q=read(`${name}-benchmark.json`);if(q?.geminiTokens!=null)text+=`\n${names[name]}: ${q.geminiTokens.toLocaleString('en-US')} tokens for ${q.n} cases.\n`;}
text+='\nGemini 3.5 Flash is not included: the free-tier Gemini key allows 20 Flash requests per day and this benchmark needs about 70 (one per company and criterion group). Flash-Lite is the Gemini comparison.\n';
text+='\nJev uses native multi-question requests. Qwen is a generative single-record classifier with bounded concurrency. The 50-row test is one warm-server run with the app concurrency settings; do not generalize it as a statistical speed benchmark. Missing or invalid answers count as errors. Per-request Jev billing and GPU-hour Veri billing are different cost models. Raw Qwen scores are uncalibrated. Optional monotonic calibration uses only held-out synthetic validation cases; real-world calibration is not established. Absent logprobs do not become invented probabilities.\n';
for(const name of ['jev','qwen','qwen17']){const w=read(`${name}-workload.json`);if(w)text+=`\n${name} 50-row reported request cost: ${w.requestCostNanoUsd==null?'unavailable (GPU time for Qwen)':`$${dollars(w.requestCostNanoUsd)}`}.\n`;}
for(const suffix of ['', '-all']){
 const j=read(`jev-workload${suffix}.json`);
 for(const name of ['qwen','qwen17']){
  const q=read(`${name}-workload${suffix}.json`);
  if(j&&q){const a=new Map(j.results.map((r:any)=>[r.id,r.state]));const n=q.results.filter((r:any)=>a.get(r.id)===r.state).length;text+=`\n${names[name]} agreement on ${q.results.length} original company-018 records: ${n}/${q.results.length}. Jev agreement is not independent ground truth. Workload time: Jev ${(j.totalMs/1000).toFixed(2)} s; Qwen ${(q.totalMs/1000).toFixed(2)} s.\n`;}
 }
}
text+='\nTraining: Qwen3-0.6B and Qwen3-1.7B, full SFT on the same frozen 1,000 examples (800 authored overlays + 200 unreviewed Jev teacher labels), one L4 per job, up to 125 steps. The 1.7B variant was selected after 0.6B validation accuracy of 70.9%, not by changing test labels. No claim of architectural equivalence to Jev or full arbitrary-criterion generalization. See data-audit.json and README.md for overlap and limitations.\n';
const tuned17=read('qwen17-benchmark.json');
if(tuned17)text+='\nRecommendation: retain Jev as the default. The 1.7B model is a working experimental integration, not a quality-equivalent replacement. Its 85% validation accuracy fell to 67.6% on the independent test (54.7% on the existing demo cases; 76.4% on synthetic overlays). It produced 79 false matches versus 13 for Jev. This gap shows limited generalization. Original 1.7B is evaluated under the same strict eight-token letter-output contract; its 89 invalid responses do not establish its performance under longer, optimized prompting. Neither tuned model demonstrates a combined accuracy/speed advantage over Jev in these measurements.\n';
fs.writeFileSync(`${dir}/COMPARISON.md`,text);console.log(text);

for(const name of ['qwen','qwen17']){
 const calibration=read(name==='qwen'?'calibration.json':'qwen17/calibration.json'),test=read(`${name}-benchmark.json`);
 if(calibration&&test){const addition=`\n${names[name]} calibration used ${calibration.n} validation cases. On the separate test set, match-score Brier was ${test.rawMatchBrier?.toFixed(4)} raw and ${test.matchBrier?.toFixed(4)} adjusted (lower is better), with ${(100*test.scoreCoverage).toFixed(1)}% score coverage. State predictions are unchanged by calibration.\n`;fs.appendFileSync(`${dir}/COMPARISON.md`,addition);}
}
