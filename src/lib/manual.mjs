// The Manual's fixed order — docs/discovery-design.md feature 2. Three volumes (United States,
// ADRs, Japan), every company in strict alphabetical order by ticker, each entry numbered once
// across the whole run so a reader's ribbon ("entry 412 of 3,530") names a place in one book.
// Pure arithmetic over the fundamentals pools the pages already import; no ranking, no weighting,
// no membership test — presence in the pool is the only criterion, withheld or flagged records
// included, because the Manual is a reading surface, not a test.
//
// Memoized globally for the build, like computeLenses: every letter page, the index, and each of
// the ~3,530 company pages ask for the same canonical order, so the sort runs a single time.
let _cache = null;

const VOLUME_DEFS = [
  { key: "us", label: "United States", ordinal: "Volume one" },
  { key: "adr", label: "ADRs", ordinal: "Volume two" },
  { key: "jp", label: "Japan", ordinal: "Volume three" },
];

export function manualOrder(usCompanies, adrCompanies, jpCompanies) {
  if (_cache) return _cache;
  const pools = { us: usCompanies || [], adr: adrCompanies || [], jp: jpCompanies || [] };

  const volumes = VOLUME_DEFS.map((def) => {
    const entries = pools[def.key]
      .map((c) => ({ ticker: String(c.ticker || "").toUpperCase(), company: c }))
      .filter((e) => e.ticker)
      .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
    return { ...def, entries, count: entries.length };
  });

  // One running entry number across the three volumes, in volume order — the page number of the
  // whole Manual. Plus, per volume, the letter groupings (first letter of the ticker) and each
  // entry's prev/next neighbor within its own volume, for the company pages' manual-order links.
  let n = 0;
  const neighbors = {}; // `${volKey}:${ticker}` -> { prev, next, n, letter, volKey }
  for (const vol of volumes) {
    vol.letters = new Map(); // letter -> entries (insertion order is alphabetical already)
    vol.entries.forEach((e, i) => {
      e.n = ++n;
      e.letter = e.ticker[0];
      if (!vol.letters.has(e.letter)) vol.letters.set(e.letter, []);
      vol.letters.get(e.letter).push(e);
      neighbors[`${vol.key}:${e.ticker}`] = {
        prev: i > 0 ? vol.entries[i - 1].ticker : null,
        next: i < vol.entries.length - 1 ? vol.entries[i + 1].ticker : null,
        n: e.n,
        letter: e.letter,
        volKey: vol.key,
      };
    });
  }

  _cache = { volumes, total: n, neighbors };
  return _cache;
}

// The manual page (and anchor) where a ticker's entry lives — shared by the resume marker, the
// company pages' "its place in the Manual" link, and the letter pages' cross-links.
export function manualHref(volKey, ticker) {
  const t = String(ticker || "").toUpperCase();
  if (volKey === "jp") return `/manual/japan#${t}`;
  return `/manual/${volKey}/${t[0].toLowerCase()}#${t}`;
}

// The Manual's page sequence, letter by letter and volume by volume, so "next" at the end of the
// United States Z page turns to the ADRs' A page and the last ADR page turns to Japan — the book
// reads straight through.
export function manualPageChain(volumes) {
  const chain = [];
  for (const v of volumes) {
    if (v.key === "jp") {
      chain.push({ href: "/manual/japan", label: v.label, volKey: v.key, letter: null });
    } else {
      for (const L of v.letters.keys())
        chain.push({ href: `/manual/${v.key}/${L.toLowerCase()}`, label: `${v.label} · ${L}`, volKey: v.key, letter: L });
    }
  }
  return chain;
}
