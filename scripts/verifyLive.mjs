// Does the site READERS reach carry the data we committed?
//
// Three checks already guard this pipeline and none of them asks that question. verifyStatic
// proves the pages we BUILT are sound, but it reads dist/ on the machine that built it. The
// heartbeat proves the data we COMMITTED is fresh, but it reads the repo's own stamps. The
// uptime probe proves the live URLs answer, but a six-month-old deploy returns 200 on every
// path it ever had. So the deploy itself — the step between a green build and a reader's
// screen — was the one link with no assertion on it.
//
// That gap produced a false diagnosis in both directions on 2026-07-31: a curl that silently
// returned nothing was read as "the site is stale" (it was current), while three red CI runs
// were read as "the deploys are blocked" (they were not — CI is a test gate that does not gate
// deploys). Neither reading was checkable, because nothing compared live to committed.
//
// The comparison here is exact rather than heuristic, and needs no marker maintenance: both
// stamps update themselves. THE WIRE STAMP is the fast signal — /wire prints "filings as of
// DATE" and its cron commits daily, so a frozen deploy shows within a day. THE FLOOR STAMP is
// the honest one every page carries — "data as of DATE", the OLDEST of the four pools, so it
// moves only when the stalest pool refreshes and can never make old data look current.
//
// A deploy in flight is not a failure: a cron can commit minutes before this runs, so the live
// side is allowed to sit one day behind the committed side. Two days behind is a stopped
// pipeline, and that is what this exits non-zero for.
import { readFileSync } from "node:fs";

const ORIGIN = (process.env.LIVE_ORIGIN || "https://ownerscorecard-terminal.ryanreinsant.workers.dev").replace(/\/$/, "");
const GRACE_DAYS = Number(process.env.LIVE_GRACE_DAYS || 1);
const UA = "OwnerScorecard deploy check (ryanreinsant@gmail.com)";

const asOfOf = (file) => {
  try { return JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), "utf8")).asOf || null; }
  catch { return null; }
};
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

async function page(path) {
  const res = await fetch(`${ORIGIN}${path}`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  const html = await res.text();
  // A response that arrives but carries nothing is the failure mode that fooled us once already:
  // treat a near-empty body as a hard failure rather than letting an absent stamp read as stale.
  if (html.length < 1000) throw new Error(`${path} returned ${html.length} bytes — an empty or blocked response, not a page`);
  return html;
}

const fails = [];
const note = (s) => console.log(`  ${s}`);

// 1. The wire's own stamp against the committed wire — the daily-cadence signal.
const wireCommitted = asOfOf("wire.json");
try {
  const html = await page("/wire");
  const live = html.match(/filings as of\s+(\d{4}-\d{2}-\d{2})/)?.[1] || null;
  if (!live) fails.push("/wire carries no \"filings as of\" stamp — the page rendered without its masthead");
  else if (!wireCommitted) note(`wire: live ${live} (no committed stamp to compare)`);
  else {
    const behind = days(live, wireCommitted);
    note(`wire: live ${live} · committed ${wireCommitted} (${behind}d behind)`);
    if (behind > GRACE_DAYS) fails.push(`the live wire is ${behind} days behind the committed wire (${live} vs ${wireCommitted}) — commits are landing but deploys are not reaching readers`);
  }
} catch (err) { fails.push(`/wire: ${err.message}`); }

// 2. The floor stamp every page carries, against the oldest pool we committed.
const pools = ["fundamentals.json", "fundamentals.adr.json", "fundamentals.jp.json", "fundamentals.eu.json"].map(asOfOf).filter(Boolean);
const floorCommitted = pools.length ? pools.slice().sort()[0] : null;
try {
  const html = await page("/c/KO");
  const live = html.match(/data as of\s+(\d{4}-\d{2}-\d{2})/)?.[1] || null;
  if (!live) fails.push("/c/KO carries no \"data as of\" stamp — the page rendered without its dateline");
  else if (!floorCommitted) note(`floor: live ${live} (no committed pools to compare)`);
  else {
    const behind = days(live, floorCommitted);
    note(`floor: live ${live} · committed ${floorCommitted} (${behind}d behind)`);
    if (behind > GRACE_DAYS) fails.push(`the live data floor is ${behind} days behind the committed floor (${live} vs ${floorCommitted}) — the deployed build predates the committed pools`);
  }
} catch (err) { fails.push(`/c/KO: ${err.message}`); }

if (fails.length) {
  console.error(`\nverifyLive: FAIL — ${fails.length} check(s) against ${ORIGIN}:`);
  for (const f of fails) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\nverifyLive: OK — ${ORIGIN} serves the vintage we committed.`);
