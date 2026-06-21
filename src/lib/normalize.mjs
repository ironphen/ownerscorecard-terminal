// Normalized earnings power: Graham's discipline of valuing a business on what it earns
// through a cycle, not on one peak or trough year. Pure arithmetic on the record we hold:
// the through-cycle margins, the owner earnings those margins imply on today's revenue, and
// where the latest year sits against its own average, so the reader can tell a peak from a
// trough. No forecast, no verdict.
import { ownerEarningsMargin, ownerEarningsAbs, operatingMargin } from "./fundamentals.mjs";

// Median, not mean: the typical-year margin a single bad year cannot skew. Some filings carry
// a partial or mis-tagged revenue year that explodes a ratio (an owner-earnings margin of
// several hundred percent), so the through-cycle figure has to be robust to it.
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const netMargin = (L) => (L && L.netIncome != null && L.revenue ? L.netIncome / L.revenue : null);
// A margin beyond ±100% of revenue is not recurring earning power (a one-off gain, or a
// glitch year with bad revenue), so it is dropped from the normalization.
const plausible = (v) => v != null && Math.abs(v) <= 1.0;

export function earningsPower(company) {
  const H = (company.history || []).filter((h) => h?.lines?.revenue != null);
  if (H.length < 4) return null;
  const L = company.ttm?.lines || company.lines || {};
  const rev = L.revenue;
  if (!rev || rev <= 0) return null;

  const oem = H.map((h) => ownerEarningsMargin(h.lines, company)).filter(plausible);
  const opm = H.map((h) => operatingMargin(h.lines)).filter(plausible);
  const nm = H.map((h) => netMargin(h.lines)).filter(plausible);
  // Normalizing owner earnings needs a real owner-earnings history. The Japanese pool carries
  // it for only the latest two years (the five-year-summary limit), and two years is not a
  // cycle, so the section is honestly withheld there until the history deepens.
  if (oem.length < 4) return null;

  const normOeMargin = median(oem);
  const normOpMargin = median(opm);
  const normNetMargin = median(nm);
  const oemRange = oem.length ? [Math.min(...oem), Math.max(...oem)] : null;

  const latestOeMargin = ownerEarningsMargin(L, company);
  const latestNetMargin = netMargin(L);
  const normOE = normOeMargin != null ? normOeMargin * rev : null;
  const latestOE = ownerEarningsAbs(L, company);
  const normNet = normNetMargin != null ? normNetMargin * rev : null;

  // Where the latest year sits against its own through-cycle average. A factual peak/trough
  // read, not a judgment: a margin well above average means this year's reported earnings may
  // flatter the business; well below, it may understate it.
  let cyclePos = null;
  const refM = latestOeMargin != null && normOeMargin != null ? latestOeMargin : (latestNetMargin != null && normNetMargin != null ? latestNetMargin : null);
  const refNorm = latestOeMargin != null && normOeMargin != null ? normOeMargin : normNetMargin;
  if (refM != null && refNorm != null && refNorm !== 0) {
    const ratio = refM / refNorm;
    cyclePos = ratio > 1.15 ? "above" : ratio < 0.85 ? "below" : "at";
  }
  // How cyclical: the spread of owner-earnings margin across the record, relative to the mean.
  const swing = oemRange && normOeMargin && normOeMargin !== 0 ? (oemRange[1] - oemRange[0]) / Math.abs(normOeMargin) : null;

  return {
    span: `${H[0].fy}–${H[H.length - 1].fy}`,
    years: Math.max(oem.length, nm.length),
    normOeMargin, normOpMargin, normNetMargin, oemRange,
    latestOeMargin, latestNetMargin,
    normOE, latestOE, normNet,
    cyclePos, swing, rev,
  };
}
