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

import synth_ar as ar  # noqa: E402
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
    ("P14", "Find invoices for work, projects or orders that were cancelled before the invoice date.", "D", "invoice"),
    ("P15", "Find invoices that ask the customer to pay a different account than the company's own remittance details.", "F", "invoice"),
    ("P16", "Find bank payments sent to an account that doesn't match the vendor's records.", "F", "bank"),
    ("P17", "Find bank payments that may have paid the same bill twice.", "C", "bank"),
    ("P18", "Find bank payments to a payee with no vendor record, purchase order or open bill.", "D", "bank"),
    ("P19", "Find bank transfers to personal accounts that are described as business expenses.", "E", "bank"),
    ("P20", "Find invoices that may bill the same stage or order twice.", "C", "invoice"),
    ("P21", "Find bank deposits that don't match any customer invoice.", "D", "bank"),
]


TYPE_NAMES = {"bill": "vendor_bill", "inv": "customer_invoice", "bank": "bank_transaction"}


def clean_record(rec: dict) -> dict:
    return {k: v for k, v in rec.items() if not k.startswith("sim_") and k != "provenance_note"}


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")


def jdump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_company(cfg: dict, seed: int) -> Ctx:
    c = Ctx(cfg, seed)
    ar.attach(c)
    if cfg["kind"] == "ecom":
        roster_ecom(c)
    else:
        roster_projects(c, PROFILES[cfg["kind"]])
    ar.roster_invoices(c)
    c.ordinary_extras()
    ar.make_bank(c)
    ar.roster_bank(c)
    return c


def finalize(c: Ctx):
    """Assign ids by date for each transaction type; ids carry no information about how a row was made."""
    def sort_key(t):
        return (ar.tdate(t), digest(c.seed, c.cid, t["_k"]))
    kmap = {}
    for prefix, rows, width in (("bill", c.bills, 5), ("inv", c.invoices, 5), ("bank", c.bank, 5)):
        for i, t in enumerate(sorted(rows, key=sort_key), 1):
            t["id"] = f"{prefix}-{i:0{width}d}"
            kmap[t["_k"]] = t["id"]
    everything = [*c.bills, *c.invoices, *c.bank]
    # the five latest rows (any type, in the app's date-then-id order) are reserved for replay and stay ordinary
    latest = sorted(everything, key=lambda t: (ar.tdate(t), t["id"]))[-5:]
    case_keys = {k for case in c.cases for k in [case["primary"], *case["related"]]}
    assert not ({t["_k"] for t in latest} & case_keys) and not any(t["_touched"] for t in latest), f"{c.cid}: reserved rows touched"
    order = sorted(c.bills, key=lambda b: b["id"])
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
        rec["transaction_ids"] = sorted(kmap[k] for k in e["bills"])
        evidence.append(rec)
    bills = [{k: b[k] for k in ("id", "doc_number", "vendor_id", "vendor_name", "expense_kind", "txn_date", "due_date", "item_lines", "account_lines",
                                "total_amount", "project_id", "cost_category", "memo")} for b in order]
    invs = sorted(c.invoices, key=lambda t: t["id"])
    invoices = [{k: t[k] for k in ("id", "doc_number", "customer_id", "customer_name", "txn_date", "due_date", "lines", "total_amount", "project_id", "memo", "income_account_id",
                                   "deposit_applied_amount", "retainage_amount", "remit_to_account_ending")} for t in invs]
    cpay = []
    for i, t in enumerate(sorted((t for t in invs if t["_pay"]), key=lambda t: (t["_pay"]["date"], t["id"])), 1):
        cust = c.src_customers[t["customer_id"]]
        cpay.append({"id": f"rcpt-{i:05d}", "customer_id": t["customer_id"], "customer_name": cust["display_name"], "txn_date": t["_pay"]["date"], "amount": t["_pay"]["amount"],
                     "applications": [{"document_id": t["id"], "amount": t["_pay"]["amount"]}], "deposit_account_id": "acct-checking", "memo": "Payment received against invoice."})
    bank = [{k: t[k] for k in ("id", "date", "direction", "amount", "description", "memo", "counterparty", "counterparty_id", "reference", "channel", "counterparty_account_ending", "account_id")}
            for t in sorted(c.bank, key=lambda t: t["id"])]
    return everything, kmap, bills, invoices, bank, pays, cpay, evidence, emap


def check(c: Ctx, bills, invoices, bank, evidence):
    ids = [t["id"] for t in [*bills, *invoices, *bank]]
    assert len(ids) == len(set(ids)), "duplicate transaction ids"
    docs = [(b["vendor_id"], b["doc_number"]) for b in bills]
    assert len(docs) == len(set(docs)), f"{c.cid}: duplicate vendor/doc number"
    assert len({i["doc_number"] for i in invoices}) == len(invoices), f"{c.cid}: duplicate invoice numbers"
    vendors = {v["id"] for v in c.vendors_out()}
    for b in bills:
        lines = b["item_lines"] + b["account_lines"]
        assert sum(cents(l["amount"]) for l in lines) == cents(b["total_amount"]), f"{b['id']}: line total mismatch"
        for l in b["item_lines"]:
            assert l["quantity"] * cents(l["unit_price_amount"]) == cents(l["amount"]), f"{b['id']}: qty*price mismatch"
        assert b["vendor_id"] in vendors and (not b["project_id"] or b["project_id"] in c.projects) and b["due_date"] >= b["txn_date"]
    for i in invoices:
        assert sum(cents(l["amount"]) for l in i["lines"]) == cents(i["total_amount"]), f"{i['id']}: invoice line total mismatch"
        assert i["due_date"] >= i["txn_date"] and (not i["project_id"] or i["project_id"] in c.projects)
    for t in bank:
        assert cents(t["amount"]) > 0 and t["direction"] in ("deposit", "withdrawal")
    assert set(ids) >= {x for e in evidence for x in e["transaction_ids"]}, "evidence points at a missing transaction"


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
        everything, kmap, bills, invoices, bank, pays, cpay, evidence, emap = finalize(c)
        check(c, bills, invoices, bank, evidence)
        world = "world-" + digest(args.seed, cfg["new"], "world")[:16]
        wd = app_dir / cfg["new"] / "rwm-v4" / world
        projects = list(c.projects.values())
        vendors = c.vendors_out()
        company = c.company_out()
        company[0].update({"remit_bank": c.company_remit[0], "remit_account_ending": c.company_remit[1]})
        customers = [clean_record(v) for k, v in sorted(c.src_customers.items()) if c.kind != "ecom" or k in {i["customer_id"] for i in invoices}]
        dump(wd / "company.yaml", company)
        dump(wd / "accounts.yaml", c.accounts)
        dump(wd / "items.yaml", c.items)
        dump(wd / "terms.yaml", c.terms)
        dump(wd / "vendors.yaml", vendors)
        dump(wd / "customers.yaml", customers)
        dump(wd / "projects.yaml", projects)
        dump(wd / "bills.yaml", bills)
        dump(wd / "bill_payments.yaml", pays)
        dump(wd / "invoices.yaml", invoices)
        dump(wd / "customer_payments.yaml", cpay)
        dump(wd / "bank_transactions.yaml", bank)
        dump(wd / "evidence.yaml", evidence)
        src_entry = next(r for r in json.loads((ROOT / "data/raw/hackathon-100/index.json").read_text(encoding="utf-8")) if r["company_id"] == cfg["src"])
        total = len(bills) + len(invoices) + len(bank)
        index.append({
            "company_id": cfg["new"], "display_name": cfg["name"], "industry_naics": src_entry["industry_naics"], "industry_title": src_entry["industry_title"],
            "profile": src_entry["profile"], "archetype": "synthetic_extension", "size_tier": src_entry["size_tier"], "dataset_id": world,
            "business_status": "open", "distressed": False, "synthetic_extension": True, "derived_from": cfg["src"],
            "entity_counts": {"bills": len(bills), "invoices": len(invoices), "bank_transactions": len(bank), "transactions": total, "bill_payments": len(pays),
                              "vendors": len(vendors), "projects": len(projects), "evidence": len(evidence)},
        })
        # --- evaluation-only outputs ---
        by_key = {t["_k"]: t for t in everything}
        for case in c.cases:
            case_id = digest(args.seed, cfg["new"], case["_k"])[:10]
            tx = kmap[case["primary"]]
            manifest.append({
                "case_id": case_id, "company_id": cfg["new"], "transaction_id": f"{cfg['new']}:{tx}", "transaction_type": TYPE_NAMES[tx.split("-")[0]],
                "related_transaction_ids": [f"{cfg['new']}:{kmap[k]}" for k in case["related"]],
                "family": f"{case['family']}.{FAMILIES[case['family']]}", "variant": case["variant"], "label": case["label"], "expected_review_action": case["action"],
                "evidence_ids": sorted(emap[k] for k in case["evidence"]), "posting_state": case["posting"], "ledger_effect": case["ledger_effect"],
                "rationale": case["rationale"], "injection": case["injection"], "prompt_expectations": case["expect"],
                "related_prompt_expectations": {f"{cfg['new']}:{kmap[k]}": case["rel_expect"] for k in case["related"]} if case["rel_expect"] else {},
            })
        involved = {k for case in c.cases for k in [case["primary"], *case["related"]]}
        prov = []
        for t in sorted(everything, key=lambda t: t["id"]):
            kind = ("added_for_case" if t["_added"] and t["_k"] in involved else "added_ordinary" if t["_added"] else "case_modified" if t["_touched"] else "ordinary_text_authored")
            if t.get("_type") == "bank":
                new_d, new_m = t["description"], t["memo"]
            elif t.get("_type") == "invoice":
                new_d, new_m = " | ".join(l["description"] for l in t["lines"]), t["memo"]
            else:
                new_d, new_m = " | ".join(dict.fromkeys(l["description"] for l in t["item_lines"] + t["account_lines"])), t["memo"]
            prov.append({"transaction_id": f"{cfg['new']}:{t['id']}", "type": TYPE_NAMES[t["id"].split("-")[0]], "source_id": f"{cfg['src']}:{t['_src']}" if t.get("_src") else None, "kind": kind,
                         "original_description": t["_orig"]["description"], "original_memo": t["_orig"]["memo"], "description": new_d, "memo": new_m})
        provenance[cfg["new"]] = {"name": cfg["name"], "derived_from": cfg["src"], "vendor_renames": cfg["vendors"], "cancelled_project": c.cancelled,
                                  "counts": {"bills": len(bills), "invoices": len(invoices), "bank_transactions": len(bank)},
                                  "notes": "Ordinary text is authored; amounts, dates, parties and payments come from the source company (invoices and customer payments directly, bank rows from payments and payroll). Journal entries, reports and balances are not included.",
                                  "transactions": prov}
        # curated demo sample: every case row plus ordinary look-alike decoys of each type
        ids = {kmap[k] for k in involved}
        reserved = {t["id"] for t in sorted(everything, key=lambda t: (ar.tdate(t), t["id"]))[-5:]}
        for prefix, quota in (("bill", 16), ("inv", 8), ("bank", 10)):
            decoys = [t["id"] for t in sorted(everything, key=lambda t: t["id"]) if t["id"].startswith(prefix + "-") and not t["_touched"] and t["id"] not in reserved]
            step = max(1, len(decoys) // quota)
            ids |= set(decoys[::step][:quota])
        samples[cfg["new"]] = sorted(ids)
        expected[cfg["new"]] = {"rows": total, "sample_rows": len(ids), "reserved_last_five": sorted(reserved)}
        print(f"{cfg['new']} {cfg['name']}: {len(bills)} bills + {len(invoices)} invoices + {len(bank)} bank = {total}, {len(evidence)} evidence, {len(c.cases)} cases, sample {len(ids)}")

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
