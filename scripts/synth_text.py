"""Authored text libraries for the synthetic transaction-review extension.

Ordinary (legitimate) bill descriptions and memos live here. Placeholders:
{d} bill date ("Oct 6"), {p0}/{p1} billing period, {mo} month, {c} customer/site, {n} count,
{po} purchase-order number, {kwh}/{ccf} usage, {pct} percent complete.
Several memo variants are deliberately blank or terse: a short memo is not an issue.
"""

COMPANIES = [
    dict(
        new="company-101", src="company-018", kind="ecom", name="Parcelmint Online Goods",
        legal="Parcelmint Online Goods LLC", slug="parcelmintonlinegoods", city=("Toledo", "OH", "43604"),
        street="2214 Dockside Parkway", phone="(555) 410-7721", base_n=168,
        vendors={
            "vend-supplier": "Halvorsen Consumer Electronics Wholesale",
            "vend-logistics-vendor": "Timberline Fulfillment Partners",
            "vend-operating-vendor": "Lanternwood Marketing Group",
            "vend-equipment-vendor": "Novotny Racking & Warehouse Equipment",
        },
        card=("Meridian Business Card Services", "Meridian Card Services"),
    ),
    dict(
        new="company-102", src="company-042", kind="remodel", name="Tallowfield Home Renovations",
        legal="Tallowfield Home Renovations LLC", slug="tallowfieldhomerenovations", city=("Rochester", "NY", "14608"),
        street="880 Millrace Street", phone="(555) 276-0148", base_n=172,
        vendors={"vend-materials": "Redwood Clearwater Building Supply"},
        card=("Harborline Business Card", "Harborline Card"),
    ),
    dict(
        new="company-103", src="company-035", kind="agency", name="Quillstone Creative Studio",
        legal="Quillstone Creative Studio LLC", slug="quillstonecreativestudio", city=("Dayton", "OH", "45402"),
        street="415 Foundry Lane", phone="(555) 903-2260", base_n=166,
        vendors={},
        card=("Pinnacle Corporate Card", "Pinnacle Card"),
    ),
    dict(
        new="company-104", src="company-037", kind="catering", name="Marrow & Vine Catering",
        legal="Marrow & Vine Catering LLC", slug="marrowvinecatering", city=("Worcester", "MA", "01608"),
        street="63 Stillwater Road", phone="(555) 658-3394", base_n=160,
        vendors={"vend-equipment-vendor": "Brightline Kitchen Equipment Co."},
        card=("Summit Business Card Services", "Summit Card Services"),
    ),
]

# --- Ordinary descriptions, keyed by vendor id (preferred) or "cat:<cost_category>" -----------------
DESC = {
    "ecom": {
        "vend-landlord": ["Warehouse and office rent, week of {d}", "Rent installment, week of {d}", "Premises rent, {p0}-{p1}", "Weekly rent, Unit 4 and mezzanine office"],
        "vend-electricity": ["Electric service, {p0}-{p1}", "Metered electricity, warehouse, {p0}-{p1}", "Electricity usage, billing week ending {d}"],
        "vend-water": ["Water and sewer, {p0}-{p1}", "Water service, week ending {d}"],
        "vend-logistics-vendor": ["Pick, pack and ship fulfillment, week ending {d}", "3PL fulfillment fees, {n} orders, week ending {d}", "Outbound fulfillment and carrier handling, {p0}-{p1}", "Storage and fulfillment charges, week ending {d}"],
        "cat:growth": ["Paid social campaign, {mo}", "Email and affiliate promotion, {mo}", "Influencer product seeding program, {mo}", "Search ad management and creative, {mo}"],
        "cat:product_development": ["Private-label packaging concept and prototype run"],
        "cat:interest": ["Equipment loan interest, statement {mo}"],
        "cat:income_tax": ["Quarterly income tax assessment, {mo}"],
        "cat:permit": ["Business license renewal"],
        "cat:equipment": ["Racking and conveyor equipment for warehouse expansion"],
    },
    "remodel": {
        "vend-masonry": ["Block and brick masonry, {c}", "Foundation wall and footing masonry, {c}", "Stone veneer installation, {c}", "Chimney repoint and flashing, {c}"],
        "vend-sitework": ["Excavation and grading, {c}", "Site prep and haul-off, {c}", "Drainage trenching and backfill, {c}", "Driveway base and compaction, {c}"],
        "vend-plumbing": ["Rough-in plumbing, {c}", "Fixture set and pressure test, {c}", "Water line and drain replacement, {c}"],
        "vend-finishing": ["Interior trim and paint, {c}", "Drywall finish and punch list, {c}", "Cabinet install and touch-up, {c}", "Flooring finish work, {c}"],
        "vend-electrical": ["Electrical rough-in and panel work, {c}", "Lighting circuits and fixture trim-out, {c}", "Service upgrade and inspection prep, {c}"],
        "vend-demolition": ["Selective demolition and debris haul-off, {c}", "Interior tear-out and disposal, {c}"],
        "vend-landscaping": ["Hardscape and planting, {c}", "Irrigation install and sod, {c}", "Retaining wall and plant beds, {c}"],
        "vend-materials": ["Lumber and sheet goods package, {c}", "Windows and exterior doors, {c}", "Tile, underlayment and fasteners, {c}", "Roofing and flashing materials, {c}"],
        "vend-landlord": ["Shop and yard rent, week of {d}", "Rent installment, week of {d}", "Premises rent, {p0}-{p1}"],
        "vend-insurer": ["General liability and builder's risk premium, {mo}", "Contractor insurance installment, {mo}", "Workers' compensation premium, {mo}"],
        "vend-utilities": ["Gas and electric, shop and yard, {mo}", "Utilities, {p0}-{p1}"],
        "vend-government": ["Building permit fee, {c}", "Permit and inspection fees, {c}"],
        "cat:income_tax": ["Income tax assessed for the period, {mo}"],
    },
    "agency": {
        "vend-masonry": ["Brand strategy workshops and positioning, {c}", "Strategy retainer and research synthesis, {c}", "Messaging architecture, {c}"],
        "vend-finishing": ["Post-production and color finishing, {c}", "Video edit and sound mix, {c}", "Motion graphics and final delivery, {c}"],
        "vend-electrical": ["Media production, shoot day and crew, {c}", "Photography and studio production, {c}", "Audio and location production, {c}"],
        "vend-plumbing": ["Copywriting and script development, {c}", "Long-form copy and landing page text, {c}", "Copy revisions and proofing, {c}"],
        "vend-sitework": ["Campaign planning and calendar, {c}", "Channel planning and measurement setup, {c}", "Planning sprint and budgeting, {c}"],
        "vend-landscaping": ["Media placement, {c}", "Programmatic placement and trafficking, {c}", "Out-of-home placement, {c}"],
        "vend-demolition": ["Discovery research and interviews, {c}", "Audience research and survey fieldwork, {c}"],
        "vend-materials": ["Print production and finishing materials, {c}", "Signage and collateral production, {c}", "Event display and fabrication materials, {c}"],
        "vend-landlord": ["Studio rent, week of {d}", "Rent installment, week of {d}", "Studio and office rent, {p0}-{p1}"],
        "vend-insurer": ["Professional liability premium, {mo}", "Business insurance installment, {mo}", "Media liability coverage, {mo}"],
        "vend-utilities": ["Water and sewer, {p0}-{p1}", "Utilities, {mo}"],
        "vend-government": ["Business license and permit fee, {mo}", "Shoot permit fee, {c}"],
        "cat:income_tax": ["Income tax assessed for the period, {mo}"],
    },
    "catering": {
        "vend-masonry": ["Menu development and tasting prep, {c}", "Menu design and printed menus, {c}", "Menu costing and recipe testing, {c}"],
        "vend-sitework": ["Event planning and venue coordination, {c}", "Floor plan, timeline and venue walkthrough, {c}", "Day-of event coordination, {c}"],
        "vend-plumbing": ["Food production and prep kitchen labor, {c}", "Prepared entree and appetizer production, {c}", "Bulk food production, {c}"],
        "vend-finishing": ["Service staff, servers and captains, {c}", "Event service staffing, {c}", "Banquet staff and setup crew, {c}"],
        "vend-electrical": ["Rental tables, chairs and linens, {c}", "Chafing equipment and serviceware rental, {c}", "Tent and lighting rental, {c}"],
        "vend-landscaping": ["Bar service and bartenders, {c}", "Bar setup, glassware and service, {c}", "Mocktail and beverage station, {c}"],
        "vend-materials": ["Ingredients and perishable goods, {c}", "Produce, dairy and proteins, {c}", "Dry goods and disposables, {c}", "Specialty ingredients order, {c}"],
        "vend-landlord": ["Commissary kitchen rent, week of {d}", "Rent installment, week of {d}", "Premises rent, {p0}-{p1}"],
        "vend-insurer": ["Liquor liability and general liability premium, {mo}", "Business insurance installment, {mo}", "Workers' compensation premium, {mo}"],
        "vend-utilities": ["Gas, electric and water, commissary, {mo}", "Utilities, {p0}-{p1}"],
        "vend-government": ["Food service permit and health inspection fee, {mo}", "Event permit, {c}"],
        "vend-equipment-vendor": ["Service call on walk-in cooler and ovens", "Preventive maintenance, kitchen equipment", "Equipment servicing, commissary kitchen"],
        "cat:owned_equipment": ["Commercial convection oven and prep station for commissary kitchen"],
        "cat:income_tax": ["Income tax assessed for the period, {mo}"],
    },
}

MEMO = {
    "ecom": {
        "vend-supplier": ["Received complete against PO {po}; {n} cartons counted.", "PO {po}: received in full, dock count matched packing slip.", "Delivered to dock 3 against PO {po}, pallets inspected on arrival.", "Packing slip {n} attached; PO {po}.", "Restock order PO {po} for peak season.", "PO {po}, net 7 per supplier agreement."],
        "vend-landlord": ["Weekly installment per lease schedule.", "", "Lease ref LS-2210.", "Per lease; no change from prior week."],
        "vend-electricity": ["Metered usage {kwh} kWh.", "", "Meter read {kwh} kWh.", "Estimated read; true-up next cycle."],
        "vend-water": ["Metered usage {ccf} CCF.", "", "Includes fixed service charge."],
        "vend-logistics-vendor": ["Order volume per WMS report.", "Carrier surcharges passed through at cost.", "", "Volume tier 2 rate applied.", "Weekly invoice, usage per portal report."],
        "default": ["", "Per agreement.", "Net 7."],
    },
    "remodel": {
        "vend-landlord": ["Weekly installment per lease schedule.", "", "Lease ref YL-318."],
        "vend-utilities": ["Metered usage {kwh} kWh.", "", "Seasonal rate applied."],
        "vend-insurer": ["Installment {n} of 12.", "", "Policy renews in spring."],
        "default": ["Progress billing per schedule of values.", "Lien waiver on file.", "Site visit verified by PM.", "", "{pct}% complete per subcontract.", "Net 30.", "Per subcontract scope; no change orders."],
    },
    "agency": {
        "vend-landlord": ["Weekly installment per lease schedule.", "", "Lease ref QS-77."],
        "vend-utilities": ["Metered usage {ccf} CCF.", "", "Includes fixed service charge."],
        "vend-insurer": ["Installment {n} of 12.", "", "Annual policy, renews in fall."],
        "default": ["Billed per statement of work.", "Milestone accepted by account lead.", "", "Net 30.", "Time and materials, capped per SOW.", "Deliverable approved by client.", "PO {po} referenced."],
    },
    "catering": {
        "vend-landlord": ["Weekly installment per lease schedule.", "", "Lease ref MV-205."],
        "vend-utilities": ["Metered usage {kwh} kWh.", "", "Seasonal rate applied."],
        "vend-insurer": ["Installment {n} of 12.", "", "Policy renews in spring."],
        "default": ["Event billing per signed order.", "Headcount confirmed {n} guests.", "", "Net 30.", "Invoice per event contract.", "Delivered and set up on schedule.", "PO {po} referenced."],
    },
}

# Receipts / card descriptions for ordinary card statements (legitimate).
CARD_ORDINARY = {
    "ecom": [("Monthly card statement: shipping supplies and software", "Statement closing {d}", "Receipt summary: poly mailers, label stock, thermal printer ribbons, one-month subscription to inventory software."),
             ("Card charges: packaging samples and trade-show registration", "Statement closing {d}", "Receipt summary: sample cartons from two packaging vendors; registration for regional ecommerce expo, business badge."),
             ("Card statement: office and warehouse consumables", "Closing {d}", "Receipt summary: pallet wrap, box cutters, gloves, printer paper, cleaning supplies for dock.")],
    "remodel": [("Card statement: small tools and jobsite consumables", "Statement closing {d}", "Receipt summary: drill bits, saw blades, tarps, caulk, job-site first aid refill."),
                ("Card charges: fuel for work trucks", "Statement closing {d}", "Receipt summary: fleet fuel for 3 trucks, itemized by vehicle number."),
                ("Card statement: permit courier and printing", "Closing {d}", "Receipt summary: plan printing, courier to county office, notary fee for permit packet.")],
    "agency": [("Card statement: software seats and stock assets", "Statement closing {d}", "Receipt summary: design software seats, stock photo credits for client campaign, font license."),
               ("Card charges: client meeting and production snacks", "Statement closing {d}", "Receipt summary: catered lunch for client workshop, shoot-day craft services, listed attendees."),
               ("Card statement: cloud hosting and domains", "Closing {d}", "Receipt summary: staging server hosting, two campaign domains, email delivery service.")],
    "catering": [("Card statement: disposables and small wares", "Statement closing {d}", "Receipt summary: chafing fuel, deli containers, sheet pans, parchment, gloves."),
                 ("Card charges: farmers market ingredient run", "Statement closing {d}", "Receipt summary: seasonal produce and herbs for tasting menu, itemized by vendor stall."),
                 ("Card statement: uniforms and linens", "Closing {d}", "Receipt summary: aprons, server shirts, replacement napkins after an event.")],
}
