import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { RuleService } from './ruleService.ts';
import { rulePresets, savedPreset, leaves } from '../src/rules.ts';
import { STARTER_DEMOS } from '../src/ruleStarterDemos.ts';
import { demoSample } from './data.ts';

test('starter installs are company scoped, idempotent, and do not execute actions', () => {
  const db = new ActionStore(':memory:');
  const data = new WorkspaceData(db);
  let judged = 0;
  const service = new RuleService(db, data, async () => { judged++; throw new Error('Adding must not judge or run'); });
  try {
    for (const company of ['company-101', 'company-102', 'company-103', 'company-104']) {
      for (const preset of rulePresets(true).filter(preset => preset.starter)) {
        const id = service.addPreset(company, preset.id, 'emp-controller');
        assert.equal(service.addPreset(company, preset.id, 'emp-ap'), id);
      }
      const snapshot = service.snapshot(company);
      assert.equal(snapshot.store.rules.length, 4);
      assert.ok(snapshot.store.rules.every(rule => rule.companyId === company && !rule.enabled && rule.presetId));
      assert.ok(snapshot.store.rules.flatMap(rule => rule.actions).filter(action => action.type === 'message').every(action => action.sender === 'emp-controller'));
      assert.deepEqual(snapshot.store.history, []);
      assert.deepEqual(snapshot.store.messages, []);
      assert.deepEqual(db.list('task', company), []);
      assert.ok(data.bills(company).rows.every(row => !row.dashboard?.flags.length));
      const demo = STARTER_DEMOS[company];
      assert.ok(demoSample(company)?.ids.has(demo.rowId));
      assert.ok(data.row(company, `${company}:${demo.rowId}`).evidence?.length);
    }
    assert.equal(new Set(db.list<{ store: { rules: { id: string }[] } }>('rule-state').flatMap(state => state.store.rules.map(rule => rule.id))).size, 16);
    assert.equal(judged, 0);
    assert.throws(() => service.addPreset('company-101', 'unknown', 'emp-ap'), /valid rule starter/);
    assert.throws(() => service.addPreset('company-101', 'payment-fraud', 'unknown'), /valid rule starter/);
  } finally { db.db.close(); }
});

test('renamed, edited starters survive a new service and adding again preserves the saved revision', () => {
  const db = new ActionStore(':memory:');
  const data = new WorkspaceData(db);
  const judge = async () => ({});
  const service = new RuleService(db, data, judge);
  try {
    const id = service.addPreset('company-101', 'missing-documentation', 'emp-ap');
    const rule = service.snapshot('company-101').store.rules[0];
    service.save('company-101', { ...rule, name: 'Parcelmint documentation policy', expression: { id: 'custom', type: 'ai', label: 'Receipt check', text: 'This charge needs an itemized receipt.' } }, 1);
    const reopened = new RuleService(db, new WorkspaceData(db), judge);
    assert.equal(reopened.addPreset('company-101', 'missing-documentation', 'emp-controller'), id);
    const saved = reopened.snapshot('company-101').store.rules;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].revision, 2);
    assert.equal(saved[0].name, 'Parcelmint documentation policy');
    assert.equal(leaves(saved[0].expression)[0].id, 'custom');
    assert.equal(savedPreset(saved, rulePresets(true).find(preset => preset.id === 'missing-documentation')!, 'company-101')?.id, id);
  } finally { db.db.close(); }
});

test('the teammate’s existing fraud preset is recognized without its new library marker', () => {
  const db = new ActionStore(':memory:');
  const service = new RuleService(db, new WorkspaceData(db), async () => ({}));
  try {
    const preset = rulePresets(true).find(preset => preset.id === 'payment-fraud')!;
    const { presetId: _, ...legacy } = preset.build('company-104', 'emp-ap');
    legacy.name = 'Catering payment controls';
    service.save('company-104', legacy, null);
    assert.equal(service.addPreset('company-104', 'payment-fraud', 'emp-controller'), legacy.id);
    assert.equal(service.snapshot('company-104').store.rules.length, 1);
    assert.equal(service.snapshot('company-104').store.rules[0].name, legacy.name);
  } finally { db.db.close(); }
});
