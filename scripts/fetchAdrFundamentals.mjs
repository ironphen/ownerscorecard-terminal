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
// Pinned fetch, not the global: newer node builds bundle an undici (6.26+) whose socket teardown
// asserts the process to death mid-parse (nodejs/undici#5360). See fetchWire.mjs for the full story.
import { fetch } from "undici";
import { passesQualityFloor } from "../src/lib/fundamentals.mjs";
import { financialKind } from "../src/lib/archetype.mjs";
import { compactJson } from "../src/lib/dataFile.mjs";
import { buildCikMap, CIK_OVERRIDE, resolveCikLive } from "./cikResolve.mjs";
// From the shared lib, NOT from fetchFundamentals.mjs — importing another fetcher executes its
// top-level startup (a universe.json read), coupling this pipeline's launch to that file.
import { normalizeShareScale } from "../src/lib/shareScale.mjs";
import { parseCoverShares } from "./fetchFundamentals.mjs";

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
  // "RevenuesNetOfInterestExpense" ranks above the gross "Revenues": a US-GAAP-filing bank (MUFG,
  // Mizuho) tags its whole gross ordinary income under "Revenues" (interest expense not yet removed)
  // and its true top line under the net tag — picking the gross doubled the read. Only banks carry the
  // net tag, so listing it first is a no-op for every non-financial.
  // The last two are airline/shipping IFRS revenue tags (Volaris, BW LPG) that some transport filers
  // use in place of the generic Revenue; ranked last, they only fill a filer the general tags miss.
  revenue: ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenuesNetOfInterestExpense", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenueFromRenderingOfTransportServices", "RevenueFromRenderingOfPassengerTransportServices"],
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
  // Depreciation, the owner-earnings linchpin (without it, maintenance capex falls back to TOTAL capex
  // and owner earnings are overstated). The income-statement D&A tags come first; then the cash-flow
  // add-backs that many IFRS filers use as their ONLY depreciation line — they report no separate
  // income-statement D&A, only the add-back in the operating-cash reconciliation, so a list of
  // income-statement tags alone misses them entirely (the larger of the ADR depreciation gaps).
  // Appended, so a filer already matched by an earlier tag is untouched; these only fill a null.
  depreciation: [
    "DepreciationAndAmortisationExpense", "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
    "DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
    "AdjustmentsForDepreciationAndAmortisationExpense", "DepreciationAmortizationAndAccretionNet",
    "AdjustmentsForDepreciationExpense", "DepreciationExpense", "Depreciation",
  ],
  // Cash dividends PAID (outflow) only — never a dividend RECEIVED, a per-share figure, or a proposed-
  // but-unpaid declaration. Ordered most-comparable-first (the financing-statement cash line), with the
  // US-GAAP names that carry a filer's pre-IFRS years as fallbacks; the year-wise merge in annualByYear
  // fills each year from the first of these that has it, bridging a US-GAAP→IFRS reporting switch.
  dividendsPaid: [
    "DividendsPaidClassifiedAsFinancingActivities",
    "DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities",
    "DividendsPaid",
    "PaymentsOfDividendsCommonStock",
    "PaymentsOfDividends",
    "DividendsPaidOrdinaryShares",
    "DividendsCommonStockCash",
  ],
  buybacks: ["PaymentsToAcquireOrRedeemEntitysShares", "PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"],
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
      // 60s per-attempt timeout: a hung server can't freeze the run; an abort is retried like any failure.
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      // An abandoned body leaves undici's parser paused on a live socket — the exact state whose
      // teardown crashes the process — so every early exit discharges it first.
      if (res.status === 404) { await res.body?.cancel().catch(() => {}); return null; }
      // Back off harder on an explicit rate-limit, the way the US, EDINET and wire fetchers do: a 429
      // retried with the generic ~½s–2s backoff just burns the attempts and the company mass-skips
      // under SEC throttling. Give it a full second per attempt before retrying.
      if (res.status === 429) { await res.body?.cancel().catch(() => {}); if (a === 4) throw new Error("HTTP 429"); await sleep(1000 * a); continue; }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
      return await res.json();
    } catch (err) {
      if (a === 4) throw err;
      await sleep(500 * a);
    }
  }
}

const days = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);

async function getText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await res.body?.cancel().catch(() => {}); if (a === 4) throw new Error("HTTP 429"); await sleep(1000 * a); continue; }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
      return await res.text();
    } catch (err) {
      if (a === 4) throw err;
      await sleep(500 * a);
    }
  }
}

// ---- the 20-F/40-F cover-text fallback (2026-07-18) ----
// Thirty foreign filers reach the end of the XBRL share chain with nothing fresh — Baidu's last
// un-dimensioned cover fact is 2010 — and, unlike the US side, had no cover-text recovery, so the
// staleness guard left them honestly blank. A 20-F cover states the ordinary-share count in plain
// text just as a 10-K does ("As of December 31, 2025, there were N Class A ordinary shares..."),
// so the same L1 discipline applies, adapted to the annual cadence:
//   - corroborates across the latest TWO annual filings (there is no quarterly to pair with); a
//     real count drifts slowly, so the two covers must agree within 25% year over year;
//   - counts whose nearby context names the ADS/ADR program are EXCLUDED — a cover that states
//     the depositary-share count beside the ordinary count would otherwise double-count;
//   - fires only when the whole XBRL chain yielded no fresh count; any ambiguity returns null.
async function adrCoverShareCount(cik) {
  try {
    const padded = String(cik).padStart(10, "0");
    const sub = await getJSON(`https://data.sec.gov/submissions/CIK${padded}.json`);
    const r = sub?.filings?.recent;
    if (!r) return null;
    const annuals = [];
    for (let i = 0; i < r.form.length && annuals.length < 2; i++) {
      if (r.form[i] === "20-F" || r.form[i] === "40-F")
        annuals.push({ acc: r.accessionNumber[i].replace(/-/g, ""), doc: r.primaryDocument[i], filed: r.filingDate[i], form: r.form[i] });
    }
    if (annuals.length < 2) return null; // corroboration needs two successive annual covers
    const reads = [];
    for (const f of annuals) {
      await sleep(THROTTLE_MS);
      const html = await getText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.acc}/${f.doc}`);
      const val = parseCoverShares(html, { excludeNear: /american\s+depositary|\bADSs?\b|\bADRs?\b/i });
      if (val != null) reads.push({ val, form: f.form, filed: f.filed });
    }
    if (reads.length < 2) return null;
    const [a, b] = reads;
    const ratio = a.val > b.val ? a.val / b.val : b.val / a.val;
    if (ratio > 1.25) return null; // the two annual covers disagree; refuse
    const fresher = new Date(a.filed) >= new Date(b.filed) ? a : b;
    return { val: fresher.val, asOf: fresher.filed, form: fresher.form, basis: "cover-text" };
  } catch {
    return null; // a fetch failure is a missing count, never an error that breaks the run
  }
}

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

// An aircraft or equipment lessor (AerCap, Air Lease) books its top line as the combined total revenue
// — lease income plus maintenance, interest and asset-sale revenue — under ifrs-full:Revenue or, for a
// US-GAAP-filing lessor like AerCap, us-gaap:Revenues. The ASC 606 contract tag is only the services
// sliver (AerCap $0.02B against an $8.5B total), so for a lessor the total must win; the total is always
// the largest and carries no excise, so preferring it never overstates. SIC 7359.
const ADR_LESSOR_REVENUE = ["Revenue", "Revenues", "LeaseIncome", "OperatingLeaseLeaseIncome", "OperatingLeasesIncomeStatementLeaseRevenue", "RevenueNotFromContractWithCustomer", "RevenueFromContractsWithCustomers", "RevenueFromContractWithCustomerExcludingAssessedTax"];
const isLessorSic = (sic) => Number(sic) === 7359;

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

// Annual (full-year duration) value per fiscal year, MERGED across tags the way the US fetcher does:
// a higher-priority tag (and, within a tag, the IFRS namespace before US-GAAP) wins a year; lower-
// priority tags only FILL the years it lacks. Never summed — at most one tag supplies a given year.
//
// Why this matters: a foreign issuer that moved from US-GAAP to IFRS reporting tags its older years
// under one taxonomy and its recent years under another. Toyota, Sony and Honda book recent dividends
// as ifrs-full:DividendsPaid and older ones as us-gaap:PaymentsOfDividendsCommonStock; ASML and SAP
// split a single concept across eras. Selecting one tag and stopping (the old rowsFor behaviour)
// stranded whichever era that tag didn't cover — a measured, pool-wide gap the dividend probe surfaced
// (8 of 10 sampled names), affecting every multi-tag concept, not just dividends. Filling year-by-year
// bridges the transition. Within a (tag, namespace), the latest filing wins, so restatements still land.
function annualByYear(facts, tags, unit) {
  const out = {};
  for (const tag of tags) {
    for (const ns of NAMESPACES) {
      const units = facts?.facts?.[ns]?.[tag]?.units?.[unit];
      if (!units || !units.length) continue;
      const perTag = {};
      for (const u of units) {
        if (!u.form || !isForm(u.form, ANNUAL_FORMS) || !u.start || !u.end) continue;
        const dur = days(u.start, u.end);
        if (dur < 350 || dur > 380) continue;
        const fy = new Date(u.end).getUTCFullYear();
        if (!(fy in perTag) || (u.filed || "") > (perTag[fy].filed || "")) perTag[fy] = { val: u.val, end: u.end, filed: u.filed || "", form: u.form };
      }
      for (const fy in perTag) if (!(fy in out)) out[fy] = perTag[fy]; // higher-priority tag/ns already there wins
    }
  }
  return out;
}
function instantByYear(facts, tags, unit) {
  const out = {};
  for (const tag of tags) {
    for (const ns of NAMESPACES) {
      const units = facts?.facts?.[ns]?.[tag]?.units?.[unit];
      if (!units || !units.length) continue;
      const perTag = {};
      for (const u of units) {
        if (!u.form || !isAnyForm(u.form) || !u.end || u.start) continue;
        const fy = new Date(u.end).getUTCFullYear();
        // Prefer the annual (fiscal year-end) instant; a 6-K interim only fills a year with no annual.
        const annual = isForm(u.form, ANNUAL_FORMS);
        const cur = perTag[fy];
        if (!cur || (annual && !cur.annual) || ((annual === !!cur.annual) && (u.filed || "") > cur.filed))
          perTag[fy] = { val: u.val, end: u.end, filed: u.filed || "", annual };
      }
      for (const fy in perTag) if (!(fy in out)) out[fy] = perTag[fy]; // higher-priority tag/ns wins the year
    }
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
// guardStable: mirror of the US fetcher's dividend-straddle guard — a lumpy cash line whose
// stitch runs >20% above the filed annual falls back to the annual (a quarter double-count is
// worse than a slightly stale filed figure). Never set for revenue/earnings. (2026-07-17.)
function ttmFlow(facts, tags, unit, guardStable = false) {
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
  if (priorYTD && priorFY) {
    const stitched = priorFY.val + cur.val - priorYTD.val;
    if (guardStable && priorFY.val != null && Math.abs(stitched) > Math.abs(priorFY.val) * 1.2 + 1) return { val: priorFY.val, asOf: priorFY.end, isFY: true };
    return { val: stitched, asOf: cur.end, isFY: false };
  }
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
// The dated instantaneous count that turns a price into a market cap — the 20-F/40-F cover's
// dei:EntityCommonStockSharesOutstanding, under the same guarded chain as the US fetcher's
// sharesForValueOf: the cover count when fresh (within 400 days of the freshest weighted
// average), else a balance-sheet instant within ±25% of that average, else the weighted
// average itself. One guard is added here that the US side gets from its share-scale fixer:
// the cover count must sit within 4× either way of the weighted average, so a thousands-
// mistagged cover can't pass. The weighted-average series stays the record tables' per-share
// denominator; this count exists only to price the whole business.
function sharesForValueOf(facts, periodEnd = null) {
  const avg = latestObservation(facts, CONCEPTS.sharesDiluted, "shares", false);
  const inst = latestObservation(facts, CONCEPTS.sharesOutstanding, "shares", true);
  const pick = (o, basis) => ({ val: o.val, asOf: o.end, form: o.form || null, basis });
  // Absolute recency guard, signed to the bug direction — mirrors the US fetcher. A foreign filer
  // that stopped tagging its dei cover / weighted-average years ago (Baidu's last un-dimensioned
  // cover is 2010) must not price today's cap on a decade-old share base. A count OLDER than the
  // financials by >460 days is rejected; a cover fresher than lagging financials is kept. Foreign
  // 20-F/40-F filers have no plain-text cover fallback here, so a stale reject withholds honestly —
  // a wrong number is worse than a missing one (2026-07-17 correctness sweep #3).
  const fresh = (end) => !periodEnd || !end || (new Date(periodEnd) - new Date(end)) / 86400000 <= 460;
  let dei = null;
  const units = facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (units) {
    for (const u of units) {
      if (!u.form || !u.end || u.start) continue;
      if (!(u.form.startsWith("20-F") || u.form.startsWith("40-F"))) continue;
      if (!fresh(u.end)) continue;
      if (!dei || new Date(u.end) > new Date(dei.end) || (u.end === dei.end && (u.filed || "") > dei.filed))
        dei = { val: u.val, end: u.end, filed: u.filed || "", form: u.form };
    }
  }
  // The scale guard measures the cover against ANY count the filer tags — the weighted average
  // when it exists, else the balance-sheet instant. A filer with no weighted-average series at
  // all once slipped an ADS-denominated cover through (MAAS, 20:1 — the cover was 1/20th of its
  // instant count), which the ratio division downstream would have shrunk twice.
  const ref = avg?.val > 0 ? avg.val : inst?.val > 0 ? inst.val : null;
  const scaleOk = dei && (ref == null || (dei.val >= ref / 4 && dei.val <= ref * 4));
  if (dei && dei.val > 0 && scaleOk && (!avg?.end || Math.abs(days(dei.end, avg.end)) <= 400)) return pick(dei, "cover");
  if (inst && inst.val > 0 && fresh(inst.end) && avg?.val > 0 && inst.val >= avg.val * 0.75 && inst.val <= avg.val * 1.25)
    return pick(inst, "instant");
  if (avg && avg.val > 0 && fresh(avg.end)) return pick(avg, "average");
  return null;
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
  let exch = null;
  try { exch = await getJSON("https://www.sec.gov/files/company_tickers_exchange.json"); } catch { /* main file alone still works */ }
  return new Map(Object.entries(buildCikMap(j, exch)));
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
    let cik = CIK_OVERRIDE[ticker.toUpperCase()] || cikMap.get(ticker.replace(/-/g, "")) || cikMap.get(ticker);
    if (!cik) { await sleep(THROTTLE_MS); cik = await resolveCikLive(ticker); }
    if (!cik) { console.warn(`  ! ${ticker}: no CIK (SEC map + EDGAR lookup), skipping`); continue; }
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
    // Share counts, normalized across the record: a filer that tags one year's count in thousands
    // against whole-share neighbors (121 ADR names at the campaign kickoff — this pool never had the
    // US pool's normalizeShareScale) gets the same shared rule the US pool gets, on the MERGED
    // weighted-average/period-end series the history actually reads. The dei cover count arbitrates
    // per year where a 20-F carries one (many don't — those fall to the conservative passes, which
    // refuse edges: Fresenius's first-year ×1000-HIGH stays as-filed and flagged, never an anchor).
    const shAnnual = collectAnnual(facts, CONCEPTS.sharesDiluted, "shares");
    const shInstant = collectInstant(facts, CONCEPTS.sharesOutstanding, "shares");
    const coverByYear = {};
    for (const o of facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || []) {
      if (!o.end || o.val == null || o.val <= 0) continue;
      const fy = new Date(o.end).getUTCFullYear();
      if (!coverByYear[fy] || (o.filed || "") > coverByYear[fy].filed) coverByYear[fy] = { val: o.val, filed: o.filed || "" };
    }
    for (const fy in coverByYear) coverByYear[fy] = coverByYear[fy].val;
    const shMerged = normalizeShareScale(Object.fromEntries(
      [...new Set([...Object.keys(shAnnual), ...Object.keys(shInstant)])].map((fy) => [fy, shAnnual[fy] ?? shInstant[fy] ?? null])
    ), coverByYear);

    // A bank tags a gross "Revenues" (interest expense not yet removed) that overstates its top line by
    // roughly the interest it pays. Read a bank on the net-of-interest tag alone; where a filer lacks it
    // (most IFRS banks, and Mizuho) leave revenue null so topLineRevenue reconstructs from net interest
    // income + noninterest income. Non-financials are unaffected.
    const fkRev = financialKind({ market: "ADR", sic });
    // A lessor reads its combined total revenue, never the ASC 606 contract sliver (see ADR_LESSOR_REVENUE).
    const isLessor = isLessorSic(sic);
    if (isLessor) ha.revenue = collectAnnual(facts, ADR_LESSOR_REVENUE, ccy);
    const revConcepts = isLessor ? ADR_LESSOR_REVENUE : CONCEPTS.revenue;
    const bankNetRev = fkRev === "bank" ? collectAnnual(facts, ["RevenuesNetOfInterestExpense"], ccy) : null;
    const revenueAt = (fy) => (fkRev === "bank" ? (bankNetRev[fy] ?? null) : (ha.revenue[fy] ?? null));

    const anchor = pickAnnual(facts, revConcepts, ccy) || pickAnnual(facts, CONCEPTS.netIncome, ccy);
    const years = [...new Set([...Object.keys(ha.revenue), ...Object.keys(ha.netIncome)])].map(Number).sort((x, y) => x - y).slice(-10);
    const debtYear = (fy) => maxOf((hi.longTermDebt[fy] != null || hi.currentDebt[fy] != null) ? (hi.longTermDebt[fy] || 0) + (hi.currentDebt[fy] || 0) : null);
    const history = years.map((fy) => ({
      fy,
      lines: {
        revenue: revenueAt(fy),
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
        sharesDiluted: shMerged[fy] ?? null,
      },
    }));

    const tf = (tags) => ttmFlow(facts, tags, ccy)?.val ?? null;
    let ttmRev = fkRev === "bank" ? ttmFlow(facts, ["RevenuesNetOfInterestExpense"], ccy) : ttmFlow(facts, revConcepts, ccy);
    // Anti-freeze: rowsFor/ttmFlow stop at the FIRST revenue tag with data, so a filer that retagged its
    // top line mid-record (Franco-Nevada moved Revenue→RevenueFromContractsWithCustomers in 2018) has its
    // TTM stranded at the old tag's final year (2017's $0.68B) while the merged annual `anchor` is current
    // ($1.82B FY2025). When the TTM top line is older than the merged annual, the merged annual — which is
    // per-year priority-correct — is the real latest revenue. Never picks a sub-line tag; only the anchor.
    // Full-date compare with a 14-day 52/53-week tolerance, not calendar-year: a TTM frozen eleven
    // months inside the annual's own calendar year must not hide behind year granularity (mirrors
    // auditContinuity C3 and the US fetcher's guard).
    const staleVsAnchor = (r) => anchor?.end && (!r?.asOf || new Date(r.asOf).getTime() < new Date(anchor.end).getTime() - 14 * 86400000);
    if (fkRev !== "bank" && anchor?.fy != null && anchor.val != null) {
      if (staleVsAnchor(ttmRev)) ttmRev = { val: anchor.val, asOf: anchor.end, isFY: true };
    } else if (fkRev === "bank" && ttmRev && staleVsAnchor(ttmRev)) {
      // A bank's TTM stitches from the net-of-interest tag alone; where that tag stranded, the
      // stitch is a wrong number shown as current. There is no clean anchor to substitute (the
      // bank top line is reconstructed from components), so drop the block — the FY lines stand.
      console.warn(`  ! ${ticker}: bank TTM stitch ends ${ttmRev.asOf}, older than the FY end ${anchor?.end} — stranded tag; dropping the TTM block`);
      ttmRev = null;
    }
    const ttm = ttmRev ? {
      asOf: ttmRev.asOf, isFY: ttmRev.isFY,
      lines: {
        revenue: ttmRev.val,
        operatingIncome: deriveOpInc(tf(CONCEPTS.operatingIncome), ttmRev.val, tf(CONCEPTS.netIncome), tf(CONCEPTS.incomeTaxExpense), tf(CONCEPTS.interestExpense)),
        interestExpense: tf(CONCEPTS.interestExpense), netIncome: tf(CONCEPTS.netIncome), incomeTaxExpense: tf(CONCEPTS.incomeTaxExpense),
        cashFromOps: tf(CONCEPTS.cashFromOps), capex: tf(CONCEPTS.capex), costOfRevenue: tf(CONCEPTS.costOfRevenue), depreciation: tf(CONCEPTS.depreciation),
        // Same trailing basis as netIncome, so paid-out/retained splits never mix vintages.
        dividendsPaid: ttmFlow(facts, CONCEPTS.dividendsPaid, ccy, true)?.val ?? null, // guardStable: dividend straddle guard
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
    // A bank's snapshot revenue follows the same net-of-interest rule as its history and ttm, so a gross
    // "Revenues" tag can never leak into the top-line read through the latest-year overlay above.
    if (fkRev === "bank") latestLines.revenue = revenueAt(anchor?.fy ?? (history.length ? history[history.length - 1].fy : null));

    const rec = {
      ticker, name: meta.name || facts.entityName || ticker, cik, sic, sicDescription,
      market: "ADR", currency: ccy, country: meta.country || null, accountingStandard: standard,
      fy: anchor?.fy ?? null, periodEnd: anchor?.end ?? null, form: anchor?.form || "20-F",
      sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=20-F`,
      // The dated instantaneous count for price-to-value arithmetic; the record tables keep
      // the weighted-average series. See sharesForValueOf above. Stated on the ordinary-share
      // basis as filed; lib/adrBasis.mjs divides it by the ADS ratio with everything else.
      // When the XBRL chain yields no FRESH count (Baidu's 2010 stranding), the cover-text
      // fallback reads the last two annual covers, or the record stays honestly blank.
      sharesForValue: sharesForValueOf(facts, anchor?.end ?? null) ?? await adrCoverShareCount(cik),
      lines: latestLines,
      history, ttm, quarterly,
    };
    // Withhold a record more than ~24 months stale: foreign filers whose revenue tag changed strand at
    // an old year and then present old (often internally inconsistent) figures as the present — Total-
    // Energies showed a recent revenue mislabeled FY2017. A current 20-F filer is always within ~24
    // months, so beyond that the record is behind and better shown as nothing. The number is sacred.
    const tooStale = rec.periodEnd ? (Date.now() - new Date(rec.periodEnd).getTime()) > 24 * 30.44 * 86400000 : false;
    if (passesQualityFloor(rec) && !tooStale) { companies.push(rec); console.log(`  ✓ ${ticker} (${ccy}, ${standard}, FY${rec.fy ?? "?"})`); }
    else { withheld.add(ticker); console.log(`  ⊘ ${ticker}: withheld (${tooStale ? `stale — latest FY${rec.fy ?? "?"}` : "below quality floor"})`); }
  }

  // Carry over the last good file. A targeted run (ONLY_ADR) fetches only a few tickers, and even a
  // full run can drop one to a transient SEC error — either way the rest must survive. Overlay the
  // freshly fetched records onto the prior pool and write the union, dropping only tickers no longer
  // in the universe. Without this a targeted fetch replaced the whole pool with just what it ran,
  // which once collapsed it from 878 companies to one.
  let prior = [];
  try { prior = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.adr.json"), "utf8")).companies || []; } catch { /* first run: nothing to carry */ }
  const inUniverse = new Set([...names.keys()]);
  // Drop a ticker withheld this run (stale or below the floor) from the carry-over too, so a record
  // that just failed the staleness gate is removed rather than kept alive from the last good file.
  const byTicker = new Map(prior.filter((c) => inUniverse.has(String(c.ticker).toUpperCase()) && !withheld.has(c.ticker)).map((c) => [c.ticker, c]));
  // Field-level carry-over: keep last week's value for any secondary field (capex, depreciation, debt,
  // a share count) that came back null on a transient tag miss, when this run re-fetched the SAME
  // fiscal year — so a fresh record clearing the floor can't overwrite a good value with a hole.
  // FY-guarded, so one year's figure is never carried into another; a new annual is taken as fetched.
  const priorMap = new Map(prior.map((c) => [c.ticker, c]));
  let fieldsCarried = 0;
  const carryFields = (f, p) => {
    if (!p?.lines || !f?.lines || f.fy == null || f.fy !== p.fy) return f;
    // A bank's null revenue is deliberate — it reconstructs from net interest income + noninterest
    // income, so carrying the prior "revenue" back would restore the gross figure the fix removes.
    const bankRev = financialKind(f) === "bank";
    for (const k of Object.keys(p.lines)) {
      if (bankRev && k === "revenue") continue;
      if (f.lines[k] == null && p.lines[k] != null) { f.lines[k] = p.lines[k]; fieldsCarried++; }
    }
    return f;
  };
  for (const c of companies) byTicker.set(c.ticker, carryFields(c, priorMap.get(c.ticker))); // a freshly fetched record supersedes its prior one
  if (fieldsCarried) console.log(`   ${fieldsCarried} null field(s) carried over from the last good file (same fiscal year, transient tag misses)`);
  const merged = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const carried = merged.length - companies.length;
  fs.writeFileSync(path.join(dataDir, "fundamentals.adr.json"), compactJson({
    asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR companyfacts (Form 20-F/40-F; IFRS or US-GAAP)", sample: false, companies: merged,
  }));
  console.log(`\n✅ Wrote ${merged.length} ADR companies (${companies.length} fetched/updated, ${carried} carried over, ${withheld.size} withheld)`);
}

export { rowsFor, detectCurrency, detectStandard, annualByYear, instantByYear, quarterSeries, latestObservation, CONCEPTS };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
