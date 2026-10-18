# Claude handoff: frontend (F1–F8)

Branch `claude/demo-cleanup`, based on `933a8db`. Not pushed or merged.

## Completed
- **F1** Shell: `<select>` picker for the offered companies, default `company-101`, `?company=` URL support (falls back to default/first if not offered), curated sample default (`limit: -1`), Explore/Rules/Tasks/Messages nav. Removed: Custom data toggle, chat widget and model comparison (`AskPanel`, `insights`), Fraud checks UI (`ReviewCheckPanel`), replay controls, browser importer (`workspaceMigration`), `useSemanticEval`, `settings.set`, unused Drawer props. Jev badge says "configured".
- **F2** Explore: type-count chips, "Text filter (no Jev)" label, suggested starter + Inspect example/Open starter (from `STARTER_DEMOS`), no monitoring text. View CRUD and confidence semantics untouched.
- **F3** Rules: four starters only (no More examples); wizard header reduced to All rules / View activity (Saved rules dropdown, New rule, Try in Explore removed; "Edit in Explore" stays in the scope note). List button is "Preview & run". Wizard Run now covers every evaluated preview record with an action (including uncertain), independent of display filters; scope text on both pages; full-company run confirm shows the record count.
- **F4** `src/activity.ts` (`activityFeed`, `transactionTimeline`, replaces `billStatus`): rule history + resolutions, message decisions, task completion, receipts (incl. manual review), deduped by stable id, source-specific Undo. Shown in Tasks & activity and per transaction in the drawer. Wizard history pane removed.
- **F5** `EmployeeSelect` + resolvers in `employees.ts` (`resolveEmployee`, `ownerLabel`, `ownerKey`, `sameOwner`, `ownerOptions`). Starters now use `emp-ap` / `emp-projects`; wizard assign/task, drawer editor, Explore/Rules/task filters use IDs; `inScope`/`matchesSearchFilters` compare via `sameOwner`. My tasks button; task owner vs transaction owner labelled; Human review control in the drawer (`/actions/review`).
- **F6** Approvals grouped "Sent from you" / "other employees" with *View as* switch; issues link to tasks/approvals; drawer puts status, evidence, follow-up and timeline before collapsed Record details; Explore drawer hands off to Tasks & activity; Supporting details shows evidence → recheck → resolved route and a *Recheck now* button (`run` with explicit ids).
- **F7** `usePolling` (pauses when tab hidden; 0 disables). Saved views poll only in Explore; rules/workspace/mail poll slower off their views. `useRules(data, options)` signature changed (options object); removed replay/automation/importer/loadPreset/loadExample. Workspace hook lost preview/apply/automate/pause. Restore refreshes bills, workspace and mail.
- **F8** Specs updated (company-101, IDs, new `tests/review.spec.ts`, `tests/support.ts`), `DEMO.md`, README leads with the demo; removed old walkthrough docs and `demo-assets/{seed.sqlite,seed.README.md,rule-builder-options.html}`.

## Verification
- `npm run typecheck`, `npm run build`: pass. `tsx --test src/*.test.ts server/*.test.ts`: 110 pass.
- Browser: 29/29 pass against a **temporary copy** of the specs with `company-101` rewritten to `company-018` (the current fixture), plus `?company=company-018` for the synthetic-mode specs. Specs in the branch use `company-101` and have **not** run against Codex's fixture.

## Needed from Codex / integration
- Fixture: default company `company-101` with 8 rows, ids `company-101:bill-N`, same memos/outcomes as today (bill-1 uncertain, bill-2 match, rest no match). `startRuleApp({ synthetic: true })` is still used by `synthetic.spec.ts` (3 bill/3 invoice/2 bank rows asserted), `companyRules.spec.ts` (second test) and `ruleStarters.spec.ts` (second test, real four companies: picker labels contain the company names). Adjust those specs to the real-four-company option name.
- Server must accept `{type:'reset', full:true}`, return `rows` and tolerate omitted `reserve=1` on `/bills`. Settings `PATCH` only sends `{limit}`.
- Task creation must not assign the transaction (`review.spec.ts` only asserts a "Transaction owner:" label is shown).
- `server/ruleStarters.test.ts` etc. still pass, but starters now carry `emp-ap`/`emp-projects` owners.
- `demo-assets/semantic-review-demo` remains because `server/data.ts` still references it; delete with the scenario code.
- `package.json` test script: removed `src/billStatus.test.ts`, `src/insights.test.ts`; added `src/activity.test.ts`, `src/employees.test.ts` (or use discovery). Server tests for chat/reviewChecks stay Codex's call.

## Removable compatibility exports (client side)
- Types kept for the server: `ServerAutomation`/`ActionState.automations`, `Row.provenance`, `CompanyBills.reservedRows`, `SavedSearch.enabled/tracking/monitoringRetired`, `rules.ts` `migrateRule`/`migrateMessage`/`resetCompanyDemo`/`syntheticExampleRules`/`rulePresets` non-starters, `MailSource 'risk'`, `src/reviewChecks.ts`, `duplicates.ts`, `paymentRisk.ts`.
- Dead CSS for chat and risk panels was removed from `styles.css`.
