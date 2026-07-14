#!/usr/bin/env node
// almanacTest.mjs — guards the Almanac census (src/lib/almanac.mjs). Two things matter: the math
// (percentiles and base-rate shares must be right, or a cited statistic is a lie) and the DOCTRINE
// (the output is a census — distributions and counts only; it must never leak a company name or a
// ranked list, which would turn a base rate into a verdict).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { distribution, shareAtLeast, computeAlmanac } from "../src/lib/almanac.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "src", "data");
const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")).companies || [];

let fails = 0;
const ok = (cond, name) => { if (cond) console.log(`  ✓ ${name}`); else { console.error(`  ✗ ${name}`); fails++; } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log("distribution — percentile math:");
{
  const d = distribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  ok(d.n === 10, "counts the sample");
  ok(near(d.median, 5.5), `median of 1..10 is 5.5 (got ${d.median})`);
  ok(near(d.p10, 1.9), `p10 by interpolation (got ${d.p10})`);
  ok(near(d.p90, 9.1), `p90 by interpolation (got ${d.p90})`);
  ok(distribution([]).n === 0, "empty sample → n 0");
  ok(distribution([42]).median === 42, "single value → itself");
  // Nulls and non-finite values are dropped, never counted as zero.
  const d2 = distribution([1, null, 2, NaN, 3, undefined, Infinity]);
  ok(d2.n === 3, "drops null/NaN/Infinity, does not zero-fill");
}

console.log("\nshareAtLeast — base-rate math:");
{
  const s = shareAtLeast([0.05, 0.10, 0.15, 0.20, 0.25], 0.15);
  ok(s.n === 5 && s.pass === 3, "3 of 5 clear 0.15 (>=)");
  ok(near(s.share, 0.6), `share 0.6 (got ${s.share})`);
  ok(shareAtLeast([], 0.1).share === null, "empty → null share, not 0");
  ok(shareAtLeast([0.14999], 0.15).pass === 0, "strictly below threshold does not pass");
}

console.log("\ncomputeAlmanac — against the live universe (structure + doctrine + sanity):");
{
  const a = computeAlmanac({
    us: load("fundamentals.json"),
    adr: load("fundamentals.adr.json"),
    homePools: [{ country: "Japan", companies: load("fundamentals.jp.json") }],
  });
  ok(a.universe.readable > 1000, `read a real universe (${a.universe.readable})`);
  // De-dup: the four Japanese names listed both as ADRs (TM/SONY/HMC/TAK) and in the Japan pool
  // must be counted once — dropped from the ADR side, kept as the home-market listing.
  ok(a.universe.droppedDuplicates >= 4, `de-dups ADR/home duplicates (dropped ${a.universe.droppedDuplicates})`);
  ok(a.universe.total === a.universe.us + a.universe.adr + a.universe.home, "total = us + deduped-adr + home (no double-count)");
  ok(a.distributions.roicThroughCycle.n > 500, "a real ROIC sample");
  // Sanity: a share is a probability in [0,1]; a median return sits in a plausible band.
  const shares = [a.baseRates.roicAtLeast15.share, a.baseRates.netCash.share, a.baseRates.passedAllDefensiveTests.share];
  ok(shares.every((s) => s == null || (s >= 0 && s <= 1)), "every base-rate share is within [0,1]");
  ok(a.distributions.roicThroughCycle.p10 <= a.distributions.roicThroughCycle.median && a.distributions.roicThroughCycle.median <= a.distributions.roicThroughCycle.p90, "percentiles are ordered p10 ≤ median ≤ p90");
  // The defensive histogram sums to its own N.
  const histSum = Object.values(a.defensiveHistogram.counts).reduce((x, y) => x + y, 0);
  ok(histSum === a.defensiveHistogram.n, `defensive histogram sums to n (${histSum} = ${a.defensiveHistogram.n})`);

  // DOCTRINE: the census must carry NO company identity — no names, no tickers, no ranked list.
  const blob = JSON.stringify(a);
  ok(!/"name"|"ticker"|"company"/i.test(blob), "no name/ticker/company field leaks into the census");
  // A crude ranked-list guard: the output holds only numbers and the fixed metric keys, never an
  // array of company-shaped objects.
  const knownKeys = new Set(["universe", "distributions", "baseRates", "defensiveHistogram", "grahamCriteria", "groups"]);
  ok(Object.keys(a).every((k) => knownKeys.has(k)), "top-level shape is census sections only");

  // The new Buffett/Graham metrics: present, sane, and probabilities where they are shares.
  ok(a.distributions.roeThroughCycle && a.distributions.roeThroughCycle.n > 500, "a real ROE sample");
  ok(a.distributions.currentRatio && a.distributions.currentRatio.n > 100, "a real current-ratio sample");
  const newShares = [a.baseRates.durableRoic15.share, a.baseRates.roeAtLeast15.share, a.baseRates.currentRatioAtLeast2.share, a.baseRates.interestCoverAtLeast10.share];
  ok(newShares.every((s) => s == null || (s >= 0 && s <= 1)), "new base-rate shares within [0,1]");
  // Durability is a subset of the median test: no more names clear the bar in EVERY year than clear
  // it at the median, so the durable share cannot exceed the median-based share.
  ok(a.baseRates.durableRoic15.share == null || a.baseRates.roicAtLeast15.share == null || a.baseRates.durableRoic15.share <= a.baseRates.roicAtLeast15.share + 1e-9, "durable-15 share ≤ median-15 share");
  // Per-criterion Graham base rates: a non-empty list, each a probability, no identity leak.
  ok(Array.isArray(a.grahamCriteria) && a.grahamCriteria.length >= 4, `graham criteria broken out (${a.grahamCriteria.length})`);
  ok(a.grahamCriteria.every((c) => c.share == null || (c.share >= 0 && c.share <= 1)), "each graham-criterion share within [0,1]");

  // Grouping: an array of per-shelf censuses, in the fixed shelf order, each above the sample floor,
  // each carrying the same census shape and never a company identity.
  ok(Array.isArray(a.groups) && a.groups.length >= 3, `census sliced by shelf-grouping (${a.groups.length} groups)`);
  ok(a.groups.every((g) => g.readable >= 30), "every group clears the sample floor");
  ok(a.groups.every((g) => g.distributions && g.baseRates && g.defensiveHistogram), "every group carries a full census");
  ok(a.groups.every((g) => typeof g.noun === "string" && /^They .+\.$/.test(g.noun)), "every group is labelled by its shelf sentence");
}

if (fails) { console.error(`\n❌ almanacTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ almanacTest passed");
