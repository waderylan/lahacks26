# Transaction Review demo

Rule-based review of synthetic company transactions (companies 101–104), with Jev as the judge and fictional employees as reviewers. See [DEMO.md](DEMO.md) for setup, the walkthrough and verification.

```sh
npm install
npm run dev        # http://localhost:5173
```

- **Explore** finds and inspects transactions; **Rules** previews and runs actions from four starter packs; **Tasks & activity** shows everything that happened; **Messages** holds sender approvals and internal mail.
- Jev runs server-side through Vercel AI Gateway (`AI_GATEWAY_API_KEY`); Gemini writes message drafts (`GEMINI_API_KEY`). Credentials never enter the browser.
- All durable state is in `workspace/actions.sqlite` (`WORKSPACE_DB`). `hidden/` and `synthetic/eval/` are never used by the app.

Run `npm test`, `npm run test:browser`, `npm run typecheck` and `npm run build`.

# Dataset setup and regenerating synthetic data

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

Regenerate the synthetic companies with `uv run scripts/generate_synthetic.py` and check them with `uv run scripts/validate_synthetic.py`.

## Dashboard and evaluation models

Dashboard charts and company totals remain available in the Dashboard tab. Use Add chart to configure a chart and Keep on dashboard to save it. Refresh dashboard reloads records and saved chart definitions.

Explore and new rules can use Jev or Qwen. Saved rules retain their own evaluation provider; changing it requires a saved revision before running actions. See [MODEL_RUNTIME.md](MODEL_RUNTIME.md) for server configuration. Browser voice input is available in the Explore search bar on supported browsers.
