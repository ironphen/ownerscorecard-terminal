#!/usr/bin/env node
// compareCardTest.mjs — guards the head-to-head compare cards on two fronts.
//
// 1. valuationModel() must reproduce the company-page valuation. The expected values below were read
//    straight off the rendered data-* attributes of Valuation.astro (the figures that feed "What the
//    price implies"). If this drifts, a compare column would disagree with the company page — the one
//    thing the shared-module refactor exists to prevent.
// 2. buildCompareCard() must run for every company in all three pools without throwing, and produce a
//    well-formed card (a sparse record is fine; a crash or a wrong shape is not).

import fs from "node:fs";
import path from "node:path";
import { valuationModel } from "../src/lib/valuationInputs.mjs";
import { buildCompareCard } from "../src/lib/compareCard.mjs";

const dataDir = path.join(process.cwd(), "src", "data");
const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")).companies || [];
const us = load("fundamentals.json"), adr = load("fundamentals.adr.json"), jp = load("fundamentals.jp.json");
const language = JSON.parse(fs.readFileSync(path.join(dataDir, "language.json"), "utf8")).companies || {};
const all = [...us, ...adr, ...jp];
const byTicker = (t) => all.find((c) => String(c.ticker).toUpperCase() === t);

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// Read off the post-Phase-0 build — the figures the company page actually renders.
// Share counts (and everything divided by them) re-pinned 2026-07-09, when sharesForValue — the
// dated filing-cover count — replaced the weighted-average diluted count as the price-to-value
// share basis on both the company page and the compare card (they moved together, by design).
// netDebt re-pinned 2026-07-17: the headline figure now nets against cash + short-term only
// (netDebtOf), the one shared definition — no longer liquidAssets (which folded in long-term
// marketable and sign-flipped a cash-rich name against the grouping table). AAPL: net cash → net
// debt, matching every surface.
const GOLDEN = {
  AAPL: { mode: "owner-earnings", oe: 129174000000, oeNormalized: 104494472092.51096, oeMaint: 127507000000, sbc: 13473000000, gDeliv: 0.00386460187350135, netDebt: 14207000000, shares: 14687356000, eps3: 6.870785093427753, bvps: 7.250522149800141, rev: 451442000000, gRev: 0.06645550690783386, ni: 122575000000 },
  KO: { mode: "owner-earnings", oe: 12562000000, oeNormalized: 9885434569.217644, oeMaint: 13581000000, sbc: 272000000, gDeliv: -0.12679835295624164, netDebt: 32475000000, shares: 4302482418, eps3: 2.669156752844632, bvps: 7.817115035564568, rev: 49284000000, gRev: 0.07457823127133056, ni: 13701000000 },
  BX: { mode: "owner-earnings", oe: 4425155000, oeNormalized: 3774810363.4847608, oeMaint: 4429286000, sbc: 1535125000, gDeliv: -0.05961989346439878, netDebt: 10960020000, shares: 742879807, eps3: 3.2246589252088795, bvps: 11.268000450576253, rev: 14778402000, gRev: 0.07857203004397029, ni: 3054091000 },
  SD: { mode: "owner-earnings", oe: 26504000, oeNormalized: 59420333.333333336, oeMaint: 40957000, sbc: 2796000, gDeliv: -0.20170296212102345, netDebt: -102749000, shares: 36918259, eps3: 1.7520327813941605, bvps: 14.246879843385898, rev: 163530000, gRev: 0.0029921570764133154, ni: 75824000 },
  7203: { mode: "owner-earnings", oe: 3324728000000, oeNormalized: 2652442044348.3223, oeMaint: 3324728000000, sbc: 0, gDeliv: 0.06139201436355113, netDebt: -15929150000000, shares: 15794987000, eps3: 286.127005570396, bvps: 2527.3116084236094, gRev: 0.13982150393681048, ni: 3848098000000 },
  6758: { mode: "owner-earnings", oe: 1487936000000, oeNormalized: 1177925022483.8274, oeMaint: 1487936000000, sbc: 0, gDeliv: 0.31119300233641045, netDebt: -1581196000000, shares: 6149811000, eps3: 96.76763508125154, bvps: 1320.2049623964053, gRev: 0.10166254418780785, ni: -326865000000 },
  JPM: { mode: "bank", tbvps: 115.70467582907683, bvpsBank: 135.85984278869753, rotce: 0.16381947326587082, epsBank: 21.981246134775756 },
  PGR: { mode: "bank", tbvps: 54.31134621097341, bvpsBank: 54.82971194486333, rotce: 0.22713453037625933, epsBank: 19.78141141641984 },
  O: { mode: "reit", ffops: 3.7191405388861423 },
};

const approx = (a, b) => {
  if (b === null) return a == null;
  if (a == null || !Number.isFinite(a)) return false;
  const denom = Math.max(1, Math.abs(b));
  return Math.abs(a - b) / denom < 1e-9;
};

console.log("valuationModel reproduces the company-page valuation:");
for (const [ticker, exp] of Object.entries(GOLDEN)) {
  const c = byTicker(ticker);
  if (!c) { fail(`${ticker}: not found in any pool`); continue; }
  const vm = valuationModel(c);
  let bad = [];
  for (const [k, v] of Object.entries(exp)) {
    if (k === "mode") { if (vm.mode !== v) bad.push(`mode ${vm.mode}≠${v}`); continue; }
    if (!approx(vm[k], v)) bad.push(`${k} ${vm[k]}≠${v}`);
  }
  if (bad.length) fail(`${ticker}: ${bad.join(", ")}`);
  else ok(`${ticker} (${exp.mode})`);
}

console.log("\nbuildCompareCard runs across the whole universe:");
let built = 0, modes = {};
for (const c of all) {
  try {
    const card = buildCompareCard(c, language[String(c.ticker).toUpperCase()] || null);
    if (!card.ticker || !card.archetype || !card.quality || !card.survival || !card.price || !card.price.mode)
      throw new Error("malformed card");
    modes[card.price.mode] = (modes[card.price.mode] || 0) + 1;
    built++;
  } catch (e) {
    fail(`${c.ticker}: ${e.message}`);
  }
}
if (built === all.length) ok(`${built}/${all.length} cards built — modes: ${JSON.stringify(modes)}`);
else fail(`only ${built}/${all.length} cards built`);

// A representative card, fully formed, so the shape is visible in the test log.
const sample = buildCompareCard(byTicker("AAPL"), language.AAPL || null);
console.log("\nSample card (AAPL):");
console.log(JSON.stringify(sample, null, 2).split("\n").slice(0, 1).join("") + " …");
// Candour was removed from the Compare page and the card (2026-07-05, Ryan's call) — never re-add.
for (const band of ["quality", "compounding", "survival", "stewardship", "price"])
  if (!(band in sample)) fail(`AAPL card missing band: ${band}`);
if ("candor" in sample) fail("AAPL card still carries the removed candor band");

if (failures) { console.error(`\n❌ compareCardTest: ${failures} failure(s)`); process.exit(1); }
console.log("\n✅ compareCardTest passed");
