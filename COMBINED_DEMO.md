# Saved searches and rule follow-up

This branch combines `feat/saved-searches` (`896f256`) with
`feat/rule-outcomes-and-resolution` (`ca9e027`).

## Open the combined preview

Open `http://localhost:5192`. Turn on **Custom data** and choose **Parcelmint Online
Goods** (company-101). Use **All** rows for the full company or 50 for a shorter
review. The existing **Possible duplicate charges2** rule and internal message
were copied into the combined preview database. The other worktree's **Invoices
needing review** and **Unassigned bank entries** searches are also available.

The combined database is a separate snapshot. Original worktree databases are
unchanged. Imported search check histories start fresh because this preview uses
the rule worktree's working transactions. Changes made in the older previews
after the snapshot are separate from this preview.

## Search and track changes

1. Open **Transactions**. Enter a question such as:

   > This transaction appears to charge for the same underlying work or goods as a nearby transaction, and the supporting records do not establish a separate delivery, service period, or installment.

2. Set Type, Status, Assigned to, and the other visible filters. **Save search**
   stores the query, filters, and sort order for this company.
3. Open **All saved searches** to reopen, edit, rename, copy, or delete searches.
   **On** checks all new or changed company records every 10 seconds while the
   server runs, including records outside the loaded spreadsheet sample. **Off**
   stops automatic checks; **Check now** still works.
4. The first check counts existing matches and establishes the baseline. It does
   not mark every existing match as new. Later records that start matching appear
   under **View new**. **Mark as seen** clears those badges.

Saved searches report results. They do not flag transactions, assign work, or
send messages. Use a rule when you want actions.

## Run actions for each result

1. Open **Rules** and choose the existing duplicate-charge rule, or **New rule**.
2. Describe the condition in English. Use AND, OR, and NOT for grouped conditions.
3. In **Choose actions**, each result has its own section:
   - **Match:** flag **Possible duplicate** and assign a reviewer.
   - **Not enough information:** create a review task or draft a clarification
     message asking which invoice, delivery, or service period supports the charge.
   - **No match:** leave empty unless another action is needed.
4. **Assign transactions** sets the Assigned to column and drawer value.
   **Create a review task** sets a title, task owner, and deadline in
   **Tasks & activity**. These are separate controls. Jev's selected message
   recipient is not automatically used as the assignee.
5. In **Review results**, inspect each condition and **What will happen**. Save
   the rule and use **Run once**. Filters limit this manual run. Enable **Run
   automatically** for later record changes; enabling establishes a baseline
   rather than applying the rule to all historical records.
6. Jev can choose the message recipient; Gemini writes the draft. Under
   **Viewing as**, choose its sender, then open **Messages → Approvals**.
   Approval delivers to the recipient's internal inbox. Nothing is emailed.

Saving a rule revision and running it can create another draft. Repeating the
same revision on unchanged records does not duplicate its actions or messages.

## Resolve a review issue

1. For a rule that identifies a problem, check **Clear this rule's flags and close
   its tasks when there is no match**, then save it. Add a flag or task under
   Match or Not enough information. Run it to create the tracked issue.
2. Open an affected transaction. **Add supporting details** accepts a receipt
   explanation, approval, or other text; it does not upload files. Use records
   that support the transaction rather than a generic "approved" note.
3. Enabled rules recheck updated records. If the saved condition now returns
   **No match**, the rule clears its flags and completes its unchanged open
   tasks. With automatic runs off, use **Run once** again.
4. Match and uncertain results keep the issue open. **Rule follow-up** shows open
   and resolved issues; history records cleanup and anything preserved. Manual
   flags, flags still claimed by other rules, edited tasks, assignments, tags,
   messages, and human review marks are kept.

Adding an explanation does not guarantee resolution. Jev must judge that the
saved condition no longer matches. A condition specifically about an empty memo
will still require the memo itself to be corrected.

## Watch the features work together

1. In Transactions, filter Status to **Flagged** and save **Flagged charges**.
   Turn its automatic checks On and wait for the first check.
2. Run a rule that flags a previously unflagged transaction and assigns a review
   task. The saved search reports the transaction as a new match. View it and
   mark it seen. The task appears under Tasks & activity.
3. Add supporting details to that transaction. When the rule resolves the issue,
   the flag clears, its task completes, and the transaction leaves the Flagged
   search on the next check. Its assignment and message history stay available.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npx playwright test tests/ruleOutcomes.spec.ts tests/combinedAutomation.spec.ts
```

These workflow browser tests run the real UI, routes, SQLite, rule worker, and
search monitor with fixed external model responses. Existing saved-search browser
tests can also run against a separate scratch server with `RULES_TEST_URL` set.

The preview uses `.env` and `workspace/combined.sqlite`, both ignored by Git.
Start it from this worktree with:

```powershell
$env:PORT = '5192'
$env:WORKSPACE_DB = Join-Path (Get-Location) 'workspace/combined.sqlite'
npm run dev
```
