// quoteWeld.mjs — the shared machinery of every qualitative lane (Build 3 of the 2026-07-30
// survey, docs/qualitative-desks-survey.md §M3/M5/M6). Three tools, one doctrine: a page may
// weld a chip (a highlighted figure) to a filer's sentence ONLY when the chip is either a
// literal substring of that sentence or the desk's own XBRL-computed figure — asserted at
// WRITE time, so a transposed digit or a paraphrased number is structurally impossible, not
// merely unlikely. A lane that cannot pass the assertion ships the quote alone, or nothing.

// ---- the weld ----
// weld(quote, chips) -> { quote, chips } or throws. Each chip: { text, kind }, where kind is
//   "verbatim"  — text must appear in the quote character-for-character;
//   "computed"  — text is the desk's own figure from XBRL (the caller's responsibility), and
//                 `source` must name the line it was computed from, for the audit floor.
export function weld(quote, chips) {
  const q = String(quote || "");
  if (!q.trim()) throw new Error("quoteWeld: empty quote");
  for (const c of chips || []) {
    if (!c || typeof c.text !== "string" || !c.text.trim()) throw new Error("quoteWeld: empty chip");
    if (c.kind === "verbatim") {
      if (!q.includes(c.text)) throw new Error(`quoteWeld: chip "${c.text}" is not a substring of the quote — a welded figure must be the filer's own characters`);
    } else if (c.kind === "computed") {
      if (!c.source) throw new Error(`quoteWeld: computed chip "${c.text}" names no source line`);
    } else {
      throw new Error(`quoteWeld: chip kind "${c.kind}" is neither verbatim nor computed`);
    }
  }
  return { quote: q, chips: chips || [] };
}

// ---- heading-scoped note windows (M5) ----
// The criticalEstimates() pattern generalized: find a heading (the LAST match by default —
// note headings echo in the TOC and cross-references, and the real disclosure sits deep),
// then return the bounded window of sentences after it. Five desks target note headings this
// way (unpaid-losses, reinsurance, regulatory matters, claims payable, critical estimates).
export function noteWindow(text, headRe, { maxChars = 30000, take = "last", boundRes = [] } = {}) {
  if (!text) return null;
  const re = new RegExp(headRe.source || headRe, (headRe.flags || "i").replace("g", "") + "g");
  let at = -1, m;
  while ((m = re.exec(text)) !== null) { at = m.index; if (take === "first") break; }
  if (at < 0) return null;
  let win = text.slice(at, at + maxChars);
  for (const br of boundRes) {
    const b = new RegExp(br.source || br, br.flags || "i");
    const bm = win.slice(200).search(b);
    if (bm >= 0) win = win.slice(0, 200 + bm);
  }
  return win;
}

// ---- combined-registrant dedupe (M6) ----
// A combined filing (WEC and its utility subsidiaries; Southern and its opcos) repeats every
// disclosure sentence two or three times with only the entity name changed. Jaccard over word
// shingles catches the near-duplicates a string-set misses; the FIRST occurrence stands (the
// parent's, in every combined filing sampled).
// 0.65: the pinned combined-registrant pair ("$177.2… Wisconsin Electric" vs "$178.9…
// Wisconsin Gas") scores 0.69 on word shingles — a subsidiary swap changes the number and the
// entity, nothing else — while a genuinely different sentence in the same note scores ~0.05.
// The gap is wide; the threshold sits in it, nearer the duplicates.
export function jaccardDedupe(sents, { threshold = 0.65 } = {}) {
  const kept = [];
  const shingles = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const sims = (a, b) => {
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const uni = a.size + b.size - inter;
    return uni ? inter / uni : 0;
  };
  const keptSh = [];
  for (const s of sents || []) {
    const sh = shingles(s);
    if (keptSh.some((k) => sims(k, sh) >= threshold)) continue;
    kept.push(s);
    keptSh.push(sh);
  }
  return kept;
}
