// The vintage of the data the site is built from, taken from the pipeline's own top-level `asOf`
// stamps — NOT the build clock. The dateline reads the OLDEST stamp across the core pools, so if any
// one refresh silently stops (a fetch breaks, a cron is disabled), the displayed date freezes at that
// pool's last success and the staleness is visible, instead of a fresh `new Date()` making months-old
// data look like today's. `dataAsOf` is that honest floor; `dataAsOfLatest` is the most recent stamp.
import fundamentals from "../data/fundamentals.json";
import adr from "../data/fundamentals.adr.json";
import language from "../data/language.json";
import rates from "../data/rates.json";

const stamps = [fundamentals?.asOf, adr?.asOf, language?.asOf, rates?.asOf]
  .filter((s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s))
  .map((s) => s.slice(0, 10))
  .sort();

export const dataAsOf = stamps.length ? stamps[0] : null;
export const dataAsOfLatest = stamps.length ? stamps[stamps.length - 1] : null;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Format an ISO date with no Date()/timezone round-trip, so the build can't shift it across a day.
export function fmtAsOf(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
