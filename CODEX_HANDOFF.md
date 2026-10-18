# Backend demo cleanup handoff

- Branch: `codex/demo-cleanup`, based on shared baseline `933a8db`.
- Worktree: `C:\Users\Rylan Wade\Desktop\lahacks-worktrees\codex-demo-cleanup`.
- Scope: B1–B8. No client files or browser specs edited. No changes to generated data, raw inputs, evaluation labels, secrets, or live databases. Nothing pushed or merged into main.

## Completed packages

| Package | Result |
|---|---|
| B1 | `server/app.ts` assembles production APIs with injected data, sampling, models, and timers. Production lists/loads only companies 101–104. HTTP tests reject reads of raw/evaluation/hidden data. Source counts remain 346/320/310/298. |
| B2 | `WorkspaceData.availableRows` exposes the entire company to Explore, selected runs, run-all, and recurring rules. Removed every active last-five reservation and the replay command. Curated sampling is a disclosed display choice; reference options always cover the whole company. |
| B3 | Full restore and dataset replacement share transactional company cleanup. Restore returns original transaction bodies, clears added evidence, manual metadata/review, tasks/links, plans, history/executions, summaries/issues, drafts/jobs/frozen evidence/mail/notices, replay/check/escalation state and old automation/monitor/chat state. Saved views and rule definitions survive; rules are disabled with incremented revisions, watches/logs reset. Semantic caches and other companies survive. Dataset revisions advance across replacement, including empty datasets; failures roll back rows/documents/version together. Late runs/drafts/scans cannot revive cleared activity. |
| B4 | Deleted chat/model comparison, scenario/raw-data loading, saved-view monitoring, browser importer, dashboard automation producers/scanner. Kept saved-view CRUD, selected preview/apply/undo/review, record detail, task reads/status changes, rules and recurring rule worker. |
| B5 | Disk reopen tests cover flags, assignment, tasks/task links, rule history and summaries. Repeated runs/apply do not duplicate actions/tasks; rollback and stale-write checks remain. Task ownership is separate from transaction assignment in both rule and manual action paths. |
| B6 | Removed generated check escalation/direct mail and HTTP check routes. Specialized duplicate/payment assessors, cache tests and offline evaluation remain. Rule-generated mail requires the sender's approval; retry/frozen-evidence and concurrency tests pass. Manual Compose/reply remains direct human mail. |
| B7 | Updated original-company tests to company 101, removed only tests of retired features, and added production API, restore/reseed, durability, idempotency, scope, review, worker-race, retry and approval regressions. Browser fixture uses production assembly. |
| B8 | Deleted root holiday sample; updated package description, optional .env launch, env example, test discovery, typecheck coverage and canonical instruction files. Prepared fixture/API contracts below for frontend integration. |

## Preserved and changed contracts

- `RuleService.snapshot` still returns `store`, `rows`, `issues`, `runs`, plus existing `automation` log. `store.history` is rule action history; workspace `runs` contains manual action receipts. Client combines them; no new activity/state endpoint.
- Existing rules/workspace/mail/evaluate/task/detail endpoints retain their shapes.
- `/api/settings` defaults to `{ limit: -1 }` when absent. `-1` selects curated samples, `0` selects all rows, positive supported settings select evenly spaced display samples. Explicit stored limits remain respected. Obsolete `set` is ignored.
- `GET /api/companies/:id/bills` ignores old `reserve=1`, returns `reservedRows: []`, and provides full-company `referenceOptions`. `limit=-1` filters to the real curated sample when one exists; controlled fixtures return all rows.
- `run` executes explicit IDs within saved rule scope; `run-all` executes the full company within scope. Both re-evaluate and enforce saved revision. Keep checking establishes a baseline without historical action backfill.
- `{ type: 'reset', full: true }` performs complete company restore. Legacy reset calls also restore completely. Saved rule revisions advance, so refresh all client stores after restore.
- Selected `/actions/preview`, `/:planId/apply`, `/:planId/undo`, and `/actions/review` remain. Preview only accepts `scope: 'selected'`; semantic/matches actions belong to Rules.
- `/actions/review` keeps `{ ids, reviewed }` and additionally accepts optional `expectedVersions: Record<transactionId, sourceVersion>`. Supplying it protects against stale browser state; preview/apply always checks server row revisions.
- New task owners and assignment values accept exact employee IDs or exact known historical names (case-insensitive names), normalized to IDs. Unknown historical labels are preserved, with surrounding whitespace trimmed. Task creation does not assign its transaction. Client should use its shared employee resolver for display and legacy comparisons.
- Removed APIs: chat/models/understand/llm-evaluate/chat history, rules/import, dashboard automations/pause, checks state/run/escalate, saved-search toggle/check/new-matches/seen, and replay rule commands. Retired endpoints return JSON 404 (replay command returns 400 unknown command).
- Saved views retain inert `enabled: false` and empty `tracking` response fields solely for existing shared type compatibility. They never schedule work or create actions. Stored historical automation documents never resume; restore/reseed removes them.
- Shared source exports remain untouched. Server still uses `migrateRule`, rule evaluation/action helpers, `draftSender`, shared evidence, duplicate/payment logic and shared types. `txnType` remains optional and bill-oriented IDs/table names are unchanged.

## Browser fixture contract

- `startRuleApp(options?)` retains `{ url, close }` and uses a fresh in-memory SQLite DB plus the production route assembly. It never reads `.env` or calls live models.
- Default or `{ mode: 'controlled' }`: only company `company-101`, eight rows, `bill-1` through `bill-8`; scoped IDs `company-101:bill-N`; documents `INV-N`; vendors `Supplier N`; account Maintenance; amount 125000 cents; date 2026-10-01; due date 2026-11-01. All rows are bills by default. Company label: Workflow test company.
- `{ rowCount: N }` changes controlled row count. Sampling uses production's evenly spaced algorithm, not prefix slicing.
- `{ synthetic: true }` makes the controlled rows alternate bill/invoice/bank starting with bill. It does **not** add real companies or combine controlled company 101 with real company 101.
- Controlled semantic results: bill-1 (`Needs receipt`) is uncertain; bill-2 (`Duplicate charge`) matches; bill-3 onward (`Receipt checked`) do not match. Adding evidence makes a controlled row no-match. Probabilities are test placeholders (`pMatch: 0.5`), cost is zero.
- `{ mode: 'real-four-company' }`: real unmodified app-facing companies 101–104, including curated samples/authored example IDs. No labels are loaded. Use this mode for the four-company walkthrough. Controlled model responses here are for workflow tests, not model-accuracy assertions: rows with evidence return no-match; other rows return match.
- Both modes generate drafts to explicit recipient, or `emp-controller` when recipient is `jev`, with subject `Please provide the receipt` and body `Please attach the missing receipt so Accounting can finish reviewing this charge.`
- Timers scan rules and draft jobs every 100 ms. Production uses 10 seconds / 1 second. No dashboard automation timer remains.

## Verification

- `npm test`: 114 tests passed (source/server discovery, controlled responses, isolated databases).
- `npm run typecheck`: passed, including browser fixtures and TypeScript scripts.
- `npm run build`: passed.
- `uv run scripts/validate_synthetic.py`: passed including byte-identical regeneration, run from the unchanged source checkout because raw generation inputs are intentionally absent from this worktree. The first attempt in this worktree failed only at regeneration due to those missing inputs. No generated files were changed.
- Production HTTP coverage exercises all four source counts, all-record/curated availability, record detail/evaluate, full-company runs, company isolation, missing/retired endpoints and manual review.
- Paid model accuracy and provider availability were not tested. Live `scripts/smoke_rule_starters.ts` / `scripts/eval_checks.ts` were not executed.
- Browser suite is deferred until frontend integration because baseline client/specs still use retired features/company 018.

## Integration dependencies and next pass

- Await a committed `claude/demo-cleanup` branch and `CLAUDE_HANDOFF.md`; its active worktree has not been modified by this implementation.
- Frontend browser specs must use company 101 and the fixture modes above. The authored walkthrough must request `{ mode: 'real-four-company' }`; `{ synthetic: true }` is the controlled mixed-type fixture.
- Client must remove calls to retired APIs, use full restore, refresh all affected state, combine rule history with manual receipts, and label task ownership/transaction assignment separately.
- Optional improvement for frontend manual review: pass current row source versions using the additive `expectedVersions` field.
- Once peer branch is ready, create a separate integration branch/worktree from this backend branch, merge the peer branch there, resolve mechanical contract differences, and run `npm test`, typecheck, build, synthetic validation and the browser suite. Do not push or merge main.
