// insurerFloatTest.mjs — case law for the float arithmetic (src/lib/insurers.mjs floatOf/
// costOfFloat/spreadOverCrediting; ratified spec docs/insurance-desk-survey.md §3).
//
// The rules under test: the claims stack leads wherever it is the larger book (Chubb routes P&C
// despite carrying life reserves); the P&C deduction side is REQUIRED (the AIG withhold); a heavy
// cedent without prepaid reinsurance is withheld rather than shown gross (the Assurant/NODK
// withhold); the life formula never sums the combined liability with net reserves; cost of float
// is negative when underwriting profits pay the company to hold the money; the life spread is
// published only on a life-basis float.
import { floatOf, costOfFloat, spreadOverCrediting } from "../src/lib/insurers.mjs";

let failed = 0;
const t = (name, ok, got) => { if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); } else console.log(`ok ${name}`); };

// A Chubb-shaped mixed book: big claims stack, smaller life book riding along — routes P&C,
// with every component in the sum.
const CBish = {
  lossReservesNet: 60e9, unearnedPremiums: 26e9, prepaidReinsurance: 4e9,
  futurePolicyBenefits: 18e9, policyholderDeposits: 9e9,
  premiumsReceivable: 12e9, dacBalance: 4e9,
  premiumsEarned: 45e9, lossesAndExpenses: 42e9, investmentIncome: 6e9,
};
{
  const f = floatOf(CBish);
  t("a mixed book with the claims stack leading routes P&C", f?.basis === "pc", f);
  t("the P&C sum carries every component", f && Math.abs(f.value - (60e9 + 22e9 + 18e9 + 9e9 - 12e9 - 4e9)) < 1, f?.value);
  const cof = costOfFloat(CBish);
  t("an underwriting profit makes the cost of float negative (paid to hold)", cof != null && cof < 0, cof);
  t("no life spread prints on a P&C-basis float", spreadOverCrediting(CBish) === null);
}

// The AIG withhold: deduction side missing → no float, never an overstated one.
t("a P&C book without its receivable deduction is withheld", floatOf({ ...CBish, premiumsReceivable: null }) === null);
t("a P&C book without its DAC deduction is withheld", floatOf({ ...CBish, dacBalance: null }) === null);

// The cedent gate: heavy ceding with prepaid reinsurance untagged → withheld, not gross.
{
  const cedent = { ...CBish, prepaidReinsurance: null, cededPremiumsWritten: 20e9 };
  t("a heavy cedent without prepaid reinsurance is withheld", floatOf(cedent) === null);
  const lightCedent = { ...CBish, prepaidReinsurance: null, cededPremiumsWritten: 2e9 };
  t("a light cedent computes without the prepaid line", floatOf(lightCedent)?.basis === "pc", floatOf(lightCedent));
}

// A MetLife-shaped life book: FPB leads, deposits and MRB add, separate accounts never enter,
// and the spread publishes against the life basis.
const METish = {
  lossReservesNet: 16e9, futurePolicyBenefits: 190e9, policyholderDeposits: 230e9,
  marketRiskBenefits: 10e9, unearnedPremiums: 1.6e9,
  reinsuranceRecoverables: 13e9, dacBalance: 5e9, premiumsReceivable: null,
  investmentIncome: 22e9, interestCredited: 8e9,
  separateAccountsLiability: 152e9,
  premiumsEarned: 44e9,
};
{
  const f = floatOf(METish);
  t("a life-led book routes to the life formula", f?.basis === "life", f);
  t("separate accounts never enter the float", f && f.value < 440e9, f?.value);
  t("a missing life deduction is named, not silently skipped", f?.notes.some((n) => n.includes("receivables")), f?.notes);
  const spr = spreadOverCrediting(METish);
  t("the life spread is investment income less crediting, over the float", spr != null && spr > 0.02 && spr < 0.05, spr);
  t("no P&C cost of float prints on a life basis", costOfFloat(METish) === null);
}

// The combined liability stands alone — never summed with net reserves (the double-count guard).
{
  const combinedOnly = {
    fpbCombined: 41e9, policyholderDeposits: 111e9,
    reinsuranceRecoverables: 28e9, dacBalance: 2e9, premiumsReceivable: 1e9,
  };
  const f = floatOf(combinedOnly);
  t("the combined liability is the base where only it is filed", f && Math.abs(f.value - (41e9 + 111e9 - 28e9 - 2e9 - 1e9)) < 1, f?.value);
}

// THE RESERVE-DOMINANCE FENCE (solvency-sight survey, 2026-08-05). A P&C-shaped book whose
// Formula-A deduction legs are missing must WITHHOLD, never fall through to a life-basis print:
// Hartford showed "Float $4.8B" against $46.3B gross loss reserves, Cincinnati Financial $3.8B
// against $11.5B, and Berkshire $17.9B against the ~$171B its own letter states. Wrong is worse
// than missing, and these were wrong 3x-10x.
{
  // HIG-shaped: big gross reserves, recoverables unextracted (net underivable), tiny FPB.
  const HIGish = { lossReserves: 46e9, futurePolicyBenefits: 0.44e9, policyholderDeposits: 0.6e9, unearnedPremiums: 8e9, dacBalance: 1e9 };
  t("gross reserves exceeding the life base refuse the life formula (HIG-shaped)", floatOf(HIGish) === null, floatOf(HIGish));
  // CINF-shaped: combined liability filed, gross reserves dwarf it.
  const CINFish = { lossReserves: 11.4e9, fpbCombined: 3e9, policyholderDeposits: 0.8e9 };
  t("gross reserves exceeding a combined-liability base refuse it too (CINF-shaped)", floatOf(CINFish) === null, floatOf(CINFish));
  // A genuine life book with a small claims stack riding along still routes life.
  const genuineLife = { lossReserves: 6e9, futurePolicyBenefits: 190e9, policyholderDeposits: 230e9, reinsuranceRecoverables: 13e9, dacBalance: 5e9, premiumsReceivable: 2e9 };
  t("a genuine life book with a small claims stack still routes life", floatOf(genuineLife)?.basis === "life", floatOf(genuineLife));
  // The coherence belt: a life-basis value below gross reserves is mechanically impossible.
  const impossible = { lossReserves: 30e9, futurePolicyBenefits: 35e9, reinsuranceRecoverables: 20e9, dacBalance: 8e9, premiumsReceivable: 5e9 };
  t("a life-basis float below the filer's own gross reserves withholds (coherence belt)", floatOf(impossible) === null, floatOf(impossible));
}

// The reserves-only fallback prefers NET and reports its basis, so the caller's note can state
// the true error direction (net understates; gross on a reinsured book overstates — AIG's shown
// fallback moves $70.7B→$41.8B under this rule).
{
  const { insuranceFloat } = await import("../src/lib/insurers.mjs");
  const aigish = { lossReserves: 70.7e9, reinsuranceRecoverables: 28.9e9 };
  const f = insuranceFloat(aigish);
  t("the fallback derives net where recoverables exist", f?.basis === "net" && Math.abs(f.value - 41.8e9) < 0.1e9, f);
  const grossOnly = { lossReserves: 10e9 };
  t("gross-only fallback declares its basis", insuranceFloat(grossOnly)?.basis === "gross", insuranceFloat(grossOnly));
  t("no reserves at all is null, not zero", insuranceFloat({}) === null);
}

if (failed) { console.error(`\n❌ insurerFloatTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ insurerFloatTest passed.");
