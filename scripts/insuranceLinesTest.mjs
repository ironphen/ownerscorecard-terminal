// insuranceLinesTest.mjs — case law for the insurance desk's Wave A extraction
// (scripts/insuranceLines.mjs; spec at docs/insurance-desk-survey.md, ratified 2026-07-21).
//
// The rules under test: tag-succession seams stitch ONLY through the overlap-equality gate (a
// disagreeing predecessor is dropped whole, never spliced); signed facts keep their filed sign;
// a partial-scope premiums-written series (the Assurant case) is withheld by the written/earned
// band; negative receivables are nulled; the DAC+VOBA fallback carries its impurity flag; the
// policyholder-deposit element map picks the filer's longest-lived element; net reserves may not
// exceed gross; and the claims rollforward fills only a series it has proven identical to.
import { insuranceLines, fillClaimsFromRollforward, stitchGenerations, hasInsuranceData } from "./insuranceLines.mjs";

let failed = 0;
const t = (name, ok, got) => { if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); } else console.log(`ok ${name}`); };

// Build a minimal companyfacts object. flows: durations ~1y; instants: end only.
const FY = (y) => ({ start: `${y}-01-01`, end: `${y}-12-31` });
const flowFact = (vals) => ({ units: { USD: Object.entries(vals).map(([y, val]) => ({ ...FY(+y), val, form: "10-K", filed: `${+y + 1}-02-15` })) } });
const instFact = (vals) => ({ units: { USD: Object.entries(vals).map(([y, val]) => ({ end: `${y}-12-31`, val, form: "10-K", filed: `${+y + 1}-02-15` })) } });
const facts = (tags) => ({ facts: { "us-gaap": tags } });

// --- the seam gate itself ---
{
  const agree = stitchGenerations([{ 2022: 100, 2023: 110 }, { 2019: 80, 2020: 90, 2022: 100 }], { label: "x", absFloor: 0 });
  t("agreeing generations stitch (older fills the early years)", agree.series[2019] === 80 && agree.series[2023] === 110 && agree.warns.length === 0, agree);
  const clash = stitchGenerations([{ 2022: 100, 2023: 110 }, { 2019: 80, 2022: 250 }], { label: "x", absFloor: 0 });
  t("a majority-disagreeing predecessor is dropped whole, with a warning", clash.series[2019] === undefined && clash.warns.length === 1, clash);
  // The contested-year shape (the cross-tag CECL backfill): the generations agree except at one
  // old year the newer tag restated. Three scopes can contest such a year (BAC's 2019 allowance:
  // 9.416B loans-only, 10.229B with the off-BS reserve, 12.358B day-one backfill) — the year is
  // withheld, never adjudicated blind, and the agreeing years still splice.
  const backfill = stitchGenerations([
    { 2019: 12.358e9, 2020: 18.8e9, 2021: 12.1e9 },
    { 2017: 10.4e9, 2019: 9.416e9, 2020: 18.8e9, 2021: 12.1e9 },
  ], { label: "x" });
  t("a contested cross-era year is withheld while the agreeing years splice", backfill.series[2019] == null && backfill.series[2017] === 10.4e9 && backfill.series[2020] === 18.8e9, backfill.series);
  t("the contested year is stated", backfill.warns.some((w) => w.includes("cross-era values conflict")), backfill.warns);
}

// --- development: sign preserved, predecessor stitched through the deprecation seam ---
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2013: 900, 2023: 1000, 2024: 1100 }),
    SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense: flowFact({ 2016: -40e6, 2023: -55e6, 2024: 30e6 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaimsPriorYears: flowFact({ 2013: -20e6, 2016: -40e6 }),
  });
  const { flows } = insuranceLines(f);
  const dev = flows.reserveDevelopmentPriorYear;
  t("development keeps the filed sign (negative favorable, positive unfavorable)", dev[2023] === -55e6 && dev[2024] === 30e6, dev);
  t("the predecessor extends the series through the deprecation seam (overlap agreed)", dev[2013] === -20e6, dev);
}

// --- premiums written: the partial-scope withhold (the Assurant case) ---
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2021: 10000, 2022: 10200, 2023: 10400, 2024: 10500 }),
    SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPremiumsWritten: flowFact({ 2021: 3500, 2022: 3600, 2023: 3600, 2024: 3600 }),
  });
  const { flows, flags } = insuranceLines(f);
  t("a P&C-sliver written series against enterprise earned is withheld", flows.premiumsWrittenNet === undefined, flows.premiumsWrittenNet);
  t("the withhold is stated in the warnings", (flags.warns || []).some((w) => w.includes("partial-scope")), flags.warns);
}
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2022: 10000, 2023: 10500, 2024: 11000 }),
    PremiumsWrittenNet: flowFact({ 2022: 10400, 2023: 10900, 2024: 11500 }),
  });
  const { flows } = insuranceLines(f);
  t("a whole-enterprise written series passes the band", flows.premiumsWrittenNet?.[2024] === 11500, flows.premiumsWrittenNet);
}

// --- receivable sign gate, net-vs-gross gate, DAC impurity flag ---
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2023: 1000, 2024: 1100 }),
    PremiumsReceivableAtCarryingValue: instFact({ 2023: 500e6, 2024: -30e6 }),
    LiabilityForClaimsAndClaimsAdjustmentExpense: instFact({ 2023: 900e6, 2024: 950e6 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet: instFact({ 2023: 700e6, 2024: 1200e6 }),
    DeferredPolicyAcquisitionCostsAndValueOfBusinessAcquired: instFact({ 2023: 80e6, 2024: 85e6 }),
  });
  const { instants, flags } = insuranceLines(f);
  t("a negative premiums receivable is nulled, the clean year kept", instants.premiumsReceivable[2023] === 500e6 && instants.premiumsReceivable[2024] == null, instants.premiumsReceivable);
  t("net reserves exceeding gross are nulled for that year", instants.lossReservesNet[2023] === 700e6 && instants.lossReservesNet[2024] == null, instants.lossReservesNet);
  t("the DAC+VOBA fallback carries its impurity flag", instants.dacBalance[2024] === 85e6 && flags.dacIncludesVoba === true, flags);
}

// --- policyholder deposits: the filer's element is the longest series; eras merge only when overlap agrees ---
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2023: 1000, 2024: 1100 }),
    PolicyholderContractDeposits: instFact({ 2019: 100e9, 2020: 105e9, 2021: 108e9, 2022: 110e9 }),
    PolicyholderFunds: instFact({ 2021: 108e9, 2022: 110e9, 2023: 112e9 }),
  });
  const { instants } = insuranceLines(f);
  const d = instants.policyholderDeposits;
  t("the longest-lived element is primary and the agreeing sibling extends it", d[2019] === 100e9 && d[2023] === 112e9, d);
}

// --- separate accounts: the pass-through identity is checked, the liability is the line ---
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2024: 1000 }),
    SeparateAccountsLiability: instFact({ 2024: 180e9 }),
    SeparateAccountAssets: instFact({ 2024: 180.5e9 }),
  });
  const { instants, flags } = insuranceLines(f);
  t("separate accounts extract as the liability, identity within tolerance", instants.separateAccountsLiability[2024] === 180e9 && !(flags.warns || []).length, flags.warns);
}

// --- F2: the rollforward fills only a proven-identical claims series ---
{
  const f = facts({
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1: flowFact({ 2022: 400e6, 2023: 420e6, 2024: 450e6 }),
  });
  const { filled, usedRollforward } = fillClaimsFromRollforward({ 2022: 400e6, 2023: 420e6 }, f);
  t("an overlap-verified rollforward fills the dark year", usedRollforward === true && filled[2024] === 450e6, filled);
  const noAgree = fillClaimsFromRollforward({ 2022: 900e6, 2023: 950e6 }, f);
  t("a rollforward that never matched the series fills nothing", noAgree.usedRollforward === false && noAgree.filled[2024] == null, noAgree.filled);
}

// --- the LDTI-transition trap (hostile verify, 2026-07-21): a restatement filing tags an
// OPENING-balance instant (Jan-1 transition date, or a Q1 balance in a 10-K/A) with a later
// filed date. The year's balance is its LAST instant; MetLife's FY2021 FPB must read the
// 2021-12-31 balance, never the later-filed 2021-01-01 transition figure.
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2021: 1000, 2022: 1100 }),
    LiabilityForFuturePolicyBenefits: { units: { USD: [
      { end: "2021-12-31", val: 199.7e9, form: "10-K", filed: "2022-02-18" },
      { end: "2021-01-01", val: 224.4e9, form: "10-K", filed: "2024-02-16" },
      { end: "2021-03-31", val: 210e9, form: "10-K/A", filed: "2023-03-30" },
      { end: "2022-12-31", val: 187.2e9, form: "10-K", filed: "2023-02-23" },
    ] } },
  });
  const { instants } = insuranceLines(f);
  t("an opening-balance or Q1 instant never beats the year-end balance", instants.futurePolicyBenefits[2021] === 199.7e9 && instants.futurePolicyBenefits[2022] === 187.2e9, instants.futurePolicyBenefits);
}
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2021: 1000 }),
    UnearnedPremiums: { units: { USD: [
      { end: "2021-12-31", val: 10e9, form: "10-K", filed: "2022-02-18" },
      { end: "2021-12-31", val: 10.2e9, form: "10-K", filed: "2023-02-20" },
    ] } },
  });
  const { instants } = insuranceLines(f);
  t("a restated YEAR-END balance still wins on filed date", instants.unearnedPremiums[2021] === 10.2e9, instants.unearnedPremiums);
}

// --- the fill gate anchors on the seam-adjacent year: older overlap drift does not qualify ---
{
  const f = facts({
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1: flowFact({ 2016: 411e6, 2022: 400e6, 2023: 425e6, 2024: 450e6 }),
  });
  const r = fillClaimsFromRollforward({ 2016: 410e6, 2022: 400e6, 2023: 420e6 }, f);
  t("a seam year off by >1% blocks the fill even when an older year agrees", r.usedRollforward === false, r);
}

// --- the fiscal-calendar pin (banks desk F2, applied here too): when the company's calendar is
// known, a dead tag's mid-year balance is not that year's value — it is dropped, and the year
// reads honestly null rather than carrying a June balance as December's.
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2019: 1000, 2020: 1000 }),
    UnearnedPremiums: { units: { USD: [
      { end: "2019-12-31", val: 9e9, form: "10-K", filed: "2020-02-20" },
      { end: "2020-06-30", val: 9.4e9, form: "10-K", filed: "2021-02-20" },
    ] } },
  });
  const fyEnds = { 2019: "2019-12-31", 2020: "2020-12-31" };
  const { instants } = insuranceLines(f, fyEnds);
  t("a dead tag's mid-year balance is dropped under the calendar pin", instants.unearnedPremiums[2019] === 9e9 && instants.unearnedPremiums[2020] == null, instants.unearnedPremiums);
  const unpinned = insuranceLines(f);
  t("without a known calendar the old latest-end rule still reads the tag", unpinned.instants.unearnedPremiums[2020] === 9.4e9, unpinned.instants.unearnedPremiums);
}

// --- the sign-integrity gate (managed-care desk F1, ratified 2026-07-21): the filer's own
// identity (current-year incurred + prior-year development = total incurred) arbitrates every
// sign. Elevance shipped six favorable years as adverse; the identity flips them; a year the
// identity rejects both ways is withheld; an identity-less cross-filing sign conflict resolves
// only to a proven regime.
{
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2020: 1000, 2021: 1050, 2022: 1100 }),
    // Filed development: 2020-21 wrong-sign-positive (favorable filed as +), 2022 correct-negative.
    SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense: flowFact({ 2020: 40e6, 2021: 35e6, 2022: -30e6 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1: flowFact({ 2020: 960e6, 2021: 1015e6, 2022: 1070e6 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaimsCurrentYear: flowFact({ 2020: 1000e6, 2021: 1050e6, 2022: 1100e6 }),
  });
  const { flows, flags } = insuranceLines(f);
  const dev = flows.reserveDevelopmentPriorYear;
  t("the identity flips a wrong-sign year (the ELV shape)", dev[2020] === -40e6 && dev[2021] === -35e6, dev);
  t("a correctly signed year stands", dev[2022] === -30e6, dev);
  t("the repair is stated", (flags.warns || []).some((w) => w.includes("sign repaired")), flags.warns);
}
{
  // A year failing the identity both ways is withheld.
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2022: 1000 }),
    SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense: flowFact({ 2022: -30e6 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1: flowFact({ 2022: 1070e6 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaimsCurrentYear: flowFact({ 2022: 900e6 }),
  });
  const { flows, flags } = insuranceLines(f);
  t("a year the identity rejects both ways is withheld", flows.reserveDevelopmentPriorYear[2022] == null, flows.reserveDevelopmentPriorYear);
  t("the withhold is stated", (flags.warns || []).some((w) => w.includes("fails the incurred identity")), flags.warns);
}
{
  // The PDR wrinkle: an identity missing by a fraction of a percent (UNH's 672M inside ~314B)
  // stays as-filed under the tolerance.
  const f = facts({
    PremiumsEarnedNet: flowFact({ 2025: 352e9 }),
    SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense: flowFact({ 2025: -1.4e9 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1: flowFact({ 2025: 314e9 }),
    LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaimsCurrentYear: flowFact({ 2025: 314.728e9 }),
  });
  const { flows } = insuranceLines(f);
  t("a PDR-sized identity residual stays within tolerance (as filed)", flows.reserveDevelopmentPriorYear[2025] === -1.4e9, flows.reserveDevelopmentPriorYear);
}

// --- the entry ticket: no premiums, no insurance lines ---
t("a non-insurer is untouched", hasInsuranceData(facts({ Revenues: flowFact({ 2024: 5e9 }) })) === false);

if (failed) { console.error(`\n❌ insuranceLinesTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ insuranceLinesTest passed.");
