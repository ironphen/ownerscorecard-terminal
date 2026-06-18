#!/usr/bin/env node
// Build-time fundamentals pipeline for Japanese equities (a separate pool from the US
// universe). Reads src/data/universe.jp.json, finds each company's latest annual
// securities report (有価証券報告書) on EDINET, Japan's EDGAR, parses the filing's
// own XBRL-derived CSV, and writes src/data/fundamentals.jp.json in the same record
// shape the US pipeline produces, plus currency/market fields.
//
//   npm run fetch:fundamentals:jp
//
// Needs an EDINET API v2 key in EDINET_API_KEY (free registration at the EDINET site;
// the old keyless v1 is retired). Runs unattended in CI (.github/workflows/fundamentals-jp.yml).
//
// Why CSV, not raw XBRL: EDINET's document API serves a CSV rendering of the filing
// (type=5) with an explicit consolidated-vs-individual column, far more robust to parse
// than the Japanese XBRL taxonomy across three accounting standards. The Japanese-language
// narrative (business, risks) is not read here; this pool is quantitative by design.
//
// Why no dependencies: the CSV arrives inside a ZIP, which we read with Node's built-in
// zlib, so the pipeline stays dependency-free like the US one. The element-name → line-item
// map below is first-pass and refined against real output via EDINET_DEBUG=<ticker>.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const API = "https://api.edinet-fsa.go.jp/api/v2";
const KEY = process.env.EDINET_API_KEY || "";
const THROTTLE_MS = Number(process.env.EDINET_THROTTLE_MS || 350);
// ~3.3 years, enough to reach each company's FY-3 annual report, whose cash-flow statement
// carries FY-3 and FY-4 capex. With the latest filing (FY, FY-1) and the FY-1 and FY-2 reports
// in between, that fills the whole five-year window the summary covers for everything else.
const LOOKBACK_DAYS = Number(process.env.EDINET_LOOKBACK_DAYS || 3400);
// How many older annual reports to pull per company for the deeper capex history (each carries
// two years), beyond the latest. Three covers the five-year window.
const CAPEX_BACKFILL = Number(process.env.EDINET_CAPEX_BACKFILL || 3);
const DEBUG = (process.env.EDINET_DEBUG || "").split(",").map((s) => s.trim()).filter(Boolean);
// Limit the run to a few tickers (comma-separated) for a fast, cheap test; blank = all.
const ONLY_JP = (process.env.ONLY_JP || "").split(",").map((s) => s.trim()).filter(Boolean);

const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- minimal, dependency-free ZIP reader (stored + deflate) -------------------------
// EDINET's type=5 download is a standard ZIP of CSV files. We walk the central directory
// and inflate each entry with zlib. No ZIP64 (filings are far under 4GB).
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip (no end-of-central-directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const lNameLen = buf.readUInt16LE(lho + 26);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else { off += 46 + nameLen + extraLen + commentLen; continue; }
    out.push({ name, data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Decode an EDINET CSV buffer to text, auto-detecting the encoding rather than assuming
// one: a UTF-16 BOM (either endianness), a UTF-8 BOM, or, lacking a BOM, a NUL-byte census
// that tells UTF-16 from UTF-8. EDINET ships these as UTF-16, but detecting keeps the
// pipeline from silently parsing nothing if that ever changes.
export function decodeCsv(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le", 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString("utf16le"); }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString("utf8", 3);
  let nul = 0;
  const lim = Math.min(buf.length, 4096);
  for (let i = 0; i < lim; i++) if (buf[i] === 0) nul++;
  return nul > lim / 4 ? buf.toString("utf16le") : buf.toString("utf8");
}

// ---- CSV (TSV) parse ----------------------------------------------------------------
// EDINET type=5 files are UTF-16LE, tab-separated, with a Japanese header row. We parse
// by column position (stable across the language): element id, item name, context id,
// relative year, consolidated/individual, period/instant, unit id, unit, value.
const COL = { element: 0, context: 2, consol: 4, period: 5, unit: 6, value: 8 };

// contextId → { relYear, instant }, accepting only the clean primary-statement contexts
// (current and the four prior years, consolidated or its non-consolidated twin). Segment
// and other dimensional contexts carry extra member suffixes and are rejected.
const CONTEXT_RE = /^(CurrentYear|Prior(\d)Year)(Duration|Instant)(_NonConsolidatedMember)?$/;
function readContext(id) {
  const m = CONTEXT_RE.exec(id);
  if (!m) return null;
  return { relYear: m[1] === "CurrentYear" ? 0 : -Number(m[2]), instant: m[3] === "Instant" };
}

const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, "").trim();
  if (!t || t === "－" || t === "-" || t === "—") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
// EDINET wraps every CSV field in double quotes ("110054000000", "CurrentYearDuration"),
// so each cell must be unquoted before use, or numbers parse as NaN and contexts never match.
const cell = (s) => {
  if (s == null) return "";
  let t = s.trim();
  if (t.length >= 2 && t.charCodeAt(0) === 34 && t.charCodeAt(t.length - 1) === 34) t = t.slice(1, -1).replace(/""/g, '"');
  return t;
};
// The consolidated/individual column: 連結 (consolidated) is preferred; the five-year summary
// and entity-info elements carry その他 (other), which is the only flavour they come in.
const CONSOL_RANK = { "連結": 3, "その他": 2, "": 2, "個別": 1, "非連結": 1 };

// Parse one filing's CSV text into a fact store: localName → "relYear|instant" → { val, rank }.
// Consolidated figures win over individual; the latest filing's own CSV is self-consistent.
export function parseFacts(text, store = {}) {
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split("\t");
    if (row.length <= COL.value) continue;
    const ctx = readContext(cell(row[COL.context]));
    if (!ctx) continue;
    const val = num(cell(row[COL.value]));
    if (val == null) continue;
    const local = cell(row[COL.element]).split(":").pop();
    const rank = CONSOL_RANK[cell(row[COL.consol])] ?? 0;
    const key = `${ctx.relYear}|${ctx.instant ? "i" : "d"}`;
    const slot = (store[local] ||= {});
    if (!slot[key] || rank > slot[key].rank) slot[key] = { val, rank };
  }
  return store;
}

// ---- element-name → line-item map (first pass; refine via EDINET_DEBUG) -------------
// Candidates in priority order, local names only (prefix stripped). Covers J-GAAP
// (jppfs/jpcrp), IFRS (…IFRS), and the standardised five-year summary (…SummaryOfBusinessResults),
// which is how we reach back five years from a single annual report.
// IFRS variants come first in every list. An IFRS filer also reports its parent-company
// J-GAAP statements (NetSales, OperatingIncome, Assets…) at a small fraction of the
// consolidated figure, so the consolidated IFRS line must win the pick. A J-GAAP filer
// simply lacks the IFRS elements and falls through to them. The …SummaryOfBusinessResults
// elements carry the five-year history.
const DUR = {
  // Revenue is picked standard-aware (see REVENUE_IFRS / REVENUE_JGAAP below), not from one blended
  // list: an IFRS filer's J-GAAP NetSales is its parent-only figure, a fraction of consolidated, so
  // it must never fill an IFRS filer's revenue — the bug that made Toyota's older years read a third
  // of actual while net income and assets stayed consolidated and correct.
  sga: ["SellingGeneralAndAdministrativeExpensesIFRS", "SellingGeneralAndAdministrativeExpenses"],
  researchDevelopment: ["ResearchAndDevelopmentExpensesIFRS", "ResearchAndDevelopmentExpenses", "ResearchAndDevelopmentExpensesSGA"],
  goodwillImpairment: ["ImpairmentLossesOfGoodwillIFRS", "ImpairmentLossOfGoodwill", "ImpairmentLossesIFRS", "ImpairmentLossIFRS", "ImpairmentLoss", "LossOnImpairmentOfFixedAssets"],
  operatingIncome: ["OperatingProfitLossIFRS", "OperatingIncomeIFRS", "OperatingProfitIFRS", "OperatingIncome", "OperatingIncomeLoss"],
  ordinaryIncome: ["ProfitLossBeforeTaxIFRS", "ProfitLossBeforeTaxIFRSSummaryOfBusinessResults", "OrdinaryIncome", "OrdinaryIncomeLossSummaryOfBusinessResults", "OrdinaryIncomeLoss"],
  netIncome: ["ProfitLossAttributableToOwnersOfParentIFRS", "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults", "ProfitLossAttributableToOwnersOfParent", "ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults", "NetIncomeLossSummaryOfBusinessResults", "ProfitLossIFRS", "ProfitLoss"],
  costOfRevenue: ["CostOfSalesIFRS", "CostOfSales"],
  grossProfit: ["GrossProfitIFRS", "GrossProfit"],
  interestExpense: ["InterestExpenseOnFinancialDebtInterestExpenseIFRS", "InterestExpensesIFRS", "FinanceCostsIFRS", "InterestExpensesAndInterestOnBondsNOE", "InterestExpensesNOE", "InterestExpenses"],
  cashFromOps: ["NetCashProvidedByUsedInOperatingActivitiesIFRS", "CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults", "CashFlowsFromUsedInOperatingActivitiesIFRS", "NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults"],
  // Capex is the investing-cashflow purchase of PP&E. J-GAAP filers tag it with the InvCF
  // suffix and split between PP&E-only (PurchaseOfPropertyPlantAndEquipmentInvCF, Capcom)
  // and a combined PP&E + intangibles line (…AndIntangibleAssetsInvCF, Nintendo); IFRS
  // filers use the IFRS variants. PP&E-only names come first so they win where both exist.
  capex: ["PurchaseOfPropertyPlantAndEquipmentInvCFIFRS", "PaymentsForPurchaseOfPropertyPlantAndEquipmentIFRS", "PaymentsForPropertyPlantAndEquipmentIFRS", "PaymentsToAcquirePropertyPlantAndEquipmentIFRS", "AcquisitionOfPropertyPlantAndEquipmentInvCFIFRS", "PurchaseOfPropertyPlantAndEquipmentIFRS", "PurchaseOfPropertyPlantAndEquipmentInvCF", "PurchaseOfPropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipmentInvestmentActivities", "PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCFIFRS", "PaymentsForAcquisitionOfPropertyPlantAndEquipmentAndIntangibleAssetsIFRS", "PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCF", "AdditionsToFixedAssetsExcludingEquipmentLeasedToOthersInvCFIFRS", "PaymentsForAdditionsToFixedAssetsExcludingEquipmentLeasedToOthersIFRS", "AdditionsToPropertyPlantAndEquipmentInvCFIFRS", "PaymentsForAdditionsToPropertyPlantAndEquipmentIFRS", "PurchaseOfFixedAssetsInvCF"],
  depreciation: ["DepreciationAndAmortizationOpeCFIFRS", "DepreciationAndAmortisationOpeCFIFRS", "DepreciationAndAmortizationOpeCF", "DepreciationAndAmortization"],
  dividendsPaid: ["DividendsPaidFinCFIFRS", "DividendsPaidFinCF", "CashDividendsPaidFinCF", "DividendsFromSurplus"],
  // Buyback cash (the trading houses return heavily this way, part of the Berkshire thesis).
  buybacks: ["PaymentsForPurchaseOfTreasurySharesFinCFIFRS", "PurchaseOfTreasurySharesSSIFRS", "PurchaseOfTreasuryStockFinCF", "PurchaseOfTreasuryStock"],
  sbc: ["ShareBasedPaymentsOpeCFIFRS", "ShareBasedCompensationExpensesSGA"],
};
const INST = {
  stockholdersEquity: ["EquityAttributableToOwnersOfParentIFRS", "EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults", "EquityAttributableToOwnersOfParent", "ShareholdersEquity", "NetAssets", "TotalNetAssets", "NetAssetsSummaryOfBusinessResults"],
  totalAssets: ["AssetsIFRS", "TotalAssetsIFRSSummaryOfBusinessResults", "Assets", "TotalAssetsSummaryOfBusinessResults"],
  cashAndEquivalents: ["CashAndCashEquivalentsIFRS", "CashAndCashEquivalents", "CashAndDeposits"],
  shortTermInvestments: ["ShortTermInvestmentSecurities", "SecuritiesCA", "MarketableSecurities"],
  currentAssets: ["CurrentAssetsIFRS", "CurrentAssets"],
  currentLiabilities: ["CurrentLiabilitiesIFRS", "CurrentLiabilities"],
  receivables: ["TradeAndOtherReceivablesCAIFRS", "TradeAndOtherReceivablesIFRS", "NotesAndAccountsReceivableTrade", "NotesAndAccountsReceivableTradeAndContractAssets"],
  inventory: ["InventoriesIFRS", "Inventories", "MerchandiseAndFinishedGoods"],
  accountsPayable: ["TradeAndOtherPayablesCLIFRS", "TradeAndOtherPayablesIFRS", "NotesAndAccountsPayableTrade"],
  goodwill: ["GoodwillIFRS", "Goodwill"],
};
// Interest-bearing debt is split across many accounts and differs by standard, so total
// debt sums one family or the other, never both: an IFRS filer also carries its parent
// J-GAAP loan accounts, and adding both would double-count.
const DEBT_IFRS = ["BondsAndBorrowingsCLIFRS", "BondsAndBorrowingsNCLIFRS", "BondsAndBorrowingsIFRS", "BondsAndLoansPayableCLIFRS", "BondsAndLoansPayableNCLIFRS", "BorrowingsCurrentIFRS", "BorrowingsNonCurrentIFRS", "ShortTermBorrowingsIFRS", "LongTermBorrowingsIFRS", "ShortTermDebtIFRS", "LongTermDebtIFRS", "CurrentPortionOfBondsAndBorrowingsIFRS", "CurrentPortionOfLongTermDebtIFRS", "BondsPayableIFRS", "CommercialPapersIFRS", "LeaseLiabilitiesCLIFRS", "LeaseLiabilitiesNCLIFRS"];
const DEBT_JGAAP = ["ShortTermLoansPayable", "CurrentPortionOfLongTermLoansPayable", "CurrentPortionOfBonds", "CommercialPapersLiabilities", "ShortTermBondsPayable", "LongTermLoansPayable", "BondsPayable", "LeaseObligationsCL", "LeaseObligationsNCL"];
const SHARES = ["NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIssuedSharesTotalNumberOfSharesEtc", "TotalNumberOfIssuedSharesSummaryOfBusinessResults"];
const EPS = ["BasicEarningsPerShareIFRSSummaryOfBusinessResults", "BasicEarningsLossPerShareSummaryOfBusinessResults", "BasicEarningsPerShareIFRS", "BasicEarningsLossPerShare"];
// Revenue, standard-aware. An IFRS filer reports consolidated revenue under the IFRS elements and
// also carries parent-only J-GAAP NetSales at a fraction of it; a J-GAAP filer has only the latter
// (consolidated, resolved by CONSOL_RANK). Picking by the filer's standard stops the parent-only
// line ever standing in for the consolidated one — what corrupted older years for IFRS names.
const REVENUE_IFRS = ["RevenueIFRS", "RevenueIFRSSummaryOfBusinessResults", "NetSalesIFRS", "NetSalesIFRSSummaryOfBusinessResults", "SalesRevenuesIFRS", "RevenuesIFRS"];
const REVENUE_JGAAP = ["NetSales", "NetSalesSummaryOfBusinessResults", "OperatingRevenuesSummaryOfBusinessResults", "OperatingRevenue1", "OperatingRevenue2", "Revenue", "RevenueSummaryOfBusinessResults"];

// Pick the first candidate with a value for the given relative year and instant/duration.
function picker(store) {
  const get = (local, relYear, instant) => store[local]?.[`${relYear}|${instant ? "i" : "d"}`]?.val ?? null;
  const first = (cands, relYear, instant) => {
    for (const c of cands) { const v = get(c, relYear, instant); if (v != null) return v; }
    return null;
  };
  return { get, first };
}

function debtForYear(store, relYear, isIFRS) {
  const { get } = picker(store);
  const sumOf = (parts) => {
    let sum = 0, any = false;
    for (const p of parts) { const v = get(p, relYear, true); if (v != null) { sum += v; any = true; } }
    return any ? sum : null;
  };
  // IFRS filers report borrowings under the IFRS family; some, though, still tag the
  // J-GAAP-named loan accounts (Hitachi), so fall back to those when the IFRS family is
  // absent. One family or the other, never summed together, so nothing double-counts.
  return isIFRS ? (sumOf(DEBT_IFRS) ?? sumOf(DEBT_JGAAP)) : sumOf(DEBT_JGAAP);
}

// An IFRS filer carries the IFRS consolidated elements; this selects the IFRS debt and revenue
// families and is surfaced on the record so the page can name the standard.
function isIFRSStore(store) {
  return !!(store.RevenueIFRS || store.AssetsIFRS || store.OperatingProfitLossIFRS || store.EquityAttributableToOwnersOfParentIFRS);
}

// One fiscal year's lines from a fact store, picking by the filer's standard. Standalone so older
// annual reports can be read with the very same logic to deepen the history — each report carries
// its own five-year summary, and its own current year is the cleanest read of that year.
function linesFromStore(store, relYear) {
  const { first } = picker(store);
  const isIFRS = isIFRSStore(store);
  const d = (k) => first(DUR[k], relYear, false);
  const i = (k) => first(INST[k], relYear, true);
  const capex = d("capex");
  const eps = first(EPS, relYear, false);
  const ni = d("netIncome");
  const sharesDirect = first(SHARES, relYear, true) ?? first(SHARES, relYear, false);
  const shares = sharesDirect ?? (eps && ni != null ? Math.round(ni / eps) : null);
  return {
    revenue: first(isIFRS ? REVENUE_IFRS : REVENUE_JGAAP, relYear, false),
    operatingIncome: d("operatingIncome"),
    ordinaryIncome: d("ordinaryIncome"),
    netIncome: ni,
    costOfRevenue: d("costOfRevenue"),
    sgaExpense: d("sga"),
    researchDevelopment: d("researchDevelopment"),
    goodwillImpairment: d("goodwillImpairment"),
    interestExpense: d("interestExpense"),
    cashFromOps: d("cashFromOps"),
    capex: capex != null ? Math.abs(capex) : null,
    depreciation: d("depreciation"),
    dividendsPaid: d("dividendsPaid"),
    buybacks: (() => { const v = d("buybacks"); return v != null ? Math.abs(v) : null; })(),
    stockBasedComp: d("sbc"),
    stockholdersEquity: i("stockholdersEquity"),
    totalAssets: i("totalAssets"),
    goodwill: i("goodwill"),
    cashAndEquivalents: i("cashAndEquivalents"),
    shortTermInvestments: i("shortTermInvestments"),
    currentAssets: i("currentAssets"),
    currentLiabilities: i("currentLiabilities"),
    receivables: i("receivables"),
    inventory: i("inventory"),
    accountsPayable: i("accountsPayable"),
    totalDebt: debtForYear(store, relYear, isIFRS),
    sharesDiluted: shares,
    epsBasic: eps,
  };
}

// Assemble one company's record (latest lines + up to five years of history) from the
// fact store. currentFy comes from the filing's period end. Same shape as the US pipeline,
// so the shared compute and components read it unchanged; extra JP-only fields are ignored.
export function buildRecord(store, meta, entry) {
  const fy = meta.fy;
  const isIFRS = isIFRSStore(store);
  const history = [];
  for (let r = -4; r <= 0; r++) {
    const L = linesFromStore(store, r);
    if (L.revenue == null && L.netIncome == null && L.totalAssets == null) continue;
    history.push({ fy: fy + r, lines: L });
  }

  return {
    ticker: entry.ticker,
    name: entry.name,
    market: "JP",
    currency: "JPY",
    edinetCode: meta.edinetCode || null,
    secCode: meta.secCode || null,
    docId: meta.docId || null,
    sector: entry.sector || null,
    industry: entry.industry || null,
    accountingStandard: isIFRS ? "IFRS" : "J-GAAP",
    fy,
    periodEnd: meta.periodEnd || null,
    form: "Annual securities report",
    sourceUrl: "https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx",
    lines: linesFromStore(store, 0),
    history,
    ttm: null,
  };
}

// ---- EDINET API ---------------------------------------------------------------------
async function getJSON(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(1000 * attempt); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(500 * attempt);
    }
  }
}
async function getBuffer(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(1000 * attempt); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(500 * attempt);
    }
  }
}
const withKey = (u) => u + (u.includes("?") ? "&" : "?") + "Subscription-Key=" + encodeURIComponent(KEY);
const ymd = (d) => d.toISOString().slice(0, 10);

// Fetch one filing's type=5 CSV bundle and parse it into a fact store, the same parse the
// latest filing gets. Used to read capex (and depreciation) from a company's older annual
// reports for the deeper history.
async function loadStore(docId) {
  const zipBuf = await getBuffer(withKey(`${API}/documents/${docId}?type=5`));
  const store = {};
  for (const f of unzip(zipBuf)) if (/\.csv$/i.test(f.name)) parseFacts(decodeCsv(f.data), store);
  return store;
}

// The detailed cash-flow lines the five-year summary omits, so they are filled from the older
// filings, two years at a time. CF_KEYS pairs each with its concept list; bump CF_VERSION when
// the set changes so the per-filing cache is rebuilt.
const CF_KEYS = [
  ["capex", "capex", true],          // [history field, DUR concept, take absolute]
  ["depreciation", "depreciation", false],
  ["dividendsPaid", "dividendsPaid", false],
  ["buybacks", "buybacks", true],
];
const CF_VERSION = 2;

// Pull the deeper cash-flow history for one company by walking its older annual reports (each
// carries two years), filling the years the latest filing's five-year summary leaves blank:
// capex and depreciation (so owner earnings run deep), and dividends and buybacks (so the
// capital-allocation record is not read off only the latest two years). Cached per docId in
// cache.cf so an unchanged older filing is parsed once.
async function deepenCashFlow(rec, reports, cache) {
  const missing = rec.history.filter((h) => h.lines.capex == null || h.lines.dividendsPaid == null);
  if (!missing.length || reports.length < 2) return 0;
  cache.cf ||= {};
  const byFy = {}; // fy -> { capex, depreciation, dividendsPaid, buybacks }
  for (let ri = 1; ri < reports.length && ri <= CAPEX_BACKFILL; ri++) {
    const r = reports[ri];
    let cf = cache.cf[r.docId];
    if (!cf) {
      cf = {};
      try {
        await sleep(THROTTLE_MS);
        const { first } = picker(await loadStore(r.docId));
        const rfy = r.periodEnd ? Number(r.periodEnd.slice(0, 4)) : null;
        if (rfy != null) for (const rel of [0, -1]) {
          const row = {};
          let any = false;
          for (const [field, concept, abs] of CF_KEYS) {
            const v = first(DUR[concept], rel, false);
            row[field] = v != null ? (abs ? Math.abs(v) : v) : null;
            if (v != null) any = true;
          }
          if (any) cf[rfy + rel] = row;
        }
      } catch (err) { console.warn(`    ! older filing ${r.docId}: ${err.message}`); }
      cache.cf[r.docId] = cf;
    }
    for (const fy in cf) {
      const o = (byFy[fy] ||= {});
      for (const [field] of CF_KEYS) if (o[field] == null && cf[fy][field] != null) o[field] = cf[fy][field];
    }
  }
  let patched = 0;
  for (const h of rec.history) {
    const o = byFy[h.fy];
    if (!o) continue;
    for (const [field] of CF_KEYS) {
      if (h.lines[field] == null && o[field] != null) { h.lines[field] = o[field]; if (field === "capex") patched++; }
    }
  }
  return patched;
}

// Deepen the history beyond the five years a single filing's summary reaches. Each older annual
// report carries its own five-year summary, so the oldest reports in the window extend the record
// toward ten years — and an older filing's own current year is the clean consolidated read, so this
// also fills the early years the standard-aware revenue pick had to leave blank (an IFRS filer whose
// older summary lacked an IFRS revenue element). Fetches at most HISTORY_BACKFILL of the oldest
// reports; a year already held in full is kept, a revenue-blank year is upgraded.
const HISTORY_TARGET = Number(process.env.EDINET_HISTORY_YEARS || 10);
const HISTORY_FETCH_MAX = Number(process.env.EDINET_HISTORY_FETCH_MAX || 8);
async function deepenHistory(rec, reports, cache) {
  if (reports.length < 2) return 0;
  const byFy = new Map(rec.history.map((h) => [h.fy, h]));
  const oldestWanted = rec.fy - (HISTORY_TARGET - 1);
  const wantFull = (y) => y >= oldestWanted && y <= rec.fy && !(byFy.get(y)?.lines.revenue != null);
  // Load the in-window older filings (newest first, bounded). Each filing's own current and prior
  // years are face-statement figures, consolidated and reliable, unlike the deep years of a
  // five-year summary, which some filers (an IFRS adopter before its transition, a conglomerate)
  // tag parent-only or not at all. So fill from current years first, then prior, then the summary
  // as a last resort, newest filing winning. This both reaches ~ten years and repairs the years the
  // latest filing's summary left wrong or blank.
  const stores = [];
  for (const r of reports) {
    if (stores.length >= HISTORY_FETCH_MAX) break;
    if (r.docId === rec.docId) continue; // the latest filing is already built into rec
    const rfy = r.periodEnd ? Number(r.periodEnd.slice(0, 4)) : null;
    if (rfy == null || rfy < oldestWanted) continue; // too old to even be a current year we want
    if (![0, -1, -2, -3, -4].some((rel) => wantFull(rfy + rel))) continue;
    try { await sleep(THROTTLE_MS); stores.push({ rfy, store: await loadStore(r.docId) }); }
    catch (err) { console.warn(`    ! older filing ${r.docId}: ${err.message}`); }
  }
  let added = 0;
  const fill = (rfy, store, rel) => {
    const y = rfy + rel;
    if (!wantFull(y)) return;
    const L = linesFromStore(store, rel);
    if (L.revenue == null && L.netIncome == null && L.totalAssets == null) return;
    const ex = byFy.get(y);
    if (ex) ex.lines = L; else { const h = { fy: y, lines: L }; rec.history.push(h); byFy.set(y, h); }
    added++;
  };
  for (const rel of [0, -1, -2, -3, -4]) for (const { rfy, store } of stores) fill(rfy, store, rel);
  if (added) { rec.history.sort((a, b) => a.fy - b.fy); rec.history = rec.history.slice(-HISTORY_TARGET); }
  return added;
}

// Crawl the daily document index back LOOKBACK_DAYS (incrementally, using the cached
// last-crawled date) and record each universe company's latest annual securities report
// (docTypeCode 120), matched by securities code. EDINET has no per-issuer endpoint, so a
// dated crawl is the way in; the cache means only the first run pays the full backfill.
async function discover(secToTicker, cache) {
  const today = new Date();
  const targetEarliest = new Date(today.getTime() - LOOKBACK_DAYS * 86400000);
  // Migrate a pre-deepening cache (one latest report per ticker) to the array format by
  // starting the crawl fresh; the backfill below then rebuilds the full window once.
  const probe = cache.byTicker && Object.values(cache.byTicker)[0];
  if (probe && !Array.isArray(probe)) { cache.byTicker = {}; cache.lastDate = null; cache.crawledFrom = null; }
  const byTicker = cache.byTicker || {};

  const record = (ticker, r, ds) => {
    const list = (byTicker[ticker] ||= []);
    const periodEnd = r.periodEnd || r.submitDateTime || ds;
    const meta = { docId: r.docID, edinetCode: r.edinetCode, secCode: String(r.secCode), periodEnd: r.periodEnd || null, submit: r.submitDateTime || null };
    const ex = list.find((x) => (x.periodEnd || "") === periodEnd);
    if (!ex) list.push(meta);
    else if ((r.submitDateTime || "") > (ex.submit || "")) Object.assign(ex, meta); // an amendment supersedes
  };
  let crawled = 0;
  const crawlDay = async (ds) => {
    try {
      const list = await getJSON(withKey(`${API}/documents.json?date=${ds}&type=2`));
      for (const r of list.results || []) {
        if (r.docTypeCode !== "120" || r.secCode == null) continue; // annual securities report only
        const ticker = secToTicker[String(r.secCode)];
        if (ticker) record(ticker, r, ds);
      }
      crawled++;
    } catch (err) { console.warn(`  ! ${ds}: ${err.message}`); }
    await sleep(THROTTLE_MS);
  };

  // The cache tracks the crawled date range [crawledFrom, lastDate]. Crawl forward to today,
  // then backfill the gap down to targetEarliest once (the deep history a single run pays for).
  const haveFrom = cache.crawledFrom ? new Date(cache.crawledFrom) : null;
  const haveTo = cache.lastDate ? new Date(cache.lastDate) : null;
  for (let day = new Date(haveTo ? haveTo.getTime() + 86400000 : targetEarliest.getTime()); day <= today; day = new Date(day.getTime() + 86400000)) await crawlDay(ymd(day));
  const backStop = haveFrom || haveTo; // the earliest date crawled so far, if any
  if (backStop && targetEarliest < backStop) {
    for (let day = new Date(backStop.getTime() - 86400000); day >= targetEarliest; day = new Date(day.getTime() - 86400000)) await crawlDay(ymd(day));
  }

  for (const t in byTicker) byTicker[t].sort((a, b) => ((a.periodEnd || "") < (b.periodEnd || "") ? 1 : (a.periodEnd || "") > (b.periodEnd || "") ? -1 : 0));
  cache.byTicker = byTicker;
  cache.lastDate = ymd(today);
  cache.crawledFrom = ymd(haveFrom && haveFrom < targetEarliest ? haveFrom : targetEarliest);
  const reports = Object.values(byTicker).reduce((a, l) => a + l.length, 0);
  console.log(`  crawled ${crawled} day(s); ${reports} annual reports for ${Object.keys(byTicker).length}/${Object.keys(secToTicker).length} companies`);
  return byTicker;
}

async function main() {
  if (!KEY) { console.error("\n❌ EDINET_API_KEY is not set (free key from the EDINET site).\n"); process.exit(1); }
  const universe = JSON.parse(fs.readFileSync(path.join(dataDir, "universe.jp.json"), "utf8"));
  const byTickerEntry = Object.fromEntries(universe.tickers.map((t) => [t.ticker, t]));
  // EDINET reports a 5-character securities code: the 4-digit ticker plus a trailing 0.
  const secToTicker = {};
  for (const t of universe.tickers) { secToTicker[t.ticker + "0"] = t.ticker; secToTicker[t.ticker] = t.ticker; }

  const cachePath = path.join(dataDir, "edinet-index.json");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch {}
  // Rebuild the per-filing cash-flow cache when the set of lines we pull from older filings
  // changes (here: dividends and buybacks were added), so the older filings are re-parsed once.
  if (cache.cfV !== CF_VERSION) { cache.cf = {}; cache.cfV = CF_VERSION; }

  console.log("Discovering latest annual reports on EDINET…");
  const found = await discover(secToTicker, cache);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");

  const companies = [];
  for (const entry of universe.tickers) {
    if (ONLY_JP.length && !ONLY_JP.includes(entry.ticker)) continue;
    const reports = found[entry.ticker];
    const hit = reports && reports[0];
    if (!hit) { console.warn(`  ! ${entry.ticker} ${entry.name}: no annual report found in window`); continue; }
    await sleep(THROTTLE_MS);
    let zipBuf;
    try {
      zipBuf = await getBuffer(withKey(`${API}/documents/${hit.docId}?type=5`));
    } catch (err) {
      console.warn(`  ! ${entry.ticker}: CSV download failed (${err.message})`);
      continue;
    }
    let store = {};
    let entries;
    try {
      entries = unzip(zipBuf);
    } catch (err) {
      console.warn(`  ! ${entry.ticker}: unzip failed (${err.message})`);
      continue;
    }
    const isDbg = DEBUG.includes(entry.ticker);
    if (isDbg) console.log(`\n=== EDINET_DEBUG ${entry.ticker} ${entry.name}: ${entries.length} zip entries, doc ${hit.docId} ===`);
    let rawLines = 0;
    for (const f of entries) {
      if (!/\.csv$/i.test(f.name)) { if (isDbg) console.log(`  skip ${f.name}`); continue; }
      const text = decodeCsv(f.data);
      const lines = text.split(/\r?\n/);
      rawLines += lines.length;
      if (isDbg) {
        console.log(`  csv ${f.name}: ${lines.length} lines`);
        for (let k = 0; k <= 3 && k < lines.length; k++) console.log(`     ${k === 0 ? "hdr" : "r" + k}: ${JSON.stringify(lines[k].slice(0, 220))}`);
      }
      parseFacts(text, store);
    }
    const fy = hit.periodEnd ? Number(hit.periodEnd.slice(0, 4)) : (hit.submit ? Number(hit.submit.slice(0, 4)) : null);
    const meta = { fy, periodEnd: hit.periodEnd, edinetCode: hit.edinetCode, secCode: hit.secCode, docId: hit.docId };

    if (isDbg) {
      const names = Object.keys(store).sort();
      // Show the revenue / income / balance-sheet elements (whatever their alphabetical
      // position), with current-year value, so the concept map can be pinned per accounting
      // standard without guessing — IFRS filers name these lines differently from J-GAAP.
      const REL = /revenue|sales|operating|profit|income|asset|equit|cash|loan|bond|borrow|debt|lease|shares|dividend|propert|plant|equipment|purchase|payments|acqui|invest|intangib|depreci|amorti|capital|research|develop|impair|goodwill|selling|administrative/i;
      console.log(`  parsed ${rawLines} raw lines -> ${names.length} elements; revenue/income/balance candidates (current year):`);
      for (const n of names) {
        if (!REL.test(n)) continue;
        const d0 = store[n]["0|d"], i0 = store[n]["0|i"];
        const v = d0 ? d0.val : i0 ? i0.val : null;
        if (v != null) console.log(`    ${n.padEnd(74)} ${v}`);
      }
      console.log("=== end EDINET_DEBUG ===\n");
    }

    const rec = buildRecord(store, meta, byTickerEntry[entry.ticker]);
    const deepened = await deepenCashFlow(rec, reports, cache);
    const deepHist = await deepenHistory(rec, reports, cache);
    companies.push(rec);
    console.log(`  ✓ ${entry.ticker} ${entry.name} (FY${fy ?? "?"}, ${rec.history.length}yr, rev ${rec.lines.revenue ?? "—"}${deepened ? `, +${deepened}yr cf` : ""}${deepHist ? `, +${deepHist}yr hist` : ""})`);
  }

  // Persist the index and the per-filing capex cache filled during the loop, so the next run
  // reuses parsed older filings instead of re-fetching them.
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");

  if (!companies.length) {
    console.error("\n❌ No Japanese companies resolved; preserving the prior file.\n");
    process.exit(1);
  }

  // Carry a company's prior record over a transient failure, keyed on the current universe.
  let prior = {};
  try {
    prior = Object.fromEntries((JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.jp.json"), "utf8")).companies || []).map((c) => [c.ticker, c]));
  } catch {}
  const fresh = Object.fromEntries(companies.map((c) => [c.ticker, c]));
  const merged = [];
  let carried = 0;
  for (const t of universe.tickers) {
    if (fresh[t.ticker]) merged.push(fresh[t.ticker]);
    else if (prior[t.ticker]) { merged.push(prior[t.ticker]); carried++; }
  }

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    source: "EDINET (Financial Services Agency, Japan) — annual securities reports",
    market: "JP",
    currency: "JPY",
    sample: false,
    note: "Latest annual securities-report figures from EDINET, in yen. Quantitative only; the Japanese-language narrative is not parsed.",
    companies: merged,
  };
  fs.writeFileSync(path.join(dataDir, "fundamentals.jp.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ Wrote ${merged.length} Japanese companies (${companies.length} fetched, ${carried} carried over)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
