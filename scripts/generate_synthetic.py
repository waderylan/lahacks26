"""Generate the synthetic transaction-review extension (four companies derived from original profiles).

    uv run scripts/generate_synthetic.py                 # seed 20261017, writes synthetic/
    uv run scripts/generate_synthetic.py --seed 7 --out /tmp/x

App-facing output (read by the app):  <out>/extension-v1/
Evaluation-only output (never read):  <out>/eval/   (case manifest, provenance, demo prompts)
Original data under data/raw/ is only read, never modified.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

from synth_cases import PROFILES, roster_ecom, roster_projects  # noqa: E402
from synth_core import ROOT, Ctx, cents, digest, money  # noqa: E402
from synth_text import COMPANIES  # noqa: E402

DEFAULT_SEED = 20261017
FAMILIES = {"A": "missing_information", "B": "cross_field_contradiction", "C": "possible_duplicate_billing", "D": "unsupported_work_or_goods",
            "E": "personal_or_unrelated_spending", "F": "payment_diversion_indicators", "G": "review_system_influence"}

PROMPTS = [
    ("P01", "Find descriptions that contain words but don't explain what was purchased.", "A", "broad"),
    ("P02", "Find bills whose description is blank or only a placeholder.", "A", "narrow"),
    ("P03", "Find records where the memo contradicts the purchase details.", "B", "broad"),
    ("P04", "Find bills that may charge twice for the same underlying work.", "C", "broad"),
    ("P05", "Find payment-instruction changes that conflict with the vendor records.", "F", "broad"),
    ("P06", "Find bills claiming work or goods that the purchase order, receiving or project records don't support.", "D", "broad"),
    ("P07", "Find transaction text that tries to influence the reviewer or bypass checks.", "G", "broad"),
    ("P08", "Find bills whose text claims an approval that the approval records don't show.", "G", "narrow"),
    ("P09", "Find bills dated after the project they reference was cancelled.", "D", "narrow"),
    ("P10", "Find card bills where the receipt shows something different from the business purpose stated.", "E", "narrow"),
    ("P11", "Find goods bills where the receiving record shows fewer units than were billed.", "D", "narrow"),
    ("P12", "Find one-time fees that were billed more than once for the same period.", "C", "narrow"),
    ("P13", "Find urgent or secretive requests combined with a change of payment details.", "F", "narrow"),
]


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")


def jdump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_company(cfg: dict, seed: int) -> Ctx:
    c = Ctx(cfg, seed)
    if cfg["kind"] == "ecom":
        roster_ecom(c)
    else:
        roster_projects(c, PROFILES[cfg["kind"]])
    c.ordinary_extras()
    return c


def finalize(c: Ctx):
    order = sorted(c.bills, key=lambda b: (b["txn_date"], digest(c.seed, c.cid, b["_k"])))
    kmap = {}
    for i, b in enumerate(order, 1):
        b["id"] = f"bill-{i:05d}"
        kmap[b["_k"]] = b["id"]
    # the five latest bills stay ordinary: the app reserves them for replay
    case_keys = {k for case in c.cases for k in [case["primary"], *case["related"]]}
    assert not (set(b["_k"] for b in order[-5:]) & case_keys) and not any(b["_touched"] for b in order[-5:]), f"{c.cid}: reserved bills touched"
    pay_order = sorted((b for b in order if b["_pay"]), key=lambda b: (b["_pay"]["date"], b["id"]))
    pays = []
    for i, b in enumerate(pay_order, 1):
        p = b["_pay"]
        pays.append({"id": f"bpay-{i:05d}", "vendor_id": b["vendor_id"], "vendor_name": b["vendor_name"], "txn_date": p["date"], "amount": p["amount"],
                     "applications": [{"document_id": b["id"], "amount": p["amount"]}], "payment_account_id": p["account"], "memo": "Payment sent against vendor bill."})
    ev_order = sorted(c.evidence, key=lambda e: (e["date"], digest(c.seed, c.cid, e["_k"])))
    emap = {e["_k"]: f"ev-{i:04d}" for i, e in enumerate(ev_order, 1)}
    evidence = []
    for e in ev_order:
        rec = {"id": emap[e["_k"]], "kind": e["kind"], "date": e["date"], "title": e["title"], "text": e["text"]}
        if e["vendor_id"]:
            rec["vendor_id"] = e["vendor_id"]
        if e["project_id"]:
            rec["project_id"] = e["project_id"]
        rec["bill_ids"] = sorted(kmap[k] for k in e["bills"])
        evidence.append(rec)
    bills = []
    for b in order:
        bills.append({k: b[k] for k in ("id", "doc_number", "vendor_id", "vendor_name", "expense_kind", "txn_date", "due_date", "item_lines", "account_lines",
                                        "total_amount", "project_id", "cost_category", "memo")})
    return order, kmap, bills, pays, evidence, emap


def check(c: Ctx, order, evidence):
    ids = [b["id"] for b in order]
    assert len(ids) == len(set(ids)), "duplicate bill ids"
    docs = [(b["vendor_id"], b["doc_number"]) for b in order]
    assert len(docs) == len(set(docs)), f"{c.cid}: duplicate vendor/doc number"
    vendors = {v["id"] for v in c.vendors_out()}
    projects = set(c.projects)
    for b in order:
        lines = b["item_lines"] + b["account_lines"]
        assert sum(cents(l["amount"]) for l in lines) == cents(b["total_amount"]), f"{b['id']}: line total mismatch"
        for l in b["item_lines"]:
            assert l["quantity"] * cents(l["unit_price_amount"]) == cents(l["amount"]), f"{b['id']}: qty*price mismatch"
        assert b["vendor_id"] in vendors and (not b["project_id"] or b["project_id"] in projects)
        assert b["due_date"] >= b["txn_date"]
    bill_ids = set(ids)
    for e in evidence:
        assert set(e["bill_ids"]) <= bill_ids


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--out", type=Path, default=ROOT / "synthetic")
    args = ap.parse_args()
    app_dir, eval_dir = args.out / "extension-v1", args.out / "eval"
    for d in (app_dir, eval_dir):
        if d.exists():
            shutil.rmtree(d)
    index, manifest, provenance, samples = [], [], {}, {}
    expected: dict[str, dict] = {}
    for cfg in COMPANIES:
        c = build_company(cfg, args.seed)
        order, kmap, bills, pays, evidence, emap = finalize(c)
        check(c, order, evidence)
        world = "world-" + digest(args.seed, cfg["new"], "world")[:16]
        wd = app_dir / cfg["new"] / "rwm-v4" / world
        projects = list(c.projects.values())
        vendors = c.vendors_out()
        dump(wd / "company.yaml", c.company_out())
        dump(wd / "accounts.yaml", c.accounts)
        dump(wd / "items.yaml", c.items)
        dump(wd / "terms.yaml", c.terms)
        dump(wd / "vendors.yaml", vendors)
        dump(wd / "projects.yaml", projects)
        dump(wd / "bills.yaml", bills)
        dump(wd / "bill_payments.yaml", pays)
        dump(wd / "evidence.yaml", evidence)
        src_entry = next(r for r in json.loads((ROOT / "data/raw/hackathon-100/index.json").read_text(encoding="utf-8")) if r["company_id"] == cfg["src"])
        index.append({
            "company_id": cfg["new"], "display_name": cfg["name"], "industry_naics": src_entry["industry_naics"], "industry_title": src_entry["industry_title"],
            "profile": src_entry["profile"], "archetype": "synthetic_extension", "size_tier": src_entry["size_tier"], "dataset_id": world,
            "business_status": "open", "distressed": False, "synthetic_extension": True, "derived_from": cfg["src"],
            "entity_counts": {"bills": len(bills), "bill_payments": len(pays), "vendors": len(vendors), "projects": len(projects), "evidence": len(evidence)},
        })
        # --- evaluation-only outputs ---
        by_key = {b["_k"]: b for b in order}
        case_rows = {}
        for case in c.cases:
            case_id = digest(args.seed, cfg["new"], case["_k"])[:10]
            tx = kmap[case["primary"]]
            case_rows[tx] = case
            manifest.append({
                "case_id": case_id, "company_id": cfg["new"], "transaction_id": f"{cfg['new']}:{tx}", "related_transaction_ids": [f"{cfg['new']}:{kmap[k]}" for k in case["related"]],
                "family": f"{case['family']}.{FAMILIES[case['family']]}", "variant": case["variant"], "label": case["label"], "expected_review_action": case["action"],
                "evidence_ids": sorted(emap[k] for k in case["evidence"]), "posting_state": case["posting"], "ledger_effect": case["ledger_effect"],
                "rationale": case["rationale"], "injection": case["injection"], "prompt_expectations": case["expect"],
                "related_prompt_expectations": {f"{cfg['new']}:{kmap[k]}": case["rel_expect"] for k in case["related"]} if case["rel_expect"] else {},
            })
        prov_bills = []
        involved = {k for case in c.cases for k in [case["primary"], *case["related"]]}
        for b in order:
            kind = ("added_for_case" if b["_added"] and b["_k"] in involved else "added_ordinary" if b["_added"] else
                    "case_modified" if b["_touched"] else "ordinary_text_authored")
            prov_bills.append({"transaction_id": f"{cfg['new']}:{b['id']}", "source_bill_id": f"{cfg['src']}:{b['_src']}" if b["_src"] else None, "kind": kind,
                               "original_description": b["_orig"]["description"], "original_memo": b["_orig"]["memo"],
                               "description": " | ".join(dict.fromkeys(l["description"] for l in b["item_lines"] + b["account_lines"])), "memo": b["memo"]})
        provenance[cfg["new"]] = {"name": cfg["name"], "derived_from": cfg["src"], "vendor_renames": cfg["vendors"],
                                  "cancelled_project": c.cancelled, "source_bills_selected": sum(1 for b in order if b["_src"]), "bills_added": sum(1 for b in order if b["_added"]),
                                  "notes": "Ordinary bill text is authored; amounts, dates, vendors and payments come from the source company. Journal entries, reports and balances are not included.",
                                  "bills": prov_bills}
        # curated demo sample: every case row plus ordinary look-alike decoys from the same vendors
        ids = {kmap[k] for k in involved}
        reserved = {b["id"] for b in order[-5:]}
        vendors_in_cases = {by_key[k]["vendor_id"] for k in involved}
        decoys = [b["id"] for b in order if not b["_touched"] and b["vendor_id"] in vendors_in_cases and b["id"] not in reserved]
        step = max(1, len(decoys) // 16)
        ids |= set(decoys[::step][:16])
        samples[cfg["new"]] = sorted(ids)
        expected[cfg["new"]] = {"rows": len(bills), "sample_rows": len(ids), "reserved_last_five": sorted(reserved)}
        print(f"{cfg['new']} {cfg['name']}: {len(bills)} bills, {len(evidence)} evidence, {len(c.cases)} cases, sample {len(ids)}")

    jdump(app_dir / "index.json", index)
    jdump(app_dir / "demo_sample.json", {
        "label": "Curated demo sample",
        "disclosure": "Curated demo sample: selected to include a dense mix of review cases and ordinary look-alikes. It over-represents issues and is not representative of the full company.",
        "samples": samples})
    jdump(app_dir / "DISCLOSURE.json", {"disclosure": "Synthetic extension company. Derived from an original company's vendor, amount and payment patterns; descriptions, memos, supporting records and review cases are authored. Not part of the original dataset. Journal entries, reports and balances are not included."})
    # --- evaluation-only: reference expectations per prompt, from the manifest only ---
    tx_by_company = {cfg["new"]: expected[cfg["new"]] for cfg in COMPANIES}
    prompts = []
    for pid, text, fam, scope in PROMPTS:
        per = {}
        for cfg in COMPANIES:
            cid = cfg["new"]
            hit, unc, neg, sample_hit = [], [], [], []
            for m in manifest:
                if m["company_id"] != cid:
                    continue
                exp = dict(m["prompt_expectations"])
                if pid in exp:
                    {"match": hit, "uncertain": unc, "no_match": neg}[exp[pid]].append(m["transaction_id"])
                for t, e in m["related_prompt_expectations"].items():
                    if pid in e and e[pid] == "no_match":
                        neg.append(t)
            per[cid] = {"reference_matches": sorted(hit), "reference_uncertain": sorted(unc), "reference_negative_lookalikes": sorted(set(neg)),
                        "counts": {"match": len(hit), "uncertain": len(unc), "lookalike_no_match": len(set(neg))}}
        prompts.append({"id": pid, "prompt": text, "family": fam, "scope": scope, "per_company": per,
                        "note": "Reference outcomes come from the authored case manifest. They are not Jev results."})
    jdump(eval_dir / "case_manifest.json", {"schema": 1, "seed": args.seed, "labels": ["documentation_issue", "suspected_fraud", "legitimate", "uncertain"],
                                           "note": "Evaluation only. Never read by the app and never sent to Jev.", "cases": manifest})
    jdump(eval_dir / "provenance.json", {"schema": 1, "seed": args.seed, "companies": provenance})
    jdump(eval_dir / "demo_prompts.json", {"schema": 1, "seed": args.seed, "prompts": prompts, "measured_jev_results": None,
                                          "note": "measured_jev_results is filled only by smoke runs, separately from these reference outcomes."})
    label_counts = Counter((m["company_id"], m["label"]) for m in manifest)
    fam_counts = Counter(m["family"] for m in manifest)
    print("labels:", dict(sorted(label_counts.items())))
    print("families:", dict(sorted(fam_counts.items())))


if __name__ == "__main__":
    main()
