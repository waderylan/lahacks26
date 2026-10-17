// Fictional internal team used as message recipients. Not part of the dataset; names and emails are invented.
export interface Employee { id: string; name: string; title: string; department: string; email: string; description: string }

export const EMPLOYEES: Employee[] = [
  { id: 'emp-ap', name: 'Priya Natarajan', title: 'Accounts Payable Specialist', department: 'Finance', email: 'priya.natarajan@example.com',
    description: 'Enters and codes every vendor bill, matches invoices to purchase orders and receipts, and maintains vendor records and payment terms. First contact for blank, vague, or copied-forward bill descriptions and memos, duplicate invoices, wrong vendor names, and bills that need a corrected memo or line description before payment.' },
  { id: 'emp-controller', name: 'Marcus Bell', title: 'Controller', department: 'Finance', email: 'marcus.bell@example.com',
    description: 'Owns the chart of accounts, month-end close, accruals, and reclassifications. Decides whether a cost belongs in overhead/operating expense, cost of goods sold, inventory, or a capitalized asset. Contact when a bill appears posted to the wrong account or expense category, or when a correction would change the financial statements.' },
  { id: 'emp-procurement', name: 'Elena Ruiz', title: 'Procurement Manager', department: 'Operations', email: 'elena.ruiz@example.com',
    description: 'Selects vendors, negotiates contracts and pricing, issues purchase orders, and manages recurring service agreements. Knows what was ordered, from whom, at what price, and under which contract. Contact about unexpected price changes, purchases without a PO, vendor substitutions, or whether a recurring charge matches the agreed service.' },
  { id: 'emp-ops', name: 'Dev Okafor', title: 'Operations & Inventory Manager', department: 'Operations', email: 'dev.okafor@example.com',
    description: 'Receives physical goods, runs the warehouse and production floor, and tracks raw materials, packaging, and finished-goods inventory. Confirms whether goods were delivered, in what quantity, and what they were used for. Contact when line items describe physical products and someone needs to confirm receipt or purpose.' },
  { id: 'emp-facilities', name: 'Hannah Cho', title: 'Facilities & Office Manager', department: 'Administration', email: 'hannah.cho@example.com',
    description: 'Manages rent, utilities, cleaning, repairs and maintenance, insurance on premises, and office supplies. Approves standing monthly overhead and service charges for the building. Contact about recurring overhead bills, property services, or whether a service charge was actually provided that month.' },
  { id: 'emp-it', name: 'Sam Whitaker', title: 'IT & Systems Lead', department: 'Technology', email: 'sam.whitaker@example.com',
    description: 'Owns software subscriptions, SaaS seats, cloud hosting, telecom and internet service, and computer hardware purchases. Contact about technology vendors, subscription renewals or tier changes, hardware that may need to be capitalized, or licenses that are no longer used.' },
  { id: 'emp-projects', name: 'Grace Adeyemi', title: 'Project Manager', department: 'Delivery', email: 'grace.adeyemi@example.com',
    description: 'Runs client projects and job costing, approves subcontractor and project-specific spend, and decides which costs are billable to clients. Contact when a bill references a project, a subcontractor, or a client deliverable, or when a cost may need to be assigned to or removed from a project.' },
  { id: 'emp-tax', name: 'Aisha Rahman', title: 'Tax & Compliance Analyst', department: 'Finance', email: 'aisha.rahman@example.com',
    description: 'Handles sales and use tax, 1099 vendor reporting, W-9 collection, and documentation needed for deductibility and audits. Contact when a bill lacks the detail needed to support a deduction, may carry the wrong tax treatment, or involves a vendor whose tax status is unclear.' },
  { id: 'emp-cfo', name: 'Robert Lindqvist', title: 'Chief Financial Officer', department: 'Executive', email: 'robert.lindqvist@example.com',
    description: 'Final approver for large or unusual spend, budget variances, policy exceptions, and anything that could be a related-party or fraud concern. Not the right contact for routine coding or clarification questions; escalate only when the amount or pattern warrants executive attention.' },
];

export const employeeById = (id: string | null | undefined) => EMPLOYEES.find(e => e.id === id);
