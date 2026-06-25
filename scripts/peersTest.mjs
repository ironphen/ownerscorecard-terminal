// Offline regression for the peer engine. No network: a small synthetic universe asserts that peers are
// drawn from the same economic ENGINE (a bank with banks, never a grocer or an automaker), ranked by
// structural likeness (scale, sub-industry, capital intensity), and that the distribution helper places a
// value with a median and a percentile rather than crowning a winner. Run with `npm test`.
import { selectPeers, peerStat, throughCycleMetric, peerMedian } from "../src/lib/peers.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

const co = (ticker, sic, revenue, capex, extra = {}, cik) => ({
  ticker, name: ticker, sic, cik, history: [],
  lines: { revenue, capex, netIncome: revenue * 0.1, operatingIncome: revenue * 0.15, ...extra },
});
const bank = (ticker, sic, nii) => co(ticker, sic, null, 0, { netInterestIncome: nii, noninterestIncome: nii * 0.4, deposits: nii * 18, totalAssets: nii * 22, stockholdersEquity: nii * 2 });

// A software company (asset-light) among software, a bank, a grocer, and an automaker.
const SOFT1 = co("SOFT1", "7372", 10e9, 0.3e9);
const universe = [
  SOFT1,
  co("SOFT2", "7372", 12e9, 0.36e9),  // same engine, close size & intensity → should rank first
  co("SOFT3", "7373", 2e9, 0.06e9),   // same engine, smaller and a step out in sub-industry
  bank("BANK1", "6021", 11e9),         // bank — a different engine, must be excluded
  co("GROCER1", "5411", 11e9, 0.5e9),  // retailer — different engine, excluded
  co("AUTO1", "3711", 11e9, 1.5e9),    // capital-intensive — different engine, excluded
];

const { peers } = selectPeers(SOFT1, universe);
const t = peers.map((p) => p.ticker);
check("peers drawn from the same engine only (no bank, grocer, automaker)", !t.includes("BANK1") && !t.includes("GROCER1") && !t.includes("AUTO1"));
check("the software peers are selected", t.includes("SOFT2") && t.includes("SOFT3"));
check("closest by scale & sub-industry ranks first (SOFT2 before SOFT3)", t.indexOf("SOFT2") < t.indexOf("SOFT3"));

// A bank peers only with banks — not a software firm or a REIT.
const BANK_A = bank("BANK_A", "6022", 8e9);
const bankUniv = [BANK_A, bank("BANK_B", "6021", 9e9), bank("BANK_C", "6022", 3e9), SOFT1, co("REIT1", "6798", 4e9, 0.1e9, { depreciation: 0.2e9 })];
const bp = selectPeers(BANK_A, bankUniv).peers.map((p) => p.ticker);
check("a bank peers only with banks", bp.includes("BANK_B") && bp.includes("BANK_C") && !bp.includes("SOFT1") && !bp.includes("REIT1"));

// Multi-share-class entities collapse to one peer (same CIK), and the company's own sibling classes are
// not peers. (Microsoft's table once showed GOOG, GOOGL, GOOGM and GOOGN as four separate "peers".)
const HW = co("HW", "3571", 10e9, 0.3e9, {}, 500);
const dedupUniv = [
  HW,
  co("HW_B", "3571", 10e9, 0.3e9, {}, 500),    // the company's own B share — same CIK, must be excluded
  co("PEERA", "3571", 8e9, 0.2e9, {}, 600),    // a peer, class A
  co("PEERA2", "3571", 8e9, 0.2e9, {}, 600),   // the same peer's other class — same CIK, must count once
  co("PEERB", "3572", 5e9, 0.15e9, {}, 700),
  co("PEERC", "3576", 3e9, 0.1e9, {}, 800),
];
const dp = selectPeers(HW, dedupUniv).peers.map((p) => p.ticker);
check("a company's own sibling share class is not a peer", !dp.includes("HW_B"));
check("a multi-class peer entity appears once, not as both classes", (dp.includes("PEERA") || dp.includes("PEERA2")) && !(dp.includes("PEERA") && dp.includes("PEERA2")));

// The distribution helper: median, the subject's percentile, the band — context, no winner.
const s = peerStat([0.10, 0.12, 0.14, 0.16, 0.18], 0.16);
check("peerStat median is 0.14", s && Math.abs(s.median - 0.14) < 1e-9);
check("peerStat percentile is 3 of 5 below 0.16", s && Math.abs(s.percentile - 0.6) < 1e-9);
check("peerStat reports the band and count", s && s.min === 0.10 && s.max === 0.18 && s.count === 5);
check("peerStat withholds on too few points", peerStat([0.1, 0.2], 0.15) === null);
check("peerStat withholds on a null subject", peerStat([0.1, 0.2, 0.3], null) === null);

// Through-cycle metric and peer median: a company is read across its record, and the peer median is the
// median of those through-cycle figures — the context a company's own number is read against.
const withHist = (vals) => ({ history: vals.map((v) => ({ lines: { _m: v } })), lines: { _m: vals[vals.length - 1] } });
check("throughCycleMetric is the record median", Math.abs(throughCycleMetric(withHist([0.1, 0.2, 0.3, 0.4, 0.5]), (L) => L._m) - 0.3) < 1e-9);
check("peerMedian is the median of peers' through-cycle figures",
  Math.abs(peerMedian([withHist([0.1, 0.1, 0.1]), withHist([0.2, 0.2, 0.2]), withHist([0.3, 0.3, 0.3])], (L) => L._m) - 0.2) < 1e-9);
check("peerMedian withholds under three peers", peerMedian([withHist([0.1, 0.1, 0.1])], (L) => L._m) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
