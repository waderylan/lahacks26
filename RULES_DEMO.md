# Transaction Review: shared SQLite workspace

## Run

- Requires Node 22.13+. Run `npm install`, then `npm run dev` (http://localhost:5173).
- For this worktree alongside the original app: `$env:PORT='5174'; npm run dev`. Preview: http://localhost:5174.
- Jev uses server-side `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. Message writing needs `GEMINI_API_KEY`; `GEMINI_MODEL` overrides the default. No Intuit connection is used.
- All durable state is stored in `workspace/actions.sqlite`. Set `WORKSPACE_DB` to use another SQLite file.

## Search and take action

1. Choose a company and search in everyday language, such as "Anything electronic or tech-related". Matching bills highlight in the original spreadsheet; uncertainty stays visible.
2. Use **Take action** on matches in the current filtered view or checked bills. Create assigned review tasks, change categories/memos, assign bills, add flags/tags, or update review status.
3. Click **Preview changes**, inspect before/after values, and explicitly apply. Receipts show successes, skips, failures, and individual undo controls under **Tasks & activity**.
4. Use **Status** and **Assigned to** above the sheet. Tasks also have status/assignee filters. Creating a task assigns its bill; completing a task remains separate from reviewing a bill.

## Rules and internal messages

1. Open **Rules**. Build nested ALL (AND), ANY (OR), and NOT groups from independent AI conditions and amount/vendor/account/review conditions. Preview shows each condition and the resulting expression.
2. Add actions under THEN. For **Draft internal message**, describe the request and choose a fictional employee or **Let Jev choose**.
3. **Save rule**, then **Run once**. The server rechecks the saved revision and current bill evidence. Only definite matches execute; failed, pending, and uncertain results cannot apply matching actions.
4. Each message action creates one draft covering its matches, split at 25 bills. Jev chooses one employee for the group when requested; Gemini writes from the request, frozen visible bill fields, and condition results. Messages do not treat screening judgments as proven accounting errors.
5. Open **Messages**, review/edit the draft, then approve or reject. Decisions and edits are saved in SQLite. Approval does not send email. The notification bell shows activity; read and dismissed state are shared.
6. Enable a saved rule to handle subsequent new/changed records without backfilling existing bills. Unsaved edits do not activate. The server checks every ten seconds and continues after browsers close.
7. **Replay next original bill** introduces one of five reserved originals. Arrivals, execution history, and automated actions persist across sessions. Undoing a bill from an undecided grouped message removes that bill and regenerates the remaining text.

## Storage and consistency

- SQLite stores working bills, tasks, owners, flags/tags, review/pass status, previews and receipts, saved rules/revisions, execution keys/history, replay arrivals, messages, approval decisions, notifications, pending generation/retry jobs, automation baselines, and shared display preferences.
- Browser state is limited to the current view, selection, unsaved editor text, and transient caches. Normal persistence does not use localStorage/sessionStorage. A one-time importer reads old `tr.rules.v1` / `tr.reviewed.v1` data for each company; it preserves an old browser copy and refuses to overwrite existing shared rule state or newer bill edits.
- Rule actions and dashboard actions update the same working bill metadata. Assignments and flags are immediately visible to the sheet and its filters. The app polls for updates from other sessions.
- Saving a stale rule revision, editing a stale bill, or approving a changed/already-decided message reports a conflict. Rule execution rechecks revisions after model evaluation and commits bills, history, drafts, and frozen evidence together. Repeated runs retain execution keys and do not duplicate actions.
- Dashboard preview/apply is transactional and idempotent. Undo protects later bill edits and completed tasks. Rule undo checks the affected field; message undo is allowed only before approval/rejection.
- Pending message generation runs on the server, at most three drafts at a time. Rate limits retry with persisted backoff. Undecided pending jobs resume after restart; late results for undone/regrouped/decided messages are discarded.
- Rule automation tracks business evidence plus review status, excluding its own owner/flag/pass changes, preventing self-triggering draft loops. Separate dashboard automations also retain their existing baselines and protections.
- `data/raw/` is never modified, and `hidden/` is never read. Category/memo edits affect only SQLite working copies and disclose original values in highlighted cells and the drawer. Monetary amounts and original line items remain intact. Employees are fictional additions, not dataset records.
- The default sheet is a labeled 50-record year-round sample; choose 100 or All for more. Five original bills remain reserved until replayed. Explicit actions use the selected bills or visible filtered matches; enabled saved rules evaluate subsequent relevant company records.
- **Reset demo action state** clears company rule metadata/history/messages/notices while preserving saved rules, tasks, arrivals, and human review. The URL `/?resetDemo=company-018&resetToken=manual-reset&workspace=rules` additionally disables that company's rules, clears its human-review marks, and resets replay arrivals in the shared database. Other companies remain unchanged.

## Verification

- `npm test` covers original ordering/rule logic, integer cents, SQLite actions, shared rule execution, message decisions, frozen evidence, pending-draft recovery, atomic rollback, idempotency, company isolation, migration, stale edits, and automation without an open browser.
- `npm run typecheck` and `npm run build`.
- Keep browser fixtures separate from demo data. Start a scratch server: `$env:PORT='5175'; $env:WORKSPACE_DB='artifacts/combined-verification.sqlite'; npm run dev`.
- In another terminal: `$env:RULES_TEST_URL='http://localhost:5175'; $env:RULES_TEST_DB='artifacts/combined-verification.sqlite'; npm run test:browser`. `RULES_TEST_DB` must identify this same scratch database under `artifacts/`; the cross-browser migration fixture resets only its test company there.
- Browser tests cover search/actions, filters, tasks, reload/independent-browser persistence, category/memo undo, real Jev conditions and nested rules, replay/reset, desktop/mobile layout, migrated message edit/approval, notification state, preferences, and concurrent rule conflicts.
- The optional live message-generation browser test needs a configured Gemini key; it skips when unavailable. Unit/API tests inject a controlled writer to verify successful generation and restart recovery without external model availability.
- Playwright uses installed Google Chrome; set `RULES_BROWSER=msedge` as needed. Screenshots and failure traces are written to ignored artifact directories.
