import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboard,
  createJournalEntry,
  createJournalEntries,
  getOutstanding,
  getPurchaseOutstanding,
  normalizeDocumentLineItems,
} from "../src/accounting.js";
import { formatLocalDate } from "../src/store.js";

test("formatLocalDate preserves the calendar date in the local timezone", () => {
  assert.equal(formatLocalDate(new Date(2026, 9, 19, 0, 30)), "2026-10-19");
});

const data = {
  accounts: [
    { id: "cash", name: "Cash in hand", type: "asset", kind: "cash", openingBalanceCents: 10000 },
    { id: "bank", name: "Bank", type: "asset", kind: "bank", openingBalanceCents: 50000 },
    { id: "receivables", name: "Customer receivables", type: "asset", kind: "category", openingBalanceCents: 0 },
    { id: "inventory", name: "Inventory", type: "asset", kind: "category", openingBalanceCents: 0 },
    { id: "payables", name: "Supplier payables", type: "liability", kind: "category", openingBalanceCents: 0 },
    { id: "capital", name: "Owner capital", type: "equity", kind: "category", openingBalanceCents: 0 },
    { id: "opening-balance-equity", name: "Opening balance equity", type: "equity", kind: "category", openingBalanceCents: 0 },
    { id: "sales-income", name: "Sales income", type: "income", kind: "category", openingBalanceCents: 0 },
    { id: "general-expense", name: "General expenses", type: "expense", kind: "category", openingBalanceCents: 0 },
    { id: "travel-expense", name: "Travel", type: "expense", kind: "category", openingBalanceCents: 0 },
  ],
  customers: [{ id: "customer-1", name: "Sample Customer" }],
  suppliers: [{ id: "supplier-1", name: "Sample Supplier" }],
  agents: [
    { id: "agent-1", name: "Agent One" },
    { id: "agent-2", name: "Agent Two" },
  ],
  sales: [
    {
      id: "sale-1",
      reference: "INV-1001",
      customerId: "customer-1",
      agentId: "agent-1",
      date: "2026-10-01",
      amountCents: 25000,
    },
    {
      id: "sale-2",
      reference: "INV-1002",
      customerId: "customer-1",
      agentId: "agent-2",
      date: "2026-10-03",
      amountCents: 8000,
    },
  ],
  receipts: [
    {
      id: "receipt-1",
      saleId: "sale-1",
      customerId: "customer-1",
      accountId: "cash",
      date: "2026-10-02",
      amountCents: 10000,
    },
    {
      id: "receipt-2",
      saleId: "sale-1",
      customerId: "customer-1",
      accountId: "bank",
      date: "2026-10-04",
      amountCents: 5000,
    },
  ],
  expenses: [
    {
      id: "expense-1",
      accountId: "cash",
      date: "2026-10-02",
      category: "Travel",
      amountCents: 2000,
    },
  ],
  purchases: [
    {
      id: "purchase-1",
      reference: "BILL-2001",
      supplierId: "supplier-1",
      date: "2026-10-01",
      amountCents: 25000,
    },
    {
      id: "purchase-2",
      reference: "BILL-2002",
      supplierId: "supplier-1",
      date: "2026-10-03",
      amountCents: 8000,
    },
  ],
  supplierPayments: [
    {
      id: "payment-1",
      purchaseId: "purchase-1",
      supplierId: "supplier-1",
      accountId: "bank",
      date: "2026-10-02",
      amountCents: 5000,
    },
  ],
  transfers: [
    {
      id: "transfer-1",
      fromAccountId: "cash",
      toAccountId: "bank",
      date: "2026-10-03",
      amountCents: 3000,
    },
  ],
};

test("getOutstanding subtracts receipts allocated to the sale", () => {
  assert.equal(getOutstanding(data.sales[0], data.receipts), 10000);
});

test("dashboard filters period totals and calculates balances through end date", () => {
  const dashboard = buildDashboard(data, "2026-10-02", "2026-10-03");

  assert.equal(dashboard.totals.receivedCents, 10000);
  assert.equal(dashboard.totals.salesCents, 8000);
  assert.equal(dashboard.totals.spentCents, 2000);
  assert.equal(dashboard.totals.balanceCents, 63000);
  assert.equal(dashboard.accounts.find((account) => account.id === "cash").balanceCents, 15000);
  assert.equal(dashboard.accounts.find((account) => account.id === "bank").balanceCents, 48000);
  assert.equal(dashboard.totals.outstandingCents, 23000);
  assert.equal(dashboard.outstanding.length, 2);
  assert.equal(dashboard.outstanding[0].reference, "INV-1001");
  assert.equal(dashboard.totals.supplierOutstandingCents, 28000);
  assert.equal(dashboard.agentOutstanding.find((agent) => agent.id === "agent-1").dueCents, 15000);
  assert.equal(dashboard.agentOutstanding.find((agent) => agent.id === "agent-2").dueCents, 8000);
  assert.equal(dashboard.monthlyTrend.length, 6);
  assert.deepEqual(dashboard.monthlyTrend.at(-1), {
    month: "2026-10",
    label: "Oct",
    incomeCents: 33000,
    expenseCents: 2000,
    cashFlowCents: 3000,
  });
});

test("supplier bill balances decrease as payments are recorded", () => {
  assert.equal(getPurchaseOutstanding(data.purchases[0], data.supplierPayments), 20000);
});

test("document line items normalize quantities and calculate their total in cents", () => {
  const items = normalizeDocumentLineItems([
    { description: "  Notebooks ", quantity: "2.5", unitPrice: "12.40" },
    { description: "Pens", quantity: "3", unitPrice: "1.25" },
  ], "Sale", null);

  assert.deepEqual(items, [
    { description: "Notebooks", quantityMilli: 2500, unitPriceCents: 1240, totalCents: 3100 },
    { description: "Pens", quantityMilli: 3000, unitPriceCents: 125, totalCents: 375 },
  ]);
  assert.equal(items.reduce((total, item) => total + item.totalCents, 0), 3475);
});

test("document line items reject invalid quantities and prices", () => {
  assert.throws(
    () => normalizeDocumentLineItems([{ description: "Item", quantity: "0", unitPrice: "10.00" }], "Sale", null),
    /quantities and prices must produce a positive valid amount/,
  );
  assert.throws(
    () => normalizeDocumentLineItems([{ description: "Item", quantity: "1", unitPrice: "10.001" }], "Sale", null),
    /prices must be greater than zero with up to 2 decimals/,
  );
  assert.throws(
    () => normalizeDocumentLineItems([], "Sale", null),
    /Add between 1 and 50 line items/,
  );
});

test("single-amount document requests remain compatible as one summary line", () => {
  assert.deepEqual(
    normalizeDocumentLineItems(undefined, "Legacy sale", 4200),
    [{ description: "Legacy sale", quantityMilli: 1000, unitPriceCents: 4200, totalCents: 4200 }],
  );
});

test("dashboard activity includes sales and supplier bills across the selected dates", () => {
  const dashboard = buildDashboard(data, "2026-10-01", "2026-10-03");
  assert.equal(dashboard.activities.length, 8);
  assert.ok(dashboard.activities.some((activity) =>
    activity.type === "sale" && activity.reference === "INV-1001"));
  assert.ok(dashboard.activities.some((activity) =>
    activity.type === "purchase" && activity.reference === "BILL-2002"));
});

test("opening balances are included in outstanding reports but not period sales or purchase totals", () => {
  const openingData = {
    ...data,
    sales: [
      ...data.sales,
      {
        id: "opening-customer-1",
        reference: "OB-CUST-001",
        customerId: "customer-1",
        date: "2026-10-01",
        amountCents: 12000,
        isOpeningBalance: true,
      },
    ],
    purchases: [
      ...data.purchases,
      {
        id: "opening-supplier-1",
        reference: "OB-SUP-001",
        supplierId: "supplier-1",
        date: "2026-10-01",
        amountCents: 9000,
        isOpeningBalance: true,
      },
    ],
  };
  const dashboard = buildDashboard(openingData, "2026-10-01", "2026-10-03");

  assert.equal(dashboard.totals.salesCents, 33000);
  assert.equal(dashboard.totals.purchasesCents, 33000);
  assert.equal(dashboard.totals.outstandingCents, 35000);
  assert.equal(dashboard.totals.supplierOutstandingCents, 37000);
});

test("transfers change individual balances without changing total liquid funds", () => {
  const dashboard = buildDashboard(data, "2026-10-03", "2026-10-03");
  assert.equal(dashboard.accounts.find((account) => account.id === "cash").balanceCents, 15000);
  assert.equal(dashboard.accounts.find((account) => account.id === "bank").balanceCents, 48000);
  assert.equal(dashboard.totals.balanceCents, 63000);
  assert.equal(dashboard.totals.receivedCents, 0);
  assert.equal(dashboard.totals.spentCents, 0);
});

test("all generated journal entries balance and drive the accounting equation", () => {
  const entries = createJournalEntries(data);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.equal(
      entry.lines.reduce((total, line) => total + line.debitCents, 0),
      entry.lines.reduce((total, line) => total + line.creditCents, 0),
      `${entry.sourceType} ${entry.sourceId} should balance`,
    );
  }

  const dashboard = buildDashboard({ ...data, journalEntries: entries }, "2026-10-01", "2026-10-04");
  const assets = dashboard.accounts
    .filter((account) => account.type === "asset")
    .reduce((total, account) => total + account.balanceCents, 0);
  const liabilitiesAndEquity = dashboard.accounts
    .filter((account) => account.type === "liability" || account.type === "equity")
    .reduce((total, account) => total + account.balanceCents, 0);

  assert.equal(assets, liabilitiesAndEquity);
  assert.equal(dashboard.totals.netProfitCents, 31000);
  assert.equal(dashboard.accounts.find((account) => account.id === "inventory").balanceCents, 33000);
  assert.equal(dashboard.accounts.find((account) => account.id === "payables").balanceCents, 28000);
  assert.equal(dashboard.accounts.find((account) => account.id === "travel-expense").balanceCents, 2000);

  const period = buildDashboard(
    { ...data, journalEntries: entries },
    "2026-10-02",
    "2026-10-03",
  );
  assert.equal(period.totals.incomeCents, 8000);
  assert.equal(period.totals.expenseCents, 2000);
  assert.equal(period.totals.netProfitCents, 6000);
  assert.equal(
    period.accounts
      .filter((account) => account.type === "asset")
      .reduce((total, account) => total + account.balanceCents, 0),
    period.accounts
      .filter((account) => account.type === "liability" || account.type === "equity")
      .reduce((total, account) => total + account.balanceCents, 0),
  );
});

test("journal creation rejects unbalanced postings", () => {
  assert.throws(() => createJournalEntry(data, {
    id: "unbalanced",
    date: "2026-10-01",
    description: "Invalid test",
    sourceType: "test",
    sourceId: "unbalanced",
    lines: [
      { accountId: "cash", debitCents: 100, creditCents: 0 },
      { accountId: "sales-income", debitCents: 0, creditCents: 99 },
    ],
  }), /debits and credits must be equal/);
});
