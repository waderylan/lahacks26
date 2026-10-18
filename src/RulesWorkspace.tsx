import { CorrectionHistory } from './ModelFeedback';
import { CompanyRules } from './CompanyRules';
import type { CompanyBills } from './types';
import type { RulesController } from './useRules';
import type { Rule } from './rules';
import { inScope } from './ruleScope';
import { RuleWizard } from './RuleWizard';

function RulesWorkspaceContent({ c, data, editor, onEditor, onInspect, onMessages, onActivity, onExplore, onDemoSample, onRestore, restoring }: {
  c: RulesController; data: CompanyBills; editor: number | null; onEditor: (step: number | null) => void;
  onInspect: (id: string) => void; onMessages: () => void; onActivity: () => void; onExplore: (rule: Rule) => void; onDemoSample: () => void;
  onRestore: () => Promise<boolean>; restoring: boolean;
}) {
  if (editor !== null) return <RuleWizard c={c} data={{ ...data, rows: data.rows.filter(row => inScope(row, c.draft?.scope)) }} initialStep={editor} onStepChange={onEditor} onClose={() => onEditor(null)} onInspect={onInspect} onMessages={onMessages} onActivity={onActivity} onExplore={() => c.draft && onExplore(c.draft)} />;
  return <CompanyRules c={c} data={data} onEdit={() => onEditor(0)} onPreview={rule => { c.selectRule(rule.id); onEditor(2); }} onExplore={onExplore} onInspect={onInspect} onDemoSample={onDemoSample} onRestore={onRestore} restoring={restoring} />;
}

export function RulesWorkspace(props: Parameters<typeof RulesWorkspaceContent>[0]) {return <CorrectionHistory key={props.data.company.companyId} companyId={props.data.company.companyId}><RulesWorkspaceContent {...props}/></CorrectionHistory>;}
