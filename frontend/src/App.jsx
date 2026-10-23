import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = localDateISO();
const monthStart = `${today.slice(0, 8)}01`;
const periodPresets = [
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "three-months", label: "3 months" },
  { id: "six-months", label: "6 months" },
  { id: "year", label: "Year to date" },
];
const transactionFilters = [
  { value: "all", label: "All activity" },
  { value: "sale", label: "Sales" },
  { value: "receipt", label: "Customer payments" },
  { value: "expense", label: "Expenses" },
  { value: "purchase", label: "Supplier bills" },
  { value: "supplier-payment", label: "Supplier payments" },
  { value: "transfer", label: "Transfers" },
  { value: "opening-balance", label: "Opening balances" },
];
let currencyCode = "LKR";
let dateFormat = "YYYY-MM-DD";
const currencyFormatters = new Map();
const accountTypes = ["asset", "liability", "equity", "income", "expense"];
const entryPaths = {
  sales: "sales",
  receipts: "receipts",
  expenses: "expenses",
  purchases: "purchases",
  "supplier-payments": "supplier-payments",
  transfers: "transfers",
  accounts: "accounts",
  customers: "customers",
  suppliers: "suppliers",
  agents: "agents",
};
const modalInfo = {
  sales: ["Create a sale", "Add an invoice to a customer's account."],
  receipts: ["Record a customer payment", "Apply a payment to an open customer sale."],
  expenses: ["Record an expense", "Record money paid from cash or bank."],
  purchases: ["Record a supplier bill", "Record a credit purchase to track what you owe."],
  "supplier-payments": ["Pay a supplier", "Apply a payment to an open supplier bill."],
  transfers: ["Transfer between accounts", "Move money between cash and bank without treating it as income."],
  accounts: ["Add chart account", "Add a new account or bookkeeping category."],
  customers: ["Add customer", "Create a customer record for sales."],
  suppliers: ["Add supplier", "Create a supplier record for purchases."],
  agents: ["Add agent", "Create a sales agent for agent-wise outstanding reports."],
};
const typeLabels = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};
const pages = {
  overview: {
    label: "Overview",
    description: "A clear snapshot of your cash, sales and outstanding balances.",
  },
  "balance-sheet": {
    label: "Balance sheet",
    description: "Review your assets, liabilities and equity through the selected date.",
  },
  "profit-loss": {
    label: "Profit & loss",
    description: "Review income, expenses and net profit from posted journal entries.",
  },
  transactions: {
    label: "Transactions",
    description: "Review receipts, spending, supplier payments and transfers.",
  },
  outstanding: {
    label: "Customers",
    description: "Keep track of open customer invoices and payments due.",
  },
  suppliers: {
    label: "Suppliers",
    description: "Review supplier bills and amounts still to be paid.",
  },
  agents: {
    label: "Agent report",
    description: "See customer balances grouped by the sales agent.",
  },
  accounts: {
    label: "Chart of accounts",
    description: "Manage account codes, parent accounts, control status and opening balances.",
  },
  company: {
    label: "Company setup",
    description: "Configure your company, accounting defaults, users and access roles.",
  },
};
const pageActions = {
  overview: ["sales", "New sale"],
  "balance-sheet": ["accounts", "Add account"],
  "profit-loss": ["expenses", "Record expense"],
  transactions: ["sales", "New sale"],
  outstanding: ["receipts", "Record payment"],
  suppliers: ["purchases", "New supplier bill"],
  agents: ["agents", "Add agent"],
  accounts: ["accounts", "Add account"],
  company: ["", ""],
};

function money(cents = 0) {
  let formatter = currencyFormatters.get(currencyCode);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(currencyCode, formatter);
  }
  return formatter.format(cents / 100);
}

function shortDate(date) {
  const [year, month, day] = date.split("-");
  if (dateFormat === "DD/MM/YYYY") return `${day}/${month}/${year}`;
  if (dateFormat === "MM/DD/YYYY") return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}

function getPresetRange(preset, currentDate = new Date()) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const end = localDateISO(currentDate);
  if (preset === "last-month") {
    return {
      from: localDateISO(new Date(year, month - 1, 1)),
      to: localDateISO(new Date(year, month, 0)),
    };
  }
  if (preset === "three-months" || preset === "six-months") {
    const monthsBack = preset === "three-months" ? 2 : 5;
    return { from: localDateISO(new Date(year, month - monthsBack, 1)), to: end };
  }
  if (preset === "year") return { from: `${year}-01-01`, to: end };
  return { from: localDateISO(new Date(year, month, 1)), to: end };
}

function getHeaderInsight(page, dashboard, loading, range) {
  if (loading) return "Refreshing your figures for the selected period.";
  if (!dashboard) return "Record your first entry to see a live summary of your books.";

  const { totals } = dashboard;
  const outstandingCount = dashboard.outstanding.length;
  const supplierBillCount = dashboard.supplierOutstanding.length;

  switch (page) {
    case "overview":
      return `As of ${shortDate(range.to)}, ${money(totals.balanceCents)} is held across cash and bank. ${outstandingCount} customer invoices (${money(totals.outstandingCents)}) and ${supplierBillCount} supplier bills (${money(totals.supplierOutstandingCents)}) are still open.`;
    case "balance-sheet":
      return `${dashboard.accounts.filter((account) => account.type === "asset" && !account.isCalculated).length} asset, ${dashboard.accounts.filter((account) => account.type === "liability" && !account.isCalculated).length} liability and ${dashboard.accounts.filter((account) => account.type === "equity" && !account.isCalculated).length} equity accounts are included through ${shortDate(range.to)}.`;
    case "profit-loss":
      return `For this period, posted income is ${money(totals.incomeCents)} and posted expenses are ${money(totals.expenseCents)}, for net profit of ${money(totals.netProfitCents)}.`;
    case "transactions":
      return `This period includes ${money(totals.receivedCents)} received from customers, ${money(totals.spentCents)} in operating expenses and ${money(totals.supplierPaidCents)} paid to suppliers.`;
    case "outstanding":
      return `${outstandingCount} customer invoices remain open, with ${money(totals.outstandingCents)} still to collect through ${shortDate(range.to)}.`;
    case "suppliers":
      return `${supplierBillCount} supplier bills remain open, with ${money(totals.supplierOutstandingCents)} still to pay through ${shortDate(range.to)}.`;
    case "agents": {
      const openAgents = dashboard.agentOutstanding.length;
      const openSales = dashboard.agentOutstanding.reduce((total, agent) => total + agent.openSales, 0);
      const agentPhrase = openAgents === 1 ? "1 sales agent has" : `${openAgents} sales agents have`;
      return `${agentPhrase} ${openSales} open sales, representing ${money(totals.outstandingCents)} in customer balances.`;
    }
    case "accounts":
      return `${dashboard.accounts.filter((account) => !account.isCalculated).length} accounts are organized across ${accountTypes.length} account types, including ${dashboard.accounts.filter((account) => account.kind === "cash" || account.kind === "bank").length} cash and bank accounts.`;
    default:
      return "Your finance workspace is ready.";
  }
}

function groupBalances(items, getLabel) {
  const groups = new Map();
  items.forEach((item) => {
    const label = getLabel(item);
    groups.set(label, (groups.get(label) ?? 0) + item.dueCents);
  });
  return Array.from(groups, ([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function getVisualizations(page, dashboard, range) {
  if (!dashboard) return [];
  const totals = dashboard.totals;
  const moneyChart = (title, description, items) => ({
    type: "bars",
    title,
    description,
    unit: "money",
    items,
  });

  switch (page) {
    case "overview":
      return [
        {
          type: "trend",
          title: "Your financial pulse",
          description: `Six-month view of recognized income, expenses and net cash movement through ${shortDate(range.to)}`,
          items: dashboard.monthlyTrend ?? [],
        },
        moneyChart("Cash movement", "Payments received and cash paid during the selected period", [
          { label: "Customer receipts", value: totals.receivedCents },
          { label: "Operating expenses", value: totals.spentCents },
          { label: "Supplier payments", value: totals.supplierPaidCents },
        ]),
        {
          type: "donut",
          title: "Outstanding balance mix",
          description: "Amounts due through the selected end date",
          unit: "money",
          items: [
            { label: "Customer dues", value: totals.outstandingCents },
            { label: "Supplier bills", value: totals.supplierOutstandingCents },
          ],
        },
      ];
    case "balance-sheet":
      return [{
        type: "bars",
        title: "Accounts by class",
        description: "Number of chart-of-accounts records in each class",
        unit: "count",
        items: ["asset", "liability", "equity"].map((type) => ({
          label: typeLabels[type],
          value: dashboard.accounts.filter((account) => account.type === type).length,
        })),
      }];
    case "profit-loss":
      return [moneyChart("Profit & loss", "Income and expenses posted in the selected period", [
        { label: "Income recognized", value: totals.incomeCents },
        { label: "Expenses posted", value: totals.expenseCents },
      ])];
    case "transactions":
      return [moneyChart("Money movement", "Transfers are excluded; they do not change total cash", [
        { label: "Customer receipts", value: totals.receivedCents },
        { label: "Operating expenses", value: totals.spentCents },
        { label: "Supplier payments", value: totals.supplierPaidCents },
      ])];
    case "outstanding":
      return [moneyChart("Largest customer balances", "Open invoices grouped by customer", groupBalances(
        dashboard.outstanding,
        (sale) => sale.customerName,
      ))];
    case "suppliers":
      return [moneyChart("Largest supplier balances", "Open bills grouped by supplier", groupBalances(
        dashboard.supplierOutstanding,
        (bill) => bill.supplierName,
      ))];
    case "agents":
      return [moneyChart("Balances by sales agent", "Customer dues assigned to each agent", dashboard.agentOutstanding
        .slice(0, 5)
        .map((agent) => ({ label: agent.name, value: agent.dueCents })))];
    case "accounts":
      return [{
        type: "donut",
        title: "Chart of accounts mix",
        description: "Number of accounts in each bookkeeping category",
        unit: "count",
        items: accountTypes.map((type) => ({
          label: typeLabels[type],
          value: dashboard.accounts.filter((account) => account.type === type).length,
        })),
      }];
    default:
      return [];
  }
}

function VisualizationCard({ chart }) {
  const maxValue = Math.max(...chart.items.map((item) => item.value ?? 0), 1);

  return <section className={`panel visualization-card ${chart.type === "trend" ? "trend-card" : ""}`}>
    <div className="panel-heading">
      <div><h2>{chart.title}</h2><p>{chart.description}</p></div>
      <span className="visualization-type">{chart.type === "donut" ? "Breakdown" : chart.type === "trend" ? "6 months" : "Comparison"}</span>
    </div>
    {chart.type === "trend"
      ? <MonthlyTrendChart chart={chart} />
      : chart.items.some((item) => item.value > 0)
      ? chart.type === "donut"
        ? <DonutChart chart={chart} />
        : <div className="bar-chart" role="img" aria-label={`${chart.title}: ${chart.items.map((item) => `${item.label}, ${chart.unit === "money" ? money(item.value) : item.value}`).join("; ")}`}>
          {chart.items.map((item, index) => <div className="bar-chart-row" key={item.label}>
            <div className="bar-chart-label"><span className={`chart-swatch chart-color-${index % 5}`} />{item.label}</div>
            <div className="bar-chart-value">{chart.unit === "money" ? money(item.value) : item.value}</div>
            <div className="bar-chart-track"><span className={`chart-bar chart-color-${index % 5}`} style={{ width: `${(item.value / maxValue) * 100}%` }} /></div>
          </div>)}
        </div>
      : <div className="chart-empty">No data to display for this selection.</div>}
  </section>;
}

function MonthlyTrendChart({ chart }) {
  const width = 720;
  const height = 250;
  const padding = { top: 18, right: 22, bottom: 38, left: 22 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const series = [
    { key: "incomeCents", label: "Income", color: "#168b91" },
    { key: "expenseCents", label: "Expenses", color: "#d1a34f" },
    { key: "cashFlowCents", label: "Net cash flow", color: "#7776b8" },
  ];
  const values = chart.items.flatMap((month) => series.map((item) => month[item.key]));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values, 1);
  const range = max - min || 1;
  const y = (value) => padding.top + ((max - value) / range) * plotHeight;
  const x = (index) => padding.left +
    (chart.items.length < 2 ? plotWidth / 2 : (index / (chart.items.length - 1)) * plotWidth);
  const zeroY = y(0);

  return <div className="trend-chart">
    <div className="trend-legend">
      {series.map((item) => <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}</span>)}
    </div>
    <svg
      className="trend-plot"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${chart.title}: ${chart.items.map((month) => `${month.label}: income ${money(month.incomeCents)}, expenses ${money(month.expenseCents)}, net cash flow ${money(month.cashFlowCents)}`).join("; ")}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const gridY = padding.top + fraction * plotHeight;
        return <line className="trend-gridline" key={fraction} x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} />;
      })}
      <line className="trend-zero-line" x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} />
      {series.map((item) => {
        const points = chart.items.map((month, index) => `${x(index)},${y(month[item.key])}`).join(" ");
        return <g key={item.key}>
          <polyline className="trend-line" points={points} style={{ stroke: item.color }} />
          {chart.items.map((month, index) => <circle
            className="trend-point"
            key={month.month}
            cx={x(index)}
            cy={y(month[item.key])}
            r="4"
            style={{ fill: item.color }}
          ><title>{`${month.label} ${item.label}: ${money(month[item.key])}`}</title></circle>)}
        </g>;
      })}
      {chart.items.map((month, index) => <text
        className="trend-month"
        key={month.month}
        x={x(index)}
        y={height - 10}
        textAnchor="middle"
      >{month.label}</text>)}
    </svg>
    {!values.some((value) => value !== 0) && <div className="trend-empty">Your monthly activity will appear here as you record transactions.</div>}
  </div>;
}

function DonutChart({ chart }) {
  const positiveItems = chart.items.filter((item) => item.value > 0);
  const total = positiveItems.reduce((sum, item) => sum + item.value, 0);
  const radius = 39;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return <div className="donut-chart" role="img" aria-label={`${chart.title}: ${chart.items.map((item) => `${item.label}, ${chart.unit === "money" ? money(item.value) : item.value}`).join("; ")}`}>
    <div className="donut-graphic">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="donut-track" cx="50" cy="50" r={radius} />
        {positiveItems.map((item, index) => {
          const segmentLength = (item.value / total) * circumference;
          const segment = <circle
            className={`donut-segment chart-color-${index % 5}`}
            cx="50"
            cy="50"
            r={radius}
            key={item.label}
            strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
            strokeDashoffset={-offset}
          />;
          offset += segmentLength;
          return segment;
        })}
      </svg>
      <div className="donut-total"><strong>{chart.unit === "money" ? money(total) : total}</strong><span>Total</span></div>
    </div>
    <div className="donut-legend">
      {chart.items.map((item, index) => <div className="donut-legend-row" key={item.label}>
        <span className={`chart-swatch chart-color-${index % 5}`} />
        <span className="donut-legend-label">{item.label}</span>
        <strong>{chart.unit === "money" ? money(item.value) : item.value}</strong>
      </div>)}
    </div>
  </div>;
}

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const text = await response.text();
  let result = null;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`Server returned an invalid response (${response.status}).`);
    }
  }
  if (!response.ok) throw new Error(result?.error || `Request failed (${response.status}).`);
  return result;
}

function Icon({ name, size = 20 }) {
  const paths = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    collapse: <><path d="M4 6h16M4 12h10M4 18h16" /><path d="m18 9-3 3 3 3" /></>,
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 6v12M8 7h8M8 11h8" /></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    down: <><path d="m7 10 5 5 5-5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M16 15h.01" /></>,
    receipt: <><path d="M4 3h16v18l-4-2-4 2-4-2-4 2z" /><path d="M8 8h8M8 12h8" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    transfer: <><path d="M7 7h14M17 3l4 4-4 4M17 17H3m4-4-4 4 4 4" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
    print: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function SelectOptions({ items = [], emptyLabel, noItemsLabel, valueKey = "id", labelKey = "name" }) {
  return <><option value="" disabled>{items.length ? emptyLabel : noItemsLabel ?? emptyLabel}</option>{items.map((item) => <option key={item[valueKey]} value={item[valueKey]}>{item[labelKey]}</option>)}</>;
}

function LoginScreen({ onLogin, error, loading }) {
  return <main className="login-screen">
    <form className="login-card" onSubmit={onLogin}>
      <div className="brand"><span className="brand-mark"><span /><span /><span /></span><span>ledgerly<span className="brand-dot">.</span></span></div>
      <h1>Sign in</h1>
      <p>Use the administrator account configured for this finance workspace.</p>
      <label>Email<input required name="email" type="email" autoComplete="username" /></label>
      <label>Password<input required name="password" type="password" autoComplete="current-password" /></label>
      {error && <div className="modal-error" role="alert">{error}</div>}
      <button className="primary-button" type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
    </form>
  </main>;
}

function App() {
  const [activePage, setActivePage] = useState(() => {
    const hash = window.location.hash.slice(1);
    return Object.hasOwn(pages, hash) ? hash : "overview";
  });
  const [range, setRange] = useState({ from: monthStart, to: today });
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [loginSaving, setLoginSaving] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState("");
  const [documentView, setDocumentView] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [accountType, setAccountType] = useState("asset");
  const [accountKind, setAccountKind] = useState("cash");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionFilter, setTransactionFilter] = useState("all");
  const [transactionPage, setTransactionPage] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 800px)").matches);
  const navigationToggleRef = useRef(null);
  const sidebarRef = useRef(null);
  const previousMobileNavOpen = useRef(false);
  currencyCode = dashboard?.company?.baseCurrency ?? "LKR";
  dateFormat = dashboard?.company?.dateFormat ?? "YYYY-MM-DD";
  const visualizations = loading ? [] : getVisualizations(activePage, dashboard, range);
  const selectedPeriod = periodPresets.find(({ id }) => {
    const preset = getPresetRange(id);
    return preset.from === range.from && preset.to === range.to;
  })?.id;

  useEffect(() => {
    api("/api/auth/session")
      .then((result) => setSession(result.user))
      .catch(() => setSession(null))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    function syncPage() {
      const hash = window.location.hash.slice(1);
      setActivePage(Object.hasOwn(pages, hash) ? hash : "overview");
      window.scrollTo(0, 0);
    }

    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    document.title = `Ledgerly | ${pages[activePage].label}`;
  }, [activePage]);

  useEffect(() => {
    setTransactionPage(0);
  }, [range, transactionFilter, transactionSearch]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 800px)");
    const syncViewport = () => {
      setIsMobile(mediaQuery.matches);
      if (!mediaQuery.matches) setMobileNavOpen(false);
    };
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (mobileNavOpen && isMobile) {
      sidebarRef.current?.querySelector(".nav-item")?.focus();
    } else if (previousMobileNavOpen.current) {
      navigationToggleRef.current?.focus();
    }
    previousMobileNavOpen.current = mobileNavOpen;
  }, [isMobile, mobileNavOpen]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(range);
      setDashboard(await api(`/api/dashboard?${query}`));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    if (session) refresh();
  }, [refresh, session]);

  async function handleLogin(event) {
    event.preventDefault();
    setLoginSaving(true);
    setLoginError("");
    const credentials = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      setSession(result.user);
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setLoginSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setSession(null);
      setDashboard(null);
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  const pendingSales = useMemo(() => dashboard?.outstanding ?? [], [dashboard]);
  const pendingPurchases = useMemo(() => dashboard?.supplierOutstanding ?? [], [dashboard]);
  const liquidAccounts = useMemo(
    () => dashboard?.accounts.filter((account) => account.active !== false && (account.kind === "cash" || account.kind === "bank")) ?? [],
    [dashboard],
  );
  const accountsByType = useMemo(
    () => Object.fromEntries(accountTypes.map((type) => [
      type,
      dashboard?.accounts.filter((account) => account.type === type && !account.isCalculated) ?? [],
    ])),
    [dashboard],
  );

  const balanceSheet = useMemo(() => {
    const assets = dashboard?.accounts.filter((account) => account.type === "asset") ?? [];
    const liabilities = dashboard?.accounts.filter((account) => account.type === "liability") ?? [];
    const equity = dashboard?.accounts.filter((account) => account.type === "equity") ?? [];
    const assetTotal = assets.reduce((total, account) => total + account.balanceCents, 0);
    const liabilityTotal = liabilities.reduce((total, account) => total + account.balanceCents, 0);
    const equityTotal = equity.reduce((total, account) => total + account.balanceCents, 0);

    return {
      assets,
      liabilities,
      equity,
      assetTotal,
      liabilityTotal,
      equityTotal,
      totalEquityAndLiabilities: liabilityTotal + equityTotal,
    };
  }, [dashboard]);
  const filteredTransactions = useMemo(() => {
    const query = transactionSearch.trim().toLocaleLowerCase();
    return (dashboard?.activities ?? []).filter((activity) => {
      if (transactionFilter !== "all" && activity.type !== transactionFilter) return false;
      if (!query) return true;
      return [
        activity.description,
        activity.reference,
        activity.accountName,
        activityLabel(activity.type),
        money(activity.amountCents),
        activity.date,
        ...(activity.lineItems ?? []).map((line) => line.description),
      ].some((value) => String(value ?? "").toLocaleLowerCase().includes(query));
    });
  }, [dashboard, transactionFilter, transactionSearch]);
  const transactionPageSize = 25;
  const transactionPageCount = Math.ceil(filteredTransactions.length / transactionPageSize);
  const visibleTransactions = filteredTransactions.slice(
    transactionPage * transactionPageSize,
    (transactionPage + 1) * transactionPageSize,
  );

  const [requestedAction, requestedActionLabel] = pageActions[activePage];
  const clerkActions = new Set(["sales", "receipts", "purchases", "supplier-payments"]);
  const actionModal = !session || session.role === "read_only" ||
    (session.role === "clerk" && !clerkActions.has(requestedAction))
    ? ""
    : requestedAction;
  const actionLabel = requestedActionLabel;

  if (authLoading) {
    return <main className="login-screen"><div className="login-card">Connecting to your secure workspace...</div></main>;
  }
  if (!session) {
    return <LoginScreen onLogin={handleLogin} error={loginError} loading={loginSaving} />;
  }

  async function submitEntry(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    if (modal === "accounts") {
      values.active = form.has("active");
      values.controlAccount = form.has("controlAccount");
    }
    setSaving(true);
    setError("");
    try {
      await api(`/api/${entryPaths[modal]}`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setModal("");
      setToast(`${modalInfo[modal][0]} saved`);
      window.setTimeout(() => setToast(""), 2800);
      await refresh();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function openDocument(activity) {
    const type = activity.type === "sale" ? "sale" : activity.type === "purchase" ? "purchase" : "";
    if (!type) return;
    const records = type === "sale" ? dashboard?.sales : dashboard?.purchases;
    const record = records?.find((item) => item.id === activity.id);
    if (!record) {
      setError("This document is no longer available. Refresh the page and try again.");
      return;
    }
    const party = type === "sale"
      ? dashboard.customers.find((item) => item.id === record.customerId)
      : dashboard.suppliers.find((item) => item.id === record.supplierId);
    const outstanding = type === "sale" ? dashboard.outstanding : dashboard.supplierOutstanding;
    const dueCents = outstanding.find((item) => item.id === record.id)?.dueCents ?? 0;
    setDocumentView({ type, record, party, dueCents });
  }

  function exportTransactions() {
    downloadCsv(`ledgerly-transactions-${range.from}-to-${range.to}.csv`, [
      "Date", "Type", "Reference", "Description", "Account", "Amount", "Line items",
    ], filteredTransactions.map((item) => [
      item.date,
      activityLabel(item.type),
      item.reference,
      item.description,
      item.accountName,
      (item.amountCents / 100).toFixed(2),
      (item.lineItems ?? []).map((line) =>
        `${line.description} (${formatQuantity(line.quantityMilli)} x ${(line.unitPriceCents / 100).toFixed(2)})`,
      ).join("; "),
    ]));
  }

  function openModal(name) {
    if (name === "accounts") {
      setAccountType("asset");
      setAccountKind("cash");
    }
    setError("");
    setModal(name);
  }

  async function setAccountActive(account) {
    setError("");
    try {
      await api(`/api/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: account.active === false }),
      });
      await refresh();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  function toggleNavigation() {
    if (isMobile) {
      setMobileNavOpen((open) => !open);
      return;
    }
    setSidebarCollapsed((collapsed) => !collapsed);
  }

  return (
    <div className={`app-shell ${sidebarCollapsed && !isMobile ? "sidebar-collapsed" : ""} ${mobileNavOpen && isMobile ? "mobile-nav-open" : ""}`}>
      <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation menu" aria-hidden={!mobileNavOpen} tabIndex={mobileNavOpen ? 0 : -1} onClick={() => setMobileNavOpen(false)} />
      <aside ref={sidebarRef} id="main-navigation-sidebar" className={`sidebar ${sidebarCollapsed && !isMobile ? "collapsed" : ""} ${mobileNavOpen && isMobile ? "mobile-open" : ""}`}>
        <a className="brand" href="#overview" aria-label="Ledgerly home"><span className="brand-mark"><span /><span /><span /></span><span>ledgerly<span className="brand-dot">.</span></span></a>
        <div className="workspace-label">FINANCE WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation" onClick={(event) => {
          if (event.target.closest("a")) setMobileNavOpen(false);
        }}>
          <div className="nav-section">
            <span className="nav-section-label">INSIGHTS</span>
            <a className={`nav-item ${activePage === "overview" ? "active" : ""}`} href="#overview" aria-label="Overview" aria-current={activePage === "overview" ? "page" : undefined} title="Overview"><Icon name="overview" /><span>Overview</span></a>
            <a className={`nav-item ${activePage === "balance-sheet" ? "active" : ""}`} href="#balance-sheet" aria-label="Balance sheet" aria-current={activePage === "balance-sheet" ? "page" : undefined} title="Balance sheet"><Icon name="book" /><span>Balance sheet</span></a>
            <a className={`nav-item ${activePage === "profit-loss" ? "active" : ""}`} href="#profit-loss" aria-label="Profit and loss" aria-current={activePage === "profit-loss" ? "page" : undefined} title="Profit & loss"><Icon name="chart" /><span>Profit &amp; loss</span></a>
            <a className={`nav-item ${activePage === "transactions" ? "active" : ""}`} href="#transactions" aria-label="Transactions" aria-current={activePage === "transactions" ? "page" : undefined} title="Transactions"><Icon name="receipt" /><span>Transactions</span></a>
          </div>
          <div className="nav-section">
            <span className="nav-section-label">PEOPLE &amp; SETUP</span>
            <a className={`nav-item ${activePage === "outstanding" ? "active" : ""}`} href="#outstanding" aria-label="Customers" aria-current={activePage === "outstanding" ? "page" : undefined} title="Customers"><Icon name="people" /><span>Customers</span></a>
            <a className={`nav-item ${activePage === "suppliers" ? "active" : ""}`} href="#suppliers" aria-label="Suppliers" aria-current={activePage === "suppliers" ? "page" : undefined} title="Suppliers"><Icon name="receipt" /><span>Suppliers</span></a>
            <a className={`nav-item ${activePage === "agents" ? "active" : ""}`} href="#agents" aria-label="Agent report" aria-current={activePage === "agents" ? "page" : undefined} title="Agent report"><Icon name="people" /><span>Agent report</span></a>
            <a className={`nav-item ${activePage === "accounts" ? "active" : ""}`} href="#accounts" aria-label="Chart of accounts" aria-current={activePage === "accounts" ? "page" : undefined} title="Chart of accounts"><Icon name="wallet" /><span>Chart of accounts</span></a>
            {session.role === "admin" && <a className={`nav-item ${activePage === "company" ? "active" : ""}`} href="#company" aria-label="Company setup" aria-current={activePage === "company" ? "page" : undefined} title="Company setup"><Icon name="book" /><span>Company setup</span></a>}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon">?</div><strong>Learning workspace</strong><p>Try sample entries and see how account balances change.</p><a href="#accounts">Explore accounts <span>→</span></a></div>
        <div className="profile"><div className="avatar">{session.name.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{session.name}</strong><span>{session.role.replace("_", " ")}</span></div><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={handleLogout}><Icon name="close" size={17} /></button></div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="topbar-brandbar">
            <div className="topbar-brand-group">
              <button ref={navigationToggleRef} className="navigation-toggle" type="button" onClick={toggleNavigation} aria-label={isMobile ? (mobileNavOpen ? "Close navigation" : "Open navigation") : (sidebarCollapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar")} aria-expanded={isMobile ? mobileNavOpen : !sidebarCollapsed} aria-controls="main-navigation-sidebar">
                <Icon name={isMobile && mobileNavOpen ? "close" : isMobile || sidebarCollapsed ? "menu" : "collapse"} size={19} />
              </button>
              <div className="topbar-kicker"><span className="header-brand-mark"><span /><span /><span /></span> LEDGERLY <i /> BUSINESS FINANCE</div>
            </div>
            <div className="topbar-identity">
              <span className="header-status"><span className="live-dot" /> Company workspace</span>
              <div className="header-user"><div className="top-avatar" aria-label={`${session.name} profile`}>{session.name.slice(0, 1).toUpperCase()}</div><span>{session.name}<br /><small>{session.role.replace("_", " ")}</small></span></div>
            </div>
          </div>
          <div className="topbar-main">
            <div className="topbar-heading">
              <div className="breadcrumb">Workspace <span>/</span> <strong>{pages[activePage].label}</strong></div>
              <h1>{pages[activePage].label}</h1>
              <p>{pages[activePage].description}</p>
              <div className="header-insight">
                <span className="header-insight-mark" aria-hidden="true">✦</span>
                <div className="header-insight-copy"><span>LIVE BUSINESS INSIGHT</span><p>{getHeaderInsight(activePage, dashboard, loading, range)}</p></div>
              </div>
            </div>
          </div>
          <div className="topbar-toolbar">
            <div className="toolbar-copy">
              <span>REPORTING PERIOD</span>
              <strong>{shortDate(range.from)} <i /> {shortDate(range.to)}</strong>
              <small>Use the date range to filter report activity.</small>
            </div>
            <div className="period-presets" role="group" aria-label="Quick reporting periods">
              {periodPresets.map((preset) => <button
                className={`period-preset ${selectedPeriod === preset.id ? "active" : ""}`}
                key={preset.id}
                type="button"
                aria-pressed={selectedPeriod === preset.id}
                onClick={() => setRange(getPresetRange(preset.id))}
              >{preset.label}</button>)}
            </div>
            <div className="toolbar-actions">
              <label className="date-control header-date-control"><Icon name="calendar" size={17} /><span className="sr-only">Start date</span><input aria-label="Start date" type="date" value={range.from} max={range.to} onChange={(event) => setRange({ ...range, from: event.target.value })} /><span className="date-divider">—</span><span className="sr-only">End date</span><input aria-label="End date" type="date" value={range.to} min={range.from} max={today} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
              {actionModal && <button className="primary-button" onClick={() => openModal(actionModal)}><Icon name="plus" size={18} /> {actionLabel}</button>}
            </div>
          </div>
        </header>
        <section className="page-wrap">
          {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}

          {activePage === "overview" && <div className="summary-grid">
            <SummaryCard featured title="TOTAL CASH & BANK" value={loading ? null : dashboard?.totals.balanceCents} hint="Available across liquid accounts" icon="wallet" />
            <SummaryCard title="INCOME EARNED" value={loading ? null : dashboard?.totals.incomeCents} hint="In selected period" icon="receipt" />
            <SummaryCard title="MONEY RECEIVED" value={loading ? null : dashboard?.totals.receivedCents} hint="In selected period" icon="arrow" />
            <SummaryCard title="MONEY SPENT" value={loading ? null : dashboard?.totals.spentCents} hint="Operating expenses paid" icon="arrow" />
            <SummaryCard title="CUSTOMERS OWE" value={loading ? null : dashboard?.totals.outstandingCents} hint={`${dashboard?.outstanding.length ?? 0} open sales`} icon="people" />
            <SummaryCard title="OWED TO SUPPLIERS" value={loading ? null : dashboard?.totals.supplierOutstandingCents} hint={`${dashboard?.supplierOutstanding.length ?? 0} open bills`} icon="receipt" />
          </div>}

          {visualizations.length > 0 && <div className={`visualization-grid ${visualizations.length === 1 ? "single-visualization" : ""}`}>
            {visualizations.map((chart) => <VisualizationCard chart={chart} key={chart.title} />)}
          </div>}

          {activePage === "overview" && <div className="content-grid">
            <section className="panel account-panel" id="account-balances">
              <div className="panel-heading"><div><h2>Cash and bank balances</h2><p>Balances calculated from dated journal entries</p></div><button className="subtle-button" onClick={() => openModal("transfers")}><Icon name="transfer" size={15} /> Transfer</button></div>
              <div className="account-list">
                {liquidAccounts.map((account, index) => <div className="account-row" key={account.id}><div className={`account-symbol ${index % 2 ? "bank-symbol" : "cash-symbol"}`}><Icon name={account.kind === "cash" ? "wallet" : "book"} size={19} /></div><div className="account-meta"><strong>{account.name}</strong><span>{account.kind === "cash" ? "Cash in hand" : "Bank account"}</span></div><div className="account-balance">{money(account.balanceCents)}</div><span className="account-arrow"><Icon name="arrow" size={15} /></span></div>)}
                {!liquidAccounts.length && !loading && <div className="empty-state">Add a cash or bank account to start recording payments.</div>}
              </div>
              <div className="account-total"><span>Total cash &amp; bank</span><strong>{money(dashboard?.totals.balanceCents)}</strong></div>
              <div className="account-note"><span className="note-check">✓</span> Balances through {shortDate(range.to)}. Transfers move money, not income.</div>
            </section>
            <section className="panel quick-panel">
              <div className="panel-heading"><div><h2>Quick actions</h2><p>Record important bookkeeping entries</p></div><span className="sparkle">✳</span></div>
              <div className="quick-actions">
                {session.role !== "read_only" && <QuickAction icon="arrow" styleName="receipt-bg" title="Customer payment" hint="Money received against a sale" onClick={() => openModal("receipts")} />}
                {session.role !== "read_only" && <QuickAction icon="receipt" styleName="sale-bg" title="Supplier bill" hint="Record a purchase on credit" onClick={() => openModal("purchases")} />}
                {session.role !== "read_only" && <QuickAction icon="arrow" styleName="expense-bg" title="Supplier payment" hint="Pay down an open supplier bill" onClick={() => openModal("supplier-payments")} />}
                {["admin", "accountant"].includes(session.role) && <QuickAction icon="transfer" styleName="transfer-bg" title="Account transfer" hint="Move cash to bank or back" onClick={() => openModal("transfers")} />}
              </div>
              <div className="quick-tip"><span>✦</span><p><strong>Keep it clear</strong> A supplier bill adds to what you owe. Paying it later reduces both the bill and the selected cash or bank account.</p></div>
            </section>
          </div>}

          {(activePage === "balance-sheet" || activePage === "profit-loss") && <div className="statement-grid single-column">
            {activePage === "balance-sheet" && <section className="panel statement-panel" id="balance-sheet">
              <div className="panel-heading"><div><h2>Balance sheet</h2><p>Assets, liabilities and equity snapshot</p></div><span className="period-label"><Icon name="book" size={14} /> {shortDate(range.from)} – {shortDate(range.to)}</span></div>
              <div className="statement-note">Balances are calculated from posted journal entries through the selected date. Current earnings are included in equity.</div>
              <div className="statement-block">
                <div className="statement-title">Assets</div>
                {(balanceSheet.assets ?? []).map((account) => (
                  <div className="statement-row" key={account.id}>
                    <span>{account.name}</span>
                    <strong>{money(account.balanceCents)}</strong>
                  </div>
                ))}
                <div className="statement-row total"><span>Total assets</span><strong>{money(balanceSheet.assetTotal)}</strong></div>
              </div>
              <div className="statement-block">
                <div className="statement-title">Liabilities &amp; equity</div>
                {(balanceSheet.liabilities ?? []).map((account) => (
                  <div className="statement-row" key={account.id}>
                    <span>{account.name}</span>
                    <strong>{money(account.balanceCents)}</strong>
                  </div>
                ))}
                {(balanceSheet.equity ?? []).map((account) => (
                  <div className="statement-row" key={account.id}>
                    <span>{account.name}</span>
                    <strong>{money(account.balanceCents)}</strong>
                  </div>
                ))}
                <div className="statement-row total"><span>Total liabilities &amp; equity</span><strong>{money(balanceSheet.totalEquityAndLiabilities)}</strong></div>
              </div>
            </section>}

            {activePage === "profit-loss" && <section className="panel statement-panel" id="profit-loss">
              <div className="panel-heading"><div><h2>Profit &amp; loss</h2><p>Income and expenses posted in the selected period</p></div><span className="period-label"><Icon name="chart" size={14} /> {shortDate(range.from)} – {shortDate(range.to)}</span></div>
              <div className="statement-block">
                <div className="statement-title">Income</div>
                {(dashboard?.accounts ?? []).filter((account) => account.type === "income" && account.periodActivityCents !== 0).map((account) => <div className="statement-row" key={account.id}><span>{account.name}</span><strong>{money(account.periodActivityCents)}</strong></div>)}
                {!dashboard?.accounts.some((account) => account.type === "income" && account.periodActivityCents !== 0) && <div className="statement-row"><span>No income recorded</span><strong>{money(0)}</strong></div>}
                <div className="statement-row total"><span>Total income</span><strong>{money(dashboard?.totals.incomeCents)}</strong></div>
              </div>
              <div className="statement-block">
                <div className="statement-title">Expenses</div>
                {(dashboard?.accounts ?? []).filter((account) => account.type === "expense" && account.periodActivityCents !== 0).map((account) => <div className="statement-row" key={account.id}><span>{account.name}</span><strong>{money(account.periodActivityCents)}</strong></div>)}
                {!dashboard?.accounts.some((account) => account.type === "expense" && account.periodActivityCents !== 0) && <div className="statement-row"><span>No expenses recorded</span><strong>{money(0)}</strong></div>}
                <div className="statement-row total"><span>Total expenses</span><strong>{money(dashboard?.totals.expenseCents)}</strong></div>
              </div>
              <div className="statement-block"><div className="statement-row total"><span>Net profit</span><strong>{money(dashboard?.totals.netProfitCents)}</strong></div></div>
              <div className="statement-note">Supplier bills are posted to inventory, not expensed, until item-level inventory costing is implemented.</div>
            </section>}
          </div>}

          <div className="module-page">
            {activePage === "transactions" && <section className="panel activity-panel transaction-panel" id="transactions">
              <div className="panel-heading"><div><h2>Transaction explorer</h2><p>Search and filter every sale, payment, bill, expense, and transfer in this period.</p></div><div className="transaction-heading-actions"><span className="period-label"><Icon name="calendar" size={14} /> {shortDate(range.from)} – {shortDate(range.to)}</span><button type="button" className="subtle-button export-button" onClick={exportTransactions}><Icon name="download" size={15} /> Export CSV</button></div></div>
              <div className="transaction-tools">
                <label className="transaction-search"><span className="sr-only">Search transactions</span><Icon name="search" size={17} /><input type="search" value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Search description, reference, account, or amount" /></label>
                <label className="transaction-filter-label"><span className="sr-only">Filter transactions by type</span><select value={transactionFilter} onChange={(event) => setTransactionFilter(event.target.value)}>{transactionFilters.map((filter) => <option value={filter.value} key={filter.value}>{filter.label}</option>)}</select></label>
                {(transactionSearch || transactionFilter !== "all") && <button type="button" className="clear-transaction-filters" onClick={() => { setTransactionSearch(""); setTransactionFilter("all"); }}>Clear filters</button>}
              </div>
              <div className="transaction-result-count" role="status">{filteredTransactions.length} {filteredTransactions.length === 1 ? "entry" : "entries"} found</div>
              <div className="table-wrap"><table><thead><tr><th>TRANSACTION</th><th>DATE</th><th>ACCOUNT</th><th>AMOUNT</th></tr></thead><tbody>
                {visibleTransactions.map((item) => <tr key={`${item.type}-${item.id}`}>
                  <td><span className={`transaction-type ${transactionTone(item.type)}`}><Icon name={item.type === "transfer" ? "transfer" : item.type === "sale" || item.type === "purchase" ? "receipt" : "arrow"} size={16} /></span><span className="transaction-name">{["sale", "purchase"].includes(item.type) ? <button type="button" className="document-link" onClick={() => openDocument(item)}>{item.description}</button> : item.description}<small>{activityLabel(item.type)}{item.reference ? ` · ${item.reference}` : ""}{["sale", "purchase"].includes(item.type) ? " · View document" : ""}</small></span></td>
                  <td className="date-cell">{shortDate(item.date)}</td>
                  <td><span className="account-pill">{item.accountName}</span></td>
                  <td className={`amount-cell ${transactionTone(item.type)}`}>{transactionSign(item.type)}{money(item.amountCents)}</td>
                </tr>)}
                {!visibleTransactions.length && <tr><td colSpan="4" className="table-empty">{transactionSearch || transactionFilter !== "all" ? "No entries match these filters." : "No transactions in this date range."}</td></tr>}
              </tbody></table></div>
              <div className="table-footer transaction-pagination">
                <span>Showing {filteredTransactions.length ? transactionPage * transactionPageSize + 1 : 0}–{Math.min((transactionPage + 1) * transactionPageSize, filteredTransactions.length)} of {filteredTransactions.length}</span>
                <div><button type="button" className="page-button" disabled={transactionPage === 0} onClick={() => setTransactionPage((page) => page - 1)}>Previous</button><span>Page {transactionPageCount ? transactionPage + 1 : 0} of {transactionPageCount}</span><button type="button" className="page-button" disabled={transactionPage + 1 >= transactionPageCount} onClick={() => setTransactionPage((page) => page + 1)}>Next</button></div>
              </div>
            </section>}
            {activePage === "outstanding" && <section className="panel due-panel" id="outstanding">
              <div className="panel-heading"><div><h2>Customer outstanding</h2><p>Open sales through {shortDate(range.to)}</p></div>{["admin", "accountant"].includes(session.role) && <button className="subtle-button" onClick={() => openModal("customers")}><Icon name="plus" size={15} /> Add customer</button>}</div>
              <div className="due-list">{pendingSales.slice(0, 5).map((sale, index) => <div className="due-row" key={sale.id}><div className={`customer-avatar avatar-${index % 4}`}>{sale.customerName.trim().charAt(0).toUpperCase()}</div><div className="due-meta"><strong>{sale.customerName}</strong><span>{sale.reference} · {sale.agentName}</span></div><div className="due-amount">{money(sale.dueCents)}<span>due</span></div></div>)}
                {!pendingSales.length && !loading && <div className="empty-state">No customer balances are outstanding.</div>}
              </div>
              {session.role !== "read_only" && <button className="collect-button" onClick={() => openModal("receipts")}><Icon name="plus" size={16} /> Record customer payment</button>}
            </section>}
            {activePage === "outstanding" && <section className="panel report-panel">
              <div className="panel-heading"><div><h2>Customer master</h2><p>Contacts, credit limits, terms and opening balances</p></div></div>
              <div className="table-wrap"><table><thead><tr><th>CODE / CUSTOMER</th><th>CONTACT</th><th>TERMS</th><th>CREDIT LIMIT</th><th>OPENING BALANCE</th></tr></thead><tbody>
                {(dashboard?.customers ?? []).map((customer) => <tr key={customer.id}><td>{customer.code || "—"} · {customer.name}</td><td>{customer.phone || customer.email || "—"}</td><td>{customer.paymentTermsDays ?? 0} days</td><td>{money(customer.creditLimitCents ?? 0)}</td><td>{money(customer.openingBalanceCents ?? 0)}</td></tr>)}
                {!dashboard?.customers.length && <tr><td colSpan="5" className="table-empty">No customers yet.</td></tr>}
              </tbody></table></div>
            </section>}
          </div>

          <div className="module-page">
            {activePage === "suppliers" && <section className="panel report-panel" id="suppliers">
              <div className="panel-heading"><div><h2>Supplier outstanding</h2><p>Credit bills still to be paid</p></div>{["admin", "accountant"].includes(session.role) && <button className="subtle-button" onClick={() => openModal("suppliers")}><Icon name="plus" size={15} /> Add supplier</button>}</div>
              <div className="report-list">{pendingPurchases.slice(0, 5).map((purchase, index) => <div className="report-row" key={purchase.id}><div className={`customer-avatar avatar-${index % 4}`}>{purchase.supplierName.trim().charAt(0).toUpperCase()}</div><div className="due-meta"><strong>{purchase.supplierName}</strong><span>{purchase.reference} · {shortDate(purchase.date)}</span></div><div className="due-amount">{money(purchase.dueCents)}<span>due</span></div></div>)}
                {!pendingPurchases.length && !loading && <div className="empty-state">No supplier bills are outstanding.</div>}
              </div>
              <div className="report-actions"><button className="collect-button" onClick={() => openModal("purchases")}><Icon name="plus" size={15} /> Record supplier bill</button><button className="collect-button" onClick={() => openModal("supplier-payments")}><Icon name="arrow" size={15} /> Pay supplier</button></div>
            </section>}
            {activePage === "suppliers" && <section className="panel report-panel">
              <div className="panel-heading"><div><h2>Supplier master</h2><p>Contact, payment terms, tax details and opening balances</p></div></div>
              <div className="table-wrap"><table><thead><tr><th>CODE / SUPPLIER</th><th>CONTACT</th><th>TERMS</th><th>TAX NUMBER</th><th>OPENING BALANCE</th></tr></thead><tbody>
                {(dashboard?.suppliers ?? []).map((supplier) => <tr key={supplier.id}><td>{supplier.code || "—"} · {supplier.name}</td><td>{supplier.phone || supplier.email || "—"}</td><td>{supplier.paymentTermsDays ?? 0} days</td><td>{supplier.taxNumber || "—"}</td><td>{money(supplier.openingBalanceCents ?? 0)}</td></tr>)}
                {!dashboard?.suppliers.length && <tr><td colSpan="5" className="table-empty">No suppliers yet.</td></tr>}
              </tbody></table></div>
            </section>}
            {activePage === "agents" && <section className="panel report-panel" id="agents">
              <div className="panel-heading"><div><h2>Agent outstanding report</h2><p>Customer balances grouped by sales agent</p></div>{["admin", "accountant"].includes(session.role) && <button className="subtle-button" onClick={() => openModal("agents")}><Icon name="plus" size={15} /> Add agent</button>}</div>
              <div className="report-list">{(dashboard?.agentOutstanding ?? []).map((agent, index) => <div className="report-row" key={agent.id}><div className={`customer-avatar avatar-${index % 4}`}>{agent.name.trim().charAt(0).toUpperCase()}</div><div className="due-meta"><strong>{agent.name}</strong><span>{agent.openSales} open {agent.openSales === 1 ? "sale" : "sales"}</span></div><div className="due-amount">{money(agent.dueCents)}<span>customer debt</span></div></div>)}
                {!dashboard?.agentOutstanding.length && !loading && <div className="empty-state">No outstanding sales are assigned to agents yet.</div>}
              </div>
              <div className="report-caption">This sample attributes customer debt to the agent recorded on each sale.</div>
            </section>}
          </div>

          {activePage === "accounts" && <section className="panel coa-panel" id="accounts">
            <div className="panel-heading"><div><h2>Chart of accounts</h2><p>Account codes, parents, control status, opening balances and activation status</p></div>{["admin", "accountant"].includes(session.role) && <button className="subtle-button" onClick={() => openModal("accounts")}><Icon name="plus" size={15} /> Add account</button>}</div>
            <div className="coa-grid">{accountTypes.map((type) => <div className="coa-group" key={type}><div className="coa-group-title"><span>{typeLabels[type]}</span><span>{accountsByType[type].length}</span></div>{accountsByType[type].map((account) => <div className="coa-row" key={account.id}><span className="account-code">{account.code}</span><span className="coa-account-name">{account.name}<small>{account.parentAccountId ? `Sub-account of ${dashboard.accounts.find((parent) => parent.id === account.parentAccountId)?.name ?? "account"}` : "Top-level account"}{account.controlAccount ? " · Control account" : ""}{account.active === false ? " · Inactive" : ""}</small></span><span className={`kind-tag ${account.kind}`}>{account.kind === "category" ? "Category" : account.kind}</span>{["admin", "accountant"].includes(session.role) && <button type="button" className="status-toggle" onClick={() => setAccountActive(account)}>{account.active === false ? "Activate" : "Deactivate"}</button>}</div>)}{!accountsByType[type].length && <div className="coa-empty">No accounts in this group</div>}</div>)}</div>
            <div className="account-note coa-note"><span className="note-check">i</span> Transactions post balanced journal entries. Opening balances are offset to Opening balance equity; unmatched expense categories post to General expenses.</div>
          </section>}
          {activePage === "company" && session.role === "admin" && <CompanySetup company={dashboard?.company} onSaved={(company) => setDashboard((current) => current ? { ...current, company } : current)} />}
          <footer className="page-footer">
            <div className="footer-main">
              <section className="footer-about">
                <div className="footer-brand">
                  <span className="footer-mark"><span /><span /><span /></span>
                  <div><strong>Ledgerly</strong><span>Business finance workspace</span></div>
                </div>
                <p>One place to record everyday money movement and understand what your business owns, owes and earns.</p>
                <span className="footer-learning"><i className="footer-status" /> Foundation release · {dashboard?.company?.baseCurrency ?? "LKR"}</span>
              </section>
              <nav className="footer-navigation" aria-label="Explore finance modules">
                <h2>Explore workspace</h2>
                <div>{Object.entries(pages).map(([page, details]) => <a key={page} href={`#${page}`} aria-current={activePage === page ? "page" : undefined}>{details.label}<span aria-hidden="true">↗</span></a>)}</div>
              </nav>
              <section className="footer-report">
                <h2>Your reporting window</h2>
                <div className="footer-date-range"><span>{shortDate(range.from)}</span><i /> <span>{shortDate(range.to)}</span></div>
                <p>Activity totals follow this date range. Cash and bank balances, customer dues and supplier bills are shown through the end date.</p>
                <div className="footer-currency"><span>Base currency</span><strong>{dashboard?.company?.baseCurrency ?? "LKR"} <small>{dashboard?.company?.name || "Set company name in Company setup"}</small></strong></div>
              </section>
            </div>
            <div className="footer-bottom">
              <span>© {new Date().getFullYear()} Ledgerly <i /> Created for bookkeeping practice and demonstration.</span>
              <a href="#overview">Return to overview <span aria-hidden="true">↑</span></a>
            </div>
          </footer>
        </section>
      </main>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(""); }}>
        <section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">BOOKKEEPING</span><h2 id="modal-title">{modalInfo[modal][0]}</h2><p>{modalInfo[modal][1]}</p></div><button className="icon-button close-button" onClick={() => setModal("")} aria-label="Close"><Icon name="close" /></button></div>
          <form onSubmit={submitEntry} className="entry-form">
            {modal === "sales" && <>
              <label>Customer<select required name="customerId" defaultValue=""><SelectOptions items={dashboard?.customers} emptyLabel="Select a customer" /></select></label>
              <label>Sales agent <select name="agentId" defaultValue=""><option value="">Unassigned</option><SelectOptions items={dashboard?.agents} emptyLabel="Select an agent" /></select></label>
              <label>Sale date<input required name="date" type="date" defaultValue={today} max={today} /></label>
              <LineItemsEditor label="Invoice items" />
              <label>Description<input name="description" maxLength="160" placeholder="e.g. Goods sale" /></label>
              <div className="form-hint"><Icon name="receipt" size={16} /> A sale adds to customer outstanding. Record a receipt when paid.</div>
            </>}
            {modal === "receipts" && <>
              <label>Open sale<select required name="saleId" defaultValue="" disabled={pendingSales.length === 0}><SelectOptions items={pendingSales.map((sale) => ({ ...sale, name: `${sale.customerName} · ${sale.reference} · ${money(sale.dueCents)} due` }))} emptyLabel="Choose a customer sale" noItemsLabel="No outstanding sales — add a customer and sale first" /></select></label>
              <AccountSelect accounts={liquidAccounts} name="accountId" label="Received into" />
              <label>Receipt date<input required name="date" type="date" defaultValue={today} max={today} /></label><AmountField label="Amount received" />
              <div className="form-hint"><Icon name="wallet" size={16} /> {pendingSales.length > 0 && liquidAccounts.length > 0
                ? `Example: choose “${pendingSales[0].customerName} · ${pendingSales[0].reference} · ${money(pendingSales[0].dueCents)} due”, then “${liquidAccounts[0].name}”. Enter up to ${money(pendingSales[0].dueCents)}.`
                : pendingSales.length === 0
                  ? "To see sale choices, add a customer and record a sale first."
                  : "To see account choices, add a cash or bank account in Chart of accounts."} The payment reduces the sale due and increases the selected account.</div>
            </>}
            {modal === "expenses" && <>
              <AccountSelect accounts={liquidAccounts} name="accountId" label="Paid from" />
              <label>Expense date<input required name="date" type="date" defaultValue={today} max={today} /></label>
              <label>Category<input required name="category" maxLength="80" placeholder="e.g. Transport, rent, supplies" /></label>
              <AmountField label="Amount paid" /><label>Description<input name="description" maxLength="160" placeholder="What was this payment for?" /></label>
            </>}
            {modal === "purchases" && <>
              <label>Supplier<select required name="supplierId" defaultValue=""><SelectOptions items={dashboard?.suppliers} emptyLabel="Select a supplier" /></select></label>
              <label>Bill date<input required name="date" type="date" defaultValue={today} max={today} /></label>
              <LineItemsEditor label="Bill items" /><label>Description<input name="description" maxLength="160" placeholder="Optional note for this bill" /></label>
              <div className="form-hint"><Icon name="receipt" size={16} /> This records what you owe; it does not immediately reduce cash or bank.</div>
            </>}
            {modal === "supplier-payments" && <>
              <label>Open supplier bill<select required name="purchaseId" defaultValue=""><SelectOptions items={pendingPurchases.map((purchase) => ({ ...purchase, name: `${purchase.supplierName} · ${purchase.reference} · ${money(purchase.dueCents)} due` }))} emptyLabel="Select an outstanding bill" /></select></label>
              <AccountSelect accounts={liquidAccounts} name="accountId" label="Paid from" />
              <label>Payment date<input required name="date" type="date" defaultValue={today} max={today} /></label><AmountField label="Amount paid" />
              <div className="form-hint"><Icon name="wallet" size={16} /> The payment reduces both the bill due and cash or bank.</div>
            </>}
            {modal === "transfers" && <>
              <AccountSelect accounts={liquidAccounts} name="fromAccountId" label="Transfer from" />
              <AccountSelect accounts={liquidAccounts} name="toAccountId" label="Transfer to" />
              <label>Transfer date<input required name="date" type="date" defaultValue={today} max={today} /></label><AmountField label="Transfer amount" />
              <div className="form-hint"><Icon name="transfer" size={16} /> Transfers change account balances but are not income or expenses.</div>
            </>}
            {modal === "accounts" && <>
              <label>Account code<input name="code" maxLength="30" placeholder="e.g. 1010 (assigned automatically if blank)" /></label>
              <label>Account name<input required name="name" maxLength="100" placeholder="e.g. Petty cash" /></label>
              <label>Account type<select required name="type" value={accountType} onChange={(event) => setAccountType(event.target.value)}>{accountTypes.map((type) => <option value={type} key={type}>{typeLabels[type]}</option>)}</select></label>
              {accountType === "asset" && <label>Account use<select required name="kind" value={accountKind} onChange={(event) => setAccountKind(event.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="category">Other asset category</option></select></label>}
              {accountType !== "asset" && <input type="hidden" name="kind" value="category" />}
              <label>Parent account<select name="parentAccountId" defaultValue=""><option value="">No parent (top-level)</option>{(dashboard?.accounts ?? []).filter((account) => account.type === accountType && account.active !== false).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
              <label>Opening balance <span className="input-affix"><span>{dashboard?.company?.baseCurrency ?? "LKR"}</span><input name="openingBalance" type="number" inputMode="decimal" min="0" step="0.01" defaultValue="0" /></span></label>
              <label className="checkbox-label"><input name="controlAccount" type="checkbox" value="true" /> Control account</label>
              <label className="checkbox-label"><input name="active" type="checkbox" value="true" defaultChecked /> Active account</label>
              <div className="form-hint"><Icon name="book" size={16} /> Leave the code blank to assign the next account code.</div>
            </>}
            {["customers", "suppliers", "agents"].includes(modal) && <>
              {modal !== "agents" && <label>{modal === "customers" ? "Customer" : "Supplier"} code<input name="code" maxLength="30" placeholder={`e.g. ${modal === "customers" ? "CUST-001" : "SUP-001"}`} /></label>}
              <label>Name<input required name="name" maxLength="100" placeholder={`e.g. ${modal === "agents" ? "Nimal Perera" : modal === "suppliers" ? "Wholesale supplier" : "New customer"}`} /></label>
              <label>Phone (optional)<input name="phone" maxLength="40" placeholder="Contact number" /></label>
              {modal !== "agents" && <label>Email (optional)<input name="email" type="email" maxLength="254" placeholder="accounts@example.com" /></label>}
              {modal === "customers" && <>
                <label>Billing address<textarea name="billingAddress" maxLength="300" rows="2" /></label>
                <label>Credit limit <span className="input-affix"><span>{dashboard?.company?.baseCurrency ?? "LKR"}</span><input name="creditLimit" type="number" inputMode="decimal" min="0" step="0.01" defaultValue="0" /></span></label>
                <label>Payment terms (days)<input name="paymentTermsDays" type="number" min="0" max="3650" defaultValue="0" /></label>
                <label>Opening balance <span className="input-affix"><span>{dashboard?.company?.baseCurrency ?? "LKR"}</span><input name="openingBalance" type="number" inputMode="decimal" min="0" step="0.01" defaultValue="0" /></span></label>
              </>}
              {modal === "suppliers" && <>
                <label>Address<textarea name="address" maxLength="300" rows="2" /></label>
                <label>Payment terms (days)<input name="paymentTermsDays" type="number" min="0" max="3650" defaultValue="0" /></label>
                <label>Tax registration number<input name="taxNumber" maxLength="80" /></label>
                <label>Opening balance <span className="input-affix"><span>{dashboard?.company?.baseCurrency ?? "LKR"}</span><input name="openingBalance" type="number" inputMode="decimal" min="0" step="0.01" defaultValue="0" /></span></label>
              </>}
            </>}
            {error && <div className="modal-error" role="alert">{error}</div>}
            <div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setModal("")}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save entry"}</button></div>
          </form>
        </section>
      </div>}
      {documentView && <DocumentModal
        type={documentView.type}
        record={documentView.record}
        party={documentView.party}
        company={dashboard?.company}
        dueCents={documentView.dueCents}
        onClose={() => setDocumentView(null)}
      />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}

function SummaryCard({ featured = false, title, value, hint, icon }) {
  return <article className={`summary-card ${featured ? "balance-card" : ""}`}><div className="summary-top"><span className="summary-label">{title}</span><span className={`summary-icon ${featured ? "balance-icon" : "received-icon"}`}><Icon name={icon} size={19} /></span></div><div className="summary-value">{value === null ? <span className="skeleton" /> : money(value)}</div><div className="summary-foot"><span className="foot-dot green" />{hint}</div>{featured && <div className="balance-art"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>}</article>;
}

function CompanySetup({ company, onSaved }) {
  const defaults = {
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
  };
  const [values, setValues] = useState({ ...defaults, ...company });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (company) setValues({ ...defaults, ...company });
  }, [company]);

  function updateField(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function saveCompany(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const nextCompany = {
      name: form.get("name"),
      address: form.get("address"),
      baseCurrency: form.get("baseCurrency").toUpperCase(),
      financialYearStart: form.get("financialYearStart"),
      dateFormat: form.get("dateFormat"),
      inventoryMethod: form.get("inventoryMethod"),
      tax: {
        enabled: form.has("taxEnabled"),
        country: form.get("taxCountry"),
        registrationNumber: form.get("registrationNumber"),
        ratePercent: Number(form.get("ratePercent")),
      },
      numbering: {
        invoicePrefix: form.get("invoicePrefix"),
        nextInvoiceNumber: Number(form.get("nextInvoiceNumber")),
        billPrefix: form.get("billPrefix"),
        nextBillNumber: Number(form.get("nextBillNumber")),
      },
    };
    try {
      const saved = await api("/api/company", {
        method: "PUT",
        body: JSON.stringify(nextCompany),
      });
      setValues(saved);
      onSaved(saved);
      setNotice("Company settings saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="settings-grid">
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>Company and accounting defaults</h2><p>Tax stays disabled until your accountant confirms the applicable jurisdiction and rate.</p></div></div>
      <form className="entry-form settings-form" onSubmit={saveCompany}>
        <label>Company name<input required name="name" maxLength="120" value={values.name} onChange={updateField} /></label>
        <label>Company address<textarea name="address" maxLength="500" rows="2" value={values.address} onChange={updateField} /></label>
        <label>Base currency (ISO code)<input required name="baseCurrency" minLength="3" maxLength="3" value={values.baseCurrency} onChange={updateField} /></label>
        <label>Financial year starts (MM-DD)<input required name="financialYearStart" pattern="(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])" value={values.financialYearStart} onChange={updateField} /></label>
        <label>Date format<select name="dateFormat" value={values.dateFormat} onChange={updateField}><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="MM/DD/YYYY">MM/DD/YYYY</option></select></label>
        <label>Inventory costing method<select name="inventoryMethod" value={values.inventoryMethod} onChange={updateField}><option value="FIFO">FIFO</option><option value="WEIGHTED_AVERAGE">Weighted average</option></select></label>
        <label className="checkbox-label"><input name="taxEnabled" type="checkbox" checked={values.tax.enabled} onChange={(event) => setValues((current) => ({ ...current, tax: { ...current.tax, enabled: event.target.checked } }))} /> Enable configured tax</label>
        <label>Tax country / jurisdiction<input name="taxCountry" maxLength="80" value={values.tax.country} onChange={(event) => setValues((current) => ({ ...current, tax: { ...current.tax, country: event.target.value } }))} placeholder="Set only after accountant confirms" /></label>
        <label>Tax registration number<input name="registrationNumber" maxLength="80" value={values.tax.registrationNumber} onChange={(event) => setValues((current) => ({ ...current, tax: { ...current.tax, registrationNumber: event.target.value } }))} /></label>
        <label>Default tax rate (%)<input name="ratePercent" type="number" min="0" max="100" step="0.01" value={values.tax.ratePercent} onChange={(event) => setValues((current) => ({ ...current, tax: { ...current.tax, ratePercent: event.target.value } }))} /></label>
        <label>Invoice prefix<input required name="invoicePrefix" maxLength="12" value={values.numbering.invoicePrefix} onChange={(event) => setValues((current) => ({ ...current, numbering: { ...current.numbering, invoicePrefix: event.target.value } }))} /></label>
        <label>Next invoice number<input required name="nextInvoiceNumber" type="number" min="1" value={values.numbering.nextInvoiceNumber} onChange={(event) => setValues((current) => ({ ...current, numbering: { ...current.numbering, nextInvoiceNumber: event.target.value } }))} /></label>
        <label>Bill prefix<input required name="billPrefix" maxLength="12" value={values.numbering.billPrefix} onChange={(event) => setValues((current) => ({ ...current, numbering: { ...current.numbering, billPrefix: event.target.value } }))} /></label>
        <label>Next bill number<input required name="nextBillNumber" type="number" min="1" value={values.numbering.nextBillNumber} onChange={(event) => setValues((current) => ({ ...current, numbering: { ...current.numbering, nextBillNumber: event.target.value } }))} /></label>
        {error && <div className="modal-error" role="alert">{error}</div>}
        {notice && <div className="settings-notice" role="status">{notice}</div>}
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save company settings"}</button>
      </form>
    </section>
    <UserAdministration />
    <AuditTrail />
  </div>;
}

function UserAdministration() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api("/api/users"));
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function addUser(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = Object.fromEntries(new FormData(formElement).entries());
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      formElement.reset();
      setNotice("User created.");
      await loadUsers();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Users and access roles</h2><p>Only invite trusted users. There is no public sign-up.</p></div></div>
    <div className="settings-user-list">{users.map((user) => <div className="settings-user" key={user.id}><strong>{user.name}</strong><span>{user.email}</span><span className="kind-tag">{user.role.replace("_", " ")}</span></div>)}</div>
    <form className="entry-form" onSubmit={addUser}>
      <label>Name<input required name="name" maxLength="100" /></label>
      <label>Email<input required name="email" type="email" maxLength="254" /></label>
      <label>Role<select required name="role" defaultValue="accountant"><option value="accountant">Accountant</option><option value="clerk">Sales/Purchasing Clerk</option><option value="read_only">Read-only</option></select></label>
      <label>Password<input required name="password" type="password" minLength="12" maxLength="256" autoComplete="new-password" /><small>Use a unique password of at least 12 characters and share it privately.</small></label>
      {error && <div className="modal-error" role="alert">{error}</div>}
      {notice && <div className="settings-notice" role="status">{notice}</div>}
      <button className="primary-button" type="submit" disabled={saving}>{saving ? "Creating..." : "Create user"}</button>
    </form>
  </section>;
}

function AuditTrail() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/audit-log").then(setEntries).catch((loadError) => setError(loadError.message));
  }, []);
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Audit log</h2><p>Recent changes recorded by the application.</p></div></div>
    {error && <div className="modal-error" role="alert">{error}</div>}
    <div className="settings-audit-list">{entries.slice(0, 20).map((entry) => <div className="settings-audit" key={entry.id}><strong>{entry.action}</strong><span>{entry.actor} · {new Date(entry.timestamp).toLocaleString()}</span></div>)}{entries.length === 0 && <div className="empty-state">No changes recorded yet.</div>}</div>
  </section>;
}

function QuickAction({ icon, styleName, title, hint, onClick }) {
  return <button className="quick-action" onClick={onClick}><span className={`quick-icon ${styleName}`}><Icon name={icon} size={19} /></span><span><strong>{title}</strong><small>{hint}</small></span><span className="quick-chevron">›</span></button>;
}

function AccountSelect({ accounts, name, label }) {
  const options = accounts.map((account) => ({
    ...account,
    name: `${account.name} · ${account.kind === "cash" ? "Cash" : "Bank"} · ${money(account.balanceCents)} available`,
  }));
  return <label>{label}<select required name={name} defaultValue="" disabled={accounts.length === 0}><SelectOptions items={options} emptyLabel="Choose a cash or bank account" noItemsLabel="No cash or bank accounts — add one in Chart of accounts" /></select></label>;
}

function parseUiMoneyCents(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return 0;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function formatQuantity(quantityMilli = 1000) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(quantityMilli / 1000);
}

function LineItemsEditor({ label }) {
  const [items, setItems] = useState([{ description: "Item", quantity: "1", unitPrice: "" }]);
  const lineItems = items.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice }));
  const totalCents = items.reduce((total, item) => {
    const quantityMilli = /^\d{1,6}(?:\.\d{1,3})?$/.test(item.quantity)
      ? Math.round(Number(item.quantity) * 1000)
      : 0;
    return total + Math.round(quantityMilli * parseUiMoneyCents(item.unitPrice) / 1000);
  }, 0);
  const updateItem = (index, key, value) => {
    setItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [key]: value } : item));
  };

  return <fieldset className="line-items-editor">
    <legend>{label}</legend>
    <div className="line-items-head"><span>Item</span><span>Qty</span><span>Unit price</span><span>Total</span><span className="sr-only">Remove</span></div>
    {items.map((item, index) => {
      const quantityMilli = /^\d{1,6}(?:\.\d{1,3})?$/.test(item.quantity)
        ? Math.round(Number(item.quantity) * 1000)
        : 0;
      const lineTotal = Math.round(quantityMilli * parseUiMoneyCents(item.unitPrice) / 1000);
      return <div className="line-item-row" key={index}>
        <label><span className="sr-only">Item description</span><input required maxLength="120" value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} /></label>
        <label><span className="sr-only">Quantity</span><input required type="number" inputMode="decimal" min="0.001" max="999999.999" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} /></label>
        <label><span className="sr-only">Unit price</span><input required type="number" inputMode="decimal" min="0.01" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(index, "unitPrice", event.target.value)} /></label>
        <output>{money(lineTotal)}</output>
        <button type="button" className="remove-line-button" aria-label={`Remove ${item.description || "line item"}`} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
      </div>;
    })}
    <button type="button" className="add-line-button" disabled={items.length >= 50} onClick={() => setItems((current) => [...current, { description: "", quantity: "1", unitPrice: "" }])}><Icon name="plus" size={15} /> Add item</button>
    <div className="line-items-total"><span>Document total</span><strong>{money(totalCents)}</strong></div>
    <input type="hidden" name="lineItems" value={JSON.stringify(lineItems)} readOnly />
    <input type="hidden" name="amount" value={totalCents > 0 ? (totalCents / 100).toFixed(2) : ""} readOnly />
  </fieldset>;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DocumentModal({ type, record, party, company, dueCents, onClose }) {
  const isInvoice = type === "sale";
  const lineItems = record.lineItems?.length ? record.lineItems : [{
    description: record.description || (isInvoice ? "Sale" : "Purchase"),
    quantityMilli: 1000,
    unitPriceCents: record.amountCents,
    totalCents: record.amountCents,
  }];
  const paidCents = Math.max(0, record.amountCents - dueCents);
  const title = isInvoice ? "Invoice" : "Supplier bill";

  function exportDocument() {
    downloadCsv(`ledgerly-${isInvoice ? "invoice" : "supplier-bill"}-${record.date}.csv`, [
      "Document", "Reference", "Date", "Party", "Description", "Quantity", "Unit price", "Line total",
    ], lineItems.map((line) => [
      title,
      record.reference,
      record.date,
      party?.name ?? "",
      line.description,
      formatQuantity(line.quantityMilli),
      (line.unitPriceCents / 100).toFixed(2),
      (line.totalCents / 100).toFixed(2),
    ]));
  }

  return <div className="modal-backdrop document-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="document-modal" role="dialog" aria-modal="true" aria-labelledby="document-title">
      <div className="document-actions">
        <button type="button" className="subtle-button" onClick={exportDocument}><Icon name="download" size={15} /> Export CSV</button>
        <button type="button" className="primary-button" onClick={() => window.print()}><Icon name="print" size={15} /> Print / Save PDF</button>
        <button type="button" className="icon-button close-button" onClick={onClose} aria-label="Close document"><Icon name="close" /></button>
      </div>
      <article className="print-document">
        <header className="print-document-header">
          <div><span className="document-brand">ledgerly<span>.</span></span><h1>{company?.name || "Your business"}</h1>{company?.address && <p>{company.address}</p>}</div>
          <div className="document-title-block"><h2 id="document-title">{title}</h2><strong>{record.reference}</strong><span>{shortDate(record.date)}</span></div>
        </header>
        <div className="document-party"><span>{isInvoice ? "BILL TO" : "SUPPLIER"}</span><strong>{party?.name ?? "Business contact"}</strong>{party?.address && <span>{party.address}</span>}{party?.email && <span>{party.email}</span>}{party?.phone && <span>{party.phone}</span>}</div>
        {record.description && <p className="document-note">{record.description}</p>}
        <div className="document-lines-wrap"><table className="document-lines"><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead><tbody>
          {lineItems.map((line, index) => <tr key={`${line.description}-${index}`}><td>{line.description}</td><td>{formatQuantity(line.quantityMilli)}</td><td>{money(line.unitPriceCents)}</td><td>{money(line.totalCents)}</td></tr>)}
        </tbody></table></div>
        <div className="document-summary"><div><span>Total</span><strong>{money(record.amountCents)}</strong></div><div><span>{isInvoice ? "Received" : "Paid"}</span><strong>{money(paidCents)}</strong></div><div className="document-balance"><span>Balance due</span><strong>{money(dueCents)}</strong></div></div>
        <footer className="document-footer">Thank you. Generated by Ledgerly bookkeeping workspace.</footer>
      </article>
    </section>
  </div>;
}

function AmountField({ label }) {
  return <label>{label}<span className="input-affix"><span>LKR</span><input required name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" /></span></label>;
}

function activityLabel(type) {
  return {
    sale: "Customer invoice",
    receipt: "Customer receipt",
    expense: "Operating expense",
    purchase: "Supplier bill",
    "supplier-payment": "Supplier payment",
    transfer: "Account transfer",
    "opening-balance": "Opening balance",
  }[type] ?? "Transaction";
}

function transactionTone(type) {
  if (type === "receipt" || type === "sale") return "receipt";
  if (type === "transfer") return "transfer";
  if (type === "opening-balance") return "opening";
  return "expense";
}

function transactionSign(type) {
  if (type === "receipt" || type === "sale") return "+";
  if (type === "transfer" || type === "opening-balance") return "";
  return "−";
}

export default App;
