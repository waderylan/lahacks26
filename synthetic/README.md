# Synthetic transaction-review extension

Four fictional companies added beside the 100 original ones so the Transaction Review demo has
realistic documentation problems, suspicious patterns and difficult legitimate look-alikes to find.
They are **synthetic extensions**, not part of the original dataset. Nothing here is a defect
discovered in the original data, and `data/raw/` is never modified.

| Company | Name | Derived from | Vendor bills | Customer invoices | Bank transactions | Total |
|---|---|---|---|---|---|---|
| company-101 | Parcelmint Online Goods (wholesale / e-commerce) | company-018 | 177 | 87 | 82 | 346 |
| company-102 | Tallowfield Home Renovations (remodeler) | company-042 | 183 | 55 | 82 | 320 |
| company-103 | Quillstone Creative Studio (professional services) | company-035 | 179 | 49 | 82 | 310 |
| company-104 | Marrow & Vine Catering (hospitality) | company-037 | 172 | 44 | 82 | 298 |

Three reviewable transaction types, for these four companies only (the 100 original companies stay bills-only):

- **Vendor bills** (`bill-*`): as before.
- **Customer invoices** (`inv-*`): the original company's invoices and customer payments (e-commerce samples 84 of
  its 5,551; the project companies keep all their stage invoices) plus authored ordinary invoices such as change-order
  billing, reimbursables and warranty calls. Each carries the company's remit-to account.
- **Bank transactions** (`bank-*`): built from the synthetic bills' and invoices' payments, original payroll runs and
  authored bank fees. Each carries the payee or payer, the channel, a trace reference and the counterparty account ending
  (`deposit` / `withdrawal`; the source feed's debit/credit labels are not reused). A payment's destination account
  ending can be compared with the vendor master, which is how the payment-diversion bank cases work.

In the app, rows show an Invoice or Bank tag, the drawer shows the type and a Details block, and a **Type** filter appears
for these companies. Evidence records link to any transaction type (`transaction_ids`).

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

85 / 89 / 89 / 89 labeled rows (companies 101 / 102 / 103 / 104) across the three types: documentation issues, suspected-fraud
patterns, uncertain cases and legitimate look-alikes, in seven families: A missing information,
B cross-field contradiction, C possible duplicate billing, D unsupported work or goods,
E personal or unrelated spending, F payment-diversion indicators, G attempts to influence the review.
Labels are `documentation_issue`, `suspected_fraud` (a suspicious pattern supported by evidence in
the synthetic scenario, not a verdict), `legitimate`, `uncertain` (evidence missing).
A blank memo or an unusual vendor is never a label by itself.

Prevalence is deliberately high (about 28% of rows are involved in a case, about a third of those are
legitimate look-alikes). The curated demo sample (`Rows` -> *Curated demo sample*) over-represents issues
further and is **not representative**; the app says so.

## Supporting records and model context

`evidence.yaml` holds ordinary business documents (purchase orders, receiving and completion records,
change orders, approval logs, vendor statements, receipts, project milestones, intake logs) linked by
bill id. The drawer shows them under *Related records*. Jev receives them as optional context only for
synthetic rows: `doc_number`, `vendor_payee`, `project`, `evidence`, and up to three nearby bills from
the same vendor. Labels, case ids, variants and rationales never reach the app or the model.

## Reference vs measured

`demo_prompts.json` lists 21 prompts (P14-P21 target invoices and bank transactions) with reference matches, uncertain rows and look-alike negatives
taken from the case manifest. They are authored, not Jev results. `measured_jev_smoke.json` holds
live Jev outcomes on the curated sample, scored against that reference without tuning either.
Reference lists are intentionally narrow, so other case rows that also fit a prompt show up as
extra matches and need human adjudication.

## Limits

- One year of history, one synthetic company per profile, text authored by hand rather than
  observed from real books.
- Fictional identifiers only; nothing executes payments or sends messages.
- The app copies a company's rows into its SQLite workspace on first view. For these companies the copy is
  versioned by a hash of the source files, so regenerating the data replaces the stale cached rows automatically
  (dashboard state on those rows resets; other companies are untouched).
- Invoice and bank amounts come from the original company or from its payments, but the invoices are not reconciled with
  a ledger, and some original project invoices have retainage and deposits that customers settle net.
