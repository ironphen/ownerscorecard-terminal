// The vintage of the data the site is built from, taken from the pipeline's own top-level `asOf`
// stamps — NOT the build clock. The dateline reads the OLDEST stamp across the core pools, so if any
// one refresh silently stops (a fetch breaks, a cron is disabled), the displayed date freezes at that
// pool's last success and the staleness is visible, instead of a fresh `new Date()` making months-old
// data look like today's. `dataAsOf` is that honest floor; `dataAsOfLatest` is the most recent stamp.
//
// The stamps arrive as build-time constants (astro.config.mjs reads each pool file's own `asOf`
// and injects them via vite.define) rather than as imports of the pool files themselves: this
// module reaches the server-rendered account page through BaseLayout's dateline, and importing
// the pools here put ~45MB of them one Rollup chunking accident away from the Cloudflare worker —
// the exact leak scripts/verifyStatic.mjs exists to catch. Under plain node (no Vite) the
// constants don't exist and the stamps honestly read as absent.
const stamp = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/* eslint-disable no-undef */
export const dataAsOf = stamp(typeof __OSC_DATA_AS_OF__ === "undefined" ? null : __OSC_DATA_AS_OF__);
export const dataAsOfLatest = stamp(typeof __OSC_DATA_AS_OF_LATEST__ === "undefined" ? null : __OSC_DATA_AS_OF_LATEST__);
/* eslint-enable no-undef */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Format an ISO date with no Date()/timezone round-trip, so the build can't shift it across a day.
export function fmtAsOf(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
