# Rule starter packs

This branch starts from `feat/combined-review-automation` (`f79b74d`) and merges
`origin/main` (`8c95b3a`), including the teammate's **Possible payment fraud**
preset, Payment risk, and Ask your books.

## Open the preview

`http://localhost:5192/?workspace=rules`

The combined preview uses `workspace/combined.sqlite`. Its saved rules, views,
messages, and review state are preserved. The separate starter worktree and its
database remain unchanged.

```powershell
$env:PORT = '5192'
$env:WORKSPACE_DB = Join-Path (Get-Location) 'workspace/combined.sqlite'
npm run dev
```

## Manage company rules

**Rules** opens a table of every saved rule for the selected company.

- **Keep checking** switches each rule on or off. On watches new or changed records;
  it establishes a baseline without immediately running on historical records.
- **Run now** opens a preview before applying actions to its visible results.
- **Run all records** asks for confirmation, then applies the saved rule's actions
  to all available company records within its record filters. It works while
  Keep checking is off and includes records outside the preview sample.
  Reserved records join after replay. Results and the check time
  persist in SQLite, including runs with no matches. Editing a rule marks older
  results with their original revision.
- **Edit rule** opens the guided editor. **All rules** returns to this table.
- **Delete** removes the saved rule and stops future automatic runs after an
  inline confirmation. Existing tasks, flags, messages, and history are kept.
  A stale editor cannot recreate the deleted rule, and a run still being
  evaluated cannot apply actions after deletion.
- **New rule** starts a blank draft. The collapsed **Rule starter packs** below
  the table supplies editable examples.

## Add and edit a starter

1. Open **Rules**. Expand **Rule starter packs** using its header or chevron.
   It starts collapsed and shows four accounting checks with
   **Ready to add** or **Saved · Keep checking on/off**. The company table lists
   custom rules and saved examples together.
2. **Add rule** immediately saves an editable starter with automatic runs off.
   It does not flag records, create tasks, generate messages, or run the rule.
   Repeated adds reopen the existing rule and preserve edits. **Open rule**
   reopens a saved starter even after it is renamed or its conditions change.
   Older saved fraud presets with the same conditions are recognized too.
3. Edit English conditions, then **Choose actions**. **More examples** in the
   same library includes the earlier examples and can start an unsaved draft.
4. Open **Review results**. Review Match, Not enough information and No match,
   plus the planned actions. Save edits before **Run now**. The visible result
   and transaction filters limit the manual run; **All results** includes the
   configured clarification tasks for uncertain records.

| Starter | Match actions | Not enough information |
|---|---|---|
| Possible duplicate charges | Flag, AP review task, Jev-routed message draft | AP clarification task |
| Missing documentation | Flag, AP documentation task, Jev-routed message draft | AP clarification task |
| Possible payment fraud | Existing diversion flag and CFO message draft | No action, as in the teammate's preset |
| Unsupported expenses | Flag, project-manager review task, Jev-routed message draft | Project-manager clarification task |

New accounting tasks are due in two days. Message drafts use the employee
selected under **Viewing as** as their sender; approval is still required.
The three new starters enable cleanup after a later No match, using the
combined branch's existing resolution behavior. The fraud preset's conditions,
grouping, CFO routing and match actions are unchanged.

## Four-company walkthrough

Turn on **Custom data**, choose a company, and select **Use demo sample**.
The existing curated sample emphasizes review cases and is not representative.
Each company highlights a suggested starter and **Inspect example** opens the
existing source record, including when it falls outside the current 50 rows.

| Company | Try first | Example and evidence |
|---|---|---|
| Parcelmint Online Goods (101) | Possible duplicate charges | `bill-00106`, INV-3381: reissued phone-case charge matching the earlier amount and purchase order. The original INV-3318 remains a separate record. |
| Tallowfield Home Renovations (102) | Unsupported expenses | `bill-00145`, INV-4292: sitework billed after the project's cancellation and stand-down notice. |
| Quillstone Creative Studio (103) | Missing documentation | `bill-00055`, CS-202601-02: production supplies with an unitemized receipt. The live check returned uncertain, demonstrating its clarification-task branch. |
| Marrow & Vine Catering (104) | Possible payment fraud | `bill-00097`, INV-3089: requests account 7731 while 9631 is on file, discourages confirmation calls, and lacks a verified change. Inspect records, review results, then run to flag and draft the CFO request. |

The payment example is a synthetic suspected-diversion scenario, not a finding
about a real company. No source records or dataset files were modified. The
library uses public business evidence only; it never reads `hidden/` or
`synthetic/eval/` and does not supply scenario labels to Jev.

## Live verification

Measured through the real `/api/evaluate` route on October 17, 2026. Values are
**Match / Not enough information** counts on the available curated records;
other records returned No match. The last five reserved records stay excluded
until replayed. These are model results, not accuracy scores or preset totals.

| Company | Loaded | Duplicates | Missing docs | Payment fraud | Unsupported |
|---|---:|---:|---:|---:|---:|
| Parcelmint | 131 | 22 / 34 | 28 / 9 | 7 / 17 | 10 / 42 |
| Tallowfield | 140 | 27 / 27 | 21 / 9 | 9 / 14 | 19 / 33 |
| Quillstone | 140 | 26 / 37 | 12 / 20 | 7 / 14 | 24 / 39 |
| Marrow & Vine | 140 | 25 / 34 | 10 / 21 | 6 / 16 | 22 / 34 |

The duplication, unsupported-work and payment-diversion recommended records
matched; the documentation example returned uncertain and has a clarification
task configured. Results can differ with evidence edits or later model calls.
The library shows live results in the existing wizard, never these recorded
counts as a prediction.

```powershell
npm run typecheck
npm test
npm run build
npx playwright test tests/companyRules.spec.ts tests/ruleStarters.spec.ts tests/ruleOutcomes.spec.ts tests/combinedAutomation.spec.ts
# Optional live model smoke check; requires the preview and its configured server key:
$env:RULES_TEST_URL = 'http://localhost:5192'
node --import tsx scripts/smoke_rule_starters.ts
```

The live smoke script checks all four starters across all four companies,
requires matches in every pack and an actionable result for each recommended
record, and writes its measured results to the ignored
`artifacts/rule-starters-live.json`. It does not save or run rules. Browser
workflow checks use deterministic external model responses with real routes,
SQLite, rule actions, and the four public company datasets.
