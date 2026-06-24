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
  // The "latest reported" figure must sit on the SAME basis as the normalization, which is the latest
  // ANNUAL revenue (below) — not the rolling TTM, whose revenue and margin would mismatch the annual
  // base and set an apples-to-oranges comparison (a TTM owner earnings beside an annual-revenue
  // normalization). So read "this year" as the latest fiscal year; the TTM freshness lives in the
  // vital-signs strip, not in this through-cycle comparison.
  const Llatest = company.lines || company.ttm?.lines || {};
  // Normalize on the latest ANNUAL revenue, not the rolling TTM window: applying a through-cycle
  // median margin to a TTM revenue peak would inflate the normalized figure. Margin and the
  // revenue base it is applied to are kept on the same (annual) basis.
  const rev = company.lines?.revenue && company.lines.revenue > 0 ? company.lines.revenue : Llatest.revenue;
  if (!rev || rev <= 0) return null;

  // Structural break, not a cycle. A through-cycle median assumes the window's years repeat. When
  // revenue has fallen below half its in-window peak AND that peak is several years past — a one-time
  // windfall reversed (Moderna's COVID revenue collapsing ~90%), not a trough that recovers — the old
  // high-revenue years no longer describe the business, so applying their margins to today's revenue
  // would manufacture an earning power that is not real. Withhold the normalized figure, as for a
  // turnaround. A cyclical at a trough sits well above half its peak (oil, chemicals) and is unaffected.
  const revs = H.map((h) => h.lines.revenue).filter((v) => v != null && v > 0);
  const peakRev = revs.length ? Math.max(...revs) : null;
  const structuralBreak = peakRev != null && rev < peakRev * 0.5 && revs.lastIndexOf(peakRev) <= revs.length - 3;

  // Track which years actually carry a plausible owner-earnings margin, so the span and the year
  // count describe the series the median is built from, not the longer revenue history.
  const oemEntries = H.filter((h) => plausible(ownerEarningsMargin(h.lines, company)));
  const oem = oemEntries.map((h) => ownerEarningsMargin(h.lines, company));
  const opm = H.map((h) => operatingMargin(h.lines)).filter(plausible);
  const nm = H.map((h) => netMargin(h.lines)).filter(plausible);
  // Normalizing owner earnings needs a real owner-earnings history. The Japanese pool now carries
  // about five years (the deepened EDINET capex history); below four years is not a cycle, so the
  // section is honestly withheld until the record is long enough.
  if (oem.length < 4) return null;

  const normOeMargin = median(oem);
  const normOpMargin = median(opm);
  const normNetMargin = median(nm);
  const oemRange = oem.length ? [Math.min(...oem), Math.max(...oem)] : null;

  // A structural turnaround or chronic loss-maker has no single through-cycle earning power: its
  // through-cycle median owner-earnings margin sits at or below zero (the typical year is a loss).
  // For those a "normalized owner earnings" dollar figure is negative — it would call a record
  // profit year a trough — and a peak/trough ratio against a non-positive base is undefined, so we
  // withhold both and show only the margin range and the record. A profitable cyclical with the
  // odd negative trough year keeps its figure: a positive median IS a through-cycle earning power,
  // and normalizing across the bad years is exactly Graham's point. crossesZero only colours the
  // note (turnaround vs chronic loss), it does not by itself withhold.
  const crossesZero = oem.some((v) => v > 0) && oem.some((v) => v < 0);
  const normUnstable = normOeMargin == null || normOeMargin <= 0;

  const latestOeMargin = ownerEarningsMargin(Llatest, company);
  const latestNetMargin = netMargin(Llatest);
  const normOE = !normUnstable && !structuralBreak && normOeMargin != null ? normOeMargin * rev : null;
  const latestOE = ownerEarningsAbs(Llatest, company);
  const normNet = normNetMargin != null ? normNetMargin * rev : null;

  // Where the latest year sits against its own through-cycle average. Only when the normalization
  // is stable (a positive, meaningful through-cycle margin); a ratio against a near-zero or
  // negative base is undefined and would mislabel a record year as a trough.
  let cyclePos = null;
  if (!normUnstable && !structuralBreak) {
    const refM = latestOeMargin != null && normOeMargin != null ? latestOeMargin : (latestNetMargin != null && normNetMargin != null ? latestNetMargin : null);
    const refNorm = latestOeMargin != null && normOeMargin != null ? normOeMargin : normNetMargin;
    if (refM != null && refNorm != null && refNorm > 0) {
      const ratio = refM / refNorm;
      cyclePos = ratio > 1.15 ? "above" : ratio < 0.85 ? "below" : "at";
    }
  }
  // How cyclical: the spread of owner-earnings margin relative to a meaningful positive base. Only
  // a positive median of at least ~3% is a base a spread can be read against; below that the ratio
  // explodes and would call a turnaround or a near-breakeven business "a cyclical".
  const swing = oemRange && normOeMargin != null && normOeMargin >= 0.03 ? (oemRange[1] - oemRange[0]) / normOeMargin : null;

  return {
    span: oemEntries.length ? `${oemEntries[0].fy}–${oemEntries[oemEntries.length - 1].fy}` : `${H[0].fy}–${H[H.length - 1].fy}`,
    years: oem.length,
    normOeMargin, normOpMargin, normNetMargin, oemRange,
    latestOeMargin, latestNetMargin,
    normOE, latestOE, normNet,
    cyclePos, swing, rev, normUnstable, crossesZero, structuralBreak,
  };
}
