# Transaction Review: visual rules

- Start with `npm install` and `npm run dev` (default http://localhost:5173).
- For this worktree alongside the original app, PowerShell: `$env:PORT='5174'; npm run dev`. The running worktree is at http://localhost:5174.
- Use the existing `.env` with `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. Credentials stay server-side. No direct TypeSafe endpoint or Chat Completions adapter is used.

## 60-second walkthrough

- **0–10s:** Open Rules, Shipwise Online Goods. Read the IF / THEN summary. The editable example flags overhead memos attached to bills whose line items are not ongoing overhead.
- **10–20s:** Click **Inspect a match**. Compare the two independent condition results, NOT, and ALL against the original memo and line items. Close the drawer.
- **20–30s:** Add an Amount standard condition, change ALL to ANY, and watch the preview update. Group and action edits reuse judgments. Remove the new condition and return to ALL.
- **30–40s:** Add **Draft internal message** if you want the approval card: describe the message and pick an employee or let Jev choose. Click **Save rule**, then **Run once**. Open Action history or Messages to see the local draft. Approve, edit, or reject it — nothing is emailed. Undo one flag.
- **40–50s:** Click **Disabled · Enable**, then **Replay next original bill**. Read the replay log: the next original record is evaluated against the saved revision. True applies actions; false or uncertain leaves it untouched.
- **50–60s:** Edit the enabled rule. The previous revision stays active until **Save and activate revision**. Switch to Transactions to show semantic filtering and separate human review.

## Semantics and storage

- Original records remain unchanged. The existing loader reads only visible accounting entities. Scenario fixtures stay behind `ENABLE_SCENARIO=1` and retain their disclosure. Five original bills per company are reserved outside the initial sample, then appended exactly once by replay. Arrivals persist across reloads.
- Every AI leaf sends its own exact criterion to the existing Jev adapter. A shared, round-robin queue interleaves conditions with a maximum of three gateway batches and twenty records per batch. Conditions are debounced 400ms. Successful judgments and shared in-flight requests are cached in memory by company, transaction content, criterion text, and model/config version. Failed requests are retryable and are not cached as semantic judgments.
- Standard conditions compare integer cents, human review status, vendor, or account locally. Vendor/account choices come from the complete selected company.
- Semantic outcomes are true / false / uncertain. NOT preserves uncertain. Pending and error remain execution states. Each leaf must finish successfully before Run once or automatic actions can execute, including children that do not change the final ALL/ANY result.
- Preview evaluates the current draft. It never writes transaction metadata. Run once requires a saved, unchanged, valid, complete revision and freezes its definite matches and evidence before an atomic browser storage write.
- Saved rules, local flags/tags/owner/automated pass, draft vendor messages, notifications, execution keys, action history, and replay arrivals use `tr.rules.v1` in localStorage. Human review continues to use `tr.reviewed.v1`. Automated pass never changes human review. A **Draft internal message** action writes one pending local card per run that covers all of the run's matching bills (split at 25 bills; each replayed arrival gets its own). Jev chooses one recipient for the whole message from the fictional team in `src/employees.ts` (unless one was picked), then Gemini writes a single subject and body from the request, visible bill fields, and each bill's condition results. Undoing one bill removes it from the message and re-drafts the rest. Approve / edit / reject; never an email.
- Enabling and activating revisions never backfills history. Enabled saved revisions handle subsequent replay arrivals and human review updates while this app is open. Draft changes do not affect that revision. Stale preview responses and obsolete active revisions cannot apply actions.
- Each action is idempotent by rule ID + revision + transaction ID + content/review version + action ID. Duplicate tags and flags are also prevented. Undo retains execution keys, checks the current field against the written value, and reports a conflict if it changed. Subsequent false/uncertain updates are recorded without reversing earlier actions.
- Reset demo action state clears this company's action metadata, history, and execution keys. It preserves rules, replay arrivals, and human review, allowing explicit Run once demonstrations again.
- For a complete Shipwise restart, open `http://localhost:5174/?resetDemo=company-018&resetToken=manual-reset` in the browser profile used for the demo. This also restores the five reserved replay bills, clears Shipwise human-review marks, and disables its saved rules while retaining their definitions. Other companies remain unchanged. The URL removes its reset parameters after applying the reset.

## Verification

- `npm test`: existing spreadsheet ordering tests plus truth tables, invalid expressions, integer cents, duplicate execution, company isolation, undo conflicts, and updated nonmatch behavior.
- `npm run typecheck` and `npm run build`.
- With the app running at port 5174: `npm run test:browser`. Uses installed Google Chrome. Set `RULES_BROWSER=msedge` or `RULES_TEST_URL` as needed. These browser tests make real gateway calls; they do not mock Jev.
- Browser coverage: independent parallel criteria, bounded requests, condition-specific cache reuse, ALL/ANY/NOT, add/edit/remove, drag/drop and moves, stable row order, invalid drafts, save/reload, Run once idempotency, undo/conflicts, separate automated pass, explicit activation, original-bill replay, company switching, and original bill-00540 evidence.
- Screenshots are written under ignored `artifacts/`; failed tests retain screenshots and traces under ignored `test-results/`.

## Limits

- This is a local, single-browser demo. Storage and automation are not shared across users, and automation does not run after the app closes. There is no live QuickBooks connection, background worker, or outbound email. Approved messages are marked sent locally only.
- The default preview is a clearly labeled 50-record year-round sample. Select All to inspect all original active records; five originals remain reserved until replayed.
- Judgment cache is session memory. Reloading the page reevaluates AI conditions through the gateway.
- Replay uses five actual reserved bills, so the example policy may honestly return false or uncertain. For an all-arrivals walkthrough, use an AI criterion such as “The transaction has a vendor name.” and activate it explicitly; results still come from Jev.
