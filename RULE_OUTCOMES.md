# Actions for each rule result

The rule builder keeps its three steps: describe conditions, choose actions, and
review the results before running.

In **Choose actions**, each result has a separate section:

- **Match:** the transaction meets the combined conditions.
- **Not enough information:** Jev cannot decide from the available records. Add
  a clarification message, flag, or assignment here to request a review.
- **No match:** the transaction does not meet the conditions. Leave this section
  empty if you do not need additional actions. The cleanup option below can still
  clear earlier flags and tasks.

Actions run only for their own result. Failed or unfinished checks never run
actions. Uncertain results cannot be marked checked.
Existing saved actions remain in the Match section.

The review table shows each result and **What will happen**. **Run once** applies
the configured actions to the rows in the current view, including uncertain or
nonmatching rows when you have chosen actions for them. Filters limit this manual
run; automatic runs use the saved rule on new or changed transactions.

Messages remain drafts until their sender approves them. The draft and its
generation request retain the triggering result so missing information is not
presented as a confirmed issue. Approvals deliver to the internal inbox only.

Rules, execution history, and pending messages remain in SQLite. Repeating a run
does not repeat an action for the same rule revision and transaction version.

## Clear flags and close tasks after another check

This option is for rules that identify a problem. It starts turned off.

1. In **Choose actions**, add a flag or **Create a review task** under Match or
   Not enough information. Tasks have an owner and a due date in days.
2. Check **Clear this rule's flags and close its tasks when there is no match**.
3. Save the rule. Use **Run once** for existing transactions. Turn on **Run
   automatically** to check later record changes without keeping a browser open.
4. Open a transaction and use **Add supporting details** to save a receipt
   explanation, approval, or other text. This is a reviewer note, not a file upload.
5. Enabled rules check the updated transaction. If a check now returns **No
   match**, the rule removes its tracked flags and completes its unchanged open
   tasks. Match and Not enough information keep the issue open. Without automatic
   runs, use **Run once** again; the preview includes the pending cleanup.
6. **Rule follow-up** shows open and resolved issues. Action history records what
   was cleared, which tasks were completed, and anything that was kept.

Manual flags, flags still claimed by another rule, edited or reopened tasks,
assignments, tags, messages, and human review marks are preserved. A flag that
already existed before the rule ran is kept. Removing a flag manually releases
the rule's claim, so adding it again makes it a manual flag.

Changing the rule's conditions leaves issues from the earlier conditions open
for review. Changes to its name, actions, or cleanup option can use the existing
tracking. Issues and task links survive a server restart. If the same problem
returns after resolution, a new issue and task can be created.

Supporting details are stored in the working transaction in SQLite; source
dataset files remain unchanged. Adding details does not itself resolve an issue:
Jev must return No match for the saved conditions. Messages remain available
after resolution, including any drafts waiting for approval.

## Verification

```powershell
npm run typecheck
npm test
npx playwright test tests/ruleOutcomes.spec.ts
```

The browser test runs the real interface, API routes, and SQLite with fixed model
responses. It checks the workflow without making external model requests.
