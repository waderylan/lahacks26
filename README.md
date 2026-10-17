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
- Bills are imported into a working SQLite database at `workspace/actions.sqlite` (override with `WORKSPACE_DB`). Tasks, review status, assignments, edits, receipts, and enabled dashboard automations persist on this server across browser sessions. Requires Node 22.13+; no separate database service or Intuit account is needed.
- Dataset disclosure: `data/raw/` stays unchanged. Category and memo edits affect only working copies in SQLite; edited cells and the bill drawer disclose their original values. Original line items and monetary amounts are preserved.
- The **Rules** workspace retains editable ALL / ANY / NOT groups. **Take action** executes grouped matches through the SQLite backend. The older **Run once** / replay demonstration still uses browser storage and is separate from dashboard actions. See [RULES_DEMO.md](RULES_DEMO.md) for both flows.
