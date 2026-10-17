# Integrate this pack into the existing app

Selling point: **Filter by meaning as easily as you filter by a column.**

Reuse the spreadsheet and Vercel AI Gateway Jev integration already being built. No replacement app or direct TypeSafe integration.

## Load the right records

- `demo_companies.json` contains ONE scenario company with 30 bill records. Add it as a clearly labeled demo option; preserve access to original companies. If the same company ID exists in the original data, namespace this fixture source separately in UI state, result caching, and review persistence so it cannot overwrite/collide with the original version.
- `original_demo_companies.json` contains unmodified 30-record samples for two companies, retained as reference/backups. It is NOT the main demo.
- Use top-level normalized `description` and `memo` as displayed spreadsheet columns. Do not substitute original descriptions. `source_bill` is the corresponding modified scenario bill for the detail panel. `original_source_bill` exists solely for the disclosure/provenance view and must never go into model requests.
- Existing IDs, dates, amounts, vendor and account values are unchanged. ALL descriptions/memos in the main 30-row fixture have authored overlays; display “Synthetic review scenarios — descriptions and memos modified”. `scenario_audit.json` gives every modification.
- Review status initializes to needs_review and is separate from model selection and payment status.

## Model behavior

Use each current prompt directly as the criterion. Send visible description and memo, and only contextual fields needed by that prompt. Question instructions must say WHICH fields are being judged: a populated vendor/account must not cause a blank Description cell to be classified as informative. The memo cannot repair a vague description when the user asks about Description alone.

Use match / no_match / uncertain. Missing substantive evidence is not an explicit contradiction. For the contradiction query, blank/vague descriptions should be uncertain. Do not hide uncertain records as confident no-match decisions.

Keep answer_key.csv, expected outputs in queries.json, scenario groups in scenario_audit.json, original_source_bill, and all evaluation policies out of inference state. The visible natural-language criterion can be sent; the answer key and classification taxonomy cannot.

## UI

Show Description and Memo columns simultaneously. This is essential for judging semantic contradictions. Preserve whitespace visibly as a blank cell; do not replace placeholders with meaningful text before inference.

Make three prompt chips: “Effectively blank descriptions”, “Descriptions that don't explain the purchase”, “Memo contradicts description”. Chips should populate the full natural-language prompts from queries.json, not hardcode returned IDs.

Keep the existing live highlighting, uncertainty state, progress counter, manual selection and review actions. No canned results, keyword stand-ins, simulated latency, or silent fallback presented as Jev.

## Verify

30 rows, no date/amount/review filtering, all initially unreviewed:
- effectively_blank: 6 matches.
- nonempty_uninformative: 6 matches.
- conflict: 6 matches and 12 uncertain.
- needs_attention: 18 matches.
- agreement: 12 matches and 12 uncertain.

These are authored reference expectations, not measured Jev performance. If Jev disagrees, inspect honestly; never force expected IDs into live results. README.md contains the demo sequence and baseline interpretation. score_predictions.py checks exports locally.
