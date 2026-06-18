#!/usr/bin/env node
// The qualitative audit — the measurement the qualitative re-architecture runs on. The fundamentals
// pipeline has had a floor for ages (scripts/auditData.mjs); the language layer never did, which is
// how the four most valuable companies on earth ended up with no business description and nobody
// noticed. This reads src/data/language.json (cross-referenced with fundamentals.json for size, so the
// biggest failures surface first) and reports: business-lede coverage, section-extraction health
// (an Item that collapsed to a handful of words is a parse failure to catch, not ship), and the
// firing rates of every detector. Floors fail the run loudly; the surfaced lists drive the fixes.
//
//   npm run audit:lang
//
// No network — it grades the output we already have. Run it before and after every filings re-fetch
// to see the layer get better, the same measure → fix → re-fetch → re-measure loop the numbers earned.

import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "src", "data");
const L = JSON.parse(fs.readFileSync(path.join(dataDir, "language.json"), "utf8")).companies || {};
const F = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8")).companies || [];
const revOf = new Map(F.map((c) => [String(c.ticker).toUpperCase(), c?.lines?.revenue ?? c?.ttm?.lines?.revenue ?? null]));
const nameOf = new Map(F.map((c) => [String(c.ticker).toUpperCase(), c.name || ""]));

const tickers = Object.keys(L);
const N = tickers.length;
const pct = (k) => `${((100 * k) / (N || 1)).toFixed(0)}%`;
const big = (ts) => ts
  .map((t) => [t, revOf.get(t) ?? 0])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .map(([t, r]) => `${t} (${r ? "$" + (r / 1e9).toFixed(0) + "B" : "—"}${nameOf.get(t) ? " " + nameOf.get(t).slice(0, 24) : ""})`);

let floorsFailed = 0;
const SECTION = "═".repeat(64);
const head = (s) => console.log(`\n${SECTION}\n${s}\n${SECTION}`);
// A floor: the metric must clear `min`, else the run fails. A soft target prints but never fails.
function floor(label, value, min) {
  const ok = value >= min;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${(100 * value).toFixed(0)}%  (floor ${(100 * min).toFixed(0)}%)`);
  if (!ok) floorsFailed++;
}

head("QUALITATIVE AUDIT — language.json");
console.log(`  companies: ${N}`);

// ---- 1. Business lede ----
head("1. Business description (the lede)");
const haveLede = tickers.filter((t) => L[t].business);
const noLede = tickers.filter((t) => !L[t].business);
floor("companies with a real lede (not the computed fallback)", haveLede.length / N, 0.85);
// Extraction vs scorer: where the diagnostic is present (post-rearchitecture fetch), split the misses.
const withDiag = tickers.filter((t) => L[t].extract);
if (withDiag.length) {
  const extractFail = noLede.filter((t) => (L[t].extract?.business ?? 0) < 500);
  const scorerFail = noLede.filter((t) => (L[t].extract?.business ?? 0) >= 500);
  console.log(`  of the ${noLede.length} with no lede: ${extractFail.length} are EXTRACTION failures (Item 1 < 500w), ${scorerFail.length} are SCORER failures (Item 1 full, no sentence accepted)`);
} else {
  console.log(`  (no extraction diagnostics yet — re-fetch to split extraction vs scorer failures)`);
}
if (noLede.length) console.log(`  biggest companies with NO lede:\n    ${big(noLede).join("\n    ")}`);

// ---- 2. Section extraction ----
head("2. Section extraction health");
const secW = (t, s) => L[t].extract?.[s] ?? (s === "mdna" ? L[t].mdna?.words : s === "risk" ? L[t].risk?.words : null);
for (const [sec, fl] of [["mdna", 0.9], ["risk", 0.9]]) {
  const ok = tickers.filter((t) => (secW(t, sec) ?? 0) >= 1000);
  floor(`${sec} extracted (≥1000 words)`, ok.length / N, fl);
  const collapsed = tickers.filter((t) => { const w = secW(t, sec); return w != null && w < 200; });
  if (collapsed.length) console.log(`    collapsed (<200w, parse likely failed): ${collapsed.length} — biggest:\n      ${big(collapsed).slice(0, 8).join("\n      ")}`);
}

// ---- 3. Business-in-brief ----
head("3. Business-in-brief");
const haveBrief = tickers.filter((t) => Array.isArray(L[t].brief) && L[t].brief.length);
floor("companies with ≥1 brief sentence", haveBrief.length / N, 0.6);

// ---- 4. Detector firing rates ----
head("4. Detector coverage (soft targets — context, not floors)");
const rate = (label, pred) => console.log(`  ${label}: ${pct(tickers.filter(pred).length)} (${tickers.filter(pred).length})`);
rate("Candor Read present", (t) => L[t].mdna?.candor);
rate("  with ≥1 mistake-admission", (t) => L[t].mdna?.candor?.admissions?.length);
rate("Buffett read present", (t) => L[t].buffettRead);
rate("  pricing power", (t) => L[t].buffettRead?.pricing?.power);
rate("  critical estimates", (t) => L[t].buffettRead?.judgment);
rate("  integrity flag (material weakness/restatement)", (t) => L[t].buffettRead?.integrity);
rate("owner flags ≥3", (t) => (L[t].ownerFlags?.length ?? 0) >= 3);
rate("\"what changed\" present", (t) => L[t].mdnaChange?.notable?.length || L[t].riskChange?.notable?.length);

head(`RESULT: ${floorsFailed ? "FAIL" : "PASS"}  (${floorsFailed} floor${floorsFailed === 1 ? "" : "s"} breached)`);
console.log(floorsFailed ? "  The qualitative layer is below floor — see the surfaced failures above." : "  Floors clear. Soft targets above are the room to improve.");
console.log("");
process.exit(floorsFailed ? 1 : 0);
