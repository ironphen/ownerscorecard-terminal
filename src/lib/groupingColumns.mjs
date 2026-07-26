// The groupings (owner directive, 2026-07-10): each shelf rendered as ONE comparative table —
// the ValueLine/Moody's industry-section form. Every member of a shelf, across all three pools,
// is a row; the columns are the line items that kind of business is actually read on, hand-curated
// per shelf below. The reader runs an eye down a column and re-sorts for himself; the table never
// ranks, weights, scores, or highlights. The only default order is size (latest-year revenue,
// largest first), because size is an objective fact, not a judgment.
//
// Every value comes from lines and libs the site already computes — fundamentals.mjs,
// financials.mjs, reits.mjs — so a cell here can never disagree with the same figure on the
// company's own page. Where a figure is a category error for a member (an operating margin on a
// bank), the cell says "n/a"; where the inputs were not readable, it says "—"; both sort to the
// back of their column. Monetary columns are stated in USD for foreign filers via the same
// conversion doctrine every other surface uses (adrBasis ratio+FX for ADRs, the dated reference
// rate for the Japanese pool) — and a filer whose conversion terms are missing shows its money
// as filed and sorts to the back, never a guessed conversion.
import { SHELVES } from "./shelves.mjs";
import {
  topLineRevenue,
  grossMargin,
  gmCorrupt,
  operatingMargin,
  roicValue,
  ownerEarningsAbs,
  debtReliable,
  netDebtOf,
  oiReliable,
  throughCycle,
  fmtMoney,
} from "./fundamentals.mjs";
import { tangibleEquity, returnOnTangibleEquity } from "./financials.mjs";
import { floatOf } from "./insurers.mjs";
import { medicalLossRatio } from "./managedCare.mjs";
import { cashPayout } from "./reits.mjs";
import { financialKind, financialProfile } from "./archetype.mjs";
import { adrBasis } from "./adrBasis.mjs";

// ---------------------------------------------------------------------------------------------
// The template families. Each column: a stable key, a plain factual label, and the basis the
// header names (period, construction, currency). 5–7 columns per family — dense enough to compare,
// never a wall.
// ---------------------------------------------------------------------------------------------
// The quality ratios (margins and returns on capital) are read THROUGH THE CYCLE — the median over
// the record's readable years, Graham's normalization — so one peak or trough year never sets the
// figure; a member with under three readable years shows "—" rather than a single year dressed as a
// level. The size lines (revenue, owner earnings, net debt, deposits, ...) stay latest-FY: size is a
// current fact, not a level to normalize.
const COL = {
  revenue: { key: "revenue", label: "Revenue", basis: "latest fiscal year, USD", type: "money" },
  grossMargin: { key: "grossMargin", label: "Gross margin", basis: "median over the record", type: "pct" },
  operatingMargin: { key: "operatingMargin", label: "Operating margin", basis: "median over the record", type: "pct" },
  ownerEarnings: { key: "ownerEarnings", label: "Owner earnings", basis: "op. cash − maintenance capex · latest FY, USD", type: "money" },
  roic: { key: "roic", label: "Return on invested capital", basis: "after tax · median over the record", type: "pct" },
  netDebt: { key: "netDebt", label: "Net debt", basis: "debt − cash & ST investments · latest FY, USD", type: "money" },
  netInterestIncome: { key: "netInterestIncome", label: "Net interest income", basis: "latest fiscal year, USD", type: "money" },
  deposits: { key: "deposits", label: "Deposits", basis: "latest fiscal year, USD", type: "money" },
  nibShare: { key: "nibShare", label: "Noninterest-bearing share", basis: "of total deposits · latest FY", type: "pct" },
  netIncome: { key: "netIncome", label: "Net income", basis: "latest fiscal year, USD", type: "money" },
  rote: { key: "rote", label: "Return on tangible equity", basis: "median over the record", type: "pct" },
  tangibleEquity: { key: "tangibleEquity", label: "Tangible equity", basis: "equity − goodwill − intangibles · latest FY, USD", type: "money" },
  premiums: { key: "premiums", label: "Premiums earned", basis: "latest fiscal year, USD", type: "money" },
  investmentIncome: { key: "investmentIncome", label: "Investment income", basis: "latest fiscal year, USD", type: "money" },
  insFloat: { key: "insFloat", label: "Float", basis: "reserves + unearned premiums − receivables − DAC · latest FY, USD", type: "money" },
  reserveDev: { key: "reserveDev", label: "Reserve development", basis: "prior-year · negative = favorable · latest FY, USD", type: "money" },
  mlr: { key: "mlr", label: "Medical loss ratio", basis: "medical costs ÷ premiums · median over the record", type: "pct" },
  // Funds from operations was withdrawn 2026-07-25: no REIT tags it, and rebuilding it from the
  // standard tags missed Simon Property by half. Cash from operations is filed and unambiguous, and
  // the payout against it answers what FFO was being asked — whether the distribution is earned.
  cashFromOps: { key: "cashFromOps", label: "Cash from operations", basis: "latest fiscal year, USD", type: "money" },
  cashPayout: { key: "cashPayout", label: "Dividend / operating cash", basis: "dividends paid ÷ cash from operations · latest FY", type: "pct" },
  dividendsPaid: { key: "dividendsPaid", label: "Dividends paid", basis: "latest fiscal year, USD", type: "money" },
  totalAssets: { key: "totalAssets", label: "Total assets", basis: "latest fiscal year, USD", type: "money" },
  // The software desk's three: what is already contracted and lands within a year, what the
  // selling costs, and the pay packet charged in the owner's own currency.
  bookedYear: { key: "bookedYear", label: "Next year contracted", basis: "obligations landing within 12 months ÷ revenue · withheld where the band is untagged", type: "pct" },
  salesMarketing: { key: "salesMarketing", label: "Sales & marketing", basis: "selling and marketing ÷ revenue · latest FY", type: "pct" },
  stockComp: { key: "stockComp", label: "Stock pay", basis: "stock compensation ÷ revenue · latest FY", type: "pct" },
  // Semiconductors are the opposite business to software wearing the same sector label: the moat is
  // bought with fabs and research rather than sold as a subscription, and the cycle shows up first
  // in inventory. These three say what a chipmaker must spend to stay where it is.
  rdIntensity: { key: "rdIntensity", label: "R&D / revenue", basis: "latest fiscal year", type: "pct" },
  capexIntensity: { key: "capexIntensity", label: "Capex / revenue", basis: "latest fiscal year", type: "pct" },
  inventoryDays: { key: "inventoryDays", label: "Inventory days", basis: "inventory ÷ daily cost of revenue · latest FY", type: "num" },
};

export const FAMILIES = {
  // Most shelves: the industrial read — the top line, the two margins, the cash an owner could
  // take out, the return on the capital tied up, and the debt net of the cash against it.
  software: {
    name: "Software",
    columns: [COL.revenue, COL.bookedYear, COL.salesMarketing, COL.stockComp, COL.operatingMargin, COL.ownerEarnings, COL.roic],
  },
  // Semiconductors and semiconductor equipment: capital intensity, research intensity, and the
  // inventory cycle that turns a good year into a bad one.
  semiconductor: {
    name: "Semiconductors",
    columns: [COL.revenue, COL.grossMargin, COL.rdIntensity, COL.capexIntensity, COL.inventoryDays, COL.ownerEarnings, COL.roic],
  },
  general: {
    name: "General operating",
    columns: [COL.revenue, COL.grossMargin, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  },
  // Heavy operators whose cost-of-revenue line is unreliably tagged across the pools (utilities,
  // transport, hospitality): the gross-margin column would read "—" for most members, so it is
  // dropped and dividends paid — a line an owner of these businesses actually reads — stands in.
  heavy: {
    name: "Heavy operating",
    columns: [COL.revenue, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt, COL.dividendsPaid],
  },
  // Lenders: read on the balance sheet, not the operating line — the reconstructed top line, the
  // lending spread in dollars, the funding base, the profit, and the return on hard capital.
  // The noninterest-bearing share is the banks desk's Wave A franchise read (2026-07-21): the
  // deposits the bank pays nothing for, as a share of the total — the moat, one column wide.
  lender: {
    name: "Lenders",
    columns: [COL.revenue, COL.netInterestIncome, COL.deposits, COL.nibShare, COL.netIncome, COL.rote, COL.tangibleEquity],
  },
  // Insurers: premiums, the float and its development honesty line, the float's investment
  // income, then the same hard-capital read. Float and development are the insurance desk's
  // Wave A lines (2026-07-21); a member whose components don't extract shows "—", never a
  // partial figure.
  insurer: {
    name: "Insurers",
    columns: [COL.premiums, COL.insFloat, COL.reserveDev, COL.investmentIncome, COL.netIncome, COL.rote, COL.tangibleEquity],
  },
  // Managed care (the desk's Q12, ratified 2026-07-21): health plans are insurers in a
  // health-services costume — the general family's operating lens marked every column "n/a."
  // Read them on premiums, the medical loss ratio against its statutory floor, and the same
  // development honesty line the insurers carry.
  managedCare: {
    name: "Managed care",
    columns: [COL.revenue, COL.premiums, COL.mlr, COL.reserveDev, COL.netIncome, COL.rote, COL.tangibleEquity],
  },
  // Property: rent, the REIT earnings measure, the distribution, and the leverage every REIT runs.
  property: {
    name: "Property",
    columns: [COL.revenue, COL.cashFromOps, COL.cashPayout, COL.dividendsPaid, COL.netDebt, COL.totalAssets],
  },
  // Fee handlers (asset managers, exchanges, data firms): financials read on equity, so the
  // GENERAL family's ROIC / gross-margin / owner-earnings cells would be "n/a" for most members;
  // the honest columns are the fee top line, its margin, the profit, and the hard-capital return.
  fee: {
    name: "Fee handlers",
    columns: [COL.revenue, COL.operatingMargin, COL.netIncome, COL.rote, COL.tangibleEquity],
  },
};

// ---------------------------------------------------------------------------------------------
// The groupings: one per industry, in shelves.json file order — the taxonomy's fixed sector
// then industry order (a reading order, never a ranking). Since the 2026-07-17
// standardization, shelves.json is generated from src/data/taxonomy.json (shelf = one
// conventional industry, carrying its sector and its column family), so the defs derive
// rather than repeat: slugs are stored in shelves.json, and the guard below still fails the
// build loudly on any drift.
// ---------------------------------------------------------------------------------------------
const GROUPING_DEFS = SHELVES.map((s) => ({ noun: s.noun, slug: s.industries[0].slug, family: s.family, sector: s.sector }));

// Guard, both ways, at import time: a shelf added to (or renamed in) shelves.json without a
// grouping here — or a grouping whose shelf no longer exists, a duplicate slug, or an unknown
// family — fails the build loudly, so a data refresh can never silently orphan a table.
{
  const shelfNouns = new Set(SHELVES.map((s) => s.noun));
  const seenNoun = new Set();
  const seenSlug = new Set();
  for (const g of GROUPING_DEFS) {
    if (!shelfNouns.has(g.noun)) throw new Error(`groupingColumns: no shelf in shelves.json for grouping "${g.noun}"`);
    if (seenNoun.has(g.noun)) throw new Error(`groupingColumns: duplicate grouping for shelf "${g.noun}"`);
    if (seenSlug.has(g.slug)) throw new Error(`groupingColumns: duplicate slug "${g.slug}"`);
    if (!FAMILIES[g.family]) throw new Error(`groupingColumns: unknown family "${g.family}" on "${g.noun}"`);
    seenNoun.add(g.noun);
    seenSlug.add(g.slug);
  }
  for (const s of SHELVES) if (!seenNoun.has(s.noun)) throw new Error(`groupingColumns: shelf "${s.noun}" has no grouping`);
}

export const GROUPINGS = GROUPING_DEFS;
export const groupingBySlug = new Map(GROUPING_DEFS.map((g) => [g.slug, g]));
export const groupingByNoun = new Map(GROUPING_DEFS.map((g) => [g.noun, g]));

// ---------------------------------------------------------------------------------------------
// Currency terms for one company: how its monetary lines reach the reader's dollars. One doctrine,
// shared with the compare view and the company pages:
//  • US filers are already USD.
//  • An ADR with known conversion terms (adrBasis auto) converts at the dated reference rate; the
//    ADS ratio only moves share counts, which these columns never show.
//  • An ADR that files in USD needs no conversion at all, whatever its ADS ratio.
//  • The Japanese pool converts at the same dated reference rate.
//  • Anything else shows its money AS FILED and sorts to the back — never a guessed conversion.
// ---------------------------------------------------------------------------------------------
export function usdTerms(company, adrRatios, rates) {
  const ccy = company?.currency || "USD";
  if (company?.market === "ADR") {
    const b = adrBasis(company, adrRatios, rates);
    if (b.auto) return { factor: b.fxUsd, converted: ccy !== "USD", asFiled: false, ccy };
    if (ccy === "USD") return { factor: 1, converted: false, asFiled: false, ccy };
    return { factor: null, converted: false, asFiled: true, ccy };
  }
  if (company?.market === "JP") {
    const fx = rates?.fx?.[ccy];
    if (fx != null && fx > 0) return { factor: fx, converted: true, asFiled: false, ccy };
    return { factor: null, converted: false, asFiled: true, ccy };
  }
  return { factor: 1, converted: false, asFiled: false, ccy: "USD" };
}

// The default-order key: latest-year revenue in USD (the bank/insurer reconstruction included).
// Null — including an as-filed foreign filer — sorts to the back, the same rule as every column.
export function revenueSortUsd(company, terms) {
  const rev = topLineRevenue(company?.lines || {}, company);
  if (rev == null || terms.asFiled) return null;
  return rev * terms.factor;
}

// Median over the readable record years — the through-cycle read the lender/insurer families use
// for return on tangible equity, so one peak or trough year doesn't set the figure.
function roteMedian(company) {
  const vals = (company?.history || [])
    .map((h) => returnOnTangibleEquity(h?.lines))
    .filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The same through-cycle read for the operating quality ratios, via the shared throughCycle helper
// (the window the durability read and the business brief already use, so the surfaces agree).
// Null below three readable years — the caller renders "—", never one year dressed as a level.
function medianOverRecord(company, metricFn) {
  const tc = throughCycle(company, metricFn);
  return tc ? tc.median : null;
}

// ---------------------------------------------------------------------------------------------
// One row's cells. Each cell: { text, sort } — sort null means "no key on this column: to the
// back", whichever direction the reader sorts. "—" is a figure that could not be read; "n/a" is a
// figure that does not apply to that kind of business (the same withholding the company pages
// make; a category error is never printed as a number, and never as a silent blank).
// ---------------------------------------------------------------------------------------------
const DASH = { text: "—", sort: null };
const NA = { text: "n/a", sort: null };

// The column list and the withholding semantics are now separable. The list may come from a family
// (every industry table) or be handed in directly (a sector table, whose members disagree about what
// matters); the semantics always come from the ROW's own kind, inside cellFor.
export function groupingCells(company, familyKey, terms, columns = null) {
  const family = FAMILIES[familyKey];
  const L = company?.lines || {};
  const fk = financialKind(company);

  const money = (v) => {
    if (v == null || !Number.isFinite(v)) return DASH;
    if (terms.asFiled) return { text: `as filed: ${fmtMoney(v, terms.ccy)}`, sort: null };
    const usd = v * terms.factor;
    return { text: fmtMoney(usd, "USD"), sort: Math.round(usd) };
  };
  const pct = (v) => (v == null || !Number.isFinite(v) ? DASH : { text: `${(v * 100).toFixed(1)}%`, sort: Number(v.toFixed(6)) });

  const cellFor = (key) => {
    switch (key) {
      case "revenue":
        return money(topLineRevenue(L, company));
      case "grossMargin":
        // Median over the record's readable years, with the same corrupt-cost-line withholding the
        // record table applies per year, so a mis-tagged near-100% year never enters the median.
        if (fk) return NA;
        return pct(medianOverRecord(company, (yl) => {
          const gm = grossMargin(yl);
          return gm != null && gmCorrupt(gm, company) ? null : gm;
        }));
      case "operatingMargin":
        // Meaningful for an operating business and for a fee earner; a category error for a bank,
        // insurer or property trust, whose operating line is not how it earns.
        if (fk != null && fk !== "fee") return NA;
        if (!oiReliable(company)) return NA;
        return pct(medianOverRecord(company, operatingMargin));
      case "ownerEarnings":
        if (fk) return NA;
        return money(ownerEarningsAbs(L, company));
      case "roic":
        if (fk) return NA;
        if (!oiReliable(company)) return NA;
        return pct(medianOverRecord(company, roicValue));
      case "netDebt": {
        // Leverage is exactly how a property trust is judged, so a REIT keeps this read; for a bank
        // or an insurer it is a category error, because deposits and float are not debt.
        //
        // That test belongs to the ROW's own kind, not to the table it happens to be rendered in.
        // It used to ask whether the TABLE was the property one, which was equivalent while every
        // table held a single family — and would have turned every REIT's leverage into "n/a" the
        // moment a sector table mixed families, since a sector is not a family. Same answer on every
        // table that exists today; correct on the ones about to.
        if (fk && fk !== "reit") return NA;
        if (!debtReliable(L)) return DASH;
        const net = netDebtOf(L); // the one shared definition (cash + short-term), every surface identical
        if (net == null) return DASH;
        const m = money(net);
        // Net cash reads as what it is, not as a negative debt in parentheses.
        if (m.sort != null && net < 0) return { text: `+${fmtMoney(-net * terms.factor, "USD")} cash`, sort: m.sort };
        return m;
      }
      case "netInterestIncome":
        return money(L.netInterestIncome);
      case "deposits":
        return money(L.deposits);
      case "netIncome":
        return money(L.netIncome);
      case "rote":
        return pct(roteMedian(company));
      case "tangibleEquity":
        return money(tangibleEquity(L));
      case "premiums":
        return money(L.premiumsEarned);
      case "insFloat": {
        const f = floatOf(L);
        return f ? money(f.value) : DASH;
      }
      case "nibShare":
        return pct(L.noninterestBearingDeposits != null && L.deposits ? L.noninterestBearingDeposits / L.deposits : null);
      case "bookedYear": {
        const t = L.rpoTotal, sh = L.rpoTwelveMonthShare;
        return pct(t != null && sh != null && L.revenue > 0 ? (t * sh) / L.revenue : null);
      }
      case "salesMarketing":
        return pct(L.sellingMarketing != null && L.revenue > 0 ? L.sellingMarketing / L.revenue : null);
      case "stockComp":
        return pct(L.stockComp != null && L.revenue > 0 ? L.stockComp / L.revenue : null);
      case "rdIntensity":
        return pct(L.researchDevelopment != null && L.revenue > 0 ? L.researchDevelopment / L.revenue : null);
      case "capexIntensity":
        return pct(L.capex != null && L.revenue > 0 ? Math.abs(L.capex) / L.revenue : null);
      case "inventoryDays": {
        const daily = L.costOfRevenue > 0 ? L.costOfRevenue / 365 : null;
        const d = L.inventory != null && daily ? L.inventory / daily : null;
        return d == null ? DASH : String(Math.round(d));
      }
      case "mlr":
        return pct(medianOverRecord(company, (yl) => medicalLossRatio(yl)));
      case "reserveDev":
        return money(L.reserveDevelopmentPriorYear);
      case "investmentIncome":
        return money(L.investmentIncome);
      case "cashFromOps":
        return money(L.cashFromOps);
      case "cashPayout":
        return pct(cashPayout(L));
      case "dividendsPaid":
        return L.dividendsPaid == null ? DASH : money(Math.abs(L.dividendsPaid));
      case "totalAssets":
        return money(L.totalAssets);
      default:
        return DASH;
    }
  };

  return (columns || family.columns).map((col) => cellFor(col.key));
}

// ---------------------------------------------------------------------------------------------
// The group line — Graham's group view, the sentence ValueLine printed over an industry section:
// one dated line describing the LIST, built from the very cells the table renders (their sort
// keys), so it can never disagree with a figure on the page. Each fragment is the median of a
// column over the members it applies to (an n/a or unreadable cell simply isn't in the median);
// the net-debt column reads as a count of net-cash members instead, a fact, not a mixed-sign
// median. It names no member, ranks nothing, and grades nothing — a description of the group,
// never a verdict on anyone in it.
// ---------------------------------------------------------------------------------------------
function medianOf(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function groupLine(columns, cellRows) {
  const parts = [];
  columns.forEach((col, i) => {
    const sorts = cellRows.map((r) => (r[i] ? r[i].sort : null)).filter((v) => v != null);
    if (!sorts.length) return;
    if (col.key === "netDebt") {
      const cash = sorts.filter((v) => v < 0).length;
      parts.push(`${cash} of ${sorts.length} hold net cash`);
      return;
    }
    const m = medianOf(sorts);
    if (col.type === "money") parts.push(`median ${col.label.toLowerCase()} ${fmtMoney(m, "USD")}`);
    else parts.push(`median ${col.label.toLowerCase()} ${(m * 100).toFixed(1)}%`);
  });
  return parts.length ? `As a group: ${parts.join("; ")}.` : null;
}
