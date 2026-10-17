# Transaction Review: search and act

- Run `npm install`, then `npm run dev` (http://localhost:5173). Requires Node 22.13+ for built-in SQLite.
- For this worktree alongside the original app: `$env:PORT='5174'; npm run dev`. Preview: http://localhost:5174.
- Semantic search uses the existing Jev adapter and server-side `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. There is no Intuit connection.

## Dashboard walkthrough

1. Choose a company and search in everyday language, such as "Anything electronic or tech-related". Matches highlight in the original spreadsheet. Uncertain judgments are shown separately.
2. In **Take action**, choose matches in the current filtered view or checked bills. Choose a task, category/memo edit, assignment, flag/tag, or review status.
3. Click **Preview changes**, inspect the bill-level before/after values, then explicitly apply. The receipt shows successes, skips, and failures.
4. Filter the spreadsheet with **Status** and **Assigned to**. Creating a task also assigns its bill to the task owner.
5. Open **Tasks & activity**, filter by status/assignee, and mark tasks done. Completing a task and reviewing a bill are separate operations.
6. Expand an action receipt to undo an individual change. Later edits and completed tasks are protected from conflicting undo attempts.

## SQLite storage and execution

- Working bills, task records, owners, flags/tags, human review, action previews/receipts, and dashboard automations live in `workspace/actions.sqlite`. Set `WORKSPACE_DB` to use another database file. Browser sessions using this server share the state.
- Original records are imported once per company. No files in `data/raw/` are modified, and `hidden/` is never read. Category and memo edits change only the working copy, with original values disclosed in highlighted cells and the drawer. Original line items and monetary amounts stay intact.
- Actions on search matches are revalidated on the server using current bill data and the exact criterion or ALL/ANY/NOT expression. Checked-bill actions use the explicit selection. IDs are company-scoped throughout.
- Successful semantic judgments are cached by company, criterion, and business evidence. Calls share a bounded queue of three gateway requests, with twenty records per batch. Failure is retryable; uncertain results never trigger matched actions.
- A preview freezes bill revisions. Applying it commits changes, created tasks, and the receipt in a SQLite transaction. Repeating an apply is idempotent; stale bills fail without overwriting newer data. Identical open tasks are skipped.
- Undo checks the bill revision and task state. A later edit or changed task blocks undo and preserves current values.
- Optional dashboard automations baseline existing bills without a historical backfill. They check new/changed records every ten seconds while the server runs, including after the browser closes. Pause them in **Tasks & activity**. Competing automatic writes to the same scalar field must be paused before enabling another.
- The initial spreadsheet is a labeled 50-record year-round sample. Choose 100 or All for a larger view. Five original bills remain reserved for the legacy replay demo. Actions apply to visible filtered matches or the explicit selection.

## Original browser rule demo

- **Rules** retains the original builder, including nested ALL/ANY/NOT groups, independent AI conditions, amount/vendor/account/review conditions, drag/drop, saved revisions, and replay. Use **Take action** there for the shared SQLite execution path.
- The older **Save rule**, **Run once**, legacy action history, and replay controls are a browser demo. Saved rules, demo flags/tags/owner/automated pass, execution keys, history, and replay arrivals remain in `tr.rules.v1` localStorage. The drawer labels this metadata **Browser rule demo metadata**. These demo actions are separate from SQLite dashboard tasks and assignments. Human review is now shared SQLite state.
- The Shipwise example identifies overhead memos on bills whose line items are not ongoing overhead. Inspect a match to compare independent conditions against original evidence. Change ALL to ANY, add a condition, or nest a group to see the result change.
- Save before **Run once**. Enabling a saved revision does not backfill existing rows; subsequent replay arrivals use that revision while the browser is open. Draft edits do not activate until explicitly saved and activated. Uncertain, pending, and failed conditions cannot execute actions.
- Browser demo actions are idempotent and retain execution keys after undo. Undo checks the current written field. Automated pass remains separate from human review.
- Reset demo action state preserves rule definitions and arrivals. For a full Shipwise browser-demo reset, use `http://localhost:5174/?resetDemo=company-018&resetToken=manual-reset`; this also restores reserved replay bills and disables saved rules. It does not clear the SQLite workspace. Other companies remain unchanged.

## Verification

- `npm test`: 26 tests covering ordering, three-valued rule logic, integer cents, SQLite persistence, action idempotency, company isolation, stale previews, undo conflicts, atomic rollback, automations, and real HTTP routes.
- `npm run typecheck` and `npm run build`.
- Run browser tests against a separate database to keep demo state clean: start the server with `$env:PORT='5175'; $env:WORKSPACE_DB='artifacts/action-browser-verification.sqlite'; npm run dev`, then in another terminal run `$env:RULES_TEST_URL='http://localhost:5175'; npm run test:browser`.
- Four original browser tests exercise real gateway calls, grouped rules, saved revisions, replay, company switching, and original evidence. Three dashboard browser tests cover SQLite actions, status/assignee filters, completion, a fresh browser context, reload persistence, category/memo undo, and desktop/mobile layout. One dashboard test controls only model inference; all its database/API actions are real.
- Browser tests use installed Google Chrome; set `RULES_BROWSER=msedge` if needed. Screenshots and failure traces are stored in ignored artifact directories.
