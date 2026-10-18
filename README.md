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

```sh
npm install
npm run dev        # http://localhost:5173
```

- Spreadsheet of original vendor bills per company, loaded on demand from `data/raw/`. Choose 50, 100, or all records. Bill payments appear only as drawer context, never as separate spend.
- Semantic input calls Jev (`typesafe-ai/jev` via Vercel AI Gateway, `experimental_evaluate` choice questions) from `server/jev.ts`; requires `AI_GATEWAY_API_KEY` in `.env`. Jev returns match, no match, or uncertain. Probabilities are displayed as evidence, without replacing the selected outcome.
- Search in plain language, select matching bills, then use **Take action** to preview and create assigned review tasks, change categories or memos, assign bills, add flags/tags, or update review status.
- **Status** and **Assigned to** filters sit above the spreadsheet. **Tasks & activity** has task status/assignee filters, completion controls, action receipts, and conflict-aware undo.
- All durable application state lives in `workspace/actions.sqlite` (override with `WORKSPACE_DB`): working bills, tasks, review status, assignments, category/memo edits, saved rules and revisions, execution history, messages and approval decisions, notification read/dismiss state, replay arrivals, automations, and display preferences. Separate browsers using this server share the same state. Requires Node 22.13+; no separate database service or Intuit account is needed.
- Dataset disclosure: `data/raw/` stays unchanged. Category and memo edits affect only working copies in SQLite; edited cells and the bill drawer disclose their original values. Original line items and monetary amounts are preserved.
- **Rules** opens a three-step editor: **Describe conditions**, **Choose actions**, **Review matches**. English conditions are sent unchanged to Jev independently for every bill. Simple AND / OR / NOT controls support nested groups; optional amount/vendor/category/review filters remain available under **Add a filter**. The old block palette and permanent equation/action bars are replaced by the guided flow.
- The review step shows match/nonmatch/uncertain counts, individual condition judgments, bill inspection, and status/assignee filters. Save a rule, then **Run once** on definite matches in the current view. Existing saved rules, SQLite receipts, undo, and background automation keep their original semantics. History and replay are under **Action history & advanced options**.
- Synthetic companies also retain **Type** filters for vendor bills, customer invoices, and bank transactions in both guided review and the transaction spreadsheet. Invoice/bank labels and their original detail fields remain available when inspecting a row.
- All four synthetic companies are covered by browser checks for complete type-filtered lists, English OR matching, scoped assignments, status/owner filters, mobile review, and reload persistence. Jev payloads and both caches share the same visible evidence, including invoice remittance, bank destination, and supporting records; assignment-only changes reuse judgments.
- Switching between 50, 100, Demo sample, and All keeps the current unsaved rule while its company's rows reload. Changing companies still clears the previous company's draft and results.
- Add **Draft internal message** to a rule to summarize matching bills (up to 25 per draft). Choose a fictional employee from `src/employees.ts` or let Jev choose; Gemini writes the draft server-side (`GEMINI_API_KEY`). **Messages** supports edit / approve / reject. Approval is stored in SQLite; no email is delivered. Pending generation and retry state survive a server restart.
- **Spreadsheet status** shows the latest action on each bill (e.g. "Sent message to Marcus", "Flagged: Needs clarification", "Task for Dev: …") instead of only review state; hover for recent history, and ✓ marks reviewed bills.
- **Employee accounts and inbox:** **Viewing as** in the header selects your employee (`?as=emp-…` in the URL, so separate browser tabs can be different employees). **Messages** has Inbox, Sent and Approvals. Each message action has a **Send from** employee (defaults to whoever is signed in); its drafts appear only in that employee's Approvals, only they can approve or reject them, and approving delivers to the recipient's inbox; you can also compose and reply. Mail is stored in SQLite (`mail` documents, `server/mailbox.ts`), company-scoped, and never emailed.
- Existing browser rules/messages/review marks are imported once into SQLite when their company opens. Import never overwrites existing shared rules or newer bill edits. Normal application reads and writes do not use browser storage. See [RULES_DEMO.md](RULES_DEMO.md) for the workflow and verification commands.
