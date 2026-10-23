import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "accounts.json");

export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function today() {
  return formatLocalDate();
}

function createSeedData() {
  const date = today();
  const yesterday = new Date(`${date}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const previousDate = formatLocalDate(yesterday);

  return {
    accounts: [
      { id: "cash", code: "1000", name: "Cash in hand", type: "asset", kind: "cash", openingBalanceCents: 42500 },
      { id: "bank", code: "1010", name: "Main bank account", type: "asset", kind: "bank", openingBalanceCents: 125000 },
      { id: "receivables", code: "1100", name: "Customer receivables", type: "asset", kind: "category", openingBalanceCents: 0 },
      { id: "payables", code: "2000", name: "Supplier payables", type: "liability", kind: "category", openingBalanceCents: 0 },
      { id: "capital", code: "3000", name: "Owner capital", type: "equity", kind: "category", openingBalanceCents: 0 },
      { id: "sales-income", code: "4000", name: "Sales income", type: "income", kind: "category", openingBalanceCents: 0 },
      { id: "transport-expense", code: "5000", name: "Transport expense", type: "expense", kind: "category", openingBalanceCents: 0 },
    ],
    customers: [
      { id: "customer-1", name: "Amara Stores", phone: "077 123 4567" },
      { id: "customer-2", name: "Greenfield Cafe", phone: "077 555 0182" },
      { id: "customer-3", name: "Nimal Traders", phone: "077 980 4401" },
    ],
    suppliers: [
      { id: "supplier-1", name: "Island Wholesale", phone: "011 234 5678" },
      { id: "supplier-2", name: "Metro Office Supplies", phone: "011 777 2030" },
    ],
    agents: [
      { id: "agent-1", name: "Kamal Perera", phone: "077 321 9087" },
      { id: "agent-2", name: "Sanjeewa Silva", phone: "077 441 2209" },
    ],
    sales: [
      {
        id: "sale-1001",
        reference: "INV-1001",
        customerId: "customer-1",
        agentId: "agent-1",
        date: previousDate,
        description: "Goods sale",
        amountCents: 48000,
      },
      {
        id: "sale-1002",
        reference: "INV-1002",
        customerId: "customer-2",
        agentId: "agent-2",
        date,
        description: "Service and supplies",
        amountCents: 72500,
      },
      {
        id: "sale-1003",
        reference: "INV-1003",
        customerId: "customer-3",
        agentId: "agent-1",
        date,
        description: "Goods sale",
        amountCents: 31500,
      },
    ],
    receipts: [
      {
        id: "receipt-1",
        saleId: "sale-1001",
        customerId: "customer-1",
        accountId: "bank",
        date: previousDate,
        amountCents: 18000,
      },
      {
        id: "receipt-2",
        saleId: "sale-1002",
        customerId: "customer-2",
        accountId: "cash",
        date,
        amountCents: 72500,
      },
    ],
    expenses: [
      {
        id: "expense-1",
        accountId: "cash",
        date,
        category: "Transport",
        description: "Local delivery",
        amountCents: 4500,
      },
    ],
    purchases: [
      {
        id: "purchase-2001",
        reference: "BILL-2001",
        supplierId: "supplier-1",
        date: previousDate,
        description: "Stock purchase",
        amountCents: 56000,
      },
      {
        id: "purchase-2002",
        reference: "BILL-2002",
        supplierId: "supplier-2",
        date,
        description: "Office supplies",
        amountCents: 18000,
      },
    ],
    supplierPayments: [
      {
        id: "supplier-payment-1",
        purchaseId: "purchase-2001",
        supplierId: "supplier-1",
        accountId: "bank",
        date,
        amountCents: 20000,
      },
    ],
    transfers: [],
  };
}

function migrateData(data) {
  const additions = createSeedData();
  const knownIds = new Set((data.accounts ?? []).map((account) => account.id));
  const existingAccounts = (data.accounts ?? []).map((account) => ({
    ...account,
    code:
      account.code ??
      (account.id === "cash" ? "1000" : account.id === "bank" ? "1010" : ""),
    kind:
      account.kind ??
      (account.id === "cash"
        ? "cash"
        : account.id === "bank"
          ? "bank"
          : "category"),
  }));

  return {
    ...additions,
    ...data,
    accounts: [
      ...existingAccounts,
      ...additions.accounts.filter((account) => !knownIds.has(account.id)),
    ],
    customers: data.customers ?? additions.customers,
    suppliers: data.suppliers ?? additions.suppliers,
    agents: data.agents ?? additions.agents,
    sales: (data.sales ?? additions.sales).map((sale, index) => ({
      ...sale,
      agentId: sale.agentId ?? additions.agents[index % additions.agents.length].id,
    })),
    receipts: data.receipts ?? additions.receipts,
    expenses: data.expenses ?? additions.expenses,
    purchases: data.purchases ?? additions.purchases,
    supplierPayments: data.supplierPayments ?? additions.supplierPayments,
    transfers: data.transfers ?? additions.transfers,
  };
}

export function loadData() {
  mkdirSync(dirname(dataPath), { recursive: true });
  try {
    const data = migrateData(JSON.parse(readFileSync(dataPath, "utf8")));
    saveData(data);
    return data;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Could not read accounting data: ${error.message}`, {
        cause: error,
      });
    }
    const data = createSeedData();
    saveData(data);
    return data;
  }
}

export function saveData(data) {
  mkdirSync(dirname(dataPath), { recursive: true });
  const temporaryPath = `${dataPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, dataPath);
}
