#!/usr/bin/env node
// Build-time fundamentals for the ADR pool — foreign companies listed on a US exchange, which file
// Form 20-F (or 40-F) with the SEC. Their XBRL sits on the same EDGAR companyfacts API as a 10-K, so
// this reuses that pipe; the differences it must handle, learned in part from the EDINET work:
//
//   1. Taxonomy. Most file in IFRS (the `ifrs-full` namespace: Revenue, ProfitLoss, Assets…), but a
//      foreign private issuer MAY report in US-GAAP instead. So every concept lists BOTH the IFRS and
//      the US-GAAP tags, and the reader searches both namespaces — whichever the filer used wins.
//   2. Currency. They report in their home currency (EUR, TWD, CHF, GBP…), so the reporting currency
//      is detected from the data, not assumed to be USD, and carried on the record so the page formats
//      it correctly (the components are already currency-aware from the JP pool).
//   3. Forms. Annual is 20-F/40-F (a full-year duration, like a 10-K); interim is the irregular 6-K,
//      so the quarterly/Current-Position data is thin or annual-only for ADRs — handled gracefully.
//
// Output is src/data/fundamentals.adr.json in the SAME record shape as the US data, so the record,
// Current Position and scorecard components render it unchanged. Same quality floor: a name that can't
// render a non-broken page is withheld, not faked.
//
//   npm run fetch:fundamentals:adr
//
// Needs outbound access to sec.gov / data.sec.gov. Free, no key. Runs unattended in CI.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { passesQualityFloor } from "../src/lib/fundamentals.mjs";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 150;
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IFRS first, US-GAAP second: a concept is found in whichever namespace the filer reports in.
const NAMESPACES = ["ifrs-full", "us-gaap"];
// Annual = 20-F / 40-F / 10-K (a foreign issuer occasionally files a 10-K); interim = 6-K / 10-Q.
const ANNUAL_FORMS = ["20-F", "40-F", "10-K"];
const INTERIM_FORMS = ["6-K", "10-Q"];
const isForm = (form, set) => !!form && set.some((f) => form.startsWith(f));
const isAnyForm = (form) => isForm(form, ANNUAL_FORMS) || isForm(form, INTERIM_FORMS);

// Each concept carries both taxonomies' tags. The first tag present (searched IFRS then US-GAAP) wins,
// so an IFRS filer reads its IFRS line and a US-GAAP filer falls through to the US-GAAP one.
const CONCEPTS = {
  // income statement
  revenue: ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  costOfRevenue: ["CostOfSales", "CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["ProfitLossFromOperatingActivities", "OperatingIncomeLoss"],
  netIncome: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss", "NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  incomeTaxExpense: ["IncomeTaxExpenseContinuingOperations", "IncomeTaxExpenseBenefit"],
  interestExpense: ["FinanceCosts", "InterestExpense", "InterestExpenseNonoperating", "InterestAndDebtExpense"],
  // cash flow
  cashFromOps: ["CashFlowsFromUsedInOperatingActivities", "NetCashFlowsFromUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsAndOtherNoncurrentAssets", "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  depreciation: ["DepreciationAndAmortisationExpense", "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss", "DepreciationDepletionAndAmortization", "DepreciationAndAmortization"],
  dividendsPaid: ["DividendsPaidClassifiedAsFinancingActivities", "DividendsPaid", "PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  buybacks: ["PaymentsToAcquireOrRedeemEntitysShares", "PaymentsForRepurchaseOfCommonStock"],
  // balance sheet (instants)
  totalAssets: ["Assets"],
  currentAssets: ["CurrentAssets", "AssetsCurrent"],
  totalLiabilities: ["Liabilities"],
  currentLiabilities: ["CurrentLiabilities", "LiabilitiesCurrent"],
  cashAndEquivalents: ["CashAndCashEquivalents", "CashAndCashEquivalentsAtCarryingValue"],
  shortTermInvestments: ["CurrentInvestments", "OtherCurrentFinancialAssets", "ShortTermInvestments", "MarketableSecuritiesCurrent"],
  receivables: ["TradeAndOtherCurrentReceivables", "CurrentTradeReceivables", "TradeReceivables", "AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  inventory: ["Inventories", "InventoryNet"],
  accountsPayable: ["TradeAndOtherCurrentPayables", "CurrentTradePayables", "TradePayables", "AccountsPayableCurrent"],
  equity: ["EquityAttributableToOwnersOfParent", "Equity", "StockholdersEquity"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["IntangibleAssetsOtherThanGoodwill", "IntangibleAssetsNetExcludingGoodwill"],
  // debt families (current / non-current)
  longTermDebt: ["NoncurrentBorrowings", "LongtermBorrowings", "NoncurrentPortionOfNoncurrentBorrowings", "LongTermDebtNoncurrent", "LongTermDebt"],
  currentDebt: ["CurrentBorrowings", "ShorttermBorrowings", "CurrentPortionOfNoncurrentBorrowings", "LongTermDebtCurrent", "DebtCurrent"],
  leaseLiabilities: ["LeaseLiabilities", "LeaseLiabilitiesCurrent", "OperatingLeaseLiabilityCurrent"],
  deferredRevenueCurrent: ["CurrentContractLiabilities", "ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"],
  // shares (unit "shares")
  sharesDiluted: ["WeightedAverageShares", "AdjustedWeightedAverageShares", "WeightedAverageNumberOfOrdinarySharesOutstandingDiluted", "WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"],
  sharesOutstanding: ["NumberOfSharesOutstanding", "CommonStockSharesOutstanding"],
  // --- banks & insurers, so a Shinhan or an Aegon reads on its own statements like a US financial.
  // IFRS first, US-GAAP fallback; null for non-financials. The insurance lines span the IFRS 17
  // transition (InsuranceRevenue/ServiceExpenses) and the older presentation (PremiumsRevenue), so
  // both are listed. Net interest income is income less expense for most IFRS banks, so interest
  // income is captured and the bank lens nets it against InterestExpense (already above).
  netInterestIncome: ["InterestIncomeExpenseNet", "RevenueFromInterest", "InterestRevenueCalculatedUsingEffectiveInterestMethod", "InterestIncome", "InterestAndSimilarIncome"],
  noninterestIncome: ["RevenueFromFeeAndCommissionIncome", "FeeAndCommissionIncome", "NoninterestIncome", "RevenueFromDividends"],
  noninterestExpense: ["NoninterestExpense", "AdministrativeExpense"],
  provisionForCreditLosses: ["ImpairmentLossRecognisedInProfitOrLossLoansAndAdvances", "ImpairmentLossOnFinancialAssetsNet", "AllowanceForCreditLossesFinancialAssets", "ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses", "ProvisionForCreditLossExpenseReversal"],
  deposits: ["DepositsFromCustomers", "DepositsFromBanks", "Deposits"],
  premiumsEarned: ["InsuranceRevenue", "PremiumsRevenue", "RevenueFromInsuranceContractsIssued", "PremiumsEarnedNet", "PremiumsEarnedNetPropertyAndCasualty"],
  claimsIncurred: ["InsuranceServiceExpensesFromInsuranceContractsIssued", "InsuranceClaimsAndBenefitsPaidNetOfReinsuranceRecoveries", "InsuranceClaimsAndBenefitsPaid", "PolicyholderBenefitsAndClaimsIncurredNet", "IncurredClaimsPropertyCasualtyAndLiability"],
  investmentIncome: ["NetInvestmentIncome", "InvestmentIncome", "InvestmentRevenue"],
  lossReserves: ["LiabilitiesUnderInsuranceContractsAndReinsuranceContractsIssued", "InsuranceContractLiabilities", "LiabilityForClaimsAndClaimsAdjustmentExpense", "LiabilityForFuturePolicyBenefits"],
};

async function getJSON(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (a === 4) throw err;
      await sleep(500 * a);
    }
  }
}

const days = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);

// All observation rows for a tag, searched across both namespaces; the first namespace that has the
// tag wins (IFRS before US-GAAP), so a single concept list spans both standards.
function rowsFor(facts, tags, unit) {
  for (const tag of tags) {
    for (const ns of NAMESPACES) {
      const u = facts?.facts?.[ns]?.[tag]?.units?.[unit];
      if (u && u.length) return u;
    }
  }
  return null;
}

// Detect the reporting currency: the 3-letter currency unit carrying the most observations on the
// core monetary concepts. Foreign issuers report in EUR/TWD/CHF/GBP/JPY; some in USD.
function detectCurrency(facts) {
  const probes = ["Assets", "Revenue", "Equity", "ProfitLoss", "Liabilities", "Revenues", "NetIncomeLoss"];
  const counts = {};
  for (const ns of NAMESPACES) {
    const g = facts?.facts?.[ns];
    if (!g) continue;
    for (const tag of probes) {
      const units = g[tag]?.units;
      if (!units) continue;
      for (const k of Object.keys(units)) if (/^[A-Z]{3}$/.test(k)) counts[k] = (counts[k] || 0) + units[k].length;
    }
  }
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return ranked[0] || "USD";
}
// Which standard the filer used, for the record's label.
function detectStandard(facts) {
  const ifrs = facts?.facts?.["ifrs-full"], gaap = facts?.facts?.["us-gaap"];
  const n = (g) => (g ? Object.keys(g).length : 0);
  return n(ifrs) >= n(gaap) && n(ifrs) > 0 ? "IFRS" : "US-GAAP";
}

// Annual (full-year duration) value per fiscal year, latest filing winning a restatement.
function annualByYear(facts, tags, unit) {
  const units = rowsFor(facts, tags, unit);
  if (!units) return {};
  const out = {};
  for (const u of units) {
    if (!u.form || !isForm(u.form, ANNUAL_FORMS) || !u.start || !u.end) continue;
    const dur = days(u.start, u.end);
    if (dur < 350 || dur > 380) continue;
    const fy = new Date(u.end).getUTCFullYear();
    if (!(fy in out) || (u.filed || "") > (out[fy].filed || "")) out[fy] = { val: u.val, end: u.end, filed: u.filed || "", form: u.form };
  }
  return out;
}
function instantByYear(facts, tags, unit) {
  const units = rowsFor(facts, tags, unit);
  if (!units) return {};
  const out = {};
  for (const u of units) {
    if (!u.form || !isAnyForm(u.form) || !u.end || u.start) continue;
    const fy = new Date(u.end).getUTCFullYear();
    // Prefer the annual (fiscal year-end) instant; a 6-K interim only fills a year with no annual.
    const annual = isForm(u.form, ANNUAL_FORMS);
    const cur = out[fy];
    if (!cur || (annual && !cur.annual) || ((annual === !!cur.annual) && (u.filed || "") > cur.filed))
      out[fy] = { val: u.val, end: u.end, filed: u.filed || "", annual };
  }
  return out;
}
const valuesByYear = (by) => Object.fromEntries(Object.entries(by).map(([fy, e]) => [fy, e.val]));
const latestEntry = (by) => { const fys = Object.keys(by).map(Number); if (!fys.length) return null; const fy = Math.max(...fys); return { ...by[fy], fy }; };
const pickAnnual = (facts, tags, unit) => latestEntry(annualByYear(facts, tags, unit));
const pickInstant = (facts, tags, unit) => latestEntry(instantByYear(facts, tags, unit));
const collectAnnual = (facts, tags, unit) => valuesByYear(annualByYear(facts, tags, unit));
const collectInstant = (facts, tags, unit) => valuesByYear(instantByYear(facts, tags, unit));

function durations(facts, tags, unit) {
  const units = rowsFor(facts, tags, unit);
  if (!units) return [];
  return units.filter((u) => u.form && u.start && u.end && isAnyForm(u.form)).map((u) => ({ val: u.val, start: u.start, end: u.end, dur: days(u.start, u.end), filed: u.filed || "" }));
}
// TTM(flow) = latest full-year if the freshest period is a year; else prior FY + YTD − prior-year YTD.
function ttmFlow(facts, tags, unit) {
  const all = durations(facts, tags, unit);
  if (!all.length) return null;
  const maxEnd = all.reduce((m, e) => (new Date(e.end) > new Date(m) ? e.end : m), all[0].end);
  const cur = all.filter((e) => e.end === maxEnd).sort((a, b) => b.dur - a.dur || b.filed.localeCompare(a.filed))[0];
  if (!cur) return null;
  if (cur.dur >= 350 && cur.dur <= 380) return { val: cur.val, asOf: cur.end, isFY: true };
  const prevEnd = new Date(cur.end); prevEnd.setUTCFullYear(prevEnd.getUTCFullYear() - 1);
  const prevStr = prevEnd.toISOString().slice(0, 10);
  const priorYTD = all.filter((e) => Math.abs(days(e.end, prevStr)) <= 25 && Math.abs(e.dur - cur.dur) <= 30).sort((a, b) => b.filed.localeCompare(a.filed))[0];
  const priorFY = all.filter((e) => e.dur >= 350 && e.dur <= 380 && Math.abs(days(e.end, cur.start)) <= 50).sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (priorYTD && priorFY) return { val: priorFY.val + cur.val - priorYTD.val, asOf: cur.end, isFY: false };
  const fy = all.filter((e) => e.dur >= 350 && e.dur <= 380).sort((a, b) => new Date(b.end) - new Date(a.end))[0];
  return fy ? { val: fy.val, asOf: fy.end, isFY: true } : null;
}
function latestObservation(facts, tags, unit, instant = false) {
  const units = rowsFor(facts, tags, unit);
  if (!units) return null;
  let best = null;
  for (const u of units) {
    if (!u.form || !u.end || (instant ? !!u.start : !u.start) || !isAnyForm(u.form)) continue;
    if (!best || new Date(u.end) > new Date(best.end) || (u.end === best.end && (u.filed || "") > best.filed)) best = { val: u.val, end: u.end, filed: u.filed || "", form: u.form };
  }
  return best;
}
function instantMap(facts, tags, unit) {
  const units = rowsFor(facts, tags, unit);
  if (!units) return {};
  const out = {}, filed = {};
  for (const u of units) {
    if (!u.form || !u.end || u.start || !isAnyForm(u.form)) continue;
    const f = u.filed || "";
    if (!(u.end in out) || f >= (filed[u.end] || "")) { out[u.end] = u.val; filed[u.end] = f; }
  }
  return out;
}
function quarterFlowMap(facts, tags, unit) {
  const units = rowsFor(facts, tags, unit);
  if (!units) return {};
  const out = {}, filed = {};
  for (const u of units) {
    if (!u.form || !u.start || !u.end || !isAnyForm(u.form)) continue;
    const dur = days(u.start, u.end);
    if (dur < 80 || dur > 100) continue;
    const f = u.filed || "";
    if (!(u.end in out) || f >= (filed[u.end] || "")) { out[u.end] = u.val; filed[u.end] = f; }
  }
  return out;
}
function quarterSeries(facts, n = 8) {
  const ca = instantMap(facts, CONCEPTS.currentAssets), cl = instantMap(facts, CONCEPTS.currentLiabilities), cash = instantMap(facts, CONCEPTS.cashAndEquivalents);
  const rev = quarterFlowMap(facts, CONCEPTS.revenue), ni = quarterFlowMap(facts, CONCEPTS.netIncome), oi = quarterFlowMap(facts, CONCEPTS.operatingIncome);
  const ends = [...new Set([...Object.keys(ca), ...Object.keys(rev)])].sort();
  return ends.map((end) => ({ end, currentAssets: ca[end] ?? null, currentLiabilities: cl[end] ?? null, cash: cash[end] ?? null, revenue: rev[end] ?? null, netIncome: ni[end] ?? null, operatingIncome: oi[end] ?? null }))
    .filter((q) => q.currentAssets != null || q.revenue != null).slice(-n);
}

const maxOf = (...xs) => { const v = xs.filter((x) => x != null && isFinite(x)); return v.length ? Math.max(...v) : null; };
// revenue − total operating costs, or the reported operating line; mirrors the US deriveOpInc intent.
function deriveOpInc(opInc, rev, ni, tax, interest) {
  if (opInc != null) return opInc;
  if (ni != null && tax != null && interest != null) return ni + tax + interest;
  return null;
}

async function tickerCikMap() {
  const j = await getJSON("https://www.sec.gov/files/company_tickers.json");
  const m = new Map();
  for (const k in j) { const r = j[k]; if (r?.ticker && r?.cik_str) m.set(String(r.ticker).toUpperCase(), String(r.cik_str).padStart(10, "0")); }
  return m;
}

async function main() {
  const universe = JSON.parse(fs.readFileSync(path.join(dataDir, "universe.adr.json"), "utf8"));
  const names = new Map((universe.tickers || []).map((t) => [String(t.ticker).toUpperCase(), t]));
  console.log(`ADR fundamentals: ${names.size} tickers`);
  const only = (process.env.ONLY_ADR || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);

  let cikMap;
  try { cikMap = await tickerCikMap(); } catch (e) { console.error(`❌ ticker→CIK map failed: ${e.message}`); process.exit(1); }

  const companies = []; const withheld = new Set();
  for (const [ticker, meta] of names) {
    if (only.length && !only.includes(ticker)) continue;
    const cik = cikMap.get(ticker.replace(/-/g, "")) || cikMap.get(ticker);
    if (!cik) { console.warn(`  ! ${ticker}: no CIK in SEC map (not an SEC filer?), skipping`); continue; }
    await sleep(THROTTLE_MS);
    let facts;
    try { facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); }
    catch (e) { console.warn(`  ! ${ticker}: companyfacts ${e.message}`); continue; }
    if (!facts || !facts.facts) { console.warn(`  ! ${ticker}: no XBRL facts`); continue; }

    const ccy = detectCurrency(facts);
    const standard = detectStandard(facts);
    const sic = String(facts.sic || meta.sic || "");
    const a = (tags) => pickAnnual(facts, tags, ccy)?.val ?? null;
    const inst = (tags) => latestObservation(facts, tags, ccy, true)?.val ?? null;

    const ha = Object.fromEntries(Object.keys(CONCEPTS).map((k) => [k, collectAnnual(facts, CONCEPTS[k], ccy)]));
    const hi = Object.fromEntries(["totalAssets", "currentAssets", "currentLiabilities", "totalLiabilities", "cashAndEquivalents", "shortTermInvestments", "receivables", "inventory", "accountsPayable", "equity", "goodwill", "intangibleAssets", "longTermDebt", "currentDebt", "deposits", "lossReserves"].map((k) => [k, collectInstant(facts, CONCEPTS[k], ccy)]));
    const shAnnual = collectAnnual(facts, CONCEPTS.sharesDiluted, "shares");
    const shInstant = collectInstant(facts, CONCEPTS.sharesOutstanding, "shares");

    const anchor = pickAnnual(facts, CONCEPTS.revenue, ccy) || pickAnnual(facts, CONCEPTS.netIncome, ccy);
    const years = [...new Set([...Object.keys(ha.revenue), ...Object.keys(ha.netIncome)])].map(Number).sort((x, y) => x - y).slice(-10);
    const debtYear = (fy) => maxOf((hi.longTermDebt[fy] != null || hi.currentDebt[fy] != null) ? (hi.longTermDebt[fy] || 0) + (hi.currentDebt[fy] || 0) : null);
    const history = years.map((fy) => ({
      fy,
      lines: {
        revenue: ha.revenue[fy] ?? null,
        operatingIncome: deriveOpInc(ha.operatingIncome[fy] ?? null, ha.revenue[fy] ?? null, ha.netIncome[fy] ?? null, ha.incomeTaxExpense[fy] ?? null, ha.interestExpense[fy] ?? null),
        interestExpense: ha.interestExpense[fy] ?? null,
        incomeTaxExpense: ha.incomeTaxExpense[fy] ?? null,
        netIncome: ha.netIncome[fy] ?? null,
        costOfRevenue: ha.costOfRevenue[fy] ?? null,
        cashFromOps: ha.cashFromOps[fy] ?? null,
        capex: ha.capex[fy] ?? null,
        depreciation: ha.depreciation[fy] ?? null,
        dividendsPaid: ha.dividendsPaid[fy] ?? null,
        buybacks: ha.buybacks[fy] ?? null,
        totalDebt: debtYear(fy),
        stockholdersEquity: hi.equity[fy] ?? null,
        cashAndEquivalents: hi.cashAndEquivalents[fy] ?? null,
        shortTermInvestments: hi.shortTermInvestments[fy] ?? null,
        receivables: hi.receivables[fy] ?? null,
        inventory: hi.inventory[fy] ?? null,
        accountsPayable: hi.accountsPayable[fy] ?? null,
        currentAssets: hi.currentAssets[fy] ?? null,
        currentLiabilities: hi.currentLiabilities[fy] ?? null,
        totalAssets: hi.totalAssets[fy] ?? null,
        goodwill: hi.goodwill[fy] ?? null,
        intangibleAssets: hi.intangibleAssets[fy] ?? null,
        // financial (banks/insurers) lines — null for industrials, so the financialKind-routed
        // scorecards read a foreign bank or insurer on its own statements.
        netInterestIncome: ha.netInterestIncome[fy] ?? null,
        noninterestIncome: ha.noninterestIncome[fy] ?? null,
        noninterestExpense: ha.noninterestExpense[fy] ?? null,
        provisionForCreditLosses: ha.provisionForCreditLosses[fy] ?? null,
        deposits: hi.deposits[fy] ?? null,
        premiumsEarned: ha.premiumsEarned[fy] ?? null,
        claimsIncurred: ha.claimsIncurred[fy] ?? null,
        investmentIncome: ha.investmentIncome[fy] ?? null,
        lossReserves: hi.lossReserves[fy] ?? null,
        sharesDiluted: shAnnual[fy] ?? shInstant[fy] ?? null,
      },
    }));

    const tf = (tags) => ttmFlow(facts, tags, ccy)?.val ?? null;
    const ttmRev = ttmFlow(facts, CONCEPTS.revenue, ccy);
    const ttm = ttmRev ? {
      asOf: ttmRev.asOf, isFY: ttmRev.isFY,
      lines: {
        revenue: ttmRev.val,
        operatingIncome: deriveOpInc(tf(CONCEPTS.operatingIncome), ttmRev.val, tf(CONCEPTS.netIncome), tf(CONCEPTS.incomeTaxExpense), tf(CONCEPTS.interestExpense)),
        interestExpense: tf(CONCEPTS.interestExpense), netIncome: tf(CONCEPTS.netIncome), incomeTaxExpense: tf(CONCEPTS.incomeTaxExpense),
        cashFromOps: tf(CONCEPTS.cashFromOps), capex: tf(CONCEPTS.capex), costOfRevenue: tf(CONCEPTS.costOfRevenue), depreciation: tf(CONCEPTS.depreciation),
        totalDebt: maxOf((inst(CONCEPTS.longTermDebt) != null || inst(CONCEPTS.currentDebt) != null) ? (inst(CONCEPTS.longTermDebt) || 0) + (inst(CONCEPTS.currentDebt) || 0) : null),
        currentAssets: inst(CONCEPTS.currentAssets), currentLiabilities: inst(CONCEPTS.currentLiabilities), currentDebt: inst(CONCEPTS.currentDebt),
        stockholdersEquity: inst(CONCEPTS.equity), cashAndEquivalents: inst(CONCEPTS.cashAndEquivalents), shortTermInvestments: inst(CONCEPTS.shortTermInvestments),
        receivables: inst(CONCEPTS.receivables), inventory: inst(CONCEPTS.inventory), accountsPayable: inst(CONCEPTS.accountsPayable),
        totalAssets: inst(CONCEPTS.totalAssets), goodwill: inst(CONCEPTS.goodwill), intangibleAssets: inst(CONCEPTS.intangibleAssets),
        netInterestIncome: tf(CONCEPTS.netInterestIncome), noninterestIncome: tf(CONCEPTS.noninterestIncome), noninterestExpense: tf(CONCEPTS.noninterestExpense),
        provisionForCreditLosses: tf(CONCEPTS.provisionForCreditLosses), deposits: inst(CONCEPTS.deposits),
        premiumsEarned: tf(CONCEPTS.premiumsEarned), claimsIncurred: tf(CONCEPTS.claimsIncurred), investmentIncome: tf(CONCEPTS.investmentIncome), lossReserves: inst(CONCEPTS.lossReserves),
        sharesDiluted: pickInstant(facts, CONCEPTS.sharesOutstanding, "shares")?.val ?? latestObservation(facts, CONCEPTS.sharesDiluted, "shares", false)?.val ?? null,
      },
    } : null;

    const lq = latestObservation(facts, CONCEPTS.currentAssets, ccy, true) || latestObservation(facts, CONCEPTS.totalAssets, ccy, true);
    const quarterly = lq ? {
      asOf: lq.end, form: isForm(lq.form, ANNUAL_FORMS) ? "annual" : "interim",
      balance: {
        cash: inst(CONCEPTS.cashAndEquivalents), shortTermInvestments: inst(CONCEPTS.shortTermInvestments), receivables: inst(CONCEPTS.receivables),
        inventory: inst(CONCEPTS.inventory), currentAssets: inst(CONCEPTS.currentAssets), accountsPayable: inst(CONCEPTS.accountsPayable), currentDebt: inst(CONCEPTS.currentDebt),
        deferredRevenueCurrent: inst(CONCEPTS.deferredRevenueCurrent), currentLiabilities: inst(CONCEPTS.currentLiabilities), longTermDebt: inst(CONCEPTS.longTermDebt),
        operatingLeaseCurrent: inst(CONCEPTS.leaseLiabilities), totalLiabilities: inst(CONCEPTS.totalLiabilities), totalAssets: inst(CONCEPTS.totalAssets),
        stockholdersEquity: inst(CONCEPTS.equity), goodwill: inst(CONCEPTS.goodwill), intangibleAssets: inst(CONCEPTS.intangibleAssets),
        sharesOutstanding: pickInstant(facts, CONCEPTS.sharesOutstanding, "shares")?.val ?? null,
      },
      series: quarterSeries(facts),
    } : null;

    const rec = {
      ticker, name: meta.name || facts.entityName || ticker, cik, sic,
      market: "ADR", currency: ccy, country: meta.country || null, accountingStandard: standard,
      fy: anchor?.fy ?? null, periodEnd: anchor?.end ?? null, form: anchor?.form || "20-F",
      sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=20-F`,
      lines: history.length ? history[history.length - 1].lines : {},
      history, ttm, quarterly,
    };
    if (passesQualityFloor(rec)) { companies.push(rec); console.log(`  ✓ ${ticker} (${ccy}, ${standard}, FY${rec.fy ?? "?"})`); }
    else { withheld.add(ticker); console.log(`  ⊘ ${ticker}: withheld (below quality floor)`); }
  }

  companies.sort((a, b) => a.ticker.localeCompare(b.ticker));
  fs.writeFileSync(path.join(dataDir, "fundamentals.adr.json"), JSON.stringify({
    asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR companyfacts (Form 20-F/40-F; IFRS or US-GAAP)", sample: false, companies,
  }, null, 2) + "\n");
  console.log(`\n✅ Wrote ${companies.length} ADR companies (${withheld.size} withheld)`);
}

export { rowsFor, detectCurrency, detectStandard, annualByYear, instantByYear, quarterSeries, latestObservation, CONCEPTS };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
