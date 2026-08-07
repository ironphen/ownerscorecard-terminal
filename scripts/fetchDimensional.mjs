#!/usr/bin/env node
// fetchDimensional.mjs — Tier-2: the named withholds, read from the filings' own inline XBRL.
//
// The SEC companyfacts API serves only undimensioned default-context facts, so a concept a filer
// reports under a segment or product dimension is invisible to the Tier-1 pipeline — Travelers'
// reserve development, Cigna's entire insurance book, Centene's premium line. This fetcher reads
// the 10-K inline-XBRL documents themselves, but ONLY for a named registry of targets whose exact
// dimensional coordinates were mapped and value-verified first (run wf_402f292f, 2026-07-21, 35
// of 43 targets verified to the dollar against the desks' independent derivations). It is a
// keyhole, not a crawl: each target names its filer, tag, and the exact axis-member set its
// context must carry — nothing else is read, and every extraction sits behind the same identity
// gates the desks ratified.
//
// Doctrine notes, decided at ratification:
//   - Wells Fargo (banks desk Q4, "Wave B"): its modern charge-off totals live on EXTENSION
//     namespace tags (wfc:) in the default context — companyfacts drops extension namespaces
//     wholesale. Custom tags are otherwise never read (the TRV sign-flip precedent), but here
//     the extension tag is the ONLY carrier and it self-checks two independent ways every year:
//     gross − recoveries = net, and the same tag's segment members sum exactly to its total.
//     Both gates must hold or the year is withheld. The exception is this narrow.
//   - Centene (managed-care desk Q3 follow-through): the modern premium line is the filer's own
//     income-statement "Revenues: Premium" caption, tagged as an ASC-606 element under
//     HealthCarePremiumMember. The desk's drill verified the MLR computed on it matches the
//     reported health-benefits ratio to a tenth; the enterprise blended proxy stays refused.
//   - Cigna: member-only contexts (the segment axis alone). The 2023-2024 claims-liability
//     balances exist only under disposal-group custom elements during the Medicare-sale window
//     and are deliberately NOT read — those two years stay honestly holed.
//   - Capex, four rate-regulated filers (2026-08-03): the highest-stakes field this fetcher has
//     ever been pointed at. Capex is the second term of owner earnings and the whole of free cash
//     flow's subtraction, so a wrong figure is worse than none and worse here than anywhere. The
//     entry ticket was raised to match: beyond the usual mapping, EVERY year admitted below was
//     first read off the filing's own printed statement of cash flows, and every year reconstructs
//     that statement's printed "net cash used in investing activities" to the dollar. Two new gates
//     carry that discipline forward without a human — the member census (a filer that adds a
//     component to the axis withholds the year rather than reporting a partial line) and the
//     capex double identity (the Wells Fargo bar, applied to the two extension-namespace filers).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compactJson } from "../src/lib/dataFile.mjs";

const UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 250;
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

async function getText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120_000) });
      if (res.status === 429) { await sleep(1500 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(800 * a); }
  }
}
async function getJSON(url) { return JSON.parse(await getText(url)); }

// ---- the registry: every target named, mapped, and value-verified before it entered ----
const RPO_AXIS = "us-gaap:RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionStartDateAxis";
const RPO_PERIOD = "us-gaap:RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionPeriod1";
// The twelve-month band, filed as a share, behind a typed member. Same shape at both filers and
// stable a year back at each. Microsoft additionally tags the total under a commercial-customer
// member; the exact-set-empty rule already refuses that, and the narrative confirms the share
// applies to the whole company's obligations rather than the commercial slice.
const rpoShareBand = { line: "rpoTwelveMonthShare", tag: "us-gaap:RevenueRemainingPerformanceObligationPercentage", axis: RPO_AXIS, periodTag: RPO_PERIOD };

// THE ONE PLACE THIS FILE SWEEPS RATHER THAN AIMS, and the reason it is still a keyhole.
//
// Everywhere else a target names its filer AND its exact axis-member coordinates, because a
// dimensioned fact read blind might be a segment wearing a total's name. The twelve-month band
// has no such ambiguity to resolve: the tag is standard, the axis is standard, and the three
// gates are structural rather than per-filer — the context must carry NO explicit members (which
// is what a segment or product slice would add), exactly one typed member on the named axis, a
// start date exactly one day after the balance-sheet date, and a twelve-month duration filed
// against that same context. A filer whose disclosure differs in any respect yields nothing.
//
// So the per-filer map that the other targets need has no work left to do here, and withholding
// the band from hundreds of companies to preserve a ceremony that protects against nothing would
// cost readers the single most useful number a contracted-revenue business has.
//
// The sweep is deliberately NOT filtered by shelf. A backlog reading belongs to any business that
// sells service it has not yet delivered, and that is not a property of where a company is filed:
// Accenture, Cisco, Workday, Verisk and ADP carry contracted revenue exactly as Salesforce does,
// and an earlier version of this that keyed on the Software shelf left every one of them dark. The
// entry ticket is the economics — a deferred-revenue balance and enough size for the reading to
// matter — and the gates decide the rest.
export function bandSweepTargets(companies, minRevenue = 5e8) {
  return companies
    .filter((c) => c.cik && c.lines?.revenue > minRevenue && c.lines?.contractLiability != null)
    .map((c) => ({ ticker: c.ticker, cik: String(c.cik).padStart(10, "0"), filings: 2, bands: [rpoShareBand], quiet: true }));
}

export const TARGETS = [
  { ticker: "MSFT", cik: "0000789019", filings: 4, bands: [rpoShareBand] },
  { ticker: "NOW", cik: "0001373715", filings: 4, bands: [rpoShareBand] },
  {
    // Salesforce files no typed band at all: its current and noncurrent obligations are its own
    // extension tags, in dollars, in the default context. That is the Wells Fargo precedent — an
    // extension tag read only because it is the sole carrier — and it takes the same treatment: a
    // self-check that must hold or the year is withheld. Current plus noncurrent must equal the
    // undimensioned us-gaap total, which held to the exact filed dollar at three year ends.
    ticker: "CRM", cik: "0001108524", filings: 4,
    lines: [
      { line: "rpoCurrent", kind: "instant", tag: "crm:RevenueRemainingPerformanceObligationCurrent", dims: {} },
    ],
    gateInputs: [
      { name: "noncurrent", kind: "instant", tag: "crm:RevenueRemainingPerformanceObligationNoncurrent", dims: {} },
      { name: "total", kind: "instant", tag: "us-gaap:RevenueRemainingPerformanceObligation", dims: {} },
    ],
    gate: "rpoSplitIdentity",
  },
  {
    ticker: "TRV", cik: "0000086312", filings: 6,
    lines: [
      { line: "reserveDevelopmentPriorYear", kind: "flow",
        tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } },
    ],
    // The sign-identity gate, from the same contexts: CY + PY must equal total incurred
    // (verified exact in all five mapped years).
    gateInputs: [
      { name: "cy", kind: "flow", tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersCurrentYearClaimsAndClaimsAdjustmentExpense",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } },
      { name: "total", kind: "flow", tag: "us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } },
    ],
    gate: "incurredIdentity",
  },
  {
    ticker: "CI", cik: "0001739940", filings: 6,
    lines: [
      { line: "reserveDevelopmentPriorYear", kind: "flow",
        tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { line: "lossReserves", kind: "instant",
        tag: "us-gaap:LiabilityForClaimsAndClaimsAdjustmentExpense",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { line: "lossReservesNet", kind: "instant",
        tag: "us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { line: "reinsuranceRecoverables", kind: "instant",
        tag: "us-gaap:ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
    ],
    gateInputs: [
      { name: "cy", kind: "flow", tag: "us-gaap:SupplementalInformationForPropertyCasualtyInsuranceUnderwritersCurrentYearClaimsAndClaimsAdjustmentExpense",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
      { name: "total", kind: "flow", tag: "us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "ci:CignaHealthcareMember" } },
    ],
    gate: "incurredIdentity",
  },
  {
    ticker: "CNC", cik: "0001071739", filings: 6,
    lines: [
      { line: "premiumsEarned", kind: "flow",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:HealthCarePremiumMember" } },
    ],
  },
  {
    // Berkshire's insurance stack exists ONLY dimensioned (solvency-sight Build 7 keyhole,
    // probed 2026-08-05): no premiums, reserves or unearned-premium fact lands undimensioned in
    // any of ten fiscal years, which is how the float company's page printed "Float $17.9B"
    // against the ~$176B its own letter states. The balance-sheet column member is
    // brka:InsuranceAndOtherMember (Berkshire's two-column presentation), and the claims
    // liability carries a TRIPLE cross-context tie — the same $120,713M is filed under the
    // insurance-and-other column, the P&C-ex-retroactive product member, and the insurance-group
    // segment member — stronger than the Wells Fargo double identity this registry's ceremony is
    // named for. Premiums carry an exact member identity: P&C $83,633M + life/health $5,269M =
    // $88,902M to the filed dollar. The retroactive-reinsurance liability ($31,048M) lives on
    // CededCreditRiskAxis and is deliberately NOT folded into lossReserves: it is a separate
    // contract liability, and Buffett's stated float (which includes it) stays the page's float
    // figure via the Build-1b weld — this entry restores the RECORD's component lines, not a
    // computed float. Routing consequence, verified before shipping: with premiums restored,
    // Berkshire's premium share is ~24% of revenue, so the conglomerate carve-out fires on its
    // own designed test instead of the fail-closed path — Berkshire stays off the insurer
    // scorecard because it IS a conglomerate, not because its tags are dark.
    ticker: "BRK-A", cik: "0001067983", filings: 4,
    lines: [
      { line: "lossReserves", kind: "instant", tag: "us-gaap:LiabilityForClaimsAndClaimsAdjustmentExpense",
        dims: { "srt:ProductOrServiceAxis": "brka:InsuranceAndOtherMember" } },
      { line: "unearnedPremiums", kind: "instant", tag: "us-gaap:UnearnedPremiums",
        dims: { "srt:ProductOrServiceAxis": "brka:InsuranceAndOtherMember" } },
      { line: "premiumsEarned", kind: "flow", tag: "us-gaap:PremiumsEarnedNet",
        dims: { "srt:ProductOrServiceAxis": "brka:InsuranceAndOtherMember" } },
    ],
    gateInputs: [
      { name: "claimsPcExRetro", kind: "instant", tag: "us-gaap:LiabilityForClaimsAndClaimsAdjustmentExpense",
        dims: { "srt:ProductOrServiceAxis": "brka:PropertyAndCasualtyInsuranceAndReinsuranceExcludingRetroactiveReinsuranceMember" } },
      { name: "claimsSegment", kind: "instant", tag: "us-gaap:LiabilityForClaimsAndClaimsAdjustmentExpense",
        dims: { "us-gaap:StatementBusinessSegmentsAxis": "brka:BerkshireHathawayInsuranceGroupMember" } },
      { name: "premPc", kind: "flow", tag: "us-gaap:PremiumsEarnedNet",
        dims: { "srt:ProductOrServiceAxis": "us-gaap:PropertyLiabilityAndCasualtyInsuranceSegmentMember" } },
      { name: "premLife", kind: "flow", tag: "us-gaap:PremiumsEarnedNet",
        dims: { "srt:ProductOrServiceAxis": "brka:LifeAndHealthInsuranceMember" } },
    ],
    gate: "brkInsuranceTies",
  },
  {
    ticker: "WFC", cik: "0000072971", filings: 5,
    lines: [
      { line: "netChargeOffs", kind: "flow",
        tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoffRecoveryTotal",
        dims: {} },
    ],
    gateInputs: [
      { name: "gross", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoff", dims: {} },
      { name: "rec", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossRecovery", dims: {} },
      { name: "segA", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoffRecoveryTotal",
        dims: { "us-gaap:FinancingReceivablePortfolioSegmentAxis": "us-gaap:CommercialPortfolioSegmentMember" } },
      { name: "segB", kind: "flow", tag: "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAllowanceForCreditLossWriteoffRecoveryTotal",
        dims: { "us-gaap:FinancingReceivablePortfolioSegmentAxis": "us-gaap:ConsumerPortfolioSegmentMember" } },
    ],
    gate: "wfcDoubleIdentity",
  },

  // ---- CAPEX: the four rate-regulated filers companyfacts cannot reach (2026-08-03) ----
  //
  // Sixteen utility rows carried no capital spending at all; twelve were recovered inside the
  // Tier-1 fetcher's own named keyhole. These four could not be, and the reason is structural
  // rather than a chain-ordering accident: CMS Energy and New Jersey Resources tag the standard
  // us-gaap capex element ONLY under a property-type dimension, and the companyfacts API strips
  // dimensions; DTE and NextEra print their capital-expenditure lines on extension elements, and
  // the API drops extension namespaces wholesale. No ladder can reach any of it. The filings can.
  //
  // What "corroborated" means for these four, and it is stricter than anywhere else in this file:
  // each year's components were read off the filer's own printed statement of cash flows, and each
  // year's components together with the other printed investing lines reconstruct that statement's
  // printed net-investing total EXACTLY. Those reconstructions, done by hand before any of this was
  // written, are recorded per filer below.
  //
  // The total-or-partial question is decided by the AEP precedent shipped a week earlier: a plant
  // BOUGHT from its owner is not a plant BUILT, so an acquisition line stays out of capital
  // spending and stays visible on the Investing cash-flow row. It bites twice here — CMS's Covert
  // Generating Station purchase and DTE's 2025 business combination — and in both cases the
  // company itself prints the acquisition on its own separate line, which is what makes the
  // carve-out the filer's judgement rather than ours.
  {
    // CMS ENERGY — one property-type member, and it is the whole printed line.
    //
    //   "Cash Flows from Investing Activities
    //    Capital expenditures (excludes assets placed under finance lease)  (3,824)  (3,018)  (2,407)
    //    Covert Generating Station acquisition                                  —        —      (812)"
    //
    // The reconstruction, from that same printed statement: 2025, 0 (sale of the ASP business)
    // − 214 (cost to retire property and other investing) − 3,824 = (4,038), the printed net cash
    // used in investing to the dollar; 2024, 124 − 160 − 3,018 = (3,054); 2023, 0 − 167 − 2,407
    // − 812 = (3,386). All three exact.
    //
    // And a fourth proof that this member is the LINE and not a slice of it: for 2022 the same
    // member reads 2,374, which is precisely the undimensioned figure companyfacts still serves and
    // the record has carried for years. The filer moved the line under a dimension; it did not
    // change what the line means.
    //
    // Covert is a 1,176 MW gas plant CMS bought in 2023, not one it built. Out, by the AEP rule.
    ticker: "CMS", cik: "0000811156", filings: 2,
    lines: [
      { line: "capex", kind: "flow", components: [
        { tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", dims: { "us-gaap:PropertyPlantAndEquipmentByTypeAxis": "cms:OngoingCapitalExpendituresMember" } },
      ] },
    ],
    census: {
      tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment",
      axis: "us-gaap:PropertyPlantAndEquipmentByTypeAxis",
      known: ["cms:OngoingCapitalExpendituresMember", "cms:CovertPlantAcquisitionMember"],
    },
  },
  {
    // NEW JERSEY RESOURCES — three property-type members, and the three ARE the printed sub-list.
    //
    //   "CASH FLOWS USED IN INVESTING ACTIVITIES
    //    Expenditures for:
    //      Utility plant                          (391,906)  (372,019)  (350,304)
    //      Solar equipment                        (238,185)  (104,287)  (107,303)
    //      Storage and transportation and other    (29,957)   (46,628)   (42,757)"
    //
    // Fiscal 2025 sums to $660,048 thousand. The reconstruction: −660,048 − 46,030 (cost of
    // removal) + 612 (distributions from equity investees) + 137,195 (proceeds from sale of assets)
    // = (568,271), the printed total exactly; fiscal 2024 gives (569,073) and fiscal 2023 (538,625),
    // both exact.
    //
    // Cost of removal is printed under the same "Expenditures for:" heading and is deliberately NOT
    // capital spending: retiring plant is charged against accumulated depreciation, the filer tags
    // it as its own removal-costs element, and Con Edison and CMS keep the identical line out of
    // theirs. It stays on the Investing cash-flow row. There is no acquisition line in these years,
    // so the three members are the filer's TOTAL capital spending.
    ticker: "NJR", cik: "0000356309", filings: 2,
    lines: [
      { line: "capex", kind: "flow", components: [
        { tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", dims: { "us-gaap:PropertyPlantAndEquipmentByTypeAxis": "njr:UtilityPlantMember" } },
        { tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", dims: { "us-gaap:PropertyPlantAndEquipmentByTypeAxis": "njr:SolarEquipmentMember" } },
        { tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", dims: { "us-gaap:PropertyPlantAndEquipmentByTypeAxis": "njr:StorageAndTransportationAndOtherMember" } },
      ] },
    ],
    census: {
      tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment",
      axis: "us-gaap:PropertyPlantAndEquipmentByTypeAxis",
      known: ["njr:UtilityPlantMember", "njr:SolarEquipmentMember", "njr:StorageAndTransportationAndOtherMember"],
    },
  },
  {
    // DTE ENERGY — the Wells Fargo case, on capex. Two extension elements carry the two printed
    // face lines and nothing else does:
    //
    //   "Investing Activities
    //    Plant and equipment expenditures - utility          (4,343)  (4,399)  (3,872)
    //    Plant and equipment expenditures - non-utility         (86)     (68)     (62)
    //    Acquisition related to business combination, net
    //      of cash acquired                                    (210)       0        0"
    //
    // The standard us-gaap capex element IS in this document, but only under the legal-entity axis
    // for DTE Electric, the subsidiary co-registrant ($3,686M in 2025) — it is the wrong company,
    // and the exact-set rule refuses it anyway. For DTE Energy the extension pair is the sole
    // carrier, so the Wells Fargo exception applies and its price applies with it: two independent
    // self-checks, both of which must hold or the year is withheld.
    //
    //   1. The pair, plus the business combination the filer prints on its own line, must equal
    //      DTE's own independently tagged capital-spending total (the element whose name literally
    //      says it includes business acquisitions): 2025, 4,343 + 86 + 210 = 4,639; 2024, 4,399 +
    //      68 + 0 = 4,467; 2023, 3,872 + 62 + 0 = 3,934. Exact in every year.
    //   2. That same total's four segment members must sum to it: 3,892 + 661 + 80 + 6 = 4,639 in
    //      2025, and likewise 2024 and 2023. Exact.
    //
    // The printed statement's own arithmetic agrees: 2025, −4,343 − 86 − 210 + 32 + 717 − 719 + 18
    // − 1 − 600 + 22 − 134 = (5,304), the printed net cash used in investing to the dollar; 2024
    // gives (4,951) and 2023 (4,095), both exact.
    //
    // TOTAL, not partial: the two plant-and-equipment lines are the whole of DTE's own building.
    // The $210M business combination is a company bought, not plant built — out by the AEP rule,
    // and the record already carries it as acquisition spend.
    ticker: "DTE", cik: "0000936340", filings: 2,
    lines: [
      { line: "capex", kind: "flow", components: [
        { tag: "dte:PlantAndEquipmentExpendituresUtility", dims: {} },
        { tag: "dte:PlantAndEquipmentExpendituresNonUtility", dims: {} },
      ] },
    ],
    gateInputs: [
      { name: "total", kind: "flow", tag: "dte:PaymentsToAcquireProductiveAssetsIncludingPaymentsToAcquireBusinessesNetOfCashAcquired", dims: {} },
      { name: "carveBusinessCombination", kind: "flow", tag: "us-gaap:PaymentsToAcquireBusinessesNetOfCashAcquired", dims: {} },
      { name: "segElectric", kind: "flow", tag: "dte:PaymentsToAcquireProductiveAssetsIncludingPaymentsToAcquireBusinessesNetOfCashAcquired",
        dims: { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember", "us-gaap:StatementBusinessSegmentsAxis": "dte:ElectricSegmentMember" } },
      { name: "segGas", kind: "flow", tag: "dte:PaymentsToAcquireProductiveAssetsIncludingPaymentsToAcquireBusinessesNetOfCashAcquired",
        dims: { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember", "us-gaap:StatementBusinessSegmentsAxis": "dte:GasSegmentMember" } },
      { name: "segVantage", kind: "flow", tag: "dte:PaymentsToAcquireProductiveAssetsIncludingPaymentsToAcquireBusinessesNetOfCashAcquired",
        dims: { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember", "us-gaap:StatementBusinessSegmentsAxis": "dte:DTEVantageSegmentMember" } },
      { name: "segEnergyTrading", kind: "flow", tag: "dte:PaymentsToAcquireProductiveAssetsIncludingPaymentsToAcquireBusinessesNetOfCashAcquired",
        dims: { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember", "us-gaap:StatementBusinessSegmentsAxis": "dte:EnergyTradingSegmentMember" } },
    ],
    gate: "capexDoubleIdentity",
  },
  {
    // NEXTERA ENERGY — the same case, four printed lines, three of them extension elements:
    //
    //   "CASH FLOWS FROM INVESTING ACTIVITIES
    //    Capital expenditures of FPL                        (8,719)  (7,992)  (9,302)
    //    Independent power and other investments of NEER   (15,332) (16,215) (15,565)
    //    Nuclear fuel purchases                               (553)    (399)    (185)
    //    Other capital expenditures                             (2)    (123)     (61)"
    //
    // Nuclear fuel rides a standard element in the default context, so the API does serve that one
    // — but it is $553M of a $24.6B line, and nothing carries the other 98%. The standard capex
    // chain reads nothing at all for this filer. Sole-carrier, so the Wells Fargo bar and its two
    // self-checks:
    //
    //   1. The four components must equal NextEra's own independently tagged total (its
    //      capital-expenditures / independent-power-investments / nuclear-fuel element in the
    //      default context): 8,719 + 15,332 + 553 + 2 = 24,606 for 2025, 24,729 for 2024, 25,113
    //      for 2023. Exact in every year.
    //   2. That total's segment members must sum to it: FPL 8,935 + NEER 15,669 + corporate and
    //      eliminations 2 = 24,606. Exact in every year.
    //
    // The printed statement agrees: 2025, −8,719 − 15,332 − 553 − 2 + 1,115 + 5,401 − 5,893 + 118
    // = (23,865), the printed net cash used in investing to the dollar; 2024 gives (22,264), 2023
    // (23,467), 2022 (18,359). All exact.
    //
    // TOTAL capital spending as the filer presents it, with the one thing a reader should know
    // said plainly: NextEra's second line is "independent power and OTHER INVESTMENTS," and a
    // renewables developer's investment programme includes projects it buys as well as projects it
    // builds. The company draws no line between the two and prints no separate acquisition row, so
    // there is nothing here to carve out the way CMS's Covert purchase or DTE's business
    // combination could be carved. Reported as the filer reports it.
    ticker: "NEE", cik: "0000753308", filings: 2,
    lines: [
      { line: "capex", kind: "flow", components: [
        { tag: "nee:CapitalExpendituresOfFPL", dims: {} },
        { tag: "nee:IndependentPowerInvestments", dims: {} },
        { tag: "us-gaap:PaymentsForProceedsFromNuclearFuel", dims: {} },
        { tag: "nee:OtherCapitalExpenditures", dims: {} },
      ] },
    ],
    gateInputs: [
      { name: "total", kind: "flow", tag: "nee:CapitalExpendituresIndependentPowerInvestmentsAndNuclearFuelPurchases", dims: {} },
      { name: "segFpl", kind: "flow", tag: "nee:CapitalExpendituresIndependentPowerInvestmentsAndNuclearFuelPurchases",
        dims: { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember", "us-gaap:StatementBusinessSegmentsAxis": "nee:FloridaPowerLightCompanyMember" } },
      { name: "segNeer", kind: "flow", tag: "nee:CapitalExpendituresIndependentPowerInvestmentsAndNuclearFuelPurchases",
        dims: { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember", "us-gaap:StatementBusinessSegmentsAxis": "nee:NEERSegmentMember" } },
      { name: "segCorporate", kind: "flow", tag: "nee:CapitalExpendituresIndependentPowerInvestmentsAndNuclearFuelPurchases",
        dims: { "srt:ConsolidationItemsAxis": "nee:CorporateAndEliminationsMember" } },
    ],
    gate: "capexDoubleIdentity",
  },
];

// ---- the inline-XBRL keyhole parser ----

// Contexts: id -> { instant | start/end, dims: {axis: member}, typed: bool }. Handles both
// xbrli:-prefixed and bare element names; explicit members only — a context carrying any typed
// member is marked and never matched (typed dimensions are future work, the MSFT RPO band).
export function parseContexts(doc) {
  const out = {};
  const re = /<(?:xbrli:)?context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g;
  let m;
  while ((m = re.exec(doc))) {
    const [, id, body] = m;
    const ctx = { dims: {}, typed: /typedMember/.test(body), typedDims: [] };
    const inst = body.match(/<(?:xbrli:)?instant>([^<]+)<\/(?:xbrli:)?instant>/);
    const start = body.match(/<(?:xbrli:)?startDate>([^<]+)<\/(?:xbrli:)?startDate>/);
    const end = body.match(/<(?:xbrli:)?endDate>([^<]+)<\/(?:xbrli:)?endDate>/);
    if (inst) ctx.instant = inst[1].trim();
    if (start) ctx.start = start[1].trim();
    if (end) ctx.end = end[1].trim();
    const dimRe = /<xbrldi:explicitMember\s+dimension="([^"]+)"\s*>([^<]+)<\/xbrldi:explicitMember>/g;
    let d;
    while ((d = dimRe.exec(body))) ctx.dims[d[1].trim()] = d[2].trim();
    // Typed members carry their value in a nested element rather than as a member QName. The
    // twelve-month RPO band is filed this way: one typed member on the timing axis whose inner
    // element is the axis name plus ".domain" and whose content is the date the band starts.
    const typedRe = /<xbrldi:typedMember\s+dimension="([^"]+)"\s*>\s*<([^\s>/]+)[^>]*>([\s\S]*?)<\/\2>\s*<\/xbrldi:typedMember>/g;
    let ty;
    while ((ty = typedRe.exec(body))) ctx.typedDims.push({ dimension: ty[1].trim(), inner: ty[2].trim(), content: ty[3].replace(/<[^>]+>/g, "").trim() });
    out[id] = ctx;
  }
  return out;
}

// Facts for ONE tag: [{contextRef, value}] with ix sign and scale applied and formatting stripped.
export function parseFacts(doc, tag) {
  const out = [];
  const re = new RegExp(`<ix:nonFraction([^>]*name="${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*)>([\\s\\S]*?)<\\/ix:nonFraction>`, "g");
  let m;
  while ((m = re.exec(doc))) {
    const attrs = m[1];
    const ctxRef = (attrs.match(/contextRef="([^"]+)"/) || [])[1];
    if (!ctxRef) continue;
    if (/xsi:nil="true"/.test(attrs)) continue;
    const scale = Number((attrs.match(/scale="(-?\d+)"/) || [])[1] ?? 0);
    const sign = /sign="-"/.test(attrs) ? -1 : 1;
    const text = m[2].replace(/<[^>]+>/g, "").replace(/[,\s]/g, "");
    const num = parseFloat(text);
    if (!Number.isFinite(num)) continue;
    out.push({ contextRef: ctxRef, value: num * Math.pow(10, scale) * sign });
  }
  return out;
}

// A context matches a target when its explicit-member set EQUALS the spec exactly (no extra
// axes, no typed members) and its period shape fits the kind.
// The twelve-month band's context, matched by all three of its identifying marks at once. NOW files
// 13-36-month DECOY contexts on the SAME axis, and CRM's decoy shares the very same start date, so
// no single test separates the band from its neighbours: the explicit-member set must be empty (the
// decoys carry srt:RangeAxis min/max), the typed date must be the balance-sheet date plus one day
// (a later band starts a year out), and the caller must additionally confirm the same context
// carries a twelve-month duration. Any one failing withholds the band rather than guessing.
export function typedContextMatches(ctx, spec) {
  if (!ctx || !spec) return false;
  if (Object.keys(ctx.dims).length) return false;
  if ((ctx.typedDims || []).length !== 1) return false;
  const [tm] = ctx.typedDims;
  if (tm.dimension !== spec.axis) return false;
  if (!tm.inner.endsWith(".domain")) return false;
  if (!ctx.instant) return false;
  const start = Date.parse(tm.content);
  if (!Number.isFinite(start)) return false;
  return Math.round((start - Date.parse(ctx.instant)) / 86400000) === 1;
}

export function contextMatches(ctx, dims, kind) {
  if (!ctx || ctx.typed) return false;
  const want = Object.entries(dims);
  const have = Object.entries(ctx.dims);
  if (want.length !== have.length) return false;
  for (const [axis, member] of want) if (ctx.dims[axis] !== member) return false;
  if (kind === "flow") {
    if (!ctx.start || !ctx.end) return false;
    const dur = days(ctx.start, ctx.end);
    return dur >= 350 && dur <= 380;
  }
  return !!ctx.instant;
}

// Duration facts are ix:nonNumeric, not ix:nonFraction, and carry their months as text under an
// ixt-sec:durmonth format. Read narrowly, and only to confirm a band is the twelve-month one.
export function parseDurationMonths(doc, tag) {
  const out = [];
  const re = new RegExp(`<ix:nonNumeric([^>]*name="${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*)>([\\s\\S]*?)<\\/ix:nonNumeric>`, "g");
  let m;
  while ((m = re.exec(doc))) {
    const ctxRef = (m[1].match(/contextRef="([^"]+)"/) || [])[1];
    if (!ctxRef) continue;
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) out.push({ contextRef: ctxRef, months: n });
  }
  return out;
}

// The twelve-month share of remaining performance obligations, as a filed FRACTION. The value is
// never multiplied by the total: Microsoft calls its own figure "approximately", and deriving
// dollars from it would manufacture a precision the filer declined to give.
export function extractBandShare(doc, spec) {
  const contexts = contextsOf(doc);
  const twelveMonth = new Set(
    parseDurationMonths(doc, spec.periodTag).filter((d) => d.months === 12).map((d) => d.contextRef),
  );
  const series = {};
  for (const f of parseFacts(doc, spec.tag)) {
    if (!twelveMonth.has(f.contextRef)) continue; // the same-context twelve-month gate
    const ctx = contexts[f.contextRef];
    if (!typedContextMatches(ctx, spec)) continue;
    if (!(f.value > 0 && f.value <= 1)) continue; // a share, never a count
    series[new Date(ctx.instant).getUTCFullYear()] = f.value;
  }
  return series;
}

// Parsing contexts means a regex sweep of a document that runs to tens of megabytes, and a target
// with four components and four gate inputs asks for the same sweep nine times. Memoised on the
// document itself — the run reads one document at a time, so identity is the whole test.
let ctxDoc = null, ctxCache = null;
function contextsOf(doc) {
  if (doc !== ctxDoc) { ctxDoc = doc; ctxCache = parseContexts(doc); }
  return ctxCache;
}

export function extractSeries(doc, spec) {
  const contexts = contextsOf(doc);
  const series = {};
  for (const f of parseFacts(doc, spec.tag)) {
    const ctx = contexts[f.contextRef];
    if (!contextMatches(ctx, spec.dims, spec.kind)) continue;
    const fy = new Date(spec.kind === "flow" ? ctx.end : ctx.instant).getUTCFullYear();
    series[fy] = f.value; // within one document a (tag, context-shape, year) is single-valued
  }
  return series;
}

// A line the filer prints as several rows and never totals: NextEra's four capital-expenditure
// lines, New Jersey Resources' three "Expenditures for:" rows. ALL OR NOTHING per year — a year
// yields a figure only when every named component is present, because a sum missing a leg is not a
// small error but a different number wearing the total's name. A filer that drops or renames a
// component therefore goes dark for that year, which is the correct outcome: someone must look.
export function extractComponentSum(doc, spec) {
  const parts = spec.components.map((c) => extractSeries(doc, { tag: c.tag, dims: c.dims, kind: spec.kind }));
  const years = new Set(parts.flatMap((p) => Object.keys(p)));
  const out = {};
  for (const fy of years) {
    if (parts.some((p) => p[fy] == null)) continue;
    out[fy] = parts.reduce((sum, p) => sum + p[fy], 0);
  }
  return out;
}

// THE MEMBER CENSUS, and the reason a dimensioned capex read is safe to leave running.
//
// A component read is only the whole line while the filer's component list is the one that was
// mapped. CMS proves the hazard in its own filing: for 2023 it added a second member to the very
// axis this reads, the Covert Generating Station purchase, and a reader that took the ongoing-capex
// member alone as "capital spending" without noticing would have been right — but only because
// somebody classified that member as an acquisition first. Nothing structural distinguishes a new
// acquisition member (correctly excluded) from a new construction member (which would make the
// figure a fragment).
//
// So the registry names EVERY member the filer uses on the axis, and this returns the members a
// document actually carries. Anything unnamed withholds the year rather than guessing which kind
// it is. Single-axis contexts only: a member paired with a legal-entity or consolidation axis is a
// subsidiary's or a segment's column, not the consolidated line.
export function membersOnAxis(doc, tag, axis) {
  const contexts = contextsOf(doc);
  const out = {};
  for (const f of parseFacts(doc, tag)) {
    const ctx = contexts[f.contextRef];
    if (!ctx || ctx.typed || !ctx.start || !ctx.end) continue;
    const dims = Object.entries(ctx.dims);
    if (dims.length !== 1 || dims[0][0] !== axis) continue;
    const dur = days(ctx.start, ctx.end);
    if (dur < 350 || dur > 380) continue;
    (out[new Date(ctx.end).getUTCFullYear()] ||= new Set()).add(dims[0][1]);
  }
  return out;
}

// Gates ----------------------------------------------------------------------------------
const GATES = {
  // Salesforce's extension pair must reconstruct the standard total exactly, or the year is
  // withheld. This is what makes reading a filer's own tag defensible: a silent rename or a
  // change of meaning breaks the identity and produces a blank rather than a wrong number.
  rpoSplitIdentity(lines, gates, W, who) {
    const cur = lines.rpoCurrent;
    if (!cur) return;
    for (const fy of Object.keys(cur)) {
      const nc = gates.noncurrent?.[fy], total = gates.total?.[fy];
      if (nc == null || total == null) { cur[fy] = null; W(`${who} RPO ${fy}: identity inputs missing — withheld`); continue; }
      if (Math.abs(cur[fy] + nc - total) > Math.max(Math.abs(total) * 0.005, 1e6)) {
        cur[fy] = null; W(`${who} RPO ${fy}: current + noncurrent ≠ total — withheld`);
      }
    }
  },

  // CY + PY = total incurred, exact within tolerance — the ratified sign-identity, which at
  // these coordinates has held to the dollar in every mapped year.
  incurredIdentity(lines, gates, W, who) {
    const dev = lines.reserveDevelopmentPriorYear;
    if (!dev) return;
    for (const fy of Object.keys(dev)) {
      const cy = gates.cy?.[fy], total = gates.total?.[fy];
      if (cy == null || total == null) { dev[fy] = null; W(`${who} development ${fy}: identity inputs missing — withheld`); continue; }
      const tol = Math.max(Math.abs(total) * 0.015, 5e6);
      if (Math.abs(cy + dev[fy] - total) > tol) { dev[fy] = null; W(`${who} development ${fy}: fails CY + PY = total — withheld`); }
    }
  },
  // Berkshire's ties (Build 7): the claims liability must agree across THREE independent
  // contexts (balance-sheet column, P&C-ex-retro product member, insurance-group segment member)
  // or the year withholds — and unearned premiums, which share the balance-sheet column and have
  // no second context of their own, withhold with it. Premiums must reconstruct from their two
  // segment members to the filed dollar. A re-tagged filing breaks a tie and produces blanks,
  // never a wrong number — the self-retiring contract every keyhole carries.
  brkInsuranceTies(lines, gates, W, who) {
    const lr = lines.lossReserves;
    if (lr) for (const fy of Object.keys(lr)) {
      if (lr[fy] == null) continue;
      const a = gates.claimsPcExRetro?.[fy], b = gates.claimsSegment?.[fy];
      const tol = Math.max(Math.abs(lr[fy]) * 0.001, 1e6);
      if (a == null || b == null || Math.abs(lr[fy] - a) > tol || Math.abs(lr[fy] - b) > tol) {
        lr[fy] = null;
        if (lines.unearnedPremiums) lines.unearnedPremiums[fy] = null;
        W(`${who} lossReserves ${fy}: the triple cross-context tie fails — year withheld (unearned premiums with it)`);
      }
    }
    const pe = lines.premiumsEarned;
    if (pe) for (const fy of Object.keys(pe)) {
      if (pe[fy] == null) continue;
      const p = gates.premPc?.[fy], l = gates.premLife?.[fy];
      const tol = Math.max(Math.abs(pe[fy]) * 0.005, 5e6);
      if (p == null || l == null || Math.abs(p + l - pe[fy]) > tol) {
        pe[fy] = null;
        W(`${who} premiumsEarned ${fy}: P&C + life members do not reconstruct the total — withheld`);
      }
    }
  },
  // The Wells Fargo double identity: gross − recoveries = net, AND the segment members of the
  // same extension tag sum to its total. Both must hold or the year is withheld.
  wfcDoubleIdentity(lines, gates, W, who) {
    const net = lines.netChargeOffs;
    if (!net) return;
    for (const fy of Object.keys(net)) {
      const g = gates.gross?.[fy], r = gates.rec?.[fy], a = gates.segA?.[fy], b = gates.segB?.[fy];
      const grossNet = g != null && r != null ? Math.abs(g) - Math.abs(r) : null;
      const segSum = a != null && b != null ? a + b : null;
      const tol = Math.max(Math.abs(net[fy]) * 0.01, 2e6);
      if (grossNet == null || Math.abs(grossNet - net[fy]) > tol) { net[fy] = null; W(`${who} netChargeOffs ${fy}: gross − recoveries misses net — withheld`); continue; }
      if (segSum == null || Math.abs(segSum - net[fy]) > tol) { net[fy] = null; W(`${who} netChargeOffs ${fy}: segment members miss the total — withheld`); }
    }
  },
  // THE CAPEX DOUBLE IDENTITY — the Wells Fargo bar, applied to DTE and NextEra, whose printed
  // capital-expenditure lines exist only on their own extension elements.
  //
  //   1. the components read into capex, plus any acquisition the filer prints on its OWN separate
  //      line (a "carve" gate input), must equal the filer's independently tagged capital-spending
  //      total; and
  //   2. that same total's segment members must sum to it.
  //
  // Two proofs from two different parts of the filing — the face of the cash-flow statement and the
  // segment note — so a silent rename, a change of scope, or a new line the mapping never saw
  // breaks one of them and the year goes dark instead of wrong. Tolerance is two-tenths of one
  // percent, which is looser than the exact ties observed and tight enough that no real component
  // could hide inside it.
  //
  // A carve input that is simply ABSENT reads as zero, and correctly: these filers print the row
  // only in the years they made the acquisition. If instead the acquisition happened and the tag
  // went missing, identity 1 fails by the whole acquisition and the year is withheld.
  capexDoubleIdentity(lines, gates, W, who) {
    const capex = lines.capex;
    if (!capex) return;
    const segKeys = Object.keys(gates).filter((k) => k.startsWith("seg"));
    const carveKeys = Object.keys(gates).filter((k) => k.startsWith("carve"));
    for (const fy of Object.keys(capex)) {
      if (capex[fy] == null) continue;
      const total = gates.total?.[fy];
      if (total == null) { capex[fy] = null; W(`${who} capex ${fy}: the filer's own capital-spending total is missing — withheld`); continue; }
      const tol = Math.max(Math.abs(total) * 0.002, 1e6);
      const carve = carveKeys.reduce((sum, k) => sum + (gates[k]?.[fy] ?? 0), 0);
      if (Math.abs(capex[fy] + carve - total) > tol) {
        capex[fy] = null;
        W(`${who} capex ${fy}: components + carve-outs (${capex[fy]} + ${carve}) miss the filer's own total ${total} — withheld`);
        continue;
      }
      const segs = segKeys.map((k) => gates[k]?.[fy]);
      if (!segs.length || segs.some((v) => v == null)) { capex[fy] = null; W(`${who} capex ${fy}: segment members missing — withheld`); continue; }
      const segSum = segs.reduce((a, b) => a + b, 0);
      if (Math.abs(segSum - total) > tol) { capex[fy] = null; W(`${who} capex ${fy}: segment members sum to ${segSum} against a total of ${total} — withheld`); }
    }
  },
};

// The census verdict, run before any named gate: a year whose axis carries a member the registry
// never classified is withheld outright. See membersOnAxis for why this is the load-bearing gate on
// a component read rather than a formality.
function applyCensus(lines, seen, known, W, who) {
  const capex = lines.capex;
  if (!capex || !seen) return;
  const allowed = new Set(known);
  for (const fy of Object.keys(capex)) {
    if (capex[fy] == null) continue;
    const members = seen[fy];
    if (!members) { capex[fy] = null; W(`${who} capex ${fy}: no members read on the census axis — withheld`); continue; }
    const strangers = [...members].filter((m) => !allowed.has(m));
    if (strangers.length) {
      capex[fy] = null;
      W(`${who} capex ${fy}: unclassified member(s) on the capex axis — ${strangers.join(", ")} — withheld until someone decides whether that is plant built or plant bought`);
    }
  }
}

async function main() {
  const outPath = path.join(dataDir, "dimensional.json");
  const result = {};
  const warns = [];
  const W = (s) => { warns.push(s); console.warn(`  ! ${s}`); };

  // ONLY_DIM=CMS,DTE re-reads just those targets and CARRIES EVERY OTHER FILER OVER from the last
  // good file, the same shape ONLY_FUND has in the Tier-1 fetcher. Adding one target should not
  // cost an hour of re-reading Wells Fargo's twelve-megabyte document set, and a partial run must
  // never truncate the catalog — the merge below is what makes both true. Blank = the whole
  // registry plus the band sweep, as before.
  const only = (process.env.ONLY_DIM || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}

  // The curated registry, then the band sweep over the software shelf. The sweep is skipped when
  // the shelf cannot be resolved, so a missing data file degrades to the registry rather than
  // failing the run.
  let sweep = [];
  try {
    const pool = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8")).companies || [];
    const named = new Set(TARGETS.map((t) => t.ticker));
    sweep = bandSweepTargets(pool.filter((c) => !named.has(c.ticker)));
    console.log(`Band sweep: ${sweep.length} contracted-revenue filers beyond the registry.`);
  } catch (e) { console.warn(`  ! band sweep skipped (${e.message})`); }

  let plan = [...TARGETS, ...sweep];
  if (only.length) {
    plan = plan.filter((t) => only.includes(String(t.ticker).toUpperCase()));
    if (!plan.length) { console.warn(`  ! ONLY_DIM=${only.join(",")} named nobody in the registry — refusing to run a no-op that would rewrite the file.`); return; }
    console.log(`Scoped run: ${plan.map((t) => t.ticker).join(", ")} (${Object.keys(prior).length} filers carried over untouched).`);
  }

  for (const t of plan) {
    console.log(`\n${t.ticker}:`);
    const sub = await getJSON(`https://data.sec.gov/submissions/CIK${t.cik}.json`);
    // A heavy filer's 10-Ks fall out of the `recent` window fast (Wells Fargo files prospectus
    // supplements daily), so walk the paginated submission files until enough 10-Ks are found.
    const tenKs = [];
    const harvest = (r) => {
      for (let i = 0; i < r.form.length && tenKs.length < t.filings; i++) {
        if (r.form[i] === "10-K") tenKs.push({ accn: r.accessionNumber[i], doc: r.primaryDocument[i] });
      }
    };
    harvest(sub.filings.recent);
    for (const page of sub.filings.files || []) {
      if (tenKs.length >= t.filings) break;
      await sleep(THROTTLE_MS);
      const older = await getJSON(`https://data.sec.gov/submissions/${page.name}`);
      harvest(older);
    }
    const lines = {}; const gates = {}; const census = {};
    // Oldest first, newer filings overwrite: the latest filing's value wins a year (the mapping
    // verified cross-filing equality at every target).
    for (const f of tenKs.reverse()) {
      await sleep(THROTTLE_MS);
      const base = `https://www.sec.gov/Archives/edgar/data/${Number(t.cik)}/${f.accn.replace(/-/g, "")}`;
      // An inline-XBRL 10-K can be a multi-part document set (Wells Fargo's primary document is
      // the cover part; the statements live in a 12MB sibling). Read every substantive .htm part
      // of the set — source documents, never the SEC viewer's rendered R-files — concatenated,
      // so contexts defined in one part resolve facts in another.
      let doc;
      try {
        const idx = await getJSON(`${base}/index.json`);
        const parts = (idx.directory?.item || [])
          .filter((x) => x.name.endsWith(".htm") && !/^R\d+\.htm$/i.test(x.name) && Number(x.size) > 200_000)
          .map((x) => x.name);
        const names = parts.length ? parts : [f.doc];
        const texts = [];
        for (const name of names) { await sleep(THROTTLE_MS); texts.push(await getText(`${base}/${name}`)); }
        doc = texts.join("\n");
      } catch (e) { W(`${t.ticker} ${f.accn}: fetch failed (${e.message}) — filing skipped`); continue; }
      for (const spec of t.lines || []) {
        const s = spec.components ? extractComponentSum(doc, spec) : extractSeries(doc, spec);
        lines[spec.line] = { ...(lines[spec.line] || {}), ...s };
      }
      for (const spec of t.bands || []) {
        const s = extractBandShare(doc, spec);
        lines[spec.line] = { ...(lines[spec.line] || {}), ...s };
      }
      for (const spec of t.gateInputs || []) {
        const s = extractSeries(doc, spec);
        gates[spec.name] = { ...(gates[spec.name] || {}), ...s };
      }
      // The census is a UNION across filings, never an overwrite: a member that appeared in the
      // year's original filing counts against that year even if a later filing's comparative
      // column drops it.
      if (t.census) {
        for (const [fy, members] of Object.entries(membersOnAxis(doc, t.census.tag, t.census.axis))) {
          census[fy] = new Set([...(census[fy] || []), ...members]);
        }
      }
      console.log(`  ${f.accn} read`);
    }
    if (t.census) applyCensus(lines, census, t.census.known, W, t.ticker);
    if (t.gate) GATES[t.gate](lines, gates, W, t.ticker);
    for (const [line, series] of Object.entries(lines)) {
      const kept = Object.fromEntries(Object.entries(series).filter(([, v]) => v != null));
      if (Object.keys(kept).length) (result[t.ticker] ||= {})[line] = kept;
    }
    console.log(`  lines: ${Object.entries(result[t.ticker] || {}).map(([l, s]) => `${l}(${Object.keys(s).length}y)`).join(", ") || "none"}`);
  }

  // A scoped run replaces only what it re-read; a full run stands on its own. Either way a filer
  // this run PROVED it could no longer see is dropped rather than carried, because the gates'
  // withholds must be able to take a figure off the record as well as keep one on it.
  const companies = only.length ? { ...prior, ...result } : result;
  for (const t of plan) if (!result[t.ticker]) delete companies[t.ticker];
  // Share-class mirrors: one registrant, one document read, two pool rows. The mirror is applied
  // at write time so the registry never fetches the same 10MB filing twice, and it follows the
  // source ticker wherever the merge carries it (a run that drops BRK-A drops BRK-B with it).
  const MIRRORS = { "BRK-B": "BRK-A" };
  for (const [alias, src] of Object.entries(MIRRORS)) {
    if (companies[src]) companies[alias] = companies[src];
    else delete companies[alias];
  }
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC inline-XBRL 10-K instances: named dimensional targets, mapped and value-verified before entry (docs desk surveys; run wf_402f292f)", companies };
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, compactJson(out));
  fs.renameSync(tmp, outPath);
  console.log(`\n✅ dimensional: ${Object.keys(companies).length} filers (${Object.keys(result).length} re-read); ${warns.length} warnings`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
