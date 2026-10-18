"""Small live Jev smoke evaluation against the running app, scored against the reference manifest.

    uv run scripts/smoke_jev.py --companies company-102 --prompts P04 P05 P07

Writes synthetic/eval/measured_jev_smoke.json. Measured outcomes are reported separately from the
authored reference outcomes and are never used to tune either the data or the labels.
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "synthetic" / "eval"


def call(url: str, body: dict | None = None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5173")
    ap.add_argument("--companies", nargs="+", default=["company-102"])
    ap.add_argument("--prompts", nargs="+", default=["P04", "P05", "P07"])
    args = ap.parse_args()
    manifest = json.loads((EVAL / "case_manifest.json").read_text(encoding="utf-8"))["cases"]
    prompts = {p["id"]: p for p in json.loads((EVAL / "demo_prompts.json").read_text(encoding="utf-8"))["prompts"]}
    out = {"note": "Measured Jev outcomes on the curated demo sample (enriched, not representative). Reference labels are authored and were not tuned to these results.", "runs": []}
    for cid in args.companies:
        rows = call(f"{args.base}/api/companies/{cid}/bills?limit=-1&reserve=1")["rows"]
        ids = [r["id"] for r in rows]
        for pid in args.prompts:
            text = prompts[pid]["prompt"]
            states, cost = {}, 0
            for i in range(0, len(ids), 20):
                reply = call(f"{args.base}/api/evaluate", {"companyId": cid, "criterion": text, "ids": ids[i:i + 20]})
                states.update({r["id"]: r["state"] for r in reply["results"]})
                cost += int(reply.get("costNanoUsd", 0))
            ref = {}
            for m in manifest:
                if m["company_id"] != cid:
                    continue
                if pid in m["prompt_expectations"]:
                    ref[m["transaction_id"]] = m["prompt_expectations"][pid]
                for t, e in m["related_prompt_expectations"].items():
                    if pid in e and e[pid] != "either":
                        ref.setdefault(t, e[pid])
            positives = {t for t, e in ref.items() if e == "match"}
            got = {t for t, s in states.items() if s == "match"}
            either = {t for m in manifest if m["company_id"] == cid for t, e in m["related_prompt_expectations"].items() if e.get(pid) == "either"}
            tp, fp = positives & got, (got - positives) - either
            fn = positives - got
            lookalikes = {t for t, e in ref.items() if e == "no_match"}
            unc = {t for t, e in ref.items() if e == "uncertain"}
            run = {"company": cid, "prompt_id": pid, "prompt": text, "rows_evaluated": len(ids), "cost_usd": cost / 1e9,
                   "reference_matches": len(positives), "measured_matches": len(got), "true_positives": len(tp), "false_positives": len(fp), "false_negatives": len(fn),
                   "lookalikes_wrongly_matched": sorted(lookalikes & got), "reference_uncertain": len(unc), "reference_uncertain_answered": {t: states.get(t) for t in sorted(unc)},
                   "missed": sorted(fn), "extra": sorted(fp)}
            out["runs"].append(run)
            print(f"{cid} {pid}: ref {len(positives)} / measured {len(got)} / TP {len(tp)} FP {len(fp)} FN {len(fn)} lookalike-hits {len(lookalikes & got)} cost ${cost / 1e9:.5f}")
    (EVAL / "measured_jev_smoke.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
