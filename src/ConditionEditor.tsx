import { useId } from 'react';
import type { CompanyBills } from './types';
import { leaves, uid, type Group, type RuleNode, type StandardCondition } from './rules';
const groupLabel = { all: 'AND', any: 'OR', not: 'NOT' };
const changeNode = (node: RuleNode, id: string, update: (node: RuleNode) => RuleNode): RuleNode => node.id === id ? update(node) : 'children' in node ? { ...node, children: node.children.map(child => changeNode(child, id, update)) } : node;
const removeNode = (node: RuleNode, id: string): RuleNode => 'children' in node ? { ...node, children: node.children.filter(child => child.id !== id).map(child => removeNode(child, id)) } : node;
const newCondition = (): RuleNode => ({ id: uid(), type: 'ai', text: '', label: '' });
export const conditionText = (node: RuleNode): string => node.type === 'ai' ? node.text : node.type === 'standard' ? `${node.field === 'amountCents' ? 'Amount' : node.field === 'review' ? 'Review status' : node.field} ${node.operator === 'gt' ? '>' : node.operator === 'lt' ? '<' : '='} ${node.field === 'amountCents' ? '$' : ''}${node.value}` : node.type === 'not' ? `NOT (${node.children.map(conditionText).join(' ')})` : `(${node.children.map(conditionText).join(` ${groupLabel[node.type]} `)})`;

export function ConditionEditor({ expression, onChange, data }: { expression: RuleNode; onChange: (node: RuleNode) => void; data: CompanyBills }) {
  const instance = useId();
  const conditions = leaves(expression);
  const updateTree = (expression: RuleNode) => onChange(expression);
  const update = (id: string, transform: (node: RuleNode) => RuleNode) => updateTree(changeNode(expression, id, transform));
  const add = (id: string, type: 'ai' | 'group' | StandardCondition['field']) => {
    const node: RuleNode = type === 'ai' ? newCondition() : type === 'group' ? { id: uid(), type: 'any', children: [newCondition()] }
      : { id: uid(), type: 'standard', field: type, operator: type === 'amountCents' ? 'gt' : 'eq', value: type === 'amountCents' ? '500' : type === 'review' ? 'needs_review' : '' };
    update(id, parent => 'children' in parent ? { ...parent, children: [...parent.children, node] } : { id: uid(), type: 'all', children: [parent, node] });
  };
  const addControls = (node: RuleNode, depth: number) => <div className="wizard-add-controls">
    <button onClick={() => add(node.id, 'ai')}>Add condition</button>
    <button className="ghost" disabled={depth >= 3} title={depth >= 3 ? 'At most three group levels' : undefined} onClick={() => add(node.id, 'group')}>Add group</button>
    <details className="wizard-extra-filter"><summary>Add a filter</summary><div>{(['amountCents', 'review', 'vendor', 'account'] as const).map(field => <button key={field} onClick={() => add(node.id, field)}>{{ amountCents: 'Amount', review: 'Review status', vendor: data.company.synthetic ? 'Counterparty' : 'Vendor', account: 'Category' }[field]}</button>)}</div></details>
  </div>;
  const renderNode = (node: RuleNode, depth: number, parent?: Group): React.ReactNode => {
    if ('children' in node) return <section className={`wizard-condition-group ${parent ? 'nested' : ''}`} key={node.id} data-testid={`node-${node.type}`} aria-label={parent ? 'Nested condition group' : 'Conditions'}>
      <div className="wizard-group-heading"><select aria-label="Group logic" value={node.type} onChange={event => update(node.id, current => ({ ...current, type: event.target.value } as Group))}>
        <option value="all">AND</option><option value="any">OR</option><option value="not" disabled={node.children.length !== 1}>NOT</option>
      </select>{parent && <button className="ghost" onClick={() => updateTree(removeNode(expression, node.id))} aria-label={`Remove ${groupLabel[node.type]} group`}>Remove group</button>}</div>
      {node.children.map((child, index) => <div key={child.id}>{index > 0 && <div className="wizard-connector">{groupLabel[node.type]}</div>}{renderNode(child, depth + 1, node)}</div>)}
      {!node.children.length && <p className="wizard-help">Add a condition to this group.</p>}
      {(node.type !== 'not' || !node.children.length) && addControls(node, depth)}
    </section>;
    const number = conditions.findIndex(condition => condition.id === node.id) + 1;
    const options = data.referenceOptions ?? { vendors: [...new Set(data.rows.map(row => row.vendor))].sort(), accounts: [...new Set(data.rows.map(row => row.account))].sort() };
    return <section className="wizard-condition" key={node.id} data-testid={`node-${node.type}`}>
      <div className="wizard-condition-heading"><label htmlFor={`condition-${instance}-${node.id}`}>Condition {number}{parent?.type === 'not' && <span className="wizard-negation">NOT</span>}</label>{parent && <button className="ghost" aria-label={`Remove condition ${number}`} onClick={() => updateTree(removeNode(expression, node.id))}>Remove</button>}</div>
      {node.type === 'ai' ? <textarea id={`condition-${instance}-${node.id}`} aria-label={`Condition ${number}`} rows={3} maxLength={500} placeholder="Describe what should be true about this transaction…" value={node.text} onChange={event => update(node.id, current => ({ ...current, text: event.target.value } as RuleNode))} /> : <div className="wizard-standard-condition">
        <select id={`condition-${instance}-${node.id}`} aria-label="Condition field" value={node.field} onChange={event => { const field = event.target.value as StandardCondition['field']; update(node.id, current => ({ ...current, field, operator: field === 'amountCents' ? 'gt' : 'eq', value: field === 'amountCents' ? '500' : field === 'review' ? 'needs_review' : '' } as StandardCondition)); }}>
          <option value="amountCents">Amount</option><option value="review">Review status</option><option value="vendor">{data.company.synthetic ? 'Counterparty' : 'Vendor'}</option><option value="account">Category</option>
        </select><select aria-label="Comparison" value={node.operator} onChange={event => update(node.id, current => ({ ...current, operator: event.target.value } as StandardCondition))}>
          {node.field === 'amountCents' ? <><option value="gt">Over</option><option value="lt">Under</option><option value="eq">Equals</option></> : <option value="eq">Is</option>}
        </select>{node.field === 'amountCents' ? <label className="wizard-money">$<input aria-label="Amount in dollars" inputMode="decimal" value={node.value} onChange={event => update(node.id, current => ({ ...current, value: event.target.value } as StandardCondition))} /></label>
          : <select aria-label="Condition value" value={node.value} onChange={event => update(node.id, current => ({ ...current, value: event.target.value } as StandardCondition))}><option value="">Choose…</option>{(node.field === 'review' ? [['needs_review', 'Needs review'], ['reviewed', 'Reviewed']] : (node.field === 'vendor' ? options.vendors : options.accounts).map(value => [value, value])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
      </div>}
      {node.type === 'ai' && <details className="wizard-condition-label"><summary>Optional label</summary><input aria-label="Condition label" value={node.label} placeholder={`Condition ${number}`} onChange={event => update(node.id, current => ({ ...current, label: event.target.value } as RuleNode))} /></details>}
      {!parent && addControls(node, 1)}
    </section>;
  };

  return <>{renderNode(expression, 1)}</>;
}
