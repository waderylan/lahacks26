"""Read-only loader for the QuickBooks Hackathon 2026 dataset (data/raw/).

IDs are scoped to a company, so every lookup takes a company_id. Money fields are
decimal strings; use money()/sum_money() and never float. The hidden/ simulation
ground truth is not loadable through this module.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import yaml

try:
    _YamlLoader = yaml.CSafeLoader
except AttributeError:  # libyaml not available
    _YamlLoader = yaml.SafeLoader

DATA_ROOT = Path(__file__).resolve().parent.parent / "data" / "raw" / "hackathon-100"

# Entity files that live directly in a world directory. hidden/ is intentionally absent.
BOOK_ENTITIES = (
    "accounts",
    "bank_transactions",
    "bill_payments",
    "bills",
    "company",
    "customer_payments",
    "customers",
    "employees",
    "estimates",
    "invoices",
    "items",
    "journal_entries",
    "payroll_runs",
    "projects",
    "sales_receipts",
    "terms",
    "vendors",
)
REPORTS = ("profit_and_loss", "balance_sheet", "ar_aging", "ap_aging")


@dataclass(frozen=True)
class Company:
    company_id: str
    display_name: str
    industry_naics: str
    industry_title: str
    profile: str
    size_tier: str
    business_status: str
    distressed: bool


def money(value: str | int | Decimal | None) -> Decimal:
    """Parse a monetary field. Floats are rejected to avoid silent precision loss."""
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, float):
        raise TypeError("monetary values must be decimal strings, not float")
    return Decimal(value)


def sum_money(values: Iterable[str | Decimal | None]) -> Decimal:
    return sum((money(v) for v in values), Decimal("0"))


def _read_yaml(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.load(f, Loader=_YamlLoader)


@lru_cache(maxsize=None)
def _index(root: Path) -> dict[str, dict[str, Any]]:
    with open(root / "index.json", encoding="utf-8") as f:
        return {row["company_id"]: row for row in json.load(f)}


def list_companies(root: Path = DATA_ROOT) -> list[Company]:
    return [
        Company(
            company_id=r["company_id"],
            display_name=r["display_name"],
            industry_naics=r["industry_naics"],
            industry_title=r["industry_title"],
            profile=r["profile"],
            size_tier=r["size_tier"],
            business_status=r["business_status"],
            distressed=r["distressed"],
        )
        for r in _index(root).values()
    ]


def world_dir(company_id: str, root: Path = DATA_ROOT) -> Path:
    if company_id not in _index(root):
        raise KeyError(f"unknown company_id: {company_id}")
    worlds = sorted((root / company_id / "rwm-v4").glob("world-*"))
    if len(worlds) != 1:
        raise FileNotFoundError(f"expected one world dir for {company_id}, found {len(worlds)}")
    return worlds[0]


def load_entity(company_id: str, entity: str, root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    """Records of one entity file as a list of dicts; empty files give []."""
    if entity not in BOOK_ENTITIES:
        raise ValueError(f"unknown entity {entity!r}; expected one of {BOOK_ENTITIES}")
    data = _read_yaml(world_dir(company_id, root) / f"{entity}.yaml")
    if data is None:
        return []
    if isinstance(data, dict):  # single-record files such as company.yaml
        return [data]
    return data


def load_all(
    entity: str,
    company_ids: Iterable[str] | None = None,
    root: Path = DATA_ROOT,
) -> list[dict[str, Any]]:
    """Records across companies, each tagged with its `company_id` (IDs repeat across companies)."""
    ids = list(company_ids) if company_ids is not None else list(_index(root))
    out = []
    for cid in ids:
        for rec in load_entity(cid, entity, root):
            out.append({**rec, "company_id": cid})
    return out


def load_report(company_id: str, report: str, root: Path = DATA_ROOT) -> Any:
    if report not in REPORTS:
        raise ValueError(f"unknown report {report!r}; expected one of {REPORTS}")
    return _read_yaml(world_dir(company_id, root) / "reports" / f"{report}.yaml")
