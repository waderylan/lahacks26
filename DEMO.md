# Transaction Review demo

A local demo of rule-based transaction review over four synthetic companies (101–104). Jev, an AI judge, answers English conditions about each transaction; rules turn those answers into flags, assignments, tasks and message drafts. Employees are fictional and no email is sent.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

- Jev needs `AI_GATEWAY_API_KEY` in `.env`; message drafts need `GEMINI_API_KEY`. Neither is exposed to the browser.
- State lives in `workspace/actions.sqlite` (override with `WORKSPACE_DB`).
- Links: `?company=company-104`, `?workspace=rules|tasks|messages`, `?as=emp-cfo` (who you are viewing as).
- **Restore company** (bottom of Rules) returns the company to its original records and clears its tasks, messages, activity, supporting details and rule results. Saved rules stay, with Keep checking off. Other companies are untouched.

## The flow

1. **Explore** finds and inspects. It never changes anything. Search in English, combine conditions with AND/OR/NOT, filter by type, save a view. The suggested starter for the company sits at the top.
2. **Rules** acts. Four starter packs are the entry points: possible duplicate charges, missing documentation, possible payment fraud, unsupported expenses. Adding one saves it with Keep checking off and runs nothing.
3. **Preview & run** opens the results preview. **Run now** there applies each result's configured actions (Match, Not enough information, No match) to every evaluated preview record, whichever display filters are on. **Run all records** (Rules table) applies the rule to the whole company inside its record filters, after confirmation. **Keep checking** acts only on new or changed records.
4. **Tasks & activity** is the one place for what happened: rule flags, assignments, tasks, messages, resolutions and manual reviews, with Undo where the source allows it. The same events appear per transaction under *What happened* in the detail drawer.
5. **Messages**: rule drafts wait in Approvals. Only the draft's sender can approve; switch **Viewing as** (or use the *View as* button) to approve. Compose and reply are direct human mail.
6. **Supporting details** (transaction drawer): add the receipt or explanation, recheck the rule (automatic with Keep checking on, otherwise *Recheck now*), and the issue resolves when the rule finds No match and clears resolved issues.

## Who owns what

- **Transaction owner**: who the transaction is assigned to (Assign action or the drawer editor).
- **Task owner**: who does a task. Creating a task does not assign the transaction.
- **Human review** (drawer): a person's sign-off. It is separate from task Done, automated checks and rule results.
- New assignments store employee IDs; older names and unknown labels still display.

## Four-company walkthrough

Use the **Curated demo sample** in Preview records. Each company has a suggested starter; **Inspect example** opens its record.

| Company | Try first | Example |
|---|---|---|
| Parcelmint Online Goods (101) | Possible duplicate charges | `bill-00106`: reissued phone-case charge matching an earlier amount and purchase order. |
| Tallowfield Home Renovations (102) | Unsupported expenses | `bill-00145`: sitework billed after the project's cancellation notice. |
| Quillstone Creative Studio (103) | Missing documentation | `bill-00055`: production supplies with an unitemized receipt; expect Not enough information. |
| Marrow & Vine Catering (104) | Possible payment fraud | `bill-00097`: asks for account 7731 while 9631 is on file and discourages a confirmation call. |

These are synthetic scenarios. The app never reads `hidden/` or `synthetic/eval/`, and no labels reach Jev. Model results vary and are not accuracy scores.

## Verify

```sh
npm test && npm run typecheck && npm run build
npm run test:browser      # isolated SQLite, controlled model responses
```

## Regenerating synthetic data

See the README. Generation and validation tooling is offline (`scripts/generate_synthetic.py`, `scripts/validate_synthetic.py`).
