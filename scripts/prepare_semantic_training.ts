import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decisionMessages } from '../server/modelContract.ts';

/** Frozen experiment reproduction only. New overlays require a separately versioned experiment. No model calls. */
export function prepareFrozenTraining(out: string, includeTeacher = false, archive = path.resolve('training/semantic-review')) {
  const target = path.resolve(out), frozen = path.resolve(archive);
  if (target === frozen || target.startsWith(frozen + path.sep)) throw new Error('Choose a new output directory outside the frozen training archive.');
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('Output directory must be new or empty; existing preparations are never overwritten.');
  const read = (file: string) => fs.readFileSync(path.join(frozen, file), 'utf8');
  const jsonl = (file: string): any[] => read(file).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const splits = JSON.parse(read('splits.json')) as Record<string,string[]>;
  const population = Object.values(splits).flat();
  if (splits.train.length !== 70 || splits.validation.length !== 15 || splits.test.length !== 15 || new Set(population).size !== 100
    || population.some(id => !/^company-(00[1-9]|0[1-9][0-9]|100)$/.test(id))) throw new Error('Frozen source population must be the original 70/15/15 companies.');
  const cases = Object.fromEntries(['train','validation','test'].map(split => [split,jsonl(split + '-cases.jsonl')]));
  for (const [split, examples] of Object.entries(cases)) {
    if (examples.length !== (split === 'train' ? 800 : 220) || examples.some(example => !splits[split].includes(example.companyId))) throw new Error('Frozen examples do not match split identities.');
  }
  const teacher = includeTeacher ? jsonl('teacher-cases.jsonl') : [];
  if (includeTeacher && (teacher.length !== 200 || teacher.some(example => !splits.train.includes(example.companyId)))) throw new Error('Teacher augmentation must contain 200 train-company examples.');
  const examples = [...cases.train, ...teacher];
  const label = { match: 'A', no_match: 'B', uncertain: 'C' };
  if (examples.some(example => !Object.hasOwn(label,example.label))) throw new Error('Invalid frozen label.');
  const files = ['splits.json','train-cases.jsonl','validation-cases.jsonl','test-cases.jsonl','demo-holdout.jsonl', ...(includeTeacher ? ['teacher-cases.jsonl'] : [])];
  const hashes = Object.fromEntries(files.map(file => [file,createHash('sha256').update(read(file)).digest('hex')]));
  const manifest = { version: 'frozen-reproduction-v1', seed: 2601017, sourcePopulation: population.slice().sort(), splits,
    examples: { overlays:800,teacher:teacher.length,training:examples.length,validation:220,test:220 }, sourceHashes:hashes,
    policyHash:createHash('sha256').update(decisionMessages(examples[0].input)[0].content).digest('hex'),
    preparation: includeTeacher ? 'teacher-augmented assembly' : 'overlay-only assembly',
    note:'Copies frozen authored overlays and optional existing unreviewed teacher cases. No runtime company listing, source mutation, inference or training. This reproduces inputs; it does not establish accuracy on companies 101–104.' };
  fs.mkdirSync(target,{recursive:true});
  for (const file of files) fs.writeFileSync(path.join(target,file),read(file),{flag:'wx'});
  fs.writeFileSync(path.join(target,'train.jsonl'),examples.map(example => JSON.stringify({ messages:[...decisionMessages(example.input),{role:'assistant',content:label[example.label as keyof typeof label]}] })).join('\n')+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(target,'preparation.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const index = process.argv.indexOf('--out');
  if (index < 0 || !process.argv[index+1]) throw new Error('Usage: tsx scripts/prepare_semantic_training.ts --out <new-version-directory> [--teacher]');
  console.log(JSON.stringify(prepareFrozenTraining(process.argv[index+1], process.argv.includes('--teacher')),null,2));
}
