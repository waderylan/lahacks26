# Transaction Review: quick, cheap demo setup

## Shorter, cheaper example

- A **Rows** selector in the toolbar offers 50, 100 or All. It thins the company to an evenly spaced sample. Default is 50.
- Tiny companies (~36 bills, e.g. company-098) were not used: their bills are only rent, insurance and program costs.
- Shipwise Online Goods (company-018), "Anything electronic or tech-related":
  - 50 rows: 2 s, about $0.00085, 20 matches.
  - All 416 rows: about 4.5 s, about $0.007, 180 matches.
  - The 50-row run is about 8x cheaper.
- Changing the row count reloads the sheet and clears results and selection.

## Natural-language chips

- Each chip is the full prompt text, with no short labels.
- An **Examples** dropdown next to the chips picks the set shown. The set and row count persist in the browser.

| Set | Prompts |
|---|---|
| Everyday language (default) | Anything electronic or tech-related; Anything you could wear; Bills for electricity, water, or other utilities; Bills where the memo mentions a delay or something not arriving yet |
| Description and memo quality | Descriptions that are blank or just a placeholder; Descriptions that don't say what was bought; Memos that contradict the description |
| Goods vs overhead memos | Four compound prompts about goods billed with overhead memos, utility bills with backorder memos, premises/utility/interest/tax bills with shipment memos, and vague "proportion to trading" services |

## Verification

- `tsc` is clean.
- Row limits return 50, 100 and 416 rows for company-018.
- The live 50-row Jev run completed (50 of 50 evaluated).
- The dropdowns were not tested in a browser.
- Restart the server (`npm run dev`) to load server changes, then hard refresh http://localhost:5173.
