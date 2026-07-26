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
//
// A column also carries `concept`, the glossary id its label links to (the same key Peers.astro
// puts on its comparison columns, read the same way): the groupings are the door for the reader
// who arrives without a ticker, which is largely the reader who arrives without the vocabulary,
// and the teaching layer was switched off on exactly that surface (UX audit, 2026-07-26).
// A column only links where an honest entry exists. Left deliberately unlinked, because the
// nearest entry is about a different figure: net interest income and the noninterest-bearing
// share (net-interest-margin is a ratio, these are the dollars and the mix), investment income
// and reserve development (insurance-float and combined-ratio do not define either), dividends
// paid and total assets (dollar lines, not the ratios built on them), and the plain size lines.
// A near-miss link teaches the wrong word, so those stay plain text.
// ---------------------------------------------------------------------------------------------
// The quality ratios (margins and returns on capital) are read THROUGH THE CYCLE — the median over
// the record's readable years, Graham's normalization — so one peak or trough year never sets the
// figure; a member with under three readable years shows "—" rather than a single year dressed as a
// level. The size lines (revenue, owner earnings, net debt, deposits, ...) stay latest-FY: size is a
// current fact, not a level to normalize.
// Exported because the sector tables (below) build their column lists out of the same objects
// rather than copies of them: one declaration of a column's label and basis, everywhere it renders.
// The declaration order here is also the canonical render order for a sector table, so the eleven
// of them read the same way left to right.
export const COL = {
  revenue: { key: "revenue", label: "Revenue", basis: "latest fiscal year, USD", type: "money" },
  grossMargin: { key: "grossMargin", label: "Gross margin", basis: "median over the record", type: "pct", concept: "gross-margin" },
  operatingMargin: { key: "operatingMargin", label: "Operating margin", basis: "median over the record", type: "pct", concept: "operating-margin" },
  ownerEarnings: { key: "ownerEarnings", label: "Owner earnings", basis: "op. cash − maintenance capex · latest FY, USD", type: "money", concept: "owner-earnings" },
  roic: { key: "roic", label: "Return on invested capital", basis: "after tax · median over the record", type: "pct", concept: "roic" },
  netDebt: { key: "netDebt", label: "Net debt", basis: "debt − cash & ST investments · latest FY, USD", type: "money", concept: "net-debt" },
  netInterestIncome: { key: "netInterestIncome", label: "Net interest income", basis: "latest fiscal year, USD", type: "money" },
  deposits: { key: "deposits", label: "Deposits", basis: "latest fiscal year, USD", type: "money" },
  nibShare: { key: "nibShare", label: "Noninterest-bearing share", basis: "of total deposits · latest FY", type: "pct" },
  netIncome: { key: "netIncome", label: "Net income", basis: "latest fiscal year, USD", type: "money" },
  rote: { key: "rote", label: "Return on tangible equity", basis: "median over the record", type: "pct", concept: "rotce" },
  tangibleEquity: { key: "tangibleEquity", label: "Tangible equity", basis: "equity − goodwill − intangibles · latest FY, USD", type: "money", concept: "tangible-book" },
  premiums: { key: "premiums", label: "Premiums earned", basis: "latest fiscal year, USD", type: "money" },
  investmentIncome: { key: "investmentIncome", label: "Investment income", basis: "latest fiscal year, USD", type: "money" },
  insFloat: { key: "insFloat", label: "Float", basis: "reserves + unearned premiums − receivables − DAC · latest FY, USD", type: "money", concept: "insurance-float" },
  reserveDev: { key: "reserveDev", label: "Reserve development", basis: "prior-year · negative = favorable · latest FY, USD", type: "money" },
  mlr: { key: "mlr", label: "Medical loss ratio", basis: "medical costs ÷ premiums · median over the record", type: "pct", concept: "medical-loss-ratio" },
  // Funds from operations was withdrawn 2026-07-25: no REIT tags it, and rebuilding it from the
  // standard tags missed Simon Property by half. Cash from operations is filed and unambiguous, and
  // the payout against it answers what FFO was being asked — whether the distribution is earned.
  cashFromOps: { key: "cashFromOps", label: "Cash from operations", basis: "latest fiscal year, USD", type: "money", concept: "cash-from-operations" },
  cashPayout: { key: "cashPayout", label: "Dividend / operating cash", basis: "dividends paid ÷ cash from operations · latest FY", type: "pct", concept: "dividend-coverage" },
  dividendsPaid: { key: "dividendsPaid", label: "Dividends paid", basis: "latest fiscal year, USD", type: "money" },
  totalAssets: { key: "totalAssets", label: "Total assets", basis: "latest fiscal year, USD", type: "money" },
  // The software desk's three: what is already contracted and lands within a year, what the
  // selling costs, and the pay packet charged in the owner's own currency.
  // The basis line used to say "withheld where the band is untagged", which asked the reader to
  // already know both words; it now names the filing line the figure is read from, and the label
  // links to the contracted-revenue entry written for it (UX audit, 2026-07-26).
  bookedYear: { key: "bookedYear", label: "Next year contracted", basis: "revenue signed and due within 12 months ÷ revenue · only where the filer tags it", type: "pct", concept: "contracted-revenue" },
  salesMarketing: { key: "salesMarketing", label: "Sales & marketing", basis: "selling and marketing ÷ revenue · latest FY", type: "pct", concept: "sales-and-marketing" },
  // Stock pay links to the existing dilution entry, which is the site's definition of stock-based
  // pay as both an expense and a transfer of ownership. A second entry would say it twice.
  stockComp: { key: "stockComp", label: "Stock pay", basis: "stock compensation ÷ revenue · latest FY", type: "pct", concept: "dilution" },
  // Semiconductors are the opposite business to software wearing the same sector label: the moat is
  // bought with fabs and research rather than sold as a subscription, and the cycle shows up first
  // in inventory. These three say what a chipmaker must spend to stay where it is.
  rdIntensity: { key: "rdIntensity", label: "R&D / revenue", basis: "latest fiscal year", type: "pct", concept: "rd-intensity" },
  capexIntensity: { key: "capexIntensity", label: "Capex / revenue", basis: "latest fiscal year", type: "pct", concept: "capex-intensity" },
  inventoryDays: { key: "inventoryDays", label: "Inventory days", basis: "inventory ÷ daily cost of revenue · latest FY", type: "num", concept: "inventory-days" },
  // The oil & gas desk's three, all ratios. Reserve quantities are filed in units that differ by
  // company (barrels, thousand barrels of oil equivalent, million cubic feet equivalent), and the
  // unit does not travel into the record, so the desk publishes the figures those units cancel out
  // of and leaves the raw quantities in the filing. Empty cells sit beside full ones here by
  // design: reserves are tagged by only some filers, and a peer-average reserve life is exactly
  // the thing that must never be imputed.
  reserveLife: { key: "reserveLife", label: "Years of production left", basis: "proved reserves ÷ the year's production · only where the filer tags both", type: "num", concept: "reserve-life" },
  reserveReplacement: { key: "reserveReplacement", label: "Replaced what it sold", basis: "discoveries and extensions plus revisions ÷ production · latest FY", type: "pct", concept: "reserve-replacement" },
  pudShare: { key: "pudShare", label: "Undeveloped share", basis: "proved undeveloped ÷ total proved · latest FY", type: "pct", concept: "proved-undeveloped" },
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
  // Producers and the integrated majors: the ordinary operating reads, plus what the reserve base
  // says about how long the business can keep selling and whether it is replacing what it sells.
  producer: {
    name: "Oil & gas producers",
    columns: [COL.revenue, COL.reserveLife, COL.reserveReplacement, COL.pudShare, COL.operatingMargin, COL.ownerEarnings, COL.netDebt],
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
// THE SECTORS — the layer above the industry tables, in the taxonomy's fixed file order (a reading
// order, never a ranking). The slug is STORED in shelves.json beside the sector name, on the same
// doctrine as the industry slugs: derived once by the generator, read verbatim here, so a later
// change to the slug rule can never silently move eleven URLs.
// ---------------------------------------------------------------------------------------------
const SECTOR_DEFS = [];
{
  const seen = new Map();
  for (const s of SHELVES) {
    if (!s.sectorSlug) throw new Error(`groupingColumns: shelf "${s.noun}" carries no sectorSlug (regenerate shelves.json)`);
    const prior = seen.get(s.sector);
    if (prior && prior.slug !== s.sectorSlug) {
      throw new Error(`groupingColumns: sector "${s.sector}" carries two slugs ("${prior.slug}" and "${s.sectorSlug}")`);
    }
    if (!prior) {
      const clash = SECTOR_DEFS.find((d) => d.slug === s.sectorSlug);
      if (clash) throw new Error(`groupingColumns: sector slug "${s.sectorSlug}" is on both "${clash.name}" and "${s.sector}"`);
      const def = { name: s.sector, slug: s.sectorSlug, industries: [] };
      seen.set(s.sector, def);
      SECTOR_DEFS.push(def);
    }
    seen.get(s.sector).industries.push({ noun: s.noun, slug: s.industries[0].slug, family: s.family });
    // /groupings/sector/{slug} lives in the same directory as /groupings/{industry-slug}. No
    // industry is slugged "sector" today, and nothing in the taxonomy prevents one; the failure
    // would be a silently shadowed route rather than a build error, so it is a build error here.
    if (s.industries[0].slug === "sector") throw new Error(`groupingColumns: industry slug "sector" would shadow the sector route`);
  }
}

export const SECTORS = SECTOR_DEFS;
export const sectorBySlug = new Map(SECTOR_DEFS.map((s) => [s.slug, s]));
export const sectorByName = new Map(SECTOR_DEFS.map((s) => [s.name, s]));

// The helper the pages resolve a sector's URL through — never a re-derivation of the slug rule.
export function sectorSlugOf(name) {
  return sectorByName.get(name)?.slug || null;
}

// ---------------------------------------------------------------------------------------------
// THE SECTOR COLUMN SETS — frozen 2026-07-26, measured over the live pools (3,827 rows across the
// three pools) by scripts/sectorColumnsRule.mjs, which is the rule written out in full and is run
// again on every `npm test` as a drift check against this literal.
//
// The rule, in short: a single-family sector shows that family's columns unchanged; otherwise a
// candidate column is kept only if the families listing it cover at least 40% of the sector's rows
// AND it returns a sortable figure for at least two thirds of them; cap 7; rendered in the COL
// declaration order above so all eleven tables read the same way left to right.
//
// It is frozen rather than computed at build time for the same reason slugs are stored rather than
// derived: a pipeline refresh must never quietly add or drop a column from a published page, which
// would also break a reader's bookmarked ?sort= URL with no human in the loop. When the drift check
// fails, that is a decision to make, not a test to silence.
//
// A SECTOR TABLE IS A DIFFERENT INSTRUMENT FROM AN INDUSTRY TABLE, NOT A BIGGER ONE. At sector
// scale the question is how big, how profitable, how much capital, how much debt. The specialist
// columns a kind of business is really read on — what is contracted for next year in software,
// inventory days in semiconductors, deposits and the noninterest-bearing share in banks, the
// medical loss ratio in managed care — are one step down, on the industry's own table, and that is
// what makes narrowing a change of instrument rather than a convenience.
//
// Measured coverage and answer rates, as of the freeze (the recorded reason for each set):
// ---------------------------------------------------------------------------------------------
export const SECTOR_COLUMNS = {
  // 171 rows, general + heavy + producer. Gross margin dropped at 50% answered, the same reason the
  // heavy family already drops it; the producers' reserve lines answer 8-9% of the sector and stay
  // on the two oil & gas tables where they are read. Kept: revenue 94%, operating margin 96%, owner
  // earnings 85%, ROIC 74%, net debt 92%.
  "Energy": [COL.revenue, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  // 243 rows, single family (general): its columns unchanged. Lowest answered is gross margin, 82%.
  "Materials": [COL.revenue, COL.grossMargin, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  // 660 rows, general + heavy, which differ by two columns. Gross margin survives at 74% answered;
  // dividends paid fails coverage at 2% (the heavy family alone lists it). Others 88-97%.
  "Industrials": [COL.revenue, COL.grossMargin, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  // 444 rows, single family (general). Lowest answered is gross margin, 77%.
  "Consumer Discretionary": [COL.revenue, COL.grossMargin, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  // 140 rows, single family (general). Lowest answered is ROIC, 89%.
  "Consumer Staples": [COL.revenue, COL.grossMargin, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  // 495 rows, general + managedCare. Gross margin dropped at 61% answered (biotech cost lines are
  // tagged unreliably); managed care's premiums, medical loss ratio and reserve development fail
  // coverage at 2% of the sector's rows and stay on the Managed Care table where they belong, which
  // is exactly the narrowing the page's prose points at. Kept: 81-97%.
  "Health Care": [COL.revenue, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  // 694 rows, lender + insurer + fee — the hardest sector and the rule's proof. Four columns fall
  // out, each answering 92-98%: what it took in, what it earned, the hard capital behind it, and
  // the return on that capital. That is how a bank, a P&C insurer and an exchange can honestly be
  // read in one table. Deposits (45% answered), premiums (18%) and float (12%) would each be blank
  // for four fifths of the page and are correctly absent; operating margin is a category error for
  // most of the sector by construction and answers 30%.
  "Financials": [COL.revenue, COL.netIncome, COL.rote, COL.tangibleEquity],
  // 487 rows, software + semiconductor + general. Every loud specialist column falls away: next
  // year contracted answers 9% of the sector, sales & marketing 39%, inventory days 58% and only
  // for the two semiconductor industries. What survives is the universal operating read.
  // AMENDED (rule step 4): net debt added by hand. It answers 97% of IT rows and is a category
  // error for none of them; it failed only coverage (24%), and it failed it for a purely editorial
  // reason — the software and semiconductor families spent their budget on their own lines. Debt
  // net of the cash against it is close to the most Graham column on the board.
  "Information Technology": [COL.revenue, COL.grossMargin, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt, COL.stockComp],
  // 194 rows, general + heavy. Gross margin answers 61% and is dropped; dividends paid fails
  // coverage at 26%. Kept: 84-96%.
  "Communication Services": [COL.revenue, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt],
  // 115 rows, single family (heavy): its columns unchanged. Lowest answered is owner earnings, 81%.
  "Utilities": [COL.revenue, COL.operatingMargin, COL.ownerEarnings, COL.roic, COL.netDebt, COL.dividendsPaid],
  // 184 rows, single family (property): its columns unchanged. Funds from operations does not
  // appear because it was withdrawn from the library on 2026-07-25 — no REIT tags it, and rebuilt
  // from the standard tags it missed Simon Property by half; cash from operations is filed and
  // unambiguous, and the payout against it answers what FFO was being asked. Lowest answered is
  // that payout, 76%. Corrected 2026-07-26 after the verifier measured the claim that used to sit
  // here: the non-REIT rows are 32 of 184, about a sixth rather than a quarter, and they do NOT
  // read n/a on these lines — they answer revenue, cash from operations and total assets at 30 of
  // 32. The only n/a on this table is net debt, on the handful of rows the mortgage-REIT signature
  // still catches. A recorded reason that is itself wrong is worse than no reason, because the next
  // person to read it will trust it.
  "Real Estate": [COL.revenue, COL.netDebt, COL.cashFromOps, COL.cashPayout, COL.dividendsPaid, COL.totalAssets],
};

// Every sector present in the data must have a frozen set, and every frozen set a sector: a new
// sector in the taxonomy fails the build here rather than rendering a table with no columns.
{
  for (const s of SECTOR_DEFS) if (!SECTOR_COLUMNS[s.name]) throw new Error(`groupingColumns: no frozen column set for sector "${s.name}"`);
  for (const name of Object.keys(SECTOR_COLUMNS)) if (!sectorByName.has(name)) throw new Error(`groupingColumns: frozen column set for unknown sector "${name}"`);
  for (const [name, cols] of Object.entries(SECTOR_COLUMNS)) {
    if (!cols.length || cols.length > 7) throw new Error(`groupingColumns: sector "${name}" has ${cols.length} columns (1-7)`);
    if (cols[0].key !== "revenue") throw new Error(`groupingColumns: sector "${name}" must open on revenue (the default order reads it)`);
  }
}

export function sectorColumnsOf(name) {
  return SECTOR_COLUMNS[name] || null;
}

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
      case "reserveLife": {
        const v = L.reserveLifeYears;
        return v == null ? DASH : { text: `${v.toFixed(1)}`, sort: Number(v.toFixed(3)) };
      }
      case "reserveReplacement":
        return pct(L.reserveReplacement);
      case "pudShare":
        return pct(L.pudShare);
      case "rdIntensity":
        return pct(L.researchDevelopment != null && L.revenue > 0 ? L.researchDevelopment / L.revenue : null);
      case "capexIntensity":
        return pct(L.capex != null && L.revenue > 0 ? Math.abs(L.capex) / L.revenue : null);
      case "inventoryDays": {
        const daily = L.costOfRevenue > 0 ? L.costOfRevenue / 365 : null;
        const d = L.inventory != null && daily ? L.inventory / daily : null;
        // Returned a bare string until 2026-07-26, where every other branch returns {text, sort}:
        // the cell rendered empty and unsortable, so the Semiconductors and Semiconductor Equipment
        // tables had been shipping a blank column. Found by the sector-column measurement, which
        // would otherwise have frozen inventory days into the source as a 0%-answered column.
        return d == null ? DASH : { text: String(Math.round(d)), sort: Math.round(d) };
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

  const list = columns || family?.columns;
  if (!list) throw new Error(`groupingCells: no columns — unknown family "${familyKey}" and no list handed in`);
  return list.map((col) => cellFor(col.key));
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

// `readCounts` appends the members each fragment was read on, e.g. "median operating margin 12.4%
// (read on 604 of 657)". The sector tables set it and the industry tables do not: a median taken
// across a whole sector is a weaker statement than one taken across a single industry, and the count
// is what keeps it honest. The net-debt fragment already states its own denominator.
export function groupLine(columns, cellRows, opts = {}) {
  const parts = [];
  const total = cellRows.length;
  columns.forEach((col, i) => {
    const sorts = cellRows.map((r) => (r[i] ? r[i].sort : null)).filter((v) => v != null);
    if (!sorts.length) return;
    if (col.key === "netDebt") {
      const cash = sorts.filter((v) => v < 0).length;
      parts.push(`${cash} of ${sorts.length} hold net cash`);
      return;
    }
    const m = medianOf(sorts);
    const read = opts.readCounts ? ` (read on ${sorts.length.toLocaleString()} of ${total.toLocaleString()})` : "";
    if (col.type === "money") parts.push(`median ${col.label.toLowerCase()} ${fmtMoney(m, "USD")}${read}`);
    else if (col.type === "num") parts.push(`median ${col.label.toLowerCase()} ${m.toFixed(0)}${read}`);
    else parts.push(`median ${col.label.toLowerCase()} ${(m * 100).toFixed(1)}%${read}`);
  });
  return parts.length ? `As a group: ${parts.join("; ")}.` : null;
}
