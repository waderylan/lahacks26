/**
 * Display order while a semantic query is active: matches first, everything else after,
 * each group keeping the base (sorted) order. With no query, the base order is returned
 * unchanged, which is what puts rows back in their original positions.
 */
export function arrangeRows<T extends { id: string }>(base: T[], isMatch: (id: string) => boolean, active: boolean): T[] {
  if (!active) return base;
  const matches: T[] = [];
  const rest: T[] = [];
  for (const r of base) (isMatch(r.id) ? matches : rest).push(r);
  return matches.length === 0 || rest.length === 0 ? base : [...matches, ...rest];
}

export interface MatchResult {
  state: 'match' | 'no_match' | 'uncertain';
  pMatch: number;
}


/** Stable sort by P(match). dir -1: highest first; dir 1: lowest first. Unevaluated rows always stay last. */
export function sortByMatch<T extends { id: string }>(rows: T[], resultOf: (id: string) => MatchResult | undefined, dir: 1 | -1): T[] {
  const keyed = rows.map((row, i) => ({ row, i, p: resultOf(row.id)?.pMatch }));
  keyed.sort((a, b) => {
    if (a.p === undefined || b.p === undefined) return Number(a.p === undefined) - Number(b.p === undefined) || a.i - b.i;
    return (a.p === b.p ? 0 : (a.p - b.p) * dir) || a.i - b.i;
  });
  return keyed.map((k) => k.row);
}
