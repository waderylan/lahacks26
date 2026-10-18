"""Core of the seeded generator for the synthetic transaction-review extension.

One Ctx per synthetic company: it derives ordinary bills from an original company
(read-only through qbdata), rewrites their text, and exposes helpers the case roster
(synth_cases.py) uses to inject documentation issues, suspicious patterns and lookalikes.
Money is integer cents internally and decimal strings on disk.
"""
from __future__ import annotations

import copy
import hashlib
import random
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qbdata import load_entity  # noqa: E402

from synth_text import CARD_ORDINARY, DESC, MEMO  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOC_PREFIX = {"lender": "STMT-", "utility": "UT-", "government": "REF-", "premises": "RENT-", "insurance": "POL-", "card": "CS-"}
BANKS = ["Northmark Savings", "Lakeshore Trust", "Pinecrest Credit Union", "Harbor & Vine Bank", "Marlowe National Bank"]


def cents(s) -> int:
    return int((Decimal(str(s)) * 100).to_integral_exact())


def money(c: int) -> str:
    sign = "-" if c < 0 else ""
    c = abs(c)
    return f"{sign}{c // 100}.{c % 100:02d}"


def usd(c: int) -> str:
    return f"${c // 100:,}.{c % 100:02d}"


def digest(*parts) -> str:
    return hashlib.sha256("/".join(map(str, parts)).encode()).hexdigest()


def iso(d: date) -> str:
    return d.isoformat()


def plus(s: str, days: int) -> str:
    return iso(date.fromisoformat(s) + timedelta(days=days))


def short(s: str) -> str:
    d = date.fromisoformat(s)
    return f"{MONTHS[d.month - 1]} {d.day}"


def month(s: str) -> str:
    d = date.fromisoformat(s)
    return f"{MONTHS[d.month - 1]} {d.year}"


def clean(obj):
    """Drop simulation-only metadata from copied records."""
    if isinstance(obj, list):
        return [clean(x) for x in obj]
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items() if not k.startswith("sim_") and k != "provenance_note"}
    return obj


def alt_doc(doc: str, mode: str) -> str:
    m = re.match(r"^(.*?)(\d+)$", doc)
    prefix, num = (m.group(1), m.group(2)) if m else ("", doc)
    if mode == "transpose" and len(num) >= 2:
        return prefix + num[:-2] + num[-1] + num[-2]
    if mode == "suffix":
        return f"{doc}-1"
    if mode == "letter":
        return f"{doc}A"
    if mode == "strip":
        return num
    if mode == "reissue":
        return f"{prefix}{int(num) + 3}"
    return doc


class Ctx:
    def __init__(self, cfg: dict, seed: int):
        self.cfg, self.seed = cfg, seed
        self.cid, self.src, self.kind = cfg["new"], cfg["src"], cfg["kind"]
        self.rng = random.Random(f"{seed}/{self.cid}")
        self.bills: list[dict] = []
        self.evidence: list[dict] = []
        self.cases: list[dict] = []
        self.pool: list[dict] = []
        self.patches: dict[str, dict] = {}
        self.cancelled: dict | None = None
        self.hold: set[str] = set()
        self._n = 0
        self._po = 4100 + self.rng.randrange(0, 300)
        self.used_docs: set[str] = set()
        self._load()
        r = random.Random(f"{seed}/{self.cid}/vendors")
        banned = {"7731", "5260", "9034"}
        self.payee = {}
        for vid in sorted([*self.src_vendors, "vend-card"]):
            end = f"{r.randrange(1000, 9999)}"
            while end in banned:
                end = f"{r.randrange(1000, 9999)}"
            self.payee[vid] = (r.choice(BANKS), end)
        self._pick_cancelled_project()
        self._select()
        self._rewrite_text()
        self._number_documents()
        dates = sorted(b["txn_date"] for b in self.bills)
        self.limit = dates[-9]
        self.pool = [b for b in self.bills if b["txn_date"] <= self.limit]

    # ----- loading -------------------------------------------------------------------------------
    def _load(self):
        s = self.src
        self.src_bills = load_entity(s, "bills")
        self.src_vendors = {v["id"]: v for v in load_entity(s, "vendors")}
        self.src_projects = load_entity(s, "projects")
        self.accounts = clean(load_entity(s, "accounts"))
        self.items = clean(load_entity(s, "items"))
        self.terms = clean(load_entity(s, "terms"))
        self.src_company = load_entity(s, "company")
        self.pay_by_bill: dict[str, dict] = {}
        for p in load_entity(s, "bill_payments"):
            for app in p.get("applications", []):
                self.pay_by_bill[app["document_id"]] = p
        self.rename = self.cfg["vendors"]
        self.projects = {p["id"]: clean(copy.deepcopy(p)) for p in self.src_projects}
        self.customer_of = {p["id"]: p.get("customer_name", "") for p in self.src_projects}

    def vname(self, vid: str, original: str) -> str:
        return self.rename.get(vid, original)

    def _pick_cancelled_project(self):
        if not self.src_projects:
            return
        last = max(b["txn_date"] for b in self.src_bills)
        by_proj = defaultdict(list)
        for b in self.src_bills:
            if b["project_id"]:
                by_proj[b["project_id"]].append(b["txn_date"])
        for p in sorted(self.src_projects, key=lambda p: p["id"]):
            if p["status"] != "active":
                continue
            start = p["started_date"]
            for offset in (70, 56, 49):
                cancel = plus(start, offset)
                before = [d for d in by_proj[p["id"]] if start <= d <= cancel]
                after = [d for d in by_proj[p["id"]] if d > cancel]
                if len(before) >= 5 and len(after) >= 3 and cancel <= plus(last, -45):
                    self.cancelled = {"project_id": p["id"], "date": cancel, "start": start}
                    proj = self.projects[p["id"]]
                    proj["status"] = "cancelled"
                    proj["cancelled_date"] = cancel
                    proj.pop("completed_date", None)
                    proj.pop("completed_sim_day", None)
                    proj["status_history"] = [{"date": start, "status": "active"}, {"date": cancel, "status": "cancelled"}]
                    return

    # ----- derive ordinary bills -----------------------------------------------------------------
    def _select(self):
        groups = defaultdict(list)
        for b in sorted(self.src_bills, key=lambda b: (b["txn_date"], b["id"])):
            if self.cancelled and b["project_id"] == self.cancelled["project_id"] and b["txn_date"] > self.cancelled["date"]:
                continue
            groups[(b["vendor_id"], b["cost_category"])].append(b)
        small = sum(len(g) for g in groups.values() if len(g) <= 12)
        big = sum(len(g) for g in groups.values() if len(g) > 12)
        frac = max(0.05, (self.cfg["base_n"] - 8 - small) / big)  # leave room for ordinary card statements
        chosen = []
        for key in sorted(groups):
            g = groups[key]
            if len(g) <= 12:
                chosen += g
            else:
                k = max(3, round(len(g) * frac))
                chosen += [g[(i * len(g)) // k] for i in range(k)]
        for sb in chosen:
            self.bills.append(self._internal(sb))

    def _internal(self, sb: dict) -> dict:
        pay = self.pay_by_bill.get(sb["id"])
        b = {
            "_k": self._key("b"), "_src": sb["id"], "_added": False, "_touched": False, "_mods": [],
            "id": None, "doc_number": None,
            "vendor_id": sb["vendor_id"], "vendor_name": self.vname(sb["vendor_id"], sb["vendor_name"]),
            "expense_kind": sb["expense_kind"], "txn_date": sb["txn_date"], "due_date": sb["due_date"],
            "item_lines": clean(copy.deepcopy(sb["item_lines"])), "account_lines": clean(copy.deepcopy(sb["account_lines"])),
            "total_amount": sb["total_amount"], "project_id": sb["project_id"], "cost_category": sb["cost_category"],
            "memo": sb["memo"] or "",
            "_orig": {"description": " | ".join(dict.fromkeys(l["description"] for l in [*sb["item_lines"], *sb["account_lines"]] if l.get("description"))), "memo": sb["memo"] or ""},
            "_pay": None,
        }
        if pay:
            amt = next(a["amount"] for a in pay["applications"] if a["document_id"] == sb["id"])
            b["_pay"] = {"date": pay["txn_date"], "amount": amt, "account": pay["payment_account_id"]}
        return b

    def _key(self, p: str) -> str:
        self._n += 1
        return f"{p}{self._n}"

    # ----- ordinary text -------------------------------------------------------------------------
    def fill(self, tpl: str, b: dict) -> str:
        d = b["txn_date"]
        cust = self.customer_of.get(b["project_id"] or "", "")
        if not cust:
            tpl = tpl.replace(", {c}", "")
        r = self.rng
        out = tpl.format(
            d=short(d), p0=short(plus(d, -6)), p1=short(d), mo=month(d), c=cust, n=r.randrange(40, 420),
            po=f"PO-{self.next_po()}", kwh=f"{r.randrange(800, 2600):,}", ccf=r.randrange(12, 60), pct=r.choice([20, 30, 40, 50, 60, 70, 80, 90]),
        )
        return out

    def next_po(self) -> int:
        self._po += self.rng.randrange(3, 14)
        return self._po

    def _rewrite_text(self):
        lib_d, lib_m = DESC[self.kind], MEMO[self.kind]
        for b in self.bills:
            keys = [b["vendor_id"], f"cat:{b['cost_category']}"]
            tpls = next((lib_d[k] for k in keys if k in lib_d), None)
            if tpls and not b["item_lines"]:
                text = self.fill(self.rng.choice(tpls), b)
                # Recurring subcontract and materials bills name their service period or delivery date, as real ones do.
                if b["cost_category"] == "subcontract" and self.rng.random() < 0.9:
                    text += f", week of {short(b['txn_date'])}"
                elif b["cost_category"] == "materials" and self.rng.random() < 0.9:
                    text += f", delivered {short(b['txn_date'])}"
                for line in b["account_lines"]:
                    line["description"] = text
            mkey = b["vendor_id"] if b["vendor_id"] in lib_m else "default"
            b["memo"] = self.fill(self.rng.choice(lib_m[mkey]), b)
            b["_mods"].append("ordinary text authored")

    def _number_documents(self):
        roles = {vid: v.get("supply_role", "") for vid, v in self.src_vendors.items()}
        by_vendor = defaultdict(list)
        for b in sorted(self.bills, key=lambda b: (b["txn_date"], b["_k"])):
            by_vendor[b["vendor_id"]].append(b)
        self.doc_base: dict[str, list[tuple[str, int]]] = {}
        for vid, bills in by_vendor.items():
            n = self.rng.randrange(1000, 9000)
            prefix = DOC_PREFIX.get(roles.get(vid, ""), "INV-")
            self.doc_base[vid] = []
            for b in bills:
                n += self.rng.randrange(5, 10)
                b["doc_number"] = f"{prefix}{n}"
                self.used_docs.add(b["doc_number"])
                self.doc_base[vid].append((b["txn_date"], n))
        self.doc_prefix = {vid: DOC_PREFIX.get(roles.get(vid, ""), "INV-") for vid in by_vendor}

    def master_end(self, vid: str) -> str:
        return self.patches.get(vid, {}).get("payee_account_ending") or self.payee[vid][1]

    def variant_doc(self, doc: str, mode: str, vid: str, near: str) -> str:
        """An altered invoice number that differs from the original and from every other document number."""
        for m in (mode, "letter", "suffix", "reissue"):
            alt = alt_doc(doc, m)
            if alt != doc and alt not in self.used_docs:
                self.used_docs.add(alt)
                return alt
        return self.next_doc(vid, near)

    def next_doc(self, vid: str, near: str) -> str:
        prefix = self.doc_prefix.get(vid, "INV-")
        seq = self.doc_base.get(vid) or [(near, self.rng.randrange(1000, 9000))]
        n = max([x for dt, x in seq if dt <= near] or [seq[0][1]])
        while True:
            n += self.rng.randrange(1, 4)
            doc = f"{prefix}{n}"
            if doc not in self.used_docs:
                self.used_docs.add(doc)
                return doc

    # ----- helpers for the roster ----------------------------------------------------------------
    def pick(self, vendor=None, cat=None, project=None, lines=1, lo=None, hi=None, after=None, before=None, no_project=False, item=None):
        c = []
        for b in self.pool:
            amt = cents(b["total_amount"])
            nl = len(b["item_lines"]) + len(b["account_lines"])
            if vendor and b["vendor_id"] != vendor: continue
            if cat and b["cost_category"] != cat: continue
            if project and b["project_id"] != project: continue
            if no_project and b["project_id"]: continue
            if lines and nl != lines: continue
            if lo and amt < lo: continue
            if hi and amt > hi: continue
            if after and b["txn_date"] < after: continue
            if before and b["txn_date"] > before: continue
            if item is True and not b["item_lines"]: continue
            if self.cancelled and b["project_id"] == self.cancelled["project_id"] and b["vendor_id"] in self.hold and not project: continue
            c.append(b)
        if not c:
            raise LookupError(f"{self.cid}: no base bill for vendor={vendor} cat={cat} project={project}")
        b = self.rng.choice(sorted(c, key=lambda x: x["_k"]))
        self.pool.remove(b)
        b["_touched"] = True
        return b

    def lines(self, b):
        return b["item_lines"] + b["account_lines"]

    def retext(self, b, desc=None, memo=None, why=""):
        if desc is not None:
            self.lines(b)[0]["description"] = desc
        if memo is not None:
            b["memo"] = memo
        b["_mods"].append(f"case text: {why}")

    def ev(self, kind, title, text, when, bills=(), vendor=None, project=None):
        e = {"_k": self._key("e"), "kind": kind, "title": title, "text": text, "date": when,
             "vendor_id": vendor, "project_id": project, "bills": [b["_k"] for b in bills]}
        self.evidence.append(e)
        return e["_k"]

    def vendor_patch(self, vid, **fields):
        self.patches.setdefault(vid, {}).update(fields)

    def clone(self, b, *, days=None, when=None, doc=None, desc=None, memo=None, vendor_name=None, ratio=None, paid=False, project="keep", why="added bill"):
        n = copy.deepcopy(b)
        n.update({"_k": self._key("b"), "_src": None, "_added": True, "_touched": True, "_mods": [why], "id": None, "_pay": None})
        n["_orig"] = {"description": "", "memo": ""}
        delta = (date.fromisoformat(b["due_date"]) - date.fromisoformat(b["txn_date"])).days
        n["txn_date"] = when or plus(b["txn_date"], days or 0)
        n["due_date"] = plus(n["txn_date"], delta)
        n["doc_number"] = doc or self.next_doc(b["vendor_id"], n["txn_date"])
        if vendor_name:
            n["vendor_name"] = vendor_name
        if project != "keep":
            n["project_id"] = project
        if ratio:
            num, den = ratio
            for l in n["item_lines"]:
                q = max(1, l["quantity"] * num // den)
                l["quantity"], l["amount"] = q, money(q * cents(l["unit_price_amount"]))
            for l in n["account_lines"]:
                l["amount"] = money(cents(l["amount"]) * num // den)
        n["total_amount"] = money(sum(cents(l["amount"]) for l in self.lines(n)))
        if desc is not None:
            self.lines(n)[0]["description"] = desc
        if memo is not None:
            n["memo"] = memo
        if paid:
            n["_pay"] = {"date": n["due_date"], "amount": n["total_amount"], "account": "acct-checking"}
        self.bills.append(n)
        return n

    def statement_number(self, when: str) -> str:
        stem = f"CS-{when[:7].replace('-', '')}"
        n = 1
        while f"{stem}-{n:02d}" in self.used_docs:
            n += 1
        self.used_docs.add(f"{stem}-{n:02d}")
        return f"{stem}-{n:02d}"

    def card_bill(self, when, amount_cents, desc, memo, paid=True):
        vid = "vend-card"
        n = {
            "_k": self._key("b"), "_src": None, "_added": True, "_touched": True, "_mods": ["added bill"], "id": None,
            "doc_number": self.statement_number(when), "vendor_id": vid, "vendor_name": self.cfg["card"][1],
            "expense_kind": "operating", "txn_date": when, "due_date": plus(when, 20), "item_lines": [],
            "account_lines": [{"line_num": 1, "account_id": "acct-operating-expense", "account_name": "Operating Expense", "description": desc, "amount": money(amount_cents)}],
            "total_amount": money(amount_cents), "project_id": None, "cost_category": "operating", "memo": memo,
            "_orig": {"description": "", "memo": ""}, "_pay": None,
        }
        if paid:
            n["_pay"] = {"date": n["due_date"], "amount": n["total_amount"], "account": "acct-checking"}
        self.bills.append(n)
        return n

    def case(self, family, variant, label, action, primary, related=(), evidence=(), expect=None, rel_expect=None,
             rationale="", posting="text_only", ledger="", injection=None):
        self.cases.append({
            "_k": self._key("c"), "family": family, "variant": variant, "label": label, "action": action,
            "primary": primary["_k"], "related": [b["_k"] for b in related], "evidence": list(evidence),
            "expect": expect or {}, "rel_expect": rel_expect or {}, "rationale": rationale,
            "posting": posting, "ledger_effect": ledger or "Documentation only; amounts and ledger unchanged.",
            "injection": injection,
        })

    def random_date(self, lo: str, hi: str) -> str:
        a, b = date.fromisoformat(lo), date.fromisoformat(hi)
        return iso(a + timedelta(days=self.rng.randrange(0, max(1, (b - a).days))))

    # ----- ordinary supporting evidence and card statements -------------------------------------
    def ordinary_extras(self):
        r = self.rng
        # Ordinary card statements, some with receipt summaries.
        for i in range(7):
            when = self.random_date("2025-11-10", self.limit)
            desc, memo, receipt = r.choice(CARD_ORDINARY[self.kind])
            n = self.card_bill(when, r.randrange(14000, 82000), desc, memo.format(d=short(when)))
            n["_mods"] = ["added bill (ordinary)"]
            if r.random() < 0.6:
                self.ev("receipt", f"Card statement detail {short(when)}", receipt, plus(when, -2), [n], vendor="vend-card")
        # Ordinary purchase orders / receiving / completion notes on a share of untouched bills.
        for b in sorted(self.pool, key=lambda x: x["_k"]):
            if b["_touched"] or r.random() > 0.2:
                continue
            amt = cents(b["total_amount"])
            if b["item_lines"]:
                l = b["item_lines"][0]
                po = self.next_po()
                self.ev("purchase_order", f"Purchase order PO-{po}", f"PO-{po}: {l['quantity']} x {l['item_name']} at {usd(cents(l['unit_price_amount']))}, total {usd(amt)}. Net 7.", plus(b["txn_date"], -r.randrange(6, 16)), [b], vendor=b["vendor_id"])
                self.ev("receiving_record", f"Receiving report {po}", f"Received {l['quantity']} x {l['item_name']}; count matches packing slip. No damage noted.", plus(b["txn_date"], -r.randrange(0, 3)), [b], vendor=b["vendor_id"])
            elif b["project_id"] and b["cost_category"] in ("subcontract", "materials"):
                proj = self.projects[b["project_id"]]["name"]
                self.ev("completion_record", f"Work sign-off {short(b['txn_date'])}", f"Site lead confirmed the billed work for {proj} was completed and inspected. Quantities consistent with the schedule of values.", plus(b["txn_date"], -r.randrange(0, 4)), [b], vendor=b["vendor_id"], project=b["project_id"])

    # ----- output ---------------------------------------------------------------------------------
    def vendors_out(self) -> list[dict]:
        out = []
        for vid, v in sorted(self.src_vendors.items()):
            rec = clean(copy.deepcopy(v))
            name = self.vname(vid, v["display_name"])
            rec["display_name"] = rec["company_name"] = name
            rec["email"] = re.sub(r"@.*", "", rec["email"].split("@")[0]) + "@" + re.sub(r"[^a-z]", "", name.lower())[:28] + ".example"
            out.append(self._payee(rec, "2025-10-06"))
        card_name = self.cfg["card"][0]
        card = {"id": "vend-card", "display_name": card_name, "company_name": card_name, "contact_given_name": "Priya", "contact_family_name": "Lindgren",
                "email": "billing@" + re.sub(r"[^a-z]", "", card_name.lower())[:28] + ".example", "phone": "(555) 301-9902",
                "address": {"line1": "100 Commerce Plaza", "city": "Wilmington", "state": "DE", "postal_code": "19801", "country": "United States", "line2": None},
                "payment_terms": "Net 20", "payment_terms_days": 20, "supply_role": "card", "joined_date": "2025-10-06"}
        out.append(self._payee(card, "2025-10-06"))
        for rec in out:
            rec.update(self.patches.get(rec["id"], {}))
        return out

    def _payee(self, rec, since):
        rec["payee_bank"], rec["payee_account_ending"] = self.payee[rec["id"]]
        rec["payee_details_last_changed"] = since
        rec["payee_change_verification"] = "Bank letter and voided check on file at onboarding"
        return rec

    def company_out(self) -> dict:
        c = clean(copy.deepcopy(self.src_company[0] if isinstance(self.src_company, list) else self.src_company))
        city, st, zipc = self.cfg["city"]
        c.update({"legal_name": self.cfg["legal"], "trade_name": self.cfg["name"],
                  "email": f"accounts@{self.cfg['slug']}.example", "website": f"https://www.{self.cfg['slug']}.example", "phone": self.cfg["phone"]})
        c["address"] = {"line1": self.cfg["street"], "city": city, "state": st, "postal_code": zipc, "country": "United States", "line2": None}
        return [c]
