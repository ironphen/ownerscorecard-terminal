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
const GOLDEN = {
  AAPL: { mode: "owner-earnings", oe: 129174000000, oeNormalized: 104494472092.51096, oeMaint: 127507000000, sbc: 13473000000, gDeliv: 0.00386460187350135, netDebt: -63881000000, shares: 14768115000, eps3: 6.833212408399222, bvps: 7.210872883912402, rev: 451442000000, gRev: 0.06645550690783386, ni: 122575000000 },
  KO: { mode: "owner-earnings", oe: 12562000000, oeNormalized: 9885434569.217644, oeMaint: 13581000000, sbc: 272000000, gDeliv: -0.12679835295624164, netDebt: 32475000000, shares: 4314000000, eps3: 2.6620305980528514, bvps: 7.796244784422809, rev: 49284000000, gRev: 0.07457823127133056, ni: 13701000000 },
  BX: { mode: "owner-earnings", oe: 4425155000, oeNormalized: 3774810363.4847608, oeMaint: 4429286000, sbc: 1535125000, gDeliv: -0.05961989346439878, netDebt: 10960020000, shares: 786296310, eps3: 3.0466046572188543, bvps: 10.645821293501937, rev: 14778402000, gRev: 0.07857203004397029, ni: 3054091000 },
  SD: { mode: "owner-earnings", oe: 26504000, oeNormalized: 59420333.333333336, oeMaint: 40957000, sbc: 2796000, gDeliv: -0.20170296212102345, netDebt: -111798000, shares: 36992000, eps3: 1.7485402249134947, bvps: 14.218479671280276, rev: 163530000, gRev: 0.0029921570764133154, ni: 75824000 },
  7203: { mode: "owner-earnings", oe: 3324728000000, oeNormalized: 2491592333333.3335, oeMaint: 3324728000000, sbc: 0, gDeliv: 0.07504103853009658, netDebt: -15929150000000, shares: 15794987000, eps3: 286.127005570396, bvps: 2527.3116084236094, gRev: null, ni: 3848098000000 },
  6758: { mode: "owner-earnings", oe: 1487936000000, oeNormalized: 1312631000000, oeMaint: 1487936000000, sbc: 0, gDeliv: 0.31119300233641045, netDebt: -1581196000000, shares: 6149811000, eps3: 96.76763508125154, bvps: 1320.2049623964053, gRev: null, ni: -326865000000 },
  JPM: { mode: "bank", tbvps: 113.97397250202191, bvpsBank: 133.82765973090213, rotce: 0.16381947326587082, epsBank: 21.652452025586353 },
  PGR: { mode: "bank", tbvps: 54.07411824842392, bvpsBank: 54.5902197989436, rotce: 0.22713453037625933, epsBank: 19.695007667405008 },
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
for (const band of ["quality", "compounding", "survival", "stewardship", "candor", "price"])
  if (!(band in sample)) fail(`AAPL card missing band: ${band}`);

if (failures) { console.error(`\n❌ compareCardTest: ${failures} failure(s)`); process.exit(1); }
console.log("\n✅ compareCardTest passed");
