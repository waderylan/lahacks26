# Synthetic transaction-review extension

Four fictional companies added beside the 100 original ones so the Transaction Review demo has
realistic documentation problems, suspicious patterns and difficult legitimate look-alikes to find.
They are **synthetic extensions**, not part of the original dataset. Nothing here is a defect
discovered in the original data, and `data/raw/` is never modified.

| Company | Name | Derived from (amounts, vendors, payment terms) | Bills |
|---|---|---|---|
| company-101 | Parcelmint Online Goods (wholesale / e-commerce) | company-018 | 177 |
| company-102 | Tallowfield Home Renovations (remodeler) | company-042 | 183 |
| company-103 | Quillstone Creative Studio (professional services) | company-035 | 179 |
| company-104 | Marrow & Vine Catering (hospitality) | company-037 | 172 |

## Commands

```sh
uv run scripts/generate_synthetic.py            # seed 20261017 -> synthetic/extension-v1 + synthetic/eval
uv run scripts/generate_synthetic.py --seed 7 --out /tmp/x
uv run scripts/validate_synthetic.py            # references, arithmetic, coverage, leakage, reproducibility
npm test                                        # includes server/synthetic.test.ts (model-payload leakage)
uv run scripts/smoke_jev.py --companies company-102 --prompts P04 P05 P07   # needs the app running
```

## Layout

- `extension-v1/` (read by the app): world directories in the original YAML shape (company, accounts,
  items, terms, vendors, projects, bills, bill_payments) plus `evidence.yaml`, `index.json`,
  `demo_sample.json`, `DISCLOSURE.json`.
- `eval/` (**evaluation only, never read by the app or sent to Jev**): `case_manifest.json`,
  `provenance.json`, `demo_prompts.json`, and `measured_jev_smoke.json` after a smoke run.

## What is real and what is authored

- From the original company: vendors, amounts, dates, payment terms, payments, projects.
- Authored: every description and memo (ordinary text included), vendor display names where the
  original was incoherent, vendor-master payee fields (fictional bank names and account endings),
  document numbers, supporting evidence, the cancelled project, and every case.
- Scope: a **transaction-review dataset, not balanced books**. Journal entries, reports and balances
  are omitted. Added bills are described by their ledger effect in the manifest (`posted_paid`,
  `posted_unpaid`, `not_posted`, `text_only`) rather than booked. 4 cases are attempted bills held in
  an intake queue (`not_posted`).

## Cases

48/48/48/44 labeled rows (company-102/103/104/101) per company: documentation issues, suspected-fraud
patterns, uncertain cases and legitimate look-alikes, in seven families: A missing information,
B cross-field contradiction, C possible duplicate billing, D unsupported work or goods,
E personal or unrelated spending, F payment-diversion indicators, G attempts to influence the review.
Labels are `documentation_issue`, `suspected_fraud` (a suspicious pattern supported by evidence in
the synthetic scenario, not a verdict), `legitimate`, `uncertain` (evidence missing).
A blank memo or an unusual vendor is never a label by itself.

Prevalence is deliberately high (about 25% of rows are involved in a case, about a third of those are
legitimate look-alikes). The curated demo sample (`Rows` -> *Curated demo sample*) over-represents issues
further and is **not representative**; the app says so.

## Supporting records and model context

`evidence.yaml` holds ordinary business documents (purchase orders, receiving and completion records,
change orders, approval logs, vendor statements, receipts, project milestones, intake logs) linked by
bill id. The drawer shows them under *Related records*. Jev receives them as optional context only for
synthetic rows: `doc_number`, `vendor_payee`, `project`, `evidence`, and up to three nearby bills from
the same vendor. Labels, case ids, variants and rationales never reach the app or the model.

## Reference vs measured

`demo_prompts.json` lists 13 prompts with reference matches, uncertain rows and look-alike negatives
taken from the case manifest. They are authored, not Jev results. `measured_jev_smoke.json` holds
live Jev outcomes on the curated sample, scored against that reference without tuning either.
Reference lists are intentionally narrow, so other case rows that also fit a prompt show up as
extra matches and need human adjudication.

## Limits

- One year of history, bills only, one synthetic company per profile, text authored by hand rather than
  observed from real books.
- Fictional identifiers only; nothing executes payments or sends messages.
- The app caches a company's rows in its SQLite workspace on first view. After regenerating, clear
  that company's cached `bills` rows (or use a fresh `WORKSPACE_DB`) or the old rows will show.
