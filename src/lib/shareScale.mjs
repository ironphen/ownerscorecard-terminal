// Share-count scale normalization, shared by the US and ADR fetchers (docs/correctness-campaign.md
// N8). No top-level I/O — this file exists so a fetcher can import the rule without executing
// another fetcher's startup.
//
// The problem: filers tag share counts in units, thousands, or millions, and switch mid-record —
// McDonald's reports 752 for a year its neighbors call 750 million, Amerant tags three years in
// thousands against whole-share neighbors — and the per-share record across such a seam is off a
// thousandfold.
//
// The rule carries the scars of two failed designs, both caught by gates before shipping:
//   - Anchoring to Math.max unconditionally (the original US rule) scales correct records UP
//     toward a single mistagged-HIGH year: Fresenius tags one year 3.06e11 against a true
//     ~3.06e8, and the max-anchored ADR port would have corrupted 69 records while flattening
//     the very step signal auditContinuity keys on.
//   - Quantizing years into absolute scale classes (round(log10/3)) puts a class boundary at
//     ~31.6M — the middle of the natural share-count range — splitting legitimate neighbors
//     (29.7M | 35.6M) into different classes and refusing 47 records the max rule handled.
//
// So, two passes, each with its trust requirement stated:
//   PASS 1 — up-scale toward the maximum, ONLY for a clean REGIME SWITCH: walking the record in
//   year order, membership in the max's scale band changes EXACTLY ONCE, and the max-side regime
//   holds at least two years. That is the shape of a filer changing its reporting unit mid-record
//   (McDonald's: five years at ~7.5e8, then five at ~7.5e2 — one boundary) and never the shape of
//   scattered mistags (Freedom Holding's highs interleave: high-low-high-low). A lone year a
//   thousandfold above the rest (Fresenius, Bradesco) fails the two-year requirement and is
//   presumed to be the mistag itself — it must never anchor anything.
//   PASS 2 — bounded interior runs, band-based: with a strict majority of years inside a ±31.6×
//   band around the median, an off-band run BOUNDED on both sides by in-band years is a wide V —
//   a mistag, corrected ×1000 toward the median (both directions: Amerant's low years up,
//   Freedom Holding's 33-billion-share years down). A run touching the record's edge stays
//   as-filed: a pre-SPAC shell's genuine 109k count (BRCC) and a first-year mistag (FMS) are
//   indistinguishable by arithmetic, so both stay untouched and flagged, for the filing re-read.
//   PASS 0 — where the filer's own cover page speaks, it rules. Every 10-K cover carries
//   dei:EntityCommonStockSharesOutstanding in raw units; a year whose weighted-average count sits
//   a clean thousandfold off its own year's cover count is a scale mistag by the filing's own
//   testimony, and corrects toward it — per year, both directions, no majorities, no regimes.
//   ConocoPhillips is the proof case: TEN consecutive years tagged in thousands (the majority of
//   its record — majority voting inverts the truth), one year tagged ×1000 HIGH, both eras beside
//   correct units years; the cover counts arbitrate every one. Years without a cover count fall
//   through to passes 1–2 (foreign 20-F filers often carry no dei cover).
const BAND = Math.sqrt(1000); // ~31.6×: half a scale step — one band holds one honest scale

const medianOf = (vals) => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function normalizeShareScale(byYear, coverByYear = {}) {
  const years = Object.keys(byYear).filter((y) => byYear[y] != null && byYear[y] > 0);
  if (years.length < 2) return byYear;
  const out = { ...byYear };

  // PASS 0 — the filer's own cover count (see above). Within 5× is agreement (diluted vs
  // outstanding never differ that much); a clean ×1000ᵏ off corrects; anything else stays for
  // the audits — a cover count can be mistagged too, and 5× is the trust boundary.
  for (const y of years) {
    const d = coverByYear[y];
    if (d == null || d <= 0) continue;
    const distD = (x) => Math.abs(Math.log10(x / d));
    let s = out[y];
    while (distD(s * 1000) < distD(s)) s *= 1000;
    while (distD(s / 1000) < distD(s)) s /= 1000;
    if (s !== out[y] && s >= d / 5 && s <= d * 5) out[y] = s;
  }

  const vals = years.map((y) => out[y]);
  const med = medianOf(vals);
  const maxV = Math.max(...vals);

  // PASS 1 — the regime-switch up-scale (the McDonald's rule).
  const orderedYears = years.map(Number).sort((a, b) => a - b);
  const inMaxBand = (v) => v >= maxV / BAND;
  let transitions = 0;
  for (let i = 1; i < orderedYears.length; i++) {
    if (inMaxBand(out[orderedYears[i]]) !== inMaxBand(out[orderedYears[i - 1]])) transitions++;
  }
  const maxSide = vals.filter(inMaxBand).length;
  if (transitions === 1 && maxSide >= 2 && maxV <= med * 1000 * BAND) {
    for (const y of years) {
      let v = out[y];
      while (v * 1000 <= maxV) v *= 1000;
      out[y] = v;
    }
  }

  // PASS 2 — bounded interior runs against the median band (the Amerant/Freedom rule).
  const vals2 = years.map((y) => out[y]);
  const med2 = medianOf(vals2);
  const inBand = (v) => v >= med2 / BAND && v <= med2 * BAND;
  if (vals2.filter(inBand).length * 2 > years.length) {
    const ordered = years.map(Number).sort((a, b) => a - b);
    const dist = (x) => Math.abs(Math.log10(x / med2));
    let i = 0;
    while (i < ordered.length) {
      if (inBand(out[ordered[i]])) { i++; continue; }
      let j = i;
      while (j < ordered.length && !inBand(out[ordered[j]])) j++;
      // run = ordered[i .. j-1]; correct only if bounded by in-band years on BOTH sides.
      if (i > 0 && j < ordered.length) {
        for (let k = i; k < j; k++) {
          let s = out[ordered[k]];
          while (dist(s * 1000) < dist(s)) s *= 1000;
          while (dist(s / 1000) < dist(s)) s /= 1000;
          if (s !== out[ordered[k]] && s >= med2 / 5 && s <= med2 * 5) out[ordered[k]] = s;
        }
      }
      i = j;
    }
  }
  return out;
}

// The record's trustworthy scale reference for a SINGLE fresh observation (the latest-annual or
// TTM count): the median when a majority of years sit within one band of it, else null. Never the
// maximum — a single mistagged-HIGH year must not become the scale the current count is corrected
// toward.
export function majorityShareRef(byYear) {
  const vals = Object.values(byYear).filter((v) => v != null && v > 0);
  if (vals.length < 3) return null;
  const med = medianOf(vals);
  const inBand = vals.filter((v) => v >= med / BAND && v <= med * BAND).length;
  return inBand * 2 > vals.length ? med : null;
}
