"""Print a summary of the dataset: companies, entity types, sample counts, example bill."""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qbdata import BOOK_ENTITIES, REPORTS, list_companies, load_entity, money

SAMPLE = "company-001"


def main() -> None:
    companies = list_companies()
    print(f"Companies: {len(companies)}")
    by_industry = Counter(c.industry_title for c in companies)
    print(f"Industries: {len(by_industry)} distinct (top 10 shown)")
    for title, n in by_industry.most_common(10):
        print(f"  {n:>3}  {title}")
    print("By profile:", dict(Counter(c.profile for c in companies)))

    print(f"\nEntity types: {', '.join(BOOK_ENTITIES)}")
    print(f"Reports: {', '.join(REPORTS)}")

    name = next(c.display_name for c in companies if c.company_id == SAMPLE)
    print(f"\nRecord counts for {SAMPLE} ({name}):")
    for entity in BOOK_ENTITIES:
        print(f"  {entity:<20}{len(load_entity(SAMPLE, entity)):>6}")

    bills = load_entity(SAMPLE, "bills")
    bill = next(b for b in bills if b["item_lines"])
    vendor = next(v for v in load_entity(SAMPLE, "vendors") if v["id"] == bill["vendor_id"])
    line = bill["item_lines"][0]
    print("\nExample bill:")
    print(f"  {bill['id']} ({bill['doc_number']}) {bill['txn_date']} due {bill['due_date']}, "
          f"kind={bill['expense_kind']}, total={money(bill['total_amount'])}")
    print(f"  line: {line['quantity']} x {line['item_name']} @ {money(line['unit_price_amount'])} "
          f"= {money(line['amount'])}")
    print(f"Related vendor: {vendor['id']} {vendor['display_name']} "
          f"(role={vendor['supply_role']}, terms={vendor['payment_terms']}, "
          f"{vendor['address']['city']}, {vendor['address']['state']})")


if __name__ == "__main__":
    main()
