// banksLinesTest.mjs — case law for the banks desk's Wave A extraction (scripts/banksLines.mjs;
// spec at docs/banks-desk-survey.md, ratified 2026-07-21).
//
// The rules under test: the NIB + IB = Deposits identity nulls mixed-scope years; the money-center
// domestic+foreign pair sums into the aggregate chain; a demand-only de novo is labeled demand,
// never presented as NIB; net charge-offs respect the magnitude gate (the JPM PCI-subset trap) and
// the recoveries ceiling; the CECL adoption seam prefers the year's own filing over a later
// re-tagged day-one balance; a subtotal-mixing series (the nonaccrual volatility shape) is
// withheld whole; the HTM cost-minus-FV identity is checked against the tagged loss; the spread
// legs must close II − IE = NII or both null; CET1 reads pure-unit inside a plausibility band.
import { banksLines, hasBankData } from "./banksLines.mjs";

let failed = 0;
const t = (name, ok, got) => { if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); } else console.log(`ok ${name}`); };

const FY = (y) => ({ start: `${y}-01-01`, end: `${y}-12-31` });
const flowFact = (vals) => ({ units: { USD: Object.entries(vals).map(([y, val]) => ({ ...FY(+y), val, form: "10-K", filed: `${+y + 1}-02-15` })) } });
const instFact = (vals, unit = "USD") => ({ units: { [unit]: Object.entries(vals).map(([y, val]) => ({ end: `${y}-12-31`, val, form: "10-K", filed: `${+y + 1}-02-15` })) } });
const facts = (tags) => ({ facts: { "us-gaap": tags } });
const CAL = { 2018: "2018-12-31", 2019: "2019-12-31", 2020: "2020-12-31", 2021: "2021-12-31", 2022: "2022-12-31", 2023: "2023-12-31", 2024: "2024-12-31" };

const CORE = {
  Deposits: instFact({ 2023: 2300e9, 2024: 2400e9 }),
  InterestIncomeExpenseNet: flowFact({ 2023: 90e9, 2024: 93e9 }),
};

// --- entry ticket ---
t("a deposit-funded lender qualifies", hasBankData(facts(CORE), CAL) === true);
t("a non-bank does not", hasBankData(facts({ Revenues: flowFact({ 2024: 5e9 }) }), CAL) === false);

// --- the deposit franchise ---
{
  const f = facts({
    ...CORE,
    NoninterestBearingDepositLiabilitiesDomestic: instFact({ 2023: 580e9, 2024: 600e9 }),
    NoninterestBearingDepositLiabilitiesForeign: instFact({ 2023: 20e9, 2024: 19e9 }),
    InterestBearingDepositLiabilitiesDomestic: instFact({ 2023: 1500e9, 2024: 1581e9 }),
    InterestBearingDepositLiabilitiesForeign: instFact({ 2023: 200e9, 2024: 200e9 }),
  });
  const { instants } = banksLines(f, CAL);
  t("the money-center domestic+foreign pair sums into NIB", instants.noninterestBearingDeposits?.[2024] === 619e9, instants.noninterestBearingDeposits);
  t("the NIB + IB = Deposits identity holds and both lines ship", instants.interestBearingDeposits?.[2024] === 1781e9, instants.interestBearingDeposits);
}
{
  const f = facts({
    ...CORE,
    NoninterestBearingDepositLiabilities: instFact({ 2023: 500e9, 2024: 900e9 }),
    InterestBearingDepositLiabilities: instFact({ 2023: 1800e9, 2024: 1800e9 }),
  });
  const { instants, flags } = banksLines(f, CAL);
  t("a year failing the deposits identity by >2% is nulled", instants.noninterestBearingDeposits?.[2023] === 500e9 && instants.noninterestBearingDeposits?.[2024] == null, instants.noninterestBearingDeposits);
  t("the identity failure is stated", (flags.warns || []).some((w) => w.includes("misses total deposits")), flags.warns);
}
{
  const f = facts({ ...CORE, DemandDepositAccounts: instFact({ 2024: 1.2e9 }) });
  const { instants, flags } = banksLines(f, CAL);
  t("a demand-only de novo is labeled demand, never NIB", instants.demandDeposits?.[2024] === 1.2e9 && instants.noninterestBearingDeposits === undefined && flags.nibIsDemand === true, flags);
}

// --- the credit cycle ---
{
  const f = facts({
    ...CORE,
    LoansAndLeasesReceivableNetOfDeferredIncome: instFact({ 2018: 900e9, 2019: 950e9, 2020: 980e9, 2023: 1200e9, 2024: 1300e9 }),
    // The PCI trap: a FY2019 write-off fact ~30x below reality beside honest years.
    FinancingReceivableAllowanceForCreditLossesWriteOffs: flowFact({ 2018: 5e9, 2019: 0.15e9, 2020: 6e9 }),
    FinancingReceivableAllowanceForCreditLossesRecoveriesOfBadDebts: flowFact({ 2018: 1e9, 2019: 0.02e9, 2020: 1.1e9 }),
  });
  const { flows, flags } = banksLines(f, CAL);
  t("honest NCO years compute as write-offs less recoveries", flows.netChargeOffs?.[2018] === 4e9 && flows.netChargeOffs?.[2020] === 4.9e9, flows.netChargeOffs);
  t("a PCI-subset year fails the magnitude gate and is withheld", flows.netChargeOffs?.[2019] == null && (flags.warns || []).some((w) => w.includes("netChargeOffs 2019")), flows.netChargeOffs);
}
{
  // The CECL adoption seam: 2019-12-31 carries the year's own 9.416B and a later filing's
  // re-tagged 12.358B day-one balance. The year's own filing wins.
  const f = facts({
    ...CORE,
    LoansAndLeasesReceivableNetOfDeferredIncome: instFact({ 2019: 950e9, 2020: 980e9 }),
    LoansAndLeasesReceivableAllowance: { units: { USD: [
      { end: "2019-12-31", val: 9.416e9, form: "10-K", filed: "2020-02-20" },
      { end: "2019-12-31", val: 12.358e9, form: "10-K", filed: "2021-02-20" },
      { end: "2020-12-31", val: 18.8e9, form: "10-K", filed: "2021-02-20" },
    ] } },
  });
  const { instants, flags } = banksLines(f, CAL);
  t("the adoption seam prefers the year's own filing over the re-tagged day-one balance", instants.allowanceForCreditLosses?.[2019] === 9.416e9, instants.allowanceForCreditLosses);
  t("the conflict is reported", (flags.warns || []).some((w) => w.includes("multi-value date")), flags.warns);
}
{
  // The subtotal-mixing shape: a nonaccrual series alternating thousands and millions.
  const f = facts({
    ...CORE,
    LoansAndLeasesReceivableNetOfDeferredIncome: instFact({ 2021: 3e9, 2022: 3.1e9, 2023: 3.2e9, 2024: 3.3e9 }),
    FinancingReceivableRecordedInvestmentNonaccrualStatus: instFact({ 2021: 5.8e6, 2022: 6.5e3, 2023: 5.9e6, 2024: 10.9e6 }),
  });
  const { instants } = banksLines(f, CAL);
  t("a subtotal-mixing series is withheld whole by the volatility gate", instants.nonaccrualLoans === undefined, instants.nonaccrualLoans);
}

// --- the spread legs must close ---
{
  const f = facts({
    ...CORE,
    InterestAndDividendIncomeOperating: flowFact({ 2023: 150e9, 2024: 183e9 }),
    InterestExpense: flowFact({ 2023: 60e9 }),
    InterestExpenseOperating: flowFact({ 2024: 90e9 }),
  });
  const { flows } = banksLines(f, CAL);
  t("the deprecation seam stitches interest expense across eras", flows.totalInterestExpense?.[2023] === 60e9 && flows.totalInterestExpense?.[2024] === 90e9, flows.totalInterestExpense);
  t("II − IE = NII closes and the legs ship", flows.totalInterestIncome?.[2023] === 150e9, flows.totalInterestIncome);
}
{
  const f = facts({
    ...CORE,
    InterestAndDividendIncomeOperating: flowFact({ 2024: 170e9 }),
    InterestExpenseOperating: flowFact({ 2024: 40e9 }),  // 170 − 40 = 130 ≠ NII 93 → both legs null
  });
  const { flows, flags } = banksLines(f, CAL);
  t("legs that fail the NII identity are both nulled", flows.totalInterestIncome === undefined && flows.totalInterestExpense === undefined, flows);
  t("the identity failure is stated", (flags.warns || []).some((w) => w.includes("misses NII")), flags.warns);
}

// --- the securities marks ---
{
  const f = facts({
    ...CORE,
    HeldToMaturitySecurities: instFact({ 2022: 632.9e9 }),
    HeldToMaturitySecuritiesFairValue: instFact({ 2022: 524.3e9 }),
    HeldToMaturitySecuritiesAccumulatedUnrecognizedHoldingLoss: instFact({ 2022: -108.596e9 }),
  });
  const { instants, flags } = banksLines(f, { ...CAL, 2022: "2022-12-31" });
  t("HTM cost and fair value ship with the identity clean", instants.htmAmortizedCost?.[2022] === 632.9e9 && instants.htmFairValue?.[2022] === 524.3e9 && !(flags.warns || []).some((w) => w.includes("htm")), flags.warns);
}

// --- regulatory capital, gate-only ---
{
  const f = facts({ ...CORE, CommonEquityTierOneCapitalRatio: instFact({ 2023: 0.1299, 2024: 12.99 }, "pure") });
  const { instants } = banksLines(f, CAL);
  t("CET1 reads the pure decimal and nulls the mis-scaled year", instants.cet1Ratio?.[2023] === 0.1299 && instants.cet1Ratio?.[2024] == null, instants.cet1Ratio);
}

if (failed) { console.error(`\n❌ banksLinesTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ banksLinesTest passed.");
