// Offline test for the quarterly extraction the Current Position rests on. No network: a synthetic
// SEC "companyfacts" object exercises the parts most likely to go wrong — a restated balance-sheet
// value (the latest filing must win), and the duration filter that must keep a true three-month
// quarter while rejecting the cumulative year-to-date and the annual spans a 10-Q/10-K also carry.
// Also covers the scorecard reads (second half): one owner-earnings basis, missing tags read as
// unknowns rather than virtues, and the loss/turn branches. Run with `npm test`.
import { instantMap, quarterFlowMap, quarterSeries, latestObservation } from "./fetchFundamentals.mjs";
import { capitalAllocation, coverage, coverageVerdict, cashPosition, ownerCash, cashConversionCycle, ownerEarningsAbs, freeCashFlowAbs } from "../src/lib/fundamentals.mjs";

// SEC shape: facts["us-gaap"][Tag].units.USD = [ {val,end,form,filed[,start]} ]. Instants omit start.
const facts = {
  facts: {
    "us-gaap": {
      AssetsCurrent: { units: { USD: [
        { val: 100, end: "2024-12-31", form: "10-K", filed: "2025-02-01" },
        { val: 110, end: "2025-03-31", form: "10-Q", filed: "2025-05-01" },
        { val: 120, end: "2025-06-30", form: "10-Q", filed: "2025-08-01" },
        { val: 121, end: "2025-06-30", form: "10-Q", filed: "2025-08-15" }, // restatement, filed later → wins
      ] } },
      LiabilitiesCurrent: { units: { USD: [
        { val: 50, end: "2024-12-31", form: "10-K", filed: "2025-02-01" },
        { val: 60, end: "2025-06-30", form: "10-Q", filed: "2025-08-01" },
      ] } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [
        { val: 25, end: "2025-06-30", form: "10-Q", filed: "2025-08-01" },
      ] } },
      Revenues: { units: { USD: [
        { val: 28, start: "2025-01-01", end: "2025-03-31", form: "10-Q", filed: "2025-05-01" }, // Q1, ~90d
        { val: 30, start: "2025-04-01", end: "2025-06-30", form: "10-Q", filed: "2025-08-01" }, // Q2, ~91d
        { val: 58, start: "2025-01-01", end: "2025-06-30", form: "10-Q", filed: "2025-08-01" }, // H1 YTD, ~181d → reject
        { val: 27, start: "2024-04-01", end: "2024-06-30", form: "10-Q", filed: "2024-08-01" }, // year-ago Q2
        { val: 110, start: "2024-01-01", end: "2024-12-31", form: "10-K", filed: "2025-02-01" }, // annual → reject
      ] } },
      NetIncomeLoss: { units: { USD: [
        { val: 5, start: "2025-04-01", end: "2025-06-30", form: "10-Q", filed: "2025-08-01" },
        { val: 4, start: "2024-04-01", end: "2024-06-30", form: "10-Q", filed: "2024-08-01" },
      ] } },
    },
  },
};

let pass = 0, fail = 0;
const check = (name, cond, got) => { const ok = !!cond; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(got))); ok ? pass++ : fail++; };

// latestObservation carries the latest end + form, and the later-filed restatement wins the tie.
const lo = latestObservation(facts, ["AssetsCurrent"], "USD", true);
check("latestObservation: latest end, restatement wins, form carried", lo && lo.val === 121 && lo.end === "2025-06-30" && lo.form === "10-Q", lo);

// instantMap keys by end, latest filing winning the restatement.
const im = instantMap(facts, ["AssetsCurrent"]);
check("instantMap: restatement (121) beats first filing (120)", im["2025-06-30"] === 121 && im["2024-12-31"] === 100, im);

// quarterFlowMap keeps only the ~90-day quarters, rejecting the YTD and the annual.
const qf = quarterFlowMap(facts, ["Revenues"]);
check("quarterFlowMap: keeps Q1+Q2+year-ago, drops H1-YTD and annual",
  qf["2025-03-31"] === 28 && qf["2025-06-30"] === 30 && qf["2024-06-30"] === 27 && !("end" in qf) && Object.keys(qf).length === 3, qf);

// quarterSeries merges instants + quarterly flows on the period end, sorted ascending.
const qs = quarterSeries(facts, ["Revenues"]);
const last = qs[qs.length - 1];
check("quarterSeries: ends sorted ascending", qs.map((q) => q.end).join(",") === [...qs.map((q) => q.end)].sort().join(","), qs.map((q) => q.end));
check("quarterSeries: latest quarter merges liquidity + revenue", last.end === "2025-06-30" && last.currentAssets === 121 && last.currentLiabilities === 60 && last.cash === 25 && last.revenue === 30 && last.netIncome === 5, last);
check("quarterSeries: year-ago Q2 present for momentum", qs.some((q) => q.end === "2024-06-30" && q.revenue === 27), qs);

// ---- the scorecard reads: one basis per figure, missing tags are unknowns ----

// capitalAllocation divides by the same Buffett owner-earnings figure the bridge reads (operating
// cash less MAINTENANCE capex), never free cash flow under an "Owner Earnings" label. A heavy
// growth-capex year (FCF near zero, OE solidly positive) must not read "no surplus", and the payout
// must be stated against OE.
{
  // Growing capex build-out: cfo 100, capex 60, dep 20 → maint 20 (short record reads as growth),
  // OE 80, FCF 40. Returned 60 → payout 75% of OE (the old FCF basis would have said 150%).
  const c1 = { lines: { cashFromOps: 100, capex: -60, depreciation: 20, revenue: 1000, dividendsPaid: -50, buybacks: -10 } };
  check("capitalAllocation: OE is the denominator (75%, not FCF's 150%)",
    ownerEarningsAbs(c1.lines, c1) === 80 && freeCashFlowAbs(c1.lines) === 40 && capitalAllocation(c1).value === "75%",
    capitalAllocation(c1));
  // FCF negative but OE positive: the bridge proves a surplus, so the check must not deny one.
  const c2 = { lines: { cashFromOps: 100, capex: -120, depreciation: 20, revenue: 1000, dividendsPaid: -50, buybacks: null } };
  check("capitalAllocation: FCF<0 with OE>0 is not 'No surplus to allocate'",
    freeCashFlowAbs(c2.lines) < 0 && capitalAllocation(c2).label !== "No surplus to allocate",
    capitalAllocation(c2));
  // Returned more than it generated: payout > 1 says so in plain words.
  const c3 = { lines: { cashFromOps: 100, capex: -20, depreciation: 20, revenue: 1000, dividendsPaid: -70, buybacks: -30 } };
  const a3 = capitalAllocation(c3);
  check("capitalAllocation: payout > 1 reads 'Returned more than it generated'",
    a3.value === "125%" && a3.label === "Returned more than it generated" && /returned more than it generated/i.test(a3.note),
    a3);
}

// coverage: a missing (or negative) interest tag beside material net debt is UNKNOWN, never the
// good-tone "no meaningful interest burden" — that verdict sits directly above the net-debt check.
{
  const heavy = { lines: { operatingIncome: 700, totalDebt: 9800, cashAndEquivalents: 200 } }; // no interest tag
  const v1 = coverageVerdict(coverage(heavy));
  check("coverage: untagged interest + heavy net debt → tone none, 'not tagged'",
    v1.tone === "none" && /not tagged/i.test(v1.label) && /net-debt/i.test(v1.note), v1);
  const negTag = { lines: { operatingIncome: 700, interestExpense: -50, totalDebt: 9800, cashAndEquivalents: 200 } };
  const v2 = coverageVerdict(coverage(negTag));
  check("coverage: negative interest tag + heavy net debt → tone none, not the good verdict", v2.tone === "none", v2);
  const netCash = { lines: { operatingIncome: 700, totalDebt: 300, cashAndEquivalents: 1000 } };
  check("coverage: untagged interest but net cash keeps the no-burden read",
    coverageVerdict(coverage(netCash)).tone === "good", coverageVerdict(coverage(netCash)));
  const trivial = { lines: { operatingIncome: 700, totalDebt: 100, cashAndEquivalents: 0 } };
  check("coverage: untagged interest with immaterial net debt keeps the no-burden read",
    coverageVerdict(coverage(trivial)).tone === "good", coverageVerdict(coverage(trivial)));
}

// cashPosition: net debt against an operating LOSS is the harshest read, not a milder one than a
// profitable heavy borrower gets.
{
  const loss = { lines: { cashAndEquivalents: 100, totalDebt: 1100, operatingIncome: -50 } };
  const r = cashPosition(loss);
  check("cashPosition: net debt + operating loss → tone bad, loss named",
    r.tone === "bad" && /operating loss/i.test(r.label) && /no operating profit/i.test(r.note), r);
  const noOi = { lines: { cashAndEquivalents: 100, totalDebt: 1100 } };
  check("cashPosition: net debt with NO operating-income line stays the plain warn read",
    cashPosition(noOi).tone === "warn" && cashPosition(noOi).label === "Net debt", cashPosition(noOi));
}

// ownerCash: the "recently turned positive, after an earlier loss stretch" narrative requires an
// actual loss in the record; steadily-positive-but-thin reads plain.
{
  const yr = (fy, cfo) => ({ fy, lines: { revenue: 100, cashFromOps: cfo, capex: -1, depreciation: 1 } });
  const thinYears = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map((fy) => yr(fy, 4)); // OE +3 every year
  const thin = { lines: thinYears[thinYears.length - 1].lines, history: thinYears };
  const t = ownerCash(thin);
  check("ownerCash: always-positive thin record carries no turn narrative",
    !/turned positive/i.test(t.label) && !/loss stretch/i.test(t.formula), t);
  const turnYears = [yr(2019, -5), yr(2020, -5), yr(2021, -5), yr(2022, -5), yr(2023, 4), yr(2024, 4), yr(2025, 4)];
  const turner = { lines: turnYears[turnYears.length - 1].lines, history: turnYears };
  const u = ownerCash(turner);
  check("ownerCash: a real loss stretch then 3 positive years still reads the turn",
    /turned positive/i.test(u.label), u);
}

// cashConversionCycle: an untagged inventory line on a goods business (a SIC maker/retailer, or a
// no-SIC filer whose cost of goods dominates revenue) is missing data — withhold, never print the
// fictional negative cycle. A services filer with no inventory line keeps its cycle.
{
  const base = { revenue: 1000, costOfRevenue: 700, receivables: 30, accountsPayable: 90 };
  check("ccc: retailer (SIC 5311) with untagged inventory → null",
    cashConversionCycle({ sic: "5311", lines: { ...base } }) === null, cashConversionCycle({ sic: "5311", lines: { ...base } }));
  const tagged = cashConversionCycle({ sic: "5311", lines: { ...base, inventory: 200 } });
  check("ccc: same retailer with inventory tagged computes (and is positive here)",
    tagged != null && parseInt(tagged.value) > 0, tagged);
  const svc = cashConversionCycle({ sic: "7372", lines: { revenue: 1000, costOfRevenue: 300, receivables: 80, accountsPayable: 40 } });
  check("ccc: services filer without inventory keeps its cycle", svc != null && /inventory leg is ~0/.test(svc.note), svc);
  check("ccc: no-SIC filer with cost of goods dominating revenue → null",
    cashConversionCycle({ lines: { ...base, costOfRevenue: 750 } }) === null, cashConversionCycle({ lines: { ...base, costOfRevenue: 750 } }));
  const jpSvc = cashConversionCycle({ lines: { revenue: 1000, costOfRevenue: 300, receivables: 80, accountsPayable: 40 } });
  check("ccc: no-SIC filer with a modest cost line keeps its cycle", jpSvc != null, jpSvc);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
