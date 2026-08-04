#!/usr/bin/env node
// Heartbeat: fail (so GitHub emails the owner on the scheduled run) if the whole data pipeline has
// gone quiet — every refresh silently stopped. The site already shows the data's vintage in its
// masthead, but a visitor has to notice; this is the active alert behind that passive signal.
//
// The check is deliberately coarse: the FRESHEST top-level as-of stamp across the pools. If the
// pipeline is alive, the daily filing-wire refresh updates something every weekday, so the newest
// stamp is recent; if the whole thing dies, the newest stamp ages past the threshold and this fails.
// (It does not try to catch one monthly pool stalling while the daily wire runs — that is the
// coverage audit's job when those workflows execute. This catches "the whole thing stopped.")
//
// Caveat worth knowing: GitHub disables scheduled workflows after 60 days with no repo commits, which
// would also silence this heartbeat — but a live pipeline commits daily, and a dead one trips this
// within days, long before the 60-day window. So it covers the realistic outage.
//
//   node scripts/checkFreshness.mjs            # MAX_FRESH_DAYS defaults to 6 (covers a long weekend)
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "src", "data");
const MAX_FRESH_DAYS = Number(process.env.MAX_FRESH_DAYS || 6);
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return null; } };
const FILES = ["fundamentals.json", "fundamentals.adr.json", "fundamentals.jp.json", "fundamentals.eu.json", "language.json", "rates.json", "wire.json"];

const stamps = FILES.map((f) => ({ f, asOf: read(f)?.asOf })).filter((x) => typeof x.asOf === "string" && /^\d{4}-\d{2}-\d{2}/.test(x.asOf));
if (!stamps.length) { console.error("❌ No as-of stamps found — cannot verify freshness."); process.exit(1); }

const now = Date.now(); // run-time only, for an age delta; never written anywhere
const ageDays = (iso) => Math.floor((now - Date.parse(iso.slice(0, 10) + "T00:00:00Z")) / 86400000);

console.log(`Data freshness (threshold ${MAX_FRESH_DAYS} days on the newest pool):`);
let freshest = Infinity;
for (const s of stamps.sort((a, b) => (a.asOf < b.asOf ? 1 : -1))) {
  const a = ageDays(s.asOf);
  freshest = Math.min(freshest, a);
  console.log(`  ${s.f.padEnd(26)} as of ${s.asOf}  (${a}d ago)`);
}

const problems = [];
if (freshest > MAX_FRESH_DAYS) {
  problems.push(`STALE: the freshest pool is ${freshest} days old (> ${MAX_FRESH_DAYS}) — the data pipeline appears to have stopped. Check the Fundamentals and Filing Wire workflows.`);
}

// ---- the daily legs, each on its own calendar ----
// The freshest-pool test above is coarse BY DESIGN and cannot see one file stalling while the
// others keep running. That blind spot cost three days of stale wire in August 2026: the filing
// wire stopped committing on the 1st (a golden test pinned to live data broke when a filer
// reported, and the wire cron runs the suite BEFORE its commit step), while the fundamentals
// sweep kept refreshing normally — so the freshest stamp stayed young and this check stayed
// green while readers were served a three-day-old wire under a masthead that says "refreshed
// daily". The highest-cadence promise on the site gets its own threshold.
//
// Two days is the right line, not six: the wire runs weekdays and rewrites its as-of stamp on
// every run, so a healthy pipeline reads 0 days old every weekday afternoon. Two tolerates the
// Friday-to-Sunday gap and still fires on the Monday a run fails, rather than the Tuesday.
const dailyLeg = (file, maxDays, why) => {
  const s = stamps.find((x) => x.f === file);
  if (!s) { problems.push(`${file}: no as-of stamp — ${why}`); return; }
  const a = ageDays(s.asOf);
  console.log(`  ${file.padEnd(26)} as of ${s.asOf}  (${a}d ago)  [daily leg, max ${maxDays}d]`);
  if (a > maxDays) problems.push(`${file} is ${a} days old (> ${maxDays}) — ${why}`);
};
console.log("\nDaily legs (own calendar, independent of the freshest pool):");
dailyLeg("wire.json", 2, "the filing wire commits every weekday; a longer gap means its workflow is failing or its commit step is blocked, and the site is serving a stale wire under a daily promise");

// ---- rates legs: the valuation's bond anchor and every ADR/JP translation's USD basis ----
// Each leg of fetchRates fails soft and carries its prior value forever, so a permanently
// broken source (URL change, key requirement) freezes a leg silently while the wire keeps the
// masthead fresh. Assert each leg's own age here, plus a plausibility band so a mis-parsed
// value (0.42 where 4.2 was meant) can't sit unnoticed either.
const rates = read("rates.json");
if (rates) {
  console.log("\nRates legs:");
  const leg = (name, asOf, maxDays, val, lo, hi) => {
    if (!asOf) { problems.push(`rates.${name}: no as-of stamp`); return; }
    const a = ageDays(asOf);
    console.log(`  ${name.padEnd(24)} as of ${asOf}  (${a}d ago)  value ${val}`);
    if (a > maxDays) problems.push(`rates.${name} is ${a} days old (> ${maxDays}) — its source has likely broken while other refreshes kept running`);
    if (typeof val !== "number" || val < lo || val > hi) problems.push(`rates.${name} value ${val} is outside the plausibility band ${lo}–${hi}`);
  };
  // Thresholds carry each source's own calendar: DGS10 is daily but lags a business day and
  // pauses over holidays (10d covers the worst holiday cluster); the JGB series is MONTHLY and
  // publishes 5-8 weeks behind, so a May point in July is normal (100d catches a true freeze);
  // FX is daily (5d covers a long weekend).
  leg("tenYear (US 10-yr)", rates.asOf, 10, rates.tenYear, 0.3, 15);
  leg("jp10y (10-yr JGB)", rates.jp10yAsOf, 100, rates.jp10y, -1, 10);
  leg("fx (USDJPY sanity)", rates.fxAsOf, 5, rates.fx?.JPY ? 1 / rates.fx.JPY : undefined, 60, 300);
} else {
  problems.push("rates.json missing or unreadable — valuation bond anchor and ADR FX are unverified");
}

if (problems.length) {
  console.error("\n❌ " + problems.join("\n❌ "));
  process.exit(1);
}
console.log(`\n✅ Pipeline alive: freshest pool is ${freshest} day(s) old; rates legs current and plausible.`);
