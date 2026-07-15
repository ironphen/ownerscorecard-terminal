// Share-count scale normalization, shared by the US and ADR fetchers (docs/correctness-campaign.md
// N8). No top-level I/O — this file exists so a fetcher can import the rule without executing
// another fetcher's startup.
//
// The problem: filers tag share counts in units, thousands, or millions, and switch mid-record —
// one year reads 42,900 against 42.5M neighbors (Amerant FY2019, tagged in thousands), and the
// per-share record across that seam is off a thousandfold.
//
// The rule, learned the hard way (the first design anchored to Math.max and would have scaled 69
// correct ADR records UP toward single mistagged-HIGH years — Fresenius tags one year 3.06e11
// against a true ~3.06e8 — while erasing the very audit signal that catches the class):
//
//   1. MAJORITY WINS. Group the present years by scale class (order of magnitude, base 1000). The
//      class holding a strict majority of years is the record's true scale; its median is the
//      reference. No majority → return everything as-filed and let auditContinuity flag the mess —
//      refusing to guess is the doctrine ("a wrong number is worse than a missing one").
//   2. INTERIOR ONLY. An outlier is corrected only when the nearest present year on EACH side sits
//      in the majority class — the V-shape (or Λ-shape) that marks a one-year mistag. An outlier at
//      the record's EDGE, or in a run, stays as-filed: a pre-SPAC shell's genuine 109k shares
//      (BRCC) and a first-year mistag (FMS FY2016) are indistinguishable by arithmetic, so both
//      stay untouched and flagged, for the filing re-read to settle.
//   3. BOTH DIRECTIONS. A thousandfold-LOW year scales up (Amerant); a thousandfold-HIGH year
//      scales down (FRHC's neighbors). Steps of ×1000 only — that is what a units/thousands/
//      millions mistag is — and the result must land within 50× of the reference or the year stays
//      as-filed.
const clsOf = (v) => Math.round(Math.log10(v) / 3); // scale class: ~units / thousands / millions …

// The record's trustworthy scale reference: the median of the majority scale class, or null when
// no strict majority exists. Callers that need a reference for a SINGLE fresh observation (the
// latest-annual or TTM count) use this instead of Math.max — a single mistagged-HIGH year in the
// history must never become the scale the current count is corrected toward.
export function majorityShareRef(byYear) {
  const vals = Object.values(byYear).filter((v) => v != null && v > 0);
  if (vals.length < 3) return null;
  const classes = new Map();
  for (const v of vals) { const c = clsOf(v); classes.set(c, (classes.get(c) || 0) + 1); }
  const [majClass, majCount] = [...classes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (majCount * 2 <= vals.length) return null;
  const maj = vals.filter((v) => clsOf(v) === majClass).sort((a, b) => a - b);
  return maj[Math.floor(maj.length / 2)];
}

export function normalizeShareScale(byYear) {
  const years = Object.keys(byYear).filter((y) => byYear[y] != null && byYear[y] > 0);
  if (years.length < 3) return byYear; // no majority to speak of

  const classes = new Map();
  for (const y of years) {
    const c = clsOf(byYear[y]);
    classes.set(c, (classes.get(c) || 0) + 1);
  }
  const [majClass, majCount] = [...classes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (majCount * 2 <= years.length) return byYear; // no strict majority — refuse to guess

  const majVals = years.filter((y) => clsOf(byYear[y]) === majClass).map((y) => byYear[y]).sort((a, b) => a - b);
  const ref = majVals[Math.floor(majVals.length / 2)];

  // Correct maximal RUNS of consecutive off-scale years, but only runs BOUNDED on both sides by
  // majority-class years — a wide V (Amerant's 2017–2019 sit thousands-tagged between correct
  // 2016 and 2020). A run touching the record's edge stays as-filed: a pre-SPAC shell's genuine
  // 109k count (BRCC) and a first-year mistag (FMS) are indistinguishable by arithmetic, so both
  // stay untouched and flagged, for the filing re-read to settle.
  const ordered = years.map(Number).sort((a, b) => a - b);
  const out = { ...byYear };
  const dist = (x) => Math.abs(Math.log10(x / ref));
  let i = 0;
  while (i < ordered.length) {
    if (clsOf(byYear[ordered[i]]) === majClass) { i++; continue; }
    let j = i;
    while (j < ordered.length && clsOf(byYear[ordered[j]]) !== majClass) j++;
    // run = ordered[i .. j-1]; bounded iff a majority year exists on BOTH sides.
    if (i > 0 && j < ordered.length) {
      for (let k = i; k < j; k++) {
        const v = byYear[ordered[k]];
        // Step ×1000 toward the reference while each step strictly shrinks the (log) distance,
        // then accept only if the result lands within 5× of the reference — a units/thousands/
        // millions mistag corrects to ~1×; anything that doesn't is not a scale mistag.
        let s = v;
        while (dist(s * 1000) < dist(s)) s *= 1000;
        while (dist(s / 1000) < dist(s)) s /= 1000;
        if (s !== v && s >= ref / 5 && s <= ref * 5) out[ordered[k]] = s;
      }
    }
    i = j;
  }
  return out;
}
