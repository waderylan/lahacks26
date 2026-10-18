# Main follow-up implementation

- Worktree and branch remain `codex-demo-cleanup` / `codex/demo-cleanup`. Preserved `b0b6b9c` and fetched/reconciled `origin/main` at `9794968` on this branch. No branch switch, new worktree, reset, push or merge into main.
- Existing B1–B8 cleanup remains: synthetic-only production assembly, full availability, atomic restore/reseed, separate task ownership, manual review and sender approval. New Dashboard persistence is independent of retired chat; saved chart definitions survive company restore. Dataset replacement reconciles linked chart IDs and advances chart revisions.

## Fixes by finding

| ID | Implemented behavior |
|---|---|
| N01 | Dashboard KPIs and chart measures distinguish vendor bills, invoice open amounts, bank deposits and withdrawals. Only vendor bills contribute to vendor-bill spend/payables/overdue amounts. Count is explicitly transaction count. Snapshot/payment-link limitations are disclosed. Mixed-type arithmetic regression passes. |
| N02 | Saved provider/evaluator policy controls execution. Opposing page/run overrides are rejected before evaluation or summaries change; switching provider requires a saved revision. Execution keys include evaluator identity. Same-policy/evidence reruns remain idempotent. Opposing controlled judgments apply the correct newly saved branch. |
| N03 | Starter creation records its provider and evaluator identity. Saved-rule previews, explicit runs and background checks use that provider. Rule table, editor and run history identify it. The page selector applies to Explore and new rules; it does not overwrite an existing draft or saved policy. |
| N04 | Retired general bookkeeping chat as allowed by the review and prior assignment. Removed the chat URL-provider leak and module-global navigation side effect. Shared evaluation transport takes explicit context and defaults to Jev for legacy callers; it never reads URL state. Dashboard supports direct focused chart creation, selected record IDs, save/replace, grouping, measures and chart shapes. |
| N05 | Chart changes are committed locally only after an acknowledged successful write. HTTP 400/500 and network failures retain acknowledged state, show errors and offer retry. Mutations serialize per company. Failed Keep retains the transient chart editor. |
| N06 | Chart API reads include revision; writes require expectedRevision and use atomic compare/write. Stale writers receive 409. Client reloads latest charts on conflict and refreshes on focus, revisit and a five-second interval while Dashboard is mounted. Cross-session removals are not resurrected. |
| N07 | New action snapshots and run summaries freeze provider, model/deployment, policy version and score identity. Old history remains readable with unknown provenance. Model configuration changes during evaluation apply no actions; changes since save require resaving. `MODEL_RUNTIME.md` corrects the old archive README's historical provenance claim without modifying experiment artifacts. |
| N08 | Server/client cache identities include score configuration: matching calibration data/coefficients and raw-score mode. Model-slot requests freeze deployment and calibration before waiting. Controlled calibration changes and raw-mode switches produce fresh, correctly labelled results. |
| N09 | Completed Match/No match/Uncertain decisions with null scores show Score unavailable, not Checking. Preview retains scoreKind and distinguishes Jev probabilities, raw candidate scores and validation-adjusted scores. Provider-status errors have visible retry controls. |
| N10 | Back to charts closes focus explicitly. Refresh dashboard reloads both full company records and shared charts. Record data refreshes on focus/revisit and local workspace-change events. Browser verification covers an actual category edit and complete restore reflected in a chart without page reload. |
| N11 | Preparation reproduces the frozen original-company 70/15/15 manifest and frozen overlay inputs independently of runtime company filtering. Required --out targets a new/empty directory outside the archive. Default assembly has 800 overlays; --teacher assembles the existing 200 teacher cases for 1,000 examples. Manifests include hashes, populations and policy identity. Temporary reproduction matches the frozen training assembly after newline normalization; existing outputs cannot be overwritten. No inference/training occurs. |
| N12 | Client/server share CHART_LIMIT=24 and chart validation. IDs must be nonempty and unique; enums/title/source fields and linked company record IDs are validated. Client reports limits before writing; server rejects missing/cross-company IDs and malformed source metadata. Browser verifies the disabled 25th-chart operation and visible limit. |
| N13 | Company is represented in the URL. Provider switching uses React state/history replacement, preserving company 104, active search and unsaved condition tree without reloading. Existing draft provider remains explicit until edited in the rule editor and saved. |

## Simplifications

- S01: chart-domain math/validation live in `src/chartMath.ts` and `src/charts.ts`; persistence/routes live in `server/dashboard.ts`. None imports chat.
- S02: one ChartCard implementation serves saved and focused charts, including controls, aggregation, formatting and rendering.
- S03: removed the chat render-time global navigation callback with the retired chat. Dashboard actions use normal component callbacks.
- S04: runtime deployment/calibration uses explicit environment settings or `MODEL_CONFIG_FILE`; no default discovery inside `training/`. See `.env.example`, `config/models.example.json`, and `MODEL_RUNTIME.md`.
- S05: shared EvaluationContext carries provider/model/policy/score identity through preview, caches, rule execution and durable history. Client transport does not infer intent from a URL.
- S06: retained Dashboard/chart capabilities and corrected their measures and disclosures. No financial-statement completeness or four-company model-accuracy claim was added.

## Verification

- `npm test`: **130 passed**, zero failures. Includes production APIs, isolated disk/memory SQLite, opposing providers, durable provenance, approval/restore/idempotency safeguards, chart concurrency/failures/limits, calibration cache changes and temporary frozen preparation.
- `npm run typecheck`: passed after final changes.
- `npm run build`: passed after final changes.
- Relevant Playwright scenarios passed across focused runs: failed deletion/retry/reload, two-session conflict/revisit, focused chart creation and limit, missing/raw/adjusted score labels, company-104 provider switching with unsaved work, record update/restore refresh, and model-control workspace visibility. Initial chart-creation test found a missing exact accessible select label; fixed it and reran the affected scenarios successfully (4/4). Earlier run passed the other scenarios (6/7, with that single now-fixed failure).
- Test Vite instances disable their WebSocket server and use an isolated ephemeral HMR port. Concurrent focused runs produced no shared-port errors. No unrelated processes or development servers were stopped.
- `git diff origin/main -- synthetic training/semantic-review qbdata` is empty: imported source/training artifacts remain unchanged. Existing live workspace DB and secrets were not opened or modified. No paid inference, teacher collection or training jobs ran.
- Broader/long browser reruns were skipped at the user's request. The older company-018/retired-feature browser specs still await the separate frontend cleanup; this is not represented as a full browser-suite pass.

## API/runtime details and remaining limits

- Dashboard GET returns `{ charts, revision }`; PUT accepts `{ charts, expectedRevision }` and returns the acknowledged state, or 409 for stale writes. Old dashboard writers without revisions must refresh/update.
- Evaluate requests accept explicit `model` (`jev` default or `qwen`) and optional `expectedIdentity`; stale identity returns 409. Status exposes nonsecret contexts for both providers. Saved rule definitions gain optional `evaluation`; history/summary provenance fields are additive. Inert legacy names remain compatible.
- Runtime Qwen needs an explicitly configured existing deployment. A reviewed calibration file must be supplied explicitly; the historical archive is never an implicit live configuration source. Missing scores remain unavailable; raw/adjusted scores are not validated confidence on the target companies.
- Preparation reproduces frozen authored contexts instead of generating a new overlay experiment from today's runtime population. New data generation or new teacher calls require a separately versioned experiment and were outside this no-training pass.
- Existing legacy chart source metadata is historical, not a new model execution claim. Replacing a dataset removes stale linked IDs from saved chart selections; retained charts then visualize only surviving selected records.
- The peer frontend worktree remains untouched and uncommitted. No attempt was made to import its unfinished edits or perform the previously planned separate-worktree integration; the latest instruction requires retaining this branch/worktree.
