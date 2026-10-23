const debitNormalTypes = new Set(["asset", "expense"]);

function findAccount(data, preferredId, type) {
  return data.accounts.find((account) => account.id === preferredId && account.type === type) ??
    data.accounts.find((account) => account.type === type);
}

export function createJournalEntry(data, {
  id,
  date,
  reference = "",
  description,
  sourceType,
  sourceId,
  isOpeningBalance = false,
  lines,
}) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error("A journal entry must contain at least two lines.");
  }
  let debits = 0;
  let credits = 0;
  const validatedLines = lines.map((line) => {
    if (!data.accounts.some((account) => account.id === line.accountId) ||
        !Number.isSafeInteger(line.debitCents) || line.debitCents < 0 ||
        !Number.isSafeInteger(line.creditCents) || line.creditCents < 0 ||
        (line.debitCents === 0) === (line.creditCents === 0)) {
      throw new Error("Journal lines must reference an account and contain one positive debit or credit.");
    }
    debits += line.debitCents;
    credits += line.creditCents;
    return {
      accountId: line.accountId,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
    };
  });
  if (!Number.isSafeInteger(debits) || debits === 0 || debits !== credits) {
    throw new Error("Journal debits and credits must be equal and greater than zero.");
  }
  return {
    id,
    date,
    reference,
    description,
    sourceType,
    sourceId,
    isOpeningBalance,
    lines: validatedLines,
  };
}

function accountLine(accountId, debitCents, creditCents) {
  return { accountId, debitCents, creditCents };
}

export function normalizeDocumentLineItems(value, fallbackDescription, fallbackAmountCents) {
  if (value === undefined || value === null || value === "") {
    if (!Number.isSafeInteger(fallbackAmountCents) || fallbackAmountCents <= 0) {
      throw new Error("Enter a document total greater than zero.");
    }
    return [{
      description: fallbackDescription,
      quantityMilli: 1000,
      unitPriceCents: fallbackAmountCents,
      totalCents: fallbackAmountCents,
    }];
  }

  let items = value;
  if (typeof value === "string") {
    try {
      items = JSON.parse(value);
    } catch {
      throw new Error("Line items must be valid JSON.");
    }
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new Error("Add between 1 and 50 line items.");
  }

  let totalCents = 0;
  const normalizedItems = items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each line item must be an object.");
    }
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const quantityInput = String(item.quantity ?? "");
    const priceInput = String(item.unitPrice ?? "");
    if (!description || description.length > 120) {
      throw new Error("Each line item needs a description of up to 120 characters.");
    }
    if (!/^\d{1,6}(?:\.\d{1,3})?$/.test(quantityInput)) {
      throw new Error("Line item quantities must be greater than zero with up to 3 decimals.");
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceInput)) {
      throw new Error("Line item prices must be greater than zero with up to 2 decimals.");
    }
    const [wholeQuantity, fractionalQuantity = ""] = quantityInput.split(".");
    const quantityMilli = Number(wholeQuantity) * 1000 +
      Number(fractionalQuantity.padEnd(3, "0"));
    const [wholePrice, fractionalPrice = ""] = priceInput.split(".");
    const unitPriceCents = Number(wholePrice) * 100 +
      Number(fractionalPrice.padEnd(2, "0"));
    const lineTotalCents = Math.round(quantityMilli * unitPriceCents / 1000);
    if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 ||
        !Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 ||
        !Number.isSafeInteger(lineTotalCents) || lineTotalCents <= 0) {
      throw new Error("Line item quantities and prices must produce a positive valid amount.");
    }
    totalCents += lineTotalCents;
    if (!Number.isSafeInteger(totalCents)) {
      throw new Error("The document total is too large.");
    }
    return { description, quantityMilli, unitPriceCents, totalCents: lineTotalCents };
  });
  return normalizedItems;
}

export function createTransactionJournal(data, sourceType, record) {
  const openingEquity = findAccount(data, "opening-balance-equity", "equity");
  const receivables = findAccount(data, "receivables", "asset");
  const payables = findAccount(data, "payables", "liability");
  const liquid = (accountId) => data.accounts.find((account) =>
    account.id === accountId && (account.kind === "cash" || account.kind === "bank"));
  let lines;
  let isOpeningBalance = false;

  switch (sourceType) {
    case "sale": {
      const income = findAccount(data, "sales-income", "income");
      const debitAccount = receivables;
      const creditAccount = record.isOpeningBalance ? openingEquity : income;
      isOpeningBalance = Boolean(record.isOpeningBalance);
      lines = [
        accountLine(debitAccount?.id, record.amountCents, 0),
        accountLine(creditAccount?.id, 0, record.amountCents),
      ];
      break;
    }
    case "receipt":
      lines = [
        accountLine(liquid(record.accountId)?.id, record.amountCents, 0),
        accountLine(receivables?.id, 0, record.amountCents),
      ];
      break;
    case "expense": {
      const expense = data.accounts.find((account) =>
        account.type === "expense" &&
        account.name.toLocaleLowerCase() === record.category.toLocaleLowerCase()) ??
        findAccount(data, "general-expense", "expense");
      lines = [
        accountLine(expense?.id, record.amountCents, 0),
        accountLine(liquid(record.accountId)?.id, 0, record.amountCents),
      ];
      break;
    }
    case "purchase": {
      const inventory = findAccount(data, "inventory", "asset");
      const debitAccount = record.isOpeningBalance ? openingEquity : inventory;
      const creditAccount = payables;
      isOpeningBalance = Boolean(record.isOpeningBalance);
      lines = [
        accountLine(debitAccount?.id, record.amountCents, 0),
        accountLine(creditAccount?.id, 0, record.amountCents),
      ];
      break;
    }
    case "supplier-payment":
      lines = [
        accountLine(payables?.id, record.amountCents, 0),
        accountLine(liquid(record.accountId)?.id, 0, record.amountCents),
      ];
      break;
    case "transfer":
      lines = [
        accountLine(liquid(record.toAccountId)?.id, record.amountCents, 0),
        accountLine(liquid(record.fromAccountId)?.id, 0, record.amountCents),
      ];
      break;
    default:
      throw new Error(`Unsupported journal source type: ${sourceType}.`);
  }

  return createJournalEntry(data, {
    id: `journal-${sourceType}-${record.id}`,
    date: record.date,
    reference: record.reference ?? "",
    description: record.description || record.category || sourceType,
    sourceType,
    sourceId: record.id,
    isOpeningBalance,
    lines,
  });
}

export function createAccountOpeningJournal(data, account) {
  const amountCents = account.openingBalanceCents ?? 0;
  if (!amountCents) return null;
  const openingEquity = findAccount(data, "opening-balance-equity", "equity");
  const debitNormal = debitNormalTypes.has(account.type);
  return createJournalEntry(data, {
    id: `journal-account-opening-${account.id}`,
    date: "1970-01-01",
    reference: `OB-${account.code || account.id}`,
    description: `Opening balance: ${account.name}`,
    sourceType: "account-opening",
    sourceId: account.id,
    isOpeningBalance: true,
    lines: debitNormal
      ? [
          accountLine(account.id, amountCents, 0),
          accountLine(openingEquity?.id, 0, amountCents),
        ]
      : [
          accountLine(openingEquity?.id, amountCents, 0),
          accountLine(account.id, 0, amountCents),
        ],
  });
}

export function createJournalEntries(data) {
  const entries = data.accounts
    .map((account) => createAccountOpeningJournal(data, account))
    .filter(Boolean);
  for (const [sourceType, collection] of [
    ["sale", "sales"],
    ["receipt", "receipts"],
    ["expense", "expenses"],
    ["purchase", "purchases"],
    ["supplier-payment", "supplierPayments"],
    ["transfer", "transfers"],
  ]) {
    for (const record of data[collection] ?? []) {
      entries.push(createTransactionJournal(data, sourceType, record));
    }
  }
  return entries;
}

function buildMonthlyTrend(data, journalEntries, to) {
  const endMonth = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  const months = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(Date.UTC(
      endMonth.getUTCFullYear(),
      endMonth.getUTCMonth() - 5 + index,
      1,
    ));
    const key = monthDate.toISOString().slice(0, 7);
    return {
      month: key,
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(monthDate),
      incomeCents: 0,
      expenseCents: 0,
      cashFlowCents: 0,
    };
  });
  const monthlyTotals = new Map(months.map((month) => [month.month, month]));
  for (const entry of journalEntries) {
    if (entry.isOpeningBalance || entry.date > to) continue;
    const month = monthlyTotals.get(entry.date.slice(0, 7));
    if (!month) continue;
    for (const line of entry.lines) {
      const account = data.accounts.find((item) => item.id === line.accountId);
      if (account?.type === "income") {
        month.incomeCents += line.creditCents - line.debitCents;
      } else if (account?.type === "expense") {
        month.expenseCents += line.debitCents - line.creditCents;
      }
      if (account?.kind === "cash" || account?.kind === "bank") {
        month.cashFlowCents += line.debitCents - line.creditCents;
      }
    }
  }
  return months;
}

export function getOutstanding(sale, receipts) {
  const paidCents = receipts
    .filter((receipt) => receipt.saleId === sale.id)
    .reduce((total, receipt) => total + receipt.amountCents, 0);

  return Math.max(0, sale.amountCents - paidCents);
}

export function getPurchaseOutstanding(purchase, payments) {
  const paidCents = payments
    .filter((payment) => payment.purchaseId === purchase.id)
    .reduce((total, payment) => total + payment.amountCents, 0);

  return Math.max(0, purchase.amountCents - paidCents);
}

export function buildDashboard(data, from, to) {
  const journalEntries = data.journalEntries ?? createJournalEntries(data);
  const inRange = (entry) => entry.date >= from && entry.date <= to;
  const receipts = data.receipts.filter(inRange);
  const expenses = data.expenses.filter(inRange);
  const supplierPayments = data.supplierPayments.filter(inRange);
  const transfers = data.transfers.filter(inRange);
  const receiptsThroughEnd = data.receipts.filter((entry) => entry.date <= to);
  const supplierPaymentsThroughEnd = data.supplierPayments.filter(
    (entry) => entry.date <= to,
  );

  const accountTotals = new Map(data.accounts.map((account) => [account.id, 0]));
  const periodTotals = new Map(data.accounts.map((account) => [account.id, { debitCents: 0, creditCents: 0 }]));
  const earningsThroughEnd = new Map(data.accounts.map((account) => [account.id, 0]));
  for (const entry of journalEntries) {
    for (const line of entry.lines) {
      if (entry.date <= to) {
        const account = data.accounts.find((item) => item.id === line.accountId);
        const normalDebit = debitNormalTypes.has(account?.type);
        accountTotals.set(
          line.accountId,
          (accountTotals.get(line.accountId) ?? 0) +
            (normalDebit ? line.debitCents - line.creditCents : line.creditCents - line.debitCents),
        );
        if (account?.type === "income" || account?.type === "expense") {
          earningsThroughEnd.set(
            line.accountId,
            (earningsThroughEnd.get(line.accountId) ?? 0) +
              (account.type === "income"
                ? line.creditCents - line.debitCents
                : line.debitCents - line.creditCents),
          );
        }
      }
      if (inRange(entry) && !entry.isOpeningBalance) {
        const totals = periodTotals.get(line.accountId);
        if (totals) {
          totals.debitCents += line.debitCents;
          totals.creditCents += line.creditCents;
        }
      }
    }
  }
  const accounts = data.accounts.map((account) => {
    const balances = periodTotals.get(account.id);
    const periodActivityCents = account.type === "income"
      ? balances.creditCents - balances.debitCents
      : account.type === "expense"
        ? balances.debitCents - balances.creditCents
        : 0;
    return {
      ...account,
      balanceCents: accountTotals.get(account.id) ?? 0,
      periodActivityCents,
    };
  });
  const currentEarningsCents = accounts
    .filter((account) => account.type === "income" || account.type === "expense")
    .reduce((total, account) => total +
      (account.type === "income" ? 1 : -1) * (earningsThroughEnd.get(account.id) ?? 0), 0);
  accounts.push({
    id: "current-earnings",
    code: "",
    name: "Current earnings",
    type: "equity",
    kind: "category",
    active: true,
    isCalculated: true,
    balanceCents: currentEarningsCents,
  });
  const totalsByType = (type, rangeTotals = true) => accounts
    .filter((account) => account.type === type && !account.isCalculated)
    .reduce((total, account) => {
      if (!rangeTotals) return total + account.balanceCents;
      const balances = periodTotals.get(account.id);
      return total + (type === "income" ? balances.creditCents - balances.debitCents : balances.debitCents - balances.creditCents);
    }, 0);
  const journalAmount = (sourceType, side, accountPredicate = () => true) =>
    journalEntries
      .filter((entry) => entry.sourceType === sourceType && !entry.isOpeningBalance && inRange(entry))
      .reduce((total, entry) => total + entry.lines.reduce((entryTotal, line) => {
        const account = data.accounts.find((item) => item.id === line.accountId);
        return accountPredicate(account) ? entryTotal + line[side] : entryTotal;
      }, 0), 0);
  const liquidAccountPredicate = (account) =>
    account?.kind === "cash" || account?.kind === "bank";

  const outstanding = data.sales
    .filter((sale) => sale.date <= to)
    .map((sale) => {
      const customer = data.customers.find((item) => item.id === sale.customerId);
      const agent = data.agents.find((item) => item.id === sale.agentId);
      const paidCents = receiptsThroughEnd
        .filter((receipt) => receipt.saleId === sale.id)
        .reduce((total, receipt) => total + receipt.amountCents, 0);
      return {
        ...sale,
        customerName: customer?.name ?? "Unknown customer",
        agentName: agent?.name ?? "Unassigned",
        paidCents,
        dueCents: Math.max(0, sale.amountCents - paidCents),
      };
    })
    .filter((sale) => sale.dueCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const supplierOutstanding = data.purchases
    .filter((purchase) => purchase.date <= to)
    .map((purchase) => {
      const supplier = data.suppliers.find(
        (item) => item.id === purchase.supplierId,
      );
      const paidCents = supplierPaymentsThroughEnd
        .filter((payment) => payment.purchaseId === purchase.id)
        .reduce((total, payment) => total + payment.amountCents, 0);
      return {
        ...purchase,
        supplierName: supplier?.name ?? "Unknown supplier",
        paidCents,
        dueCents: Math.max(0, purchase.amountCents - paidCents),
      };
    })
    .filter((purchase) => purchase.dueCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const agentOutstanding = data.agents
    .map((agent) => {
      const agentSales = outstanding.filter((sale) => sale.agentId === agent.id);
      return {
        ...agent,
        openSales: agentSales.length,
        dueCents: agentSales.reduce((total, sale) => total + sale.dueCents, 0),
      };
    })
    .filter((agent) => agent.openSales > 0)
    .sort((a, b) => b.dueCents - a.dueCents);

  const activities = [
    ...data.sales.filter(inRange).map((sale) => ({
      id: sale.id,
      date: sale.date,
      type: sale.isOpeningBalance ? "opening-balance" : "sale",
      description: `Sale to ${data.customers.find((item) => item.id === sale.customerId)?.name ?? "customer"}${sale.description ? ` · ${sale.description}` : ""}`,
      reference: sale.reference ?? "",
      accountName: "Customer receivables",
      amountCents: sale.amountCents,
      lineItems: sale.lineItems ?? [],
    })),
    ...receipts.map((receipt) => ({
      id: receipt.id,
      date: receipt.date,
      type: "receipt",
      description: `Payment from ${data.customers.find((item) => item.id === receipt.customerId)?.name ?? "customer"}`,
      reference: data.sales.find((sale) => sale.id === receipt.saleId)?.reference ?? "",
      accountName:
        data.accounts.find((account) => account.id === receipt.accountId)?.name ??
        "Account",
      amountCents: receipt.amountCents,
    })),
    ...expenses.map((expense) => ({
      id: expense.id,
      date: expense.date,
      type: "expense",
      description: expense.description || expense.category,
      reference: "",
      accountName:
        data.accounts.find((account) => account.id === expense.accountId)?.name ??
        "Account",
      amountCents: expense.amountCents,
    })),
    ...supplierPayments.map((payment) => ({
      id: payment.id,
      date: payment.date,
      type: "supplier-payment",
      description: `Payment to ${data.suppliers.find((item) => item.id === payment.supplierId)?.name ?? "supplier"}`,
      accountName:
        data.accounts.find((account) => account.id === payment.accountId)?.name ??
        "Account",
      amountCents: payment.amountCents,
    })),
    ...transfers.map((transfer) => ({
      id: transfer.id,
      date: transfer.date,
      type: "transfer",
      description: `Transfer to ${data.accounts.find((account) => account.id === transfer.toAccountId)?.name ?? "account"}`,
      accountName:
        data.accounts.find((account) => account.id === transfer.fromAccountId)?.name ??
        "Account",
      amountCents: transfer.amountCents,
    })),
  ]
    .concat(data.purchases.filter(inRange).map((purchase) => ({
      id: purchase.id,
      date: purchase.date,
      type: purchase.isOpeningBalance ? "opening-balance" : "purchase",
      description: `Bill from ${data.suppliers.find((item) => item.id === purchase.supplierId)?.name ?? "supplier"}${purchase.description ? ` · ${purchase.description}` : ""}`,
      reference: purchase.reference ?? "",
      accountName: "Inventory",
      amountCents: purchase.amountCents,
      lineItems: purchase.lineItems ?? [],
    })))
    .map((activity) => ({ ...activity, reference: activity.reference ?? "" }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  return {
    from,
    to,
    accounts,
    customers: data.customers,
    suppliers: data.suppliers,
    agents: data.agents,
    sales: data.sales,
    purchases: data.purchases,
    outstanding,
    supplierOutstanding,
    agentOutstanding,
    activities,
    monthlyTrend: buildMonthlyTrend(data, journalEntries, to),
    totals: {
      receivedCents: journalAmount("receipt", "debitCents", liquidAccountPredicate),
      salesCents: journalAmount("sale", "creditCents", (account) => account?.type === "income"),
      spentCents: journalAmount("expense", "creditCents", liquidAccountPredicate),
      purchasesCents: journalAmount("purchase", "debitCents", (account) => account?.type === "asset"),
      incomeCents: totalsByType("income"),
      expenseCents: totalsByType("expense"),
      netProfitCents: totalsByType("income") - totalsByType("expense"),
      assetCents: totalsByType("asset", false),
      liabilityCents: totalsByType("liability", false),
      equityCents: totalsByType("equity", false) + currentEarningsCents,
      supplierPaidCents: journalAmount("supplier-payment", "creditCents", liquidAccountPredicate),
      outstandingCents: outstanding.reduce(
        (total, sale) => total + sale.dueCents,
        0,
      ),
      supplierOutstandingCents: supplierOutstanding.reduce(
        (total, purchase) => total + purchase.dueCents,
        0,
      ),
      balanceCents: accounts
        .filter((account) => account.kind === "cash" || account.kind === "bank")
        .reduce((total, account) => total + account.balanceCents, 0),
    },
  };
}
