#!/usr/bin/env node
// Fetches the European pool (src/data/fundamentals.eu.json) from ESEF Inline-XBRL annual reports,
// automatically — the extraction the EU pool used to do by hand, per name.
//
// Europe has no single filing system like the SEC's EDGAR or Japan's EDINET; each country's issuers
// file with their own national regulator (the "per-country access" problem). filings.xbrl.org — XBRL
// International's free, public filing index — solves it: it aggregates the ESEF filings from across the
// EEA and exposes each as xBRL-JSON (the tagged financial facts) under one JSON:API. Every ESEF filing
// uses the IFRS taxonomy, so the concept map below is the same one the ADR pipeline reads (ifrs-full:*).
//
//   universe.eu.json (curated: ticker → LEI + country + SIC) →  this fetcher  →  fundamentals.eu.json
//
// The universe stays hand-curated (which names, and their SIC, since Europe has no market-cap screener),
// but the FINANCIALS are fetched and parsed automatically, so the pool scales without hand-extraction.
//
// Depth: ESEF became mandatory for FY2020, and filings.xbrl.org holds one annual report per year with
// its comparatives, so the record runs ~5-6 years — the same realistic horizon as the Japanese pool,
// not the SEC pools' ten. It also lags the very latest year until a filing is processed and validated.
//
//   ONLY_EU=MC,OR node scripts/fetchEuFundamentals.mjs   # limit to a few tickers (the rest carry over)
//   EU_DEBUG=MC   node scripts/fetchEuFundamentals.mjs   # dump the concepts a filer actually tags

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compactJson } from "../src/lib/dataFile.mjs";
import { financialKind } from "../src/lib/archetype.mjs";

const dataDir = path.join(process.cwd(), "src", "data");
const BASE = "https://filings.xbrl.org";
// Connection: close on every request. Node's undici throws an uncatchable `assert(!this.paused)` when a
// kept-alive socket is torn down by the server mid-parse (filings.xbrl.org closes connections between
// requests); forcing a fresh connection each time sidesteps the reuse-of-a-dead-socket that triggers it.
const UA = { "User-Agent": process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com", Connection: "close" };
const AJ = { ...UA, Accept: "application/vnd.api+json" };
const THROTTLE_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.env.ONLY_EU || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
const debug = (process.env.EU_DEBUG || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);

// IFRS concept map — the ifrs-full tag(s) that carry each line, priority-ordered (first present wins per
// year). Mirrors the ADR pipeline's IFRS reads (both consume the same taxonomy); the financial lines let
// a European bank or insurer read on its own statements. US-GAAP fallbacks are kept for the handful of
// EEA issuers that file in US-GAAP under the ESEF regime.
const CONCEPTS = {
  // Net-of-excise concepts rank first: a spirits or beer maker reports gross "Revenue" INCLUDING the
  // excise duty it collects as an agent for the state (Diageo £28.0B gross vs £20.2B net; Heineken
  // €34.7B vs €28.7B), and the real top line is the net figure it books under a NetSales / revenue-less-
  // excise line. Only excise filers tag these, so they are a no-op for everyone else, where "Revenue"
  // (the IFRS total) wins.
  revenue: ["NetSales", "RevenueLessExciseTaxExpense", "Revenue", "RevenueFromContractsWithCustomers", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromRenderingOfTransportServices"],
  costOfRevenue: ["CostOfSales", "CostOfGoodsAndServicesSold", "CostOfRevenue"],
  operatingIncome: ["ProfitLossFromOperatingActivities", "OperatingIncomeLoss"],
  // Attributable-to-owners first, then the total (which includes noncontrolling interest) only as a last
  // resort. Diageo tags its attributable line under the ...OrdinaryEquityHolders... variant rather than the
  // standard ...OwnersOfParent, so without it the read falls through to total ProfitLoss and overstates
  // owners' income by the NCI (Diageo FY2025: £2,354m attributable vs £2,538m total, a 7.8% overstatement).
  netIncome: ["ProfitLossAttributableToOwnersOfParent", "ProfitLossAttributableToOrdinaryEquityHoldersOfParentEntity", "ProfitLoss", "NetIncomeLoss"],
  incomeTaxExpense: ["IncomeTaxExpenseContinuingOperations", "IncomeTaxExpenseBenefit"],
  interestExpense: ["FinanceCosts", "InterestExpense", "InterestAndDebtExpense"],
  cashFromOps: ["CashFlowsFromUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivitiesContinuingOperations", "NetCashFlowsFromUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivities"],
  capex: [
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsAndOtherNoncurrentAssets",
    "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets",
    "OperatingInvestmentsClassifiedAsInvestingActivities", // LVMH and other French filers' term for capex
    "PurchaseOfPropertyPlantAndEquipment", "PaymentsToAcquirePropertyPlantAndEquipment",
    "AcquisitionOfPropertyPlantAndEquipment", "PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities",
  ],
  depreciation: [
    "DepreciationAndAmortisationExpense", "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
    "AdjustmentsForDepreciationAndAmortisationExpense", "DepreciationDepletionAndAmortization",
    "AdjustmentsForDepreciationOfPropertyPlantAndEquipment", "DepreciationOfPropertyPlantAndEquipment", "DepreciationPropertyPlantAndEquipment", "Depreciation",
  ],
  dividendsPaid: ["DividendsPaidClassifiedAsFinancingActivities", "DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities", "DividendsPaid", "PaymentsOfDividends"],
  epsBasic: ["BasicEarningsLossPerShare", "BasicEarningsPerShare"],
  // balance sheet (instants)
  totalAssets: ["Assets"],
  currentAssets: ["CurrentAssets", "AssetsCurrent"],
  currentLiabilities: ["CurrentLiabilities", "LiabilitiesCurrent"],
  cashAndEquivalents: ["CashAndCashEquivalents", "CashAndCashEquivalentsAtCarryingValue"],
  receivables: ["TradeAndOtherCurrentReceivables", "CurrentTradeReceivables", "TradeReceivables"],
  inventory: ["Inventories"],
  netPPE: ["PropertyPlantAndEquipment"],
  goodwill: ["Goodwill"],
  equity: ["EquityAttributableToOwnersOfParent", "Equity"],
  longTermDebt: ["NoncurrentBorrowings", "LongtermBorrowings", "NoncurrentPortionOfNoncurrentBorrowings"],
  currentDebt: ["CurrentBorrowings", "ShorttermBorrowings", "CurrentPortionOfNoncurrentBorrowings"],
  sharesDiluted: ["WeightedAverageShares", "WeightedAverageNumberOfOrdinarySharesOutstandingDiluted", "AdjustedWeightedAverageShares"],
  // banks & insurers, so a European financial reads on its own statements (same reconstruction as ADR)
  netInterestIncome: ["InterestIncomeExpenseNet"],
  interestIncomeGross: ["InterestRevenueCalculatedUsingEffectiveInterestMethod", "InterestAndSimilarIncome", "RevenueFromInterest"],
  bankInterestExpense: ["InterestExpense", "InterestAndSimilarExpense", "FinanceCosts"],
  noninterestIncome: ["RevenueFromFeeAndCommissionIncome", "FeeAndCommissionIncome"],
  deposits: ["DepositsFromCustomers", "Deposits"],
  premiumsEarned: ["InsuranceRevenue", "PremiumsRevenue", "RevenueFromInsuranceContractsIssued"],
  investmentIncome: ["RevenueFromDividends", "InvestmentIncome"],
};
// Which lines are flows (income-statement / cash-flow, tagged over a period) vs instants (balance-sheet,
// tagged at a date). Everything not listed here is a flow.
const INSTANTS = new Set(["totalAssets", "currentAssets", "currentLiabilities", "cashAndEquivalents", "receivables", "inventory", "netPPE", "goodwill", "equity", "longTermDebt", "currentDebt", "deposits"]);

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// EBIT proxy when a filer tags no standard operating-income line (LVMH books "profit from recurring
// operations" under an extension): pre-tax profit plus interest ≈ operating income. Returns the reported
// value untouched when present.
function deriveOpInc(op, rev, ni, tax, interest) {
  if (op != null) return op;
  if (ni != null && tax != null) return ni + tax + (interest != null && interest > 0 ? interest : 0);
  return null;
}

// A period string is a duration ("…start…/…end…") for a flow, or a single instant date. The fiscal year
// is the year the period closes in — with the Jan-1 convention normalised: an instant (or duration end)
// dated YYYY-01-01 is midnight of the prior Dec 31, i.e. the (YYYY-1) year-end, not a new year.
function fyOf(period) {
  const isFlow = period.includes("/");
  const end = isFlow ? period.split("/")[1] : period;
  const d = new Date(end);
  let y = d.getUTCFullYear();
  if (d.getUTCMonth() === 0 && d.getUTCDate() === 1) y -= 1; // YYYY-01-01 == (YYYY-1)-12-31
  return { fy: y, isFlow, end };
}
function annualDays(period) {
  if (!period.includes("/")) return 0;
  const [a, b] = period.split("/");
  return (new Date(b) - new Date(a)) / 86400000;
}

// Parse one filing's xBRL-JSON into { fy → { concept → value } } for the consolidated (no-dimension)
// facts. Rejects any fact carrying a segment/member axis (more than the four base dimensions), so a
// business-unit or geographic breakdown never displaces the group total.
function parseFacts(json, wantConcepts) {
  const facts = json?.facts || {};
  const byFy = {}; // fy → concept → { value, unit }
  const currencies = {};
  for (const id of Object.keys(facts)) {
    const f = facts[id];
    const d = f?.dimensions;
    if (!d || !("concept" in d) || !("period" in d)) continue;
    if (Object.keys(d).some((k) => k !== "concept" && k !== "entity" && k !== "period" && k !== "unit")) continue; // segment axis → skip
    const unit = d.unit || "";
    const isMoney = /^iso4217:/.test(unit), isShares = unit === "xbrli:shares";
    if (!isMoney && !isShares) continue; // skip text/ratio facts
    const concept = String(d.concept).replace(/^[^:]+:/, "");
    const line = wantConcepts[concept];
    if (!line) continue;
    const { fy, isFlow } = fyOf(d.period);
    if (INSTANTS.has(line) === isFlow) continue; // flow line needs a duration; instant line needs an instant
    if (isFlow && (annualDays(d.period) < 330 || annualDays(d.period) > 400)) continue; // annual only, not a quarter/half
    const v = num(f.value);
    if (v == null) continue;
    if (isMoney) currencies[unit.slice(8)] = (currencies[unit.slice(8)] || 0) + 1;
    byFy[fy] = byFy[fy] || {};
    // First tag with data wins the year within this filing (concept lists are priority-ordered); a fact
    // already set by a higher-priority concept for this line is left alone.
    if (!(line in byFy[fy]) || wantConceptRank(wantConcepts, concept) < wantConceptRank(wantConcepts, byFy[fy][`__c_${line}`]))
      { byFy[fy][line] = v; byFy[fy][`__c_${line}`] = concept; byFy[fy][`__u_${line}`] = unit; }
  }
  const currency = Object.keys(currencies).sort((a, b) => currencies[b] - currencies[a])[0] || "EUR";
  return { byFy, currency };
}
// Priority rank of a concept within its line's list (lower = higher priority). Used so a higher-priority
// tag isn't overwritten by a lower one within a single filing.
const _rankCache = new Map();
function wantConceptRank(wantConcepts, concept) {
  if (!concept) return 999;
  const key = concept;
  if (_rankCache.has(key)) return _rankCache.get(key);
  const line = wantConcepts[concept];
  const r = line ? (CONCEPTS[line] || []).indexOf(concept) : 999;
  _rankCache.set(key, r < 0 ? 999 : r);
  return _rankCache.get(key);
}

// concept → line reverse map
const CONCEPT_LINE = {};
for (const [line, tags] of Object.entries(CONCEPTS)) for (const t of tags) if (!(t in CONCEPT_LINE)) CONCEPT_LINE[t] = line;

// Node's undici throws an UNCATCHABLE `assert(!this.paused)` from a TLS socket torn down mid-parse — it
// surfaces on the socket, not the fetch promise, so a try/catch can't see it. Swallow that specific
// assertion at the process level (re-throwing anything else) so one dead socket doesn't kill an
// otherwise-idempotent run; the orphaned request's own timeout then rejects it, and the retry re-fetches.
process.on("uncaughtException", (e) => {
  if (e && (e.code === "ERR_ASSERTION" || /this\.paused/.test(e.message || ""))) { process.stderr.write("  · recovered from an undici socket teardown\n"); return; }
  throw e;
});

async function getJSON(url, accept) {
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await fetch(url, { headers: accept === "api" ? AJ : UA, signal: AbortSignal.timeout(20_000) });
      if (r.status === 429) { await sleep(1000 * a); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(400 * a); }
  }
  return null;
}

async function fetchEntity(u) {
  const lei = u.lei;
  const list = await getJSON(`${BASE}/api/entities/${encodeURIComponent(lei)}/filings?page[size]=25`, "api");
  await sleep(THROTTLE_MS);
  const filings = (list?.data || []).map((f) => f.attributes).filter((a) => a && a.json_url && a.period_end)
    .sort((a, b) => a.period_end.localeCompare(b.period_end)); // oldest first, so newer filings' restated values win
  if (!filings.length) return null;

  // Merge every filing's facts into one fy → line map; a later (more recent) filing overwrites an
  // earlier one's value for the same year, picking up restatements.
  const merged = {}; // fy → line → value
  const units = {};  // fy → line → unit
  const currencies = {};
  let anchorEnd = null, anchorFy = null, sourceUrl = null;
  for (const f of filings) {
    const json = await getJSON(BASE + f.json_url, "raw");
    await sleep(THROTTLE_MS);
    if (!json) continue;
    if (debug.includes(u.ticker)) dumpConcepts(u.ticker, json, f);
    const { byFy, currency } = parseFacts(json, CONCEPT_LINE);
    currencies[currency] = (currencies[currency] || 0) + 1;
    for (const fy of Object.keys(byFy)) {
      merged[fy] = merged[fy] || {};
      units[fy] = units[fy] || {};
      for (const k of Object.keys(byFy[fy])) {
        if (k.startsWith("__")) continue;
        const nv = byFy[fy][k], ov = merged[fy][k];
        // Don't let a later filing collapse a good revenue to under a tenth of itself — that is a mis-tag
        // (Brunello Cucinelli's 2025 filing leaves the consolidated Revenue near-empty and puts the real
        // €1.4B under a related-parties axis), not a restatement, which stays within a sane band.
        if (k === "revenue" && ov != null && ov > 0 && nv != null && nv < ov * 0.1) continue;
        merged[fy][k] = nv; // otherwise the later filing wins (restatements)
        units[fy][k] = byFy[fy][`__u_${k}`];
      }
    }
    // The most recent filing's own reporting year anchors the record's fy/period/source.
    if (!anchorEnd || f.period_end > anchorEnd) { anchorEnd = f.period_end; anchorFy = new Date(f.period_end).getUTCFullYear(); sourceUrl = BASE + (f.viewer_url || f.report_url || f.json_url); }
  }
  const currency = Object.keys(currencies).sort((a, b) => currencies[b] - currencies[a])[0] || "EUR";
  return { merged, units, currency, anchorFy, anchorEnd, sourceUrl };
}

// Assemble the standard record from the merged fy→line map. Shares come out as whole numbers; money in
// the reporting currency's base unit. deriveOpInc fills a missing operating line; totalDebt sums the
// current and non-current borrowing lines.
function buildRecord(u, e) {
  // Null a revenue that collapsed to under a tenth of the prior good year — a consolidated line left
  // near-empty by a mis-tag (the newest filing, with no earlier value for the merge guard to protect),
  // never a real 90%+ drop. Frees the headline below to fall back to the last complete year.
  const chron = Object.keys(e.merged).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < chron.length; i++) {
    const cur = e.merged[chron[i]], prev = e.merged[chron[i - 1]];
    if (cur?.revenue != null && prev?.revenue != null && prev.revenue > 0 && cur.revenue < prev.revenue * 0.1) cur.revenue = null;
  }
  const fys = Object.keys(e.merged).map(Number).filter((y) => y >= 2000 && y <= (e.anchorFy || 9999)).sort((a, b) => a - b).slice(-11);
  const lineOf = (fy) => {
    const m = e.merged[fy] || {};
    const debt = (m.longTermDebt != null || m.currentDebt != null) ? (m.longTermDebt || 0) + (m.currentDebt || 0) : null;
    return {
      revenue: m.revenue ?? null,
      operatingIncome: deriveOpInc(m.operatingIncome ?? null, m.revenue ?? null, m.netIncome ?? null, m.incomeTaxExpense ?? null, m.interestExpense ?? null),
      netIncome: m.netIncome ?? null,
      interestExpense: m.interestExpense ?? null,
      incomeTaxExpense: m.incomeTaxExpense ?? null,
      costOfRevenue: m.costOfRevenue ?? null,
      cashFromOps: m.cashFromOps ?? null,
      capex: m.capex ?? null,
      depreciation: m.depreciation ?? null,
      dividendsPaid: m.dividendsPaid ?? null,
      epsBasic: m.epsBasic ?? null,
      // Share count: many ESEF filers tag no weighted-average share number, only EPS — so where it is
      // absent, derive it from attributable net income ÷ basic EPS, which is the weighted-average count by
      // identity. Falls back to null when neither the tag nor a usable EPS is present.
      sharesDiluted: m.sharesDiluted ?? (m.netIncome != null && m.epsBasic ? Math.round(m.netIncome / m.epsBasic) : null),
      stockholdersEquity: m.equity ?? null,
      totalAssets: m.totalAssets ?? null,
      currentAssets: m.currentAssets ?? null,
      currentLiabilities: m.currentLiabilities ?? null,
      cashAndEquivalents: m.cashAndEquivalents ?? null,
      receivables: m.receivables ?? null,
      inventory: m.inventory ?? null,
      netPPE: m.netPPE ?? null,
      goodwill: m.goodwill ?? null,
      totalDebt: debt,
      // financial lines (null for non-financials)
      netInterestIncome: m.netInterestIncome ?? null,
      noninterestIncome: m.noninterestIncome ?? null,
      deposits: m.deposits ?? null,
      premiumsEarned: m.premiumsEarned ?? null,
      investmentIncome: m.investmentIncome ?? null,
    };
  };
  const history = fys.map((fy) => ({ fy, lines: lineOf(fy) }));
  const hasTop = (l) => l.revenue != null || ((l.netInterestIncome || 0) + (l.noninterestIncome || 0)) > 0 || ((l.premiumsEarned || 0) + (l.investmentIncome || 0)) > 0;
  // Headline year: the latest with a real top line, so a malformed or not-yet-tagged latest year falls
  // back to the last complete one rather than heading a blank page.
  const headFy = [...fys].reverse().find((fy) => hasTop(lineOf(fy))) ?? (fys.length ? fys[fys.length - 1] : null);
  const latest = headFy != null ? lineOf(headFy) : {};
  const periodEnd = headFy == null ? (e.anchorEnd || null) : (headFy === e.anchorFy && e.anchorEnd ? e.anchorEnd : `${headFy}-12-31`);
  return {
    ticker: u.ticker, name: u.name, market: u.market || "ESEF", currency: e.currency, country: u.country || null,
    isin: u.isin || null, lei: u.lei, sic: u.sic || null, accountingStandard: "IFRS",
    fy: headFy, periodEnd,
    form: "ESEF (Inline XBRL)", sourceUrl: e.sourceUrl || null,
    lines: latest, history,
  };
}

function dumpConcepts(ticker, json, f) {
  const facts = json?.facts || {};
  const seen = {};
  for (const id of Object.keys(facts)) {
    const d = facts[id]?.dimensions; if (!d) continue;
    if (Object.keys(d).some((k) => !["concept", "entity", "period", "unit"].includes(k))) continue;
    if (!/^iso4217:/.test(d.unit || "")) continue;
    const c = String(d.concept).replace(/^[^:]+:/, "");
    if (!seen[c]) seen[c] = num(facts[id].value);
  }
  console.log(`\n=== EU_DEBUG ${ticker} filing ${f.period_end}: money concepts (sample values, €M) ===`);
  for (const c of Object.keys(seen).sort()) if (Math.abs(seen[c]) > 1e6) console.log(`  ${c.padEnd(60)} ${(seen[c] / 1e6).toFixed(0)}`);
}

// A record earns a page only if it clears the same floor the other pools use: a positive top line plus
// at least one earnings figure. topLineRevenue reconstructs a bank/insurer top line from its components.
function passesFloor(rec) {
  const L = rec.lines || {};
  const fk = financialKind(rec);
  let top = L.revenue;
  if (fk === "bank") { const r = (L.netInterestIncome || 0) + (L.noninterestIncome || 0); if (r > (top || 0)) top = r; }
  if (fk === "insurer") { const r = (L.premiumsEarned || 0) + (L.investmentIncome || 0); if (r > (top || 0)) top = r; }
  if (!(top != null && top > 0)) return false;
  if (L.netIncome == null && L.cashFromOps == null) return false;
  return true;
}

async function main() {
  const universe = JSON.parse(fs.readFileSync(path.join(dataDir, "universe.eu.json"), "utf8"));
  const rows = (universe.tickers || []).filter((u) => u.lei);
  console.log(`EU fundamentals: ${rows.length} entities from universe.eu.json`);
  const fresh = [];
  const withheld = new Set();
  for (const u of rows) {
    if (only.length && !only.includes(u.ticker.toUpperCase())) continue;
    const e = await fetchEntity(u);
    if (!e || !Object.keys(e.merged).length) { console.warn(`  ! ${u.ticker}: no ESEF filings/facts resolved`); withheld.add(u.ticker); continue; }
    const rec = buildRecord(u, e);
    if (passesFloor(rec)) { fresh.push(rec); console.log(`  ✓ ${u.ticker} (${rec.currency}, ${rec.history.length}y, FY${rec.fy})`); }
    else { withheld.add(u.ticker); console.log(`  ⊘ ${u.ticker}: withheld (below the quality floor)`); }
  }

  // Carry over the last good file: a targeted run (ONLY_EU) fetches a few names, and a full run can drop
  // one to a transient error — the rest must survive. Overlay the fresh records and write the union,
  // dropping only names no longer in the universe. A WITHHELD name keeps its prior record too: a fetch
  // that came back empty or below the floor is a statement about today's fetch, not about the good
  // record already on file — deleting it would turn a transient parse failure into a vanished company
  // (the JP fetcher's carry rule; docs/correctness-campaign.md N6). The prior record's own staleness is
  // auditCoverage's stranded-names check to flag, loudly, not this writer's to erase silently.
  let prior = [];
  try { prior = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.eu.json"), "utf8")).companies || []; } catch { /* first run */ }
  const inUniverse = new Set(rows.map((u) => u.ticker.toUpperCase()));
  const byTicker = new Map(prior.filter((c) => inUniverse.has(String(c.ticker).toUpperCase())).map((c) => [c.ticker, c]));
  for (const t of withheld) if (byTicker.has(t)) console.warn(`  ↩ ${t}: today's fetch withheld — carrying the prior record (FY${byTicker.get(t).fy})`);
  for (const r of fresh) byTicker.set(r.ticker, r);
  const companies = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const carried = companies.length - fresh.length;
  fs.writeFileSync(path.join(dataDir, "fundamentals.eu.json"), compactJson({
    asOf: new Date().toISOString().slice(0, 10),
    source: "Company ESEF annual reports (Inline XBRL) via filings.xbrl.org — XBRL International's free filing index; parsed from the IFRS xBRL-JSON facts.",
    market: "EU", currency: "mixed",
    note: "European issuers filing ESEF Inline-XBRL, one record per company, ~5-6 years (ESEF began FY2020). Fetched by scripts/fetchEuFundamentals.mjs from universe.eu.json.",
    companies,
  }));
  console.log(`\n✅ Wrote ${companies.length} EU companies (${fresh.length} fetched, ${carried} carried over, ${withheld.size} withheld)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n${err.stack}`); process.exit(1); });
}

export { parseFacts, fyOf, annualDays, deriveOpInc, CONCEPTS, CONCEPT_LINE };
