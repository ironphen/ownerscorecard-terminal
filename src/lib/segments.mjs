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
