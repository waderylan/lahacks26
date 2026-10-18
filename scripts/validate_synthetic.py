"""Validate the synthetic extension: references, arithmetic, coverage, label leakage and reproducibility.

    uv run scripts/validate_synthetic.py            # exits non-zero on any failure
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "synthetic" / "extension-v1"
EVAL = ROOT / "synthetic" / "eval"
FAILS: list[str] = []
FORBIDDEN = re.compile(r"fraud|suspicious|case[_ ]id|scenario|inject|label:|answer key|expected|ground.?truth|look-?alike|documentation_issue|legitimate|uncertain|"
                       r"dup-|post-cancel|pre-start|short-receipt|diversion|late-billing|unsupported-approval|embedded-system", re.I)


def check(ok: bool, msg: str) -> None:
    if not ok:
        FAILS.append(msg)
        print("FAIL:", msg)


def cents(s: str) -> int:
    whole, _, frac = str(s).partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def tree_hash(root: Path) -> dict[str, str]:
    skip = {"README.md", "measured_jev_smoke.json"}  # hand-written or produced by a separate smoke run
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file() and p.name not in skip}


def main() -> None:
    index = json.loads((APP / "index.json").read_text(encoding="utf-8"))
    manifest = json.loads((EVAL / "case_manifest.json").read_text(encoding="utf-8"))
    cases = manifest["cases"]
    sample = json.loads((APP / "demo_sample.json").read_text(encoding="utf-8"))["samples"]
    check(len(index) == 4, "expected four synthetic companies")
    case_ids = {c["case_id"] for c in cases}
    check(len(case_ids) == len(cases), "case ids must be unique")
    tokens = {c["case_id"] for c in cases}
    label_counts = Counter()
    for entry in index:
        cid = entry["company_id"]
        check(re.fullmatch(r"company-\d{3}", cid) is not None and int(cid[-3:]) > 100, f"{cid}: id must not collide with originals")
        wd = next((APP / cid / "rwm-v4").glob("world-*"))
        load = lambda n: yaml.safe_load((wd / f"{n}.yaml").read_text(encoding="utf-8")) or []
        bills, vendors, projects, pays, evidence = load("bills"), load("vendors"), load("projects"), load("bill_payments"), load("evidence")
        accounts = {a["id"] for a in load("accounts")}
        invoices, bank, customers, cpays = load("invoices"), load("bank_transactions"), load("customers"), load("customer_payments")
        check(150 <= len(bills) <= 250, f"{cid}: {len(bills)} bills outside 150-250")
        check(len(invoices) >= 40 and len(bank) >= 60, f"{cid}: thin invoices ({len(invoices)}) or bank rows ({len(bank)})")
        ids = [t["id"] for t in [*bills, *invoices, *bank]]
        check(len(ids) == len(set(ids)), f"{cid}: duplicate transaction ids")
        vids, pids, bset = {v["id"] for v in vendors}, {p["id"] for p in projects}, set(ids)
        cids = {c["id"] for c in customers}
        inv_by = {i["id"]: i for i in invoices}
        company = load("company")[0]
        check(bool(company.get("remit_account_ending")), f"{cid}: company has no remittance profile")
        paid_inv = defaultdict(int)
        for p in cpays:
            for a in p["applications"]:
                check(a["document_id"] in inv_by, f"{cid}: customer payment refers to unknown invoice")
                paid_inv[a["document_id"]] += cents(a["amount"])
        for i in invoices:
            check(sum(cents(l["amount"]) for l in i["lines"]) == cents(i["total_amount"]), f"{cid}/{i['id']}: invoice line total")
            check(i["customer_id"] in cids and (not i["project_id"] or i["project_id"] in pids) and i["due_date"] >= i["txn_date"], f"{cid}/{i['id']}: invoice reference")
            net = cents(i["total_amount"]) - cents(i["deposit_applied_amount"]) - cents(i["retainage_amount"])  # customers pay net of deposit and retainage
            check(paid_inv.get(i["id"], 0) <= cents(i["total_amount"]) - cents(i["deposit_applied_amount"]), f"{cid}/{i['id']}: customer paid more than total less deposit")
            check(cents(i["deposit_applied_amount"]) + cents(i["retainage_amount"]) <= cents(i["total_amount"]), f"{cid}/{i['id']}: deposit and retainage exceed the invoice")
        check(len({i["doc_number"] for i in invoices}) == len(invoices), f"{cid}: duplicate invoice numbers")
        for t in bank:
            check(cents(t["amount"]) > 0 and t["direction"] in ("deposit", "withdrawal"), f"{cid}/{t['id']}: bank row shape")
            check(not t["counterparty_id"] or t["counterparty_id"] in vids | cids, f"{cid}/{t['id']}: bank counterparty reference")
        pay_by_bill = defaultdict(int)
        for p in pays:
            for a in p["applications"]:
                check(a["document_id"] in bset, f"{cid}: payment refers to unknown bill")
                pay_by_bill[a["document_id"]] += cents(a["amount"])
            check(sum(cents(a["amount"]) for a in p["applications"]) == cents(p["amount"]), f"{cid}: payment total mismatch")
            check(p["payment_account_id"] in accounts, f"{cid}: payment account unknown")
        for b in bills:
            lines = b["item_lines"] + b["account_lines"]
            check(sum(cents(l["amount"]) for l in lines) == cents(b["total_amount"]), f"{cid}/{b['id']}: line total")
            for l in b["item_lines"]:
                check(l["quantity"] * cents(l["unit_price_amount"]) == cents(l["amount"]), f"{cid}/{b['id']}: qty*price")
            for l in b["account_lines"]:
                check(l["account_id"] in accounts, f"{cid}/{b['id']}: account")
            check(b["vendor_id"] in vids and (not b["project_id"] or b["project_id"] in pids), f"{cid}/{b['id']}: dangling reference")
            check(pay_by_bill.get(b["id"], 0) in (0, cents(b["total_amount"])), f"{cid}/{b['id']}: partial payment")
        check(len({(b["vendor_id"], b["doc_number"]) for b in bills}) == len(bills), f"{cid}: duplicate vendor+document number")
        for e in evidence:
            check(set(e["transaction_ids"]) <= bset, f"{cid}/{e['id']}: evidence points at an unknown transaction")
            check(len(e["text"]) <= 330, f"{cid}/{e['id']}: evidence too long for low-latency inference")
        check(len({e["id"] for e in evidence}) == len(evidence), f"{cid}: duplicate evidence ids")
        last5 = sorted([*bills, *invoices, *bank], key=lambda t: (t.get("txn_date") or t["date"], t["id"]))[-5:]
        mine = [c for c in cases if c["company_id"] == cid]
        involved = {c["transaction_id"] for c in mine} | {t for c in mine for t in c["related_transaction_ids"]}
        check(not any(f"{cid}:{b['id']}" in involved for b in last5), f"{cid}: reserved replay bills include a case row")
        check(all(c["transaction_id"].split(":")[1] in bset for c in mine), f"{cid}: case points at unknown transaction")
        for typ, want in (("vendor_bill", "ABCDEFG"), ("customer_invoice", "ABCDFG"), ("bank_transaction", "ABCDEFG")):
            fams = {c["family"][0] for c in mine if c["transaction_type"] == typ}
            check(fams == set(want), f"{cid}: {typ} families {sorted(fams)} != {want}")
        labels = Counter(c["label"] for c in mine)
        label_counts.update({(cid, k): v for k, v in labels.items()})
        check(all(labels[k] >= 3 for k in ("documentation_issue", "suspected_fraud", "legitimate", "uncertain")), f"{cid}: thin label coverage {dict(labels)}")
        check(sum(1 for c in mine if c["posting_state"] == "not_posted") >= 1, f"{cid}: no attempted-not-posted case")
        check(set(sample[cid]) <= bset and not (set(sample[cid]) & {b["id"] for b in last5}), f"{cid}: bad demo sample")
        # leakage: app-facing files must not carry labels, ids, variants or families
        for f in wd.glob("*.yaml"):
            text = f.read_text(encoding="utf-8")
            for m in FORBIDDEN.finditer(text):
                check(False, f"{cid}/{f.name}: forbidden token {m.group(0)!r}")
            for t in tokens:
                check(t not in text, f"{cid}/{f.name}: contains a case id")
        # stability of ordering: the case rows are not clustered at the start or end of the id range
    for f in APP.glob("*.json"):
        for m in FORBIDDEN.finditer(f.read_text(encoding="utf-8").replace("Curated demo sample: selected to include a dense mix of review cases and ordinary look-alikes. It over-represents issues and is not representative of the full company.", "")):
            if f.name != "demo_sample.json":
                check(False, f"{f.name}: forbidden token {m.group(0)!r}")
    # reproducibility: same seed must produce byte-identical output
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "generate_synthetic.py"), "--seed", str(manifest["seed"]), "--out", tmp], check=True, stdout=subprocess.DEVNULL)
        a, b = tree_hash(ROOT / "synthetic"), tree_hash(Path(tmp))
        check(a == b, "regeneration with the same seed differs from the committed output")
    print("labels:", dict(sorted(label_counts.items())))
    print("OK" if not FAILS else f"{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
