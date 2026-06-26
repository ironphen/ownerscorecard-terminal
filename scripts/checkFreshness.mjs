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
const FILES = ["fundamentals.json", "fundamentals.adr.json", "fundamentals.jp.json", "language.json", "rates.json", "wire.json"];

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

if (freshest > MAX_FRESH_DAYS) {
  console.error(`\n❌ STALE: the freshest pool is ${freshest} days old (> ${MAX_FRESH_DAYS}) — the data pipeline appears to have stopped. Check the Fundamentals and Filing Wire workflows.`);
  process.exit(1);
}
console.log(`\n✅ Pipeline alive: freshest pool is ${freshest} day(s) old.`);
