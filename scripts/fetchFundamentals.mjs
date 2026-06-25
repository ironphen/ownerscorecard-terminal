#!/usr/bin/env node
// Build-time fundamentals pipeline.
//
// Reads src/data/universe.json (tickers + names), resolves each ticker to a CIK
// via SEC's official ticker map, pulls the latest annual (10-K) figures from the
// EDGAR XBRL "companyfacts" API, and writes src/data/fundamentals.json, the
// static dataset every fundamentals tool reads.
//
//   npm run fetch:fundamentals
//
// Needs outbound access to sec.gov / data.sec.gov. SEC asks for a descriptive
// User-Agent with contact info; override via SEC_USER_AGENT if you like.
// Free, no API key. Runs unattended in CI (see .github/workflows/fundamentals.yml).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { passesQualityFloor } from "../src/lib/fundamentals.mjs";

const UA =
  process.env.SEC_USER_AGENT ||
  "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 150; // stay well under SEC's ~10 req/s guidance

const dataDir = path.join(process.cwd(), "src", "data");
const universe = JSON.parse(fs.readFileSync(path.join(dataDir, "universe.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Operating income, with a fallback for filers that don't tag OperatingIncomeLoss
// (Nike, IBM, the oil majors, much of pharma run gross profit straight to pretax):
// revenue minus total costs and expenses, else pretax (net income + tax) plus interest
// as an EBIT proxy. Returns null only when none of the inputs are present.
function deriveOpInc(opInc, rev, costsExp, ni, tax, interest) {
  if (opInc != null) return opInc;
  if (rev != null && costsExp != null) return rev - costsExp;
  if (ni != null && tax != null) return ni + tax + (interest || 0);
  return null;
}

// Title-case EDGAR's all-caps entityName for use as a display-name fallback when the
// universe doesn't carry a curated name. Keeps short all-caps acronyms (HP, AMD, IBM),
// normalizes the common legal suffixes, and lowercases the little joining words.
const NAME_FIXED = { INC: "Inc", "INC.": "Inc.", CORP: "Corp", "CORP.": "Corp.", CO: "Co", "CO.": "Co.", LTD: "Ltd", "LTD.": "Ltd.", LLC: "LLC", PLC: "PLC", LP: "LP", HLDGS: "Holdings", HLDG: "Holding", GRP: "Group", CL: "Class", NV: "NV", SA: "SA", AG: "AG", "&": "&" };
const NAME_SMALL = new Set(["a", "an", "and", "of", "the", "for"]);
function prettifyName(s) {
  if (!s) return null;
  return s.trim().split(/\s+/).map((w, i) => {
    const u = w.toUpperCase(), lo = w.toLowerCase();
    if (NAME_FIXED[u]) return NAME_FIXED[u];
    if (i > 0 && NAME_SMALL.has(lo)) return lo; // joining words, before the acronym rule
    if (w.length <= 3 && /^[A-Z0-9.&'-]+$/.test(w)) return w; // short all-caps: acronym/ticker
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  }).join(" ") || null;
}

async function getJSON(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) {
        await sleep(1000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(500 * attempt);
    }
  }
}

// Concept tags in priority order. Companies report under different tags, so we
// try each and take the first that yields a usable annual figure.
const CONCEPTS = {
  operatingIncome: ["OperatingIncomeLoss"],
  costsAndExpenses: ["CostsAndExpenses"], // total operating costs incl COGS; revenue − this = operating income
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestAndDebtExpense"],
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "OilAndGasRevenue", "RevenueMineralSales"],
  netIncome: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
  cashFromOps: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  // The cash-flow depreciation (+amortization) add-back, the maintenance-capex proxy the
  // steady-state owner-earnings lens subtracts from operating cash flow. Most filers report a
  // combined depreciation-and-amortization line (the leading tags). Microsoft and Alphabet
  // report no combined add-back at all, only plain "Depreciation" (of property and equipment:
  // $22.0B and $21.1B in FY2025), so they read null and the steady-state lens could not run on
  // the very names the AI build-out makes it matter for. "Depreciation" is listed last as a
  // fallback: it fills those names without changing any filer that already reports a combined
  // figure, and property-and-equipment depreciation is the right match for capex, which buys
  // exactly that.
  depreciation: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "DepreciationAmortizationAndOther", "DepreciationDepletionAndAmortizationNonproduction", "CostOfGoodsAndServicesSoldDepreciationAndAmortization", "Depreciation"],
  // Capex is the cash spent on the property and equipment the business runs on. The standard tag
  // covers most filers, but whole industries tag it their own way and otherwise read null (owner
  // earnings then can't net out reinvestment): oil & gas as oil-and-gas property, utilities as
  // regulated property, a water utility as water systems, and many filers (ADP, EA) only carry the
  // "Other" PP&E line. Ordered most-complete-first, so a filer reporting the standard total keeps
  // it and the variants fill only the names that miss it; the first tag with data per year wins,
  // never summed, so nothing double-counts.
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsToAcquireOilAndGasPropertyAndEquipment",
    "PaymentsToAcquireOilAndGasProperty",
    "PaymentsToExploreAndDevelopOilAndGasProperties",
    "PaymentsToAcquireRegulatedProperty",
    "PaymentsForCapitalImprovements",
    "PaymentsToAcquireWaterAndWasteWaterSystems",
    "PaymentsToAcquireMachineryAndEquipment",
    "PaymentsToAcquireOtherPropertyPlantAndEquipment",
  ],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  currentDebt: ["LongTermDebtCurrent", "DebtCurrent"],
  // Aggregate total-debt tags for filers whose borrowings sit outside the standard
  // noncurrent/current pair, e.g. a securitized or secured-note structure like
  // Domino's ~$5B. Used only as a floor via max(), so it can correct under-capture
  // but never reduce a figure the component tags already got right.
  debtTotal: [
    "DebtAndCapitalLeaseObligations",
    "DebtLongtermAndShorttermCombinedAmount",
    "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    "LongTermDebtAndCapitalLeaseObligations",
    "SecuredLongTermDebt",
    "SecuredDebt",
    "SeniorNotes",
    "SeniorLongTermNotes",
    "SeniorNotesNoncurrent",
    "NotesPayableNoncurrent",
    "LongTermNotesPayable",
    "NotesPayable",
    // Convertible-note structures (Dexcom, ServiceNow, Cadence) that don't tag the
    // standard long-term-debt concept.
    "ConvertibleDebtNoncurrent",
    "ConvertibleLongTermNotesPayable",
    "ConvertibleNotesPayableNoncurrent",
    // REIT and unsecured-borrower presentations that split debt outside the standard pair.
    "UnsecuredDebt",
    "UnsecuredLongTermDebt",
    "LongTermLineOfCredit",
    "OtherLongTermDebtNoncurrent",
  ],
  incomeTaxExpense: ["IncomeTaxExpenseBenefit"],
  costOfRevenue: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"],
  // Operating cost drivers below the gross-margin line: the buckets between gross profit and
  // operating income, surfaced so a reader can see where each revenue dollar goes. Overhead (SG&A)
  // and the research a business plows back in; R&D intensity is itself a moat tell, a durable
  // investment for some, a treadmill others must run just to stand still.
  sgaExpense: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"],
  researchDevelopment: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  stockBasedComp: ["ShareBasedCompensation"],
  dividendsPaid: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  // Cash actually spent buying other businesses, the direct measure of how acquisitive a company
  // is. Paired with goodwill on the balance sheet and impairments on the income statement, it tells
  // the whole M&A story: what was spent, what still sits on the books, and what was written off.
  acquisitionSpend: ["PaymentsToAcquireBusinessesNetOfCashAcquired", "PaymentsToAcquireBusinessesAndInterestInAffiliates", "PaymentsToAcquireBusinessesGross"],
  // Shares actually repurchased in the year (a count, not cash), so the average price paid
  // can be deduced as buyback cash ÷ shares. Not every filer tags it (some retire shares
  // straight off), so it fills the price read where present and is silent where not.
  repurchasedShares: ["StockRepurchasedDuringPeriodShares", "StockRepurchasedAndRetiredDuringPeriodShares", "TreasuryStockSharesAcquired"],
  stockholdersEquity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  cashAndEquivalents: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsAndShortTermInvestmentsAtCarryingValue",
    "CashCashEquivalentsAndShortTermInvestments",
    // ASU 2016-18 (effective 2018) folded restricted cash into the cash-flow reconciliation total,
    // and some filers — Berkshire among them — stopped tagging the plain balance-sheet line, so
    // without this their cash reads blank from 2018 on and falls back to a stale pre-2018 value.
    // Restricted cash is included but is immaterial for nearly all filers; the period-merge keeps the
    // plain line above where a filer still reports it.
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  ],
  // Liquid securities held alongside cash, netted against debt for a truer
  // leverage read (a company like Apple parks most of its war chest here, not in
  // "cash"). Marketable-securities tags only, so strategic/illiquid stakes stay out.
  shortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent", "OtherShortTermInvestments"],
  longTermMarketable: ["MarketableSecuritiesNoncurrent", "AvailableForSaleSecuritiesNoncurrent"],
  // Receivables: the primary tag alone left ~235 large operating businesses (Albertsons, Alaska Air,
  // AMETEK) reading null, which then broke their quick ratio and cash-conversion cycle. Fallbacks are
  // net, current trade-receivable concepts only — never a gross or long-term tag that would distort.
  receivables: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "AccountsReceivableNet"],
  // Inventory: the primary tag missed retailers (AutoZone, Gap, Dollar Tree) and aerospace (Boeing),
  // which tag the SAME total under a presentation-specific concept. Fallbacks each represent the
  // company's whole net inventory, so a fallback only fills a name the primary missed.
  inventory: ["InventoryNet", "RetailRelatedInventory", "InventoryNetOfAllowancesCustomerAdvancesAndProgressBillings", "InventoryFinishedGoodsNetOfReserves"],
  accountsPayable: ["AccountsPayableCurrent", "AccountsPayableTradeCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  totalLiabilities: ["Liabilities"],
  // Deferred revenue / contract liabilities: cash customers paid IN ADVANCE of delivery. A growing
  // balance is float and a pricing-power tell — people pre-pay for a business they trust (subscriptions,
  // memberships, SaaS). The post-2018 tag is ContractWithCustomerLiability; older filers use DeferredRevenue.
  deferredRevenueCurrent: ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent", "DeferredRevenueAndCreditsCurrent"],
  deferredRevenueNoncurrent: ["ContractWithCustomerLiabilityNoncurrent", "DeferredRevenueNoncurrent", "DeferredRevenueAndCreditsNoncurrent"],
  // Operating-lease liabilities (on the balance sheet since ASC 842, 2019): the real obligation a
  // retailer, airline or restaurant carries that pre-842 sat off-balance-sheet. Buffett mentally adds
  // leases to debt; captured so true leverage (debt + leases) can be shown.
  operatingLeaseCurrent: ["OperatingLeaseLiabilityCurrent"],
  operatingLeaseNoncurrent: ["OperatingLeaseLiabilityNoncurrent"],
  // Net property, plant & equipment, and the operating-lease right-of-use asset (the leased plant a
  // retailer, airline, theater or warehouse operator runs on — on the balance sheet since ASC 842).
  // Together these measure how asset-heavy the operation truly is: the signal that separates a
  // capital-intensive operator from an asset-light platform when SIC and margins alone mislead
  // (a data-center operator that owns its servers; a theater chain that leases its screens).
  netPPE: ["PropertyPlantAndEquipmentNet"],
  operatingLeaseAsset: ["OperatingLeaseRightOfUseAsset"],
  sharesDiluted: [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
    "WeightedAverageNumberOfSharesOutstandingBasic",
    // Partnerships and former partnerships (Blackstone, KKR before its 2018 conversion) report
    // weighted-average units, not shares.
    "WeightedAverageLimitedPartnershipUnitsOutstandingDiluted",
    "WeightedAverageLimitedPartnershipUnitsOutstanding",
  ],
  // Period-end share count, an instant fallback for filers that report no weighted average:
  // asset managers and former partnerships (KKR, Brookfield) tag only shares outstanding, so
  // they read null otherwise. Used only where the weighted-average series is empty for a year,
  // so a clean filer is unaffected. Outstanding only, never "issued" (which includes treasury
  // stock and so overstates the real count).
  sharesOutstanding: ["CommonStockSharesOutstanding"],
  // --- banking & insurance (the financials archetype; null for industrials) ---
  netInterestIncome: ["InterestIncomeExpenseNet"],
  noninterestIncome: ["NoninterestIncome"],
  noninterestExpense: ["NoninterestExpense"],
  provisionForCreditLosses: ["ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses", "ProvisionForCreditLossExpenseReversal"],
  totalAssets: ["Assets"],
  deposits: ["Deposits"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"],
  // Impairment write-downs (a flow, not a balance): the year a company admits an asset is worth
  // less than its carrying value. A goodwill or acquired-intangible write-off is the cleanest tell
  // that management overpaid for a past acquisition — Buffett's economic-versus-accounting-goodwill
  // point, where the write-down is the admission. Other asset impairments are the broader version.
  // Lumpy and usually zero; captured to show the pattern across the record, not for precision.
  goodwillImpairment: ["GoodwillImpairmentLoss", "GoodwillAndIntangibleAssetImpairment"],
  assetImpairment: ["AssetImpairmentCharges", "ImpairmentOfLongLivedAssetsHeldForUse", "ImpairmentOfIntangibleAssetsExcludingGoodwill", "ImpairmentOfIntangibleAssetsFinitelived", "TangibleAssetImpairmentCharges"],
  // --- REITs (the reit archetype): FFO = net income + real-estate D&A − gains on sale ---
  gainOnSaleRealEstate: ["GainLossOnSaleOfPropertiesNetOfApplicableIncomeTaxes", "GainLossOnDispositionOfRealEstate", "GainsLossesOnSalesOfInvestmentRealEstate", "GainLossOnSaleOfProperties", "GainLossOnDispositionOfAssets1"],
  realEstateGross: ["RealEstateInvestmentPropertyAtCost", "RealEstateGrossAtCarryingValue"],
  // --- insurers (financials, the underwriting + float lens) ---
  premiumsEarned: ["PremiumsEarnedNet", "PremiumsEarnedNetPropertyAndCasualty"],
  claimsIncurred: ["PolicyholderBenefitsAndClaimsIncurredNet", "IncurredClaimsPropertyCasualtyAndLiability", "PolicyholderBenefitsAndClaimsIncurredHomeAndAutomobile"],
  underwritingExpense: ["OtherUnderwritingExpense", "DeferredPolicyAcquisitionCostAmortizationExpense"],
  // The full combined-ratio numerator in one tag (losses + loss-adjustment + all
  // underwriting expenses), which our component pick of a single expense line misses.
  lossesAndExpenses: ["BenefitsLossesAndExpenses", "PolicyholderBenefitsAndClaimsIncurredNetAndOtherUnderwritingExpense"],
  investmentIncome: ["NetInvestmentIncome"],
  lossReserves: ["LiabilityForClaimsAndClaimsAdjustmentExpense", "LiabilityForFuturePolicyBenefits"],
};

// A REIT's top line is rental income, which many tag under a lease or real-estate concept
// rather than the contract-revenue line a product company uses. With the generic order, a
// REIT that also tags a small fee line first (Extra Space reads $129M against ~$3.3B of
// rent, American Tower $936M against ~$11B) loses its real revenue, so for REITs we look
// at the lease and real-estate tags first. Used only for SIC 6500-6799, so an excise-heavy
// filer's gross "Revenues" tag never displaces a product company's net contract revenue.
const REIT_REVENUE = [
  "RealEstateRevenueNet",
  "OperatingLeaseLeaseIncome",
  "OperatingLeasesIncomeStatementLeaseRevenue",
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
];

// An insurer's top line is premiums plus net investment income plus fees, all booked under the total
// "Revenues" tag; the ASC 606 contract-revenue tag captures only the fee sliver (MetLife $2.4B against
// a ~$72B total). So for insurance carriers we prefer the total and take the largest — the same safe
// pick-max used for REIT rent, since premiums carry no excise and the size comparison holds.
const INSURER_REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax"];

// A bank's top line is total revenue — net interest income plus noninterest income. Most tag it under
// "Revenues" (JPMorgan, Bank of America, Citigroup), but some re-tagged the same total as
// "RevenuesNetOfInterestExpense" — Wells Fargo did so after 2019, which stranded its whole record at
// the last year it used "Revenues" (the ASC 606 contract tag captures only the noninterest fee sliver,
// so it must never win). First-tag-wins, not pick-max: "Revenues" still wins wherever a bank reports
// it, so the banks already read correctly are unchanged; the net-of-interest total only fills the years
// a filer left "Revenues" blank. The ASC 606 contract tag is deliberately excluded — for a bank it is
// only the noninterest fee sliver, never the top line — so a year with no combined total is filled
// from net-interest-income + noninterest-income components instead (see the reconstruction below).
// Used for depository SICs (6020-6079).
const BANK_REVENUE = ["Revenues", "RevenuesNetOfInterestExpense"];

const days = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);

// ---- value extraction (tag-merged) ----
// EDGAR concepts get renamed and companies switch tags, so one tag can go stale
// mid-decade. Merge across the candidate tags in priority order: a higher-priority
// tag wins a year; lower-priority tags fill the years it lacks (so a stale tag is
// supplemented, not frozen). Within a tag, the latest filing wins, picking up
// restatements and split adjustments. Keyed by PERIOD-end year, not filing fy.

// pickMax=true takes the largest value per year across the tags instead of the first
// present. Used for REIT revenue, where rent may be the whole top line for one trust
// (tagged under a lease concept) and only a slice for another that books the complete
// total under "Revenues"; the largest is the real top line in both. Rent carries no
// excise tax, so the size comparison is safe here in a way it would not be for a
// product company whose gross "Revenues" includes excise.
function annualByYear(facts, tags, unit = "USD", pickMax = false) {
  const out = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    const perTag = {};
    for (const u of units) {
      if (!u.form || !u.form.startsWith("10-K") || !u.start || !u.end) continue;
      const dur = days(u.start, u.end);
      if (dur < 350 || dur > 380) continue;
      const fy = new Date(u.end).getUTCFullYear();
      if (!perTag[fy] || (u.filed || "") > (perTag[fy].filed || ""))
        perTag[fy] = { val: u.val, end: u.end, filed: u.filed || "", accn: u.accn, form: u.form };
    }
    for (const fy in perTag) if (!(fy in out) || (pickMax && perTag[fy].val > out[fy].val)) out[fy] = perTag[fy];
  }
  return out;
}

function instantByYear(facts, tags, unit = "USD") {
  const out = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    const perTag = {};
    for (const u of units) {
      if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
      const fy = new Date(u.end).getUTCFullYear();
      if (!perTag[fy] || (u.filed || "") > (perTag[fy].filed || ""))
        perTag[fy] = { val: u.val, end: u.end, filed: u.filed || "" };
    }
    for (const fy in perTag) if (!(fy in out)) out[fy] = perTag[fy];
  }
  return out;
}

const valuesByYear = (by) => Object.fromEntries(Object.entries(by).map(([fy, e]) => [fy, e.val]));
const latestEntry = (by) => {
  const fys = Object.keys(by).map(Number);
  if (!fys.length) return null;
  const fy = Math.max(...fys);
  return { ...by[fy], fy };
};

// A few filers tag weighted-average share counts in millions in some years (the value reads
// ~700 instead of ~700,000,000, McDonald's from 2023 on), a units artifact that silently
// corrupts every per-share figure. A real share count varies by well under a power of ten
// across a decade, so a value short of the series' dominant scale by a factor of 1000 or more
// is mis-tagged: climb it back up in 1000x steps until it sits within an order of magnitude of
// the reference. Self-anchored to the largest (correct-scale) value in the series, so a
// dual-class filer whose count is genuinely small (Berkshire's A-share basis) is never scaled,
// having no larger sibling to anchor against.
function fixShareScale(v, ref) {
  if (v == null || v <= 0 || ref == null || ref <= 0) return v;
  while (v * 1000 <= ref) v *= 1000;
  return v;
}
function normalizeShareScale(byYear) {
  const vals = Object.values(byYear).filter((v) => v != null && v > 0);
  if (vals.length < 2) return byYear; // no reference scale to compare against
  const ref = Math.max(...vals);
  const out = {};
  for (const fy in byYear) out[fy] = fixShareScale(byYear[fy], ref);
  return out;
}

// Of two share-count observations, the one whose period ends latest (ties go to the first,
// the weighted average, which is the right per-share denominator). Lets a fresh period-end
// count override a weighted average that went stale when a partnership converted: KKR stops
// tagging units in 2017 but keeps reporting shares outstanding, so the stale 2017 figure must
// not win over the current count.
const freshestShare = (a, b) => {
  const xs = [a, b].filter((o) => o && o.val != null);
  if (!xs.length) return null;
  xs.sort((x, y) => (x.end < y.end ? 1 : x.end > y.end ? -1 : 0));
  return xs[0].val;
};

const pickAnnual = (facts, tags, unit = "USD") => latestEntry(annualByYear(facts, tags, unit));
const pickInstant = (facts, tags, unit = "USD") => latestEntry(instantByYear(facts, tags, unit));
const collectAnnual = (facts, tags, unit = "USD") => valuesByYear(annualByYear(facts, tags, unit));
const collectInstant = (facts, tags, unit = "USD") => valuesByYear(instantByYear(facts, tags, unit));

// ---- trailing twelve months ----
// All duration observations (10-K and 10-Q) for a concept.
function durations(facts, tags, unit = "USD") {
  const all = [];
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    for (const u of units) {
      if (!u.form || !u.start || !u.end) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      all.push({ val: u.val, start: u.start, end: u.end, dur: days(u.start, u.end), filed: u.filed || "" });
    }
  }
  return all;
}

// TTM(flow) = prior full year + current year-to-date − prior-year same-period YTD,
// using the cumulative durations 10-Qs report. If the freshest data is already a
// full year (a 10-K with no newer quarter), TTM equals that year. null if unclean.
function ttmFlow(facts, tags, unit = "USD") {
  const all = durations(facts, tags, unit);
  if (!all.length) return null;
  const maxEnd = all.reduce((m, e) => (new Date(e.end) > new Date(m) ? e.end : m), all[0].end);
  const cur = all.filter((e) => e.end === maxEnd).sort((a, b) => b.dur - a.dur || b.filed.localeCompare(a.filed))[0];
  if (!cur) return null;
  if (cur.dur >= 350 && cur.dur <= 380) return { val: cur.val, asOf: cur.end, isFY: true };
  const prevEnd = new Date(cur.end);
  prevEnd.setUTCFullYear(prevEnd.getUTCFullYear() - 1);
  const prevEndStr = prevEnd.toISOString().slice(0, 10);
  const priorYTD = all
    .filter((e) => Math.abs(days(e.end, prevEndStr)) <= 20 && Math.abs(e.dur - cur.dur) <= 25)
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
  const priorFY = all
    .filter((e) => e.dur >= 350 && e.dur <= 380 && Math.abs(days(e.end, cur.start)) <= 45)
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (priorYTD && priorFY) return { val: priorFY.val + cur.val - priorYTD.val, asOf: cur.end, isFY: false };
  const fy = all.filter((e) => e.dur >= 350 && e.dur <= 380).sort((a, b) => new Date(b.end) - new Date(a.end))[0];
  return fy ? { val: fy.val, asOf: fy.end, isFY: true } : null;
}

// Latest period value across 10-K and 10-Q, for the freshest share count (flow)
// and balance-sheet items (instant). Carries the source form so the caller can say
// whether "current" is a fresh quarter (10-Q) or the fiscal year-end (10-K).
function latestObservation(facts, tags, unit = "USD", instant = false) {
  let best = null;
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    for (const u of units) {
      if (!u.form || !u.end || (instant ? !!u.start : !u.start)) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      if (!best || new Date(u.end) > new Date(best.end) || (u.end === best.end && (u.filed || "") > best.filed))
        best = { val: u.val, end: u.end, filed: u.filed || "", form: u.form };
    }
  }
  return best;
}

// ---- quarterly series (for the Current Position trend + recent-quarter momentum) ----
// A balance-sheet line over the recent quarter-ends: every instant observation (10-K + 10-Q),
// keyed by period end, latest filing winning a restatement. Map of end-date -> value.
function instantMap(facts, tags, unit = "USD") {
  const out = {}, filed = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    for (const u of units) {
      if (!u.form || !u.end || u.start) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      const f = u.filed || "";
      if (!(u.end in out) || f >= (filed[u.end] || "")) { out[u.end] = u.val; filed[u.end] = f; }
    }
  }
  return out;
}
// An income line as a true three-month quarterly flow: 10-Qs report both a 3-month and a cumulative
// year-to-date duration, so we keep only the ~90-day observations. (Cash flow is YTD-only and so is
// not read this way — burn comes from the TTM figure instead.) Map of end-date -> quarterly value.
function quarterFlowMap(facts, tags, unit = "USD") {
  const out = {}, filed = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    for (const u of units) {
      if (!u.form || !u.start || !u.end) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      const dur = days(u.start, u.end);
      if (dur < 80 || dur > 100) continue; // a single quarter, not a YTD or annual span
      const f = u.filed || "";
      if (!(u.end in out) || f >= (filed[u.end] || "")) { out[u.end] = u.val; filed[u.end] = f; }
    }
  }
  return out;
}
// The last n quarters: liquidity (current assets/liabilities, cash) as instants, and revenue/earnings
// as three-month flows, merged on the period end. Drives the trend and the recent-quarter momentum;
// every figure raw, so the ratios are derived in page code and never need re-fetching.
function quarterSeries(facts, revTags, n = 8) {
  const ca = instantMap(facts, CONCEPTS.currentAssets);
  const cl = instantMap(facts, CONCEPTS.currentLiabilities);
  const cash = instantMap(facts, CONCEPTS.cashAndEquivalents);
  const rev = quarterFlowMap(facts, revTags);
  const ni = quarterFlowMap(facts, CONCEPTS.netIncome);
  const oi = quarterFlowMap(facts, CONCEPTS.operatingIncome);
  const ends = [...new Set([...Object.keys(ca), ...Object.keys(rev)])].sort();
  return ends
    .map((end) => ({
      end,
      currentAssets: ca[end] ?? null, currentLiabilities: cl[end] ?? null, cash: cash[end] ?? null,
      revenue: rev[end] ?? null, netIncome: ni[end] ?? null, operatingIncome: oi[end] ?? null,
    }))
    .filter((q) => q.currentAssets != null || q.revenue != null)
    .slice(-n);
}

async function main() {
  process.stdout.write("Resolving tickers → CIK from SEC… ");
  const map = await getJSON("https://www.sec.gov/files/company_tickers.json");
  const cikByTicker = {};
  for (const row of Object.values(map)) {
    cikByTicker[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
  }
  console.log("done.");

  const companies = [];
  // Companies fetched but withheld for failing the data-quality floor (a blank headline or a
  // husk with no earnings). Tracked so the merge below drops them rather than carrying stale
  // data, and so the run can report how many the expansion shed.
  const withheld = new Set();
  // ONLY_FUND limits the per-company fetch to a few tickers for a fast, cheap debug run
  // (the full universe is several hundred names). Safe on a real refresh too: the merge
  // below carries every other company over from the last good file, so the catalog is
  // never truncated, only the named tickers are re-fetched. Blank = the whole universe.
  const onlyFund = (process.env.ONLY_FUND || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  for (const { ticker, name } of universe.tickers) {
    if (onlyFund.length && !onlyFund.includes(ticker.toUpperCase())) continue;
    const cik = cikByTicker[ticker.toUpperCase()];
    if (!cik) {
      console.warn(`  ! ${ticker}: no CIK in SEC map, skipping`);
      continue;
    }
    await sleep(THROTTLE_MS);
    let facts;
    try {
      facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    } catch (err) {
      console.warn(`  ! ${ticker}: companyfacts failed (${err.message}), skipping`);
      continue;
    }

    // Industry code (drives the archetype classifier). Non-fatal if it fails.
    let sic = null, sicDescription = null;
    try {
      await sleep(THROTTLE_MS);
      const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
      sic = sub?.sic || null;
      sicDescription = sub?.sicDescription || null;
    } catch {
      /* leave null */
    }

    // Display name: a curated universe name wins; otherwise fall back to EDGAR's own
    // entity name, title-cased. Lets the catalog grow by listing tickers alone.
    const displayName = (name && name.trim().toUpperCase() !== ticker.toUpperCase())
      ? name
      : (prettifyName(facts?.entityName) || name);

    // A REIT's top line is rental income; we take the largest of the lease, real-estate
    // and total-revenue tags (see REIT_REVENUE), which captures both the trust whose rent
    // is the whole top line and the one that books a combined total under "Revenues".
    const sicN = Number(sic) || 0;
    const isReitCo = sicN >= 6500 && sicN <= 6799;
    const isInsurerCo = sicN >= 6300 && sicN <= 6399;
    const isBankCo = sicN >= 6020 && sicN <= 6079;
    const revTags = isReitCo ? REIT_REVENUE : isInsurerCo ? INSURER_REVENUE : isBankCo ? BANK_REVENUE : CONCEPTS.revenue;
    const revAnnualBy = annualByYear(facts, revTags, "USD", isReitCo || isInsurerCo);
    // Most banks book no combined total-revenue tag at all — their top line is two components, net
    // interest income plus noninterest income. For any year the total tags miss, reconstruct the total
    // from those components (both required, so a half-tagged year never understates). This is what lets
    // the majority of banks — which report only components — anchor to the current year and read their
    // real total revenue instead of stranding at an old filing or showing a fee sliver.
    if (isBankCo) {
      const niiBy = annualByYear(facts, CONCEPTS.netInterestIncome, "USD");
      const noniBy = annualByYear(facts, CONCEPTS.noninterestIncome, "USD");
      for (const fy of new Set([...Object.keys(niiBy), ...Object.keys(noniBy)])) {
        if (revAnnualBy[fy]) continue; // a reported total tag wins
        const nii = niiBy[fy], noni = noniBy[fy];
        if (nii && noni && nii.val != null && noni.val != null)
          revAnnualBy[fy] = { val: nii.val + noni.val, end: nii.end || noni.end, filed: (nii.filed || "") > (noni.filed || "") ? nii.filed : noni.filed, form: nii.form || noni.form };
      }
    }
    const latestRev = latestEntry(revAnnualBy);
    const revLatest = latestRev?.val ?? null;

    const oi = pickAnnual(facts, CONCEPTS.operatingIncome);
    // Anchor the fiscal year, period and filing link on whichever of operating income or revenue is
    // MORE RECENT. Operating income marks the period well for most filers, but an insurer like
    // Berkshire tags OperatingIncomeLoss only in an old year (its latest is FY2012), which would
    // otherwise anchor the whole record — fy, TTM, the filing link — to that stale year.
    const anchor = (oi && latestRev)
      ? (new Date(oi.end) >= new Date(latestRev.end) ? oi : latestRev)
      : (oi || latestRev); // for fy / period / filing link
    const maxOf = (...vals) => { const xs = vals.filter((v) => v != null); return xs.length ? Math.max(...xs) : null; };
    // Total debt: long-term + current from the component tags, taken against the max of
    // every aggregate total-debt tag. We take the MAX across the tags (not a priority
    // merge) because a filer can tag its debt under different concepts in different
    // years; the max keeps the year-to-year series consistent and complete, and can
    // only correct an under-capture, never reduce a figure the components already got.
    const ltd = pickInstant(facts, CONCEPTS.longTermDebt);
    const cur = pickInstant(facts, CONCEPTS.currentDebt);
    const componentDebt = ltd || cur ? (ltd?.val || 0) + (cur?.val || 0) : null;
    const aggInstantVals = CONCEPTS.debtTotal.map((t) => pickInstant(facts, [t])?.val ?? null);
    const aggSeriesByTag = CONCEPTS.debtTotal.map((t) => collectInstant(facts, [t]));
    const aggTTMVals = CONCEPTS.debtTotal.map((t) => latestObservation(facts, [t], "USD", true)?.val ?? null);
    const aggYear = (fy) => maxOf(...aggSeriesByTag.map((s) => s[fy] ?? null));
    // Secured + unsecured: many REITs split borrowings into these two buckets and tag no
    // combined total. They are mutually exclusive, so their sum is a valid total estimate
    // (max within each family first, in case a filer tags both a total and a long-term
    // variant). Offered to the overall max alongside the component pair and the aggregates,
    // so it lifts a split-tagged filer without ever inflating one already captured whole.
    const SECURED = ["SecuredDebt", "SecuredLongTermDebt"], UNSECURED = ["UnsecuredDebt", "UnsecuredLongTermDebt"];
    const famInstant = (tags) => maxOf(...tags.map((t) => pickInstant(facts, [t])?.val ?? null));
    const famSeries = (tags) => { const o = {}; for (const t of tags) { const s = collectInstant(facts, [t]); for (const fy in s) o[fy] = Math.max(o[fy] ?? -Infinity, s[fy]); } return o; };
    const splitInstant = (() => { const s = famInstant(SECURED), u = famInstant(UNSECURED); return s != null || u != null ? (s || 0) + (u || 0) : null; })();
    const secSeries = famSeries(SECURED), unsecSeries = famSeries(UNSECURED);
    const splitYear = (fy) => { const s = secSeries[fy], u = unsecSeries[fy]; return s != null || u != null ? (s || 0) + (u || 0) : null; };
    const totalDebt = maxOf(componentDebt, splitInstant, ...aggInstantVals);

    // Diagnostic: DEBT_DEBUG=DPZ dumps every debt-like us-gaap tag and its latest annual
    // value, so a debt-capture problem can be diagnosed from the actual filings.
    if (process.env.DEBT_DEBUG && process.env.DEBT_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      const ug = facts?.facts?.["us-gaap"] || {};
      const TOTAL = /^(Debt|LongTermDebt|SecuredLongTermDebt|SecuredDebt|SeniorNotes|NotesPayable)/;
      console.log(`\n=== DEBT_DEBUG ${ticker}: componentDebt=${componentDebt}, totalDebt=${totalDebt} ===`);
      for (const concept of Object.keys(ug)) {
        if (!/debt|notespay|borrow|capitallease|senior/i.test(concept)) continue;
        const usd = ug[concept]?.units?.USD;
        if (!usd) continue;
        const byYear = {};
        for (const o of usd) { if (o.form !== "10-K" || o.fp !== "FY" || o.fy == null) continue; if (!byYear[o.fy] || o.end > byYear[o.fy].end) byYear[o.fy] = o; }
        const years = Object.keys(byYear).sort();
        if (!years.length) continue;
        if (TOTAL.test(concept)) console.log(`  [series] ${concept}: ${years.map((y) => `${y}=${(byYear[y].val / 1e6).toFixed(0)}M`).join(" ")}`);
        else console.log(`  ${concept.padEnd(56)} ${(byYear[years[years.length - 1]].val / 1e6).toFixed(0).padStart(9)}M  (FY${years[years.length - 1]})`);
      }
      console.log("=== end DEBT_DEBUG ===\n");
    }

    // Diagnostic: CASH_DEBUG=BRK-A dumps every cash/investment-like us-gaap tag and its 10-K annual
    // instant series, flagging years with multiple distinct values (segment-dimensioned facts) and
    // whether a frame (the consolidated default member) is present — so a segmented balance sheet
    // like Berkshire's, where cash and Treasury bills are split across reporting segments, can be
    // diagnosed against what companyfacts actually exposes.
    if (process.env.CASH_DEBUG && process.env.CASH_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      console.log(`\n=== CASH_DEBUG ${ticker} (cash/investment tags; $B; {a,b}=multiple vals that year; *=has frame) ===`);
      // Scan every namespace, not just us-gaap: Berkshire tags its ~$290B Treasury-bill pile under a
      // company-extension element the standard taxonomy doesn't carry, so it never shows in us-gaap.
      const allNs = facts?.facts || {};
      for (const ns of Object.keys(allNs)) {
        for (const concept of Object.keys(allNs[ns] || {})) {
          if (!/cash|shortterminvest|treasur|marketable|investment|usgovernment|heldtomaturit|availableforsale|equitysecurit|debtsecurit/i.test(concept)) continue;
          const usd = allNs[ns][concept]?.units?.USD;
          if (!usd) continue;
          const byYear = {};
          for (const o of usd) { if (o.form !== "10-K" || o.fy == null || o.start) continue; (byYear[o.fy] ||= []).push(o); }
          const yrs = Object.keys(byYear).sort();
          if (!yrs.length) continue;
          const cell = (os) => { const v = [...new Set(os.map((o) => o.val))]; const f = os.some((o) => o.frame) ? "*" : ""; return (v.length > 1 ? `{${v.map((x) => (x / 1e9).toFixed(1)).join(",")}}` : (v[0] / 1e9).toFixed(1)) + f; };
          console.log(`  ${((ns === "us-gaap" ? "" : ns + ":") + concept).padEnd(64)} ${yrs.map((y) => `${String(y).slice(2)}:${cell(byYear[y])}`).join(" ")}`);
        }
      }
      console.log("=== end CASH_DEBUG ===\n");
    }

    const pick = (tags) => pickAnnual(facts, tags)?.val ?? null;
    const inst = (tags) => pickInstant(facts, tags)?.val ?? null;

    // Diagnostic: REVENUE_DEBUG=APA dumps every revenue-like us-gaap tag and its latest
    // annual value, to find the concept a filer that reads no top line actually uses
    // (Apache, some healthcare and warehouse REITs whose rent sits under an odd tag).
    if (process.env.REVENUE_DEBUG && process.env.REVENUE_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      const ug = facts?.facts?.["us-gaap"] || {};
      console.log(`\n=== REVENUE_DEBUG ${ticker}: revenue=${pick(revTags)} (sic ${sic}) ===`);
      for (const concept of Object.keys(ug)) {
        if (!/revenue|sales|leaseincome|operatingleaselease|residentfee|interestandfee/i.test(concept)) continue;
        const usd = ug[concept]?.units?.USD;
        if (!usd) continue;
        const byYear = {};
        for (const o of usd) { if (o.form !== "10-K" || o.fp !== "FY" || o.fy == null) continue; if (!byYear[o.fy] || o.end > byYear[o.fy].end) byYear[o.fy] = o; }
        const years = Object.keys(byYear).sort();
        if (!years.length) continue;
        const last = byYear[years[years.length - 1]];
        console.log(`  ${concept.padEnd(58)} ${(last.val / 1e6).toFixed(0).padStart(10)}M  (FY${years[years.length - 1]})`);
      }
      console.log("=== end REVENUE_DEBUG ===\n");
    }

    // Diagnostic: DEP_DEBUG=MSFT dumps every depreciation/amortization us-gaap tag and its
    // latest annual value, to find the cash-flow add-back concept a filer actually uses.
    // Microsoft and Alphabet tag it outside the standard three, so they read null and the
    // maintenance-capex (steady-state owner earnings) lens cannot run on the very names the
    // AI build-out makes it matter for; this names the real tag so it can be mapped.
    if (process.env.DEP_DEBUG && process.env.DEP_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      const ug = facts?.facts?.["us-gaap"] || {};
      console.log(`\n=== DEP_DEBUG ${ticker}: depreciation=${pick(CONCEPTS.depreciation)} ===`);
      for (const concept of Object.keys(ug)) {
        if (!/depreciat|amorti|accretion/i.test(concept)) continue;
        const usd = ug[concept]?.units?.USD;
        if (!usd) continue;
        const byYear = {};
        for (const o of usd) { if (o.form !== "10-K" || o.fp !== "FY" || o.fy == null) continue; if (!byYear[o.fy] || o.end > byYear[o.fy].end) byYear[o.fy] = o; }
        const years = Object.keys(byYear).sort();
        if (!years.length) continue;
        const last = byYear[years[years.length - 1]];
        console.log(`  ${concept.padEnd(58)} ${(last.val / 1e6).toFixed(0).padStart(10)}M  (FY${years[years.length - 1]})`);
      }
      console.log("=== end DEP_DEBUG ===\n");
    }

    // Diagnostic: CFO_DEBUG=APD dumps every operating-cash-flow us-gaap tag and its latest annual
    // value, to find the line a filer with discontinued operations actually uses (Air Products,
    // Ashland, GE HealthCare tag ...ContinuingOperations, so the plain tag reads null — or a partial
    // quarterly value sneaks into the TTM). Names the real tag so the concept map can be widened.
    if (process.env.CFO_DEBUG && process.env.CFO_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      const ug = facts?.facts?.["us-gaap"] || {};
      console.log(`\n=== CFO_DEBUG ${ticker}: cashFromOps=${pick(CONCEPTS.cashFromOps)} ===`);
      for (const concept of Object.keys(ug)) {
        if (!/cashprovided|cashused|operatingactiv|netcashflow/i.test(concept)) continue;
        const usd = ug[concept]?.units?.USD;
        if (!usd) continue;
        const byYear = {};
        for (const o of usd) { if (o.form !== "10-K" || o.fp !== "FY" || o.fy == null) continue; if (!byYear[o.fy] || o.end > byYear[o.fy].end) byYear[o.fy] = o; }
        const years = Object.keys(byYear).sort();
        if (!years.length) continue;
        const last = byYear[years[years.length - 1]];
        console.log(`  ${concept.padEnd(66)} ${(last.val / 1e6).toFixed(0).padStart(10)}M  (FY${years[years.length - 1]})`);
      }
      console.log("=== end CFO_DEBUG ===\n");
    }

    // Diagnostic: CAPEX_DEBUG=EOG dumps every investing-outflow us-gaap tag and its latest annual
    // value, to find the capex concept a filer actually uses (oil & gas, utilities and others tag it
    // outside the standard PaymentsToAcquirePropertyPlantAndEquipment, so owner earnings reads null).
    if (process.env.CAPEX_DEBUG && process.env.CAPEX_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      console.log(`\n=== CAPEX_DEBUG ${ticker}: capex=${pick(CONCEPTS.capex)} ===`);
      // Scan every namespace, not just us-gaap: a regulated utility or pipeline often tags its plant
      // additions under a company-extension concept the standard taxonomy doesn't carry.
      const allNs = facts?.facts || {};
      for (const ns of Object.keys(allNs)) {
        for (const concept of Object.keys(allNs[ns] || {})) {
          if (!/payment|capital|additionsto|purchaseof|acqui|propert|plant|equipment|construction|expenditure/i.test(concept)) continue;
          if (/proceeds|receivable|liabilit|payable|fairvalue|future|maturit|leasepayments|repurchase|dividend|stockcomp|sharebased/i.test(concept)) continue;
          const usd = allNs[ns][concept]?.units?.USD;
          if (!usd) continue;
          const byYear = {};
          for (const o of usd) { if (o.form !== "10-K" || o.fp !== "FY" || o.fy == null) continue; if (!byYear[o.fy] || o.end > byYear[o.fy].end) byYear[o.fy] = o; }
          const years = Object.keys(byYear).sort();
          if (!years.length) continue;
          const last = byYear[years[years.length - 1]];
          if (Math.abs(last.val) < 1e6) continue;
          console.log(`  ${((ns === "us-gaap" ? "" : ns + ":") + concept).padEnd(68)} ${(last.val / 1e6).toFixed(0).padStart(10)}M  (FY${years[years.length - 1]})`);
        }
      }
      console.log("=== end CAPEX_DEBUG ===\n");
    }

    // Diagnostic: SHARES_DEBUG=MCD dumps every share-count us-gaap tag and its annual values,
    // to find the concept a filer that reads null uses (asset managers, partnerships) and to
    // spot a units artifact (a filer tagging weighted-average shares in millions, so the value
    // reads ~700 instead of ~700,000,000).
    if (process.env.SHARES_DEBUG && process.env.SHARES_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      const ug = facts?.facts?.["us-gaap"] || {};
      console.log(`\n=== SHARES_DEBUG ${ticker}: sharesDiluted=${pickAnnual(facts, CONCEPTS.sharesDiluted, "shares")?.val ?? null} ===`);
      for (const concept of Object.keys(ug)) {
        if (!/shares?outstanding|weightedaverage|commonstock|commonunit|partnership|limitedpartner|sharesissued/i.test(concept)) continue;
        const sh = ug[concept]?.units?.shares;
        if (!sh) continue;
        const byYear = {};
        for (const o of sh) { if (o.form !== "10-K" || o.fp !== "FY" || o.fy == null) continue; if (!byYear[o.fy] || o.end > byYear[o.fy].end) byYear[o.fy] = o; }
        const years = Object.keys(byYear).sort();
        if (!years.length) continue;
        console.log(`  ${concept.padEnd(56)} ${years.map((y) => `${y}=${byYear[y].val}`).join(" ")}`);
      }
      console.log("=== end SHARES_DEBUG ===\n");
    }
    const accnNoDash = anchor?.accn ? anchor.accn.replace(/-/g, "") : null;
    const sourceUrl = accnNoDash
      ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${anchor.accn}-index.htm`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&count=10`;

    // Up to ~10 years of history for the durability strips.
    const ha = {
      revenue: valuesByYear(revAnnualBy),
      operatingIncome: collectAnnual(facts, CONCEPTS.operatingIncome),
      costsAndExpenses: collectAnnual(facts, CONCEPTS.costsAndExpenses),
      interestExpense: collectAnnual(facts, CONCEPTS.interestExpense),
      incomeTaxExpense: collectAnnual(facts, CONCEPTS.incomeTaxExpense),
      netIncome: collectAnnual(facts, CONCEPTS.netIncome),
      cashFromOps: collectAnnual(facts, CONCEPTS.cashFromOps),
      capex: collectAnnual(facts, CONCEPTS.capex),
      costOfRevenue: collectAnnual(facts, CONCEPTS.costOfRevenue),
      depreciation: collectAnnual(facts, CONCEPTS.depreciation),
      dividendsPaid: collectAnnual(facts, CONCEPTS.dividendsPaid),
      buybacks: collectAnnual(facts, CONCEPTS.buybacks),
      repurchasedShares: collectAnnual(facts, CONCEPTS.repurchasedShares, "shares"),
      sharesDiluted: collectAnnual(facts, CONCEPTS.sharesDiluted, "shares"),
      netInterestIncome: collectAnnual(facts, CONCEPTS.netInterestIncome),
      noninterestIncome: collectAnnual(facts, CONCEPTS.noninterestIncome),
      noninterestExpense: collectAnnual(facts, CONCEPTS.noninterestExpense),
      provisionForCreditLosses: collectAnnual(facts, CONCEPTS.provisionForCreditLosses),
      gainOnSaleRealEstate: collectAnnual(facts, CONCEPTS.gainOnSaleRealEstate),
      premiumsEarned: collectAnnual(facts, CONCEPTS.premiumsEarned),
      claimsIncurred: collectAnnual(facts, CONCEPTS.claimsIncurred),
      underwritingExpense: collectAnnual(facts, CONCEPTS.underwritingExpense),
      lossesAndExpenses: collectAnnual(facts, CONCEPTS.lossesAndExpenses),
      investmentIncome: collectAnnual(facts, CONCEPTS.investmentIncome),
      stockBasedComp: collectAnnual(facts, CONCEPTS.stockBasedComp),
      sgaExpense: collectAnnual(facts, CONCEPTS.sgaExpense),
      researchDevelopment: collectAnnual(facts, CONCEPTS.researchDevelopment),
      acquisitionSpend: collectAnnual(facts, CONCEPTS.acquisitionSpend),
      goodwillImpairment: collectAnnual(facts, CONCEPTS.goodwillImpairment),
      assetImpairment: collectAnnual(facts, CONCEPTS.assetImpairment),
    };
    // Fill any year with no weighted-average share count using the period-end count (asset
    // managers and former partnerships like KKR report only shares outstanding), then correct
    // any year a filer tagged its counts in millions rather than units, so per-share figures
    // stay honest across the whole record (see normalizeShareScale). shareRef is the record's
    // correct scale, applied to the latest-annual and TTM counts captured separately below.
    const sharesInstant = collectInstant(facts, CONCEPTS.sharesOutstanding, "shares");
    for (const fy in sharesInstant) if (ha.sharesDiluted[fy] == null) ha.sharesDiluted[fy] = sharesInstant[fy];
    ha.sharesDiluted = normalizeShareScale(ha.sharesDiluted);
    ha.repurchasedShares = normalizeShareScale(ha.repurchasedShares);
    const shareRef = Math.max(0, ...Object.values(ha.sharesDiluted).filter((v) => v != null));
    const hi = {
      equity: collectInstant(facts, CONCEPTS.stockholdersEquity),
      cash: collectInstant(facts, CONCEPTS.cashAndEquivalents),
      stInv: collectInstant(facts, CONCEPTS.shortTermInvestments),
      ltMkt: collectInstant(facts, CONCEPTS.longTermMarketable),
      ltd: collectInstant(facts, CONCEPTS.longTermDebt),
      cur: collectInstant(facts, CONCEPTS.currentDebt),
      ca: collectInstant(facts, CONCEPTS.currentAssets),
      cl: collectInstant(facts, CONCEPTS.currentLiabilities),
      receivables: collectInstant(facts, CONCEPTS.receivables),
      inventory: collectInstant(facts, CONCEPTS.inventory),
      accountsPayable: collectInstant(facts, CONCEPTS.accountsPayable),
      assets: collectInstant(facts, CONCEPTS.totalAssets),
      deposits: collectInstant(facts, CONCEPTS.deposits),
      goodwill: collectInstant(facts, CONCEPTS.goodwill),
      intangibles: collectInstant(facts, CONCEPTS.intangibleAssets),
      realEstateGross: collectInstant(facts, CONCEPTS.realEstateGross),
      lossReserves: collectInstant(facts, CONCEPTS.lossReserves),
      netPPE: collectInstant(facts, CONCEPTS.netPPE),
      operatingLeaseAsset: collectInstant(facts, CONCEPTS.operatingLeaseAsset),
    };
    const history = Object.keys(ha.revenue)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(-10)
      .map((fy) => ({
        fy,
        lines: {
          revenue: ha.revenue[fy] ?? null,
          operatingIncome: deriveOpInc(ha.operatingIncome[fy] ?? null, ha.revenue[fy] ?? null, ha.costsAndExpenses[fy] ?? null, ha.netIncome[fy] ?? null, ha.incomeTaxExpense[fy] ?? null, ha.interestExpense[fy] ?? null),
          interestExpense: ha.interestExpense[fy] ?? null,
          incomeTaxExpense: ha.incomeTaxExpense[fy] ?? null,
          netIncome: ha.netIncome[fy] ?? null,
          stockBasedComp: ha.stockBasedComp[fy] ?? null,
          sgaExpense: ha.sgaExpense[fy] ?? null,
          researchDevelopment: ha.researchDevelopment[fy] ?? null,
          acquisitionSpend: ha.acquisitionSpend[fy] ?? null,
          goodwillImpairment: ha.goodwillImpairment[fy] ?? null,
          assetImpairment: ha.assetImpairment[fy] ?? null,
          totalDebt: maxOf(hi.ltd[fy] != null || hi.cur[fy] != null ? (hi.ltd[fy] || 0) + (hi.cur[fy] || 0) : null, splitYear(fy), aggYear(fy)),
          stockholdersEquity: hi.equity[fy] ?? null,
          cashAndEquivalents: hi.cash[fy] ?? null,
          shortTermInvestments: hi.stInv[fy] ?? null,
          longTermMarketable: hi.ltMkt[fy] ?? null,
          receivables: hi.receivables[fy] ?? null,
          inventory: hi.inventory[fy] ?? null,
          netPPE: hi.netPPE[fy] ?? null,
          operatingLeaseAsset: hi.operatingLeaseAsset[fy] ?? null,
          accountsPayable: hi.accountsPayable[fy] ?? null,
          currentAssets: hi.ca[fy] ?? null,
          currentLiabilities: hi.cl[fy] ?? null,
          cashFromOps: ha.cashFromOps[fy] ?? null,
          capex: ha.capex[fy] ?? null,
          costOfRevenue: ha.costOfRevenue[fy] ?? null,
          depreciation: ha.depreciation[fy] ?? null,
          dividendsPaid: ha.dividendsPaid[fy] ?? null,
          buybacks: ha.buybacks[fy] ?? null,
          repurchasedShares: ha.repurchasedShares[fy] ?? null,
          sharesDiluted: ha.sharesDiluted[fy] ?? null,
          netInterestIncome: ha.netInterestIncome[fy] ?? null,
          noninterestIncome: ha.noninterestIncome[fy] ?? null,
          noninterestExpense: ha.noninterestExpense[fy] ?? null,
          provisionForCreditLosses: ha.provisionForCreditLosses[fy] ?? null,
          totalAssets: hi.assets[fy] ?? null,
          deposits: hi.deposits[fy] ?? null,
          goodwill: hi.goodwill[fy] ?? null,
          intangibleAssets: hi.intangibles[fy] ?? null,
          gainOnSaleRealEstate: ha.gainOnSaleRealEstate[fy] ?? null,
          realEstateGross: hi.realEstateGross[fy] ?? null,
          premiumsEarned: ha.premiumsEarned[fy] ?? null,
          claimsIncurred: ha.claimsIncurred[fy] ?? null,
          underwritingExpense: ha.underwritingExpense[fy] ?? null,
          lossesAndExpenses: ha.lossesAndExpenses[fy] ?? null,
          investmentIncome: ha.investmentIncome[fy] ?? null,
          lossReserves: hi.lossReserves[fy] ?? null,
        },
      }));

    // Trailing twelve months, the freshest 12-month picture; folds in any
    // quarter filed since the last 10-K. Flows are TTM-summed; balance sheet and
    // share count are taken at the latest quarter.
    const tf = (tags, unit = "USD") => ttmFlow(facts, tags, unit)?.val ?? null;
    const ttmRev = ttmFlow(facts, revTags);
    const ttmLtd = latestObservation(facts, CONCEPTS.longTermDebt, "USD", true)?.val;
    const ttmCurDebt = latestObservation(facts, CONCEPTS.currentDebt, "USD", true)?.val;
    const ttm = ttmRev
      ? {
          asOf: ttmRev.asOf,
          isFY: ttmRev.isFY,
          lines: {
            revenue: ttmRev.val,
            operatingIncome: deriveOpInc(tf(CONCEPTS.operatingIncome), ttmRev?.val ?? null, tf(CONCEPTS.costsAndExpenses), tf(CONCEPTS.netIncome), tf(CONCEPTS.incomeTaxExpense), tf(CONCEPTS.interestExpense)),
            interestExpense: tf(CONCEPTS.interestExpense),
            netIncome: tf(CONCEPTS.netIncome),
            incomeTaxExpense: tf(CONCEPTS.incomeTaxExpense),
            cashFromOps: tf(CONCEPTS.cashFromOps),
            capex: tf(CONCEPTS.capex),
            costOfRevenue: tf(CONCEPTS.costOfRevenue),
            depreciation: tf(CONCEPTS.depreciation),
            stockBasedComp: tf(CONCEPTS.stockBasedComp),
            sgaExpense: tf(CONCEPTS.sgaExpense),
            researchDevelopment: tf(CONCEPTS.researchDevelopment),
            acquisitionSpend: tf(CONCEPTS.acquisitionSpend),
            goodwillImpairment: tf(CONCEPTS.goodwillImpairment),
            assetImpairment: tf(CONCEPTS.assetImpairment),
            stockholdersEquity: latestObservation(facts, CONCEPTS.stockholdersEquity, "USD", true)?.val ?? null,
            cashAndEquivalents: latestObservation(facts, CONCEPTS.cashAndEquivalents, "USD", true)?.val ?? null,
            shortTermInvestments: latestObservation(facts, CONCEPTS.shortTermInvestments, "USD", true)?.val ?? null,
            longTermMarketable: latestObservation(facts, CONCEPTS.longTermMarketable, "USD", true)?.val ?? null,
            receivables: latestObservation(facts, CONCEPTS.receivables, "USD", true)?.val ?? null,
            inventory: latestObservation(facts, CONCEPTS.inventory, "USD", true)?.val ?? null,
            accountsPayable: latestObservation(facts, CONCEPTS.accountsPayable, "USD", true)?.val ?? null,
            currentAssets: latestObservation(facts, CONCEPTS.currentAssets, "USD", true)?.val ?? null,
            currentLiabilities: latestObservation(facts, CONCEPTS.currentLiabilities, "USD", true)?.val ?? null,
            currentDebt: ttmCurDebt ?? null,
            totalDebt: maxOf(ttmLtd != null || ttmCurDebt != null ? (ttmLtd || 0) + (ttmCurDebt || 0) : null, ...aggTTMVals),
            sharesDiluted: fixShareScale(freshestShare(latestObservation(facts, CONCEPTS.sharesDiluted, "shares", false), pickInstant(facts, CONCEPTS.sharesOutstanding, "shares")), shareRef),
            netInterestIncome: tf(CONCEPTS.netInterestIncome),
            noninterestIncome: tf(CONCEPTS.noninterestIncome),
            noninterestExpense: tf(CONCEPTS.noninterestExpense),
            provisionForCreditLosses: tf(CONCEPTS.provisionForCreditLosses),
            totalAssets: latestObservation(facts, CONCEPTS.totalAssets, "USD", true)?.val ?? null,
            deposits: latestObservation(facts, CONCEPTS.deposits, "USD", true)?.val ?? null,
            goodwill: latestObservation(facts, CONCEPTS.goodwill, "USD", true)?.val ?? null,
            intangibleAssets: latestObservation(facts, CONCEPTS.intangibleAssets, "USD", true)?.val ?? null,
            gainOnSaleRealEstate: tf(CONCEPTS.gainOnSaleRealEstate),
            realEstateGross: latestObservation(facts, CONCEPTS.realEstateGross, "USD", true)?.val ?? null,
            premiumsEarned: tf(CONCEPTS.premiumsEarned),
            claimsIncurred: tf(CONCEPTS.claimsIncurred),
            underwritingExpense: tf(CONCEPTS.underwritingExpense),
            lossesAndExpenses: tf(CONCEPTS.lossesAndExpenses),
            investmentIncome: tf(CONCEPTS.investmentIncome),
            lossReserves: latestObservation(facts, CONCEPTS.lossReserves, "USD", true)?.val ?? null,
          },
        }
      : null;

    // ---- the freshest balance sheet, captured raw (the Current Position section, and future reads) ----
    // The whole latest-quarter balance sheet plus the Buffett-relevant extras (deferred revenue as
    // float, leases as true debt, total liabilities for net-net), the recent-quarter series for the
    // liquidity trend and earnings momentum, and provenance so we always know how fresh "current" is.
    // Stored raw; every ratio (current, quick, cash, NCAV, runway, momentum) is derived in page code.
    const lq = latestObservation(facts, CONCEPTS.currentAssets, "USD", true)
      || latestObservation(facts, CONCEPTS.totalAssets, "USD", true);
    const instq = (tags) => latestObservation(facts, tags, "USD", true)?.val ?? null;
    const quarterly = lq
      ? {
          asOf: lq.end,
          form: lq.form && lq.form.startsWith("10-K") ? "10-K" : "10-Q",
          balance: {
            cash: instq(CONCEPTS.cashAndEquivalents),
            shortTermInvestments: instq(CONCEPTS.shortTermInvestments),
            receivables: instq(CONCEPTS.receivables),
            inventory: instq(CONCEPTS.inventory),
            currentAssets: instq(CONCEPTS.currentAssets),
            accountsPayable: instq(CONCEPTS.accountsPayable),
            currentDebt: instq(CONCEPTS.currentDebt),
            deferredRevenueCurrent: instq(CONCEPTS.deferredRevenueCurrent),
            operatingLeaseCurrent: instq(CONCEPTS.operatingLeaseCurrent),
            currentLiabilities: instq(CONCEPTS.currentLiabilities),
            longTermDebt: instq(CONCEPTS.longTermDebt),
            deferredRevenueNoncurrent: instq(CONCEPTS.deferredRevenueNoncurrent),
            operatingLeaseNoncurrent: instq(CONCEPTS.operatingLeaseNoncurrent),
            totalLiabilities: instq(CONCEPTS.totalLiabilities),
            totalAssets: instq(CONCEPTS.totalAssets),
            stockholdersEquity: instq(CONCEPTS.stockholdersEquity),
            goodwill: instq(CONCEPTS.goodwill),
            intangibleAssets: instq(CONCEPTS.intangibleAssets),
            sharesOutstanding: fixShareScale(pickInstant(facts, CONCEPTS.sharesOutstanding, "shares")?.val ?? null, shareRef),
          },
          series: quarterSeries(facts, revTags),
        }
      : null;

    const rec = {
      ticker: ticker.toUpperCase(),
      name: displayName,
      cik,
      sic,
      sicDescription,
      fy: anchor?.fy ?? null,
      periodEnd: anchor?.end ?? null,
      form: anchor?.form ?? "10-K",
      sourceUrl,
      lines: {
        operatingIncome: deriveOpInc(oi?.val ?? null, revLatest, pick(CONCEPTS.costsAndExpenses), pick(CONCEPTS.netIncome), pick(CONCEPTS.incomeTaxExpense), pick(CONCEPTS.interestExpense)),
        interestExpense: pick(CONCEPTS.interestExpense),
        revenue: revLatest,
        netIncome: pick(CONCEPTS.netIncome),
        totalDebt,
        cashFromOps: pick(CONCEPTS.cashFromOps),
        depreciation: pick(CONCEPTS.depreciation),
        capex: pick(CONCEPTS.capex),
        incomeTaxExpense: pick(CONCEPTS.incomeTaxExpense),
        costOfRevenue: pick(CONCEPTS.costOfRevenue),
        stockBasedComp: pick(CONCEPTS.stockBasedComp),
        sgaExpense: pick(CONCEPTS.sgaExpense),
        researchDevelopment: pick(CONCEPTS.researchDevelopment),
        acquisitionSpend: pick(CONCEPTS.acquisitionSpend),
        goodwillImpairment: pick(CONCEPTS.goodwillImpairment),
        assetImpairment: pick(CONCEPTS.assetImpairment),
        dividendsPaid: pick(CONCEPTS.dividendsPaid),
        buybacks: pick(CONCEPTS.buybacks),
        repurchasedShares: fixShareScale(pickAnnual(facts, CONCEPTS.repurchasedShares, "shares")?.val ?? null, shareRef),
        stockholdersEquity: inst(CONCEPTS.stockholdersEquity),
        cashAndEquivalents: inst(CONCEPTS.cashAndEquivalents),
        shortTermInvestments: inst(CONCEPTS.shortTermInvestments),
        longTermMarketable: inst(CONCEPTS.longTermMarketable),
        receivables: inst(CONCEPTS.receivables),
        inventory: inst(CONCEPTS.inventory),
        netPPE: inst(CONCEPTS.netPPE),
        operatingLeaseAsset: inst(CONCEPTS.operatingLeaseAsset),
        accountsPayable: inst(CONCEPTS.accountsPayable),
        currentAssets: inst(CONCEPTS.currentAssets),
        currentLiabilities: inst(CONCEPTS.currentLiabilities),
        sharesDiluted: fixShareScale(freshestShare(pickAnnual(facts, CONCEPTS.sharesDiluted, "shares"), pickInstant(facts, CONCEPTS.sharesOutstanding, "shares")), shareRef),
        netInterestIncome: pick(CONCEPTS.netInterestIncome),
        noninterestIncome: pick(CONCEPTS.noninterestIncome),
        noninterestExpense: pick(CONCEPTS.noninterestExpense),
        provisionForCreditLosses: pick(CONCEPTS.provisionForCreditLosses),
        totalAssets: inst(CONCEPTS.totalAssets),
        deposits: inst(CONCEPTS.deposits),
        goodwill: inst(CONCEPTS.goodwill),
        intangibleAssets: inst(CONCEPTS.intangibleAssets),
        gainOnSaleRealEstate: pick(CONCEPTS.gainOnSaleRealEstate),
        realEstateGross: inst(CONCEPTS.realEstateGross),
        premiumsEarned: pick(CONCEPTS.premiumsEarned),
        claimsIncurred: pick(CONCEPTS.claimsIncurred),
        underwritingExpense: pick(CONCEPTS.underwritingExpense),
        lossesAndExpenses: pick(CONCEPTS.lossesAndExpenses),
        investmentIncome: pick(CONCEPTS.investmentIncome),
        lossReserves: inst(CONCEPTS.lossReserves),
      },
      history,
      ttm,
      quarterly,
    };
    // The quality floor: a company that can't render a non-broken page is withheld rather than
    // shipped, the condition for pushing coverage toward the whole universe without losing trust.
    if (passesQualityFloor(rec)) {
      companies.push(rec);
      console.log(`  ✓ ${ticker} (CIK ${cik}, FY${anchor?.fy ?? "?"})`);
    } else {
      withheld.add(ticker.toUpperCase());
      console.log(`  ⊘ ${ticker}: withheld (below the data-quality floor — no usable top line or no earnings)`);
    }
  }

  if (!companies.length) {
    console.error("\n❌ No companies resolved, aborting so the sample file is preserved.\n");
    process.exit(1);
  }

  // Preserve a company's prior data when it failed to fetch this run. A momentary SEC
  // error (a 429 under load, a timeout) must not drop a company that was fine last week,
  // and as the universe grows those blips become routine. We key on the current universe,
  // so a ticker genuinely removed from the list is dropped, while a transient failure is
  // carried over from the last good file.
  let prior = {};
  try {
    const priorCos = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8")).companies || [];
    prior = Object.fromEntries(priorCos.map((c) => [String(c.ticker).toUpperCase(), c]));
  } catch {}
  const fresh = Object.fromEntries(companies.map((c) => [String(c.ticker).toUpperCase(), c]));
  const merged = [];
  let carried = 0;
  for (const u of universe.tickers) {
    const T = u.ticker.toUpperCase();
    if (fresh[T]) merged.push(fresh[T]);
    else if (withheld.has(T)) continue; // fetched but failed the quality floor → no page, no stale carry-over
    else if (prior[T]) { merged.push(prior[T]); carried++; }
  }

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    source: "SEC EDGAR XBRL (companyfacts)",
    sample: false,
    note: "Latest annual (10-K) figures pulled from EDGAR. Values are raw USD.",
    companies: merged,
  };
  fs.writeFileSync(path.join(dataDir, "fundamentals.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ Wrote ${merged.length} companies (${companies.length} passed, ${withheld.size} withheld below the quality floor, ${carried} carried over from the last good file)`);
  if (withheld.size) console.log(`   withheld: ${[...withheld].sort().join(", ")}`);
}

// Exported for the offline extraction test; only hit EDGAR when run directly.
export { instantMap, quarterFlowMap, quarterSeries, latestObservation, CONCEPTS };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  });
}
