import express from "express";
import { randomUUID } from "node:crypto";
import {
  buildDashboard,
  createAccountOpeningJournal,
  createTransactionJournal,
  getOutstanding,
  getPurchaseOutstanding,
  normalizeDocumentLineItems,
} from "./accounting.js";
import { initializeDatabase, saveData } from "./database.js";
import {
  authenticate,
  createUser,
  ensureBootstrapAdmin,
  getSession,
  login,
  logout,
  publicUser,
  recordAudit,
  requireRole,
} from "./auth.js";
import { formatLocalDate } from "./store.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
let data;
let writeQueue = Promise.resolve();
const accountTypes = new Set(["asset", "liability", "equity", "income", "expense"]);
const liquidKinds = new Set(["cash", "bank"]);

app.use(express.json({ limit: "32kb" }));

function fail(response, status, message) {
  return response.status(status).json({ error: message });
}

function validDate(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function amountToCents(value, { allowZero = false } = {}) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(\.\d{1,2})?$/.test(String(value))
  ) {
    return null;
  }
  const [whole, fraction = ""] = String(value).split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && (allowZero ? cents >= 0 : cents > 0)
    ? cents
    : null;
}

async function persist(nextData, request, action, target) {
  const auditedData = recordAudit(nextData, request.authUser, action, target);
  await saveData(auditedData);
  data = auditedData;
}

function withJournalEntry(nextData, sourceType, record) {
  const journalEntry = createTransactionJournal(nextData, sourceType, record);
  return {
    ...nextData,
    journalEntries: [...(nextData.journalEntries ?? []), journalEntry],
  };
}

function withMutationLock(handler) {
  return async (request, response, next) => {
    const previousWrite = writeQueue;
    let releaseWrite;
    writeQueue = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    await previousWrite;
    try {
      await handler(request, response, next);
    } finally {
      releaseWrite();
    }
  };
}

function nextReference(records, prefix, firstNumber) {
  const largestNumber = records
    .filter((record) => !record.isOpeningBalance && record.reference.startsWith(`${prefix}-`))
    .reduce((largest, record) => {
      const number = Number(record.reference.slice(prefix.length + 1));
      return Number.isSafeInteger(number) ? Math.max(largest, number) : largest;
    }, firstNumber - 1);
  const nextNumber = Math.max(firstNumber, largestNumber + 1);
  return `${prefix}-${nextNumber}`;
}

function liquidAccount(accountId) {
  return data.accounts.find(
    (account) =>
      account.id === accountId &&
      account.active !== false &&
      (account.kind === "cash" || account.kind === "bank"),
  );
}

function balanceAt(accountId, date) {
  const dashboard = buildDashboard(data, date, date);
  return dashboard.accounts.find((account) => account.id === accountId)?.balanceCents;
}

function shortText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= maxLength;
}

function createEntity(collection, label) {
  return withMutationLock(async (request, response) => {
    const {
      name,
      phone = "",
      code = "",
      email = "",
      address = "",
      billingAddress = "",
      creditLimit = "0",
      paymentTermsDays = 0,
      taxNumber = "",
      openingBalance = "0",
    } = request.body;
    const creditLimitCents = amountToCents(creditLimit, { allowZero: true });
    const openingBalanceCents = amountToCents(openingBalance, { allowZero: true });
    if (!shortText(name, 100) ||
      typeof phone !== "string" || phone.length > 40 ||
      typeof email !== "string" || email.length > 254 ||
      typeof address !== "string" || address.length > 300 ||
      typeof billingAddress !== "string" || billingAddress.length > 300 ||
      typeof taxNumber !== "string" || taxNumber.length > 80 ||
      (code && !shortText(code, 30)) ||
      !Number.isInteger(Number(paymentTermsDays)) || Number(paymentTermsDays) < 0 ||
      Number(paymentTermsDays) > 3650 ||
      (creditLimitCents === null) || (openingBalanceCents === null)) {
      return fail(response, 400, `Enter valid ${label} details, amounts, and payment terms.`);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(response, 400, "Enter a valid email address.");
    }
    if (
      data[collection].some(
        (item) => item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
      )
    ) {
      return fail(response, 409, `A ${label} with that name already exists.`);
    }
    if (code && data[collection].some((item) => item.code?.toLowerCase() === code.trim().toLowerCase())) {
      return fail(response, 409, `A ${label} with that code already exists.`);
    }
    const entity = {
      id: randomUUID(),
      code: code.trim(),
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      ...(collection === "customers"
        ? { billingAddress: billingAddress.trim(), creditLimitCents, openingBalanceCents }
        : { address: address.trim(), taxNumber: taxNumber.trim(), openingBalanceCents }),
      paymentTermsDays: Number(paymentTermsDays),
    };
    const openingRecord = openingBalanceCents > 0
      ? collection === "customers"
        ? {
            id: `opening-${entity.id}`,
            reference: `OB-${entity.code || entity.id.slice(0, 8)}`,
            customerId: entity.id,
            agentId: null,
            date: formatLocalDate(),
            description: "Opening balance",
            amountCents: openingBalanceCents,
            isOpeningBalance: true,
          }
        : collection === "suppliers"
          ? {
              id: `opening-${entity.id}`,
              reference: `OB-${entity.code || entity.id.slice(0, 8)}`,
              supplierId: entity.id,
              date: formatLocalDate(),
              description: "Opening balance",
              amountCents: openingBalanceCents,
              isOpeningBalance: true,
            }
          : null
      : null;
    const openingCollection = collection === "customers"
      ? "sales"
      : collection === "suppliers"
        ? "purchases"
        : null;
    const nextData = {
      ...data,
      [collection]: [...data[collection], entity],
      ...(openingRecord && openingCollection
        ? { [openingCollection]: [...data[openingCollection], openingRecord] }
        : {}),
    };
    await persist(
      openingRecord && openingCollection
        ? withJournalEntry(
            nextData,
            openingCollection === "sales" ? "sale" : "purchase",
            openingRecord,
          )
        : nextData,
      request,
      `${collection}.created`,
      entity.id,
    );
    return response.status(201).json(entity);
  });
}

app.get("/api/auth/session", (request, response) => getSession(request, response, data));
app.post("/api/auth/login", withMutationLock((request, response) => login(request, response, data)));
app.post("/api/auth/logout", (request, response) => logout(request, response));
app.use((request, response, next) => {
  request.data = data;
  return authenticate(request, response, next);
});

app.get("/api/company", (request, response) => response.json(data.company));
app.put("/api/company", requireRole("admin"), withMutationLock(async (request, response) => {
  const { name, address = "", baseCurrency, financialYearStart, dateFormat, tax, inventoryMethod, numbering } = request.body;
  if (!shortText(name, 120) || typeof address !== "string" || address.length > 500) {
    return fail(response, 400, "Enter a company name and an address up to 500 characters.");
  }
  if (!/^[A-Z]{3}$/.test(baseCurrency)) {
    return fail(response, 400, "Base currency must be a three-letter ISO currency code, such as LKR.");
  }
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(financialYearStart)) {
    return fail(response, 400, "Financial year start must use MM-DD format.");
  }
  if (!["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"].includes(dateFormat)) {
    return fail(response, 400, "Choose a supported date format.");
  }
  if (!tax || typeof tax.enabled !== "boolean" ||
      typeof tax.country !== "string" || tax.country.length > 80 ||
      typeof tax.registrationNumber !== "string" || tax.registrationNumber.length > 80 ||
      !Number.isFinite(Number(tax.ratePercent)) || Number(tax.ratePercent) < 0 || Number(tax.ratePercent) > 100) {
    return fail(response, 400, "Enter valid tax settings. The tax rate must be between 0 and 100.");
  }
  if (!["FIFO", "WEIGHTED_AVERAGE"].includes(inventoryMethod)) {
    return fail(response, 400, "Choose FIFO or weighted average for inventory.");
  }
  if (!numbering ||
      !shortText(numbering.invoicePrefix, 12) ||
      !shortText(numbering.billPrefix, 12) ||
      !Number.isSafeInteger(Number(numbering.nextInvoiceNumber)) || Number(numbering.nextInvoiceNumber) < 1 ||
      !Number.isSafeInteger(Number(numbering.nextBillNumber)) || Number(numbering.nextBillNumber) < 1) {
    return fail(response, 400, "Enter valid numbering prefixes and next numbers.");
  }
  const company = {
    name: name.trim(),
    address: address.trim(),
    baseCurrency,
    financialYearStart,
    dateFormat,
    tax: {
      enabled: tax.enabled,
      country: tax.country.trim(),
      registrationNumber: tax.registrationNumber.trim(),
      ratePercent: Number(tax.ratePercent),
    },
    inventoryMethod,
    numbering: {
      invoicePrefix: numbering.invoicePrefix.trim(),
      nextInvoiceNumber: Number(numbering.nextInvoiceNumber),
      billPrefix: numbering.billPrefix.trim(),
      nextBillNumber: Number(numbering.nextBillNumber),
    },
  };
  await persist({ ...data, company }, request, "company.updated", "company");
  return response.json(company);
}));

app.get("/api/users", requireRole("admin"), (request, response) => {
  return response.json(data.users.map(publicUser));
});
app.post("/api/users", requireRole("admin"), withMutationLock(async (request, response) => {
  try {
    const created = await createUser(data, request.body, request.authUser.email);
    data = created.data;
    return response.status(201).json(created.user);
  } catch (error) {
    return fail(response, 400, error.message);
  }
}));
app.get("/api/audit-log", requireRole("admin", "accountant"), (request, response) => {
  return response.json(data.auditLog);
});

app.get("/api/dashboard", (request, response) => {
  const { from, to } = request.query;
  if (!validDate(from) || !validDate(to) || from > to) {
    return fail(response, 400, "Choose a valid date range.");
  }
  return response.json({ ...buildDashboard(data, from, to), company: data.company });
});

app.get("/api/journal-entries", requireRole("admin", "accountant"), (request, response) => {
  const { from, to } = request.query;
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    return fail(response, 400, "Choose a valid journal date range.");
  }
  const entries = data.journalEntries ?? [];
  return response.json(entries.filter((entry) =>
    (!from || entry.date >= from) && (!to || entry.date <= to)));
});

app.post("/api/accounts", requireRole("admin", "accountant"), withMutationLock(async (request, response) => {
  const {
    code = "",
    name,
    type,
    kind = "category",
    parentAccountId = "",
    active = true,
    controlAccount = false,
    openingBalance = "0",
  } = request.body;
  const openingBalanceCents = amountToCents(openingBalance, { allowZero: true });
  if (!shortText(name, 100)) {
    return fail(response, 400, "Enter an account name (up to 100 characters).");
  }
  if ((code && !shortText(code, 30)) ||
      (code && data.accounts.some((account) => account.code?.toLowerCase() === code.trim().toLowerCase())) ||
      typeof active !== "boolean" || typeof controlAccount !== "boolean") {
    return fail(response, 400, "Enter a unique account code and valid account status.");
  }
  if (!accountTypes.has(type)) {
    return fail(response, 400, "Choose a valid chart-of-accounts type.");
  }
  if ((type === "asset" && !new Set(["cash", "bank", "category"]).has(kind)) ||
      (type !== "asset" && kind !== "category")) {
    return fail(response, 400, "Only asset accounts can be cash or bank accounts.");
  }
  if (!openingBalanceCents && openingBalanceCents !== 0) {
    return fail(response, 400, "Opening balance must be a non-negative amount with up to 2 decimals.");
  }
  const parentAccount = parentAccountId
    ? data.accounts.find((account) => account.id === parentAccountId && account.active !== false)
    : null;
  if (parentAccountId && (!parentAccount || parentAccount.type !== type)) {
    return fail(response, 400, "Choose an active parent account with the same account type.");
  }
  if (data.accounts.some((account) => account.name.toLowerCase() === name.trim().toLowerCase())) {
    return fail(response, 409, "An account with that name already exists.");
  }

  const typePrefix = { asset: "1", liability: "2", equity: "3", income: "4", expense: "5" }[type];
  const usedCodes = new Set(data.accounts.map((account) => account.code));
  let codeNumber = Number(typePrefix) * 1000;
  while (usedCodes.has(String(codeNumber))) codeNumber += 10;
  const account = {
    id: randomUUID(),
    code: code.trim() || String(codeNumber),
    name: name.trim(),
    type,
    kind,
    openingBalanceCents,
    parentAccountId: parentAccount?.id ?? null,
    active,
    controlAccount,
  };
  const nextData = { ...data, accounts: [...data.accounts, account] };
  if (openingBalanceCents > 0) {
    nextData.journalEntries = [
      ...(data.journalEntries ?? []),
      createAccountOpeningJournal(nextData, account),
    ];
  }
  await persist(nextData, request, "account.created", account.id);
  return response.status(201).json(account);
}));

app.patch("/api/accounts/:id", requireRole("admin", "accountant"), withMutationLock(async (request, response) => {
  if (typeof request.body.active !== "boolean") {
    return fail(response, 400, "Choose whether the account should be active.");
  }
  const account = data.accounts.find((item) => item.id === request.params.id);
  if (!account) return fail(response, 404, "Account not found.");
  const updatedAccount = { ...account, active: request.body.active };
  const accounts = data.accounts.map((item) => item.id === account.id ? updatedAccount : item);
  await persist({ ...data, accounts }, request, "account.status_changed", account.id);
  return response.json(updatedAccount);
}));

app.post("/api/customers", requireRole("admin", "accountant"), createEntity("customers", "customer"));
app.post("/api/suppliers", requireRole("admin", "accountant"), createEntity("suppliers", "supplier"));
app.post("/api/agents", requireRole("admin", "accountant"), createEntity("agents", "agent"));

app.post("/api/sales", requireRole("admin", "accountant", "clerk"), withMutationLock(async (request, response) => {
  const { customerId, agentId = "", date, description = "", amount, lineItems } = request.body;
  if (!data.customers.some((customer) => customer.id === customerId)) {
    return fail(response, 400, "Choose an existing customer.");
  }
  if (agentId && !data.agents.some((agent) => agent.id === agentId)) {
    return fail(response, 400, "Choose an existing agent.");
  }
  if (!validDate(date)) return fail(response, 400, "Enter a valid sale date.");
  if (typeof description !== "string" || description.length > 160) {
    return fail(response, 400, "Description must be 160 characters or fewer.");
  }
  const submittedAmountCents = amount === undefined || amount === "" ? null : amountToCents(amount);
  if (amount !== undefined && amount !== "" && !submittedAmountCents) {
    return fail(response, 400, "Enter an amount greater than zero with up to 2 decimals.");
  }
  let normalizedItems;
  try {
    normalizedItems = normalizeDocumentLineItems(lineItems, description.trim() || "Sale", submittedAmountCents);
  } catch (lineItemError) {
    return fail(response, 400, lineItemError.message);
  }
  const amountCents = normalizedItems.reduce((total, item) => total + item.totalCents, 0);
  if (submittedAmountCents !== null && submittedAmountCents !== amountCents) {
    return fail(response, 400, "Sale amount must match the line item total.");
  }

  const sale = {
    id: randomUUID(),
    reference: nextReference(
      data.sales,
      data.company.numbering.invoicePrefix,
      data.company.numbering.nextInvoiceNumber,
    ),
    customerId,
    agentId: agentId || null,
    date,
    description: description.trim() || "Sale",
    amountCents,
    lineItems: normalizedItems,
  };
  await persist(withJournalEntry({
    ...data,
    company: {
      ...data.company,
      numbering: {
        ...data.company.numbering,
        nextInvoiceNumber: Number(sale.reference.slice(data.company.numbering.invoicePrefix.length + 1)) + 1,
      },
    },
    sales: [...data.sales, sale],
  }, "sale", sale), request, "sale.created", sale.id);
  return response.status(201).json(sale);
}));

app.post("/api/receipts", requireRole("admin", "accountant", "clerk"), withMutationLock(async (request, response) => {
  const { saleId, accountId, date, amount } = request.body;
  const sale = data.sales.find((item) => item.id === saleId);
  const account = liquidAccount(accountId);
  const amountCents = amountToCents(amount);

  if (!sale) return fail(response, 404, "Sale not found.");
  if (!account) return fail(response, 400, "Choose a cash or bank account.");
  if (!validDate(date)) return fail(response, 400, "Enter a valid receipt date.");
  if (!amountCents) {
    return fail(response, 400, "Enter an amount greater than zero with up to 2 decimals.");
  }
  if (date < sale.date) return fail(response, 400, "Receipt date cannot be before the sale date.");
  if (amountCents > getOutstanding(sale, data.receipts)) {
    return fail(response, 400, "Receipt cannot be more than the sale's outstanding balance.");
  }

  const receipt = {
    id: randomUUID(),
    saleId,
    customerId: sale.customerId,
    accountId,
    date,
    amountCents,
  };
  await persist(withJournalEntry(
    { ...data, receipts: [...data.receipts, receipt] },
    "receipt",
    receipt,
  ), request, "receipt.created", receipt.id);
  return response.status(201).json(receipt);
}));

app.post("/api/expenses", requireRole("admin", "accountant"), withMutationLock(async (request, response) => {
  const { accountId, date, category, description = "", amount } = request.body;
  const amountCents = amountToCents(amount);
  if (!liquidAccount(accountId)) return fail(response, 400, "Choose a cash or bank account.");
  if (!validDate(date)) return fail(response, 400, "Enter a valid expense date.");
  if (!amountCents) {
    return fail(response, 400, "Enter an amount greater than zero with up to 2 decimals.");
  }
  if (
    !shortText(category, 80) ||
    typeof description !== "string" ||
    description.length > 160
  ) {
    return fail(response, 400, "Enter a category (up to 80 characters) and a short description.");
  }
  if (amountCents > balanceAt(accountId, date)) {
    return fail(response, 400, "This expense is greater than the account's available balance.");
  }

  const expense = {
    id: randomUUID(),
    accountId,
    date,
    category: category.trim(),
    description: description.trim(),
    amountCents,
  };
  await persist(withJournalEntry(
    { ...data, expenses: [...data.expenses, expense] },
    "expense",
    expense,
  ), request, "expense.created", expense.id);
  return response.status(201).json(expense);
}));

app.post("/api/purchases", requireRole("admin", "accountant", "clerk"), withMutationLock(async (request, response) => {
  const { supplierId, date, description = "", amount, lineItems } = request.body;
  if (!data.suppliers.some((supplier) => supplier.id === supplierId)) {
    return fail(response, 400, "Choose an existing supplier.");
  }
  if (!validDate(date)) return fail(response, 400, "Enter a valid purchase date.");
  if (typeof description !== "string" || description.length > 160) {
    return fail(response, 400, "Description must be 160 characters or fewer.");
  }
  const submittedAmountCents = amount === undefined || amount === "" ? null : amountToCents(amount);
  if (amount !== undefined && amount !== "" && !submittedAmountCents) {
    return fail(response, 400, "Enter an amount greater than zero with up to 2 decimals.");
  }
  let normalizedItems;
  try {
    normalizedItems = normalizeDocumentLineItems(lineItems, description.trim() || "Purchase", submittedAmountCents);
  } catch (lineItemError) {
    return fail(response, 400, lineItemError.message);
  }
  const amountCents = normalizedItems.reduce((total, item) => total + item.totalCents, 0);
  if (submittedAmountCents !== null && submittedAmountCents !== amountCents) {
    return fail(response, 400, "Bill amount must match the line item total.");
  }

  const purchase = {
    id: randomUUID(),
    reference: nextReference(
      data.purchases,
      data.company.numbering.billPrefix,
      data.company.numbering.nextBillNumber,
    ),
    supplierId,
    date,
    description: description.trim() || "Purchase",
    amountCents,
    lineItems: normalizedItems,
  };
  await persist(withJournalEntry({
    ...data,
    company: {
      ...data.company,
      numbering: {
        ...data.company.numbering,
        nextBillNumber: Number(purchase.reference.slice(data.company.numbering.billPrefix.length + 1)) + 1,
      },
    },
    purchases: [...data.purchases, purchase],
  }, "purchase", purchase), request, "purchase.created", purchase.id);
  return response.status(201).json(purchase);
}));

app.post("/api/supplier-payments", requireRole("admin", "accountant", "clerk"), withMutationLock(async (request, response) => {
  const { purchaseId, accountId, date, amount } = request.body;
  const purchase = data.purchases.find((item) => item.id === purchaseId);
  const account = liquidAccount(accountId);
  const amountCents = amountToCents(amount);
  if (!purchase) return fail(response, 404, "Supplier bill not found.");
  if (!account) return fail(response, 400, "Choose a cash or bank account.");
  if (!validDate(date)) return fail(response, 400, "Enter a valid payment date.");
  if (!amountCents) {
    return fail(response, 400, "Enter an amount greater than zero with up to 2 decimals.");
  }
  if (date < purchase.date) {
    return fail(response, 400, "Payment date cannot be before the supplier bill date.");
  }
  if (amountCents > getPurchaseOutstanding(purchase, data.supplierPayments)) {
    return fail(response, 400, "Payment cannot be more than the bill's outstanding balance.");
  }
  if (amountCents > balanceAt(accountId, date)) {
    return fail(response, 400, "This payment is greater than the account's available balance.");
  }

  const payment = {
    id: randomUUID(),
    purchaseId,
    supplierId: purchase.supplierId,
    accountId,
    date,
    amountCents,
  };
  await persist(withJournalEntry(
    { ...data, supplierPayments: [...data.supplierPayments, payment] },
    "supplier-payment",
    payment,
  ), request, "supplier-payment.created", payment.id);
  return response.status(201).json(payment);
}));

app.post("/api/transfers", requireRole("admin", "accountant"), withMutationLock(async (request, response) => {
  const { fromAccountId, toAccountId, date, amount } = request.body;
  const amountCents = amountToCents(amount);
  if (!liquidAccount(fromAccountId) || !liquidAccount(toAccountId)) {
    return fail(response, 400, "Choose cash or bank accounts for both sides of the transfer.");
  }
  if (fromAccountId === toAccountId) {
    return fail(response, 400, "Choose two different accounts for the transfer.");
  }
  if (!validDate(date)) return fail(response, 400, "Enter a valid transfer date.");
  if (!amountCents) {
    return fail(response, 400, "Enter an amount greater than zero with up to 2 decimals.");
  }
  if (amountCents > balanceAt(fromAccountId, date)) {
    return fail(response, 400, "This transfer is greater than the source account's available balance.");
  }

  const transfer = {
    id: randomUUID(),
    fromAccountId,
    toAccountId,
    date,
    amountCents,
  };
  await persist(withJournalEntry(
    { ...data, transfers: [...data.transfers, transfer] },
    "transfer",
    transfer,
  ), request, "transfer.created", transfer.id);
  return response.status(201).json(transfer);
}));

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return fail(response, 400, "Request body must be valid JSON.");
  }
  console.error(error);
  return fail(response, 500, "Something went wrong while processing the request.");
});

async function start() {
  data = await initializeDatabase();
  data = await ensureBootstrapAdmin(data);
  app.listen(port, () => {
    console.log(`Accounts API listening at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Could not start the Accounts API:", error);
  process.exitCode = 1;
});
