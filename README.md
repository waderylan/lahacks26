# QuickBooks Hackathon 2026 dataset

Setup for the [QuickBooks-Hackathon-2026](https://huggingface.co/datasets/CL251215/QuickBooks-Hackathon-2026)
`hackathon-100-participant` dataset: 100 synthetic companies, one year of books each.

## Commands

```sh
uv sync                                  # create .venv, install PyYAML
uv run scripts/download_dataset.py       # download + extract to data/raw/ (skips if present)
uv run scripts/download_dataset.py --force   # re-download and re-extract
uv run scripts/inspect_dataset.py        # summary, sample counts, example bill + vendor
```

Load data from Python (run from the project root):

```python
from decimal import Decimal
from qbdata import list_companies, world_dir, load_entity, load_all, load_report, sum_money

list_companies()                          # Company(company_id, display_name, industry_title, ...)
world_dir("company-001")                  # .../company-001/rwm-v4/world-<id>
bills = load_entity("company-001", "bills")   # [] for empty entity files
all_bills = load_all("bills")             # every record carries "company_id"
total = sum_money(b["total_amount"] for b in all_bills)   # Decimal, never float
```

## Layout

- `data/raw/hackathon-100/` holds the extracted dataset, unchanged (`index.json`, `DATA_README.md`, `company-NNN/rwm-v4/world-<id>/*.yaml`).
- Archive and `data/` are git-ignored, as are `.venv` and macOS metadata (`__MACOSX`, `._*`, `.DS_Store`), which extraction skips.
- `qbdata/loader.py` reads only the listed book entities and reports. `hidden/` simulation ground truth is not loadable through it.
- `SCHEMA.md` in each world directory is the field-level reference.

## Limitations

- Synthetic data, already reconciled: books balance and the bank feed matches booked cash exactly.
- QuickBooks-shaped YAML (qb-world-sim "realized world model"), not a native QuickBooks export.
- One year of history per company (365 days): no carry-forward balances, no year-over-year analysis.
- IDs are scoped to each company (`cust-customer-3` differs per company); always key on `(company_id, id)`.
- Monetary values are decimal strings (`"1234.56"`); use `Decimal`, never float.
- Some entity files are empty by design (e.g. a cafe has no invoices).
- Any later modification of the data (deleted rows, changed numbers, injected errors) must be disclosed with what changed and why.

## Transaction Review demo

See [COMBINED_DEMO.md](COMBINED_DEMO.md) for the saved-search, rule-action, message,
assignment, and resolution walkthrough.

```sh
npm install
npm run dev        # http://localhost:5173
```

- Spreadsheet of original vendor bills per company, loaded on demand from `data/raw/`. Choose 50, 100, or all records. Bill payments appear only as drawer context, never as separate spend.
- Semantic input calls Jev (`typesafe-ai/jev` via Vercel AI Gateway, `experimental_evaluate` choice questions) from `server/jev.ts`; requires `AI_GATEWAY_API_KEY` in `.env`. Jev returns match, no match, or uncertain. Probabilities are displayed as evidence, without replacing the selected outcome.
- Search in plain language, select matching bills, then use **Take action** to preview and create assigned review tasks, change categories or memos, assign bills, add flags/tags, or update review status.
- **Status** and **Assigned to** filters sit above the spreadsheet. **Tasks & activity** has task status/assignee filters, completion controls, action receipts, and conflict-aware undo.
- **Saved searches:** in **Transactions**, enter a query, choose filters, click **Save search**, and give it a name. The dropdown reopens saved searches for the current company. **Edit search** lets you rename, update, copy with **Save as new**, or delete a search. Changes to the query or filters show **Unsaved changes** until saved. Queries, transaction type, status, assignee, review tab, match-only setting, and sort order are stored in SQLite and shared across browsers; results use the currently loaded records. Search changes do not execute rule actions. Concurrent edits report a conflict and offer **Reopen saved search**.
- **All saved searches** lists the current company's searches with **On/Off** switches, check status/time, match counts, and **Check now**. New searches start Off. On checks the entire available company dataset every ten seconds while the server runs, including without an open browser; reserved replay records join only after arrival. The first successful check establishes a baseline. Later new records or nonmatches that become definite matches receive a **New** badge; uncertain results stay separate. **View new** includes records outside the spreadsheet's sample and opens their details. **Mark as seen** clears only the displayed match notifications, preserving later arrivals. Watch state, unread tokens, errors/backoff, and enabled state persist in SQLite. Changing criteria establishes a new baseline; renaming and sorting preserve tracking. Off pauses automatic checks and allows manual checking; re-enabling catches up with changes made while paused.
- All durable application state lives in `workspace/actions.sqlite` (override with `WORKSPACE_DB`): working bills, tasks, review status, assignments, category/memo edits, saved rules and revisions, execution history, messages and approval decisions, notification read/dismiss state, replay arrivals, automations, and display preferences. Separate browsers using this server share the same state. Requires Node 22.13+; no separate database service or Intuit account is needed.
- Dataset disclosure: `data/raw/` stays unchanged. Category and memo edits affect only working copies in SQLite; edited cells and the bill drawer disclose their original values. Original line items and monetary amounts are preserved.
- **Rules** opens a three-step editor: **Describe conditions**, **Choose actions**, **Review results**. English conditions are sent unchanged to Jev independently for every bill. Simple AND / OR / NOT controls support nested groups; optional amount/vendor/category/review filters remain available under **Add a filter**. The old block palette and permanent equation/action bars are replaced by the guided flow.
- Each rule result has its own actions: **Match**, **Not enough information**, and **No match**. Empty sections take no action; existing rules stay match-only. The review table shows each condition's judgment and **What will happen**. Save, then **Run once** on results with configured actions in the current view. History, undo, and replay are under **Action history & advanced options**. See [RULE_OUTCOMES.md](RULE_OUTCOMES.md) for examples and verification.
- Rules can create assigned review tasks and optionally clear their own earlier flags and complete their tasks when a later check returns **No match**. Add supporting details from a transaction's drawer; enabled rules check the changed records again. **Rule follow-up** and action history show what was resolved. Uncertain results stay open, and manual flags and reviewer changes are preserved.
- Synthetic companies also retain **Type** filters for vendor bills, customer invoices, and bank transactions in both guided review and the transaction spreadsheet. Invoice/bank labels and their original detail fields remain available when inspecting a row.
- All four synthetic companies are covered by browser checks for complete type-filtered lists, English OR matching, scoped assignments, status/owner filters, mobile review, and reload persistence. Jev payloads and both caches share the same visible evidence, including invoice remittance, bank destination, and supporting records; assignment-only changes reuse judgments.
- Switching between 50, 100, Demo sample, and All keeps the current unsaved rule while its company's rows reload. Changing companies still clears the previous company's draft and results.
- Add **Draft internal message** to a rule to summarize matching bills (up to 25 per draft). Choose a fictional employee from `src/employees.ts` or let Jev choose; Gemini writes the draft server-side (`GEMINI_API_KEY`). **Messages** supports edit / approve / reject. Approval is stored in SQLite; no email is delivered. Pending generation and retry state survive a server restart.
- **Spreadsheet status** shows the latest action on each bill (e.g. "Sent message to Marcus", "Flagged: Needs clarification", "Task for Dev: …") instead of only review state; hover for recent history, and ✓ marks reviewed bills.
- **Employee accounts and inbox:** **Viewing as** in the header selects your employee (`?as=emp-…` in the URL, so separate browser tabs can be different employees). **Messages** has Inbox, Sent and Approvals. Each message action has a **Send from** employee (defaults to whoever is signed in); its drafts appear only in that employee's Approvals, only they can approve or reject them, and approving delivers to the recipient's inbox; you can also compose and reply. Mail is stored in SQLite (`mail` documents, `server/mailbox.ts`), company-scoped, and never emailed.
- **Payment risk** (workspace tab): Jev judges each transaction *suspicious*, *can't tell* or *safe* for payment diversion (money sent to a bank account the business hasn't verified), using the vendor's payee details on file, the payment destination, change requests and evidence. Deterministic warning signs (account differs from the one on file, recent payee change, change request, urgency or secrecy) are shown beside each result to explain it, never to decide it. Results are cached in SQLite by the evidence Jev saw. **Flag and send to Robert** adds the flag "Possible payment diversion" and sends the CFO one summary from the signed-in employee. Code: `server/paymentRisk.ts`, `src/paymentRisk.ts`, `src/PaymentRiskPanel.tsx`. Measure it with `npx tsx --env-file=.env scripts/eval_payment_risk.ts [--others N]`, which scores against `synthetic/eval` labels (read only by the script, never sent to Jev).
- Existing browser rules/messages/review marks are imported once into SQLite when their company opens. Import never overwrites existing shared rules or newer bill edits. Normal application reads and writes do not use browser storage. See [RULES_DEMO.md](RULES_DEMO.md) for the workflow and verification commands.

## Ask your books (chat bubble)

- Bottom-right on every tab (`src/AskPanel.tsx`). Jev first reads the whole question once (`server/understand.ts`, `/api/understand`) and picks the answer type, whether it narrows to a kind of spending, and the period, all as multiple-choice answers; text rules in `src/insights.ts` are the fallback. A narrowed question is then judged per bill by Jev, and every number is an exact integer-cent sum of the listed bills.
- Also answers "What's on my plate?" (the signed-in employee's open tasks, assigned bills, unread mail and approvals) and "What's due soon?" (open balances by due date, no AI).
- Answers with bills can create tasks, assign, flag, tag or mark reviewed through the existing action engine (preview, then apply), or message a teammate (Jev can pick the recipient; the message links the bills).
- **Model picker** in the chat header: Jev (default) runs on `AI_GATEWAY_API_KEY`; Gemini 3.5 Flash / Flash-Lite run on `GEMINI_API_KEY` (`server/llm.ts`) for reading the question, judging bills (up to 100 per request, same rules and fields as Jev) and "let AI choose". The gateway key is never used for anything but Jev; `server/keys.test.ts` enforces it. Gemini gives no probabilities and reports tokens instead of dollars.
- History is saved per company and employee in SQLite (`server/chat.ts`). If Jev calls fail, the chat says so and offers Try again rather than reporting zero matches.
