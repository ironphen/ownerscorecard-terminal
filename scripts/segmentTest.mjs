// Offline regression for compositionSentence — the segment-mix "what it is" line the hero falls
// back to when a company opens on a mission statement instead of a description (Amazon, Apple,
// Meta). It reads the company's own reportable segments, or product lines, and their revenue share.
// Geography answers "where", not "what", so it's excluded; a lone bucket or a single segment at
// nearly all of revenue teaches nothing and returns null, so the hero falls through to the computed
// industry phrase. Faithful to the real shapes in segments.json. Run with `npm test`.
import { compositionSentence } from "../src/lib/segments.mjs";

const seg = (total, by) => ({ revenueTotal: total, ...by });
const it = (label, revenue, operatingIncome = null) => ({ label, revenue, operatingIncome, qname: label });

const cases = [
  // Two or three operating segments, comfortably distinct → list all with their shares.
  ["amazon-like", seg(1000, { bySegment: { items: [it("North America", 590), it("AWS", 180), it("International", 230)] } }),
    /^Revenue is North America \(59%\), International \(23%\) and AWS \(18%\)\.$/],
  // A dominant segment with a tiny one that still carries the profit story (Reality Labs' losses
  // inside Meta) → both kept because the operating-income split itself informs.
  ["meta-like", seg(1000, { bySegment: { hasOperatingIncome: true, items: [it("Family of Apps", 990, 500), it("Reality Labs", 10, -90)] } }),
    /^Revenue is Family of Apps \(99%\) and Reality Labs \(1%\)\.$/],
  // Many product lines → name the top two, count the rest as "N more lines behind".
  ["apple-like", seg(1000, { byProduct: { items: [it("iPhone", 500), it("Services", 260), it("Wearables", 100), it("Mac", 80), it("iPad", 60)] } }),
    /^Revenue is led by iPhone \(50%\) and Services \(26%\), with 3 more lines behind\.$/],
  // "Segments" suffix and &amp; entity get cleaned for prose.
  ["label-clean", seg(1000, { bySegment: { items: [it("Research &amp; Development Segment", 600), it("Other", 400)] } }),
    /^Revenue is Research & Development \(60%\) and Other \(40%\)\.$/],
  // Geography only → null (it answers where, not what; the hero falls to the computed phrase).
  ["geo-only", seg(1000, { byGeography: { items: [it("United States", 600), it("International", 400)] } }), null],
  // One product at nearly all of revenue → no real breadth → null.
  ["single-dominant-product", seg(1000, { byProduct: { items: [it("Core", 960), it("Other", 40)] } }), null],
  // A lone segment → null.
  ["lone-segment", seg(1000, { bySegment: { items: [it("All", 1000)] } }), null],
  // No segment data at all → null.
  ["empty", null, null],
];

let pass = 0, fail = 0;
for (const [name, S, want] of cases) {
  const got = compositionSentence(S);
  const ok = want === null ? !got : !!(got && want.test(got));
  console.log((ok ? "ok   " : "FAIL ") + name + " -> " + JSON.stringify(got));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
