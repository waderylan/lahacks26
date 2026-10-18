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

See [COMBINED_DEMO.md](COMBINED_DEMO.md) for setup, a walkthrough, and verification.

```sh
npm install
npm run dev        # http://localhost:5173
```

- **Explore** starts with a live search bar. Checks start after a one-second pause in typing; matches highlight and rise to the top, sorted by match confidence. Single searches show a percentage for every checked row. **Combine conditions** opens AND/OR/NOT editing without losing the current search. Saved views reopen their criteria and show current search parameters at the top. Views never run actions.
- **Create rule** copies an Explore condition tree and record filters into an independent draft. Choose actions, preview their results, name the rule, and save.
- **Rules** lists all saved rules. **Run now** opens a preview of existing records before applying actions. **Keep checking** checks new or changed available records every ten seconds while the server runs; switching it on establishes the baseline.
- The company rules table shows last-check counts and times, open issues, record filters, and the saved revision. Edit or delete rules there. **Run all records** checks all available company records within the rule's filters after confirmation, including records outside the preview sample. Deleting preserves earlier tasks, flags, messages, and history.
- **Rule starter packs** provides editable examples for duplicate charges, missing documentation, payment fraud, and unsupported expenses. Adding saves a company-specific rule with recurring checks off and runs no actions. Repeated adds reopen the existing starter, including after edits or renames.
- **Fraud checks** (under Rules): Jev review checks, each asking one question of every transaction, with a switch between them. Deterministic warning signs beside each result explain it, never decide it. Results are cached in SQLite by the evidence Jev saw (and, for duplicates, the earlier transactions), and **Flag and send** adds a flag and sends one summary to a chosen employee from the signed-in one. Shared engine: `server/reviewChecks.ts`, `src/reviewChecks.ts`, `src/ReviewCheckPanel.tsx`.
  - **Payment risk**: *suspicious*, *can't tell* or *safe* for payment diversion (money sent to a bank account the business hasn't verified), from the vendor's payee details on file, the payment destination, change requests and evidence. Signs: account differs from the one on file, recent payee change, change request, urgency or secrecy. Default recipient: the CFO. `server/paymentRisk.ts`.
  - **Duplicates**: Jev chooses between "same as" each earlier transaction from the same vendor or customer (computed from the whole company, nearest first), *can't tell* and *distinct*, so a flag always names the original it repeats and the original itself is never flagged. Transactions with nothing earlier are cleared without a Jev call. Signs: same amount N days earlier, a reordered or one-character-different document number, a different vendor display name, no supporting records. Default recipient: AP. `server/duplicates.ts`, `src/duplicates.ts`.
  - Measure either with `npx tsx --env-file=.env scripts/eval_checks.ts --check payment-risk|duplicates [--others N]`, which scores against `synthetic/eval` labels (read only by the script, never sent to Jev).
- **Ask your books** provides chat, model choice, and company/employee-specific history.
- Each result has separate actions: Match, Not enough information, and No match. Rules can flag, assign, create review tasks, draft messages, tag, or mark an automated check. Uncertain results cannot be marked checked.
- **Tasks & activity** shows task owners and status. Rules can clear their own earlier flags and close their unchanged tasks after a later definite No match. Add verified supporting details from a task or rule result drawer to trigger a recheck.
- **Messages** has Inbox, Sent, and Approvals. Jev can choose the recipient; Gemini writes a draft. The sender approves before internal delivery. No email is sent. Employees are fictional.
- Jev runs server-side through Vercel AI Gateway and needs AI_GATEWAY_API_KEY in .env. Gemini drafts need GEMINI_API_KEY. Credentials never enter the browser.
- Condition judgments are cached in SQLite by company, condition, and visible transaction evidence. Explore and Rules share these answers across server restarts. Evidence edits invalidate results; assignments alone reuse them.
- All durable state lives in workspace/actions.sqlite, configurable with WORKSPACE_DB. Existing browser state is imported once; newer shared edits take priority. Earlier saved searches remain available as views; their old recurring monitoring is paused.
- Choose 50, 100, all records, or a curated synthetic demo sample. Preview limits affect viewing and manual runs. Recurring rules check the full available company dataset, excluding reserved records until replayed.
- Original records remain unchanged. Synthetic companies include bills, customer invoices, and bank transactions with supporting details. hidden/ and synthetic/eval/ are never used by the application.

Run npm test, npm run test:browser, npm run typecheck, and npm run build. Browser tests use isolated SQLite and controlled model responses.

The next planned task is a Simulate tab for timestamped arrivals and user-controlled time advancement; it is not implemented.
