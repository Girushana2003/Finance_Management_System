import { Pool } from "pg";
import { createJournalEntries } from "./accounting.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export function createBlankCompanyData() {
  return {
    company: {
      name: "",
      address: "",
      baseCurrency: "LKR",
      financialYearStart: "01-01",
      dateFormat: "YYYY-MM-DD",
      tax: { enabled: false, country: "", registrationNumber: "", ratePercent: 0 },
      inventoryMethod: "FIFO",
      numbering: {
        invoicePrefix: "INV",
        nextInvoiceNumber: 1001,
        billPrefix: "BILL",
        nextBillNumber: 2001,
      },
    },
    accounts: [
      { id: "cash", code: "1000", name: "Cash in hand", type: "asset", kind: "cash", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: false },
      { id: "bank", code: "1010", name: "Bank account", type: "asset", kind: "bank", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: false },
      { id: "receivables", code: "1100", name: "Customer receivables", type: "asset", kind: "category", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: true },
      { id: "inventory", code: "1200", name: "Inventory", type: "asset", kind: "category", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: false },
      { id: "payables", code: "2000", name: "Supplier payables", type: "liability", kind: "category", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: true },
      { id: "capital", code: "3000", name: "Owner capital", type: "equity", kind: "category", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: false },
      { id: "sales-income", code: "4000", name: "Sales income", type: "income", kind: "category", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: false },
      { id: "general-expense", code: "5000", name: "General expenses", type: "expense", kind: "category", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: false },
      { id: "opening-balance-equity", code: "3900", name: "Opening balance equity", type: "equity", kind: "category", openingBalanceCents: 0, parentAccountId: null, active: true, controlAccount: false },
    ],
    customers: [],
    suppliers: [],
    agents: [],
    sales: [],
    receipts: [],
    expenses: [],
    purchases: [],
    supplierPayments: [],
    transfers: [],
    journalEntries: [],
    users: [],
    auditLog: [],
  };
}

function migrateData(data) {
  const blank = createBlankCompanyData();
  const accounts = (data.accounts ?? []).map((account) => ({
    active: true,
    parentAccountId: null,
    controlAccount: false,
    ...account,
  }));
  const knownAccountIds = new Set(accounts.map((account) => account.id));
  const migratedData = {
    ...blank,
    ...data,
    company: {
      ...blank.company,
      ...(data.company ?? {}),
      tax: { ...blank.company.tax, ...(data.company?.tax ?? {}) },
      numbering: { ...blank.company.numbering, ...(data.company?.numbering ?? {}) },
    },
    accounts: [
      ...accounts,
      ...blank.accounts.filter((account) => !knownAccountIds.has(account.id)),
    ],
    customers: (data.customers ?? []).map((customer) => ({
      code: "",
      email: "",
      billingAddress: "",
      creditLimitCents: 0,
      paymentTermsDays: 0,
      openingBalanceCents: 0,
      ...customer,
    })),
    suppliers: (data.suppliers ?? []).map((supplier) => ({
      code: "",
      email: "",
      address: "",
      paymentTermsDays: 0,
      taxNumber: "",
      openingBalanceCents: 0,
      ...supplier,
    })),
    users: data.users ?? [],
    auditLog: data.auditLog ?? [],
  };
  migratedData.journalEntries = Array.isArray(data.journalEntries)
    ? data.journalEntries
    : createJournalEntries(migratedData);
  return migratedData;
}

export async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env and set your PostgreSQL connection string.");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existing = await pool.query(
    "SELECT data FROM finance_app_state WHERE id = 1",
  );
  if (existing.rowCount === 0) {
    const initialData = createBlankCompanyData();
    await pool.query(
      `INSERT INTO finance_app_state (id, data)
       VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(initialData)],
    );
  }

  const result = await pool.query(
    "SELECT data FROM finance_app_state WHERE id = 1",
  );
  if (result.rowCount !== 1) {
    throw new Error("Could not initialize accounting data in PostgreSQL.");
  }
  const data = migrateData(result.rows[0].data);
  await saveData(data);
  return data;
}

export async function saveData(data) {
  await pool.query(
    `INSERT INTO finance_app_state (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(data)],
  );
}
