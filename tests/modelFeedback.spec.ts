import {expect,test} from '@playwright/test';
import {startRuleApp} from './fixtures/ruleApp';
test('a correction is local and upload needs a separate confirmation',async({page})=>{
 const app=await startRuleApp({feedback:true});
 try {
  await page.goto(app.url+'/?model=qwen&workspace=rules');
  await page.getByRole('button',{name:'New rule',exact:true}).click();
  await page.getByLabel('Condition 1',{exact:true}).fill('The transaction needs supporting documentation.');
  await page.getByRole('button',{name:'Review results',exact:true}).click();
  await page.getByLabel('Preview rows').selectOption('all');
  await page.getByRole('group',{name:'Correct result',exact:true}).first().getByRole('button',{name:'Match',exact:true}).click();
  await expect(page.getByText('Saved locally. No upload or training started.')).toBeVisible();
  await expect(page.getByLabel('Model feedback pipeline')).toHaveCount(0);
  await page.getByRole('button',{name:'Model feedback',exact:true}).click();
  await page.getByRole('button',{name:'Rules',exact:true}).click();
  await expect(page.getByText('Correction saved: Match',{exact:true})).toBeVisible();
  await expect(page.getByRole('group',{name:'Correct result',exact:true}).first().getByRole('button',{name:'Match',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Correct Qwen',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Correction note')).toHaveCount(0);
  await page.getByRole('button',{name:'Model feedback',exact:true}).click();
  await expect(page.getByRole('table',{name:'Human corrections',exact:true})).toContainText('Human correction');
  await page.getByRole('button',{name:'View JSONL',exact:true}).click();
  await expect(page.getByLabel('JSONL preview')).toContainText('"chosen":"A"');
  await page.getByRole('button',{name:/^Discard correction for /}).click();
  await expect(page.getByText('0 included corrections',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Discard correction for /})).toHaveCount(0);
  const exported=await page.request.get(app.url+'/api/companies/company-018/model-feedback/export');expect(await exported.text()).toBe('');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Model feedback & training'})).toBeVisible();
  const state=await(await page.request.get(app.url+'/api/companies/company-018/model-feedback')).json();expect(state.entries).toHaveLength(1);expect(state.entries[0].included).toBe(false);expect(state.operations).toHaveLength(0);
 }finally{await app.close();}
});
