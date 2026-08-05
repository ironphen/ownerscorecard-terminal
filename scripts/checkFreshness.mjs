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

// ---- per-pool legs, and the FLOOR the reader actually sees ----
// The coarse freshest-pool test above cannot see one pool stalling while the others run — and the
// site's "company pages as of" label reads the OLDEST of the four fundamentals pools, so a single
// stalled pool IS the reader-visible date. That is how the label read July 18 on August 4 (the
// discarded Aug-1 monthly run was only ever half-recovered; the ADR pool sat 17 days and every
// check here stayed green). All four pools refresh weekly as of 2026-08-05, so each gets a 10-day
// leg (one missed Monday tolerated, the second cannot hide), and the floor itself gets 14.
console.log("\nPool legs (each weekly as of 2026-08-05):");
const POOL_FILES = ["fundamentals.json", "fundamentals.adr.json", "fundamentals.jp.json", "fundamentals.eu.json"];
for (const f of POOL_FILES) dailyLeg(f, 10, "this pool refreshes weekly; past 10 days its workflow has missed two Mondays and the floor label is dragging");
const poolAges = POOL_FILES.map((f) => stamps.find((x) => x.f === f)).filter(Boolean).map((s) => ({ f: s.f, age: ageDays(s.asOf) }));
if (poolAges.length === POOL_FILES.length) {
  const floor = poolAges.reduce((a, b) => (b.age > a.age ? b : a));
  console.log(`  ${"FLOOR (reader-visible)".padEnd(26)} ${floor.f} at ${floor.age}d`);
  if (floor.age > 14) problems.push(`the reader-visible floor ("company pages as of") is ${floor.age} days old via ${floor.f} — the site is dating itself stale on every page`);
} else {
  problems.push("not all four fundamentals pools carry an as-of stamp — the floor label cannot be trusted");
}

// ---- the monthly leg: the qualitative layer, read per ENTRY rather than per file ----
// The stamp at the top of language.json moves whenever ANY run writes it, including a run of a
// dozen tickers, so it cannot tell a full heal from a touch. What matters is the OLDEST entry:
// the qualitative extractor only improves companies it actually re-visits, and the monthly full
// pass is the only thing that visits everyone.
//
// On 2026-08-01 that pass ran fetch:filings successfully for over three hours, passed every audit,
// then failed an unrelated test and skipped its commit. Hours of work were discarded, nothing
// downstream noticed, and entries stayed frozen at whatever the last landed pass produced —
// Berkshire's business description sat nine words long, extracted before a fix that had already
// shipped. Every check in this file stayed green throughout, because the daily wire kept running.
//
// 45 days is the line: the cron is monthly, so a healthy pool reads at most ~31 days plus slack
// for a long run and one retry. Two missed months cannot hide.
const MAX_LANG_DAYS = Number(process.env.MAX_LANG_DAYS || 45);
const lang = read("language.json");
if (lang?.companies) {
  const entries = Object.values(lang.companies);
  const stamped = entries.filter((e) => typeof e?.builtAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.builtAt));
  const unstamped = entries.length - stamped.length;
  if (!stamped.length) {
    problems.push(`language.json: ${entries.length} entries and not one builtAt stamp — the qualitative layer predates the stamp, so a heal that never lands cannot be detected`);
  } else {
    const oldest = stamped.map((e) => e.builtAt.slice(0, 10)).sort()[0];
    const age = ageDays(oldest);
    console.log(`  ${"language.json (entries)".padEnd(26)} oldest extraction ${oldest}  (${age}d ago)  [monthly leg, max ${MAX_LANG_DAYS}d]`);
    if (age > MAX_LANG_DAYS) {
      problems.push(`the oldest language entry was extracted ${age} days ago (> ${MAX_LANG_DAYS}) — the monthly full re-extraction has not landed, so every extractor fix since is reaching only the companies that happened to file`);
    }
    // A pass that dies halfway leaves most of the pool unstamped while the rest looks current.
    if (unstamped > entries.length * 0.05) {
      problems.push(`${unstamped} of ${entries.length} language entries carry no builtAt stamp — the last full pass did not finish`);
    }
  }
}

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
