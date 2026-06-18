// Offline test for the quarterly extraction the Current Position rests on. No network: a synthetic
// SEC "companyfacts" object exercises the parts most likely to go wrong — a restated balance-sheet
// value (the latest filing must win), and the duration filter that must keep a true three-month
// quarter while rejecting the cumulative year-to-date and the annual spans a 10-Q/10-K also carry.
// Run with `npm test`.
import { instantMap, quarterFlowMap, quarterSeries, latestObservation } from "./fetchFundamentals.mjs";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
