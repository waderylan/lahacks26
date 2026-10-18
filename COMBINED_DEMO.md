# Explore, rules, and follow-up

The combined branch contains saved views, rule actions by result, assigned tasks,
internal message drafts, and automatic issue resolution.

## Open the preview

Open http://localhost:5192. Turn on **Custom data** and choose **Parcelmint Online
Goods** (company-101). Choose **50** preview records for a short review or **All
records** for the full available company dataset.

The preview uses its own database, `workspace/combined.sqlite`. The earlier
worktree databases remain separate. The existing **Possible duplicate charges2**
rule, messages, and saved views remain available in this preview.

## Explore: view and try conditions

1. Open **Explore**. Choose transaction type, review status, and assignee filters.
2. Write a condition, for example:

   > This transaction may charge for the same underlying work or goods as a nearby transaction, without supporting records showing a separate delivery, service period, or installment.

3. Use **Add condition**, **Add group**, and **Add a filter** to combine English
   conditions with amount, vendor, category, and review filters. AND requires all
   conditions; OR requires one. NOT reverses a result while preserving uncertainty.
4. Inspect results. Expand a result to see its individual condition answers.
   Open a transaction to read its details and supporting records. Explore never
   changes transactions, creates tasks, or sends messages.
5. **Save view** stores the conditions, record filters, result filter, and sort
   order. Reopen it from **Saved views**. Use **Save view** again to rename or
   update it, **Save as new view** to copy it, or **Delete saved view** to remove it.
6. Jev answers are cached in SQLite for each condition and transaction evidence.
   Reopening a view, regrouping conditions, and restarting the server reuse
   unchanged answers. **Refresh records** loads current records; changed evidence
   receives a new check. An assignment alone does not consume another Jev call.

Earlier saved searches open here as views. Their recurring monitoring is paused;
the previous definition is retained in SQLite, and affected views show a notice.
Create a rule for future recurring checks. The old `/searches` API and document
names remain for compatibility, but the application no longer schedules their
monitor worker.

## Rules: choose and run actions

1. In Explore, choose **Create rule**. It copies the exact condition tree and
   record filters into an independent draft and opens **Choose actions**. Saving
   or editing the view later does not change the rule.
2. Choose actions separately for **Match**, **Not enough information**, and **No
   match**. Empty sections take no action. Available actions are flag, assign,
   create a review task, draft an internal message, tag, and mark checked.
3. Choose **Review results**. Read each condition result and **What will happen**.
   Name and save the rule. Saving does not execute its actions.
4. Choose **Run now** to act on the current preview results. The preview filters
   limit a manual run. Display sorting, result filters, and text searches do not
   become recurring rule conditions. The server rechecks both record scope and
   conditions before applying any action.
5. Open **All rules** to see every saved rule, its conditions and actions, open
   issues, last recorded action, and **Keep checking** toggle. **Run now** from
   this list opens the result preview before anything runs.
6. **Keep checking** checks new or changed available company records every ten
   seconds while the server runs, including records outside the preview sample.
   Switching it on establishes the baseline. Use **Run now** to process existing
   records. Switching it off stops future automatic runs.
7. **View in Explore** or **Try in Explore** copies a rule's conditions for
   experimentation. **Use these conditions in rule** returns the changes to its
   draft. The saved rule changes only after **Save rule**. **Create rule** instead
   creates a separate rule with no inherited actions.

## Try assignments and resolution

1. Create a rule for missing supporting documents. Under **Not enough
   information**, add a flag **Needs receipt**, assign **Bookkeeper**, and create
   a task **Verify receipt**, also assigned to **Bookkeeper**.
2. Enable **Clear resolved issues**, save, and run. Check **Tasks & activity** for
   the assigned task. In Explore, filter **Assigned to** to Bookkeeper and inspect
   the transaction's owner and flags.
3. Return to the rule's result preview or open the task. Open the transaction and
   add supporting details with a title and the verified information.
4. With **Keep checking** on, the changed record is checked automatically. With
   it off, use **Run now** again. A definite No match clears only the rule's own
   removable flags and closes its unchanged open tasks. Uncertain results stay
   open. Manual flags, reviewer changes, assignments, tags, and messages remain.
5. **Rule follow-up** and action history show the resolution. Original dataset
   files are never changed.

## Try messages

Add a **Draft an internal message** action, choose a sender, and choose a
recipient or let Jev choose. Set the request, save, and run. Gemini writes the
draft server-side. In **Messages → Approvals**, the selected sender can edit,
approve, or reject it. Approval delivers it to the recipient's internal inbox;
no email is sent. Assignments and task owners are separate choices.

## Validation

- `npm test`: unit/API tests, including SQLite persistence, record scope,
  idempotency, messages, cache invalidation, and issue ownership.
- `npm run test:browser`: isolated Express/SQLite workflow tests with controlled
  external model responses. No live API credentials or existing preview data are
  needed. Covers Explore, views, conversion, recurring toggles, actions, messages,
  tasks, stale edits, mixed transaction types, and mobile layouts.
- `npm run typecheck` and `npm run build`.

## Next task, not implemented

Add a **Simulate** tab with periodic, timestamped transaction arrivals. Let the
user advance through timestamps and watch enabled rules act on incoming data.
