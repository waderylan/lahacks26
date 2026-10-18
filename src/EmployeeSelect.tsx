import { ownerKey, ownerOptions } from './employees';

/**
 * Picks an employee. The stored value is the employee ID; older names resolve to the same employee, and any other stored
 * label stays selectable (pass it as `extra`) so existing assignments are never silently replaced.
 */
export function EmployeeSelect({ value, onChange, label, extra = [], emptyLabel, disabled }: {
  value: string; onChange: (value: string) => void; label: string; extra?: (string | undefined | null)[]; emptyLabel?: string; disabled?: boolean;
}) {
  return <select aria-label={label} value={ownerKey(value)} disabled={disabled} onChange={event => onChange(event.target.value)}>
    {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
    {ownerOptions([value, ...extra]).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}
