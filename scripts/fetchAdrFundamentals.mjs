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
  // A bank's interest expense on deposits and borrowings, the cost side of net interest income.
  // Kept separate from the industrial interestExpense above (whose FinanceCosts-first order suits
  // a borrower) so the bank lens nets gross interest income against the right line.
  bankInterestExpense: ["InterestExpense", "InterestAndSimilarExpense", "InterestExpenseOperating", "InterestAndDebtExpense", "FinanceCosts"],
  // cash flow
  // Operating cash, IFRS then US-GAAP. An IFRS filer with discontinued operations tags the net line
  // …OperatingActivitiesContinuingOperations (National Grid, Philips, Prudential, Cosan); a few tag
  // only the shorter CashFlowsFromUsedInOperations (Suncor, Bitdeer). Ordered so the standard net
  // line wins where present and these fill the rest.
  cashFromOps: ["CashFlowsFromUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivitiesContinuingOperations", "NetCashFlowsFromUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations", "CashFlowsFromUsedInOperations"],
  // Capex, IFRS then US-GAAP. Beyond the standard PP&E line, whole industries tag it their own way
  // and otherwise read null: oil & gas as oil-and-gas property, utilities as regulated property, and
  // many filers carry only the "Other" PP&E line. Ordered most-complete-first; first tag with data
  // per year wins, never summed.
  capex: [
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsAndOtherNoncurrentAssets",
    "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets",
    "PurchaseOfPropertyPlantAndEquipment",
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsToAcquireOilAndGasPropertyAndEquipment",
    "PaymentsToAcquireOilAndGasProperty",
    "PaymentsToExploreAndDevelopOilAndGasProperties",
    "PurchaseOfExplorationAndEvaluationAssets",
    "PaymentsForDevelopmentProjectExpenditure",
    "PaymentsToAcquireRegulatedProperty",
    "PaymentsForCapitalImprovements",
    "PaymentsToAcquireMachineryAndEquipment",
    "PaymentsToAcquireOtherPropertyPlantAndEquipment",
  ],
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
  // Asset-heaviness: net PP&E and the lease right-of-use asset (IFRS often folds ROU into PP&E; some
  // report it separately as RightofuseAssets). Separates a capital-intensive operator from an
  // asset-light platform when SIC and margins mislead.
  netPPE: ["PropertyPlantAndEquipment", "PropertyPlantAndEquipmentNet"],
  operatingLeaseAsset: ["RightofuseAssets", "OperatingLeaseRightOfUseAsset"],
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
  // both are listed.
  //
  // Net interest income is the crux. US-GAAP banks tag it net directly (InterestIncomeExpenseNet);
  // IFRS banks almost never do — they tag gross interest income (InterestRevenueCalculatedUsing…)
  // and interest expense as separate lines. So we take the true-net tag when present, otherwise
  // net it ourselves (gross income − bank interest expense, in the line assembly below). Picking
  // the gross figure and calling it "net", as before, doubled the net interest margin for every
  // higher-rate IFRS bank (Santander, BBVA, ING, the Canadians); netting fixes it, and where the
  // expense leg isn't standard-tagged we publish nothing rather than a wrong, inflated number.
  netInterestIncome: ["InterestIncomeExpenseNet"],
  interestIncomeGross: ["InterestRevenueCalculatedUsingEffectiveInterestMethod", "RevenueFromInterest", "InterestAndSimilarIncome", "InterestAndDividendIncomeOperating", "InterestIncome"],
  noninterestIncome: ["RevenueFromFeeAndCommissionIncome", "FeeAndCommissionIncome", "NoninterestIncome", "RevenueFromDividends"],
  noninterestExpense: ["NoninterestExpense", "AdministrativeExpense"],
  provisionForCreditLosses: ["ImpairmentLossRecognisedInProfitOrLossLoansAndAdvances", "ImpairmentLossOnFinancialAssetsNet", "AllowanceForCreditLossesFinancialAssets", "ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses", "ProvisionForCreditLossExpenseReversal"],
  // Customer deposits first (the IFRS primary and the moat), then any all-in total; DepositsFromBanks
  // is interbank borrowing, a small sub-line, so it ranks last and a guard in depositFunding drops it
  // when it's implausibly small against assets (a sub-component mistaken for the whole deposit base).
  deposits: ["DepositsFromCustomers", "Deposits", "DepositLiabilities", "DepositsFromBanks"],
  premiumsEarned: ["InsuranceRevenue", "PremiumsRevenue", "RevenueFromInsuranceContractsIssued", "PremiumsEarnedNet", "PremiumsEarnedNetPropertyAndCasualty"],
  claimsIncurred: ["InsuranceServiceExpensesFromInsuranceContractsIssued", "InsuranceClaimsAndBenefitsPaidNetOfReinsuranceRecoveries", "InsuranceClaimsAndBenefitsPaid", "PolicyholderBenefitsAndClaimsIncurredNet", "IncurredClaimsPropertyCasualtyAndLiability"],
  investmentIncome: ["NetInvestmentIncome", "InvestmentIncome", "InvestmentRevenue"],
  lossReserves: ["InsuranceContractLiabilities", "LiabilitiesUnderInsuranceContractsAndReinsuranceContractsIssued", "InsuranceContractsIssuedThatAreLiabilities", "LiabilitiesForInsuranceContracts", "NetInsuranceContractLiabilities", "LiabilityForClaimsAndClaimsAdjustmentExpense", "LiabilityForFuturePolicyBenefits"],
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
// Net interest income: the true-net tag if the filer reports one (US-GAAP banks do), else gross
// interest income less interest expense (the IFRS presentation). Null — never the gross figure
// alone — when the expense leg is missing, so a bank's net interest margin is right or absent,
// not silently doubled.
const netInterest = (net, gross, exp) => (net != null ? net : (gross != null && exp != null ? gross - Math.abs(exp) : null));
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

    // SIC comes from the submissions API, not companyfacts (which omits it). It is the only
    // thing the archetype engine routes on, so without it a foreign bank or insurer reads as a
    // generic industrial — its net interest margin, deposits, float and combined ratio never
    // surface. A failed submissions fetch is non-fatal: the company still renders, just unrouted.
    let sub = null;
    await sleep(THROTTLE_MS);
    try { sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`); }
    catch (e) { console.warn(`  ! ${ticker}: submissions ${e.message} (SIC unresolved)`); }

    const ccy = detectCurrency(facts);
    const standard = detectStandard(facts);
    const sic = String(sub?.sic || facts.sic || meta.sic || "");
    const sicDescription = sub?.sicDescription || meta.sicDescription || null;
    const a = (tags) => pickAnnual(facts, tags, ccy)?.val ?? null;
    const inst = (tags) => latestObservation(facts, tags, ccy, true)?.val ?? null;

    // Diagnostic: ADR_DEBUG=NGG dumps the operating-cash and capex concepts a 20-F filer actually
    // tags, across IFRS and US-GAAP, in its home currency — so the concept map is widened from real
    // filings, not guessed (an IFRS grid operator or oil major names these its own way).
    if (process.env.ADR_DEBUG && process.env.ADR_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      console.log(`\n=== ADR_DEBUG ${ticker} [${ccy}/${standard}]: cashFromOps=${a(CONCEPTS.cashFromOps)} capex=${a(CONCEPTS.capex)} ===`);
      for (const ns of NAMESPACES) {
        const g = facts?.facts?.[ns] || {};
        for (const concept of Object.keys(g)) {
          if (!/cashflow|operatingactiv|cashfromused|cashgenerated|payments(to|for)|purchaseof|acqui|propertyplant|capitalexpend|additionsto|expenditure/i.test(concept)) continue;
          if (/proceeds|receivable|liabilit|payable|fairvalue|futurenet|maturit|repurchase|dividend|sharebased|interestpaid|taxespaid|financingactiv/i.test(concept)) continue;
          const u = g[concept]?.units?.[ccy];
          if (!u) continue;
          const byYear = {};
          for (const o of u) { if (!o.start || !o.end) continue; const d = days(o.start, o.end); if (d < 350 || d > 380) continue; const fy = new Date(o.end).getUTCFullYear(); if (!byYear[fy] || (o.filed || "") > (byYear[fy].filed || "")) byYear[fy] = o; }
          const ys = Object.keys(byYear).sort();
          if (!ys.length) continue;
          const last = byYear[ys[ys.length - 1]];
          if (Math.abs(last.val) < 1e6) continue;
          console.log(`  ${(ns + ":" + concept).padEnd(70)} ${(last.val / 1e6).toFixed(0).padStart(10)}M (FY${ys[ys.length - 1]})`);
        }
      }
      console.log("=== end ADR_DEBUG ===\n");
    }

    const ha = Object.fromEntries(Object.keys(CONCEPTS).map((k) => [k, collectAnnual(facts, CONCEPTS[k], ccy)]));
    const hi = Object.fromEntries(["totalAssets", "currentAssets", "currentLiabilities", "totalLiabilities", "cashAndEquivalents", "shortTermInvestments", "receivables", "inventory", "netPPE", "operatingLeaseAsset", "accountsPayable", "equity", "goodwill", "intangibleAssets", "longTermDebt", "currentDebt", "deposits", "lossReserves"].map((k) => [k, collectInstant(facts, CONCEPTS[k], ccy)]));
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
        netPPE: hi.netPPE[fy] ?? null,
        operatingLeaseAsset: hi.operatingLeaseAsset[fy] ?? null,
        accountsPayable: hi.accountsPayable[fy] ?? null,
        currentAssets: hi.currentAssets[fy] ?? null,
        currentLiabilities: hi.currentLiabilities[fy] ?? null,
        totalAssets: hi.totalAssets[fy] ?? null,
        goodwill: hi.goodwill[fy] ?? null,
        intangibleAssets: hi.intangibleAssets[fy] ?? null,
        // financial (banks/insurers) lines — null for industrials, so the financialKind-routed
        // scorecards read a foreign bank or insurer on its own statements.
        netInterestIncome: netInterest(ha.netInterestIncome[fy], ha.interestIncomeGross[fy], ha.bankInterestExpense[fy]),
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
        netPPE: inst(CONCEPTS.netPPE), operatingLeaseAsset: inst(CONCEPTS.operatingLeaseAsset),
        totalAssets: inst(CONCEPTS.totalAssets), goodwill: inst(CONCEPTS.goodwill), intangibleAssets: inst(CONCEPTS.intangibleAssets),
        netInterestIncome: netInterest(tf(CONCEPTS.netInterestIncome), tf(CONCEPTS.interestIncomeGross), tf(CONCEPTS.bankInterestExpense)), noninterestIncome: tf(CONCEPTS.noninterestIncome), noninterestExpense: tf(CONCEPTS.noninterestExpense),
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

    // The current-snapshot `lines` the page reads. The latest fiscal year's flows are right, but its
    // balance-sheet instants can lag — a 20-F filed with the income statement before the year-end
    // balance sheet is tagged, leaving equity/assets null for that year (Santander). The ttm block
    // already resolves each instant to its freshest observation, so overlay ttm's non-null values on
    // the latest year: every field gets the most recent figure it has, none get nulled. Mirrors the
    // way the US fetcher assembles `lines` from latest annual flows plus latest instants.
    const latestLines = history.length ? { ...history[history.length - 1].lines } : {};
    if (ttm?.lines) for (const [k, v] of Object.entries(ttm.lines)) if (v != null) latestLines[k] = v;

    const rec = {
      ticker, name: meta.name || facts.entityName || ticker, cik, sic, sicDescription,
      market: "ADR", currency: ccy, country: meta.country || null, accountingStandard: standard,
      fy: anchor?.fy ?? null, periodEnd: anchor?.end ?? null, form: anchor?.form || "20-F",
      sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=20-F`,
      lines: latestLines,
      history, ttm, quarterly,
    };
    if (passesQualityFloor(rec)) { companies.push(rec); console.log(`  ✓ ${ticker} (${ccy}, ${standard}, FY${rec.fy ?? "?"})`); }
    else { withheld.add(ticker); console.log(`  ⊘ ${ticker}: withheld (below quality floor)`); }
  }

  // Carry over the last good file. A targeted run (ONLY_ADR) fetches only a few tickers, and even a
  // full run can drop one to a transient SEC error — either way the rest must survive. Overlay the
  // freshly fetched records onto the prior pool and write the union, dropping only tickers no longer
  // in the universe. Without this a targeted fetch replaced the whole pool with just what it ran,
  // which once collapsed it from 878 companies to one.
  let prior = [];
  try { prior = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.adr.json"), "utf8")).companies || []; } catch { /* first run: nothing to carry */ }
  const inUniverse = new Set([...names.keys()]);
  const byTicker = new Map(prior.filter((c) => inUniverse.has(String(c.ticker).toUpperCase())).map((c) => [c.ticker, c]));
  for (const c of companies) byTicker.set(c.ticker, c); // a freshly fetched record supersedes its prior one
  const merged = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const carried = merged.length - companies.length;
  fs.writeFileSync(path.join(dataDir, "fundamentals.adr.json"), JSON.stringify({
    asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR companyfacts (Form 20-F/40-F; IFRS or US-GAAP)", sample: false, companies: merged,
  }, null, 2) + "\n");
  console.log(`\n✅ Wrote ${merged.length} ADR companies (${companies.length} fetched/updated, ${carried} carried over, ${withheld.size} withheld)`);
}

export { rowsFor, detectCurrency, detectStandard, annualByYear, instantByYear, quarterSeries, latestObservation, CONCEPTS };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
