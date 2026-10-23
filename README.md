# Ledgerly finance workspace

A local bookkeeping learning project for company setup, chart of accounts, customer and supplier masters, customer sales/receipts, expenses, supplier bills/payments, transfers, and date-filtered reports.

## Project structure

```text
Finance_management_system/
├── frontend/                 # React + Vite application
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       └── styles.css
├── backend/                  # Node.js + Express API
│   ├── package.json
│   ├── src/
│   │   ├── accounting.js
│   │   ├── auth.js
│   │   ├── database.js
│   │   ├── index.js
│   │   ├── reset-database.js
│   │   └── store.js
│   └── tests/
│       └── accounting.test.js
├── data/                     # Local sample data (created automatically)
├── package.json              # Workspace scripts and shared development tools
└── README.md
```

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. From the project root, run `npm install`.
3. Configure PostgreSQL as described below.
4. Run `npm run dev`.
5. Open the Vite URL shown in the terminal (usually `http://localhost:5173`).

The React frontend runs on port `5173` and proxies `/api` requests to the Node API on `http://localhost:3001`. The backend stores application data in PostgreSQL.

### Connect PostgreSQL

1. Copy `.env.example` to `.env`, or add the variables to your existing `.env` without replacing its database connection.
2. Set `DATABASE_URL` to your PostgreSQL connection string, and set `ADMIN_EMAIL` and `ADMIN_PASSWORD` privately. The administrator password must be at least 12 characters. Do not share or commit `.env`.
3. Start the app with `npm run dev`. On first use, it creates a blank company and a starter chart of accounts. Sign in with the admin email/password from `.env`.

The backend stores its application state in PostgreSQL's `finance_app_state` table. Existing state is migrated with new settings and master-data fields while keeping existing records. To deliberately start over, stop the app and run `npm run db:reset`, then restart it. **This permanently deletes all Ledgerly data in that database**, including users; the administrator is recreated from `.env`. The old `data/accounts.json` file is no longer automatically imported.

You can also start the workspaces separately from the root:

- `npm run dev:frontend`
- `npm run dev:backend`
- `npm run db:reset` (destructive; see above)

## Sample API

- `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`
- `GET /api/dashboard?from=2026-10-01&to=2026-10-05`
- `GET /api/journal-entries?from=2026-10-01&to=2026-10-05` (Admin/Accountant)
- `GET /api/company`, `PUT /api/company` (Admin)
- `GET /api/users`, `POST /api/users` (Admin), `GET /api/audit-log` (Admin/Accountant)
- `POST /api/accounts`
- `POST /api/customers`, `/api/suppliers`, `/api/agents`
- `POST /api/sales`
- `POST /api/receipts`
- `POST /api/expenses`
- `POST /api/purchases`
- `POST /api/supplier-payments`
- `POST /api/transfers`

Amounts are entered as decimal currency units and stored internally as integer cents. A credit sale records revenue and customer debt; it does not increase cash or bank until a receipt is recorded. A supplier bill records an amount payable; paying it later reduces the selected cash/bank account and the bill balance. Transfers change the two account balances by equal amounts and are not counted as income or spending. The agent report groups open customer debt by the agent assigned to each sale.

The Transactions page includes searchable and filterable activity for sales, receipts, expenses, supplier bills and payments, transfers, and opening balances. Results follow the selected reporting period and are paginated for easier review. Export CSV downloads all matching filtered results, not only the visible page. Sales and supplier bills accept up to 50 item lines with a description, quantity, and unit price; the backend validates and calculates each line in cents and derives the posted document total from the line totals. Existing API clients may continue sending a single amount, which is preserved as one summary line.

Open a sale or supplier bill from the transaction list to review its printable document, payment status, and item breakdown. Documents can be printed or saved as PDF using the browser print dialog, or exported as line-level CSV. Historical documents without item details display as a single summary line.

This is a local educational sample, not production accounting software. Every recorded transaction is saved with a balanced, double-entry journal: sales debit receivables and credit income; receipts debit cash/bank and credit receivables; expenses debit the matching expense account (or General expenses) and credit cash/bank; supplier bills debit inventory and credit payables; supplier payments debit payables and credit cash/bank; transfers debit the destination and credit the source. Opening account balances are offset to Opening balance equity, and customer/supplier opening balances post to receivables/payables without affecting income. Existing transaction history is journalized on the first database startup after this update. Legacy chart opening balances without an entry date are migrated using `1970-01-01`.

The balance sheet and profit-and-loss report are calculated from journal entries, with current earnings included in equity. The `/api/journal-entries` endpoint lets Admins and Accountants review the posted ledger. Supplier bills are currently capitalized to the Inventory account, but inventory movements, cost of goods sold, tax-aware invoices, and item-level valuation are not implemented; consequently, the profit-and-loss report does not yet recognize costs when stock is sold.

## Accountant foundation release

The current foundation adds company settings (LKR default, fiscal-year start, date format, tax configuration fields, FIFO/weighted-average selection, and numbering sequences), chart account codes/parents/active/control-account flags/opening balances, customer and supplier master details/opening balances, password sign-in, four roles (Admin, Accountant, Sales/Purchasing Clerk, Read-only), and an audit trail for recorded changes. The first administrator is bootstrapped from environment variables; public sign-up is disabled. Use a long, unique admin password and add the two admin variables to your private `.env` file before starting the backend.

Tax settings are configuration only until the tax jurisdiction is confirmed and tax-aware invoices are implemented. FIFO is saved as the selected policy, but the inventory/item module is not implemented yet. Invoice/bill line items are document details only and do not create inventory movements. Credit notes, cost of goods sold, bank reconciliation, approvals, period locks, and full permission management remain future phases. Do not use this learning application as a production accounting system or as a substitute for an accountant's review.

## Checks

- `npm test`
- `npm run build`
