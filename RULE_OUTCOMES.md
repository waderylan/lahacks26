# Actions for each rule result

The rule builder keeps its three steps: describe conditions, choose actions, and
review the results before running.

In **Choose actions**, each result has a separate section:

- **Match:** the transaction meets the combined conditions.
- **Not enough information:** Jev cannot decide from the available records. Add
  a clarification message, flag, or assignment here to request a review.
- **No match:** the transaction does not meet the conditions. Leave this section
  empty to take no action.

Actions run only for their own result. An empty section does nothing. Failed or
unfinished checks never run actions. Uncertain results cannot be marked checked.
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

## Verification

```powershell
npm run typecheck
npm test
npx playwright test tests/ruleOutcomes.spec.ts
```

The browser test runs the real interface, API routes, and SQLite with fixed model
responses. It checks the workflow without making external model requests.
