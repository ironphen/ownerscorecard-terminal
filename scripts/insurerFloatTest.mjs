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

if (failed) { console.error(`\n❌ insurerFloatTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ insurerFloatTest passed.");
