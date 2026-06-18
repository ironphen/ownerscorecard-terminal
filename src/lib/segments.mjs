// The one judge of whether a revenue breakdown is worth showing, shared by the "Where
// the money comes from" section and the business brief's "what it is" line so the two
// never disagree (one suppressing Exxon's accounting split while the other prints it).
//
// A breakdown earns its place only when it teaches. Either the profit is split across
// more than one part (the real lesson even when revenue is concentrated, the way Reality
// Labs' losses sit inside Meta), or the parts are genuinely distinct: for a company's own
// operating segments, two or more units of real size, since the small one is often the
// story (Google Cloud, Tesla's energy arm); for a product or geography split, real
// breadth rather than one bucket at nearly all of revenue. A lone bucket, an accounting-
// recognition line dressed as a segment (Exxon's "Sales and other operating revenue"), or
// a us-gaap subtotal that slipped through, teaches nothing.

const AGG_MEMBER = /^(OperatingSegments|ReportableSegments?|ReportableSegmentAggregationBeforeOtherOperatingSegment)Member$/i;
export const isAggregate = (qn) => AGG_MEMBER.test(String(qn || "").split(":").pop());

export function informativeBreakdown(b, kind, total) {
  if (!b || !total) return false;
  const items = [...(b.items || [])].filter((i) => i.revenue > 0).sort((a, c) => c.revenue - a.revenue);
  if (items.length < 2) return false;
  if (isAggregate(items[0].qname)) return false; // a subtotal leads: the data is corrupted
  const withOI = b.hasOperatingIncome ? items.filter((i) => (i.operatingIncome ?? 0) !== 0) : [];
  if (withOI.length >= 2) return true; // a real profit split is always worth seeing
  if (kind === "segment") return items.filter((i) => i.revenue / total >= 0.04).length >= 2;
  return items[0].revenue / total <= 0.85; // product/geography need real breadth
}

// Prefer the company's own reportable segments (the operating view, and the one that can
// carry profit), then product, then geography, skipping any axis that doesn't inform.
// The brief's "what it is" passes axes ["segment","product"], since geography answers
// where, not what.
export function pickPrimaryBreakdown(S, axes = ["segment", "product", "geography"]) {
  if (!S) return null;
  const total = S.revenueTotal ?? null;
  const byAxis = { segment: S.bySegment, product: S.byProduct, geography: S.byGeography };
  for (const kind of axes) {
    const raw = byAxis[kind];
    if (raw && informativeBreakdown(raw, kind, total)) return { kind, raw };
  }
  return null;
}

// Clean a segment/product label for prose: decode the XBRL entity, drop a trailing "Segment(s)".
export const cleanSegLabel = (s) => String(s || "").replace(/&amp;/gi, "&").replace(/\s+Segments?$/i, "").replace(/ And /g, " and ").trim();

// A one-line "what it is" built from the company's own revenue mix — the fallback the hero and
// the brief share when the filing's own description doesn't parse (a giant that opens on a mission
// statement: Amazon, Meta, Apple). Prefers operating segments, then product lines; geography
// answers "where", not "what", so it's left out. Reads out each part's revenue share. Returns null
// when no breakdown is informative, so the caller falls through to the computed industry phrase.
export function compositionSentence(S) {
  const pick = pickPrimaryBreakdown(S, ["segment", "product"]);
  if (!pick?.raw || !S?.revenueTotal) return null;
  const total = S.revenueTotal;
  const kindWord = pick.kind === "product" ? "line" : "segment";
  const sorted = [...pick.raw.items].filter((it) => it.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const big = sorted.filter((it) => (100 * it.revenue) / total >= 1);
  const items = big.length >= 2 ? big : sorted;
  if (items.length < 2) return null;
  const sh = (it) => Math.round((100 * it.revenue) / total);
  const fmtItem = (it) => `${cleanSegLabel(it.label)} (${sh(it)}%)`;
  const joinList = (arr) =>
    arr.length === 1 ? fmtItem(arr[0])
      : arr.length === 2 ? `${fmtItem(arr[0])} and ${fmtItem(arr[1])}`
        : `${arr.slice(0, -1).map(fmtItem).join(", ")} and ${fmtItem(arr[arr.length - 1])}`;
  return items.length <= 3
    ? `Revenue is ${joinList(items)}.`
    : `Revenue is led by ${fmtItem(items[0])} and ${fmtItem(items[1])}, with ${items.length - 2} more ${kindWord}s behind.`;
}
