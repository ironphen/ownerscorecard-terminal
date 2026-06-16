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
const LOOKBACK_DAYS = Number(process.env.EDINET_LOOKBACK_DAYS || 430);
const DEBUG = (process.env.EDINET_DEBUG || "").split(",").map((s) => s.trim()).filter(Boolean);

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
const CONSOL_RANK = { "連結": 3, "": 2, "個別": 1, "非連結": 1 };

// Parse one filing's CSV text into a fact store: localName → "relYear|instant" → { val, rank }.
// Consolidated figures win over individual; the latest filing's own CSV is self-consistent.
export function parseFacts(text, store = {}) {
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split("\t");
    if (row.length <= COL.value) continue;
    const ctx = readContext(row[COL.context]);
    if (!ctx) continue;
    const val = num(row[COL.value]);
    if (val == null) continue;
    const local = String(row[COL.element]).split(":").pop();
    const rank = CONSOL_RANK[row[COL.consol]] ?? 0;
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
const DUR = {
  revenue: ["NetSales", "NetSalesIFRS", "RevenueIFRS", "Revenue", "RevenuesIFRS", "OperatingRevenue1", "OperatingRevenue2", "GrossOperatingRevenueIFRS", "NetSalesSummaryOfBusinessResults", "RevenueIFRSSummaryOfBusinessResults", "NetSalesIFRSSummaryOfBusinessResults", "RevenuesIFRSSummaryOfBusinessResults", "OperatingRevenuesSummaryOfBusinessResults", "RevenueSummaryOfBusinessResults"],
  operatingIncome: ["OperatingIncome", "OperatingIncomeLoss", "OperatingProfitLossIFRS", "OperatingProfitIFRS", "OperatingIncomeIFRS"],
  ordinaryIncome: ["OrdinaryIncome", "OrdinaryIncomeLoss", "OrdinaryIncomeLossSummaryOfBusinessResults", "ProfitLossBeforeTaxIFRS", "ProfitBeforeTaxIFRS", "ProfitLossBeforeTaxIFRSSummaryOfBusinessResults"],
  netIncome: ["ProfitLossAttributableToOwnersOfParent", "ProfitLossAttributableToOwnersOfParentIFRS", "ProfitLoss", "ProfitLossIFRS", "NetIncomeLossSummaryOfBusinessResults", "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults", "ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults"],
  costOfRevenue: ["CostOfSales", "CostOfSalesIFRS"],
  grossProfit: ["GrossProfit", "GrossProfitIFRS"],
  interestExpense: ["InterestExpensesNOE", "InterestExpenses", "InterestExpensesFinancialExpensesIFRS", "FinanceCostsIFRS"],
  cashFromOps: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesIFRS", "CashFlowsFromUsedInOperatingActivitiesIFRS", "NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults", "CashFlowsFromOperatingActivitiesIFRSSummaryOfBusinessResults"],
  capex: ["PurchaseOfPropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipmentInvestmentActivities", "PaymentsForPurchaseOfPropertyPlantAndEquipmentIFRS", "PurchaseOfPropertyPlantAndEquipmentIFRS", "AcquisitionOfPropertyPlantAndEquipmentIFRS"],
  depreciation: ["DepreciationAndAmortizationOpeCF", "DepreciationAndAmortization", "DepreciationAndAmortizationIFRS"],
  dividendsPaid: ["DividendsPaidFinCF", "CashDividendsPaidFinCF", "DividendsPaidIFRS"],
  sbc: ["ShareBasedCompensationExpensesSGA"],
};
const INST = {
  stockholdersEquity: ["EquityAttributableToOwnersOfParent", "EquityAttributableToOwnersOfParentIFRS", "ShareholdersEquity", "NetAssets", "TotalNetAssets", "NetAssetsSummaryOfBusinessResults", "EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults", "ShareholdersEquitySummaryOfBusinessResults"],
  netAssets: ["NetAssets", "TotalNetAssets", "NetAssetsSummaryOfBusinessResults"],
  totalAssets: ["Assets", "TotalAssets", "AssetsIFRS", "TotalAssetsSummaryOfBusinessResults", "AssetsIFRSSummaryOfBusinessResults"],
  cashAndEquivalents: ["CashAndCashEquivalents", "CashAndCashEquivalentsIFRS", "CashAndDeposits"],
  shortTermInvestments: ["ShortTermInvestmentSecurities", "SecuritiesCA", "MarketableSecurities"],
  currentAssets: ["CurrentAssets", "CurrentAssetsIFRS"],
  currentLiabilities: ["CurrentLiabilities", "CurrentLiabilitiesIFRS"],
  receivables: ["NotesAndAccountsReceivableTrade", "TradeAndOtherReceivablesIFRS", "NotesAndAccountsReceivableTradeAndContractAssets"],
  inventory: ["MerchandiseAndFinishedGoods", "Inventories", "InventoriesIFRS"],
  accountsPayable: ["NotesAndAccountsPayableTrade", "TradeAndOtherPayablesIFRS"],
};
// Interest-bearing debt is spread across many Japanese accounts; total debt sums the
// components present (current and non-current loans, bonds, commercial paper, leases).
const DEBT_PARTS = [
  "ShortTermLoansPayable", "CurrentPortionOfLongTermLoansPayable", "CurrentPortionOfBonds", "CommercialPapersLiabilities", "ShortTermBondsPayable",
  "LongTermLoansPayable", "BondsPayable", "LongTermLoansPayableNCL", "ShortTermBorrowingsIFRS", "LongTermBorrowingsIFRS", "BondsAndBorrowingsIFRS",
  "LeaseObligationsCL", "LeaseObligationsNCL", "LeaseLiabilitiesCLIFRS", "LeaseLiabilitiesNCLIFRS",
];
const SHARES = ["NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIssuedSharesTotalNumberOfSharesEtc", "TotalNumberOfIssuedSharesSummaryOfBusinessResults"];
const EPS = ["BasicEarningsLossPerShareSummaryOfBusinessResults", "BasicEarningsPerShareIFRSSummaryOfBusinessResults", "BasicEarningsLossPerShare", "BasicEarningsPerShareIFRS"];

// Pick the first candidate with a value for the given relative year and instant/duration.
function picker(store) {
  const get = (local, relYear, instant) => store[local]?.[`${relYear}|${instant ? "i" : "d"}`]?.val ?? null;
  const first = (cands, relYear, instant) => {
    for (const c of cands) { const v = get(c, relYear, instant); if (v != null) return v; }
    return null;
  };
  return { get, first };
}

function debtForYear(store, relYear) {
  const { get } = picker(store);
  let sum = 0, any = false;
  for (const part of DEBT_PARTS) {
    const v = get(part, relYear, true);
    if (v != null) { sum += v; any = true; }
  }
  return any ? sum : null;
}

// Assemble one company's record (latest lines + up to five years of history) from the
// fact store. currentFy comes from the filing's period end. Same shape as the US pipeline,
// so the shared compute and components read it unchanged; extra JP-only fields are ignored.
export function buildRecord(store, meta, entry) {
  const { first } = picker(store);
  const fy = meta.fy;
  const linesFor = (relYear) => {
    const d = (k) => first(DUR[k], relYear, false);
    const i = (k) => first(INST[k], relYear, true);
    const capex = d("capex");
    const eps = first(EPS, relYear, false);
    const ni = d("netIncome");
    const sharesDirect = first(SHARES, relYear, true) ?? first(SHARES, relYear, false);
    const shares = sharesDirect ?? (eps && ni != null ? Math.round(ni / eps) : null);
    return {
      revenue: d("revenue"),
      operatingIncome: d("operatingIncome"),
      ordinaryIncome: d("ordinaryIncome"),
      netIncome: ni,
      costOfRevenue: d("costOfRevenue"),
      interestExpense: d("interestExpense"),
      cashFromOps: d("cashFromOps"),
      capex: capex != null ? Math.abs(capex) : null,
      depreciation: d("depreciation"),
      dividendsPaid: d("dividendsPaid"),
      stockBasedComp: d("sbc"),
      stockholdersEquity: i("stockholdersEquity"),
      totalAssets: i("totalAssets"),
      cashAndEquivalents: i("cashAndEquivalents"),
      shortTermInvestments: i("shortTermInvestments"),
      currentAssets: i("currentAssets"),
      currentLiabilities: i("currentLiabilities"),
      receivables: i("receivables"),
      inventory: i("inventory"),
      accountsPayable: i("accountsPayable"),
      totalDebt: debtForYear(store, relYear),
      sharesDiluted: shares,
      epsBasic: eps,
    };
  };

  const history = [];
  for (let r = -4; r <= 0; r++) {
    const L = linesFor(r);
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
    fy,
    periodEnd: meta.periodEnd || null,
    form: "Annual securities report",
    sourceUrl: "https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx",
    lines: linesFor(0),
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

// Crawl the daily document index back LOOKBACK_DAYS (incrementally, using the cached
// last-crawled date) and record each universe company's latest annual securities report
// (docTypeCode 120), matched by securities code. EDINET has no per-issuer endpoint, so a
// dated crawl is the way in; the cache means only the first run pays the full backfill.
async function discover(secToTicker, cache) {
  const today = new Date();
  const earliest = new Date(today.getTime() - LOOKBACK_DAYS * 86400000);
  const from = cache.lastDate ? new Date(Math.max(new Date(cache.lastDate).getTime() + 86400000, earliest.getTime())) : earliest;
  const found = cache.byTicker || {};
  let day = new Date(from);
  let crawled = 0;
  while (day <= today) {
    const ds = ymd(day);
    try {
      const list = await getJSON(withKey(`${API}/documents.json?date=${ds}&type=2`));
      for (const r of list.results || []) {
        if (r.docTypeCode !== "120") continue;          // annual securities report only
        if (r.secCode == null) continue;
        const ticker = secToTicker[String(r.secCode)];
        if (!ticker) continue;
        const prev = found[ticker];
        const pend = r.periodEnd || r.submitDateTime || ds;
        if (!prev || pend > (prev.periodEnd || "")) {
          found[ticker] = { docId: r.docID, edinetCode: r.edinetCode, secCode: String(r.secCode), periodEnd: r.periodEnd || null, submit: r.submitDateTime || null };
        }
      }
      crawled++;
    } catch (err) {
      console.warn(`  ! ${ds}: ${err.message}`);
    }
    await sleep(THROTTLE_MS);
    day = new Date(day.getTime() + 86400000);
  }
  cache.byTicker = found;
  cache.lastDate = ymd(today);
  console.log(`  crawled ${crawled} day(s); have annual reports for ${Object.keys(found).length}/${Object.keys(secToTicker).length} companies`);
  return found;
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

  console.log("Discovering latest annual reports on EDINET…");
  const found = await discover(secToTicker, cache);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");

  const companies = [];
  for (const entry of universe.tickers) {
    const hit = found[entry.ticker];
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
      console.log(`  parsed ${rawLines} raw lines -> ${names.length} elements with clean primary-statement contexts`);
      console.log(`  current-year values (first 70 elements):`);
      for (const n of names.slice(0, 70)) {
        const cur = store[n]["0|d"] || store[n]["0|i"];
        if (cur) console.log(`    ${n.padEnd(70)} ${cur.val}`);
      }
      console.log("=== end EDINET_DEBUG ===\n");
    }

    const rec = buildRecord(store, meta, byTickerEntry[entry.ticker]);
    companies.push(rec);
    console.log(`  ✓ ${entry.ticker} ${entry.name} (FY${fy ?? "?"}, rev ${rec.lines.revenue ?? "—"})`);
  }

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
