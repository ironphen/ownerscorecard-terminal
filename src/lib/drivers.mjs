// drivers.mjs — the shared driver machinery: MD&A text extraction and the verified-quotation
// gates, extracted from scripts/fetchDrivers.mjs so the wire can prove its clauses against the
// same bar the company pages' Drivers section uses. One rulebook, two callers:
//
//   - fetchDrivers.mjs (10-K, the annual Drivers section): builds the XBRL changes from the
//     fundamentals history and passes them in — behavior identical to before the extraction.
//   - fetchWire.mjs (10-K and 10-Q, the wire's performance line): builds the changes from
//     companyfacts for the just-filed period and quotes only a clause that verifies against them.
//
// The gates are the doctrine: ANCHORED (the sentence opens on the line item), DIRECTED (its
// stated direction agrees with the computed sign), VERIFIED (a narrated figure matches the
// computed change), HONEST (results only, the current period only, silence over filler).
// Never a word of ours: the output is quotation plus arithmetic.

// ---- HTML → text blocks (block-level tags become breaks; entities decoded; tags stripped) ----
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", "#8217": "’", "#8216": "‘", "#8220": "“", "#8221": "”", "#8212": "—", "#8211": "–", "#160": " ", "#38": "&" };
function decode(s) {
  return s.replace(/&(#?\w+);/g, (m, e) => {
    if (ENT[e] !== undefined) return ENT[e];
    if (e[0] === "#") { const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : " "; }
    return " ";
  });
}
function toBlocks(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<\/?(?:p|div|li|tr|h[1-6]|br|table|td|th)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decode(s);
  return s.split("\n").map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// ---- MD&A span, longest candidate (a TOC row is short; the real one is huge) ----
// 10-K: Item 7 → Item 7A/8. 10-Q: Item 2 → Item 3/4. A quarter's MD&A runs shorter than a
// year's, so the floor below which a span is a misparse rather than the section drops with it.
const MDNA_ANCHORS = {
  "10-K": {
    start: /item\s*7\.?\s*[—:\-]?\s*management/i,
    end: /item\s*7a\.?\s*[—:\-]?\s*quantitative|item\s*8\.?\s*[—:\-]?\s*financial\s+statements/i,
    minLength: 4000,
  },
  "10-Q": {
    start: /item\s*2\.?\s*[—:\-]?\s*management/i,
    end: /item\s*3\.?\s*[—:\-]?\s*quantitative|item\s*4\.?\s*[—:\-]?\s*controls/i,
    minLength: 2500,
  },
};
function mdnaText(blocks, form = "10-K") {
  const { start, end: endRe, minLength } = MDNA_ANCHORS[form.startsWith("10-Q") ? "10-Q" : "10-K"];
  const spans = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].length < 140 && start.test(blocks[i])) {
      let end = blocks.length;
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[j].length < 140 && endRe.test(blocks[j])) { end = j; break; }
      }
      let size = 0;
      for (let k = i; k < end; k++) size += blocks[k].length;
      spans.push({ size, i, end });
    }
  }
  if (!spans.length) return null;
  spans.sort((a, b) => b.size - a.size);
  const { i, end } = spans[0];
  const text = blocks.slice(i, end).join(" ");
  return text.length < minLength ? null : text;
}

function splitSentences(text) {
  return text
    // A boundary is a sentence end followed by a capital — or by Apple-style lowercase brands
    // (iPhone, iPad, iMac...), which otherwise glue "…desktops. iPad iPad net sales…" into one.
    .split(/(?<=[.!?])\s+(?=[A-Z(“"$]|i[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 50 || s.length > 460) return false;
      if (/table of contents|%%/i.test(s)) return false;
      // Lenient on digits: the classical driver sentence ("increased $63.2 million, or 28.7%,
      // to $282.4 million for the year ended December 31, 2025...") legitimately runs ~25%
      // digits. Table debris is killed downstream by the anchor + direction-verb + cause gates,
      // which a header row can never satisfy.
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[a-zA-Z]/g) || []).length;
      return letters >= 60 && digits / (digits + letters) <= 0.40;
    });
}

// ---- gates ----
// Verb form ("revenue increased 22%") and noun form ("…, an increase of $92.4 million or
// 22.5%") — midcap filings overwhelmingly narrate in the second.
const UP = /\b(increased|grew|rose|improved|was\s+up|higher|an?\s+increase\s+of|growth\s+of)\b/i;
const DOWN = /\b(decreased|declined|fell|deteriorated|was\s+down|lower|a\s+decrease\s+of|a\s+decline\s+of)\b/i;
// The cause often lives in the NEXT sentence: "The increase in transaction revenue was
// primarily driven by…". A continuation opens on the change noun.
const CONTINUATION = /^["“']?(?:The|This)\s+(?:increase|decrease|growth|decline|improvement)\b/i;
const CAUSE = /driven\s+by|due\s+to|primarily|attributable\s+to|reflecting|led\s+by|because\s+of|as\s+a\s+result\s+of|resulting\s+from|partially\s+offset/i;
const FORWARD = /\b(expect(?:s|ed|ations?)?|anticipat\w*|outlook|guidance|going\s+forward|we\s+believe\s+.{0,40}\bwill\b)\b/i;
const SEG_GLUE = /^["“']?(?:revenues?|net\s+sales|sales)\s*[-–—:]/i;

// A named year must include the current fiscal year — kills prior-year comparison narration
// ("increased ... in 2024" inside an FY2025 filing). Sentences naming no year pass; the figure
// verification carries them.
function yearOk(s, fy) {
  const yrs = [...s.matchAll(/\b(20\d\d)\b/g)].map((m) => parseInt(m[1], 10));
  return !yrs.length || Math.max(...yrs) >= fy;
}

// A narrated figure adjacent to the anchor must match the computed change.
function verifyFigure(s, from, actualPct, actualDelta, pctTol) {
  const windowText = s.slice(from, from + 260);
  for (const m of windowText.matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/g)) {
    if (Math.abs(parseFloat(m[1]) - Math.abs(actualPct)) <= pctTol) return { kind: "pct", quote: `${m[1]}%` };
  }
  if (actualDelta) {
    for (const m of windowText.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million)/gi)) {
      const v = parseFloat(m[1].replace(/,/g, "")) * (/billion/i.test(m[2]) ? 1e9 : 1e6);
      if (Math.abs(v - Math.abs(actualDelta)) / Math.abs(actualDelta) <= 0.06) return { kind: "dollar", quote: m[0] };
    }
  }
  return null;
}

const CONSOLIDATED = [
  { key: "revenue", label: "Revenue", re: /^["“']?(?:In\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:Our\s+|The\s+Company['’]s\s+)?(?:Total\s+|Consolidated\s+|Net\s+)?(?:revenues?|net\s+sales|sales)\b/i },
  { key: "operatingIncome", label: "Operating income", re: /^["“']?(?:In\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:Our\s+|The\s+Company['’]s\s+)?(?:Total\s+|Consolidated\s+)?(?:operating\s+income|income\s+from\s+operations|operating\s+profit)\b/i },
  { key: "netIncome", label: "Net income", re: /^["“']?(?:In\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:Our\s+|The\s+Company['’]s\s+)?(?:Consolidated\s+)?(?:net\s+income|net\s+earnings)\b/i },
];

function directionAgrees(s, head, wantUp) {
  const up = UP.test(head), down = DOWN.test(head);
  if (!up && !down) return false;
  if (up && down) return true; // mixed sentence ("increased ... partially offset by lower ..."): allow; figure check decides
  return up === wantUp;
}

// The cause requirement, satisfiable by the sentence itself or by its continuation ("The
// increase was primarily driven by…"). Returns the text to ship, or null.
function withCause(s, next, fy) {
  if (CAUSE.test(s)) return s;
  if (next && CONTINUATION.test(next) && CAUSE.test(next) && yearOk(next, fy) && !FORWARD.test(next.slice(0, 200))) {
    const joined = `${s} ${next}`;
    return joined.length <= 560 ? joined : s + " " + next.slice(0, 540 - s.length) + "…";
  }
  return null;
}

// The caller supplies the XBRL changes to verify against: { [line key]: { pct, delta } }.
// fetchDrivers builds them from the fundamentals history; fetchWire from the filed period's
// companyfacts. A line with no change supplied is never quoted — no proof, no ship.
function pickConsolidated(sents, { fy = 2025, changes = {} } = {}) {
  const out = [];
  for (const { key, label, re } of CONSOLIDATED) {
    const chg = changes[key];
    if (!chg) continue;
    for (let i = 0; i < sents.length; i++) {
      const s = sents[i];
      const m = re.exec(s);
      if (!m) continue;
      if (key === "revenue" && SEG_GLUE.test(s)) continue;
      // A consolidated claim must not be anchored by a segment-scoped subject ("Operating
      // income for the AZZ Metal Coatings segment increased 11.5%..."): the figure can sit
      // within tolerance of the consolidated change by coincidence and ship a clause about
      // one segment as if it were the whole company. Scope words BEFORE the change verb kill
      // the sentence; a segment named after the verb is a cause, which is what we want quoted.
      const verbAt = s.slice(0, 300).search(new RegExp(UP.source + "|" + DOWN.source, "i"));
      const subject = verbAt > 0 ? s.slice(0, verbAt) : s.slice(0, 300);
      if (/\b(?:segment|division|business\s+unit|reporting\s+unit)\b/i.test(subject.slice(m[0].length))) continue;
      if (FORWARD.test(s.slice(0, 200))) continue;
      if (!yearOk(s, fy)) continue;
      if (!directionAgrees(s, s.slice(0, 300), chg.pct > 0)) continue;
      const text = withCause(s, sents[i + 1], fy);
      if (!text) continue;
      const v = verifyFigure(s, m[0].length, chg.pct, chg.delta, 1.0);
      if (!v) continue; // consolidated lines ship only figure-verified
      out.push({ line: key, label, pct: +chg.pct.toFixed(1), sentence: text, check: v.kind });
      break;
    }
  }
  return out;
}

export {
  decode, toBlocks, mdnaText, splitSentences,
  UP, DOWN, CONTINUATION, CAUSE, FORWARD, SEG_GLUE,
  yearOk, verifyFigure, directionAgrees, withCause,
  CONSOLIDATED, pickConsolidated,
};
