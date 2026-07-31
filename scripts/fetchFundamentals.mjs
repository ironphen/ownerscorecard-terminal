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
import { normalizeShareScale, majorityShareRef } from "../src/lib/shareScale.mjs";
import { reconcileLeaseLadder } from "../src/lib/leases.mjs";
import { compactJson } from "../src/lib/dataFile.mjs";
import { industryLabelOf, sectorOfIndustry } from "../src/lib/shelves.mjs";
import { buildCikMap, CIK_OVERRIDE, resolveCikLive } from "./cikResolve.mjs";
import { hasInsuranceData, insuranceLines, fillClaimsFromRollforward, INSURANCE_LINE_NAMES } from "./insuranceLines.mjs";
import { hasBankData, banksLines, BANK_LINE_NAMES } from "./banksLines.mjs";
import { hasSoftwareData, softwareLines, SOFTWARE_LINE_NAMES } from "./softwareLines.mjs";
import { hasOilGasData, oilGasLines, OILGAS_LINE_NAMES } from "./oilGasLines.mjs";
import { rateRegulatedConceptCount, utilitiesLines } from "./utilitiesLines.mjs";
import { freshFilingMerge } from "./filingFacts.mjs";
import { equityByYear } from "./equityGate.mjs";
// Desk lines are deterministic extractions: the same facts give the same lines every run, so an
// absence is always a deliberate gate, never a transient tag miss — the field carry-over below
// must never resurrect one from a prior file (Wells Fargo's withheld charge-offs came back from
// the dead exactly this way, 2026-07-21).
const DESK_LINES = new Set([...INSURANCE_LINE_NAMES, ...BANK_LINE_NAMES, ...SOFTWARE_LINE_NAMES, ...OILGAS_LINE_NAMES]);
// Tier-2: the named dimensional targets (scripts/fetchDimensional.mjs), read from the filings'
// own inline XBRL where companyfacts is blind — Travelers' development, Cigna's insurance book,
// Centene's premium line, Wells Fargo's modern charge-offs. Merged as the LAST source: it fills
// what Tier-1 and the desks left null and never overrides them (the registry is designed to
// avoid core overlap; income lines that exist undimensioned are excluded from it).
let DIMENSIONAL = {};
try { DIMENSIONAL = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "data", "dimensional.json"), "utf8")).companies || {}; } catch {}

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
      // A 60s per-attempt timeout so a hung server can't freeze a scheduled run indefinitely; an
      // abort throws, which the retry loop treats like any transient failure.
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
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
  // InterestExpenseOperating is the FASB successor after InterestExpense's 2023 deprecation
  // (banks desk, 2026-07-21): banks that migrated (PNC, M&T) went dark on the legacy tag and
  // their current lines silently served the FY2023 value as current. Overlap years verified
  // equal to the dollar at every filer tested.
  interestExpense: ["InterestExpense", "InterestExpenseOperating", "InterestExpenseNonoperating", "InterestAndDebtExpense"],
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
  // Overhead, and the reconstruction that makes it honest. Software and much of modern services
  // never file the combined element at all: they file selling-and-marketing and general-and-
  // administrative separately. Reading the second alone and labelling it SG&A drops the entire
  // customer-acquisition outlay — Salesforce printed 7% of revenue where the truth is 42%, Adobe
  // 7% against 34%, Oracle 2% against 15%. The two legs are kept as their own chains so the sum
  // can be rebuilt where both exist; G&A alone still stands where a filer genuinely runs no
  // selling line (a REIT, a closed-end manager), which is the honest reading for those.
  sgaExpense: ["SellingGeneralAndAdministrativeExpense"],
  sellingMarketing: ["SellingAndMarketingExpense"],
  generalAdministrative: ["GeneralAndAdministrativeExpense"],
  // Adobe files no plain R&D element at all; the software-specific successor carries the whole
  // series ($4,294M FY2025), and it is also the live tag behind Take-Two's and ACI Worldwide's
  // decade-stale figures.
  researchDevelopment: [
    "ResearchAndDevelopmentExpense",
    "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
    "ResearchAndDevelopmentExpenseSoftwareExcludingAcquiredInProcessCost",
  ],
  stockBasedComp: ["ShareBasedCompensation"],
  // PaymentsOfOrdinaryDividends appended 2026-07-28 (utilities desk survey): Duke tags all three
  // elements but the first two stopped covering recent years — the Oracle tag-migration shape — so
  // $3.30B of dividends read as absent. A per-year ladder means the append serves only the years the
  // earlier rungs lack; 32 cached filers gain a dividends line, none loses one.
  dividendsPaid: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "PaymentsOfOrdinaryDividends"],
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
  // The lease-maturity ladder (ASC 842): when the lease payments come due, by year. These are cleanly,
  // non-dimensionally tagged in XBRL — one consolidated value per bucket — so the lease wall is recovered
  // from structured data, not footnote text, and self-reconciles (sum of the buckets = the undiscounted
  // total; that less the imputed interest = the discounted liability on the balance sheet). The companion
  // to the debt wall: a retailer's, airline's or restaurant's real-estate leverage, the obligation Buffett
  // adds back to debt to see the true fixed-claim schedule.
  operatingLeaseLiability: ["OperatingLeaseLiability"],
  opLeaseY1: ["LesseeOperatingLeaseLiabilityPaymentsDueNextTwelveMonths"],
  opLeaseY2: ["LesseeOperatingLeaseLiabilityPaymentsDueYearTwo"],
  opLeaseY3: ["LesseeOperatingLeaseLiabilityPaymentsDueYearThree"],
  opLeaseY4: ["LesseeOperatingLeaseLiabilityPaymentsDueYearFour"],
  opLeaseY5: ["LesseeOperatingLeaseLiabilityPaymentsDueYearFive"],
  opLeaseAfter: ["LesseeOperatingLeaseLiabilityPaymentsDueAfterYearFive"],
  opLeaseUndiscounted: ["LesseeOperatingLeaseLiabilityPaymentsDue"],
  opLeaseImputed: ["LesseeOperatingLeaseLiabilityUndiscountedExcessAmount"],
  financeLeaseLiability: ["FinanceLeaseLiability"],
  finLeaseY1: ["FinanceLeaseLiabilityPaymentsDueNextTwelveMonths"],
  finLeaseY2: ["FinanceLeaseLiabilityPaymentsDueYearTwo"],
  finLeaseY3: ["FinanceLeaseLiabilityPaymentsDueYearThree"],
  finLeaseY4: ["FinanceLeaseLiabilityPaymentsDueYearFour"],
  finLeaseY5: ["FinanceLeaseLiabilityPaymentsDueYearFive"],
  finLeaseAfter: ["FinanceLeaseLiabilityPaymentsDueAfterYearFive"],
  finLeaseUndiscounted: ["FinanceLeaseLiabilityPaymentsDue"],
  finLeaseImputed: ["FinanceLeaseLiabilityUndiscountedExcessAmount"],
  // Net property, plant & equipment, and the operating-lease right-of-use asset (the leased plant a
  // retailer, airline, theater or warehouse operator runs on — on the balance sheet since ASC 842).
  // Together these measure how asset-heavy the operation truly is: the signal that separates a
  // capital-intensive operator from an asset-light platform when SIC and margins alone mislead
  // (a data-center operator that owns its servers; a theater chain that leases its screens).
  // The plain net-plant element dies at filers who moved to the combined property-and-finance-
  // lease presentation their own balance sheet now shows: Meta's stops at 2018 and Alphabet's at
  // FY2024, which is why Meta's asset intensity read its 2018 balance of $24.7B against a true
  // $176.4B. The successor carries finance-lease right-of-use assets alongside owned property,
  // which is the line as the filer presents it, so the basis is the filer's own.
  netPPE: [
    "PropertyPlantAndEquipmentNet",
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization",
    // Utilities tag their plant under the PublicUtilities family and often nothing else —
    // Southern's net plant is $114.4B under this tag with no plain PP&E-net anywhere (record-
    // table survey Build 3, 2026-07-31). Trailing rung: fills only where the plain tags are dark.
    "PublicUtilitiesPropertyPlantAndEquipmentNet",
  ],
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
  // The banks desk's F1 (docs/banks-desk-survey.md, 2026-07-21): the legacy chain died at BAC
  // after FY2019 and C after FY2018, leaving YEARS-STALE values in the current lines (BAC showed
  // FY2019's 3.59B as FY2025). The two recovery tags agree exactly in every overlap year tested
  // and carry the series through FY2025; the never-present ProvisionForCreditLossExpenseReversal
  // is dropped. Post-death years read loans-only scope where the filed total is dead — the
  // narrower filed fact, never a rebuilt total (Wave A adds the scope label and off-BS line).
  provisionForCreditLosses: ["ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses", "ProvisionForLoanLossesExpensed", "FinancingReceivableExcludingAccruedInterestCreditLossExpenseReversal"],
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
  // Interest a developer charges into the cost of what it is building rather than against the
  // year's earnings. It is money genuinely paid to lenders, and leaving it out of a coverage ratio
  // flatters exactly the trusts doing the most building — Boston Properties capitalised $51m in
  // FY2025, Simon $31m, AvalonBay $50m.
  interestCapitalized: ["InterestCostsCapitalized", "InterestCostsCapitalizedAdjustment"],
  // --- insurers (financials, the underwriting + float lens) ---
  premiumsEarned: ["PremiumsEarnedNet", "PremiumsEarnedNetPropertyAndCasualty"],
  // The health variants (managed-care desk, ratified 2026-07-21): PolicyholderBenefits...HealthCare
  // makes UNH/CNC/HUM's series direct (overlaps agree to the dollar) instead of leaning on the
  // rollforward fill; the deprecated HealthCareOrganization element carries Molina's 2009-2018,
  // and the rollforward fill bridges its no-overlap butt joint into the modern years (the seam
  // identity is exact both sides, 2012-2025).
  claimsIncurred: ["PolicyholderBenefitsAndClaimsIncurredNet", "PolicyholderBenefitsAndClaimsIncurredHealthCare", "IncurredClaimsPropertyCasualtyAndLiability", "PolicyholderBenefitsAndClaimsIncurredHomeAndAutomobile", "HealthCareOrganizationHealthCareCostsGross"],
  underwritingExpense: ["OtherUnderwritingExpense", "DeferredPolicyAcquisitionCostAmortizationExpense"],
  // The full combined-ratio numerator in one tag (losses + loss-adjustment + all
  // underwriting expenses), which our component pick of a single expense line misses.
  lossesAndExpenses: ["BenefitsLossesAndExpenses", "PolicyholderBenefitsAndClaimsIncurredNetAndOtherUnderwritingExpense"],
  // InvestmentIncomeNet fills years the primary tag lacks (insurance desk F1: Arch Capital tags
  // only the variant, and read as null for all ten displayed years). Per-year fallback: a filer
  // with the primary tag is untouched.
  investmentIncome: ["NetInvestmentIncome", "InvestmentIncomeNet", "InvestmentIncomeInterestAndDividend"],
  // FPB removed from this chain (managed-care desk F8, ratified 2026-07-21): it made Cigna's
  // legacy life book read as medical float. Future policy benefits is its own desk line now;
  // this chain is the claims liability only.
  lossReserves: ["LiabilityForClaimsAndClaimsAdjustmentExpense"],
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

// An aircraft, equipment or fleet lessor (Air Lease, United Rentals, AerCap) books its top line as the
// combined "Revenues" total — basic rents plus maintenance, interest and asset-sale revenue. The ASC 606
// contract tag captures only the services sliver a lessor also earns (Air Lease $0.33B against a $3.0B
// total, United Rentals $3.7B against $16.1B), so the total must win. Like REIT rent, lease income
// carries no excise, so taking the largest across these tags is safe — it never overstates. SIC 7359
// (equipment rental & leasing).
const LESSOR_REVENUE = ["Revenues", "OperatingLeaseLeaseIncome", "OperatingLeasesIncomeStatementLeaseRevenue", "RevenueNotFromContractWithCustomer", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax"];

// A regulated utility's top line commonly lives under the industry tag
// "RegulatedAndUnregulatedOperatingRevenue" — DTE stopped tagging "Revenues" entirely at Q1 2018
// and reports ONLY under it, which stranded DTE's TTM on 2018 quarters for years while the annual
// record limped along on the contract tag other utilities use. "Revenues" stays first (the years
// it exists it is the complete total); the utility tag and the contract tags fill the years a
// filer leaves it blank. Electric/gas/water/sanitary SICs (4900–4991).
const UTILITY_REVENUE = ["Revenues", "RegulatedAndUnregulatedOperatingRevenue", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax"];

// Security broker-dealers AND asset managers share SIC 6211 but tag opposite ways: Morgan Stanley
// and Goldman book the total as "RevenuesNetOfInterestExpense" (the ASC 606 contract tag is only
// their fee sliver and must never win), while BlackRock's top line IS contract revenue — nearly
// all fees — and its "Revenues" tag carries a partial figure that stranded at FY2024 ($12.8B
// against a $24.2B contract-tag total). So 6211 reads pick-max across all three: for a
// broker-dealer the net-of-interest total always exceeds its fee sliver, and for an asset manager
// the contract total always exceeds the stray partial — the largest is the real top line in both,
// and fee revenue carries no excise so the size comparison is safe.
const BROKER_REVENUE = ["Revenues", "RevenuesNetOfInterestExpense", "RevenueFromContractWithCustomerExcludingAssessedTax"];

// The revenue tags a filer's industry calls for (see the REIT/insurer/bank/utility notes above):
// rent-first for REITs, the combined total for insurers and banks, the contract-revenue
// order for everyone else. Shared with the wire, which reads the same top line per filing.
//
// The utility branch is DATA-DRIVEN, not SIC-driven: the 4900–4991 band also holds waste haulers
// and midstream partnerships whose "Revenues" tag is a gross pre-eliminations figure (Republic
// Services: ~15% above its real top line every year) or an abandoned pre-merger series (Kinetik),
// so re-prioritizing "Revenues" first by SIC alone silently corrupts them. Only a filer that
// actually reports under the utility industry tag gets the utility list; everyone else in the
// band keeps the default contract-first order, exactly as before. Callers without facts on hand
// (none today) get the safe default too.
function revenueTagsFor(sic, facts) {
  const sicN = Number(sic) || 0;
  if (sicN >= 6500 && sicN <= 6799) return REIT_REVENUE;
  if (sicN >= 6300 && sicN <= 6399) return INSURER_REVENUE;
  if (sicN >= 6020 && sicN <= 6079) return BANK_REVENUE;
  // Equipment/aircraft/fleet lessors: the combined "Revenues" total, largest-wins, never the contract
  // sliver (see LESSOR_REVENUE).
  if (sicN === 7359) return LESSOR_REVENUE;
  // Broker-dealers and asset managers: pick-max across the totals (see BROKER_REVENUE).
  if (sicN === 6211) return BROKER_REVENUE;
  // A regulated utility's statement total is "Operating Revenue" (us-gaap:Revenues); the ASC 606
  // contract tag many of them also file is a subtotal that excludes alternative-revenue programs.
  // The gate was one tag's presence, which missed CMS Energy — its quarterly revenue served the
  // contract subtotal ($1,842M against the statement's $1,920M, verified on the filing) — so it
  // now also fires on the utilities desk's own membership test, the >=5 rate-regulated-concept
  // count (candidate-scoped by the SIC range here; merchant generators fail the count and keep
  // the general ladder).
  if (sicN >= 4900 && sicN <= 4991 &&
    (facts?.facts?.["us-gaap"]?.RegulatedAndUnregulatedOperatingRevenue || rateRegulatedConceptCount(facts) >= 5)) return UTILITY_REVENUE;
  return CONCEPTS.revenue;
}

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
// A 52/53-week filer whose year ends in the first days of January is reporting the year that
// just closed, not the one that opened a day or two earlier. Leidos's period ended 2026-01-02 is
// its fiscal 2025 by its own accession; the calendar year of the period end labels it 2026, and
// then collides it with the real 2026 so one whole year vanishes from the record — Leidos lost
// FY2020 and Cadence lost FY2021 that way. Late-January enders (Salesforce, Autodesk, and twenty
// more on the software shelf) are NOT affected and must not shift, hence the first-fortnight test.
// EDGAR's own fy field is not a substitute: it is filing-scoped, so every comparative column in a
// 10-K inherits the filing's year, and it is outright wrong for Salesforce.
const fyOfEnd = (end) => {
  const d = new Date(end);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() === 0 && d.getUTCDate() <= 14 ? y - 1 : y;
};

function annualByYear(facts, tags, unit = "USD", pickMax = false, conflictTakesLarger = false) {
  const out = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    const perTag = {};
    for (const u of units) {
      if (!u.form || !u.form.startsWith("10-K") || !u.start || !u.end) continue;
      const dur = days(u.start, u.end);
      if (dur < 350 || dur > 380) continue;
      const fy = fyOfEnd(u.end);
      if (!perTag[fy] || (u.filed || "") > (perTag[fy].filed || ""))
        perTag[fy] = { val: u.val, end: u.end, filed: u.filed || "", accn: u.accn, form: u.form };
    }
    for (const fy in perTag) {
      if (!(fy in out)) { out[fy] = perTag[fy]; continue; }
      if (pickMax && perTag[fy].val > out[fy].val) { out[fy] = perTag[fy]; continue; }
      // A near-synonym further down the chain can carry an order-of-magnitude larger figure for
      // the same year, which means the two elements are not the same scope: the smaller is a
      // component wearing the total's name. Caterpillar tags $49M under cost of goods and services
      // sold beside $44,752M under cost of revenue, and taking the first-listed tag printed a
      // 99.9% gross margin for a manufacturer. Where the gap is that wide the larger is the total;
      // where it is narrow (one element including depreciation and the other not) chain order
      // still decides, because that is a presentation choice and not a scope error.
      if (conflictTakesLarger && perTag[fy].val > out[fy].val * 10) {
        console.warn(`  ! ${tags[0]} ${fy}: a later chain tag reports ${(perTag[fy].val / out[fy].val).toFixed(0)}x more — taking the larger as the total`);
        out[fy] = perTag[fy];
      }
    }
  }
  return out;
}

// Balance-sheet instants, pinned to the fiscal calendar (the banks desk's F2, 2026-07-21): a
// 10-K's XBRL carries interim balances too (quarterly comparatives, transition-date openings),
// and binning instants by end-date YEAR alone lets a dead tag's mid-year balance survive as the
// fiscal year's value (BAC's loan tag died mid-2020 and its 2020-06-30 balance would read as
// FY2020; the LDTI opening-balance trap the insurance verify caught is the same failure). Where
// the company's fiscal calendar is known (fyEnds: fy → the year's period-end date, from the
// revenue record), an instant must sit within 14 days of the year's actual end (52/53-week
// tolerance) or it is not that year's balance. Years outside the known calendar keep the old
// latest-end-then-latest-filed rule, so an instant-only tag never goes dark wholesale.
function instantByYear(facts, tags, unit = "USD", fyEnds = null) {
  const out = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    const perTag = {};
    for (const u of units) {
      if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
      const fy = fyOfEnd(u.end);
      const anchorEnd = fyEnds?.[fy];
      if (anchorEnd && Math.abs(days(anchorEnd, u.end)) > 14) continue;
      const cur = perTag[fy];
      if (!cur || u.end > cur.end || (u.end === cur.end && (u.filed || "") > (cur.filed || "")))
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
// Single-value scale fix against an already-trusted reference (the record's normalized scale):
// used for the latest-annual and TTM counts captured separately below. The RECORD normalization
// lives in src/lib/shareScale.mjs (majority-cluster, interior-only, both directions) — shared with
// the ADR fetcher so the two pools can never drift, and deliberately NOT max-anchored: a single
// mistagged-HIGH year must never become the reference the whole record is scaled toward.
function fixShareScale(v, ref) {
  if (v == null || v <= 0 || ref == null || ref <= 0) return v;
  while (v * 1000 <= ref) v *= 1000;
  return v;
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
const pickInstant = (facts, tags, unit = "USD", fyEnds = null) => latestEntry(instantByYear(facts, tags, unit, fyEnds));
const collectAnnual = (facts, tags, unit = "USD") => valuesByYear(annualByYear(facts, tags, unit));

// Cost of revenue resolves with the scope-conflict rule above, since this is the chain whose
// near-synonyms most often carry different scopes at the same filer.
const corByYear = (facts) => annualByYear(facts, CONCEPTS.costOfRevenue, "USD", false, true);

// ---- the filer's own income-statement identity ----
// A chain of tag names, however carefully ordered, cannot tell which element a filer means as its
// top line: PennyMac tags $20.1M of contract revenue beside the $2,046.5M its statement calls Total
// net revenues, General Motors tags automotive sales against a total that includes GM Financial, and
// American Express's contract element is $31B short of the revenue its own expenses are measured
// against. Size cannot arbitrate either — preferring the largest element regressed 163 held-out
// years and grossed up 23 assessed-tax filers by their excise.
//
// The filer itself already settled the question, in arithmetic, on the face of its statement. Where
// it publishes revenue, a cost total and the result of subtracting one from the other, only one
// revenue element makes that subtraction come out TO THE DOLLAR, and that element is the top line.
// So: compute what each identity the filer files IMPLIES the revenue must be, and take it only when
// a revenue element the filer actually tagged equals it exactly. Nothing is ever constructed — the
// number shipped is always an element the filer wrote down.
//
// Never the size of a tag and never its name.
const IDENTITY_REV_POOL = [
  "Revenues",
  "RevenuesNetOfInterestExpense",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "RegulatedAndUnregulatedOperatingRevenue",
  "RealEstateRevenueNet",
  "OperatingLeaseLeaseIncome",
  "OperatingLeasesIncomeStatementLeaseRevenue",
  "OilAndGasRevenue",
  "RevenueMineralSales",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet",
  "SalesRevenueServicesNet",
  "HealthCareOrganizationRevenue",
];
// InterestAndDividendIncomeOperating is deliberately absent and must never be added: 164 banks tag
// gross interest income ABOVE their presented top line (Cass files $97.6M of it against a $190.8M
// total revenue), so admitting it would hand a lender its gross yield as its sales.
const IDENTITY_PRETAX = "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest";
// Each rung is the pair whose SUM the top line must equal — the algebra of the subtraction the filer
// prints. "__cor" is the cost-of-revenue chain resolved above.
const IDENTITY_RUNGS = [
  ["__cor", "GrossProfit", "grossProfit"],
  ["CostsAndExpenses", "OperatingIncomeLoss", "costsAndExpenses/operatingIncome"],
  ["OperatingExpenses", "OperatingIncomeLoss", "operatingExpenses/operatingIncome"],
  ["CostsAndExpenses", IDENTITY_PRETAX, "costsAndExpenses/pretax"],
  ["OperatingExpenses", IDENTITY_PRETAX, "operatingExpenses/pretax"],
  ["BenefitsLossesAndExpenses", IDENTITY_PRETAX, "benefitsLossesAndExpenses/pretax"],
  // A lender's or card network's total revenue IS net interest income plus noninterest income —
  // the banks desk's own reconstruction, here required to land on a total the filer tagged.
  ["InterestIncomeExpenseNet", "NoninterestIncome", "netInterest+noninterest"],
];
// Names the owner has already ruled on, which this arbitration must leave exactly as they are.
// DBRG/HAS/VICR/RSG/SLDP/BF-B/CRON were confirmed legitimate by hand; ConocoPhillips and MPLX
// caption their total "Total Revenues and Other Income", and equity earnings are not sales, so
// their larger element is not a top line however cleanly the arithmetic closes on it. Companyfacts
// carries no captions, so this list is the only place that ruling can live.
const IDENTITY_FROZEN = new Set(["DBRG", "HAS", "VICR", "RSG", "SLDP", "BF-B", "CRON", "COP", "MPLX"]);

function applyIncomeStatementIdentity(facts, revAnnualBy, ticker, W) {
  if (IDENTITY_FROZEN.has(String(ticker).toUpperCase())) return;
  const cache = {};
  const S = (tag) => (cache[tag] ||= tag === "__cor" ? corByYear(facts) : annualByYear(facts, [tag], "USD"));
  const pool = {};
  for (const t of IDENTITY_REV_POOL) { const s = annualByYear(facts, [t], "USD"); if (Object.keys(s).length) pool[t] = s; }
  const excise = annualByYear(facts, ["ExciseAndSalesTaxes"], "USD");
  for (const fy of Object.keys(revAnnualBy)) {
    const incumbent = revAnnualBy[fy]?.val;
    if (incumbent == null) continue;
    const hits = [];
    for (const [a, b, label] of IDENTITY_RUNGS) {
      const av = S(a)[fy]?.val, bv = S(b)[fy]?.val;
      if (av == null || bv == null) continue;
      for (const t of Object.keys(pool)) if (pool[t][fy]?.val === av + bv) hits.push({ value: av + bv, tag: t, label });
    }
    if (!hits.length) continue;
    const distinct = [...new Set(hits.map((h) => h.value))];
    // Two identities in the same filing pointing at different revenues is the filing contradicting
    // itself (Mastercard 2013, United Therapeutics 2009-13). A reader is better served by the
    // figure already shown than by our choosing which of the filer's own totals to believe.
    if (distinct.length > 1) {
      W?.(`${ticker} revenue ${fy}: the filer's own identities disagree (${hits.map((h) => `${h.label}→${h.tag}`).join(", ")}) — left as filed`);
      continue;
    }
    const to = distinct[0], tag = hits[0].tag;
    if (to === incumbent) continue;
    // The same figure at two precisions is not two figures: CarMax tags "Revenues" in whole dollars
    // and its contract element rounded to the hundred thousand. Swapping one for the other churns
    // ten history rows and tells a reader nothing.
    if (Math.abs(to - incumbent) < 1e-5 * Math.abs(incumbent)) continue;
    // EXCISE VETO, upward only. A candidate that exceeds the incumbent by the filer's own filed
    // excise is the gross-of-excise line, not a truer total. One-directional on purpose: Molson
    // Coors' correct move is DOWNWARD past its excise line (it tags gross under the "Excluding"
    // element and net under the "Including" one), and a symmetric veto would block it.
    const ex = excise[fy]?.val;
    if (to > incumbent && ex > 0 && Math.abs(to - incumbent - ex) <= 0.02 * ex) {
      W?.(`${ticker} revenue ${fy}: ${tag} exceeds the incumbent by the filer's own excise (${ex}) — not a truer total, left as filed`);
      continue;
    }
    W?.(`${ticker} revenue ${fy}: ${incumbent} → ${to} — the filer's ${hits[0].label} identity closes on ${tag}`);
    revAnnualBy[fy] = { ...pool[tag][fy] };
  }
}

// A cost of revenue under a hundredth of the year's revenue is not a total, it is a fragment that
// happened to be tagged. Withholding it costs a gross-margin reading; publishing it asserts the
// business has no cost of sales, which for a utility buying fuel is simply false.
const thinCor = (cor, rev) => (cor != null && rev > 0 && cor / rev < 0.01 ? null : cor);

// Rebuild SG&A year by year from whichever legs the filer actually files. The combined element
// wins where it exists. Where it does not but BOTH legs do, their sum is the concept the row
// claims to show. Where only general-and-administrative exists, it stands alone, which is right
// for a business with no selling line and is also the pre-existing behaviour, so no filer loses a
// value it already had. A selling leg alone is never shown: half a bucket under a whole bucket's
// name is the same error in smaller print.
// Overhead that exceeds a mature company's entire revenue several times over is not overhead, it
// is a decimal point. National HealthCare put scale="6" on an administrative figure already
// written in full dollars and shipped $27.5 TRILLION against $1.5B of revenue — eighteen thousand
// times its own sales, on a nursing-home operator with no G&A line on the face of its statements
// to contradict the tag. The revenue floor is what keeps this from touching honest data: a
// clinical-stage business with almost no sales can and does spend many multiples of revenue on
// overhead, and that is a true fact about it, not an error.
const sgaSane = (series, revenue, label, W) => {
  if (!series) return series;
  const out = { ...series };
  for (const fy of Object.keys(out)) {
    const rev = revenue?.[fy], v = out[fy];
    if (v == null || !(rev > 1e8)) continue;
    if (Math.abs(v) > rev * 10) {
      out[fy] = null;
      W?.(`${label} ${fy}: ${(Math.abs(v) / rev).toFixed(0)}x the year's revenue — not an overhead figure, withheld`);
    }
  }
  return out;
};

const sgaSeries = (combined, sm, ga) => {
  const out = { ...combined };
  for (const fy of new Set([...Object.keys(sm), ...Object.keys(ga)])) {
    if (out[fy] != null) continue;
    if (sm[fy] != null && ga[fy] != null) out[fy] = sm[fy] + ga[fy];
    else if (ga[fy] != null) out[fy] = ga[fy];
  }
  return out;
};
const collectInstant = (facts, tags, unit = "USD", fyEnds = null) => valuesByYear(instantByYear(facts, tags, unit, fyEnds));

// ---- the share count for turning a price into a value (NOT the per-share denominator) ----
// The weighted-average diluted count answers "earnings per share over the period"; converting a
// typed price into a company value needs the INSTANTANEOUS count actually outstanding, and the
// freshest filed source of that is the cover of every 10-K/10-Q: dei:EntityCommonStockShares-
// Outstanding, "as of the latest practicable date". Convertible issuers make the difference
// material — GameStop's Q1-2026 weighted diluted count (592M, if-converted) overstates the real
// 449M outstanding by a third, and 650+ names in this pool diverge by more than 3%.
// Guarded chain, most-checkable first:
//   1. the dei cover count — accepted only when it is not stale (dual-class filers sometimes
//      stop tagging it; HEICO's last dei observation is 2015), i.e. within ~400 days of the
//      freshest weighted-average observation;
//   2. the us-gaap CommonStockSharesOutstanding instant across 10-K AND 10-Q — accepted only
//      within ±25% of the weighted-average count, which rejects the per-class fragments some
//      dual-class filers tag (HEICO reports 55M of one class against 139M total);
//   3. the weighted-average count itself (basic where tagged, else the diluted series) — a
//      period average, not an instant, so the basis is carried for the page to disclose.
// Returns { val, asOf, form, basis } or null; sharesDiluted stays untouched everywhere else
// (record tables, per-share history, dilution trend), where it is the right denominator.
function sharesForValueOf(facts, shareRef, periodEnd = null) {
  const avg = latestObservation(facts, ["WeightedAverageNumberOfSharesOutstandingBasic", ...CONCEPTS.sharesDiluted], "shares", false);
  const pick = (o, basis) => ({ val: fixShareScale(o.val, shareRef), asOf: o.end, form: o.form || null, basis });
  // Absolute recency guard: a share count must belong to roughly the record's period. A
  // dual-class dimensional filer (Visa, Berkshire...) can carry an un-dimensioned dei cover
  // observation stranded a decade back — Visa shipped a 2010 count (469M vs ~1.9B) that the old
  // relative-to-avg guard let through. ~460 days spans a filer whose latest cover trails the
  // fiscal year-end by up to a full year (2026-07-17 correctness sweep #3).
  // Signed: a share count is too stale only when it is OLDER than the financials it prices (a
  // decade-back base against this year's earnings — the Visa error). A cover FRESHER than a lagging
  // XBRL financial set (Greif's pattern: a 2026 cover against 2024 companyfacts) is the current count
  // and must be kept, not withheld. days() is absolute, so measure the signed gap directly.
  const fresh = (end) => !periodEnd || !end || (new Date(periodEnd) - new Date(end)) / 86400000 <= 460;
  let dei = null;
  const units = facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (units) {
    for (const u of units) {
      if (!u.form || !u.end || u.start) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      if (!fresh(u.end)) continue;
      if (!dei || new Date(u.end) > new Date(dei.end) || (u.end === dei.end && (u.filed || "") > dei.filed))
        dei = { val: u.val, end: u.end, filed: u.filed || "", form: u.form };
    }
  }
  if (dei && dei.val > 0 && (!avg?.end || Math.abs(days(dei.end, avg.end)) <= 400)) return pick(dei, "cover");
  const inst = latestObservation(facts, CONCEPTS.sharesOutstanding, "shares", true);
  if (inst && inst.val > 0 && fresh(inst.end) && avg?.val > 0 && inst.val >= avg.val * 0.75 && inst.val <= avg.val * 1.25)
    return pick(inst, "instant");
  // The weighted-average fallback is subject to the SAME recency guard. A dual-class filer that
  // stopped tagging the un-dimensioned weighted-average years ago (Formula One's last is 2016,
  // KKR's units end 2018, Haverty's 2012) leaves `avg` frozen a decade back — pricing today's cap
  // on a decade-old share base is the Visa error wearing a different basis. When avg is itself
  // stale, return null so the cover-text fallback reads the filing covers for the real current
  // count, or the page stays honestly blank (2026-07-17 correctness sweep #3).
  if (avg && avg.val > 0 && fresh(avg.end)) {
    const hasBasic = !!facts?.facts?.["us-gaap"]?.WeightedAverageNumberOfSharesOutstandingBasic;
    return pick(avg, hasBasic ? "basic average" : "diluted average");
  }
  return null;
}

// ---- the cover-text fallback (step 4 of the share chain; the STZ/dual-class hole) ----
// Thirteen real companies — Constellation Brands, Brookfield, Planet Fitness, Greif among them —
// carry NO share fact anywhere in companyfacts: every count is tagged under class-member
// dimensions, and the companyfacts API strips dimensioned facts. The one place the count is
// required in plain text is the filing cover ("Indicate the number of shares outstanding of each
// of the issuer's classes of common stock, as of the latest practicable date"). Rule, per the
// campaign's L1 discipline (read the filing when XBRL fails, corroborate before trusting):
//   - fires ONLY when the whole XBRL chain above yielded nothing (never overrides a tagged count);
//   - parses the covers of BOTH the latest 10-K and the latest 10-Q;
//   - accepts only when the two documents corroborate within 20% (real counts drift slowly;
//     a parse gone wrong does not corroborate) — one parse alone is not enough to print;
//   - sums the classes of COMMON stock; preferred never counts; a wrong number is worse than a
//     missing one, so any ambiguity returns null and the page stays honestly blank.
async function getText(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await sleep(1000 * attempt); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(500 * attempt);
    }
  }
}

// Parse a filing's cover for the outstanding-common CLASS counts. Pure function; unit-tested against
// the verbatim covers in scripts/coverSharesTest.mjs. Returns the distinct per-class counts (a
// single-class cover states one number; a dual-class cover one per class), or an empty array — never
// a guess. opts.excludeNear: a regex that disqualifies a count whose nearby context matches — the
// ADR 20-F path uses it to reject ADS-denominated numbers stated beside the ordinary-share count
// (folding an ADS count into the sum would double-count the program, 2026-07-18).
export function parseCoverClassCounts(html, opts = {}) {
  // The cover is the first VISIBLE text, but inline-XBRL documents carry an enormous hidden
  // <ix:header> metadata block (contexts, units — tens of thousands of characters) before any
  // rendered content, so it is stripped first; the window is then generous for the true cover.
  const visible = html.replace(/<ix:header[^]*?<\/ix:header>/gi, " ").replace(/<(script|style)[^]*?<\/\1>/gi, " ");
  const text = visible.replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ").slice(0, 120000);
  const anchor = text.search(/number of shares outstanding (?:of|with respect to) each|shares outstanding of each of the (?:issuer|registrant)|number of shares of (?:the registrant'?s? )?(?:[\w$.\s]{0,40})?common (?:stock|shares)[^.]{0,80}outstanding|number of outstanding shares of|(?:registrant had|there were) (?:issued and outstanding )?[\d,]+ (?:[\w$.,]+ ){0,6}?(?:shares|ordinary)|as of [a-z]+ \d{1,2}, \d{4},? [\d,]+ (?:class [a-z] )?(?:common|ordinary) shares|shares of common stock outstanding|ordinary shares[^.]{0,60}(?:issued and )?outstanding/i);
  if (anchor < 0) return [];
  const region = text.slice(anchor, anchor + 1200);
  // Collect count candidates: large comma-grouped integers (or 7+ digit plain integers) that are
  // not dollars, not percentages, and not dates. Class names nearby are how covers present them.
  const counts = [];
  const numRe = /(?:^|[\s(])(\d{1,3}(?:,\d{3}){1,4}|\d{7,12})(?:\.\d+)?(?=[\s,.)]|$)/g;
  let m;
  while ((m = numRe.exec(region))) {
    const before = region.slice(Math.max(0, m.index - 24), m.index);
    const after = region.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (/[$€£]\s*$/.test(before) || /^\s*(%|percent|dollars)/i.test(after)) continue;
    // A four-digit year alone is never a count; the digit floor (≥5 digits grouped or ≥7 plain)
    // already excludes it, but a "2,026"-style artifact is caught by the plausibility band below.
    // Exclude preferred: a count belongs to a preferred class only when ITS OWN adjacent class label
    // says so. The label sits next to the number — covers overwhelmingly write "N shares of [Class]
    // stock" (descriptor FORWARD of the count), with a table/label-first minority ("[Class] Stock, N
    // shares"). So read the forward window first and fall back to the backward window only when the
    // forward one carries no descriptor. The old wide 160-char BACKWARD context bled the PREVIOUS
    // common class's name onto Ares's "Series B mandatory convertible preferred" line and summed its
    // 30,000,000 preferred shares into the common count (360M vs the true 330M, 2026-07-17 sweep #3).
    const fwd = region.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const back = region.slice(Math.max(0, m.index - 90), m.index);
    const label = /common|ordinary|preferred/i.test(fwd) ? fwd : back;
    if (/preferred/i.test(label) && !/common/i.test(label)) continue;
    // A treasury or plan-reserved count is NOT outstanding: ReNew's cover states "244,405,376 Class A
    // outstanding" and, in the next breath, "38,698,288 held as treasury" — summing both overstated
    // the count 10.7% (caught by the 2026-07-18 adversarial verify). Same for Bilibili's "reserved
    // for share-incentive plans" tranche. Judged on the count's OWN label (forward-first, exactly as
    // the preferred test above) — a backward window would bleed the PREVIOUS clause's "treasury" onto
    // the next legitimate class and kill it.
    if (/treasur|reserved for|incentive plan/i.test(label)) continue;
    if (opts.excludeNear && (opts.excludeNear.test(back) || opts.excludeNear.test(fwd))) continue;
    counts.push({ val: Number(m[1].replace(/,/g, "")), idx: m.index });
  }
  let plausible = counts.filter((c) => c.val >= 1e5 && c.val <= 5e10);
  if (!plausible.length) return [];
  // As-of-date scoping: a cover that restates the PRIOR year's counts beside the current ones
  // ("...as of December 31, 2025 ... As of December 31, 2024, there were...") must not have both
  // years summed — Bilibili's did, doubling the count (2026-07-18 verify). Group each candidate by
  // the nearest preceding "as of <date>" and keep only the latest-dated group; candidates before
  // any date stay with the latest group (the anchor sentence's own counts).
  // The anchor often lands just AFTER the sentence's own "as of <date>" ("As of December 31, 2025,
  // there were..." anchors at "there were"), so the scan reaches a short window back before the
  // anchor; that date's index goes negative and precedes every candidate, exactly as it reads.
  const pre = text.slice(Math.max(0, anchor - 80), anchor);
  const dates = [];
  const dateRe = /as of [a-z]+ \d{1,2},? (\d{4})/gi;
  let dm;
  while ((dm = dateRe.exec(pre + region))) dates.push({ idx: dm.index - pre.length, t: Date.parse(dm[0].replace(/^as of /i, "")) || Number(dm[1]) });
  if (dates.length > 1) {
    const groupOf = (c) => { let g = null; for (const d of dates) if (d.idx < c.idx) g = d.t; return g; };
    const groups = plausible.map((c) => ({ ...c, g: groupOf(c) }));
    const dated = groups.filter((c) => c.g != null);
    if (dated.length) {
      const latest = Math.max(...dated.map((c) => c.g));
      plausible = groups.filter((c) => c.g == null || c.g === latest);
    }
  }
  // Distinct values only (a repeated value is the same figure restated, not a second class).
  const distinct = [...new Set(plausible.map((c) => c.val))];
  // Stated-total detection: iQIYI's cover writes "6,754,381,564 ordinary shares outstanding, being
  // the sum of 3,713,284,286 Class A ... and 3,041,097,278 Class B" — summing all three doubled the
  // count (2026-07-18 verify). When one value equals the sum of two or more of the others (to the
  // share), it IS the total: return it alone.
  if (distinct.length >= 3) {
    for (const total of distinct) {
      const rest = distinct.filter((v) => v !== total);
      const sum = rest.reduce((a, b) => a + b, 0);
      if (rest.length >= 2 && Math.abs(sum - total) <= 2) return [total];
    }
  }
  return distinct;
}

// The single-number face of the cover parser: the class counts summed to the total common count,
// or null. This is what the whole recovery chain consumes; the class-level form above exists for
// the dual-class filers whose classes must NOT be naively summed (Berkshire's A and B differ 1,500×
// in economic weight — see DUAL_CLASS_EQUIV below).
export function parseCoverShares(html, opts = {}) {
  const distinct = parseCoverClassCounts(html, opts);
  if (!distinct.length) return null;
  return distinct.reduce((a, b) => a + b, 0);
}

// ---- dual-class equivalence (the Berkshire hole; 2026-07-18) ----
// For almost every multi-class filer the classes carry EQUAL economic weight per share, so the cover
// classes sum to the true count. Berkshire is the exception that breaks the sum: 1 Class A carries
// the economics of 1,500 Class B, so "A + B" (≈1.4bn) is the right count for NEITHER listing. Each
// ticker instead needs the count expressed in ITS OWN class's units:
//   BRK-A → A-equivalents = A + B/1500   (≈1.44M; Berkshire itself states this in its common-stock note)
//   BRK-B → B-equivalents = A×1500 + B   (≈2.16bn — what a typed B price must multiply)
// Both records had priced on a 2015 weighted-average A-equivalent (1,643,118): a decade stale for
// BRK-A and the wrong CLASS BASIS for BRK-B (a B price × an A count values Berkshire at ~1/1300th).
// The counts come from the filing covers (both classes are stated there), corroborated across the
// latest 10-K and 10-Q per class; the conversion ratio is curated, from the filing's own note —
// never inferred.
const DUAL_CLASS_EQUIV = {
  "BRK-A": { conv: 1500, express: "A" },
  "BRK-B": { conv: 1500, express: "B" },
};
async function dualClassCoverShares(cik, spec) {
  try {
    const padded = String(cik).padStart(10, "0");
    const sub = await getJSON(`https://data.sec.gov/submissions/CIK${padded}.json`);
    const r = sub?.filings?.recent;
    if (!r) return null;
    const pick = (form) => {
      for (let i = 0; i < r.form.length; i++) {
        if (r.form[i] === form) return { acc: r.accessionNumber[i].replace(/-/g, ""), doc: r.primaryDocument[i], filed: r.filingDate[i], form };
      }
      return null;
    };
    const tenK = pick("10-K"), tenQ = pick("10-Q");
    if (!tenK || !tenQ) return null; // corroboration needs both
    const reads = [];
    for (const f of [tenK, tenQ]) {
      await sleep(THROTTLE_MS);
      const html = await getText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.acc}/${f.doc}`);
      const counts = parseCoverClassCounts(html);
      if (counts.length !== 2) continue; // exactly two common classes, or this cover doesn't decide
      const small = Math.min(...counts), large = Math.max(...counts);
      if (large < small * 100) continue; // a 1,500:1 economic split shows as a lopsided count; near-equal counts mean a different (or misparsed) structure
      reads.push({ small, large, form: f.form, filed: f.filed });
    }
    if (reads.length < 2) return null;
    const [a, b] = reads;
    const drift = (x, y) => (x > y ? x / y : y / x);
    if (drift(a.small, b.small) > 1.2 || drift(a.large, b.large) > 1.2) return null; // the two covers disagree; refuse
    const fresher = new Date(a.filed) >= new Date(b.filed) ? a : b;
    const val = spec.express === "A"
      ? Math.round(fresher.small + fresher.large / spec.conv)
      : Math.round(fresher.small * spec.conv + fresher.large);
    return { val, asOf: fresher.filed, form: fresher.form, basis: `cover-text ${spec.express}-equivalent` };
  } catch {
    return null; // a fetch failure is a missing count, never an error that breaks the run
  }
}

async function coverShareCount(cik) {
  try {
    const padded = String(cik).padStart(10, "0");
    const sub = await getJSON(`https://data.sec.gov/submissions/CIK${padded}.json`);
    const r = sub?.filings?.recent;
    if (!r) return null;
    const pick = (form) => {
      for (let i = 0; i < r.form.length; i++) {
        if (r.form[i] === form) return { acc: r.accessionNumber[i].replace(/-/g, ""), doc: r.primaryDocument[i], filed: r.filingDate[i], form };
      }
      return null;
    };
    const tenK = pick("10-K"), tenQ = pick("10-Q");
    if (!tenK || !tenQ) return null; // corroboration needs both
    const reads = [];
    for (const f of [tenK, tenQ]) {
      await sleep(THROTTLE_MS);
      const html = await getText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.acc}/${f.doc}`);
      const val = parseCoverShares(html);
      if (val != null) reads.push({ val, form: f.form, filed: f.filed });
    }
    if (reads.length < 2) return null;
    const [a, b] = reads;
    const ratio = a.val > b.val ? a.val / b.val : b.val / a.val;
    if (ratio > 1.2) return null; // the two covers disagree; refuse
    const fresher = new Date(a.filed) >= new Date(b.filed) ? a : b;
    return { val: fresher.val, asOf: fresher.filed, form: fresher.form, basis: "cover-text" };
  } catch {
    return null; // a fetch failure is a missing count, never an error that breaks the run
  }
}

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
// pickMax mirrors the annual merge for the cohorts whose largest total is the real top line
// (REIT/insurer/lessor/broker): on a same-end, same-duration tie across tags, the larger value
// wins — otherwise a stray partial "Revenues" sharing the FY end date (BlackRock's pattern)
// could win the TTM on array order while the annual record, pick-max-correct, disagrees.
// guardStable: for a LUMPY cash line (dividends, buybacks) whose payment date can straddle a
// fiscal-quarter cutoff differently across the two comparison years, the priorFY+cur−priorYTD
// stitch can double-count a quarter (priorYTD lands anomalously small — e.g. KO's ~April-1
// dividend fell after the FY25 Q1 cutoff but before the FY26 Q1 cutoff, inflating TTM by ~25%).
// When set, a stitch running materially above the filed annual (a real dividend rises gradually;
// a spurious extra quarter is +25-33%) falls back to the filed annual — a slightly stale FILED
// figure beats an overstated stitch (a wrong number is worse than a missing one). MUST NOT be
// set for revenue/earnings, where a >20% year-over-year change is legitimate growth.
function ttmFlow(facts, tags, unit = "USD", pickMax = false, guardStable = false) {
  const all = durations(facts, tags, unit);
  if (!all.length) return null;
  const byVal = (a, b) => (pickMax ? b.val - a.val : 0);
  const maxEnd = all.reduce((m, e) => (new Date(e.end) > new Date(m) ? e.end : m), all[0].end);
  const cur = all.filter((e) => e.end === maxEnd).sort((a, b) => b.dur - a.dur || byVal(a, b) || b.filed.localeCompare(a.filed))[0];
  if (!cur) return null;
  if (cur.dur >= 350 && cur.dur <= 380) return { val: cur.val, asOf: cur.end, isFY: true };
  const prevEnd = new Date(cur.end);
  prevEnd.setUTCFullYear(prevEnd.getUTCFullYear() - 1);
  const prevEndStr = prevEnd.toISOString().slice(0, 10);
  const priorYTD = all
    .filter((e) => Math.abs(days(e.end, prevEndStr)) <= 20 && Math.abs(e.dur - cur.dur) <= 25)
    .sort((a, b) => byVal(a, b) || b.filed.localeCompare(a.filed))[0];
  const priorFY = all
    .filter((e) => e.dur >= 350 && e.dur <= 380 && Math.abs(days(e.end, cur.start)) <= 45)
    .sort((a, b) => byVal(a, b) || b.filed.localeCompare(a.filed))[0];
  if (priorYTD && priorFY) {
    const stitched = priorFY.val + cur.val - priorYTD.val;
    if (guardStable && priorFY.val != null && Math.abs(stitched) > Math.abs(priorFY.val) * 1.2 + 1) {
      return { val: priorFY.val, asOf: priorFY.end, isFY: true };
    }
    return { val: stitched, asOf: cur.end, isFY: false };
  }
  const fy = all.filter((e) => e.dur >= 350 && e.dur <= 380).sort((a, b) => new Date(b.end) - new Date(a.end) || byVal(a, b))[0];
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
      // STRICTLY later filed wins (a real restatement); on a tie the FIRST ladder rung stands.
      // This was `>=` until 2026-07-29, which let a later rung overwrite the primary concept
      // whenever both were tagged in the same filing — see quarterFlowMap below for the damage.
      if (!(u.end in out) || f > (filed[u.end] || "")) { out[u.end] = u.val; filed[u.end] = f; }
    }
  }
  return out;
}
// An income line as a true three-month quarterly flow: 10-Qs report both a 3-month and a cumulative
// year-to-date duration, so we keep only the ~90-day observations. (Cash flow is YTD-only and so is
// not read this way — burn comes from the TTM figure instead.) Map of end-date -> quarterly value.
//
// Rebuilt 2026-07-29 in annualByYear's shape, because its old flat walk let ANY later-or-equal
// filed date overwrite the incumbent — so the LAST ladder rung won whenever one filing tagged two
// concepts for the same quarter, and a later filing's comparative under a minor rung beat the
// primary concept's original fact. The damage was measured before the rebuild: 12,214 quarterly
// cells across 500 of 597 cached filers, 4,513 of them by more than ten percent. AvalonBay's
// quarterly "revenue" was its ~$1.8M management-fee sliver beside $325M of net income; Hertz's was
// a $36M footnote line against a $1,873M statement total; Dominion's was a contract figure LARGER
// than its own total revenue; Encompass and Simon printed net income a fifth high (the ProfitLoss
// rung, noncontrolling interests included, beating the attributable line EPS is computed from);
// Abbott's read a hundred-million-rounded highlights tag. Every repair in a three-agent hostile
// verification matched the filer's own rendered statement to the dollar.
//
// The shape now matches the annual doctrine exactly: within a tag the latest filing wins the
// quarter (restatements land), across tags the CHAIN ORDER decides — a lower rung fills only the
// quarters the rungs above it lack. pickMax mirrors annualByYear's REIT/insurer/lessor/broker
// exception: whichever tag carries the LARGER value for the quarter is the real top line (Simon
// books the complete total under "Revenues" while a pure-rent trust's whole top line is the lease
// concept; first-rung-wins would serve the component).
function quarterFlowMap(facts, tags, unit = "USD", pickMax = false) {
  const out = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    const perTag = {};
    for (const u of units) {
      if (!u.form || !u.start || !u.end) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      const dur = days(u.start, u.end);
      if (dur < 80 || dur > 100) continue; // a single quarter, not a YTD or annual span
      const f = u.filed || "";
      if (!perTag[u.end] || f > perTag[u.end].filed) perTag[u.end] = { val: u.val, filed: f };
    }
    for (const end in perTag) {
      if (!(end in out)) { out[end] = perTag[end].val; continue; }
      if (pickMax && perTag[end].val > out[end]) out[end] = perTag[end].val;
    }
  }
  return out;
}
// The last n quarters: liquidity (current assets/liabilities, cash) as instants, and revenue/earnings
// as three-month flows, merged on the period end. Drives the trend and the recent-quarter momentum;
// every figure raw, so the ratios are derived in page code and never need re-fetching.
function quarterSeries(facts, revTags, n = 8, pickMaxRev = false) {
  const ca = instantMap(facts, CONCEPTS.currentAssets);
  const cl = instantMap(facts, CONCEPTS.currentLiabilities);
  const cash = instantMap(facts, CONCEPTS.cashAndEquivalents);
  // pickMaxRev = the same cohorts whose ANNUAL revenue reads pick-max (REIT/insurer/lessor/
  // broker): whichever tag carries the larger quarter is the real top line.
  const rev = quarterFlowMap(facts, revTags, "USD", pickMaxRev);
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
  // The main file is incomplete; the exchange file fills a few of its gaps, and the live lookup
  // below catches the rest. buildCikMap merges the two static files (main wins on overlap).
  let exchMap = null;
  try { exchMap = await getJSON("https://www.sec.gov/files/company_tickers_exchange.json"); } catch { /* the main file alone still works */ }
  const cikByTicker = buildCikMap(map, exchMap);
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
  // The last good file, read once: it is both the carry-over source further down and the only
  // place a company's SIC is known before it is fetched, which is what makes cohort selection
  // possible without a network round trip.
  let priorByTicker = {};
  try {
    const priorCos = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8")).companies || [];
    priorByTicker = Object.fromEntries(priorCos.map((c) => [String(c.ticker).toUpperCase(), c]));
  } catch {}

  // ---- cohort selection -------------------------------------------------------------------
  // The desks work one shelf at a time, so the fetch should too: a chain repair aimed at the
  // software shelf ought to be provable against software in minutes rather than against the whole
  // pool in an hour. Membership resolves from the PRIOR file's SIC through the same taxonomy the
  // shelves themselves use, so no company has to be fetched to learn whether it belongs.
  //
  //   ONLY_FUND=MSFT,ORCL                 explicit tickers
  //   FUND_INDUSTRY="Software"            one shelf, by its label
  //   FUND_SECTOR="Information Technology"  every shelf in a sector
  //   FUND_STALEST=400                    the 400 records refreshed longest ago
  //
  // That last one is the safety valve, and it is the whole reason sharding does not industrialize
  // the very bug it exists to avoid. Partial runs are what let Oracle carry a 2011 cost of revenue
  // into a 2026 record: every partial run preserves thousands of untouched records, and nothing on
  // the record said how old its extraction was. Sweeping by age means no company sits un-refreshed
  // merely because nobody thought to name it, and the fetchedAt stamp below makes the age a fact
  // rather than an assumption.
  const onlyFund = (process.env.ONLY_FUND || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const wantIndustry = (process.env.FUND_INDUSTRY || "").trim().toLowerCase();
  const wantSector = (process.env.FUND_SECTOR || "").trim().toLowerCase();
  const wantStalest = Number(process.env.FUND_STALEST || 0) || 0;
  let cohort = null; // null = the whole universe
  if (wantIndustry || wantSector || wantStalest) {
    let rows = Object.values(priorByTicker);
    if (wantIndustry || wantSector) {
      rows = rows.filter((c) => {
        const label = industryLabelOf(c);
        if (wantIndustry && String(label || "").toLowerCase() === wantIndustry) return true;
        if (wantSector && String(sectorOfIndustry(label) || "").toLowerCase() === wantSector) return true;
        return false;
      });
    }
    if (wantStalest) {
      // Oldest extraction first; a record that has never carried a stamp is the oldest of all.
      rows = rows.sort((a, b) => String(a.fetchedAt || "").localeCompare(String(b.fetchedAt || ""))).slice(0, wantStalest);
    }
    cohort = new Set(rows.map((c) => String(c.ticker).toUpperCase()));
    const what = [wantIndustry && `industry "${process.env.FUND_INDUSTRY}"`, wantSector && `sector "${process.env.FUND_SECTOR}"`, wantStalest && `${wantStalest} stalest`].filter(Boolean).join(" + ");
    console.log(`Cohort: ${what} → ${cohort.size} companies (of ${Object.keys(priorByTicker).length} on file).`);
    if (!cohort.size) {
      console.warn("  ! that cohort resolved to nobody — check the label against src/data/shelves.json; refusing to run a no-op that would rewrite the file.");
      return;
    }
  }
  for (const { ticker, name } of universe.tickers) {
    if (onlyFund.length && !onlyFund.includes(ticker.toUpperCase())) continue;
    if (cohort && !cohort.has(ticker.toUpperCase())) continue;
    // CIK_OVERRIDE wins over the SEC map: it exists precisely to correct tickers the map points at
    // the wrong entity (XOM → an empty reorg shell), so it must take precedence, not fill a gap.
    let cik = CIK_OVERRIDE[ticker.toUpperCase()] || cikByTicker[ticker.toUpperCase()];
    // Names SEC's static files omit (active large-caps like Marsh McLennan, Coterra, Hologic) get one
    // live EDGAR lookup before we give up — otherwise they silently drop out of the catalog.
    if (!cik) { await sleep(THROTTLE_MS); cik = await resolveCikLive(ticker); }
    if (!cik) {
      console.warn(`  ! ${ticker}: no CIK (SEC map + EDGAR lookup), skipping`);
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
    let sic = null, sicDescription = null, primaryTicker = null, sub = null;
    try {
      await sleep(THROTTLE_MS);
      sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
      sic = sub?.sic || null;
      sicDescription = sub?.sicDescription || null;
      // The issuer's own registered-securities order, the filed fact the listings tie-break asked
      // for: EDGAR lists the registrant's tickers with the common stock first (DTE before its four
      // baby bonds, SO before its notes, DUK before DUKB — verified across the multi-listing
      // utility CIKs). Without it, equal-length tickers tie-broke alphabetically and DTE's shelf
      // row was its 2080 baby bond DTB. Stored on every row of the CIK so listings.mjs can prefer
      // the fact and keep the shape heuristic only as the fallback for un-refreshed records.
      primaryTicker = Array.isArray(sub?.tickers) && sub.tickers.length ? String(sub.tickers[0]).toUpperCase() : null;
    } catch {
      /* leave null */
    }

    // THE FRESH-FILING MERGE (2026-07-29, scripts/filingFacts.mjs): when the latest 10-K/10-Q on
    // the filer's own submissions record postdates everything companyfacts carries — Rambus's
    // June-quarter 10-Q sat accepted for over a day while the API still served March — the
    // filing's extracted XBRL instance fills the gap, gated on its own comparatives agreeing
    // with the ingested record to the dollar (ten overlapping facts minimum, any disagreement
    // refuses the whole document). Append-only, so the merge retires itself as the API catches
    // up; a failure warns and the extraction continues on companyfacts alone.
    if (sub) {
      await sleep(THROTTLE_MS);
      const fresh = await freshFilingMerge(facts, sub, cik, { headers: HEADERS, warn: (m) => console.warn(`  ! ${ticker}: ${m}`) });
      if (fresh) console.log(`  ${ticker}: ${fresh.form} for ${fresh.reportDate} merged from the filing itself (${fresh.merged} facts, ${fresh.overlaps} comparatives agreed) — companyfacts had not ingested it yet`);
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
    // A lessor takes the largest revenue tag (its combined total, never the contract sliver), the same
    // safe pick-max as REIT rent.
    const isLessorCo = sicN === 7359;
    // Broker-dealers/asset managers (6211) take the largest across the totals: the net-of-interest
    // total beats a broker's fee sliver, the contract total beats an asset manager's stray partial
    // "Revenues" (see BROKER_REVENUE).
    const isBrokerCo = sicN === 6211;
    const revTags = revenueTagsFor(sic, facts);
    const revAnnualBy = annualByYear(facts, revTags, "USD", isReitCo || isInsurerCo || isLessorCo || isBrokerCo);
    // Most banks book no combined total-revenue tag at all — their top line is two components, net
    // interest income plus noninterest income. For any year the total tags miss, reconstruct the total
    // from those components (both required, so a half-tagged year never understates). This is what lets
    // the majority of banks — which report only components — anchor to the current year and read their
    // real total revenue instead of stranding at an old filing or showing a fee sliver.
    if (isBankCo) {
      const niiBy = annualByYear(facts, CONCEPTS.netInterestIncome, "USD");
      const noniBy = annualByYear(facts, CONCEPTS.noninterestIncome, "USD");
      for (const fy of new Set([...Object.keys(niiBy), ...Object.keys(noniBy)])) {
        const nii = niiBy[fy], noni = noniBy[fy];
        if (!(nii && noni && nii.val != null && noni.val != null)) continue;
        // Fill a year with no total tag; also override a total that reads below net interest income
        // alone — which a real total (NII + noninterest) can never be — since some banks tag "Revenues"
        // with only a sub-total or fee sliver (Zions reads ~$0.66B against a true ~$3.4B). The
        // replacement equals the reported total wherever that total is already right, so a correctly
        // tagged bank (JPMorgan, Wells Fargo) is never disturbed.
        const existing = revAnnualBy[fy];
        if (!existing || existing.val < nii.val)
          revAnnualBy[fy] = { val: nii.val + noni.val, end: nii.end || noni.end, filed: (nii.filed || "") > (noni.filed || "") ? nii.filed : noni.filed, form: nii.form || noni.form };
      }
    } else if (!isReitCo && !isInsurerCo && !isLessorCo) {
      // A non-financial whose chosen revenue falls below its own cost of goods has tagged only its
      // ASC 606 contract revenue — a partial that excludes, for a trader, the bulk of the top line
      // (Archer-Daniels reads $25B of contract revenue against an $85B total; Bunge $17B against $53B).
      // A real top line is never below its own cost, so where the gross "Revenues" tag is both larger
      // and clears the cost, prefer it. Excise filers (tobacco) are untouched — their net contract
      // revenue already clears cost, so the trigger never fires and their gross "Revenues" never wins.
      const totalRevBy = annualByYear(facts, ["Revenues"], "USD");
      const cogsBy = corByYear(facts);
      for (const fy of Object.keys(revAnnualBy)) {
        const rev = revAnnualBy[fy]?.val, cogs = cogsBy[fy]?.val, tot = totalRevBy[fy]?.val;
        if (rev != null && cogs != null && tot != null && rev < cogs && tot > rev && tot >= cogs)
          revAnnualBy[fy] = totalRevBy[fy];
      }
    }
    // Last word on the top line: the filer's own income-statement arithmetic (see
    // applyIncomeStatementIdentity). Runs after the chains and the below-cost repair, so it
    // arbitrates whatever they produced, and never for a depository — the banks desk reconstructs
    // those from net interest income and noninterest income and is already correct.
    if (!isBankCo) applyIncomeStatementIdentity(facts, revAnnualBy, ticker, (m) => console.warn(`  ! ${m}`));
    // THE CORROBORATED FILL (utilities desk, 2026-07-28). ONE Gas Holdings' revenue chain went dark
    // after FY2022 — since then its only top line is RegulatedOperatingRevenue, absent from every
    // chain — and the record kept serving the FY2022 fact as current ($2,578,005,000 printed on the
    // FY2025 page verbatim). The identity ladder cannot rescue it: OGS tags no undimensioned
    // CostsAndExpenses or OperatingExpenses, so no rung closes.
    //
    // The gate here is the filer's own testimony instead: an alternative element may fill years the
    // chain lacks ONLY where every year both elements carry a value they agree TO THE DOLLAR (within
    // the same rounding window the ladder uses). OGS's one overlap year, FY2022, has
    // RegulatedOperatingRevenue equal to Revenues exactly — the filer itself states the two are one
    // figure. The six of eight current taggers for whom this element is a PARTIAL top line disagree
    // in their overlap years and are refused by the same test, which is what makes the fill safe:
    // the tag list is named, never a sweep, and a filer with no overlap year proves nothing and
    // fills nothing.
    if (!isBankCo) {
      for (const altTag of ["RegulatedOperatingRevenue"]) {
        const alt = annualByYear(facts, [altTag], "USD");
        const overlap = Object.keys(alt).filter((fy) => revAnnualBy[fy]?.val != null);
        if (!overlap.length) continue;
        const agrees = overlap.every((fy) => Math.abs(alt[fy].val - revAnnualBy[fy].val) <= 1e-5 * Math.abs(revAnnualBy[fy].val));
        if (!agrees) continue;
        for (const fy of Object.keys(alt)) {
          if (revAnnualBy[fy]?.val != null) continue;
          console.warn(`  ! ${ticker} revenue ${fy}: filled from ${altTag} (${alt[fy].val}) — equal to the chain in every overlap year`);
          revAnnualBy[fy] = { ...alt[fy] };
        }
      }
    }
    // THE REVENUE KEYHOLE (named targets, 2026-07-30): two filers' latest-year top line is
    // unreachable by every chain, fill and identity rung, yet sits verified in their own filings.
    // L3Harris tags FY2025's $21,865M on a QUARTER-length context (2025-10-04→2026-01-02, fp:FY,
    // twice) — EDGAR's own renderer leaves the annual column blank — while the printed
    // consolidated statement, the MD&A table and the segment note all carry 21,865 and close
    // arithmetically (15,487+6,378; the four segments net of intersegment). NRP's FY2025 10-K
    // files NO undimensioned revenue tag at all; its printed "Total revenues and other income"
    // is $207,282 thousand, which its filed CostsAndExpenses + OperatingIncomeLoss equal TO THE
    // DOLLAR, corroborated by the segment note (204,222+3,060) and the MD&A change table.
    // Each entry fills ONLY a year the record lacks, and ONLY while the payload still testifies
    // (the mis-contexted fact with this exact value, or the identity pair still summing to it) —
    // a corrected refiling or companyfacts ingestion retires the entry with no human in the loop.
    // Both were the honest casualties of the staleness guard: their old pages had served the
    // PRIOR year's revenue as current, which was worse.
    const REVENUE_KEYHOLE = {
      LHX: { fy: 2025, end: "2026-01-02", filed: "2026-02-12", val: 21865000000, test: () => Object.values(facts?.facts?.["us-gaap"] || {}).some((n) => (n.units?.USD || []).some((u) => u.end === "2026-01-02" && u.val === 21865000000 && u.form === "10-K")) },
      NRP: { fy: 2025, end: "2025-12-31", filed: "2026-02-27", val: 207282000, test: () => {
        const ce = annualByYear(facts, ["CostsAndExpenses"])["2025"]?.val, oiK = annualByYear(facts, ["OperatingIncomeLoss"])["2025"]?.val;
        return ce != null && oiK != null && ce + oiK === 207282000;
      } },
    };
    {
      const kh = REVENUE_KEYHOLE[ticker.toUpperCase()];
      if (kh && revAnnualBy[kh.fy]?.val == null && kh.test()) {
        revAnnualBy[kh.fy] = { val: kh.val, end: kh.end, filed: kh.filed, form: "10-K" };
        console.warn(`  ! ${ticker} revenue ${kh.fy}: filled from the named keyhole (${kh.val}) — verified against the filing's own printed statement; retires itself when the payload heals`);
      }
    }
    const latestRev = latestEntry(revAnnualBy);
    let revLatest = latestRev?.val ?? null;
    // The fiscal calendar (banks desk F2): each year's true period-end date from the revenue
    // record — the pin every balance-sheet instant below is checked against, so a dead tag's
    // mid-year or transition-date balance can never masquerade as a fiscal year's value.
    const fyEnds = Object.fromEntries(Object.entries(revAnnualBy).map(([fy, e]) => [fy, e.end]).filter(([, end]) => end));

    const oi = pickAnnual(facts, CONCEPTS.operatingIncome);
    // Anchor the fiscal year, period and filing link on whichever of operating income or revenue is
    // MORE RECENT. Operating income marks the period well for most filers, but an insurer like
    // Berkshire tags OperatingIncomeLoss only in an old year (its latest is FY2012), which would
    // otherwise anchor the whole record — fy, TTM, the filing link — to that stale year.
    const anchor = (oi && latestRev)
      ? (new Date(oi.end) >= new Date(latestRev.end) ? oi : latestRev)
      : (oi || latestRev); // for fy / period / filing link
    // A REVENUE FACT MAY ONLY SPEAK FOR THE YEAR IT BELONGS TO. When the anchor (the record's own
    // latest year) is newer than the newest revenue fact, the top line for that year is MISSING, not
    // whatever the old fact says — OGS's FY2025 page printed its FY2022 revenue verbatim for three
    // years because this line did not exist. The corroborated fill above rescues the year where the
    // filer's own overlap testimony allows it; where it does not, the year shows a dash. Keyed to the
    // anchor's fiscal year, never to max(end) over facts: forward-dated schedule facts (PPL's lease
    // maturities carry end=2026-12-31 in a 2021 filing) make max(end) itself a wrong-number machine.
    if (latestRev && anchor && latestRev.fy !== anchor.fy) {
      console.warn(`  ! ${ticker} revenue: newest fact is fy${latestRev.fy} but the record's latest year is fy${anchor.fy} — withheld rather than served as current`);
      revLatest = null;
    }
    const maxOf = (...vals) => { const xs = vals.filter((v) => v != null); return xs.length ? Math.max(...xs) : null; };
    // Total debt: long-term + current from the component tags, taken against the max of
    // every aggregate total-debt tag. We take the MAX across the tags (not a priority
    // merge) because a filer can tag its debt under different concepts in different
    // years; the max keeps the year-to-year series consistent and complete, and can
    // only correct an under-capture, never reduce a figure the components already got.
    const ltd = pickInstant(facts, CONCEPTS.longTermDebt, "USD", fyEnds);
    const cur = pickInstant(facts, CONCEPTS.currentDebt, "USD", fyEnds);
    const componentDebt = ltd || cur ? (ltd?.val || 0) + (cur?.val || 0) : null;
    const aggInstantVals = CONCEPTS.debtTotal.map((t) => pickInstant(facts, [t], "USD", fyEnds)?.val ?? null);
    const aggSeriesByTag = CONCEPTS.debtTotal.map((t) => collectInstant(facts, [t], "USD", fyEnds));
    const aggTTMVals = CONCEPTS.debtTotal.map((t) => latestObservation(facts, [t], "USD", true)?.val ?? null);
    const aggYear = (fy) => maxOf(...aggSeriesByTag.map((s) => s[fy] ?? null));
    // Secured + unsecured: many REITs split borrowings into these two buckets and tag no
    // combined total. They are mutually exclusive, so their sum is a valid total estimate
    // (max within each family first, in case a filer tags both a total and a long-term
    // variant). Offered to the overall max alongside the component pair and the aggregates,
    // so it lifts a split-tagged filer without ever inflating one already captured whole.
    const SECURED = ["SecuredDebt", "SecuredLongTermDebt"], UNSECURED = ["UnsecuredDebt", "UnsecuredLongTermDebt"];
    const famInstant = (tags) => maxOf(...tags.map((t) => pickInstant(facts, [t], "USD", fyEnds)?.val ?? null));
    const famSeries = (tags) => { const o = {}; for (const t of tags) { const s = collectInstant(facts, [t], "USD", fyEnds); for (const fy in s) o[fy] = Math.max(o[fy] ?? -Infinity, s[fy]); } return o; };
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

    // The stale-current tripwire (banks desk F1's generic form, 2026-07-21): a chain tag whose
    // latest fiscal year sits behind the record's anchor year must never populate the current
    // lines — that is how BAC's FY2019 provision and PNC's FY2023 interest expense shipped as
    // "current" for years. A line the filer stopped reporting reads honestly null instead.
    const pick = (tags) => {
      const e = pickAnnual(facts, tags);
      if (!e) return null;
      if (anchor?.fy != null && e.fy != null && e.fy < anchor.fy) return null;
      return e.val ?? null;
    };
    const inst = (tags) => {
      const e = pickInstant(facts, tags, "USD", fyEnds);
      if (!e) return null;
      if (anchor?.fy != null && e.fy != null && e.fy < anchor.fy) return null;
      return e.val ?? null;
    };

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

    // THE CORROBORATED FILL, second application (REIT dividends, 2026-07-28; the first is the
    // OGS revenue fill above, and the gate is identical — the filer's own testimony). Brixmor
    // pays its whole distribution but the dividendsPaid chain covers only FY2013-14: since then
    // its only payment line is PaymentsOfCapitalDistribution, the REIT return-of-capital element.
    // That element is NOT a dividends synonym — measured across every cached filer, Hertz and
    // Funko tag zeros under it in years they paid nothing of the kind, United's 2008 special
    // rides it, Beazer's is negative, and Public Storage's carries common PLUS preferred beside
    // a common-only chain (filling it would silently switch the record's composition mid-stream;
    // it disagrees in all seven overlap years and is refused). Only a filer whose overlap years
    // agree has testified the two elements are one figure — and "agree" includes the filer's own
    // printed rounding: Brixmor tags 19.2M in the chain beside 19,209,000 in the element, the
    // same figure disclosed at tenth-of-a-million precision, so a base that is round at $100k
    // accepts an alternative within half that step. The rule admits exactly Brixmor across the
    // whole cache (eleven dark years fill); Beazer's negatives, Clear Secure's both-directions
    // splits and Public Storage's preferred layer all fail it, which is what makes it safe.
    // No overlap proves nothing and fills nothing.
    const dividendsBy = annualByYear(facts, CONCEPTS.dividendsPaid);
    for (const altTag of ["PaymentsOfCapitalDistribution"]) {
      const alt = annualByYear(facts, [altTag]);
      const overlap = Object.keys(alt).filter((fy) => dividendsBy[fy]?.val != null);
      if (!overlap.length) continue;
      const agrees = overlap.every((fy) => {
        const a = dividendsBy[fy].val, b = alt[fy].val;
        if (Math.abs(b - a) <= 1e-5 * Math.abs(a)) return true;
        return a % 1e5 === 0 && Math.abs(b - a) <= 5e4;
      });
      if (!agrees) continue;
      for (const fy of Object.keys(alt)) {
        if (dividendsBy[fy]?.val != null) continue;
        console.warn(`  ! ${ticker} dividendsPaid ${fy}: filled from ${altTag} (${alt[fy].val}) — equal to the chain in every overlap year`);
        dividendsBy[fy] = { ...alt[fy] };
      }
    }
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
      costOfRevenue: valuesByYear(corByYear(facts)),
      depreciation: collectAnnual(facts, CONCEPTS.depreciation),
      dividendsPaid: valuesByYear(dividendsBy),
      buybacks: collectAnnual(facts, CONCEPTS.buybacks),
      repurchasedShares: collectAnnual(facts, CONCEPTS.repurchasedShares, "shares"),
      sharesDiluted: collectAnnual(facts, CONCEPTS.sharesDiluted, "shares"),
      netInterestIncome: collectAnnual(facts, CONCEPTS.netInterestIncome),
      noninterestIncome: collectAnnual(facts, CONCEPTS.noninterestIncome),
      noninterestExpense: collectAnnual(facts, CONCEPTS.noninterestExpense),
      provisionForCreditLosses: collectAnnual(facts, CONCEPTS.provisionForCreditLosses),
      gainOnSaleRealEstate: collectAnnual(facts, CONCEPTS.gainOnSaleRealEstate),
      interestCapitalized: collectAnnual(facts, CONCEPTS.interestCapitalized),
      premiumsEarned: collectAnnual(facts, CONCEPTS.premiumsEarned),
      claimsIncurred: collectAnnual(facts, CONCEPTS.claimsIncurred),
      underwritingExpense: collectAnnual(facts, CONCEPTS.underwritingExpense),
      lossesAndExpenses: collectAnnual(facts, CONCEPTS.lossesAndExpenses),
      investmentIncome: collectAnnual(facts, CONCEPTS.investmentIncome),
      stockBasedComp: collectAnnual(facts, CONCEPTS.stockBasedComp),
      sgaExpense: sgaSane(
        sgaSeries(
          collectAnnual(facts, CONCEPTS.sgaExpense),
          collectAnnual(facts, CONCEPTS.sellingMarketing),
          collectAnnual(facts, CONCEPTS.generalAdministrative),
        ),
        valuesByYear(revAnnualBy),
        ticker + ' sgaExpense',
        (m) => console.warn('  ! ' + m),
      ),
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
    const sharesInstant = collectInstant(facts, CONCEPTS.sharesOutstanding, "shares", fyEnds);
    for (const fy in sharesInstant) if (ha.sharesDiluted[fy] == null) ha.sharesDiluted[fy] = sharesInstant[fy];
    // The cover-page count (dei namespace, always raw units) arbitrates scale per year — the
    // filing's own testimony, needing no majority vote (ConocoPhillips tagged TEN consecutive
    // years in thousands; the cover counts corrected every one). Instants, keyed by period year.
    const coverByYear = {};
    for (const o of facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || []) {
      if (!o.end || o.val == null || o.val <= 0) continue;
      const fy = new Date(o.end).getUTCFullYear();
      if (!coverByYear[fy] || (o.filed || "") > coverByYear[fy].filed) coverByYear[fy] = { val: o.val, filed: o.filed || "" };
    }
    // A units gate was tried here across every dollar series and DELIBERATELY REMOVED, because
    // testing showed it destroyed more truth than it saved. A value orders of magnitude from its
    // own series median is often perfectly real: Arrowhead, a clinical-stage business, genuinely
    // paid $2,400 of tax in its loss years and $21.4M once it earned, and genuinely spent $9,674
    // of capital in 2011 against $176M in 2023. Any line that can legitimately approach zero — tax,
    // capex, impairments, interest — spans orders of magnitude honestly, and a median test cannot
    // tell that from a decimal-point error. The gate that does work is anchored to the same year's
    // revenue instead, and is applied where a ratio is genuinely impossible (see sgaSane below).
    for (const fy in coverByYear) coverByYear[fy] = coverByYear[fy].val;
    ha.sharesDiluted = normalizeShareScale(ha.sharesDiluted, coverByYear);
    // Repurchased shares are a fraction of outstanding — the cover count does not arbitrate them.
    ha.repurchasedShares = normalizeShareScale(ha.repurchasedShares);
    // The majority-scale reference, never the max: a single mistagged-HIGH history year must not
    // become the scale the current count gets "corrected" toward (src/lib/shareScale.mjs).
    const shareRef = majorityShareRef(ha.sharesDiluted) ?? Math.max(0, ...Object.values(ha.sharesDiluted).filter((v) => v != null));
    // GATE B (record-table accounting survey, 2026-07-31, scripts/equityGate.mjs): the equity
    // line ships only corroborated by the filer's own arithmetic. Twelve issuer-years of bogus
    // equity were live when it was built — National Fuel Gas printed −$625.7M against a true
    // $2,079.9B-book and a 34.2% ROIC against a real 14.4% — and 816 more years carried a later
    // filing's poisoned comparative over the year's own self-agreeing statement (Kemper's
    // FY2021). Chain, vintage, component-match and the assets−liabilities witness arbitrate;
    // an uncorroborated year is withheld, and its ROE, ROIC and book value withhold with it.
    const eqGate = equityByYear(facts, fyEnds);
    for (const w of eqGate.warns) console.warn(`  ! ${ticker} ${w}`);
    const hi = {
      equity: eqGate.series,
      cash: collectInstant(facts, CONCEPTS.cashAndEquivalents, "USD", fyEnds),
      stInv: collectInstant(facts, CONCEPTS.shortTermInvestments, "USD", fyEnds),
      ltMkt: collectInstant(facts, CONCEPTS.longTermMarketable, "USD", fyEnds),
      ltd: collectInstant(facts, CONCEPTS.longTermDebt, "USD", fyEnds),
      cur: collectInstant(facts, CONCEPTS.currentDebt, "USD", fyEnds),
      ca: collectInstant(facts, CONCEPTS.currentAssets, "USD", fyEnds),
      cl: collectInstant(facts, CONCEPTS.currentLiabilities, "USD", fyEnds),
      receivables: collectInstant(facts, CONCEPTS.receivables, "USD", fyEnds),
      inventory: collectInstant(facts, CONCEPTS.inventory, "USD", fyEnds),
      accountsPayable: collectInstant(facts, CONCEPTS.accountsPayable, "USD", fyEnds),
      assets: collectInstant(facts, CONCEPTS.totalAssets, "USD", fyEnds),
      deposits: collectInstant(facts, CONCEPTS.deposits, "USD", fyEnds),
      goodwill: collectInstant(facts, CONCEPTS.goodwill, "USD", fyEnds),
      intangibles: collectInstant(facts, CONCEPTS.intangibleAssets, "USD", fyEnds),
      realEstateGross: collectInstant(facts, CONCEPTS.realEstateGross, "USD", fyEnds),
      lossReserves: collectInstant(facts, CONCEPTS.lossReserves, "USD", fyEnds),
      netPPE: collectInstant(facts, CONCEPTS.netPPE, "USD", fyEnds),
      operatingLeaseAsset: collectInstant(facts, CONCEPTS.operatingLeaseAsset, "USD", fyEnds),
    };
    // The insurance desk's Wave A lines (scripts/insuranceLines.mjs): float components, the
    // discipline lines, and the reserve-development honesty meter, each behind its own gate.
    // Only filers carrying premiums data are touched; everyone else pays nothing here. F2: missing
    // claimsIncurred years fill from the reserve rollforward only where the two series proved
    // identical in overlap (Markel's dark FY2024-25).
    const isInsuranceFiler = hasInsuranceData(facts);
    const ins = isInsuranceFiler ? insuranceLines(facts, fyEnds) : null;
    let claimsFillUsed = false;
    if (ins) {
      const { filled, usedRollforward } = fillClaimsFromRollforward(ha.claimsIncurred, facts);
      if (usedRollforward) { ha.claimsIncurred = filled; claimsFillUsed = true; console.log(`  ${ticker}: claimsIncurred filled from reserve rollforward (overlap-verified)`); }
      for (const w of ins.flags?.warns || []) console.warn(`  ! ${ticker} insurance: ${w}`);
    }
    // The banks desk's Wave A lines (scripts/banksLines.mjs): the deposit franchise, the credit
    // cycle, the securities marks, the spread legs — deposit-funded lenders only. A filer
    // carrying BOTH premiums and a lending book routes by dominance (Citi files vestigial
    // PremiumsEarnedNet from its insurance-ops era; its $50B+ of net interest income says what
    // it is), so a money-center bank is never misfiled as an insurer by a legacy tag.
    const latestOfMap = (m) => { const fys = Object.keys(m || {}).map(Number); return fys.length ? m[Math.max(...fys)] : null; };
    const bankDominant = !isInsuranceFiler ||
      Math.abs(latestOfMap(ha.netInterestIncome) ?? 0) > Math.abs(latestOfMap(ha.premiumsEarned) ?? 0);
    const bank = bankDominant && hasBankData(facts, fyEnds) ? banksLines(facts, fyEnds) : null;
    if (bank) for (const w of bank.flags?.warns || []) console.warn(`  ! ${ticker} bank: ${w}`);
    const dims = DIMENSIONAL[String(ticker).toUpperCase()] || null;
    // The software desk (scripts/softwareLines.mjs): the contracted backlog and what lands within
    // a year, the deferred revenue behind it, the commissions paid to win it, and the filed inputs
    // to the dilution ledger. Runs for any filer carrying the concepts — the shelf decides what is
    // SURFACED, but a subscription book is a subscription book wherever it is shelved.
    const soft = !ins && !bank && hasSoftwareData(facts, fyEnds) ? softwareLines(facts, fyEnds, dims) : null;
    // The oil & gas desk: reserves, what they cost to replace, and which of the two legal accounting
    // methods the filer uses. Runs for any filer carrying the ASC 932 schedule, whatever shelf it
    // sits on — an integrated major has reserves exactly as a pure producer does.
    const og = !ins && !bank && hasOilGasData(facts) ? oilGasLines(facts, fyEnds) : null;
    if (og) for (const w of og.flags?.warns || []) console.warn(`  ! ${ticker} oil&gas: ${w}`);
    if (soft) for (const w of soft.flags?.warns || []) console.warn(`  ! ${ticker} software: ${w}`);
    // The utilities desk (scripts/utilitiesLines.mjs): the regulated balance sheet and the
    // reinvestment engine, gated on the filer's own testimony — a utility candidate (SIC
    // 4900-4991 or a taxonomy Utilities override) carrying >=5 distinct rate-regulated
    // concepts. Candidate-scoped, never universe-wide: EQT would pass on its pre-spin
    // pipeline legacy tags, and a merchant generator like Vistra fails at the count itself.
    const sicNum = Number(sic) || 0;
    const utilityCandidate = (sicNum >= 4900 && sicNum <= 4991)
      || sectorOfIndustry(industryLabelOf({ ticker, sic })) === "Utilities";
    const rateRegulated = utilityCandidate && rateRegulatedConceptCount(facts) >= 5;
    const ute = rateRegulated ? utilitiesLines(facts, fyEnds) : null;
    if (ute) for (const w of ute.flags?.warns || []) console.warn(`  ! ${ticker} utilities: ${w}`);
    const insYear = (fy) => {
      const o = {};
      for (const src of [ins, bank, soft, og, ute]) {
        if (!src) continue;
        for (const [line, series] of Object.entries(src.flows)) if (series[fy] != null) o[line] = series[fy];
        for (const [line, series] of Object.entries(src.instants)) if (series[fy] != null) o[line] = series[fy];
      }
      if (dims) for (const [line, series] of Object.entries(dims)) if (series[fy] != null && o[line] == null) o[line] = series[fy];
      return o;
    };
    const insLatest = () => {
      const o = {};
      // The stale-current tripwire governs the desk lines too: a series whose latest year sits
      // behind the record's anchor (Wells Fargo's charge-offs end in 2021) never populates the
      // current figures — the scorecard then shows the honest withheld-with-reason line instead
      // of a four-year-old number dressed as this year's.
      const latestOf = (series) => {
        const fys = Object.keys(series).map(Number).filter((fy) => series[fy] != null);
        if (!fys.length) return null;
        const maxFy = Math.max(...fys);
        if (anchor?.fy != null && maxFy < anchor.fy) return null;
        return series[maxFy];
      };
      for (const src of [ins, bank, soft, og, ute]) {
        if (!src) continue;
        for (const [line, series] of Object.entries(src.flows)) { const v = latestOf(series); if (v != null) o[line] = v; }
        for (const [line, series] of Object.entries(src.instants)) { const v = latestOf(series); if (v != null) o[line] = v; }
      }
      if (dims) for (const [line, series] of Object.entries(dims)) { if (o[line] != null) continue; const v = latestOf(series); if (v != null) o[line] = v; }
      // The F2 fill extends the current-lines claims figure too (the spread lands after the core
      // pick, so an overlap-verified rollforward value replaces a dark or stale one).
      if (ins && claimsFillUsed) { const v = latestOf(ha.claimsIncurred); if (v != null) o.claimsIncurred = v; }
      return o;
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
          minorityInterest: eqGate.minorityInterest[fy] ?? null,
          temporaryEquity: eqGate.temporaryEquity[fy] ?? null,
          equityInclNci: eqGate.inclNci[fy] ?? null,
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
          interestCapitalized: ha.interestCapitalized[fy] ?? null,
          realEstateGross: hi.realEstateGross[fy] ?? null,
          premiumsEarned: ha.premiumsEarned[fy] ?? null,
          claimsIncurred: ha.claimsIncurred[fy] ?? null,
          underwritingExpense: ha.underwritingExpense[fy] ?? null,
          lossesAndExpenses: ha.lossesAndExpenses[fy] ?? null,
          investmentIncome: ha.investmentIncome[fy] ?? null,
          lossReserves: hi.lossReserves[fy] ?? null,
          ...insYear(fy),
        },
      }));

    // Trailing twelve months, the freshest 12-month picture; folds in any
    // quarter filed since the last 10-K. Flows are TTM-summed; balance sheet and
    // share count are taken at the latest quarter.
    const tf = (tags, unit = "USD") => ttmFlow(facts, tags, unit)?.val ?? null;
    let ttmRev = ttmFlow(facts, revTags, "USD", isReitCo || isInsurerCo || isLessorCo || isBrokerCo);
    // A TTM older than the annual record it sits beside is a frozen carry-over — the stitch found
    // its freshest four quarters on a tag the filer abandoned (DTE stranded at Q1 2018, BPOP at
    // 2012) — and showing it as "current" is a wrong number, which is worse than a missing one.
    // Drop the whole block. The real rationale, stated honestly: the OTHER tf() lines stitch their
    // own tags and are often still fresh, but ONE shared asOf stamps the whole block — there is no
    // way to carry fresh netIncome beside a stale revenue without mislabeling one of them, and a
    // mixed-vintage block under a single date is exactly the stale-derived dishonesty this
    // campaign exists to kill. With ttm null the page reads the fiscal-year lines, which are
    // honest and dated. Per-line vintage is future schema work (docs/correctness-campaign.md).
    // Fourteen-day tolerance for 52/53-week calendars, mirroring auditContinuity C3.
    if (ttmRev?.asOf && anchor?.end && new Date(ttmRev.asOf).getTime() < new Date(anchor.end).getTime() - 14 * 86400000) {
      console.warn(`  ! ${ticker}: TTM stitch ends ${ttmRev.asOf}, older than the FY end ${anchor.end} — a stranded tag; dropping the TTM block (the FY lines stand)`);
      ttmRev = null;
    }
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
            // Dividends ride the same trailing basis as netIncome, so any surface splitting
            // profit into paid-out and retained never mixes a TTM numerator with an FY
            // dividend (the mixed-vintage class the comment above warns about). Also what
            // lets stewardship's retainedToEquity resolve on TTM-based records.
            dividendsPaid: ttmFlow(facts, CONCEPTS.dividendsPaid, "USD", false, true)?.val ?? null, // guardStable: dividend payment-date straddle can double-count a quarter
            sgaExpense: (() => {
              const c = tf(CONCEPTS.sgaExpense);
              if (c != null) return c;
              const s = tf(CONCEPTS.sellingMarketing), g = tf(CONCEPTS.generalAdministrative);
              return s != null && g != null ? s + g : g;
            })(),
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
            sharesDiluted: fixShareScale(freshestShare(latestObservation(facts, CONCEPTS.sharesDiluted, "shares", false), pickInstant(facts, CONCEPTS.sharesOutstanding, "shares", fyEnds)), shareRef),
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
            sharesOutstanding: fixShareScale(pickInstant(facts, CONCEPTS.sharesOutstanding, "shares", fyEnds)?.val ?? null, shareRef),
          },
          series: quarterSeries(facts, revTags, 8, isReitCo || isInsurerCo || isLessorCo || isBrokerCo),
        }
      : null;

    const rec = {
      ticker: ticker.toUpperCase(),
      name: displayName,
      cik,
      sic,
      sicDescription,
      // The utilities desk's membership gate, decided at extraction from the filer's own tags
      // (>=5 distinct rate-regulated concepts on a utility candidate). Present only when true;
      // every utilities surface — lens, scorecard, columns — routes on this, never on SIC alone,
      // so a merchant generator on a utility SIC never wears a regulated costume.
      ...(rateRegulated ? { rateRegulated: true } : {}),
      ...(ute?.flags?.utilityPlantBasis ? { utilityPlantBasis: ute.flags.utilityPlantBasis } : {}),
      ...(primaryTicker ? { primaryTicker } : {}),
      // Gate B's basis marker: when the anchor year's stored equity is the including-NCI figure
      // (the parent tag was the corroborated-away mistag), downstream surfaces must not add a
      // noncontrolling-interests row on top of it — that would double-count.
      ...(anchor?.fy != null && eqGate.basis[anchor.fy] === "inclNci" ? { equityBasis: "inclNci" } : {}),
      // A partnership's book is partners' capital; the record's equity row must say so.
      ...(anchor?.fy != null && eqGate.partnersYears?.has(String(anchor.fy)) ? { equityLabel: "Partners' capital" } : {}),
      // When this record was last EXTRACTED, which is not the same as the file's asOf: a partial
      // run rewrites the whole file while touching only its cohort, and without a per-record stamp
      // a decade-old extraction is indistinguishable from this morning's. The stamp is what turns
      // "probably fresh" into a fact, and it is what the stalest-first sweep sorts on.
      fetchedAt: new Date().toISOString().slice(0, 10),
      fy: anchor?.fy ?? null,
      periodEnd: anchor?.end ?? null,
      form: anchor?.form ?? "10-K",
      sourceUrl,
      // The dated instantaneous share count the valuation multiplies a price by; the record
      // tables keep the weighted-average diluted series. See sharesForValueOf above. The chain
      // returns null in two cases — no share fact at all (the dual-class dimension-stripped hole:
      // STZ, BAM, PLNT...) and a share fact that is real but decade-stale (Formula One, KKR,
      // Haverty's, whose recency guard now rejects the frozen weighted-average). In BOTH the
      // cover-text fallback reads the filing covers, corroborated across the 10-K and 10-Q, for
      // the real current count, or stays honestly null. Bounded: only ~30 filers reach this branch
      // (a fresh tagged count short-circuits it), so the extra cover fetches are trivial.
      // A ticker in DUAL_CLASS_EQUIV bypasses BOTH paths: its classes differ in per-share economics,
      // so neither the tagged average nor the summed cover is its count — see the table above.
      sharesForValue: DUAL_CLASS_EQUIV[ticker]
        ? await dualClassCoverShares(cik, DUAL_CLASS_EQUIV[ticker])
        : (sharesForValueOf(facts, shareRef, anchor?.end ?? null) ?? await coverShareCount(cik)),
      // Which weighted-average concept the share series ACTUALLY runs on: a filer whose diluted
      // tagging lapsed years back while the basic series continues (Exxon's diluted stops in 2013;
      // basic runs to the present) fills its recent record from the BASIC average, and the
      // per-share labels downstream must not call that "diluted" (2026-07-18; numerically nil for
      // XOM but a wrong word is still wrong). The test is recency, not existence — a diluted
      // relic a decade behind the living basic series doesn't earn the label.
      ...((() => {
        const lastEnd = (tag) => {
          const us = facts?.facts?.["us-gaap"]?.[tag]?.units?.shares;
          let max = null;
          if (us) for (const u of us) if (u.end && (!max || u.end > max)) max = u.end;
          return max;
        };
        const dil = [lastEnd("WeightedAverageNumberOfDilutedSharesOutstanding"), lastEnd("WeightedAverageNumberOfShareOutstandingBasicAndDiluted"), lastEnd("WeightedAverageLimitedPartnershipUnitsOutstandingDiluted")].filter(Boolean).sort().pop() || null;
        const bas = lastEnd("WeightedAverageNumberOfSharesOutstandingBasic");
        return bas && (dil == null || days(dil, bas) > 730 && bas > dil) ? { sharesBasis: "basic" } : {};
      })()),
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
        costOfRevenue: (() => {
          const e = latestEntry(corByYear(facts));
          if (!e) return null;
          if (anchor?.fy != null && e.fy != null && e.fy < anchor.fy) return null;
          return e.val ?? null;
        })(),
        stockBasedComp: pick(CONCEPTS.stockBasedComp),
        // Both legs must come from the same fiscal year before they are added; a current-year
        // selling line summed onto a prior-year administrative one would be a new wrong number.
        // Read from the record's own cleaned series at the anchor year, so the current figure
        // inherits the scale gate and the same-year leg rule rather than re-deriving them.
        sgaExpense: anchor?.fy != null ? (ha.sgaExpense?.[anchor.fy] ?? null) : null,
        researchDevelopment: pick(CONCEPTS.researchDevelopment),
        acquisitionSpend: pick(CONCEPTS.acquisitionSpend),
        goodwillImpairment: pick(CONCEPTS.goodwillImpairment),
        assetImpairment: pick(CONCEPTS.assetImpairment),
        // Read from the record's own filled series at the anchor year (the corroborated fill
        // above), not a fresh pick — measured across the cache the two never disagree except
        // where the fill recovered years the chain lacks, which is the point.
        dividendsPaid: anchor?.fy != null ? (ha.dividendsPaid?.[anchor.fy] ?? null) : null,
        buybacks: pick(CONCEPTS.buybacks),
        repurchasedShares: fixShareScale(pickAnnual(facts, CONCEPTS.repurchasedShares, "shares")?.val ?? null, shareRef),
        // The Gate B series at the anchor year, never a fresh pick — the corroborated figure
        // and the current figure must be one figure (a withheld year stays withheld here too).
        stockholdersEquity: anchor?.fy != null ? (eqGate.series[anchor.fy] ?? null) : null,
        minorityInterest: anchor?.fy != null ? (eqGate.minorityInterest[anchor.fy] ?? null) : null,
        temporaryEquity: anchor?.fy != null ? (eqGate.temporaryEquity[anchor.fy] ?? null) : null,
        equityInclNci: anchor?.fy != null ? (eqGate.inclNci[anchor.fy] ?? null) : null,
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
        sharesDiluted: fixShareScale(freshestShare(pickAnnual(facts, CONCEPTS.sharesDiluted, "shares"), pickInstant(facts, CONCEPTS.sharesOutstanding, "shares", fyEnds)), shareRef),
        netInterestIncome: pick(CONCEPTS.netInterestIncome),
        noninterestIncome: pick(CONCEPTS.noninterestIncome),
        noninterestExpense: pick(CONCEPTS.noninterestExpense),
        provisionForCreditLosses: pick(CONCEPTS.provisionForCreditLosses),
        totalAssets: inst(CONCEPTS.totalAssets),
        deposits: inst(CONCEPTS.deposits),
        goodwill: inst(CONCEPTS.goodwill),
        intangibleAssets: inst(CONCEPTS.intangibleAssets),
        gainOnSaleRealEstate: pick(CONCEPTS.gainOnSaleRealEstate),
        interestCapitalized: pick(CONCEPTS.interestCapitalized),
        realEstateGross: inst(CONCEPTS.realEstateGross),
        premiumsEarned: pick(CONCEPTS.premiumsEarned),
        claimsIncurred: pick(CONCEPTS.claimsIncurred),
        underwritingExpense: pick(CONCEPTS.underwritingExpense),
        lossesAndExpenses: pick(CONCEPTS.lossesAndExpenses),
        investmentIncome: pick(CONCEPTS.investmentIncome),
        lossReserves: inst(CONCEPTS.lossReserves),
        ...insLatest(),
      },
      // The desks' per-filer flags (DAC-includes-VOBA impurity, demand-vs-NIB labeling, gate
      // warnings) travel with the record so the display layer can label what extraction decided.
      ...(ins && (ins.flags.dacIncludesVoba || ins.flags.warns?.length) ? { insuranceFlags: ins.flags } : {}),
      ...(bank && Object.keys(bank.flags).length ? { bankFlags: bank.flags } : {}),
      // The lease-maturity ladder (operating + finance), from the clean ASC 842 XBRL buckets. Each ladder
      // is reconciled (buckets sum to the undiscounted total; total less imputed interest = the discounted
      // liability) and stored only if it ties out — a self-validating wall, the companion to the debt one.
      leases: (() => {
        const op = reconcileLeaseLadder({
          y1: inst(CONCEPTS.opLeaseY1), y2: inst(CONCEPTS.opLeaseY2), y3: inst(CONCEPTS.opLeaseY3),
          y4: inst(CONCEPTS.opLeaseY4), y5: inst(CONCEPTS.opLeaseY5), after: inst(CONCEPTS.opLeaseAfter),
          undiscounted: inst(CONCEPTS.opLeaseUndiscounted), imputed: inst(CONCEPTS.opLeaseImputed),
          liability: inst(CONCEPTS.operatingLeaseLiability),
        });
        const fin = reconcileLeaseLadder({
          y1: inst(CONCEPTS.finLeaseY1), y2: inst(CONCEPTS.finLeaseY2), y3: inst(CONCEPTS.finLeaseY3),
          y4: inst(CONCEPTS.finLeaseY4), y5: inst(CONCEPTS.finLeaseY5), after: inst(CONCEPTS.finLeaseAfter),
          undiscounted: inst(CONCEPTS.finLeaseUndiscounted), imputed: inst(CONCEPTS.finLeaseImputed),
          liability: inst(CONCEPTS.financeLeaseLiability),
        });
        return op || fin ? { asOf: anchor?.end ?? null, operating: op, finance: fin } : null;
      })(),
      history,
      ttm,
      quarterly,
    };
    // The quality floor: a company that can't render a non-broken page is withheld rather than
    // shipped, the condition for pushing coverage toward the whole universe without losing trust.
    // A record more than ~24 months stale is withheld for the same reason: a current annual filer's
    // latest period-end is always within ~15 months, so beyond two years the company is behind on its
    // filings and the record would present old — often internally inconsistent — figures as the
    // present. The number is sacred; a stale one mislabels today, so it is better shown as nothing.
    const tooStale = rec.periodEnd ? (Date.now() - new Date(rec.periodEnd).getTime()) > 24 * 30.44 * 86400000 : false;
    if (passesQualityFloor(rec) && !tooStale) {
      // A cost of revenue under a hundredth of the year's revenue is not a total. CenterPoint, a
      // utility that buys fuel, tags $4M against $9,337M and would print a 100% gross margin;
      // Murphy Oil tags nothing at all against $2,690M. Where no larger element exists to promote,
      // the honest reading is silence: the gross-margin row shows a dash rather than a figure that
      // says this business has no cost of sales. Applied to the record's own years, so a genuinely
      // costless year is judged against that year's revenue and not against the latest.
      if (rec.lines) rec.lines.costOfRevenue = thinCor(rec.lines.costOfRevenue, rec.lines.revenue);
      for (const h of rec.history || []) if (h.lines) h.lines.costOfRevenue = thinCor(h.lines.costOfRevenue, h.lines.revenue);
      // rec.ttm keeps its figures at rec.ttm.LINES, not on rec.ttm itself. This line read undefined,
      // computed nothing, and assigned the result to a property no consumer has ever looked at, so
      // the trailing-twelve-months block was the one place the floor never reached — and it is the
      // block the compare card and the Almanac census read. Oracle shipped a 96.9% gross margin on a
      // cost element it stopped filing in 2011. (The same floor now also sits inside
      // lib/fundamentals.grossMargin, so a fragment cannot reach a margin by any route.)
      if (rec.ttm?.lines) rec.ttm.lines.costOfRevenue = thinCor(rec.ttm.lines.costOfRevenue, rec.ttm.lines.revenue);
      companies.push(rec);
      console.log(`  ✓ ${ticker} (CIK ${cik}, FY${anchor?.fy ?? "?"})`);
    } else {
      withheld.add(ticker.toUpperCase());
      console.log(`  ⊘ ${ticker}: withheld (${tooStale ? `stale — latest filing FY${anchor?.fy ?? "?"}` : "below the data-quality floor — no usable top line or no earnings"})`);
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
  const prior = priorByTicker;
  const fresh = Object.fromEntries(companies.map((c) => [String(c.ticker).toUpperCase(), c]));
  // Field-level carry-over: a company can clear the quality floor (revenue + an earnings figure) yet
  // still have a SECONDARY field come back null on a transient XBRL tag miss — capex, depreciation,
  // debt, a share count — and the whole-record replace below would overwrite last week's good value
  // with a hole. So when this run re-fetched the SAME fiscal year, keep the prior run's value for any
  // field that came back null. Guarded on the fiscal year matching, so one year's figure is never
  // carried into another; a genuinely new annual (fresh.fy ≠ prior.fy) is taken exactly as fetched.
  let fieldsCarried = 0;
  const carryFields = (f, p) => {
    if (!p?.lines || !f?.lines || f.fy == null || f.fy !== p.fy) return f;
    // A prior value is carriable only when the fresh record's own anchor-year history carries the
    // line — proof the figure genuinely exists this year and the current-lines null was a blip.
    // Without this, the carry resurrects values the stale-current tripwire deliberately nulled
    // (Centene's dead premium line came back for three refetches running, 2026-07-21), and the
    // resurrection chains back to the pre-tripwire file forever.
    const anchorRow = (f.history || []).find((h) => h.fy === f.fy)?.lines;
    for (const k of Object.keys(p.lines)) {
      if (DESK_LINES.has(k)) continue; // deliberate desk withholds stay withheld
      if (f.lines[k] == null && p.lines[k] != null && anchorRow?.[k] != null) { f.lines[k] = p.lines[k]; fieldsCarried++; }
    }
    return f;
  };
  const merged = [];
  let carried = 0;
  for (const u of universe.tickers) {
    const T = u.ticker.toUpperCase();
    if (fresh[T]) merged.push(carryFields(fresh[T], prior[T]));
    else if (withheld.has(T)) continue; // fetched but failed the quality floor → no page, no stale carry-over
    else if (prior[T]) { merged.push(prior[T]); carried++; }
  }
  if (fieldsCarried) console.log(`   ${fieldsCarried} null field(s) carried over from the last good file (same fiscal year, transient tag misses)`);

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    source: "SEC EDGAR XBRL (companyfacts)",
    sample: false,
    note: "Latest annual (10-K) figures pulled from EDGAR. Values are raw USD.",
    companies: merged,
  };
  // Atomic write: serialize to a temp file then rename over the target, so an OOM or SIGKILL mid-write
  // can't leave a truncated JSON the next run would fail to parse. Rename is atomic on one volume. The
  // file is written compact (null-stripped, minified) to stay well under GitHub's push size limit as the
  // universe grows — lossless to every reader (see lib/dataFile.mjs).
  const dest = path.join(dataDir, "fundamentals.json");
  const tmp = dest + ".tmp";
  fs.writeFileSync(tmp, compactJson(out));
  fs.renameSync(tmp, dest);
  console.log(`\n✅ Wrote ${merged.length} companies (${companies.length} passed, ${withheld.size} withheld below the quality floor, ${carried} carried over from the last good file)`);

  // What this run did NOT refresh. A partial run rewrites the whole file, so silence here would
  // read as coverage; the pipeline should say plainly how much of what it just published is old
  // and how old the oldest of it is. Anything past a quarter is called out by name-count, because
  // a company that has not been re-extracted in three months has had a 10-K land in the meantime.
  const today = new Date().toISOString().slice(0, 10);
  const ages = merged.map((c) => c.fetchedAt || null);
  const unstamped = ages.filter((d) => !d).length;
  const stale = ages.filter((d) => d && days(d, today) > 92).length;
  const oldest = ages.filter(Boolean).sort()[0] || null;
  if (unstamped || stale) {
    console.log(`   Freshness: ${merged.length - unstamped - stale} extracted within the quarter, ${stale} older than 92 days, ${unstamped} never stamped${oldest ? ` (oldest stamp ${oldest})` : ""}.`);
    console.log(`   Sweep them with FUND_STALEST=<n>, or a shelf at a time with FUND_INDUSTRY / FUND_SECTOR.`);
  }
  if (withheld.size) console.log(`   withheld: ${[...withheld].sort().join(", ")}`);
}

// Exported for the offline extraction test and the wire's performance line; only hit EDGAR when run directly.
export { instantMap, quarterFlowMap, quarterSeries, latestObservation, annualByYear, deriveOpInc, revenueTagsFor, CONCEPTS, fyOfEnd, sgaSeries, thinCor, corByYear, applyIncomeStatementIdentity, IDENTITY_FROZEN };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  });
}
