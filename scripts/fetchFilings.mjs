#!/usr/bin/env node
// fetchFilings.mjs, the qualitative read of the 10-K.
//
// Pulls each company's two most recent 10-K documents from EDGAR, extracts the
// Business (Item 1), MD&A (Item 7) and Risk Factors (Item 1A), and produces two
// things, both verbatim and sourced, never scored:
//   1. "What an owner would flag", the timeless sentences Graham and Buffett
//      would stop on (customer concentration, pricing power, debt covenants,
//      going-concern doubt, dilution, …), one per lens, from the latest filing.
//   2. "What changed", sentences genuinely new versus last year's filing
//      (number-normalized so figure updates don't count), plus length,
//      readability and hedging drift.
// Writes src/data/language.json.
//
// 100% EDGAR, no key, no LLM. Runs in CI (needs data.sec.gov + www.sec.gov).
//   npm run fetch:filings

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractDebtMaturity } from "./debtMaturity.mjs";
import { compactJson } from "../src/lib/dataFile.mjs";
// Build 4 of the qualitative survey (2026-07-31): the reserve-development lane welds the one
// MD&A / unpaid-losses-note sentence to the filed number via the shared weld law, and the
// lane is scoped by the insurer/managed-care ARCHETYPE, never SIC alone (Trupanion, a pet
// insurer inside SIC 6324, is the measured false-attacher the archetype rule exists for).
import { noteWindows, weld, jaccardDedupe } from "../src/lib/quoteWeld.mjs";
import { financialKind } from "../src/lib/archetype.mjs";
// Build 11: the managed-care MLR cost-trend lane tiers the filer's sentence against the
// desk's OWN computed medical loss ratio — the same guarded figure the scorecard shows.
import { medicalLossRatio } from "../src/lib/managedCare.mjs";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE = 200;

const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
// The ADR pool (foreign 20-F / 40-F filers) carries the same qualitative read, pulled from the
// English text of the foreign annual report. Optional — a missing file just means no ADRs this run.
let adrFundamentals = { companies: [] };
try { adrFundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.adr.json"), "utf8")); } catch { /* no ADR pool yet */ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      // 60s per-attempt timeout so a hung server can't freeze the run; an abort retries like any failure.
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(600 * a); }
  }
}

// ---- text processing ----

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Letter-spaced headings arrive as ADJACENT inline elements with no whitespace between
    // ("<span>B</span><span>USINESS</span>" becomes "B USINESS" once tags turn to spaces) —
    // Microsoft's whole 10-K is set that way, its Item anchors never matched, and every
    // section came back one word (Build 2 of the qualitative survey, 2026-07-31). Word
    // characters separated ONLY by inline tags glue back together; a real space or block
    // boundary in the source is never touched.
    .replace(/([A-Za-z0-9])(?:<\/(?:span|font|b|i|em|strong|u|sup|sub|a)>)+(?:<(?:span|font|b|i|em|strong|u|sup|sub|a)(?:\s[^>]*)?>)+(?=[A-Za-z0-9])/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;|&#39;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, "—")
    .replace(/&[a-z#0-9]+;/gi, " ")
    // Re-insert the space the HTML dropped between a sentence and the next, so the
    // splitter sees the boundary ("...customers.The loss" → "...customers. The loss").
    .replace(/([a-z,)])([.!?])([A-Z])/g, "$1$2 $3")
    .replace(/\s+/g, " ")
    .trim();
}

// Verbatim-but-tidy: strip a glued section sub-heading off the front of a quoted
// sentence (the HTML flattens "Competition" / "Loss Contingencies" / "Foo Bar :"
// onto the sentence that follows). Conservative, only a leading Title-Case run or
// a short colon-led label, never sentence content.
function cleanQuote(s) {
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\(\d+\)\s+/, ""); // leading footnote marker "(3) Legal-related…"
  s = s.replace(/^[A-Z][A-Za-z&/,\- ]{1,48}?\s*:\s+(?=[A-Z])/, "");
  s = s.replace(
    /^(?:[A-Z][A-Za-z&\-]+)(?:\s+(?:and|of|the|or|&|[A-Z][A-Za-z&\-]+)){0,3}\s+(?=(?:The|This|These|Those|Our|We|Your|During|For|Because|If|In|As|Although|While|When|Beyond|Any|Each|Some|Many|Most|No|A|An|Sales|Demand|Revenue)\b)/,
    ""
  );
  // A heading with a glued stray quote: 'Risk Factors " Our business…' → 'Our business…'
  s = s.replace(/^(?:[A-Z][A-Za-z&\-]+)(?:\s+[A-Z][A-Za-z&\-]+){0,3}\s*["'"]\s*(?=[A-Z])/, "");
  s = s.replace(/^["'"\s]+/, "");
  return s.trim();
}

// Capture from a start heading to the earliest following end heading. With a TOC at the front, the real
// section is the longest candidate, so keep the largest — but three artifacts in the largest filers broke
// that, each confirmed from the recorded extract.bizHead on real filings. (1) A table-of-contents row or
// a running page header ("Walmart Inc. Item 1 Business 8") is followed by a page number, not the business
// prose. (2) A cross-reference to the END heading ("see Item 1A. Risk Factors of this report") in the body
// is not the section end. (3) A cross-reference to the START heading itself ("...see \"Item 1. Business\"
// above", "Item 1. Business beginning on page 2", "...and Note 15") sits in LATER sections (risk, MD&A),
// and seeded a chunk that spanned all of risk to Item 2 — so risk and competition text reached the hero
// (Walmart, Coca-Cola, Bank of America, Alphabet, Chevron, Ford). The real heading is followed by the
// business prose and is not quoted; skip the rest, so a real heading bounds the section. A page number is
// digits not glued to a letter, so an opener that starts "3M Company …" is kept.
const PAGE_AFTER = /^[\s.·•…_-]*\d+(?![0-9A-Za-z])/;
const START_XREF_AFTER = /^["'”’\s.,;]*\b(above|below|herein|hereof|elsewhere|and\s+notes?\b|and\s+["'“]?(?:item|part)\b|beginning\s+on\s+page|of\s+this\s+(?:report|form|annual|filing|document)|information\s+required\s+by)/i;
const START_QUOTE_BEFORE = /["'“]\s*$/;
// "…read in conjunction with the description appearing in Item 1 … and Item 8 Financial
// Statements…" (TD SYNNEX) taught the guard its conjunctions: a heading is never preceded by
// a running clause's "and/with", and mid-prose references usually are.
const XREF_BEFORE = /\b(see|under|within|refer(?:ence|red)?|described|discussed|contained|included|noted|defined|set\s+forth|pursuant\s+to|provided|listed|appearing|presented|reported|found|shown|available|and|with)\s+(?:to|in|under|above|below|elsewhere)?\s*["'“]?\s*$/i;
// A cross-reference often cites the heading WITH its part — `see "Part I, Item 1. Business"`
// (Everspin's MD&A did, and the capture it seeded ran 19,061 words and beat the real Item 1 in
// the longest-candidate contest, so the hero lede became a design-win definition from the
// MD&A's Key Metrics block). "Part I," is never prose, so stripping a trailing part-label from
// the before-context and re-testing the same guards catches the cited form without touching a
// genuine "PART I" page banner, which has no see/quote context in front of it.
const stripPart = (ctx) => ctx.replace(/["'“]?\s*part\s+[ivx]+\b[\s,.:]*$/i, "");
function section(text, startRe, endRes, validate, minSpan = 40) {
  const cands = [];
  let m;
  const re = new RegExp(startRe, "gi");
  while ((m = re.exec(text)) !== null) {
    const from = m.index, afterHead = from + m[0].length, after = text.slice(afterHead, afterHead + 30);
    // Not the section start: a TOC row or running header (a page number follows), or a cross-reference to
    // the heading (quoted, followed by "above" / "of this report" / "and Note", or PRECEDED by "see" /
    // "as noted under" / "described in" — the same test the end headings get; Scholastic's only
    // in-body "Item 1. Business" was "as noted under Item 1. Business" inside its Risk Factors).
    const beforeCtx = stripPart(text.slice(Math.max(0, from - 44), from));
    if (PAGE_AFTER.test(after) || START_XREF_AFTER.test(after) || START_QUOTE_BEFORE.test(beforeCtx) ||
        XREF_BEFORE.test(beforeCtx)) continue;
    let to = text.length;
    for (const er of endRes) {
      const e = new RegExp(er, "gi");
      // minSpan defaults to 40 (don't match the start heading itself). The bare-title
      // fallback callers raise it to ~1,500: their prose-word anchors ("financial review",
      // "risk factors") get cited in a section's own first sentences, and no real narrative
      // section runs that short anyway.
      e.lastIndex = from + minSpan;
      let em;
      while ((em = e.exec(text)) !== null) {
        // A real heading, not a cross-reference: not verb/conjunction-led, not quoted.
        const emBefore = stripPart(text.slice(Math.max(0, em.index - 50), em.index));
        if (!XREF_BEFORE.test(emBefore) && !START_QUOTE_BEFORE.test(emBefore)) break;
      }
      if (em && em.index < to) to = em.index;
    }
    const chunk = text.slice(from, to);
    if (chunk) cands.push(chunk);
  }
  // Longest candidate wins — unless a validator says its CONTENT is wrong. A running page header
  // mid-Risk-Factors ("Item 1 Business" then risk prose, Scholastic) passes every positional guard
  // above: only reading the captured text catches it. When the longest fails, fall to the next;
  // when every candidate fails, return nothing — an empty section is a visible, honest failure,
  // where a poisoned one ships risk text as the company's own description.
  cands.sort((a, b) => b.length - a.length);
  if (!validate) return cands[0] || "";
  return cands.find(validate) || "";
}

// Risk-Factors prose has an unmistakable construction density ("could adversely affect", "no
// assurance", "if we fail to…") that business prose never approaches. Measured on the head of the
// chunk: a real Business section with a risky tail should not be thrown away for it.
const RISK_SMELL = /\b(?:could|may|might)\s+(?:adversely|materially|negatively|harm|impair|reduce|disrupt|result)|\bno assurance\b|\bif we (?:fail|are unable|cannot|do not)|\bmaterial(?:ly)? adverse\b|\bcould cause\b/gi;
function smellsLikeRisk(chunk) {
  const head = chunk.slice(0, 12000);
  const words = head.split(/\s+/).length || 1;
  const hits = (head.match(RISK_SMELL) || []).length;
  return (hits / words) * 1000 > 4;
}

// Keep prose only, drop table rows, figure dumps, and page artifacts.
function isProse(s) {
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[a-z]/gi) || []).length;
  if (letters < 40) return false;
  if (digits / (digits + letters) > 0.15) return false;
  return !/table of contents|form 10-k|dollars in millions|^\s*index\b/i.test(s);
}

function sentences(text) {
  return text
    .replace(/\d+\s+table of contents/gi, " ")
    .split(/(?<=[.!?]["”’']?)\s+(?=[A-Z(“"])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 500 && isProse(s));
}

// A looser split used only to find the hero description. A canonical opener
// ("<Company> is a <type>.") can run under the 50-character floor sentences() uses to
// drop table rows and fragments, and would be discarded before the scorer ever saw it.
// Here we keep sentences down to ~34 characters and rely on businessDescription's own
// subject and type checks to reject any real fragments. Separate so the heavier MD&A and
// Risk layers, which want the stricter floor, are untouched.
function isProseLead(s) {
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[a-z]/gi) || []).length;
  if (letters < 28) return false;
  if (digits / (digits + letters) > 0.18) return false;
  return !/table of contents|form 10-k|dollars in millions|^\s*index\b/i.test(s);
}
function leadSentences(text) {
  return text
    .replace(/\d+\s+table of contents/gi, " ")
    .split(/(?<=[.!?]["”’']?)\s+(?=[A-Z(“"])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 34 && s.length <= 600 && isProseLead(s))
    .slice(0, 45);
}

const tokenize = (s) => new Set(normalize(s).split(" ").filter((w) => w.length > 3));
const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
};

// Normalize so only language changes (not figures) count as "new".
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/\$?\d[\d,.]*\s*(million|billion|thousand|percent|%)?/g, "#")
    .replace(/\b(19|20)\d{2}\b/g, "#")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g, "#")
    .replace(/[^a-z #]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HEDGE = /\b(may|might|could|would|believe|estimate|expect|intend|anticipate|potential|possibly|uncertain|depends?|adverse|risk|expose|fluctuat|assum|approximat)\w*/gi;
const SIGNAL = /\b(risk|uncertain|adverse|declin|decreas|loss|weak|impair|litigation|competit|concentration|customer|supply|shortage|inflation|recession|headwind|slow|default|covenant|regulat|tariff)\w*/i;

function countSyllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const v = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").match(/[aeiouy]{1,2}/g);
  return v ? v.length : 1;
}

function metrics(text) {
  const sents = sentences(text);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const n = words.length || 1;
  const complex = words.filter((w) => countSyllables(w) >= 3).length;
  const fog = 0.4 * (n / (sents.length || 1) + (100 * complex) / n);
  const hedges = (text.match(HEDGE) || []).length;
  return { words: n, sentences: sents.length, fog: Math.round(fog * 10) / 10, hedgeDensity: hedges / n, sents };
}

// The Candor Read: how management talks to owners, the linguistic filter Buffett and Munger
// actually apply to a filing. Four deterministic signals over the MD&A, densities per 1,000 words
// so they compare across filings of any length, plus the verbatim sentences where management owns
// a miss. No sentiment lexicon bought off the shelf; just the vocabulary an owner cares
// about. Present, never pronounce: the page shows the densities, the trajectory and the actual
// sentences, and the reader judges the character.
const OWNER_TALK = /\b(per[\s-]?share|return on (invested |tangible )?(capital|equity)|intrinsic value|capital allocation|free cash flow|long[\s-]?term|compound\w*|reinvest\w*|book value|owner[\s']?s?\b)/gi;
const PROMO = /\b(world[\s-]?class|best[\s-]?in[\s-]?class|best[\s-]?of[\s-]?breed|industry[\s-]?leading|cutting[\s-]?edge|state[\s-]?of[\s-]?the[\s-]?art|revolutionary|transformational|disrupt\w*|synerg\w*|leverage our|unprecedented|paradigm|next[\s-]?gen\w*|seamless\w*|turnkey|holistic|mission[\s-]?critical|game[\s-]?chang\w*|robust\w*|compelling)/gi;
const ADJUSTED = /\b(non[\s-]?GAAP|adjusted (EBITDA|earnings|net income|operating income|operating|diluted|results|EPS|margin)|pro[\s-]?forma|constant currency|excluding (certain|the impact|special|one[\s-]?time|the effect)|core (earnings|operating)|normalized (earnings|EBITDA|results)|one[\s-]?time (item|charge|cost)s?|special items)/gi;
// A management owning a miss, in the first person and past tense, the rarest and most prized tell.
// The conditional/hypothetical guard keeps a forward-looking risk factor ("our results could fall
// short if…") out; genuine candor is declarative about what already happened. "should have" must be
// the regretful kind ("we should have acted sooner"), not "investors should have access."
// Narrowed 2026-07-30 (hygiene pass): "did not meet our underwriting standards" is a VIRTUE
// sentence (RLI describing business it declined) and "depreciated over estimated useful lives"
// is accounting boilerplate — both were shipping as confessed misses. "Well short of" added as a
// genuine admission form (UnitedHealth's own wording).
const ADMIT = /\b(were wrong|made (a |several |some )?mistakes?|misjudged|overpaid|over[\s-]?estimated\b(?![\s\S]{0,25}useful li(fe|ves))|too optimistic|(fell|were|was) (well )?short of|failed to (meet|deliver|achieve|execute)|were disappointed|disappointing (results|performance|year|quarter)|underperformed|below (our )?expectations|in hindsight|should have (done|known|anticipated|recognized|acted|been|moved|invested|exited|sold|reduced|avoided|foreseen|started|focused))\b/i;
const NOT_ADMIT = /\b(may|might|could|would|if\s|risk that|in the event|to the extent|no assurance|cannot assure|future)\b/i;
// Owning a miss means OWNING it. When the failure is pinned on someone else — a supplier, a partner,
// a customer who "failed to meet its obligations" — it is the opposite of candor, so it is excluded.
const BLAME_OTHERS = /\b(supplier|vendor|manufacturer|co-?manufacturer|co-?packer|partner|customer|client|counterparty|contractor|subcontractor|licensee|licensor|third[- ]party|distributor|borrower|tenant|reseller|franchisee|joint venture|other party)\b[\s\S]{0,30}\b(failed to|did not (meet|deliver|perform|pay|complete)|fell short|breached|defaulted|was unable)/i;
// A matched phrase, tidied for display: collapsed, lower-cased so a sentence-initial "World-class" and a
// mid-sentence "world-class" read as one word, with the few acronyms an owner expects restored.
function tidyPhrase(m) {
  return String(m)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\bgaap\b/g, "GAAP")
    .replace(/\bebitda\b/g, "EBITDA")
    .replace(/\beps\b/g, "EPS");
}
// The distinct phrases a detector actually matched, ranked by how often the filing used them and capped —
// the evidence, not a frequency. Buffett doesn't count "owner words per 1,000"; he reads the actual word
// the management reached for. This is what lets the page show "world-class, best-in-class, paradigm" rather
// than an abstract bar.
function distinctPhrases(text, re, cap) {
  const freq = new Map();
  for (const m of text.match(re) || []) {
    const p = tidyPhrase(m);
    if (p) freq.set(p, (freq.get(p) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map((e) => e[0]);
}
function candorSignals(text, sents) {
  if (!text) return null;
  sents = sents || sentences(text);
  const n = (text.match(/[A-Za-z]+/g) || []).length || 1;
  const per1k = (re) => Math.round(((text.match(re) || []).length / n) * 1000 * 10) / 10;
  const admissions = sents
    .map((s) => cleanQuote(String(s || "")).trim())
    .filter((s) => s.length >= 30 && s.length < 300 && /\b(we|our|management)\b/i.test(s) && ADMIT.test(s) && !NOT_ADMIT.test(s) && !BLAME_OTHERS.test(s))
    .filter((s, i, a) => a.indexOf(s) === i)
    .slice(0, 3);
  return {
    owner: per1k(OWNER_TALK), promo: per1k(PROMO), adjusted: per1k(ADJUSTED), admissions,
    // The verbatim words behind each density, so the page can show the language itself.
    ownerWords: distinctPhrases(text, OWNER_TALK, 6),
    promoWords: distinctPhrases(text, PROMO, 8),
    adjustedWords: distinctPhrases(text, ADJUSTED, 8),
  };
}

// The company's own one-sentence account of what it does, lifted verbatim from the
// top of Item 1 (Business). We strip stacked section headings, reject incorporation,
// forward-looking and risk-factor sentences, restore a subject lost to a split on
// "Inc.", and require the company itself to be the subject so we never pass off a
// risk line or a heading as the description. Their words; our numbers elsewhere for
// what they mean. Returns null when nothing clean is found, and the page falls back.
// "What it does" verbs. Only description-specific additions to the make/sell/provide core: pioneer,
// specialize and engineer almost always introduce a real description ("NVIDIA pioneered accelerated
// computing", "we specialize in…"). The generic build/make/create/power/enable were tried and reverted
// — they let MD&A junk through ("our fixed costs to build and run the business") for too little gain.
const BIZ_DOING = /\b(designs?|manufactures?|manufacturing|develops?|markets?|provides?|providing|operates?|sells?|selling|distributes?|produces?|producing|delivers?|offers?|offering|supplies|supplying|pioneers?|pioneered|specializ\w+|engineers?\s+and\s+\w|engineers?\s+\w+\s+(products|systems|solutions))\b/i;
const BIZ_ISA = /\b(is|are)\s+(a|an|the|one of)\b[^.]{0,60}?\b(compan|provider|manufacturer|producer|retailer|developer|operator|maker|supplier|distributor|platform|business|leader|corporation|holding|bank|insurer|airline|carrier|restaurant|brand|chain|franchis|network|marketplace|trust|utility|pharmaceutical|biopharmaceutical|biotechnolog|technolog|healthcare|energy|refiner|exchange|processor|grocer|wholesaler|broker|dealer|lender|integrator|miner|reit|firm|enterprise|agency|builder|contractor|franchisor|servicer|underwriter|reinsurer|conglomerate)\w*/i;
const BIZ_SKIP = /(was|were)\s+incorporated|incorporated\s+(under|in)\b|reincorporat|organized under the laws|founded in\s+\d|fiscal year|forward-looking|securities (act|exchange) of|report on form|unless the context|initial public offering|principal executive offices|market for (the )?registrant|common equity|equity securities|stockholder matters|\bmay\b|could\s+(adversely|result|harm|cause|materially|impair)|no assurance|our ability to|unsubstantiated|misleading|negative publicity|table of contents|\bcould\b|\bif (we|our|the company|a |an |adverse)|decline in (consumer|demand|sales)|reasonable basis for (our|the) opinion|provide a reasonable basis|standards of the public company accounting|fair value\b|cost of capital|non-?gaap|balance sheets? (include|reflect)|internally generated cash|dividends are reinvested|consideration we expect|we expect to be entitled|notice letter|corporate headquarters|(listed|traded|trades|trading|registered)\s+on (the )?(nasdaq|new york|nyse)|began trading|common stock (is|has)\s*(been\s*)?(listed|registered|traded)|in our (definitive )?proxy|responsive to this item|incorporated by reference|does not trade in the public market|\b(is|are) subject to\b|corporation (formed|organized)\b|further described (in|below|elsewhere)|\bor in the value of\b|value of the collateral|(reportable|reporting)\s+(business\s+)?segments?\s+are\b|represent(s|ed)\s+[^.]{0,28}\b(majority|\d+%)[^.]{0,18}\brevenue|we (define|use the term)\b|we consider [^.]{0,60}\bto occur when\b/i;
// A weak subject: the sentence is about employees, customers or a side note, not the
// company itself, so it is not a description of the business.
const BIZ_WEAK = /^(we also\b|when\s+we\b|founded\b|established\b|originally\b|since (our|its|we)\b|our (mission|vision|strateg|purpose|goals?|values|history|story|customers?|employees?|people|associates|team|more than|over\s|approximately|roughly|nearly)|our\b[^.]{0,40}\b(purpose|mission|vision)\b[^.]{0,120}\bis\s+to\b|we have (sharpened|built|been developing|also been|grown|expanded)|we strive|we seek\b|we aim\b|we (encounter|rely|depend|compete|consistently|correctly|pursue|understand|assess|estimate|disposed)\b|we have (entered|received)\b|[a-z][\w& .,'-]{0,38}'s\s+(vision|mission|purpose)\s+is\s+to\b|[a-z][\w& .,'-]{0,38}\b(strives?|aims?)\s+to\b|[a-z][\w& .,'-]{0,38}\bbelieves\b|[a-z][\w& .,'-]{0,30}'s\s+growth\b|[a-z][\w& .,'-]{0,30}\balso has\b)/i;
const HEAD_TOKEN = /^(item\s*1[ab]?\b\.?|part\s*i+\b\.?|general development of (the )?business|executive overview|business overview|company overview|about us|our company|our business|the company|introduction|business|general|overview)\s*[:.\-–—]?\s+/i;
// A broken sentence fragment, not a description: a cross-reference ("found in Items 1 and 2"), or a
// lead verb jammed into a preposition by bad splitting ("We provide, found in…", "We operate and in
// the U.S. as a whole"). KMI and WAL slipped a mangled hero through on these; reject them.
const BIZ_FRAGMENT = /\b(found|described|set forth|referred to|listed|contained|incorporated)\s+in\s+(items?|parts?|notes?|exhibits?)\b|\b(provide|operate|offer|sell|develop|design|market|supply|engage)s?\s*,\s*(found|described|in\b)|\b(operate|provide|offer|sell|develop|design|market|supply)s?\s+and\s+(in|to|with|as|the)\b/i;
// An MD&A results-of-operations sentence, not a description: a year-over-year change discussion
// ("Increases in operating income primarily result from…", "Gentex sales were $2.27 billion", "revenues
// increased 17.3% compared to…", "order backlog decreased"). These read as the business when a short
// name fragment ("com" in "income") false-matches the subject; reject them outright.
const BIZ_RESULTS = /\b(increases?|decreases?)\s+(in|of)\b[^.]{0,40}\b(result|primarily|compared|were|was)\b|\bprimarily (result(ed|s)? from|due to|driven by|attributable)|\bcompared (to|with)\s+(the\s+)?(prior|fiscal|preceding|last|\d{4})|\b(net sales|net revenues?|revenues?|sales|net income|operating (income|expenses?|profit)|gross (profit|margin)|order backlog|backlog|earnings|cash flows?)\s+(of\s+\$|were\s+\$|was\s+\$|increased|decreased|grew|declined|rose|fell|totaled|improved)|\b\d{1,2}(\.\d+)?\s?%\s+(increase|decrease|decline|growth|higher|lower)|\byear[-\s]over[-\s]year\b/i;
// A leading section heading glued to a brief sentence by the extraction ("Overview Archer is…",
// "Business Overview Aramark is…"). Stripped so the brief reads from the real subject; if a sentence
// is ONLY a heading/cross-reference, the BIZ_RICH check downstream still drops it.
// Longer, more-specific headings come first so "overview of business" is taken whole rather than the
// bare "overview" stripping only its first word and leaving "of business …".
const LEAD_HEADING = /^((overview|description|summary|nature)\s+of\s+(the\s+)?business|general\s+development\s+of\s+(the\s+)?business|executive\s+overview|business\s+overview|company\s+overview|overview\s+of\s+operations|business\s+update|recent\s+developments|results\s+of\s+operations|business\s+factors[\w\s]{0,45}?operations|segment\s+reporting|about\s+us|our\s+business|our\s+company|the\s+(business|company)|overview|introduction|business|general|properties)\b[\s:.\-–—]+/i;
const stripLeadingHeading = (s) => { let o = String(s || ""); for (let k = 0; k < 2 && LEAD_HEADING.test(o); k++) o = o.replace(LEAD_HEADING, ""); return o ? o.charAt(0).toUpperCase() + o.slice(1) : o; };
const LEAD_VERB = /^(is|are|operates?|provides?|markets?|designs?|develops?|sells?|offers?|supplies|distributes?|delivers?|produces?|manufactures?|engages?|creates?|builds?|makes?|serves?|owns?|publishes)\b/i;
// Signals a richer description: names products, markets, customers or segments rather
// than a bare "we operate" line.
const BIZ_RICH = /\b(products?|services?|segments?|brands?|markets?|customers?|solutions?|software|platforms?|stores?|technolog|devices?|equipment|systems?)/i;
// Describes the company's structure, not what it does ("operates through five segments",
// "conducts business through its subsidiaries"); a poor stand-in for a real description.
const BIZ_STRUCTURAL = /\boperat\w*\b[^.]{0,40}\bthrough\b|operating segments?|reportable segments?|reporting segments?|conduct\w*\s+(its\s+)?business through|our\s+(former\s+)?[\w& ]{0,30}?\bsegment\b|\bsegment\s+(consists|includes|combined|develops?|is preserved)\b/i;
// Additional descriptive forms beyond a plain verb or "is a <type>": "engaged in",
// "principal business", "a leading provider/manufacturer of", "<noun> of".
const BIZ_ENGAGED = /\b(engaged?|engages?)\s+(primarily\s+)?in\b|\b(principal|primary|core|main)\s+business\b|\b(leading|global|largest|world'?s|premier|principal)\b[^.]{0,40}\b(provider|manufacturer|producer|operator|supplier|distributor|retailer|developer|maker|company|leader|bank|insurer|partner|builder|contractor|shipbuilder)s?\b|\b(provider|manufacturer|producer|operator|developer|maker|distributor)s?\s+of\b/i;

// Non-description openers the scorer otherwise lets through because they carry a subject and a
// verb: a competition list ("Our competitors include banks, thrifts…", Bank of America) or an
// operating-process sentence ("We normally purchase our feedstocks weeks before…", Phillips 66).
// Neither says what the business is, so reject them — the hero then falls back to the segment mix
// or the computed phrase rather than printing a stray sentence as the description.
const BIZ_NOTDESC = /\bcompetitors?\s+(include|are|consist|range|comprise|compete)|^(we|our)\s+(normally|typically|generally|usually|principally|routinely|primarily\s+(purchase|buy|source|sell))\s+(purchase|buy|sell|acquire|obtain|source|procure|market|distribute|manufacture|produce|operate)\b/i;
// A product or subsidiary sentence the scorer otherwise rewards for carrying "is the": "Apple Vision
// Pro is the Company's spatial computer based on its visionOS operating system." The subject is a
// thing the company owns, not the company, so it must never stand in as the description — reject it,
// and let the real "<Company> designs/operates …" line (or the segment mix) win instead.
const BIZ_PRODUCTREF = /\bis\s+(?:the\s+)?(?:compan|registrant|firm|group|corporation|business|parent)\w*['’]s\b/i;

// A mission-framed opener that still names a concrete business: the largest retailers and service
// companies open Item 1 on what they do FOR customers ("Walmart Inc. helps people around the world save
// money and live better, in retail stores and through eCommerce") rather than "designs/operates …". A
// bare service verb is mission fluff, so accept it only when a concrete commerce or operating channel is
// named alongside it (retail, eCommerce, stores, restaurants, branches) — never on "we help businesses
// succeed with our platform". Paired, it is a real, verbatim description of the business.
const BIZ_SERVE = /\b(helps?|serves?|enables?|empowers?|connects?|powers?)\b/i;
const BIZ_CHANNEL = /\b(retail|wholesale|e-?commerce|online|marketplace|web ?sites?|mobile apps?|stores?|outlets?|supermarkets?|restaurants?|warehouses?|clubs?|branches?|dealerships?|pharmac\w+|grocer\w*)\b/i;

// Human-capital prose. The post-2020 Item 1 "Human Capital" subsection is written to read like a
// description ("our employees are the key to our success…") and never is one — Wells Fargo's hero
// was its workforce paragraph. Never a lede, never a brief line.
const BIZ_HUMANCAP = /\bhuman capital\b|\b(?:our|the company'?s?|its)\s+(?:employees?|people|workforce|associates?|team members?|talent)\b[^.]{0,80}\b(?:key|critical|vital|essential|important|greatest|core|success|asset|drive|foundation)|\b(?:attract\w*|retain\w*|develop\w*|recruit\w*|nurtur\w*|cultivat\w*)[^.]{0,40}\btalent\b|\btalent[\s-]rich\b|\bcommitted to (?:our|the|its)\s+(?:employees?|people|associates?|workforce|team)\b|\binvest\w*\s+in\s+(?:our|its|their)\s+(?:employees?|people|workforce|team|associates?)\b|\b(?:market[\s-])?competitive\s+(?:compensation|salaries|wages|pay)\b|\bcareer[\s-]development\b|\bwork[\s-]life\b|\b(?:diversity|equity|inclusion|belonging)\b[^.]{0,60}\b(?:workforce|workplace|employees?|culture|hiring)\b|\bemployee (?:experience|engagement|well-?being|development)\b|\b(?:salaries|wages)\s+and\s+benefits\b|\bteam members?\b[^.]{0,60}\b(?:promot\w+|develop\w+|train\w+|career)/i;

// Corporate-lineage prose: renames, brand identities, successions, spin-off ancestry — the
// company's paperwork history, not its business. Marzetti's hero was its rebrand announcement.
const BIZ_LINEAGE = /\bchang\w+\s+(?:our|its|the)\s+(?:company\s+|corporate\s+)?name\b|\brenam\w+|\bbrand identity\b|\bformerly\s+(?:known|named|called)\b|\bname change\b|\bsuccessor\s+(?:company|corporation|entity|issuer|to)\b|\bspun\s+off\b|\bspin-?off\s+(?:from|of)\b|\btraces\s+its\s+(?:roots|history|origins)\b|\bour (?:story|history|heritage)\b/i;

// A pure legal-status recital ("is a Delaware corporation, a bank holding company and a financial
// holding company") is true and says nothing about the business. Rejected only when the sentence
// carries no doing/product content, so "a bank holding company providing retail banking across
// twelve states" survives.
const BIZ_RECITAL = /\b(?:bank|financial|savings\s+and\s+loan)\s+holding\s+company\b|\bregistered\s+(?:pursuant|under)\b|\bhereinafter\b|\bcollectively\s+referred\s+to\b/i;

// Aspirational abstraction — mission-statement vocabulary that names an ambition, not an
// operation ("shaping the future of sustainable transportation"). A scoring penalty alongside
// PROMO rather than a hard reject, because "leading provider of X" is honest, common phrasing.
const BIZ_ASPIRATIONAL = /\bshap(?:e|ing)\s+the\s+future\b|\bredefin\w+|\breimagin\w+|\b(?:dedicated|committed)\s+to\b|\bempower\w+|\binspir\w+|\bpassion\w*|\bpurpose-driven\b|\bguiding principles?\b|\bfounded on the belief\b|\bunmatched\b|\bworld-?leading\b|\bbetter\s+(?:future|world|tomorrow)\b|\bmake\s+(?:the|a)\s+difference\b|\bdifferentiat\w+\s+value\b|\bpositioned\s+(?:for|to)\b|\bauthentic\b[^.]{0,30}\bbrand\b/gi;

// Cross-reference debris: a sentence pointing the reader at another document is never a
// description of the business (Bank of America's briefs were pointers into its own MD&A).
const BIZ_XREF = /\bmanagement'?s\s+discussion\s+and\s+analysis\b|\bnote\s+\d+\b|\b(?:set forth|included|presented|contained)\s+(?:in|on|under)\s+(?:the\s+)?(?:information|pages?|item|section|note)\b/i;

// A Title-Case line is a heading the sentence-splitter glued a period onto, not a sentence
// (ADP's "Provide Unmatched Expertise and Outsourcing Solutions."). Headings have almost no
// lowercase words; a real sentence naming proper nouns still has its verbs and articles.
function isHeadingCase(s) {
  const midw = s.split(/\s+/).slice(1).filter((w) => /[a-z]/i.test(w));
  const capw = midw.filter((w) => /^[A-Z]/.test(w) && w.length > 3).length;
  const loww = midw.filter((w) => /^[a-z]/.test(w) && w.length > 3).length;
  return midw.length >= 4 && capw / midw.length > 0.55 && loww <= 1;
}

// Prose that describes the industry's weather rather than the company's business: competition
// boilerplate, risk narration, colon-list openers, trademark legalese, goals-speak. The lede
// scorer's positive tests (is-a / does-what) already exclude these; the brief accepts any
// concrete sentence, so it needs the negative list.
const BRIEF_NOISE = /\bcompet(?:e|es|ing|ition|itive|itors?)\b|\brisks?\b|\bas follows\b|\bsolely for convenience\b|\btrademarks?\b[^.]{0,60}\b(?:property|belong|appearing|registered)\b|^goals?\s+(?:are|is|include)\b|\bwe believe\b|\bdirectly attributable\b|\bcharged (?:directly )?to\b/i;
// A word doubled back-to-back ("Commercial Commercial loans…") is a section heading the text
// extractor glued onto the sentence that followed it.
const GLUED_HEADING = /\b([A-Z][a-z]{3,})\s+\1\b/;

// A brief line must stand alone: an opener leaning on unseen prior text ("These products…",
// "In addition…", "As previously announced…") reads as a non sequitur beneath the hero.
const BRIEF_ORPHAN = /^(?:these|those|this|it|they|both|such|each|also|additionally|in addition|as previously|as discussed|as described|as noted|accordingly|however|therefore|further|finally|for (?:more|additional|further) information|all historical|through \d{4}|in (?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2})\b/i;

// Pull the company's own one-line description from the top of Item 1. Rather than take
// the first sentence that passes, we collect candidates from the opening and score
// them, so the canonical "<Company> is a <type> ..." form and richer, company-named
// sentences win, with earliness as the tiebreaker (the opener is usually the intended
// overview). Verbatim, lightly cleaned; null when nothing clean is found.
function businessDescription(sents, name, ticker) {
  if (!Array.isArray(sents)) return null;
  // Distinctive words from the company's name, for a robust subject match: handles
  // "Exxon Mobil" appearing as "ExxonMobil" in the filing, which a word-boundary on the
  // first word alone would miss. Legal suffixes and joiners are dropped.
  let nameWords = (name || "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !["the", "inc", "incorporated", "corp", "corporation", "company", "companies", "ltd", "plc", "llc", "holding", "holdings", "group", "and"].includes(w));
  // Drop generic leading words ("United", "American", "General"…) when a more distinctive
  // word remains, so a name like "United Therapeutics" is not matched by the unrelated
  // phrase "United States" elsewhere in the filing, which would pass off a stray line as
  // the company's own description.
  const GENERIC_NAME = new Set(["united", "american", "general", "national", "standard", "first", "global", "international", "pacific", "atlantic", "continental", "federal", "central", "western", "eastern", "northern", "southern", "new"]);
  const distinctive = nameWords.filter((w) => !GENERIC_NAME.has(w));
  if (distinctive.length) nameWords = distinctive;
  const cands = [];
  const slice = sents.slice(0, 25);
  const startsWithSubject = (t) => /^(we|our|us|the (company|registrant|firm|group|corporation|partnership|trust|bank))\b/i.test(t) ||
    nameWords.some((w) => t.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(w));
  for (let i = 0; i < slice.length; i++) {
    let s = cleanQuote(String(slice[i] || ""));
    let prev;
    do { prev = s; s = s.replace(HEAD_TOKEN, "").trim(); } while (s !== prev); // strip stacked headings
    // Clean the sentence BEFORE judging it, so a long parenthetical, a hedge, or a preamble
    // can't push the real description past the length cap or trip the skip checks. Order
    // matters: strip the noise, re-anchor at the company's name when it hides behind a
    // "Founded in 1904, Coty Inc. is ..." preamble, then restore a subject that an
    // abbreviation period or a parenthetical split off and left as a bare "is a ...".
    s = s.replace(/^we believe\s+(that\s+)?/i, "")
         .replace(/\s*\([^)]*\)/g, "")
         // Strip a comma appositive that sits between the name and its "is a <type>" payload
         // ("Rexford Industrial Realty, Inc., a Maryland corporation, together with our
         // subsidiaries, ... is a self-administered REIT"), so the description is not pushed
         // past the output cap and left as corporate boilerplate. Only when a real payload
         // ("is/are a/an/the …") follows, so a genuine appositive description is untouched.
         .replace(/,\s+(?:a |an |the |together with |referred to |known as |collectively |including |doing business as |formerly ).{0,200}?,?(?=\s+(?:is|are)\s+(?:a|an|the|one of|engaged|primarily|now|currently|headquartered))/i, " ")
         .replace(/,?\s+and its (wholly[- ]owned )?subsidiaries\b/i, "")
         .replace(/\s{2,}/g, " ").trim();
    // The full cleaned sentence, kept before any name-jump: disqualifying prose the jump cuts off
    // ("As previously announced… changing our company name to The Marzetti Company provides…")
    // must still disqualify, or the jump manufactures a fluent lie from the remainder.
    const sFull = s;
    if (name && nameWords.length) {
      let at = -1;
      // (a) The opener sits behind a date or preamble ("Founded in 1904, Coty Inc. is …"):
      // jump to the company's name. Anchoring on the name (not the verb) keeps a multi-word
      // name whole.
      if (!startsWithSubject(s)) {
        // Jump to the name only where it sits in subject position — followed by a verb or a
        // ", a/an <type>" appositive — so a mid-sentence brand mention ("…fast-casual CAVA
        // restaurants") is not mistaken for the subject and the line left a fragment.
        const alt = nameWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        const nameSubj = new RegExp(`\\b(?:${alt})\\b[\\w &.,'’-]{0,34}?(?:\\s+(?:is|are|was|were|provides?|operates?|designs?|develops?|manufactures?|makes?|markets?|sells?|offers?|supplies|distributes?|delivers?|produces?|serves?|engages?|owns?|builds?|creates?|enables?|helps?|pioneers?|pioneered|powers?|specializ\\w+)\\b|,\\s+(?:a|an)\\s+[a-z])`, "i");
        const m2 = s.match(nameSubj);
        // And never jump when the name is the OBJECT of the preceding clause — "changing our
        // company name to The Marzetti Company provides…" puts the name in subject position
        // grammatically, but the sentence is about the rename, not the business.
        if (m2 && m2.index > 0 && m2.index < 160 &&
            !/\b(?:to|as|into|of)\s+(?:the\s+)?$/i.test(s.slice(Math.max(0, m2.index - 12), m2.index))) at = m2.index;
      }
      // (b) The real opener is glued behind a heading or mission tagline with no period to
      // split on ("Our Mission … CAVA is a Mediterranean restaurant brand."): jump to the
      // first "<Name>/We <verb>" when what precedes it is a heading or short tagline rather
      // than a real clause, so we never truncate a genuine sentence.
      if (at < 0) {
        // The subject after the heading may be the company name, "we", OR a generic self-reference
        // ("The Company / The Registrant / The Group designs…") — Apple and many filers write the
        // last, and recognizing only name+"we" left their description stranded behind the heading.
        const subj = `(?:${[...nameWords, "we"].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|the\\s+(?:company|registrant|group|firm|corporation|business|partnership))`;
        const subjVerb = new RegExp(`\\b${subj}\\s+(?:is|are|provides?|designs?|develops?|operates?|manufactures?|makes?|markets?|sells?|offers?|supplies|distributes?|delivers?|produces?|serves?|engages?|builds?|creates?|owns?|enables?|helps?|pioneers?|pioneered|powers?|specializ\\w+)\\b`, "i");
        const m = s.match(subjVerb);
        if (m && m.index > 0 && m.index < 200) {
          const prefix = s.slice(0, m.index);
          const headingish = /\b(mission|vision|overview|strateg|history|organization|introduction|purpose|founded|headquarter|business|general|company|incorporated|together with|referred to|first-person|notations|principal|trends?|today|as of|during|for the (year|fiscal|quarter|period|three|six|nine|twelve)|for fiscal)\b/i;
          // Only when the name does not already appear in the prefix: if it does, the prefix
          // is the real subject ("Huntington Ingalls is …"), not a heading to jump over.
          if (!subjVerb.test(prefix) && !nameWords.some((w) => prefix.toLowerCase().includes(w)) &&
              (headingish.test(prefix) || (prefix.trim().length < 42 && !prefix.includes(",")))) at = m.index;
        }
      }
      if (at > 0) s = s.slice(at).trim();
    }
    if (LEAD_VERB.test(s) && name) s = `${name.trim()} ${s.charAt(0).toLowerCase()}${s.slice(1)}`; // restore a subject split off entirely
    // Restore a company name the section boundary clipped: a page break inside the name leaves
    // "Financial Corporation is a…" (First Financial). When the sentence opens with the TAIL of
    // the company's name (two words or more of it), put the missing lead words back.
    if (name && !/^[a-z]/.test(s)) {
      const nw = name.trim().split(/\s+/);
      for (let k = 1; k < Math.min(nw.length, 4); k++) {
        if (nw.length - k < 2) break;
        const tail = nw.slice(k).join(" ").toLowerCase();
        if (s.toLowerCase().startsWith(tail + " ")) { s = nw.slice(0, k).join(" ") + " " + s; break; }
      }
    }
    if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
    // The cap is the ACCEPTANCE test, not a display truncation: a lede either fits whole or a
    // shorter candidate (or the computed phrase) takes its place. The old path accepted up to 700
    // characters and sliced to 297 + "…", which put a mid-sentence ellipsis on 8% of the catalog.
    if (s.length < 34 || s.length > 340) continue;
    if (!/[.!?]["'”’)]?$/.test(s)) continue; // a complete sentence, not a clipped fragment
    if (isHeadingCase(s)) continue;          // a Title-Case heading the splitter glued a period onto
    if (BIZ_SKIP.test(s) || BIZ_WEAK.test(s) || BIZ_FRAGMENT.test(s) || BIZ_RESULTS.test(s) || BIZ_NOTDESC.test(s) || BIZ_PRODUCTREF.test(s) || BIZ_XREF.test(s)) continue;
    if (BIZ_HUMANCAP.test(sFull) || BIZ_LINEAGE.test(sFull)) continue; // test the PRE-jump text too
    if (BIZ_RECITAL.test(s) && !(BIZ_DOING.test(s) && BIZ_RICH.test(s))) continue;
    const isa = BIZ_ISA.test(s);
    const serves = BIZ_SERVE.test(s) && BIZ_CHANNEL.test(s); // a mission opener that still names a concrete channel
    if (!BIZ_DOING.test(s) && !isa && !BIZ_ENGAGED.test(s) && !serves) continue;
    const head = s.split(/\s+/).slice(0, 6).join(" ");
    const headNorm = head.toLowerCase().replace(/[^a-z0-9]/g, "");
    const weSubject = /^(we|our|the (company|registrant|firm|group|corporation|partnership|trust|bank)|us)\b/i.test(s);
    const namedSubject = nameWords.some((w) => headNorm.includes(w));
    if ((!weSubject && !namedSubject) || !/^[A-Z]/.test(s)) continue;
    let score = 0;
    if (isa) score += 3;                        // the canonical "is a/an/one of <type>" form
    // The "<Company>/We designs|operates|provides|sells … <products/markets>" form is a real
    // description even without an "is a <type>" frame (Airbnb's "We operate a global marketplace
    // connecting guests with stays…", Apple's "The Company designs, manufactures and markets
    // smartphones…"). Reward it so it clears the earliness penalty instead of being sunk to a
    // negative score and dropped, which left hundreds of names — Apple among them — with no lede.
    else if (BIZ_DOING.test(s) && BIZ_RICH.test(s)) score += 2.5;
    else if (serves) score += 2;                // "<Company> helps … in retail stores and through eCommerce" (Walmart)
    if (namedSubject && !weSubject) score += 2; // names the company, not a bare "we"
    if (BIZ_RICH.test(s)) score += 1;           // products, markets, segments
    if (BIZ_STRUCTURAL.test(s)) score -= 3;     // org chart, not a description
    // Promotional and aspirational abstraction: each hit costs more than three positions of
    // earliness penalty, so a concrete sentence deeper in the section beats a mission statement
    // at the top (Lucid's "shaping the future of mobility" outranked its own "designed,
    // developed, manufactures and sells two EVs" at 1.5 — it takes 2.0 to flip them).
    score -= ((s.match(PROMO) || []).length + (s.match(BIZ_ASPIRATIONAL) || []).length) * 2;
    // A customer-BENEFIT frame is a value proposition, not a description: Everspin's "enables
    // our customers to design products … with the assurance that it will be available" outscored
    // its own "We are a pioneer in the successful commercialization of MRAM" by 0.2 (2026-07-31,
    // the owner's live report). Costed like a promo hit, so a concrete is-a beats it but it can
    // still stand where a filer offers nothing better.
    if (/\benables? (our|its|your) customers\b|\bwith the assurance\b|\bpeace of mind\b|\bwith confidence\b/i.test(s)) score -= 2;
    score -= Math.min(i, 3) * 0.6;              // the opener is usually the intended one — but cap the
    // penalty: with the MD&A Overview appended after Item 1, an unbounded penalty sank every clean
    // description sitting a dozen sentences deep (the Overview is a fallback for a thin Item 1, and a
    // real "<Company> is a <type>" there must still clear zero). Junk has no quality score to clear it.
    if (s.length < 70) score -= 1;              // too terse to describe a business
    cands.push({ s, score });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  // Diagnostic: BIZ_DEBUG=CAVA dumps the scored candidates and the raw opening sentences,
  // so a hero that picked the wrong line (or found no canonical "<Company> is a <type>")
  // can be diagnosed from the actual filing rather than guessed at.
  if (ticker && process.env.BIZ_DEBUG && process.env.BIZ_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
    console.log(`\n=== BIZ_DEBUG ${ticker}: ${cands.length} candidates ===`);
    cands.slice(0, 8).forEach((c) => console.log(`  [${c.score.toFixed(1)}] ${c.s.slice(0, 110)}`));
    console.log(`  raw opening: ${sents.slice(0, 6).map((s) => String(s).slice(0, 55)).join(" | ")}`);
    console.log("=== end BIZ_DEBUG ===\n");
  }
  // A negative best score means the surviving candidates are deep, structural, or dubious — a risk
  // or mission sentence that slipped the filters (FedEx's "We are not able to successfully implement
  // our business strategy…", Marathon's "We are committed to leveraging…"), or a real description
  // buried so far down the earliness penalty sinks it. Better the segment mix or the computed phrase
  // than a doubtful sentence presented as what the business is.
  if (cands[0].score < 0) return null;
  // Candidates were capped at 340 characters and required to end at a sentence boundary,
  // so the lede is always a complete sentence — never sliced to an ellipsis.
  return cands[0].s;
}

// A short "in brief" to sit beneath the hero sentence: up to two more lines that add concrete
// substance — the products, segments, customers or end-markets a company actually names — cleaned
// the same way as the hero (cleanQuote, the same skip/weak/structural guards) and kept distinct
// from it, so the page can say what a business does in a few honest, verbatim sentences instead of
// one. Empty where the filing offers nothing concrete; never invented.
function businessBrief(sents, lede, name) {
  if (!lede || !Array.isArray(sents)) return [];
  const ledeNorm = normalize(lede);
  const extras = [];
  for (let i = 0; i < Math.min(sents.length, 25) && extras.length < 2; i++) {
    let s = stripLeadingHeading(cleanQuote(String(sents[i] || "")));
    if (LEAD_VERB.test(s) && name) s = `${name.trim()} ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
    if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.length < 60 || s.length > 340) continue;
    if (!isProse(s) || BIZ_SKIP.test(s) || BIZ_WEAK.test(s) || BIZ_STRUCTURAL.test(s)) continue;
    // The brief long carried only the hero's lightest guards; every failure mode the hero
    // rejects reads just as wrong two lines beneath it. Same tests, same reasons.
    if (BIZ_FRAGMENT.test(s) || BIZ_RESULTS.test(s) || BIZ_NOTDESC.test(s) || BIZ_PRODUCTREF.test(s)) continue;
    if (BIZ_HUMANCAP.test(s) || BIZ_LINEAGE.test(s) || BRIEF_ORPHAN.test(s) || BIZ_XREF.test(s)) continue;
    if (BRIEF_NOISE.test(s) || GLUED_HEADING.test(s)) continue;
    // Stylized drop-caps survive text extraction as split letters ("A lways D esigning for
    // P eople", ADP's tagline). Two or more single-capital + fragment pairs is that artifact.
    if ((s.match(/\b[A-Z]\s[a-z]{2,}/g) || []).length >= 2) continue;
    if (BIZ_RECITAL.test(s) && !(BIZ_DOING.test(s) && BIZ_RICH.test(s))) continue;
    if (((s.match(PROMO) || []).length + (s.match(BIZ_ASPIRATIONAL) || []).length) >= 2) continue;
    if (!/[.!?]["'”’)]?$/.test(s) || isHeadingCase(s)) continue; // complete sentences only, not glued headings
    if (!BIZ_RICH.test(s)) continue; // must name products, markets, segments or customers
    const sNorm = normalize(s);
    if (sNorm === ledeNorm || ledeNorm.includes(sNorm.slice(0, 50)) || sNorm.includes(ledeNorm.slice(0, 50))) continue; // not the lede again
    // The lede is often the cleaned form of one of these sentences (a "together with its subsidiaries"
    // clause inserted, a heading prefixed), so the substring check above misses it. A high token
    // overlap catches the near-duplicate — CVS's "Overview of Business … is a leading health solutions
    // company …" repeating its own lede.
    if (jaccard(tokenize(s), tokenize(lede)) > 0.5) continue;
    if (extras.some((e) => jaccard(tokenize(e), tokenize(s)) > 0.5)) continue; // distinct from a prior extra
    extras.push(s); // accepted whole or not at all — never sliced to an ellipsis
  }
  return extras;
}

// ---- EDGAR document discovery ----

// Annual-report forms: 10-K (US), 20-F (foreign private issuers) and 40-F (Canadian MJDS filers).
// The most recent two of WHICHEVER kind the company files, so one path serves both pools.
const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);
async function latestAnnual(cik, n = 2) {
  const sub = await fetchText(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const j = JSON.parse(sub);
  const r = j.filings?.recent;
  if (!r) return [];
  const out = [];
  for (let i = 0; i < r.form.length && out.length < n; i++) {
    if (ANNUAL_FORMS.has(r.form[i]) && r.primaryDocument[i]) {
      out.push({ accn: r.accessionNumber[i], doc: r.primaryDocument[i], date: r.filingDate[i], reportDate: r.reportDate?.[i], form: r.form[i] });
    }
  }
  return out;
}

// Section anchors by annual-report form. A 10-K is read on its Item 1 (Business), Item 7 (MD&A) and
// Item 1A (Risk Factors). A 20-F uses Item 4 (Information on the Company), Item 5 (Operating &
// Financial Review) and Item 3.D (Risk Factors). A 40-F has no fixed item layout, so it borrows the
// 20-F anchors and, failing the word-count gate downstream, is simply skipped — the safe outcome.
// The separator between the item number and its title varies by filer AND by how htmlToText
// renders their heading markup: "Item 1. Business", "Item 1 Business", "Item 1: Business",
// "Item 1—Business", and — table-cell headings — "Item 1 | Business" (Scholastic's whole 10-K
// extracted 14 words because every body heading used pipes). One class covers them all; the
// comma is deliberately absent, because "Item 8, 'Consolidated…'" is cross-reference phrasing.
const SEP = "[\\s.|:–—-]+";
const SEP0 = "[\\s.|:–—-]*";
// A bare title is prone to seeding mid-sentence ("…adverse changes in market risk factors
// such as…"): the tell for running prose is a LOWERCASE word (or a comma) immediately
// before. Stated negatively rather than as a required boundary, because real headings carry
// all kinds of prefixes — page numbers, running headers, a company name ("The Progressive
// Corporation and Subsidiaries Management's Discussion…"), a prior heading in Title Case.
const HEAD_BEFORE = `(?<!\\b[a-z][a-z']{0,24}\\s{1,2})(?<![,;]\\s{0,2})`;
const SECTION_ANCHORS = {
  "10-K": {
    business: [`item\\s*1${SEP}business`, [`item\\s*1a${SEP}risk`, `item\\s*1b${SEP0}`, `item\\s*2${SEP}propert`]],
    mdna: [`item\\s*7${SEP}management`, [`item\\s*7a${SEP}quantitative`, `item\\s*8${SEP}financial`]],
    risk: [`item\\s*1a${SEP}risk\\s*factors`, [`item\\s*1b${SEP0}`, `item\\s*2${SEP}propert`]],
  },
  // The 20-F cohort probe (2026-07-05, SONY/TSM/MUFG/BABA/HMC/EC/PKX/SHEL/BP/UL) found the
  // body headings drop or vary the Item prefix by typesetter: "Item 4. Information on the
  // Company" with BARE-LETTER sub-items ("D. Risk Factors <prose>", Japanese blue-chips),
  // letterless bare titles (TSM's "Risk Factors We wish to caution…", plural "REVIEWS"),
  // full "Item 3.D. Risk Factors" (POSCO), decimal-numbered custom reports ("5.2 Risk
  // Factors", Ecopetrol), and UK strategic-report vocabulary (Shell/BP/Unilever). TOC rows
  // carry trailing page numbers; cross-references are see/quote/dash-preceded — the standing
  // guards separate them.
  "20-F": {
    business: [`item\\s*4${SEP}information\\s+on\\s+the\\s+company|item\\s*4\\.?\\s*b\\.?${SEP0}business\\s+overview|\\bbusiness\\s+overview\\b|\\d\\.\\s*business\\s+overview|${HEAD_BEFORE}b\\s*\\.\\s*business\\s+overview`, [`item\\s*4${SEP0}d${SEP0}`, `item\\s*5${SEP}operating`, "operating\\s+and\\s+financial\\s+reviews?\\s+and\\s+prospects", `${HEAD_BEFORE}c\\s*\\.\\s*organizational\\s+structure`]],
    mdna: [`item\\s*5${SEP}operating|operating\\s+and\\s+financial\\s+reviews?\\s+and\\s+prospects|(?:item\\s*)?5\\.?a\\.?\\s*operating\\s+results|${HEAD_BEFORE}a\\s*\\.\\s*operating\\s+results|\\d\\.\\s*financial\\s+review\\b|group\\s+financial\\s+review|performance\\s+in\\s+the\\s+year`, [`item\\s*6${SEP}directors`, `item\\s*6${SEP0}`, "directors,?\\s+senior\\s+management\\s+and\\s+employees", "directors'?\\s+report", "governance\\s+report", "critical\\s+accounting", "independent\\s+auditor'?s?\\s+report", "\\bremuneration\\s+report\\b"]],
    risk: [`item\\s*3${SEP0}d\\.?${SEP0}risk\\s*factors|item\\s*3${SEP}risk\\s*factors|${HEAD_BEFORE}d\\s*\\.\\s*risk\\s+factors|${HEAD_BEFORE}risk\\s+factors\\b|\\d\\.\\d\\s+risk\\s+factors|principal\\s+risks\\s+and\\s+uncertainties|risk\\s+factors\\s+and\\s+risk\\s+management|our\\s+principal\\s+risks\\b`, [`item\\s*4${SEP}information`, `item\\s*3${SEP0}e${SEP0}`, "history\\s+and\\s+development\\s+of\\s+the\\s+company", `${HEAD_BEFORE}(?:item\\s*)?4\\s*\\.\\s*information`]],
  },
};
SECTION_ANCHORS["40-F"] = SECTION_ANCHORS["20-F"];

// Scholastic-class 10-Ks print the item headings ONLY in the table of contents; the body
// sections open with bare titles ("Risk Factors", "Management's Discussion and Analysis…").
// When the item-anchored capture comes up nearly empty, retry on the bare titles: the TOC row
// duplicates them, but it yields a tiny chunk and the longest-candidate rule discards it.
// Business has no usable bare title (the word is everywhere), so its fallback is positional —
// from the end of the TOC to the first real Risk Factors heading — validated by the same
// risk-smell test as the primary capture.
// The MD&A title varies more than any other: "Management's Discussion and Analysis of
// Financial Condition…" (the form's words), IBM's Exhibit-13 "MANAGEMENT DISCUSSION" (no
// apostrophe-s, no "and Analysis"), Southern's "COMBINED MANAGEMENT'S DISCUSSION AND
// ANALYSIS", the banks' "Financial Review", Magna's "…of Results of Operations and Financial
// Position". Anchor the stable stem and let the ends bound the chunk.
const MDNA_TITLE = `management'?s?\\s+discussion(?:\\s+and\\s+analysis)?\\b`;
const FALLBACK_10K = {
  mdna: [`${HEAD_BEFORE}${MDNA_TITLE}|${HEAD_BEFORE}financial\\s+review\\b`, ["quantitative\\s+and\\s+qualitative\\s+disclosures", "report\\s+of\\s+independent\\s+registered", "financial\\s+statements\\s+and\\s+supplementary", `${HEAD_BEFORE}risk\\s+factors\\b`, "controls\\s+and\\s+procedures", `item\\s*8[\\s.|:–—-]+financial`, "other\\s+key\\s+information", "report\\s+of\\s+management\\b"]],
  risk: [`${HEAD_BEFORE}risk\\s+factors\\b`, ["unresolved\\s+staff\\s+comments", "legal\\s+proceedings", "management'?s\\s+discussion\\s+and\\s+analysis", "quantitative\\s+and\\s+qualitative", "controls\\s+and\\s+procedures", "report\\s+of\\s+independent\\s+registered", "financial\\s+statements\\s+and\\s+supplementary", "consolidated\\s+statements?\\s+of\\s+(income|operations)", "other\\s+key\\s+information"]],
};
const wordsOf = (s) => (s ? s.split(/\s+/).filter(Boolean).length : 0);
// A chunk seeded on a TOC row reads as titles-and-page-numbers; one seeded on the real
// heading reads as prose. Used as the fallback captures' validator, because their bare-title
// anchors match TOC rows that the page-number guard misses (the number trails a long title).
const headIsProse = (chunk) => {
  const h = chunk.slice(0, 800);
  const digits = (h.match(/\d/g) || []).length;
  const letters = (h.match(/[a-z]/gi) || []).length || 1;
  return digits / (digits + letters) < 0.08 && /[.!?]\s/.test(h.slice(0, 400));
};
function businessFallback(text, riskStartRe) {
  // The TOC's end: the last "Item 14/15/16" row in the first 30% of the document.
  let tocEnd = -1, m;
  const rows = /item\s*1[456][\.\s]/gi;
  while ((m = rows.exec(text)) !== null) { if (m.index > text.length * 0.3) break; tocEnd = m.index + m[0].length; }
  if (tocEnd < 0) return "";
  // The first real Risk Factors heading after the TOC bounds the business text.
  const re = new RegExp(riskStartRe, "gi");
  re.lastIndex = tocEnd;
  let end = -1;
  while ((m = re.exec(text)) !== null) {
    if (PAGE_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 30))) continue;
    if (XREF_BEFORE.test(text.slice(Math.max(0, m.index - 28), m.index))) continue;
    end = m.index; break;
  }
  if (end < tocEnd + 2000) return ""; // no bound found, or too thin to be a real Item 1
  const chunk = text.slice(tocEnd, end);
  return smellsLikeRisk(chunk) ? "" : chunk;
}

// The three narrative sections from one document's text: item anchors first, then the
// bare-title fallbacks (10-K only). Shared by the primary document and any rescue document,
// so every candidate runs the identical ladder.
function extractSections(text, form) {
  const a = SECTION_ANCHORS[form] || SECTION_ANCHORS["10-K"];
  let business = section(text, a.business[0], a.business[1], (chunk) => !smellsLikeRisk(chunk));
  let mdna = section(text, a.mdna[0], a.mdna[1]);
  let risk = section(text, a.risk[0], a.risk[1]);
  // Bare-title fallbacks, only where the item anchors found (almost) nothing — those names
  // ship an empty section today, so the fallback can only add, never displace.
  if (form === "10-K") {
    if (wordsOf(mdna) < 200) { const fb = section(text, FALLBACK_10K.mdna[0], FALLBACK_10K.mdna[1], headIsProse, 1500); if (wordsOf(fb) > wordsOf(mdna)) mdna = fb; }
    if (wordsOf(risk) < 200) { const fb = section(text, FALLBACK_10K.risk[0], FALLBACK_10K.risk[1], headIsProse, 1500); if (wordsOf(fb) > wordsOf(risk)) risk = fb; }
    if (wordsOf(business) < 200) { const fb = businessFallback(text, FALLBACK_10K.risk[0]); if (wordsOf(fb) > wordsOf(business)) business = fb; }
  }
  // Build 2 sanity gates (qualitative survey, 2026-07-31): every failure below goes to WITHHELD,
  // never to a mislabeled window, because each lane downstream inherits this denominator.
  //
  // A pointer-stub MD&A ("…incorporated by reference to Exhibit 13") is not an MD&A: Progressive's
  // Item 7 is ~250 words of cross-reference, and candor densities computed on it shipped as if
  // they were measurement. An empty section is the honest zero — candor withholds with it.
  if (wordsOf(mdna) < 500 && /incorporated\s+(?:herein\s+)?by\s+reference/i.test(mdna)) mdna = "";
  // A "risk section" that is a third of the whole document is a failed END anchor wearing a
  // section's name: JPMorgan's read 126,947 words — sixty percent of the filing — and reached the
  // statement notes; UVE's ran into its loss triangle; Diamondback's overran into Note 9. Flags
  // and the AI read then draw from the sections that ARE bounded.
  const docW = wordsOf(text);
  if (docW > 0 && wordsOf(risk) / docW > 0.35) risk = "";
  // Oil & gas 10-Ks open Item 1 with a defined-terms glossary ('"Bbl" means one stock tank
  // barrel…'); Diamondback's hero lede was its glossary. When a glossary heading sits at the
  // section's head, the business prose starts after the last definitional line.
  if (/^[\s\S]{0,800}?\bglossary\b/i.test(business) && /["'“][^"'”]{1,60}["'”]\s+(?:means|refers to)\b/i.test(business.slice(0, 4000))) {
    const zone = business.slice(0, 25000);
    let lastEnd = -1, dm;
    const dre = /["'“][^"'”]{1,60}["'”]\s+(?:means|refers to)\b[^.]{0,300}\./g;
    while ((dm = dre.exec(zone)) !== null) lastEnd = dm.index + dm[0].length;
    if (lastEnd > 0) business = business.slice(lastEnd);
  }
  return { business, mdna, risk };
}

// Every .htm document in a filing folder, largest first, excluding the XBRL viewer renders
// (R12.htm) and index pages. One extra request, paid only when a rescue is needed.
async function folderDocs(cik, accnNoDash) {
  const idx = JSON.parse(await fetchText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/index.json`));
  return (idx.directory?.item || [])
    .filter((d) => /\.htm(l)?$/i.test(d.name) && !/^R\d+\.htm/i.test(d.name) && !/-index/i.test(d.name))
    .map((d) => ({ name: d.name, size: Number(d.size) || 0 }))
    .sort((a, b) => b.size - a.size);
}

// ---- 40-F: the Canadian route ----
// The 40-F form is a wrapper; the content arrives as sibling documents under the MJDS
// convention: an Annual Information Form (business, plus a Risk Factors heading), a separate
// MD&A, and the statements — as EX-99.1/2/3, EX-1/EX-2 (the banks), or, in the monolith
// variant (Canadian Natural), all concatenated inside the primary under full-title banners.
// Probed on RY/BNS/BMO/SU/CNQ/MGA/SLF/CVE (2026-07-05): exhibit ORDER varies (Suncor's MD&A
// is 99.3), filenames vary (dexN.htm, xex99dN, descriptive), and the AIF's "Risk Factors" is
// usually a STUB redirecting to the MD&A's risk-management block — the banks have no Risk
// Factors body heading anywhere, so their risk section IS that block.
const AIF_BUSINESS_START = "general\\s+development\\s+of\\s+the\\s+(?:bank'?s\\s+|company'?s\\s+)?business|description\\s+of\\s+(?:the\\s+)?(?:\\w+'?s?\\s+)?business(?:es)?\\b|business\\s+of\\s+[A-Z]";
const AIF_BUSINESS_ENDS = [`${HEAD_BEFORE}risk\\s+factors\\b`, "dividends?\\s+and\\s+distributions", "capital\\s+structure", "market\\s+for\\s+securities", "directors\\s+and\\s+(?:executive\\s+)?officers", "legal\\s+proceedings", "transfer\\s+agents?"];
const MDNA_RISK_START = `risk\\s+management\\s+and\\s+risk\\s+factors|${HEAD_BEFORE}(?:\\d{1,2}\\.\\s*)?risk\\s+factors\\b|${HEAD_BEFORE}[a-z]\\s*\\.\\s*risk\\s+management\\b|top\\s+and\\s+emerging\\s+risks|${HEAD_BEFORE}risk\\s+management\\b`;
const MDNA_RISK_ENDS = ["critical\\s+accounting", "accounting\\s+(?:policies|standards|matters)", "controls\\s+and\\s+procedures", "\\bglossary\\b", "\\bappendix\\b", "additional\\s+(?:financial\\s+)?information", "capital\\s+management\\b", "\\bnon-?gaap\\b"];
const MDNA_DOC_ENDS = ["report\\s+of\\s+independent", "independent\\s+auditor'?s?\\s+report"];
const RISK_STUB = /MD&A|management'?s\s+discussion|described\s+on\s+pages?|can\s+be\s+found\s+in|incorporated\s+by\s+reference|(?:risk\s+management|risk\s+factors)\s+section/i;

async function fortyFSections(cik, accnNoDash, primaryText) {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}`;
  let aif = null, mdnaDoc = null;
  try {
    const docs = (await folderDocs(cik, accnNoDash)).filter((d) => d.size > 250000).slice(0, 6);
    // Classify by which TITLE stands nearest the top: an MD&A's head can cross-reference
    // the Annual Information Form (TD's did, and a substring test handed its MD&A to the
    // AIF slot), but a document's own title precedes anything it merely mentions.
    const cands = [];
    for (const d of docs) {
      try {
        const t = htmlToText(await fetchText(`${base}/${d.name}`));
        const head = t.slice(0, 9000);
        cands.push({ name: d.name, text: t, aifAt: head.search(/annual\s+information\s+form/i), mdnaAt: head.search(new RegExp(MDNA_TITLE, "i")) });
      } catch { /* skip unfetchable */ }
    }
    const aifC = cands.filter((c) => c.aifAt >= 0 && (c.mdnaAt < 0 || c.aifAt < c.mdnaAt)).sort((a, b) => a.aifAt - b.aifAt)[0];
    const mdnaC = cands.filter((c) => c !== aifC && c.mdnaAt >= 0 && (c.aifAt < 0 || c.mdnaAt < c.aifAt)).sort((a, b) => a.mdnaAt - b.mdnaAt)[0];
    if (aifC) aif = { name: aifC.name, text: aifC.text };
    if (mdnaC) mdnaDoc = { name: mdnaC.name, text: mdnaC.text };
  } catch { /* fall through to the monolith attempt */ }
  // Monolith variant: everything inside the primary, separated by full-title banners.
  if (!aif && !mdnaDoc && primaryText.length > 400000) {
    const aifAt = primaryText.search(/annual\s+information\s+form\s+for\s+the\s+year/i);
    const mdnaAt = primaryText.search(/management'?s\s+discussion\s+and\s+analysis\s+for\s+the\s+year/i);
    if (aifAt >= 0 && mdnaAt > aifAt) {
      aif = { name: null, text: primaryText.slice(aifAt, mdnaAt) };
      mdnaDoc = { name: null, text: primaryText.slice(mdnaAt) };
    }
  }
  if (!aif && !mdnaDoc) return null;
  const out = { business: "", mdna: "", risk: "", url: null, text: null };
  if (mdnaDoc) {
    out.mdna = section(mdnaDoc.text, `${HEAD_BEFORE}${MDNA_TITLE}`, MDNA_DOC_ENDS, headIsProse, 1500) || mdnaDoc.text;
    out.url = mdnaDoc.name; out.text = mdnaDoc.text;
  }
  if (aif) {
    out.business = section(aif.text, AIF_BUSINESS_START, AIF_BUSINESS_ENDS, headIsProse, 1500) || aif.text;
    if (!out.url) { out.url = aif.name; out.text = aif.text; }
    // Substantive for industrials (Magna); a redirect stub for most; absent for the banks.
    const riskAif = section(aif.text, `${HEAD_BEFORE}(?:[a-z]\\s*\\.\\s*)?risk\\s+factors\\b`, ["dividends?\\s+and", "capital\\s+structure", "market\\s+for\\s+securities", "directors\\s+and", "legal\\s+proceedings", "\\bratings\\b", "transfer\\s+agents?"], headIsProse, 1500);
    if (wordsOf(riskAif) >= 400 && !RISK_STUB.test(riskAif.slice(0, 400))) out.risk = riskAif;
  }
  if (!out.risk && mdnaDoc) out.risk = section(mdnaDoc.text, MDNA_RISK_START, MDNA_RISK_ENDS, headIsProse, 1500);
  return out;
}

// A 20-F's Item 4 and a 40-F's AIF open with history and incorporation boilerplate; the
// description a reader wants sits under "Business Overview" / "Description of the Business",
// often past the 25 sentences the lede scorer reads. Start the hunt there when present.
function bizLeadText(business, form) {
  if (form === "10-K" || !business) return business;
  const m = business.search(/business\s+overview|description\s+of\s+(?:the\s+)?(?:\w+'?s?\s+)?business|general\s+development\s+of\s+the\s+business/i);
  return m > 200 ? business.slice(m) : business;
}

async function getFiling(cik, f, totalDebtMillions = null, devTarget = null, depTarget = null, swTarget = false, ogTarget = false, reitTarget = false, utilTarget = false, mcTarget = null) {
  const accnNoDash = f.accn.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}`;
  let url = `${base}/${f.doc}`;
  const html = await fetchText(url);
  let text = htmlToText(html);
  let { business, mdna, risk } = extractSections(text, f.form);
  // Fragment-primary rescue (Wells Fargo class): the submissions feed's primaryDocument
  // points at a partial document (wfc-20251231_d2.htm, 360KB) while the complete 10-K sits
  // beside it in the folder at 11.6MB. When the narrative is still missing after every
  // fallback, re-run the ladder on the folder's largest non-exhibit document; keep whichever
  // document yielded more. sourceUrl follows the document actually read — provenance is the
  // page's promise, so the link must open the text the words came from.
  if (f.form === "10-K" && (wordsOf(mdna) < 200 || wordsOf(risk) < 200)) {
    try {
      const docs = (await folderDocs(cik, accnNoDash)).filter((d) => !/(^|[^a-z])ex[-_.]?\d|exhibit/i.test(d.name));
      const alt = docs[0];
      if (alt && alt.name !== f.doc && alt.size > html.length * 2) {
        const text2 = htmlToText(await fetchText(`${base}/${alt.name}`));
        const s2 = extractSections(text2, f.form);
        // Per-section merge: Wells Fargo's form part carries Item 1 Business while its
        // Exhibit-13-style sibling carries the Financial Review and Risk Factors — each
        // section comes from whichever document actually holds it.
        let fromAlt = 0;
        if (wordsOf(s2.business) > wordsOf(business)) { business = s2.business; fromAlt++; }
        if (wordsOf(s2.mdna) > wordsOf(mdna)) { mdna = s2.mdna; fromAlt++; }
        if (wordsOf(s2.risk) > wordsOf(risk)) { risk = s2.risk; fromAlt++; }
        // Both documents belong to the same accession; the link and the notes-bearing text
        // follow whichever supplied the greater share of the narrative.
        if (fromAlt >= 2) { text = text2; url = `${base}/${alt.name}`; }
      }
    } catch { /* the primary's extraction stands */ }
  }
  // The Canadian route: a 40-F wrapper never carries a real MD&A, whatever stray phrases its
  // exhibit descriptions hand the business anchor — gate on the MD&A alone.
  if (f.form === "40-F" && wordsOf(mdna) < 200) {
    try {
      const r = await fortyFSections(cik, accnNoDash, text);
      if (r) {
        if (wordsOf(r.business) > wordsOf(business)) business = r.business;
        if (wordsOf(r.mdna) > wordsOf(mdna)) mdna = r.mdna;
        if (wordsOf(r.risk) > wordsOf(risk)) risk = r.risk;
        if (r.url) url = `${base}/${r.url}`;
        if (r.text) text = r.text;
      }
    } catch { /* the wrapper's (empty) extraction stands; the gate skips it as before */ }
  }
  const md = metrics(mdna);
  // The debt-maturity ladder lives in the financial-statement notes, past the three narrative sections,
  // so it reads from the full filing text — no extra EDGAR fetch. fy is the report year (the schedule
  // starts at/after it); totalDebt anchors the reconciliation when a table states no total of its own.
  const fy = f.reportDate ? parseInt(f.reportDate.slice(0, 4)) : null;
  let debtMaturity = null;
  try { debtMaturity = fy ? extractDebtMaturity(text, fy, totalDebtMillions) : null; } catch { debtMaturity = null; }
  // The reserve-development lane (Build 4): like the debt ladder, it reads past the narrative
  // sections into the statement notes, so it runs here where the full text is in hand. Only
  // when the caller supplied a weld target — the filed development number for THIS filing's
  // fiscal year; no filed number, no lane.
  let reserveRead = null;
  if (devTarget && devTarget.stored != null && fy) {
    try { reserveRead = reserveDevelopmentRead({ mdnaText: mdna, fullText: text, fy, stored: devTarget.stored, kind: devTarget.kind }); } catch { reserveRead = null; }
  }
  // The uninsured-deposits lane (Build 6): like Build 4, it runs only when the caller supplied
  // the weld denominator — the stored XBRL Deposits line for THIS filing's fiscal year. The
  // netted-basis verdict reads the full text (GCBC's exclusion table sits past the extracted
  // MD&A); candidates come from the MD&A window alone.
  let uninsuredRead = null;
  if (depTarget && depTarget.deposits > 0 && fy) {
    try { uninsuredRead = uninsuredDepositsRead({ mdnaText: mdna, fullText: text, fy, deposits: depTarget.deposits }); } catch { uninsuredRead = null; }
  }
  // The software NRR + customer-ladder lanes (Build 7): pure substring lanes over the filing's
  // own MD&A and Business text, run for BOTH filings when the caller flags a software name —
  // the prior filing's gated record is the corroboration and tripwire counterparty.
  let swRead = null;
  if (swTarget && fy) {
    try { swRead = softwareKpiRead({ mdnaText: mdna, businessText: business, fy }); } catch { swRead = null; }
  }
  // The O&G desk's lanes (Build 8): reserve-engineer attribution and the sector's
  // critical-estimates topics, both full-filing text scans (the Item 1202 disclosure and the
  // critical-estimates window both sit past — or astray of — the extracted narrative
  // sections on the largest filers), run only for the producer/integrated/royalty SIC scope.
  let ogRead = null;
  if (ogTarget && fy) {
    try {
      const attribution = reserveEngineerRead({ fullText: text, fy });
      const crit = ogCriticalTopics(text);
      ogRead = attribution || crit ? { ...(attribution ? { attribution } : {}), ...(crit ? { crit } : {}) } : null;
    } catch { ogRead = null; }
  }
  // The REIT re-leasing spreads + occupancy lanes (Build 9): the doc's Items 1/2/7 scope —
  // the extracted Business and MD&A plus an Item 2 Properties window cut here (percent-leased
  // sentences live in Properties, outside every extracted narrative section: REXR's "90.9%
  // leased", KIM's "96.6% leased"). Current filing only; no filed weld target exists, the
  // verification is the in-sentence date and the sentence's own dollar pair.
  let reitRead = null;
  if (reitTarget && fy && f.form === "10-K") {
    try {
      const item2 = section(text, `item\\s*2${SEP}propert`, [`item\\s*3${SEP}legal`, `item\\s*4${SEP}mine`], null, 40);
      reitRead = reitLeasingRead({ businessText: business, item2Text: item2, mdnaText: mdna, fy, fyeDate: f.reportDate });
    } catch { reitRead = null; }
  }
  // The utilities disallowance ledger + securitization keyhole (Build 10): MD&A plus the
  // Regulatory/Rate Matters note windows, read from the full text (the notes sit past the
  // narrative sections). Current filing only, quote-only, rateRegulated names only.
  let utilRead = null;
  if (utilTarget && fy && f.form === "10-K") {
    try { utilRead = utilityRegRead({ mdnaText: mdna, fullText: text, fy }); } catch { utilRead = null; }
  }
  // The utilities rate-case list (Build 12): the same scope and the same rateRegulated
  // membership as Build 10, its own splitter and its own glued-heading label parse. Quote-only,
  // current filing only; a filer with no qualifying case may still carry its regime sentence.
  let rateRead = null;
  if (utilTarget && fy && f.form === "10-K") {
    try { rateRead = rateCaseRead({ mdnaText: mdna, fullText: text, fy }); } catch { rateRead = null; }
  }
  // The managed-care MLR cost-trend read (Build 11): MD&A sentences only (the doc's scope),
  // run only when the caller supplied the desk's computed MLR for THIS filing's fiscal year —
  // no computed MLR, no lane (Alignment and Trupanion never even scan).
  let mcRead = null;
  if (mcTarget && mcTarget.mlr != null && fy && f.form === "10-K") {
    try { mcRead = mlrCostTrendRead({ mdnaText: mdna, fy, mlr: mcTarget.mlr, mlrPrior: mcTarget.mlrPrior }); } catch { mcRead = null; }
  }
  return { url, business: { ...metrics(business), lead: leadSentences(bizLeadText(business, f.form)), head: business.slice(0, 800) }, mdna: { ...md, lead: leadSentences(mdna), candor: candorSignals(mdna, md.sents) }, risk: metrics(risk), reportDate: f.reportDate, debtMaturity, reserveRead, uninsuredRead, swRead, ogRead, reitRead, utilRead, rateRead, mcRead };
}

// ---- executive pay (proxy statement / DEF 14A) ----
// The CEO-to-median pay ratio is a required Item 402(u) disclosure, stated as a
// formula ("X to 1"), so it extracts cleanly. We take only that number, table
// parsing across varied proxies is too fragile for a credibility-first product,// and omit it when no clean match is found.
async function latestProxy(cik) {
  const sub = await fetchText(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const j = JSON.parse(sub);
  const r = j.filings?.recent;
  if (!r) return null;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === "DEF 14A" && r.primaryDocument[i]) {
      return { accn: r.accessionNumber[i], doc: r.primaryDocument[i], date: r.filingDate[i] };
    }
  }
  return null;
}

function extractPayRatio(text) {
  const pats = [
    /ratio of (?:the )?(?:annual )?total compensation of (?:our |the )?(?:ceo|chief executive officer|principal executive officer)[\s\S]{0,240}?median[\s\S]{0,240}?(?:was|is|of|:|equal to)\s*(?:approximately |estimated (?:to be )?|reasonably )?(\d[\d,]*)\s*(?:to|:)\s*1\b/i,
    /median[\s\S]{0,240}?(?:ceo|chief executive officer)[\s\S]{0,200}?ratio[\s\S]{0,40}?(?:was|is|of|:)\s*(?:approximately )?(\d[\d,]*)\s*(?:to|:)\s*1\b/i,
    /(?:ceo|chief executive)?\s*(?:to[- ]median)?\s*pay ratio[\s\S]{0,80}?(?:was|is|of|:)?\s*(?:approximately )?(\d[\d,]*)\s*(?:to|:)\s*1\b/i,
    /(\d[\d,]*)\s*(?:to|:)\s*1\b[\s\S]{0,40}?(?:ceo )?pay ratio/i,
    /(?:ceo|chief executive)[\s\S]{0,80}?(\d[\d,]*)\s*times (?:that of |the (?:annual )?(?:total )?compensation of (?:our )?)?(?:our )?median/i,
  ];
  // A real large-cap CEO-to-median ratio is never single digits; reject implausibly
  // low matches (stock splits, votes, "3 to 1") rather than show a wrong number.
  for (const re of pats) {
    const m = text.match(re);
    if (m) { const n = parseInt(m[1].replace(/,/g, ""), 10); if (n >= 20 && n < 100000) return n; }
  }
  return null;
}

// Insider ownership: the "directors and executive officers as a group" line of the Item 403
// beneficial-ownership table — the skin-in-the-game figure GBM read first ("show me the incentives,
// and I'll show you the outcome"). A table value, not a sentence, so we guard hard: confine to the
// ownership section (so "as a group" in unrelated prose can't match), and require a comma-grouped
// share count between the group line and the percent (the table's shape, which prose never has). The
// tags-to-spaces htmlToText keeps cells separated, so the share count and percent never merge. Returns
// a number (percent of class), the string "<1%" for the asterisk/"less than 1%" placeholder, or null
// when there is no confident match — a wrong number here is worse than none.
function extractInsiderGroup(text) {
  // The group row: "directors/officers … as a group", a comma-grouped share count (group 1 — the
  // table's shape, which prose never has), then an explicit percent (group 2) — or the */"less than
  // 1%" placeholder. Tolerances are wide enough for long labels ("…director nominees and named
  // executive officers…") and the extra numeric columns (options, total) between shares and percent.
  const groupRe = /(?:directors?|executive officers?|named executive officers?)[^.\n]{0,140}?as a group[^%]{0,60}?([\d,]{5,})[^%]{0,60}?(\*|less than\s*1\s*%|under\s*1\s*%|<\s*1\s*%|\d{1,3}(?:\.\d+)?\s*%)/i;
  const pick = (m) => {
    const sh = parseInt(m[1].replace(/,/g, ""), 10);
    const shares = Number.isFinite(sh) ? sh : null;
    const raw = m[2].replace(/\s+/g, "");
    if (raw === "*" || /lessthan|under|</i.test(raw)) return { pct: "<1%", shares };
    const n = parseFloat(raw);
    // Keep the raw captured percent. A listed company can't be 100%+ insider-owned, so reject that as a
    // parse/voting artifact; but whether a high-but-under-100 percent is genuine economic ownership or a
    // super-voting-CLASS column is decided downstream (resolveInsiderOwnership), where the group share
    // count can be checked against the shares outstanding — a check the proxy text alone can't make.
    if (!(n >= 0 && n < 100)) return null;
    return { pct: Math.round(n * 10) / 10, shares };
  };
  // The header ("Security Ownership of Certain Beneficial Owners and Management") usually appears
  // first in the table of contents / a cross-reference, with the real Item 403 table tens of
  // thousands of chars later — so a single window from the first hit misses the table on long
  // (large-cap) proxies, the dominant cause of missed figures. Scan every header occurrence and
  // take the first window carrying a real group row.
  const headerRe = /security ownership|beneficial owner(?:s|ship)?|ownership of (?:certain )?(?:our )?(?:management|securities|common stock|equity)/gi;
  let h, tries = 0;
  while ((h = headerRe.exec(text)) !== null && tries < 24) {
    tries++;
    const m = text.slice(h.index, h.index + 12000).match(groupRe);
    if (m) { const v = pick(m); if (v != null) return v; }
  }
  // Fallback: the whole document. groupRe is strict enough (directors/officers + "as a group" +
  // a comma-grouped share count + an explicit percent) that unrelated prose can't satisfy it, so
  // this only ever recovers a real table whose header didn't land within a scoped window.
  const m = text.match(groupRe);
  return m ? pick(m) : null;
}
// The percent alone — the parser test asserts on this; the share-count cross-check lives at the
// display layer (resolveInsiderOwnership), which has the shares-outstanding the proxy text doesn't.
function extractInsiderOwnership(text) {
  const g = extractInsiderGroup(text);
  return g ? g.pct : null;
}

async function getComp(cik, f) {
  const accnNoDash = f.accn.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${f.doc}`;
  const text = htmlToText(await fetchText(url));
  const payRatio = extractPayRatio(text);
  const grp = extractInsiderGroup(text);
  const insiderOwnership = grp ? grp.pct : null;
  if (payRatio == null && insiderOwnership == null) return null;
  // insiderShares is the group's beneficially-owned share count, kept so the display can corroborate a
  // high percent against the shares outstanding (genuine thin-float control vs. a voting-class column).
  return { payRatio, insiderOwnership, insiderShares: grp ? grp.shares : null, fy: f.date?.slice(0, 4) || null, sourceUrl: url };
}

// "New" = a prose sentence carrying a signal term whose wording doesn't closely
// match anything in last year's filing (fuzzy, so figure updates and light edits
// don't count). Returns only the notable handful, never a raw "everything
// changed" count.
function diff(curSents, priorSents) {
  const priorTok = priorSents.map(tokenize);
  const isNew = (s) => {
    const t = tokenize(s);
    if (t.size < 6) return false;
    for (const pt of priorTok) if (jaccard(t, pt) >= 0.55) return false;
    return true;
  };
  const notable = curSents
    .filter((s) => SIGNAL.test(s) && isNew(s))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
    .map((s) => cleanQuote(s).slice(0, 300));
  return { notableCount: notable.length, notable };
}

// ---- AI / "too-hard pile" signal ----
// Classic NLP. Two questions, answered from the filing's own words: does the
// company name artificial intelligence as a competitive risk in its Item 1A (and is that
// language new this year), and does it position AI as a capability in the Business/MD&A?
// The verbatim is the evidence; the page pairs it with the structural AI-exposure of the
// industry to ask whether a once-durable moat is becoming contestable. Never a verdict.
const AI_WORDS = /\b(artificial intelligence|machine learning|generative a\.?i\.?|large language models?|\bllms?\b|deep learning|neural networks?|foundation models?|generative models?)\b/i;
const AI_ACRONYM = /\bA\.?I\.?\b/; // the acronym, case-sensitive, so "again"/"said" don't match
const hasAI = (s) => AI_WORDS.test(s) || AI_ACRONYM.test(s);
// A *competitive* AI risk: AI named alongside substitution, disruption or pricing framing —
// the moat question. Deliberately narrow.
const AI_COMPETE = /\b(compet|substitut|replac|disrupt|displac|obsolet|erode|eroding|disintermediat|new entrant|barrier to entry|lower\w* (the )?(cost|barrier|price)|reduce\w* (the )?(cost|demand|need|reliance)|open[- ]?source|free (or |and )?(low[- ]?cost|alternativ)|pricing (power|pressure)|commoditi|less reliant|democrati|enable\w*[^.]{0,40}(anyone|customers|users|competitors|smaller|themselves|in-house)|without (the )?(need|specialized|expertise)|build\w*[^.]{0,25}(their own|in-house)|self[- ]?serv|alternativ\w* to (our|the)|render\w* (our|its))/i;
// Not the moat question: cybersecurity, energy, ethics/bias, IP, privacy and regulation are
// different AI risks; exclude them so the competitive signal stays clean.
const AI_EXCLUDE = /\b(cyber|threat actor|malicious|phishing|breach|fraud|\benergy\b|power consumption|data cent|emission|climate|ethic|\bbias\b|discriminat|infring|copyright|hallucinat|privacy|misinformation|deepfake|workforce|reskill|talent)/i;

function aiSignal(cur, prior) {
  const risk = cur?.risk?.sents || [];
  const opp = (cur?.business?.sents || []).concat(cur?.mdna?.sents || []);
  const compHits = risk.filter((s) => hasAI(s) && AI_COMPETE.test(s) && !AI_EXCLUDE.test(s));
  const anyAIrisk = risk.some(hasAI);
  const priorTok = (prior?.risk?.sents || []).map(tokenize);
  const isNew = (s) => { const t = tokenize(s); if (t.size < 6) return false; for (const pt of priorTok) if (jaccard(t, pt) >= 0.55) return false; return true; };
  const newComp = prior ? compHits.find((s) => isNew(s)) : null;
  const pointed = newComp || compHits[0] || null;
  const capHits = opp.filter((s) => hasAI(s) && !AI_EXCLUDE.test(s));
  // A capability quote must still SAY AI after the display cap (audit-fix item 7): the 280-char
  // slice could cut ahead of the AI token — Trupanion rendered a zero-AI-words quote — and a
  // glued pair can carry its token only in the half the cap discards. Split to sentences first,
  // keep the AI-bearing one, and reject any candidate whose final rendered string lost the token;
  // the next hit gets its turn, and no survivor means no quote (the classification stands on the
  // hits; the quote is evidence, and evidence that no longer says AI is not evidence).
  const capQuote = (() => {
    for (const h of capHits) {
      const sents = String(h).split(/(?<=[.!?])\s+(?=[A-Z"'“])/);
      const s = sents.find((x) => hasAI(x)) || h;
      const q = cleanQuote(s).slice(0, 280);
      if (hasAI(q)) return q;
    }
    return null;
  })();
  return {
    inRisk: compHits.length > 0,        // names AI specifically as a competitive risk
    mentionsAIRisk: anyAIrisk,          // mentions AI anywhere in the risk factors
    riskMentions: compHits.length,
    riskQuote: pointed ? cleanQuote(pointed).slice(0, 320) : null,
    newThisYear: !!newComp,
    newQuote: newComp ? cleanQuote(newComp).slice(0, 320) : null,
    asCapability: capHits.length > 0,
    capabilityQuote: capQuote,
  };
}

// ---- "What an owner would flag" ----
// The timeless read, not the year-over-year diff: the handful of sentences in the
// Business, MD&A and Risk Factors that Graham (solvency, stability) and Buffett
// (a moat, who you depend on, who sets the price) would stop on. Each theme is a
// lens; we surface the single most specific sentence that trips it, verbatim and
// sourced, never a score. Ordered so the gravest, rarest flags come first.
// A sentence that DENIES concentration or dependence is the opposite of a flag — it's
// diversification, and flagging it inverts the meaning. ("No single customer accounted for more
// than 10% of revenue", Coca-Cola; "we are not dependent on any single supplier".) The customer,
// supplier and dependence themes share this guard so a company that discloses it has no
// concentration isn't shown a concentration risk.
const DENIES_CONC = /\bno\s+(single|individual|one|other|material)?\s*(customer|client|tenant|bottler|distributor|reseller|supplier|vendor|product|end customer)s?\b[^.]{0,80}\b(account|represent|generat|exceed|made?\s+up|compris|more than|greater than|equal to|\d{1,2}\s?%)|\bdid not have any (customer|client|tenant)s?\b/i;
const NOT_DEP = /\bnot\s+(currently |materially |significantly |substantially |overly |heavily )?(dependent|reliant)\s+(up)?on\s+(a |any |the )?(single|one|individual|small (number|group)|limited number|group of)\b|\bdo not believe (that )?(we|it) (are|is)[\s\S]{0,40}\b(dependent|reliant)\b/i;
const deniesConc = (s) => DENIES_CONC.test(s) || NOT_DEP.test(s);
// A GEOGRAPHIC revenue split wears concentration's clothes — "customers outside the United
// States accounted for 54% of revenue" is a mix fact, not a dependence fact — and it was 12 of
// the software cohort's 127 concentration quotes (audit-fix item 9). Same class the weld-side
// parser already rejects; the lens now rejects it too, so the quote never ships at all.
const CC_GEO_LENS = /\bcustomers?\s+(?:located\s+|based\s+)?(?:in|outside|within)\b|\boutside\s+(?:of\s+)?(?:the\s+)?(?:u\.?s\.?|united states)\b|\bby\s+geograph\w*\b|\binternational\s+(?:customers?|markets?|revenues?)\b/i;

const FLAG_THEMES = [
  {
    lens: "Going-concern doubt",
    why: "The rarest and gravest flag, the company's own auditors questioning whether it survives the year. Graham's first test, failed.",
    test: (s) => /substantial doubt[\s\S]{0,60}(continue as a going concern|ability to continue)/i.test(s),
    bonus: () => 6,
  },
  {
    lens: "Customer concentration",
    why: "Who the revenue leans on. When one buyer is a large slice of sales, that buyer holds the pricing power, and its troubles become the company's.",
    // Require an actual share-of-revenue disclosure (a percentage), not merely the
    // word "customers" next to some number, that mislabels subscriber/headcount lines.
    test: (s) =>
      !deniesConc(s) &&
      !CC_GEO_LENS.test(s) &&
      /\bcustomers?\b/i.test(s) &&
      /\d{1,3}\s?(%|percent)/i.test(s) &&
      /(account|represent|concentrat|% of|percent of|of (its |our |total |net )*(net )?(revenue|sales|operating revenue))/i.test(s),
    bonus: (s) => (/%|percent/i.test(s) ? 3 : 0),
  },
  {
    lens: "Pricing power & competition",
    why: "Whether the company sets its price or takes it. Durable pricing power is the surest mark of a moat; price competition is the surest mark there isn't one.",
    test: (s) => /(pricing pressure|price competition|competitive pricing|intense(ly)? competit|highly competitive|barriers to entry|substitute products|commoditiz|downward pressure on (our )?(price|selling price))/i.test(s),
    bonus: (s) => (/(pricing|barrier|substitut|commoditiz)/i.test(s) ? 2 : 0),
  },
  {
    lens: "Supplier & input dependence",
    why: "A choke point upstream. A sole or limited supplier can dictate terms, and a single shortage can stop the line.",
    test: (s) => !deniesConc(s) && /(single source|sole source|sole supplier|single supplier|one supplier|limited number of suppliers|few suppliers|rely on a (single|limited)|depend\w* on .{0,30}suppl)/i.test(s),
    bonus: () => 0,
  },
  {
    lens: "Concentrated dependence",
    why: "What the whole business leans on, a product, a platform, a partner. Concentration cuts both ways, and the filing is where management has to admit it.",
    // Require a concrete object of dependence (product/platform/customer/supplier/
    // single-something), so generic "our success depends on our employees", true of
    // every company, doesn't fill the slot.
    test: (s) =>
      !deniesConc(s) && (
      /(substantially depend|depend\w* heavily|depend\w* significantly|materially depend|a significant (portion|percentage) of (our )?(revenue|net sales|sales|business))/i.test(s) ||
      /\bdepend\w*\s+(?:on|upon)\s+(?:the\s+)?(?:price|availability|supply|cost)s?\b/i.test(s) ||
      (/(our (success|business|growth|results|revenue))[\s\S]{0,50}depend/i.test(s) &&
        /(product|platform|customer|supplier|vendor|single|sole|concentrat|one |few |limited|key (account|customer|supplier|product))/i.test(s))),
    bonus: (s) => (/\d/.test(s) ? 1 : 0),
  },
  {
    lens: "Debt terms & refinancing",
    why: "The fine print behind the debt. Covenants and near-term maturities decide who is really in control when a year goes badly.",
    // A lender's sentence about its BORROWERS' debt or the mortgages it holds is credit-book
    // disclosure, not the company's own debt terms — 40 of 236 bank debt flags fired on it, and
    // RLI's MBS portfolio wore the flag (2026-07-30 pass).
    test: (s) => !/\bborrowers?\b|mortgage-?backed/i.test(s) &&
      /(financial covenant|covenants (under|contained|require)|indenture|refinanc|debt maturit|maturities of|revolving credit facility|default under)/i.test(s),
    bonus: (s) => (/(covenant|default)/i.test(s) ? 2 : 0),
  },
  {
    lens: "Litigation & contingencies",
    why: "Claims an owner inherits. Most disclosure is boilerplate; this fires only on an actual matter, a named suit, a settlement, a contingency, a number.",
    // Require an actual legal/regulatory/tax matter (a named suit, a settlement of
    // a lawsuit, a fine, a court ruling, a defendant, a specific allegation), never
    // an operational $-line with an incidental "settle"/"penalty"/"contingency".
    test: (s) =>
      /(class action|securities (class action|fraud)|antitrust (suit|claim|lawsuit|investigation|matter|case|action|complaint|litigation|fine|probe)|monopoliz|anticompetitive|patent (infringement|dispute|suit|litigation)|product liability|qui tam|whistleblower|consent decree|(named (as )?a defendant|is a defendant|are defendants|sued (us|the company|the))|(lawsuit|complaint|class action|legal proceeding)s? (filed|brought|pending|alleging|seeking|that allege)|settle\w+ (of |a |an |the |this |that |certain |previously )*(lawsuit|litigation|class action|legal (matter|proceeding|claim|action)|patent|antitrust|opioid)|jury (verdict|award\w*|found)|(court|circuit|appeals?|tribunal|judge)[\sa-zA-Z']{0,30}(ruled|awarded|affirmed|reversed|judgment|denial|dismiss|enjoin)|investigation by (the )?(SEC|DOJ|FTC|EU|European Commission|attorney general|Department of Justice|state)|\b(fines?|penalt\w+)\b[\s\S]{0,25}\b(EC\b|European Commission|antitrust|competition authorit)|\b(European Commission|competition authorit\w*)\b[\s\S]{0,30}\b(imposed|fines?|penalt\w+)\b|appeal\w+ the (EC\b|EU\b|European|decision)|infring\w+ (our|its|the|on|upon)|alleg\w+ (that|monopoli|fraud|infring|breach|violations? of|discriminat)|(IRS|tax authorit\w+)[\s\S]{0,55}(propos\w+|seeking|asserted|deficiency|adjustment|disput|notice)|(charge|liability|accru\w+|reserve|provision|net gains?)[\s\S]{0,50}(litigation|legal (matter|proceeding|settlement|claim)|class action|antitrust|opioid|interchange))/i.test(s),
    bonus: (s) => (/(class action|antitrust|securities fraud|patent|consent decree|qui tam|monopoli|\$\s?[\d,.]+\s?(million|billion))/i.test(s) ? 2 : 0),
  },
  {
    lens: "Dilution",
    why: "Whether your slice quietly shrinks. New shares fund the company at the existing owner's expense.",
    test: (s) => /(significant(ly)? dilut|substantial dilut|dilut\w* to (our |existing )?(stockholders|shareholders)|issue additional shares of|result in dilution)/i.test(s),
    bonus: () => 0,
  },
  {
    lens: "Cyclicality & demand",
    why: "How the business behaves when the economy turns. A cyclical earns its keep across the whole cycle, not at the peak.",
    // Require named cyclicality/seasonality or an industry downturn, not a generic
    // "a recession could hurt demand" that is true of every business.
    // "Countercyclical" is a bank REGULATOR'S capital-buffer term, not a statement that the
    // business is cyclical — 25 of 204 bank cyclicality flags fired on it (2026-07-30 pass).
    test: (s) => !/countercyclical|capital buffer/i.test(s) &&
      /(cyclical|highly seasonal|(industry|severe|sharp|prolonged|economic) downturn|downturn in (the|our|demand)|recession\w*[\s\S]{0,30}(reduce|decreas|lower|impact|demand|weaken|soften))/i.test(s),
    bonus: (s) => (/(cyclical|industry downturn|severe downturn)/i.test(s) ? 1 : 0),
  },
  {
    lens: "Regulation & policy",
    why: "Rules that can rewrite the economics, tariffs, antitrust, data, export controls.",
    // Require a specific named regime, not generic "we comply with regulations".
    // The agency acronyms are word-bounded: case-insensitive bare "EPA" matched inside "preparation"
    // and "repair" (75 of 150 software Regulation flags measured false on it), "FDA" inside nothing
    // yet but the same class. Suppress-only narrowing, 2026-07-30 hygiene pass.
    test: (s) =>
      /(tariff|export control|economic sanction|antitrust|data privacy|\bGDPR\b|CHIPS Act|Inflation Reduction Act|Dodd-Frank|emissions?|\bFDA\b|\bEPA\b|\bFTC\b|\bDOJ\b|European Commission|net neutrality|price (control|cap)|excise tax|sugar tax|container deposit|extended producer responsibility)/i.test(s) &&
      /(could|may|would|adversely|materially|restrict|increase|impose|prohibit|penalt|\bfines?\b|subject to|harm|impact|require|cost|ban|limit|tax)/i.test(s),
    bonus: () => 0,
  },
];

// Generic risk-tail boilerplate that says nothing company-specific; penalised so a
// concrete sentence wins. Anchors (a number, %, $, or a hard quantifier) mark specificity.
const BOILERPLATE = /(material(ly)? ?(and )?adverse|adversely (affect|impact)|adverse (effect|impact)|no assurance|beyond (our|its) control|financial condition,? and (its )?results of operations|reputation and brand|costly and time-consuming)/i;
const ANCHOR = /\$\s?\d|\d{1,3}\s?%|\b(single|sole|one |two |largest|primary|limited number|a few|substantially all)\b/i;

// From the current filing's prose pool (sentence + section tag), pick the single
// strongest sentence per theme: signal-bearing, specific (a number helps), the
// right length, with theme-specific weighting. Returns up to 7, gravest first.
function ownerFlags(pool, skipLenses = null) {
  const used = new Set();
  const out = [];
  for (const th of FLAG_THEMES) {
    if (skipLenses && skipLenses.has(th.lens)) continue;
    let best = null, bestScore = -1;
    for (const p of pool) {
      if (used.has(p.s) || !th.test(p.s)) continue;
      const s = p.s;
      const score =
        (SIGNAL.test(s) ? 1 : 0) +
        (ANCHOR.test(s) ? 2 : 0) +
        (s.length >= 90 && s.length <= 300 ? 1 : 0) +
        th.bonus(s) -
        (BOILERPLATE.test(s) ? 2 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best) {
      used.add(best.s);
      out.push({ lens: th.lens, why: th.why, section: best.section, quote: cleanQuote(best.s).slice(0, 300) });
    }
    if (out.length >= 7) break;
  }
  return out;
}

// ---- The Buffett read: what an owner would notice ----
// Past the year-over-year diff and the risk-factor flags lie the handful of things Buffett and
// Munger actually hunt for when they read a 10-K, drawn from the Business, MD&A and Risk Factors
// the pipeline already pulls. Unlike the owner-flags, this read may surface a *strength*: pricing
// power is the one fact Buffett calls the single most important in judging a business, and a filing
// that demonstrates it has earned the right to say so in its own words. Three facets, each verbatim
// and sourced, none a verdict; the page lays them out and the reader weighs them.
//
//   1. Pricing & costs — the margin-durability read. Does the company state it RAISED prices and
//      made them hold (Buffett's moat test), or is it taking price rather than setting it? And when
//      input costs rose, could it pass them through? These are different sentences; we separate them.
//   2. Where the numbers are soft — the "critical accounting estimates" the SEC makes management
//      disclose name the figures that rest most on judgment (goodwill, revenue timing, pension, tax,
//      reserves). The more of them, the more the earnings are an opinion; Munger reads the assumption
//      before he trusts the result.
//   3. Accounting integrity — the grave, rare admissions: a material weakness in financial controls,
//      or a restatement of past numbers. Graham's honesty test, and one of these outweighs a clean
//      decade. Stated only when real; a clean filer trips none of it, which is the point.

// Declarative price increases that stuck (MD&A results-of-operations language), and the opposite —
// price competition or cuts. We read the positive case from MD&A/Business (where management states
// what happened), guarding out the conditional risk-factor phrasing with HYPO.
const PRICE_UP = /\b(price increases?|increased? (the |our |average |list |net )?(selling )?prices?|raised? (the |our )?prices?|higher (average |net |realized )?(selling )?prices?|favorable(?: net)? pric\w*|realized (higher|improved|favorable|positive) pric\w*|net (realized )?pricing|positive price|price\/mix|improved pricing|pricing actions?|pricing initiatives?|list price increases?)\b/i;
const PRICE_DOWN = /\b(pricing pressures?|price competition|competitive pric\w*|forced to (lower|reduce|discount)|lower(ed)? (our |average |net |selling )?prices?|price (declines?|erosion|reductions?|cuts?)|reduce(d)? (our |average |net |selling )?prices?|deflation\w*|downward pressure on (our )?(price|selling)|discount\w* (to|in order))\b/i;
// A cost-rise cue near "cost(s)" — written loosely on purpose, since filings string the inputs
// together ("higher raw material and freight costs", "rising commodity, labor and energy costs").
const COST_UP = /\binflation\w*|\b(rising|higher|increased|increasing|elevated|escalating)\b[\s\S]{0,40}?\bcosts?\b|\bcosts?\b[\s\S]{0,20}?\b(rose|increased|rising|climbed|were higher)\b|\bcost (inflation|increases?|pressures?|headwinds?)\b/i;
const COST_OFFSET = /\b(pass(?:ed|ing)?(?: these| through| on| along)|offset(?: these| the| by| with| through)|recover\w*(?: these| through| the| our| higher)|mitigat\w*(?: the| these)? ?(cost|inflation|impact|increase)|pricing (actions? )?to offset|price increases? to (offset|recover|mitigate)|fully offset|more than offset)\b/i;
// A negated or partial offset — "unable to fully offset", "only partially offset" — means costs were
// NOT passed through, the squeeze that compresses margin. Guards passedThrough from reading the word
// "offset" as a positive when the sentence is saying the opposite.
const OFFSET_NEG = /\b(unable to|not (?:fully|able)|could not|did not|cannot|failed to|only partial\w*|partially|insufficient to|did little to|less than|not enough to)\b[\s\S]{0,25}(offset|pass\w*|recover\w*|mitigat\w*)|\b(offset|pass\w*|recover\w*|mitigat\w*)[\s\S]{0,20}\b(only partial|not (?:fully|enough)|partial\w*)\b/i;
// Revenue-recognition allocation mechanics — standalone selling price, transaction-price
// allocation, performance obligations — carry the pressure vocabulary without a market claim.
const PRICE_REVREC = /\b(standalone selling prices?|SSP\b|revenue recognition|allocat\w*[\s\S]{0,25}transaction prices?|performance obligations?)\b/i;
// An operating-expense line variance is prose about the company's own spending, not about the
// price of its inputs; its "increase ... partially offset by" grammar is bookkeeping, not a squeeze.
const COST_OPEX_VARIANCE = /\b(research and development|r&d expense|sales and marketing|selling, general|general and administrative|g&a\b|stock-based compensation|personnel(?:-related)? (costs?|expenses?)|headcount|hiring)\b/i;
// The cost sentence is declarative about what happened, including the negative case ("we were unable
// to offset"), so it uses a conditional-only guard, not the full HYPO (which would drop that case).
const COST_HYPO = /\b(if\s|may\b|might\b|could\b|risk that|no assurance|in the event|whether (we|the))\b/i;
// Sentences attributing a result to price, which makes a pricing-power claim concrete rather than
// aspirational; preferred when several candidates trip PRICE_UP.
const RESULT_ATTR = /\b(due to|driven by|reflect\w*|result\w* (of|from)|attributable to|primarily|contributed|benefit(?:ed|ing)? from|increase\w* in (net )?(sales|revenue)|higher (net )?(sales|revenue))\b/i;
// The conditional / hypothetical guard: a forward-looking "if we cannot raise prices…" is not the
// company telling you it has pricing power, it is the company naming a risk. Keep those out.
const HYPO = /\b(if\s|may not|might not|unable to|cannot|could not|risk that|no assurance|whether (we|the)|to the extent|should we|were we to|in the event|inability to)\b/i;
// A commodity or market price the company merely TAKES is not pricing power — Alcoa's "higher prices
// for aluminum" is the market moving, not a moat. Exclude price language tied to a commodity, or to a
// market/spot/benchmark/realized price, so the pricing-power read is about a company setting its own.
const PRICE_COMMODITY = /\b(aluminum|alumina|copper|steel|iron ore|crude|\boil\b|natural gas|gas prices?|propane|ethane|ethylene|polyethylene|coal|nickel|zinc|lithium|cobalt|\bgold\b|silver|platinum|palladium|uranium|wheat|corn|soybean|grain|lumber|pulp|\bresin\b|petrochemical|feedstock|hydrocarbon|metal)\b[\s\S]{0,18}pric|pric[a-z]*\b[\s\S]{0,18}\b(aluminum|copper|steel|crude|\boil\b|natural gas|nickel|zinc|\bgold\b|silver|commodit|metal|barrel)\b|\b(market|spot|index|benchmark) prices?\b|average realized price|commodity prices?/i;
// The strongest form of pricing power: a price increase that did NOT cost volume — Buffett's "if you
// can raise prices without losing business to a competitor, you've got a very good business." Volume,
// demand, traffic or comparable sales holding or growing, or an explicit "despite price increases."
const VOLUME_HELD = /\b(volumes?|unit sales|\bunits\b|demand|traffic|transactions?|comparable (store )?sales|same[- ]store sales|shipments?)\b[\s\S]{0,45}\b(grew|increased|rose|higher|\bup\b|strong|robust|resilient|stable|steady|\bflat\b|held|remained|growth|positive)\b|\b(despite|even with|notwithstanding)\b[\s\S]{0,30}\b(price increases?|higher pric|pricing)\b|price increases? more than offset|without (a |any )?(meaningful |material |significant )?(loss|decline|reduction) in (volume|demand|unit)/i;
// "Discount", "reduction" and "lower" live outside product pricing too — a bond sold at a discount to
// par, a present-value/fair-value calculation, a license valuation. Those are not pricing pressure, so
// a sentence anchored in that vocabulary is kept out of the pressure read (Alcoa's note discount, A's
// license valuation slipped through on it).
const PRICE_NONPRODUCT = /\b(initial purchasers?|notes?|bonds?|debentures?|senior|subordinated|convertible|principal amount|par value|present value|discount rate|fair value|carrying value|warrants?|issuance|aggregate proceeds|license agreements?|amortiz|impair|goodwill|intangible|interest rate|yield to|maturit)\b/i;

// The grave accounting-integrity admissions. These are rare in truth, but the risk factors are full
// of hypothetical mentions — "a FAILURE to maintain controls COULD result in a material weakness",
// "we MAY in the FUTURE be required to restate" — so this facet needs a far stricter guard than the
// pricing read: it must be a statement that a weakness or restatement actually HAPPENED, present or
// past tense, with every forward-looking, conditional or remediation-only framing excluded.
const INTEGRITY_FUTURE = /\b(may|might|could|would|should|if|whether|future|risk that|fail(ure)? to|in the event|to the extent|potential|possible|were we|able to|designed to|intended to|in order to|required to|expose us|subject us|result in|lead to|cause us)\b/i;
// A material weakness actually declared as existing/identified, in a factual frame.
const MW_DECLARED = /\b(identified|concluded|determined|disclosed|existed|exists|reported)\b[\s\S]{0,40}\bmaterial weakness/i;
// The absence/cured side widened 2026-07-30 (hygiene pass): "in the past"/"in prior periods"
// framings and "fully remediated" were slipping through, and the cured verb could sit further
// than 40 characters from the noun (Molina's and Trupanion's cured weaknesses shipped as live
// cockroach banners) — the window is now 90.
const MW_ABSENT = /\b(no|not|without|did not (identify|have|note|find)|none|free (of|from)|absence of|reasonable assurance|were not|was not|have not|is not|are not|remediated|been remediated|fully remediated|in the past|in prior (periods?|years?))\b[\s\S]{0,90}material weakness|material weakness(es)?[\s\S]{0,90}\b(did not|were not|was not|have not|not (identif|exist|present)|been remediated|was remediated|fully remediated|in the past|in prior (periods?|years?))/i;
// Another ENTITY'S weakness is not the registrant's: AES wore a banner for its investee
// Fluence's cured weakness. Deny when the weakness is framed as an investee's/venture's.
const MW_OTHER_ENTITY = /\b(investee|equity[\s-]method|unconsolidated|joint venture|acquiree|target compan)/i;
// A restatement that actually happened: past-tense "restated", tied to the financial statements.
// "Amended and Restated Credit Agreement" is a CONTRACT name, not an accounting restatement —
// Boston Properties wore a cockroach banner for refinancing its revolver (2026-07-30 pass).
const RESTATED_CONTRACT = /\bamended and restated\b[\s\S]{0,60}\b(credit (agreement|facility)|revolving|loan agreement|indenture|bylaws|certificate|partnership agreement|lease)/i;
const RESTATED = /\b(restated|have restated|has restated|were restated|restatement of (our|its|the|previously))\b[\s\S]{0,60}\b(financial statements?|prior (period|year)|previously (issued|reported)|results of operations|consolidated|balance sheet)\b|\bpreviously (issued|reported)[\s\S]{0,40}(financial statements?)[\s\S]{0,30}\b(were |have been )?restated\b/i;

// The judgment-heavy estimates a 10-K's "Critical Accounting Estimates" section names. We map the
// topic, not just the word, so the read says where the numbers are soft, not merely that the word
// "goodwill" appears (it appears everywhere in an MD&A; here it counts only inside that section).
const CRIT_HEAD = /critical accounting (estimates?|policies(?: and estimates?)?|judgments?)/i;
const CRIT_TOPICS = [
  ["Goodwill & intangibles", /\b(goodwill|intangible assets?|impairment of (goodwill|long[\s-]?lived|intangible))\b/i],
  ["Revenue recognition", /\brevenue recognition|recogni[sz]\w* revenue|performance obligations?|variable consideration\b/i],
  ["Pension & retirement", /\b(pension|postretirement|post[\s-]?retirement|defined benefit|plan assets|projected benefit obligation)\b/i],
  ["Income taxes", /\b(income taxes?|valuation allowance|uncertain tax positions?|unrecognized tax benefits?|deferred tax)\b/i],
  ["Credit & receivables", /\ballowance for (doubtful accounts?|credit losses|loan losses)|expected credit losses|current expected credit\b/i],
  ["Inventory", /\binventor\w*[\s\S]{0,30}(obsolescence|valuation|reserve|net realizable|lower of cost)|\bLIFO\b/i],
  ["Acquisitions", /\bbusiness combinations?|purchase price allocation|acquisition accounting|fair value of (the )?(net )?assets acquired\b/i],
  ["Insurance reserves", /\b(loss reserves?|reserve for (losses|claims|unpaid)|unpaid (losses|claims)|incurred but not reported|\bIBNR\b|policy(holder)? (reserves|benefits)|future policy benefits)\b/i],
  ["Stock compensation", /\b(stock[\s-]?based compensation|share[\s-]?based (compensation|payments?)|equity[\s-]?based compensation)\b/i],
  ["Contingencies", /\b(loss contingenc\w*|litigation (reserves?|accruals?)|legal (reserves?|contingenc)|contingent (liabilit|consideration)|environmental (reserves?|remediation))\b/i],
];

// Pick the single strongest sentence that trips `want`, avoids every regex in `avoid`, and scores
// up for the `prefer` marks and a quantified statement. Cleaned and length-bounded like the rest.
function bestSentence(sents, want, avoid = [], prefer = []) {
  let best = null, bestScore = -Infinity;
  for (const raw of sents || []) {
    const s = cleanQuote(String(raw || ""));
    if (s.length < 45 || s.length > 300) continue;
    if (!want.test(s) || avoid.some((re) => re.test(s))) continue;
    let score = 0;
    for (const p of prefer) if (p.test(s)) score += 1;
    if (/\d{1,3}(\.\d+)?\s?%/.test(s)) score += 1;
    if (s.length >= 80 && s.length <= 240) score += 1;
    if (BOILERPLATE.test(s)) score -= 2;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// First sentence that DECLARES the grave flag actually happened — strict by design: it must trip the
// declarative pattern, must not be a forward-looking/conditional framing (INTEGRITY_FUTURE), and must
// not be a negation or a remediation-only mention (absent). The risk factors are dense with "could
// result in a material weakness" hypotheticals, so this guard, not the loose pricing one, is what
// keeps the facet to the rare companies that truly admit one.
function integritySentence(sents, declared, absent, deny = null) {
  for (const raw of sents || []) {
    const s = cleanQuote(String(raw || ""));
    if (s.length < 40 || s.length > 300) continue;
    if (INTEGRITY_FUTURE.test(s) || !declared.test(s)) continue;
    if (absent && absent.test(s)) continue;
    if (deny && deny.test(s)) continue;
    return s;
  }
  return null;
}

// The "Critical Accounting Estimates" disclosure: which judgment-heavy figures the company itself
// flags as resting on its assumptions. We find the section in the back of the MD&A (taking the last
// heading match, so a table-of-contents forward-reference doesn't stand in for it) and read the
// topics from the window that follows.
function criticalEstimates(mdnaSents) {
  if (!Array.isArray(mdnaSents) || !mdnaSents.length) return null;
  let idx = -1;
  const from = Math.floor(mdnaSents.length * 0.25);
  for (let i = from; i < mdnaSents.length; i++) if (CRIT_HEAD.test(mdnaSents[i])) idx = i;
  if (idx < 0) return null;
  const zone = mdnaSents.slice(idx, idx + 90);
  const zoneText = zone.join(" ");
  const topics = CRIT_TOPICS.filter(([, re]) => re.test(zoneText)).map(([label]) => label);
  if (!topics.length) return null;
  const quote = (zone.find((s) => { const c = cleanQuote(String(s || "")); return c.length >= 80 && c.length <= 300; }) || zone[0] || "");
  return { topics, count: topics.length, quote: cleanQuote(String(quote)).slice(0, 280) };
}

// The financial SIC band (6000–6799): banks, thrifts, brokers, insurers, REITs, holding and
// investment offices. Their MD&As speak of funding costs, deposit mix and credit costs, which the
// industrial input-cost/pricing-power regexes misread, so the pricing facet is withheld for them.
const isFinancialSic = (sic) => { const n = Number(sic); return n >= 6000 && n <= 6799; };
// The upstream/royalty wall (audit-fix item 8): a producer of crude and gas (SIC 1311) or an oil
// royalty holder (6792 — Texas Pacific, previously behind the financials wall by accident of its
// SIC band) TAKES the commodity price; "higher realized prices" is the market's doing, not a moat,
// and the desk measured the facet 9-for-9 false on the upstream cohort. Withheld, not filtered:
// their pricing story is the price deck, a different lane.
const isPriceTakerSic = (sic) => { const n = Number(sic); return n === 1311 || n === 6792; };

function buffettRead(cur, isFinancial, ogCrit = null) {
  const mdna = cur?.mdna?.sents || [];
  const biz = cur?.business?.sents || [];
  const risk = cur?.risk?.sents || [];
  const sales = [...mdna, ...biz]; // declarative results-of-operations + business prose

  // 1. Pricing & costs — Buffett's margin-durability read. Pricing power is the surest moat mark, so
  // the positive case is read carefully: a price the company SET and tied to a result, not a commodity
  // or market price it merely takes. The strongest form — raising price without losing volume — is
  // marked apart. The cost facet only surfaces when the filing takes a stance on whether rising costs
  // were passed through, since a bare "costs rose" is in almost every MD&A and says nothing.
  // Skipped entirely for banks, insurers and REITs: "input costs" and product pricing power are
  // industrial concepts, and the regexes misread a bank's funding-mix language ("lower-cost deposits
  // increased") as rising input costs. Financials are read on their own terms elsewhere.
  const cq = (raw) => cleanQuote(String(raw || ""));
  let pricing = null;
  if (!isFinancial) {
    const isPower = (s) => PRICE_UP.test(s) && !PRICE_DOWN.test(s) && !HYPO.test(s) && !PRICE_COMMODITY.test(s);
    const power = bestSentence(sales, PRICE_UP, [PRICE_DOWN, HYPO, PRICE_COMMODITY], [RESULT_ATTR, VOLUME_HELD]);
    const powerCount = sales.filter((raw) => isPower(cq(raw))).length;
    // Raised price AND volume/demand held or grew — the textbook moat, in one sentence.
    const powerStrong = sales.some((raw) => { const s = cq(raw); return isPower(s) && VOLUME_HELD.test(s); });
    // Standalone-selling-price / revenue-allocation mechanics match the pressure vocabulary
    // ('price competition' inside an SSP-estimation sentence) while saying nothing about the
    // market: Microsoft's rev-rec note shipped as pricing pressure (audit-fix item 8).
    const pressure = bestSentence(mdna, PRICE_DOWN, [HYPO, PRICE_NONPRODUCT, PRICE_REVREC]);
    // The cost sentence must itself resolve the question — pass-through (COST_OFFSET) or squeeze
    // (OFFSET_NEG) — not merely name inflation. Prefer a quantified one.
    const costStance = mdna
      .map(cq)
      // An operating-expense variance ('R&D grew, partially offset by capitalization') is not a
      // stance on input-cost pass-through, however hard its bare 'partially' leans on OFFSET_NEG —
      // C3.ai's R&D sentence shipped as a cost squeeze (audit-fix item 8).
      .filter((s) => s.length >= 45 && s.length <= 300 && COST_UP.test(s) && !COST_HYPO.test(s) && !COST_OPEX_VARIANCE.test(s) && (COST_OFFSET.test(s) || OFFSET_NEG.test(s)))
      .sort((a, b) => (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0))[0] || null;
    pricing = (power || pressure || costStance)
      ? {
          power: power || null, powerStrong: power ? powerStrong : false, powerCount,
          pressure: pressure || null,
          costInflation: costStance, passedThrough: costStance ? COST_OFFSET.test(costStance) && !OFFSET_NEG.test(costStance) : null,
        }
      : null;
  }

  // 2. Where the numbers are soft. For the O&G scope the caller supplies the sector's own
  // topics (Build 8) measured across every critical-estimates window in the full filing;
  // they LEAD the list (reserve estimation is the sector's first judgment), the generic
  // MD&A-zone topics follow, and the generic quote — when one exists — stands.
  let judgment = criticalEstimates(mdna);
  if (ogCrit?.topics?.length) {
    const topics = [...ogCrit.topics, ...(judgment?.topics || []).filter((t) => !ogCrit.topics.includes(t))];
    judgment = { topics, count: topics.length, quote: judgment?.quote || ogCrit.quote };
  }

  // 3. Accounting integrity.
  const materialWeakness = integritySentence([...mdna, ...risk], MW_DECLARED, MW_ABSENT, MW_OTHER_ENTITY);
  const restatement = integritySentence([...mdna, ...risk], RESTATED, RESTATED_CONTRACT);
  const integrity = materialWeakness || restatement ? { materialWeakness: materialWeakness || null, restatement: restatement || null } : null;

  if (!pricing && !judgment && !integrity) return null;
  return { pricing, judgment, integrity };
}

// ---- Reserve development, in management's own words (Build 4, insurers + managed care as ONE
// lane; docs/qualitative-desks-survey.md §Insurers P1 + §Managed care P1) ----
//
// The single declarative sentence in which management narrates prior-year reserve development,
// shipped ONLY beside the filed number the quant desk already stores
// (lines.reserveDevelopmentPriorYear; sign convention verified three ways — TenYear's dev-kind
// comment, the insurer and managed-care scorecards, and re-measured on this build's own sample:
// TRV −939M ↔ "net favorable", UVE +25.8M ↔ "adverse", UNH −140M ↔ "favorable" — NEGATIVE is
// favorable, uniform). Four gate rungs, all measured on the real FY2025 filings:
//   1. ANCHOR — a declarative sentence carrying a prior-year reference AND a development word
//      AND one unambiguous tone word (definitional/hypothetical/forward framings die on the
//      guards; "adverse deviation" / "moderately adverse" are actuarial terms of art, stripped
//      before the tone is read so Centene's and Molina's methodology prose can't conflict).
//   2. TONE-SIGN — the sentence's favorable/adverse must agree with the stored number's sign.
//      A pool whose only anchored sentences DISAGREE with the sign (W. R. Berkley: narrative
//      "favorable $3 million / $47 million", filed +$34 million adverse) returns a stated
//      CONFLICT record — the page says the two disagree and quotes neither as the fact.
//   3. DOLLAR TIE — a narrated dollar must tie the stored number within 6% (Markel's $488.3M
//      ties exactly; Humana's "$1.0 billion" vs $1,029M ties at 2.8%). Among tying sentences
//      the smallest gap wins, so a consolidated exact tie beats a segment near-miss. The chip
//      is asserted through weld() at write time: it must be the filer's own characters.
//   4. CURRENT-YEAR — the sentence must name the filing's fiscal year, and where it dates the
//      development with "for the year(s) ended …" the current year must be in THAT list
//      (Trupanion's "As of December 31, 2025 … for the year ended December 31, 2024" dies).
// Managed care only: a tone-agreeing, current-year sentence that carries NO dollar at all may
// ship as a cause quote (check: "direction") — the Alignment Health downgrade the survey
// pinned; a sentence with dollars that fail the tie never ships. Insurers ship weld-or-nothing.
const DEV_TONE_FAV = /\bfavorable\b/i;
const DEV_TONE_ADV = /\b(?:unfavorable|adverse)\b/i;
const DEV_TERM_OF_ART = /\badverse\s+deviation\b|\bmoderately\s+adverse\b/gi;
const DEV_PRIOR = /\bprior[\s-]+(?:accident[\s-]+|policy[\s-]+|fiscal[\s-]+|report(?:ed)?[\s-]+)?(?:year|years|period|periods)\b/i;
const DEV_WORD = /\bdevelop(?:ment|ments|ed)\b|\bre-?estimat\w+/i;
// Forward-looking framings only — never "better than expected", the backward comparison that
// carries half the sector's genuine development narration.
const DEV_FORWARD = /\b(?:we\s+)?(?:expect|anticipate)s?\s|\boutlook\b|\bguidance\b|\bgoing\s+forward\b|\bwill\s+(?:likely\s+)?(?:be|continue|result|develop|occur|lead|experience)\b|\bfuture\s+periods?\b|\bcould\s+develop\b|\bmay\s+(?:experience|result|develop|continue)\b|\bsubsequent\s+periods?\b/i;
// Flattened-table debris: two adjacent bare years never occur in prose (Humana's factor-change
// table), and "the following table" names itself (Travelers' catastrophe table lead-in).
const DEV_TABLE = /\b(19|20)\d{2}\s+(19|20)\d{2}\b|\(in\s+(?:thousands|millions)|following\s+tables?\b|tables?\s+(?:below|above)\b/i;
// The subject-scope kill (M4): a segment-scoped development sentence must never weld or
// conflict against the consolidated line — AFG's Q4 segment adverse sliver would otherwise
// manufacture a false disagreement against its favorable consolidated year.
const DEV_SCOPE = /\b(?:segment|division|business\s+unit)\b/i;
// The note headings the M5 window scoper targets, across both kinds: the unpaid-losses note
// and its filer variants (Travelers titles it "Insurance Claim Reserves"; Cincinnati's prose
// sits under the loss-reserves discussion), plus the managed-care claims-payable note.
const DEV_NOTE_HEADS = /(?:Liabilit(?:y|ies)|Reserves?)\s+for\s+(?:Unpaid\s+)?(?:Losses?|Claims?)|Unpaid\s+(?:Losses?|Claims?)\s+and\s+(?:Loss|Claims?)|Insurance\s+Claim\s+Reserves?|Loss(?:es)?\s+and\s+Loss\s+(?:Adjustment\s+)?Expense\s+Reserves?|Prior\s+Year\s+(?:Reserve\s+)?Development|(?:Medical|Health\s?care|Healthcare)\s+(?:Claims?|Costs?)\s+Payable|\bBenefits\s+Payable\b|\bClaims\s+Payable\b|Unpaid\s+Claims/i;

// The lane's own splitter: development sentences legitimately run digit-heavy (UnitedHealth's
// "$140 million, $700 million and $840 million, respectively" is 17% digits, over sentences()'
// prose cap), and a year-label subheading glues onto the note's opening sentence ("2025 In
// 2025, estimated claims…" — Travelers), so boundaries may open on a digit and a leading bare
// year is stripped. Local by design: drivers.mjs' splitter is under a zero-diff regression.
function devSentences(text) {
  if (!text) return [];
  return String(text)
    .split(/(?<=[.!?]["”’']?)\s+(?=[A-Z(“"$0-9]|i[A-Z])/)
    .map((s) => s.replace(/\s+/g, " ").trim().replace(/^(?:(?:19|20)\d{2}\s+)+(?=[A-Z“"$])/, ""))
    .filter((s) => {
      if (s.length < 50 || s.length > 520) return false;
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[a-zA-Z]/g) || []).length;
      return letters >= 60 && digits / (digits + letters) <= 0.4;
    });
}

// One unambiguous tone, or none. A mixed sentence may still resolve through a consistent
// "net favorable/unfavorable" (Travelers narrates gross favorable beside offsetting adverse);
// mixed "net" directions (AFG's quarter-on-quarter comparison) stay ambiguous and ship nothing.
function devTone(s) {
  const t = s.replace(DEV_TERM_OF_ART, " ");
  const fav = DEV_TONE_FAV.test(t), adv = DEV_TONE_ADV.test(t);
  if (fav && !adv) return "favorable";
  if (adv && !fav) return "adverse";
  if (fav && adv) {
    const nets = [...t.matchAll(/\bnet\s+(favorable|unfavorable|adverse)\b/gi)].map((m) => (m[1].toLowerCase() === "favorable" ? "favorable" : "adverse"));
    if (nets.length && nets.every((x) => x === nets[0])) return nets[0];
  }
  return null;
}

function devYearOk(s, fy) {
  if (!new RegExp(`\\b${fy}\\b`).test(s)) return false;
  const ends = [...s.matchAll(/\byears?\s+ended\b/gi)];
  if (ends.length) {
    const named = new Set();
    for (const m of ends) for (const y of s.slice(m.index, m.index + 60).matchAll(/\b(20\d\d)\b/g)) named.add(+y[1]);
    if (named.size && !named.has(fy)) return false;
  }
  return true;
}

function devDollars(s) {
  return [...s.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million)/gi)]
    .map((m) => ({ text: m[0], value: parseFloat(m[1].replace(/,/g, "")) * (/billion/i.test(m[2]) ? 1e9 : 1e6) }));
}

function reserveDevelopmentRead({ mdnaText = "", fullText = "", fy, stored, kind }) {
  if (stored == null || stored === 0 || !fy) return null;
  const filedTone = stored < 0 ? "favorable" : "adverse";
  const pool = [];
  const seen = new Set();
  const push = (s) => { const k = s.toLowerCase().slice(0, 160); if (!seen.has(k)) { seen.add(k); pool.push(s); } };
  for (const s of devSentences(mdnaText)) push(s);
  for (const win of noteWindows(fullText, DEV_NOTE_HEADS)) for (const s of devSentences(win)) push(s);

  const agreeing = [], conflicting = [];
  for (const s of pool) {
    if (!DEV_PRIOR.test(s) || !DEV_WORD.test(s)) continue;
    const tone = devTone(s);
    if (!tone) continue;
    if (HYPO.test(s) || DEV_FORWARD.test(s) || DEV_TABLE.test(s) || DEV_SCOPE.test(s)) continue;
    if (!devYearOk(s, fy)) continue;
    (tone === filedTone ? agreeing : conflicting).push(s);
  }

  // Rung 3: the narrated dollar must tie the stored number within 6%; the smallest gap wins.
  let best = null;
  for (const s of agreeing) {
    for (const d of devDollars(s)) {
      const gap = Math.abs(d.value - Math.abs(stored)) / Math.abs(stored);
      if (gap <= 0.06 && (!best || gap < best.gap)) best = { s, chip: d.text, gap };
    }
  }
  if (best) {
    // The weld law, asserted at write time: the chip must be the filer's own characters.
    const { quote } = weld(best.s, [
      { text: best.chip, kind: "verbatim" },
      { text: String(stored), kind: "computed", source: "lines.reserveDevelopmentPriorYear" },
    ]);
    return { fy, stored, tone: filedTone, sentence: quote, narrated: best.chip, gapPct: +(best.gap * 100).toFixed(1), check: "dollar" };
  }
  // The stated withhold: every anchored sentence disagrees with the filed sign. Say so; quote
  // neither as truth. (Never fired when ANY agreeing sentence exists — a mixed narrative is
  // silence, not a disagreement claim.)
  if (conflicting.length && !agreeing.length) {
    return { fy, stored, conflict: true, narrativeTone: filedTone === "favorable" ? "adverse" : "favorable", filedTone };
  }
  // The managed-care downgrade: a dollar-free cause sentence may ship on direction alone.
  // A sentence carrying ANY dollar figure that failed the tie never ships.
  if (kind === "managedCare") {
    const cause = agreeing.find((s) => !/\$/.test(s));
    if (cause) {
      weld(cause, [{ text: String(stored), kind: "computed", source: "lines.reserveDevelopmentPriorYear" }]);
      return { fy, stored, tone: filedTone, sentence: cause, check: "direction" };
    }
  }
  return null;
}

// ---- uninsured deposits, welded (Build 6 of the qualitative survey, 2026-07-31) ----
// docs/qualitative-desks-survey.md, Banks P3 as CONDITIONED by Section 1 item 3: rung (a)
// plus quote-only for single-figure sentences; rungs (b)/(c) — computing a share or a dollar
// with nothing to check it against — wait for a measured basis-divergence study. This lane is
// the bank replacement for the retired customer-concentration lens (audit-fix item 9): the
// filer's OWN uninsured-deposit disclosure sentence, verbatim, shipped only when it checks
// against the deposits line the quant desk already stores (lines.deposits, XBRL Deposits).
//
// The rungs, measured on the survey's 11 FY2025 bank filings:
//   RUNG (a) — a sentence stating BOTH the dollar and the percent welds only when the dollar
//     over stored Deposits lands within 1.5 points of the STATED percent (FLG: $13.5B/$66.0B
//     = 20.45% vs "20 percent" — inside). Outside 1.5pt is a STATED withhold, never a quote.
//   QUOTE-ONLY — a single-figure sentence (a dollar with no percent, or a percent with no
//     dollar) ships as the quote alone, with NO computed figure beside it: computing the
//     missing side IS rung (b), and rung (b) waits (JPM $1,558.6B, PNC $209.3B on its own
//     FFIEC 031 basis, WAL $22.9B, BMRC "31%" — the survey's clean-prose ships alongside
//     FLG). Dollars are still sanity-bound to stored Deposits (0 < $/Deposits ≤ 1) so a
//     mis-scaled figure can never ship; a dollar with no billion/million unit is refused
//     outright (a "(in thousands)" numeral has no knowable scale in prose).
//   NETTED BASIS — a filer whose uninsured disclosure nets collateralized / affiliate /
//     intercompany deposits produces ZERO welds and ZERO quotes, a stated withhold carrying
//     the filer's own basis words (CUBI "less collateralized and affiliate deposits"; VLY
//     "excluding collateralized government deposits and intercompany deposits"; GCBC's
//     $1.05B collateralized exclusion; EWBC's "adjustment to exclude…"). The numerator is
//     not on the gross XBRL Deposits basis, so the check runs on the wrong denominator —
//     and VLY is the pinned proof that the arithmetic can TIE anyway ($14.6B/$52.2B =
//     27.98% vs its stated "28 percent"): no gate downstream of the basis can see the miss,
//     so the basis itself is the gate.
//   EXCLUDES — FDIC special-assessment boilerplate (anchored "special assessment" /
//     "December 31, 2022" per the survey; present in CUBI, VLY, CFR, PNC, WAL, FLG);
//     hypothetical / risk-factor conditional phrasing, including the reliance idiom
//     ("…and we rely on these deposits for liquidity" — CFR's 52% sentence lives in Item
//     1A); liquidity-COVERAGE sentences, whose figure is the excess or the coverage ratio,
//     never the level (FLG's "$13.6 billion" excess, ZION's "sources of liquidity
//     exceeded…", BMRC's "fully covered by the Bank's available funding sources", CUBI's
//     "124%…161%" — four measured cases); insured-network mitigation programs (WAL's CDARS
//     /ICS sentence, whose $50/$285 million are program limits, not the level); time-deposit
//     SUBSET narration; table debris (digit share, "following table", "(in thousands)", and
//     an all-caps page-header run — ZION's glued "ZIONS BANCORPORATION, NATIONAL
//     ASSOCIATION…" two-figure sentence is a table capture, not clean prose).
// Basis words stay INSIDE the quote: "uninsured or not collateralized by securities or
// letters of credit" (FLG) and "based on the regulatory instructions in … FFIEC 031" (PNC)
// render because the sentence ships verbatim; the fig line carries only the computed
// arithmetic with its named XBRL source. No basis is ever paraphrased outside the quote.
const UNINS_SPECIAL = /special\s+assessments?\b|December\s+31,\s+2022/i;
// An exclusion verb reaching a collateralized/affiliate/intercompany object — or the
// bare "after (certain) exclusions" table caption — is a netted-basis disclosure by
// construction. "less than" is a comparative, never a netting ("deposits less than the
// FDIC limit"), and "not collateralized" / "uncollateralized" carry no exclusion verb, so
// FLG's and BMRC's basis phrases never trip this.
const UNINS_NETTED = /\b(?:excluding|excludes?|excluded|less(?!\s+than\b)|net\s+of|adjust(?:ed|ment)?s?\s+to\s+exclude)\b[^.;]{0,80}\b(?:collateralized|affiliate|intercompany)\b|\bafter\s+(?:certain\s+)?exclusions?\b/i;
// The level statement, in the shapes the 11 filings actually use — noun→amount (JPM "were
// $1,558.6 billion", PNC "was estimated to be $209.3 billion", WAL "of $22.9 billion"),
// dollar-first (FLG "$13.5 billion of deposits that are uninsured"), and percent-of (BMRC
// "31% of uninsured…", CFR-shape "52% of our deposits were uninsured").
const UNINS_LEVEL = new RegExp(
  [
    String.raw`uninsured\s+(?:[a-z][\w'./-]*\s+){0,3}deposits?\b[^.;]{0,120}?\b(?:was|were|is|are|totaled|totaling|amounted\s+to|had|includes?|included|at|of|estimated)(?:\s+(?:estimated|approximately|to\s+be|at))*\s*\$`,
    String.raw`\$\s?[\d,]+(?:\.\d+)?\s*(?:billion|million|trillion)?\s+of\s+(?:[a-z][\w-]*\s+){0,3}deposits?\s+that\s+are\s+uninsured`,
    String.raw`\$\s?[\d,]+(?:\.\d+)?\s*(?:billion|million|trillion)?\s+of\s+uninsured\s+deposits?`,
    String.raw`(?:%|percent)\s+of\s+uninsured`,
    String.raw`(?:%|percent)\s+of\s+(?:[a-z][\w-]*\s+){0,3}deposits?\s+(?:was|were|are|is)\s+uninsured`,
  ].join("|"),
  "i"
);
// Risk-factor conditional phrasing (broader than the global HYPO — none of the five measured
// ships carries could/may/might/would) plus the reliance idiom, the in-sentence marker of
// Item 1A scope that survives CFR's measured MD&A section bleed.
const UNINS_HYPO = /\b(?:could|may|might|would)\b|\bwe\s+rely\b|\breliance\b|\bdepend(?:s|ed|ing|ent|ence)?\b/i;
// A liquidity-coverage claim: exceed/cover linked to liquidity, funding sources, or borrowing
// capacity. "covered by FDIC deposit insurance" (FLG's exemplar) has none of the three nouns
// in reach and is untouched.
const UNINS_COVERAGE = /\b(?:liquidity|funding\s+sources?|borrowing\s+capacity)\b[^.;]{0,120}\b(?:exceed|cover)\w*\b|\b(?:exceed|cover)\w*\b[^.;]{0,120}\b(?:liquidity|funding\s+sources?|borrowing\s+capacity)\b/i;
const UNINS_MITIGATION = /\bmitigat\w+\b|\bCDARS\b|\bIntraFi\b|\bICS\s+programs?\b/i;
const UNINS_TIME_SUBSET = /\btime\s+deposits?\b/i;
const UNINS_TABLE = /table\s+of\s+contents|following\s+tables?\b|tables?\s+(?:below|above)\b|\(in\s+(?:thousands|millions|billions)|\(dollars\s+in|%%/i;
const UNINS_CAPS_RUN = /(?:\b[A-Z]{2,}[,.]?\s+){3,}/;

// The lane's own splitter (local by design, like devSentences — the drivers splitter is under
// a zero-diff regression): sentence-end boundaries plus the bare percent table tail. WAL's
// ship sits directly behind "…Total deposits $ 73,817 2.08 % $ 65,719 2.43 % $ 53,563 2.13 %
// At December 31, 2025…" with no sentence boundary at all — a digit-% tail followed by a
// capital is a table edge, never prose, so it opens a boundary (the drivers precedent, widened
// from the parenthesized form because bank deposit tables print bare rate percents).
function uninsSentences(text) {
  if (!text) return [];
  return String(text)
    .replace(/\s\d{1,4}\s+Table\s+of\s+Contents(?=\s)/gi, " ")
    .split(/(?<=[.!?]["”’']?)\s+(?=[A-Z(“"$0-9])|(?<=\d\s?%)\s+(?=[A-Z])|(?<=\)\s?%)\s+(?=[A-Z])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => {
      if (s.length < 50 || s.length > 520) return false;
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[a-zA-Z]/g) || []).length;
      return letters >= 45 && digits / (digits + letters) <= 0.4;
    });
}

// Stated figures: unit dollars and percents. A dollar numeral with no unit word is refused at
// the candidate gate — its scale is unknowable in flattened prose.
const uninsDollars = (s) => [...s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|trillion)\b/gi)]
  .map((m) => ({ text: m[0], value: parseFloat(m[1].replace(/,/g, "")) * (/trillion/i.test(m[2]) ? 1e12 : /billion/i.test(m[2]) ? 1e9 : 1e6) }));
const uninsUnitlessDollar = (s) => /\$\s?[\d,]+(?:\.\d+)?(?!\s*(?:billion|million|trillion)\b)(?![\d,.])/i.test(s.replace(/\$\s?[\d,]+(?:\.\d+)?\s*(?:billion|million|trillion)\b/gi, " "));
const uninsPcts = (s) => [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi)].map((m) => ({ text: m[0], value: parseFloat(m[1]) }));

// The netted-basis verdict is a FILER-level fact read from raw spans, not prose-filtered
// sentences — VLY's basis phrase rides a digit-heavy table blob no sentence filter keeps.
// Special-assessment spans are ignored first: that boilerplate's own "adjusted to exclude the
// first $5 billion" (WAL, verbatim) would otherwise mark every assessed bank as netted.
function uninsNettedBasis(texts) {
  for (const text of texts) {
    if (!text) continue;
    const re = /uninsured/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const span = text.slice(Math.max(0, m.index - 220), m.index + 320);
      if (UNINS_SPECIAL.test(span)) continue;
      const b = span.match(UNINS_NETTED);
      if (b) return b[0].replace(/\s+/g, " ").trim().slice(0, 120);
    }
  }
  return null;
}

function uninsuredDepositsRead({ mdnaText = "", fullText = "", fy, deposits }) {
  if (!deposits || deposits <= 0 || !fy) return null;
  // The basis gate first: a netted-basis filer ships nothing, and says why.
  const basis = uninsNettedBasis([mdnaText, fullText]);
  if (basis) return { fy, withheld: true, reason: "netted basis", basis };

  const seen = new Set();
  const candidates = [];
  for (const s of uninsSentences(mdnaText)) {
    if (!/uninsured/i.test(s)) continue;
    const k = s.toLowerCase().slice(0, 160);
    if (seen.has(k)) continue;
    seen.add(k);
    if (UNINS_SPECIAL.test(s) || UNINS_TABLE.test(s) || UNINS_CAPS_RUN.test(s)) continue;
    if (UNINS_TIME_SUBSET.test(s) || UNINS_MITIGATION.test(s) || UNINS_COVERAGE.test(s)) continue;
    if (HYPO.test(s) || UNINS_HYPO.test(s)) continue;
    if (!UNINS_LEVEL.test(s)) continue;
    // A named year must reach the filing's fiscal year (drivers' yearOk idiom); FLG's
    // exemplar names no year and passes on the figure gates alone.
    const yrs = [...s.matchAll(/\b(20\d\d)\b/g)].map((y) => parseInt(y[1], 10));
    if (yrs.length && Math.max(...yrs) < fy) continue;
    if (uninsUnitlessDollar(s)) continue;
    const ds = uninsDollars(s), ps = uninsPcts(s);
    if (!ds.length && !ps.length) continue;
    // Sanity bounds against the stored line: no stated dollar above total deposits, no
    // percent above 100 — a mis-scaled or mis-scoped figure fails closed.
    if (ds.some((d) => d.value <= 0 || d.value > deposits * 1.005)) continue;
    if (ps.some((p) => p.value <= 0 || p.value > 100)) continue;
    candidates.push({ s, ds, ps });
  }

  // Rung (a): both figures stated — the dollar over stored Deposits must land within 1.5
  // points of the stated percent. Document order pairs the figures (every measured sentence
  // narrates current year first); the smallest gap wins among passers.
  const two = candidates.filter((c) => c.ds.length && c.ps.length);
  let best = null;
  for (const c of two) {
    const computed = (c.ds[0].value / deposits) * 100;
    const gap = Math.abs(computed - c.ps[0].value);
    if (gap <= 1.5 && (!best || gap < best.gap)) best = { ...c, computed, gap };
  }
  if (best) {
    const computedPct = +best.computed.toFixed(2);
    // The weld law at write time: stated figures are the filer's own characters; the
    // computed percent names its source line.
    const { quote } = weld(best.s, [
      { text: best.ds[0].text, kind: "verbatim" },
      { text: best.ps[0].text, kind: "verbatim" },
      { text: String(computedPct), kind: "computed", source: "lines.deposits (XBRL Deposits)" },
    ]);
    return { fy, deposits, sentence: quote, statedDollar: best.ds[0].text, statedPct: best.ps[0].text, computedPct, gapPct: +best.gap.toFixed(2), check: "pct" };
  }
  // Every two-figure sentence failed the check: a stated withhold for the filer — falling
  // back to a different single-figure sentence would dodge the failed reconciliation.
  if (two.length) {
    const c = two[0];
    const computed = +((c.ds[0].value / deposits) * 100).toFixed(2);
    return { fy, withheld: true, reason: "check", statedDollar: c.ds[0].text, statedPct: c.ps[0].text, computedPct: computed, gapPct: +Math.abs(computed - c.ps[0].value).toFixed(2) };
  }
  // Quote-only: the first single-figure level statement in document order, no computed chip.
  if (candidates.length) {
    const c = candidates[0];
    const anchor = c.ds[0]?.text ?? c.ps[0]?.text;
    const { quote } = weld(c.s, [{ text: anchor, kind: "verbatim" }]);
    return { fy, deposits, sentence: quote, check: "quote" };
  }
  return null;
}

// ---- Software NRR + the customer ladder, in the filer's own words (Build 7 of the
// qualitative survey, 2026-07-31; docs/qualitative-desks-survey.md §Software P1 + P2, both
// pure M3 substring lanes) ----
//
// Two lanes, one law: the lane NEVER computes, totals, normalizes, or restates a number —
// every figure the reader sees is a verbatim substring of the quoted filer sentence, asserted
// through weld() at write time. The survey's own refusal stands behind the design: the seven
// disclosing filers compute INCOMPATIBLE numbers under near-identical labels (Cloudflare's is
// a three-month snapshot, Datadog's trailing-12-month, PagerDuty's fiscal-year), so there is
// no cross-company column, band, or median — each page carries only its own filer's sentence,
// whose basis words ride inside the quote.
//
// LANE 1 — net revenue retention (MD&A only, never Risk Factors). Gates, each measured on the
// FY2025/FY2026 sample filings:
//   ANCHOR — the closed label vocabulary (dollar-based net retention/expansion rate, net
//     dollar retention rate, net ARR expansion rate, net expansion rate, net revenue
//     retention) plus a declarative was/were. Definitional prose ("We calculate…") carries no
//     figure and dies on the figure gate; MongoDB's "Historically… has been over 120%" has no
//     verb-year binding and dies on the period gate.
//   CLOSED FIGURE SET — a percent with an optional approximately/about qualifier, bounded
//     50–300. Datadog's qualitative band ("high-110%'s") is NOT a figure: it is recorded as a
//     BAND (fuel for the discontinuity tripwire), never shipped as a value.
//   PERIOD BINDING — the sentence must name the filing's fiscal year, and the year list's
//     maximum must BE that year (Datadog's "As of December 31, 2024…" sentence inside the
//     FY2025 filing dies here, so a stale figure can never wear the current label).
//   PARALLEL STRUCTURE + MONOTONICITY — on a multi-value sentence the percent count must
//     equal the year count and the years must be strictly monotonic, so value↔period pairing
//     is deterministic (Cloudflare's "120%, 111%, and 115% … 2025, 2024, and 2023"). A
//     revenue-driver sentence whose two years are BOTH the current year (40% new-customer
//     growth beside the 120% retention figure) fails monotonicity and dies.
//   HYPOTHETICAL/FORWARD KILL — Elastic's "if each customer… renewed…, the Net Expansion Rate
//     would be 100%" decoy dies on the illustration guard; JFrog's "We expect our net dollar
//     retention rate to remain relatively stable" dies on the forward guard.
//   CROSS-FILING CORROBORATION (assembly time) — where the current sentence states a
//     prior-year figure, the prior year's filing must carry a consistent figure for that year
//     under the SAME label variant; a conflict is a stated withhold that quotes neither as
//     the fact. Amplitude's two label variants (TTM vs ending) are corroborated each against
//     its own kind and ship as two rows.
//
// LANE 2 — the customer ladder (MD&A first, Business as fallback — sentence-anchored ONLY;
// flattened table rows like Amplitude's "Paying Customers with ARR of $100,000 or greater 698
// 591 18 %" die on the table guard because number-to-year mapping needs the destroyed header).
//   COUNTS — three shapes, all measured: a count adjacent to "customers" (with a closed
//     qualifier set), a comparison-connective count ("compared to 15,114 as of…", "up from
//     3,610"), and the number-of value-run ("The number of paying customers was 332,466,
//     237,714, and 189,791 for…"). PagerDuty's "established Fortune 100 companies" and
//     Datadog's "1,000 out-of-the-box integrations" never parse as counts.
//   CLOSED THRESHOLD SET — a cohort threshold must be a dollar form from the closed set
//     ($5,000/$10,000/$25,000/$50,000/$100,000/$500,000, $100.0 thousand, $1/$1.0/$5/$10
//     million). A metric-bound comparative whose number lost its dollar form to page glue
//     FAILS LOUDLY (recorded + warned), never ships: Cloudflare's "Annualized Revenue greater
//     than 82 Table of contents $100,000" is the pinned case — a naive strip would ship
//     "greater than 82". The glue-strip removes only the literal "Table of Contents" run, so
//     the orphaned page number stays and the closed set refuses the phrase.
//   PERIOD BINDING + PARALLEL STRUCTURE — same law as lane 1, over counts↔years; a
//     single-year sentence may instead pair counts↔thresholds positionally when they
//     interleave (Amplitude's "698 … greater than $100,000 … and 56 … greater than $1.0
//     million"). A sentence where neither pairing is deterministic ships nothing — which is
//     the gate that keeps Amplitude's BIZ "56 and 42 customers" prior-year trap out.
//   SUPERSEDED-BASIS KILL — "Under our prior definition…" (Samsara) never ships.
//
// TRIPWIRE (SW P3 fast-follow, riding these records only — it never reads fresh text):
//   REDEFINED — the same NAMED cohort carries a different closed-set threshold in the two
//     filings' gated rows (Samsara's Core Customers, $10,000 → $25,000). Ships both
//     sentences verbatim side by side.
//   DEGRADED — the same label variant is a numeric figure in one filing and a qualitative
//     band in the other (Datadog: "was about 120%" beside "was high-110%'s"). Both sentences
//     ship side by side. PagerDuty (numeric both years, no cohort renames) fires nothing.

const SW_NRR_LABEL = /(?:\b(ending|trailing\s+(?:12|twelve)[-\s]month)\s+)?\b(dollar-based\s+net\s+(?:retention|expansion)\s+rates?|net\s+dollar\s+retention\s+rates?|net\s+revenue\s+retention(?:\s+rates?)?|net\s+ARR\s+expansion\s+rates?|net\s+expansion\s+rates?)\b(\s*\(\s*TTM\s*\))?/i;
const SW_TABLE = /\b(19|20)\d{2}\s+(19|20)\d{2}\b|\(in\s+(?:thousands|millions|billions)|\(dollars?\s+(?:in|values)|following\s+tables?\b|tables?\s+(?:below|above)\b|as\s+follows\b/i;
const SW_ILLUSTRATION = /\bwould\b|\bfor\s+(?:instance|example)\b|\bhypothetical\b|\billustrat/i;
const SW_FORWARD = /\bwe\s+expect\b|\bexpects?\s+(?:our|to)\b|\banticipate|\bguidance\b|\bgoing\s+forward\b|\bfuture\s+periods?\b|\bmay\s+fluctuate\b/i;
const SW_PRIOR_DEF = /\bunder\s+our\s+(?:prior|previous|former)\s+definition\b|\bpreviously\s+(?:defined|disclosed)\b/i;
// The qualitative band (never a figure, always tripwire fuel): "high-110%'s", "mid-110%s".
const SW_BAND = /\b(?:low|mid|high)-\d{2,3}\s?%'?s?\b/i;
// The closed figure set: a percent, optional approximation qualifier, never a band fragment
// (the lookbehind keeps "110%" inside "high-110%'s" from reading as a figure).
const SW_PCT = /(?:approximately\s+|about\s+|~\s?)?(?<![-\d])\d{2,3}(?:\.\d+)?\s?%(?!'s)/g;
// The closed threshold set: the ladder-threshold universe as filers actually print it.
const SW_THRESH = /\$\s?(?:5|10|25|50|75|100|150|200|250|500)(?:,000|\.0\s*thousand)\b|\$\s?100\.0\s+thousand\b|\$\s?(?:1|2|5|10)(?:\.0)?\s+million\b|\$\s?1,000,000\b/gi;
const SW_METRIC_WORD = /\bARR\b|\bACV\b|annual\s+contract\s+value|annual\s+run-rate\s+revenue|annual(?:ized)?\s+(?:recurring\s+)?revenue|\bspend(?:ing)?\b|\bannually\b/i;

// The lane's own splitter. The glue-strip removes ONLY the literal "Table of Contents" run —
// deliberately NOT the page number beside it, so a threshold phrase the glue destroyed stays
// destroyed and fails the closed set loudly instead of quietly re-assembling into a pass. A
// LEADING page number on a sentence is stripped (it is provably not content there).
function swSentences(text) {
  if (!text) return [];
  return String(text)
    .replace(/\bTable\s+of\s+Contents\b/gi, " ")
    .split(/(?<=[.!?]["”’']?)\s+(?=[A-Z(“"$0-9])/)
    .map((s) => s.replace(/\s+/g, " ").trim().replace(/^\d{1,4}\s+(?=[A-Z“"$])/, ""))
    .filter((s) => {
      if (s.length < 40 || s.length > 620) return false;
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[a-zA-Z]/g) || []).length;
      return letters >= 40 && digits / (digits + letters) <= 0.4;
    });
}

const swYears = (s) => [...s.matchAll(/\b(20\d\d)\b/g)].map((m) => parseInt(m[1], 10));
const swMonotonic = (ys) => ys.every((y, i) => i === 0 || y < ys[i - 1]) || ys.every((y, i) => i === 0 || y > ys[i - 1]);
const swNum = (v) => parseFloat(String(v).replace(/[^\d.]/g, ""));

// Lane 1: the filer's own NRR sentence, MD&A scope only.
function softwareRetentionRead(mdnaText, fy) {
  if (!fy) return { fy, retention: [], bands: [] };
  const rows = [], bands = [];
  const seenKey = new Set();
  for (const s of swSentences(mdnaText)) {
    const lm = s.match(SW_NRR_LABEL);
    if (!lm) continue;
    if (SW_TABLE.test(s)) continue;
    if (HYPO.test(s) || SW_ILLUSTRATION.test(s) || SW_FORWARD.test(s)) continue;
    const key = ((lm[1] ? lm[1].toLowerCase().replace(/twelve/, "12").replace(/\s+/g, " ") + " " : "")
      + lm[2].toLowerCase().replace(/\s+/g, " ").replace(/rates\b/, "rate")
      + (lm[3] ? " (ttm)" : "")).trim();
    const years = swYears(s);
    if (!years.length || Math.max(...years) !== fy) continue;
    // The band path: a qualitative value is recorded for the tripwire, never shipped as a figure.
    if (SW_BAND.test(s) && ![...s.matchAll(SW_PCT)].length) {
      if (!bands.some((b) => b.key === key)) bands.push({ key, label: lm[0].trim(), band: s.match(SW_BAND)[0], sentence: s });
      continue;
    }
    // The closed figure set, bounded: an NRR outside 50–300 is not this metric.
    if (!/\b(?:was|were)\b/i.test(s)) continue;
    const figs = [...s.matchAll(SW_PCT)].map((m) => m[0]).filter((f) => { const n = swNum(f); return n >= 50 && n <= 300; });
    if (!figs.length) continue;
    // Parallel structure + monotonicity: values pair to years positionally, or not at all.
    if (figs.length !== years.length || !swMonotonic(years)) continue;
    const idx = years.indexOf(fy);
    if (idx < 0) continue;
    const figure = figs[idx];
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    // The weld law at write time: the figure is the filer's own characters.
    weld(s, [{ text: figure, kind: "verbatim" }]);
    rows.push({ key, label: lm[0].trim(), figure, periods: years.map((y, i) => ({ y, v: figs[i] })), sentence: s });
  }
  return { fy, retention: rows, bands };
}

// Lane 2 count extraction: the three measured shapes, each returning { text, value, index }.
const SW_COUNT_QUAL = String.raw`(?:(?:more\s+than|over|approximately|about|nearly)\s+)?`;
function swCounts(s) {
  const out = [];
  const push = (text, index) => {
    const v = parseInt(text.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(v) || v < 10) return;
    // A bare four-digit year is never a customer count (a comma-grouped "2,025" would be),
    // and a day-of-month glued behind its month name ("December 31, …") is a date, not a
    // count — the guards that keep a date-glued run ("…2025, 1,168 of our customers") clean.
    const raw = text.replace(/^(?:more\s+than|over|approximately|about|nearly)\s+/i, "");
    if (/^(?:19|20)\d\d$/.test(raw)) return;
    if (/(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*$/i.test(s.slice(Math.max(0, index - 12), index))) return;
    if (out.some((c) => index >= c.index && index < c.index + c.text.length)) return;
    out.push({ text: text.trim(), value: v, index });
  };
  // (a) adjacency: a count — or an explicit ", and"-separated run of counts (ServiceNow's
  // "We had 603, 502, and 420 customers…") — directly qualifying "customers". A number token
  // is whole (comma-grouped thousands never split), and bare space-separated numbers never
  // chain, so a flattened table row cannot read as a run.
  const NUM = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
  const adj = new RegExp(String.raw`((?:${SW_COUNT_QUAL}(?:${NUM}))(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)(?:${SW_COUNT_QUAL}(?:${NUM})))*)\s+(?:(?:paying|total|large|new|Core)\s+)?(?:of\s+(?:our|the)\s+)?[Cc]ustomers\b`, "g");
  for (const m of s.matchAll(adj)) {
    // Re-tokenize the run with the same NUM shape — a naive comma split would break a
    // comma-grouped thousand ("approximately 8,700" is one count, not two).
    const tok = new RegExp(String.raw`(?:(?:more\s+than|over|approximately|about|nearly)\s+)?(?:${NUM})`, "g");
    for (const t of m[1].matchAll(tok)) push(t[0], m.index + t.index);
  }
  // (b) the number-of value-run: "number of … customers … was N, N and N".
  if (/number\s+of\s+(?:our\s+)?(?:paying\s+|paid\s+|total\s+|large\s+)?customers/i.test(s)) {
    const vm = s.match(/\b(?:was|were)\s+/i);
    if (vm) {
      let at = vm.index + vm[0].length;
      const tokenRe = /^(?:\s*(?:over|approximately|about|more\s+than|nearly|and)\s+|\s*,\s*)*\s*(\d{1,3}(?:,\d{3})+|\d+)(?!\s*%)/;
      for (;;) {
        const t = s.slice(at).match(tokenRe);
        if (!t) break;
        const i = at + t[0].indexOf(t[1]);
        // A bare four-digit year in the run means the scan crossed into a date — stop before
        // it (the RAW token: a comma-grouped "2,052" is a count, never a year).
        if (/^(?:19|20)\d\d$/.test(t[1])) break;
        const qual = s.slice(at, i).match(/(?:over|approximately|about|more\s+than|nearly)\s*$/i);
        push((qual ? qual[0].trim() + " " : "") + t[1], qual ? i - qual[0].length : i);
        at = i + t[1].length;
      }
    }
  }
  // (c) comparison connectives: the count may drop its noun ("compared to 15,114 as of…").
  const cmp = new RegExp(String.raw`\b(?:compared\s+to|up\s+from|down\s+from|increasing\s+from|decreasing\s+from|from)\s+(${SW_COUNT_QUAL}\d[\d,]*)(?!\s*%)`, "gi");
  for (const m of s.matchAll(cmp)) {
    const after = s.slice(m.index + m[0].length).match(/^\s*(\S+)/);
    const next = after ? after[1].toLowerCase().replace(/[^a-z]/g, "") : "";
    // The number must read as a customer count in context: followed by "customers", a date, or
    // a list continuation — "from 713 employees" is somebody else's number.
    if (next && !["customers", "as", "and", "to", "in"].includes(next) && !/^(?:january|february|march|april|may|june|july|august|september|october|november|december)$/.test(next)) continue;
    push(m[1], m.index + m[0].indexOf(m[1].trim()));
  }
  return out.sort((a, b) => a.index - b.index);
}

// Lane 2: the customer ladder. MD&A first (the metrics' home), Business as fallback.
function customerLadderRead({ mdnaText = "", businessText = "", fy }) {
  if (!fy) return { fy, ladder: [], refused: [] };
  const byKey = new Map();
  const refused = [];
  for (const body of [mdnaText, businessText]) {
    for (const s of swSentences(body)) {
      if (!/customers/i.test(s)) continue;
      if (SW_TABLE.test(s) || SW_PRIOR_DEF.test(s)) continue;
      if (/\bif\s/i.test(s) || SW_ILLUSTRATION.test(s)) continue;
      const counts = swCounts(s);
      // Thresholds from the closed set, in order.
      const thresholds = [...s.matchAll(SW_THRESH)].map((m) => ({ text: m[0].trim(), index: m.index }));
      // The loud gate: a metric-bound comparative whose number is NOT a closed-set dollar form
      // (page glue ate the real threshold). Recorded and warned, never shipped, and the
      // sentence produces no rows at all.
      let loud = false;
      for (const m of s.matchAll(/\b(?:greater\s+than|more\s+than|in\s+excess\s+of|at\s+least|over)\s+(\d[\d,]*)(?!\s*%)(?![\d,])/gi)) {
        const numAt = m.index + m[0].search(/\d/);
        if (counts.some((c) => numAt >= c.index && numAt < c.index + c.text.length)) continue;
        const before = s.slice(Math.max(0, m.index - 80), m.index);
        const afterTx = s.slice(m.index + m[0].length, m.index + m[0].length + 60);
        if (SW_METRIC_WORD.test(before) || SW_METRIC_WORD.test(afterTx)) {
          refused.push({ reason: "threshold set", token: m[0].trim(), sentence: s });
          console.warn(`  ! customer ladder: threshold "${m[0].trim()}" fails the closed set (page glue?) — refused loudly, sentence ships nothing`);
          loud = true;
        }
      }
      if (loud) continue;
      if (!counts.length) continue;
      const years = swYears(s);
      if (!years.length || Math.max(...years) !== fy) continue;
      const cohortName = (s.match(/,\s*or\s+((?:[A-Z][\w-]*\s+){1,2}Customers)\b/) || s.match(/\b((?:Core|Impact)\s+Customers)\b/) || [])[1] || null;
      const rows = [];
      if (thresholds.length <= 1 && counts.length === years.length && swMonotonic(years)) {
        // Period series: counts pair to years positionally; the current year's count ships.
        const idx = years.indexOf(fy);
        if (idx >= 0) rows.push({ count: counts[idx].text, threshold: thresholds[0]?.text || null });
      } else if (years.length === 1 && counts.length === thresholds.length && counts.length >= 1) {
        // Cohort series: each count pairs with its nearest FOLLOWING threshold, disjointly.
        let ok = true;
        for (let i = 0; i < counts.length; i++) {
          const next = counts[i + 1]?.index ?? Infinity;
          if (!(thresholds[i].index > counts[i].index && thresholds[i].index < next)) ok = false;
        }
        if (ok) for (let i = 0; i < counts.length; i++) rows.push({ count: counts[i].text, threshold: thresholds[i].text });
      }
      for (const r of rows) {
        const key = r.threshold ? "t:" + String(swNum(r.threshold) * (/million/i.test(r.threshold) ? 1e6 : /thousand/i.test(r.threshold) ? 1e3 : 1)) : "total";
        const periods = counts.length === years.length ? years.length : 1;
        const prev = byKey.get(key);
        // First hit wins, except a multi-period sentence (the count WITH its prior-year
        // comparison) outranks a single-period one for the same rung.
        if (prev && !(periods > prev.periods)) continue;
        weld(s, [{ text: r.count, kind: "verbatim" }, ...(r.threshold ? [{ text: r.threshold, kind: "verbatim" }] : [])]);
        byKey.set(key, { count: r.count, threshold: r.threshold, cohort: cohortName, sentence: s, periods });
      }
    }
  }
  const ladder = [...byKey.values()].map(({ count, threshold, cohort, sentence }) => ({
    count, ...(threshold ? { threshold } : {}), ...(cohort ? { cohort } : {}), sentence,
  }));
  return { fy, ladder, refused };
}

// Per-filing read (runs inside getFiling, where the section texts are in hand).
function softwareKpiRead({ mdnaText = "", businessText = "", fy }) {
  const nrr = softwareRetentionRead(mdnaText, fy);
  const lad = customerLadderRead({ mdnaText, businessText, fy });
  if (!nrr.retention.length && !nrr.bands.length && !lad.ladder.length && !lad.refused.length) return null;
  return { fy, retention: nrr.retention, bands: nrr.bands, ladder: lad.ladder, refused: lad.refused };
}

const swThreshValue = (t) => swNum(t) * (/million/i.test(t) ? 1e6 : /thousand/i.test(t) ? 1e3 : 1);

// Cross-filing assembly: prior-year corroboration and the discontinuity tripwire. Compares
// only already-gated records — it never reads fresh text, so it inherits their anchoring.
function softwareKpiAssemble(cur, pri) {
  if (!cur) return null;
  const nrr = [], withheld = [];
  for (const r of cur.retention || []) {
    const p = (pri?.retention || []).find((x) => x.key === r.key);
    let conflict = null, corroborated = false;
    for (const pd of r.periods || []) {
      if (pd.y >= cur.fy) continue;
      const pp = p?.periods?.find((q) => q.y === pd.y);
      if (!pp) continue;
      if (Math.abs(swNum(pd.v) - swNum(pp.v)) > 0.001) conflict = { year: pd.y, current: r.sentence, prior: p.sentence };
      else corroborated = true;
    }
    if (conflict) {
      console.warn(`  ! NRR: the ${conflict.year} figure disagrees across filings — stated withhold, neither quoted as the fact`);
      withheld.push({ label: r.label, ...conflict });
      continue;
    }
    nrr.push({ label: r.label, figure: r.figure, sentence: r.sentence, ...(corroborated ? { corroborated: true } : {}) });
  }
  const tripwire = [];
  // REDEFINED: the same named cohort, a different closed-set threshold across the filings.
  for (const c of cur.ladder || []) {
    if (!c.cohort || !c.threshold) continue;
    const p = (pri?.ladder || []).find((x) => x.cohort && x.threshold && x.cohort.toLowerCase() === c.cohort.toLowerCase());
    if (p && swThreshValue(p.threshold) !== swThreshValue(c.threshold))
      tripwire.push({ flag: "REDEFINED", label: c.cohort, current: c.sentence, prior: p.sentence });
  }
  // DEGRADED: numeric on one side of the pair, a qualitative band on the other, same variant.
  for (const r of cur.retention || []) {
    const b = (pri?.bands || []).find((x) => x.key === r.key);
    if (b) tripwire.push({ flag: "DEGRADED", label: r.label, current: r.sentence, prior: b.sentence });
  }
  for (const b of cur.bands || []) {
    const p = (pri?.retention || []).find((x) => x.key === b.key);
    if (p) tripwire.push({ flag: "DEGRADED", label: b.label, current: b.sentence, prior: p.sentence });
  }
  const ladder = (cur.ladder || []).map(({ count, threshold, cohort, sentence }) => ({
    count, ...(threshold ? { threshold } : {}), ...(cohort ? { cohort } : {}), sentence,
  }));
  const refused = (cur.refused || []).slice(0, 2);
  if (!nrr.length && !withheld.length && !ladder.length && !tripwire.length && !refused.length) return null;
  return {
    fy: cur.fy,
    ...(nrr.length ? { nrr } : {}),
    ...(withheld.length ? { withheld } : {}),
    ...(ladder.length ? { ladder } : {}),
    ...(tripwire.length ? { tripwire } : {}),
    ...(refused.length ? { refused } : {}),
  };
}

// ---- Who stands behind the reserves + O&G critical-estimates topics (Build 8 of the
// qualitative survey, 2026-07-31; docs/qualitative-desks-survey.md §O&G P1 + P2 bundled) ----
//
// LANE 1 — reserve-engineer attribution (Reg S-K Item 1202(a)(7)/(8)): WHICH independent
// petroleum engineering firm stands behind the proved-reserve estimates, in the filer's own
// words. Gates, each measured on the 15-name FY2025 corpus (CVX XOM COP EOG FANG EQT MTDR
// EGY TPL DVN CRK SD NOG BSM OXY):
//   FIRM DICTIONARY — the named independent firms only, and a firm must appear >= 2 times in
//     the filing (a passing mention is not an attribution); dictionary miss = silence. All
//     five firm groups the corpus carries reproduce: NSAI (BSM, EQT, MTDR, EGY, CRK), D&M
//     (CVX, COP, DVN, EOG), Ryder Scott (FANG, OXY, TPL), Cawley Gillespie (NOG, SD), GLJ
//     (EGY, second firm — its "Prior to 2025" dating rides inside its own quoted sentence).
//   VERB FIDELITY — the filer's own verb, the token nearest the firm's name in the sentence,
//     NEVER normalized: "reviewed" is never rendered as "audited". ConocoPhillips and
//     Occidental retain review firms and render "reviewed"; Devon and Chevron render "audit";
//     SandRidge and Texas Pacific render "prepared". The verb is welded (substring of the
//     quote) at write time.
//   COVERAGE — a share-of-reserves percent renders ONLY from inside the chosen sentence with
//     its verbatim object phrase (DVN "91%" "of our proved reserves"; CVX "approximately 13
//     percent" "of Chevron's total proved reserves" — the legacy-Hess frame rides inside the
//     quote). Exactly one qualified percent in the sentence, and the object phrase must name
//     reserves — EOG's multi-year "84%, 85% and 83%" opinion sentence can never chip.
//   PV-TOKEN BAN — no PV-10 / present-value figures in this lane: a percent whose sentence
//     or object carries a present-value token never chips (Comstock's "audited 100% of our
//     total PV 10 Value" ships its verb and quote, but 100%-of-value never wears a
//     reserves-coverage chip — the basis would be wrong).
//   INTERNAL-ONLY (the XOM class) — when NO dictionary firm appears anywhere, the lane may
//     still say the process is internal, but only from the filer's own sentence under its
//     Item 1202(a)(7) qualifications heading ("ExxonMobil has a dedicated Global Reserves
//     and Resources group… separate from the operating organization"). No heading, no
//     sentence — silence.
//
// LANE 2 — the sector's critical-estimates topics: proved-reserve estimation, depletion /
// units-of-production DD&A, ceiling test / impairment of properties, asset retirement
// obligations — vocabulary hits inside the filer's own Critical Accounting Estimates
// window(s), scanned across EVERY heading occurrence in the full filing text (the M5
// noteWindows precedent: EQT's real section hides behind ten in-section echoes; CVX's and
// DVN's sit past the extracted MD&A). O&G-TAXONOMY-SCOPED: the vocabulary runs only for the
// producer/integrated/royalty SICs (1311, 2911, 6792), so "reserves" NEVER collides with an
// insurer's loss reserves. Topic evidence must be a prose sentence (no tables), never a
// cross-reference, and never a present-value sentence. Measured: 15/15 corpus names name
// reserve estimation — the survey's 13/15 undercounted by two because EGY's section
// continues past ARO/taxes into "Oil and Gas Accounting — Reserves Determination" and XOM's
// zone was unreachable behind the extraction gap the survey itself flags; both filers name
// the judgment verbatim in their own sections, so both render.
const OG_FIRMS = [
  ["Netherland, Sewell & Associates", /Netherland,?\s+Sewell(?:\s*(?:&|and)\s*Associates)?(?:,?\s+Inc\.?)?|\bNSAI\b/],
  ["Ryder Scott", /Ryder\s+Scott(?:\s+Company)?(?:,?\s+L\.?P\.?)?/],
  ["DeGolyer and MacNaughton", /DeGolyer\s+(?:and|&)\s+MacNaughton|\bD&M\b/],
  ["Cawley, Gillespie & Associates", /Cawley,?\s+Gillespie(?:\s*(?:&|and)\s*Associates)?(?:,?\s+Inc\.?)?|\bCGA\b/],
  ["W.D. Von Gonten", /(?:W\.?\s?D\.?\s+)?Von\s+Gonten/],
  ["Miller and Lents", /Miller\s+(?:and|&)\s+Lents/],
  ["LaRoche Petroleum Consultants", /LaRoche\s+Petroleum/],
  ["Sproule", /\bSproule\b/],
  ["McDaniel & Associates", /McDaniel\s+(?:&|and)\s+Associates/],
  ["GLJ", /\bGLJ\b/],
  ["Haas Petroleum Engineering", /Haas\s+Petroleum/],
  ["Forrest Garb & Associates", /Forrest\s+(?:A\.\s+)?Garb/],
  ["KLS Petroleum Consulting", /\bKLS\b/],
  ["Wright & Company", /Wright\s+(?:&|and)\s+Co/],
];
// The filer's verb universe as the corpus writes it — prepared / audited / evaluated /
// reviewed families, including the noun forms filers use verbally ("to complete an audit
// of", "perform independent reserves evaluation"). Estimating verbs stay OUT: "In
// estimating our PDP reserves, we and Ryder Scott… may prove to be incorrect" is TPL's risk
// factor, not its attribution.
const OG_VERB = /\b(?:audited|audits?|auditing|prepared|prepares?|preparing|evaluated|evaluates?|evaluating|evaluations?|reviewed|reviews?|reviewing)\b/gi;
const OG_DEBRIS = /\bconsent of\b|\bfiled herewith\b|\bfurnished herewith\b|\bincorporated (?:herein )?by reference\b|\bexhibit\b/i;
const OG_ATTR_HYPO = /\b(?:could|may|might|would)\b/i;
const OG_PV = /\bPV[-\s]?10\b|\bpresent value\b|\bstandardized measure\b|\bfuture net (?:cash flows?|revenues?)\b/i;
const OG_PCT = /(?:(?:approximately|about|over|nearly|at least|not less than|more than)\s+)?\d{1,3}(?:\.\d+)?\s?(?:%|percent\b)/gi;

// The lane's own splitter (the devSentences precedent — local by design). Two shapes taught
// it: "Inc."/"L.P." inside a firm's registered name is not a sentence end (Comstock's
// attribution split in half without the lookbehind), and a leading page number or footnote
// marker is provably not content.
function ogSentences(text) {
  if (!text) return [];
  return String(text)
    .replace(/\d+\s+table of contents/gi, " ")
    .split(/(?<=[.!?]["”’']?)(?<!\b(?:Inc|Ltd|Corp|Co|No|L\.P)\.["”’']?)\s+(?=[A-Z(“"$0-9])/)
    .map((s) => s.replace(/\s+/g, " ").trim().replace(/^\(\d+\)\s+/, "").replace(/^\d{1,4}\s+(?=[A-Z“"$])/, ""))
    .filter((s) => {
      if (s.length < 60 || s.length > 600) return false;
      if (/table of contents/i.test(s)) return false;
      if (/^\d{1,3}\.\d+\*?\s/.test(s)) return false; // an exhibit-index row ("99.1* Audit Letter of …")
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[a-zA-Z]/g) || []).length;
      return letters >= 60 && digits / (digits + letters) <= 0.3;
    });
}

// The filer's own verb — the dictionary token nearest the firm's name. Verb fidelity is
// absolute: whatever word this returns is the word the page shows.
function ogNearestVerb(s, firmIdx, firmLen) {
  let best = null;
  for (const m of s.matchAll(new RegExp(OG_VERB.source, "gi"))) {
    const d = m.index > firmIdx ? m.index - (firmIdx + firmLen) : firmIdx - (m.index + m[0].length);
    if (d <= 90 && (!best || d < best.d)) best = { verb: m[0], d };
  }
  return best?.verb ?? null;
}

// The in-sentence coverage share: exactly one qualified percent whose "of …" object phrase
// names reserves and carries no present-value token. The object is trimmed where the
// sentence moves on from WHAT was covered to when/where — the trim only shortens a phrase
// that remains a literal substring of the quote, so the weld still holds.
function ogCoverage(s) {
  const ms = [...s.matchAll(new RegExp(OG_PCT.source, "gi"))];
  if (ms.length !== 1) return null;
  const m = ms[0];
  const om = s.slice(m.index + m[0].length).match(/^\s*(of\s+[^.();]{3,140})/i);
  if (!om) return null;
  const object = om[1]
    .split(/\s+(?:as of|attributable to|disclosed|were|was|which|and (?:is|are|does))\s+|\s+for\s+(?=(?:19|20)\d\d)|,\s+(?=(?:a|an|the)\s+\w+\s+of\b)/i)[0]
    .replace(/[\s,]+$/, "");
  if (!/reserves\b/i.test(object)) return null;
  if (OG_PV.test(object)) return null;
  return { pct: m[0], object };
}

function reserveEngineerRead({ fullText = "", fy }) {
  if (!fullText || !fy) return null;
  const eligible = [];
  for (const [firm, re] of OG_FIRMS) {
    const n = (fullText.match(new RegExp(re.source, "g")) || []).length;
    if (n >= 2) eligible.push({ firm, re, n });
  }
  const sents = eligible.length ? ogSentences(fullText) : [];
  const firms = [];
  for (const { firm, re, n } of eligible) {
    let best = null;
    for (const s of sents) {
      const fm = s.match(new RegExp(re.source));
      if (!fm) continue;
      if (OG_DEBRIS.test(s) || OG_ATTR_HYPO.test(s)) continue;
      const verb = ogNearestVerb(s, fm.index, fm[0].length);
      if (!verb) continue;
      // The PV ban: a percent may chip only from a PV-free sentence with a reserves object.
      const coverage = OG_PV.test(s) ? null : ogCoverage(s);
      let score = 0;
      if (coverage) score += 3;
      if (/\bindependent(?:ly)?\b/i.test(s)) score += 1;
      if (OG_PV.test(s)) score -= 1;
      if (!best || score > best.score) best = { firm, count: n, verb, coverage, sentence: s, score };
    }
    if (best) firms.push(best);
  }
  firms.sort((a, b) => b.count - a.count);
  if (firms.length) {
    // The weld law at write time: the verb and both coverage halves are the filer's own characters.
    for (const f of firms) {
      weld(f.sentence, [
        { text: f.verb, kind: "verbatim" },
        ...(f.coverage ? [{ text: f.coverage.pct, kind: "verbatim" }, { text: f.coverage.object, kind: "verbatim" }] : []),
      ]);
    }
    return { fy, firms: firms.map(({ firm, verb, coverage, sentence }) => ({ firm, verb, ...(coverage ? { coverage } : {}), sentence })) };
  }
  if (eligible.length) return null; // a firm is named but no clean sentence — silence over debris
  // Internal-only, the XOM class: no dictionary firm anywhere, and the filer's own
  // qualifications heading declares the internal arrangement in its own sentence.
  const qm = fullText.match(/Qualifications of[^.]{0,90}(?:Reserves?|reserves?)/);
  if (qm) {
    const win = fullText.slice(qm.index, qm.index + 3000);
    let sent = ogSentences(win).find((s) => /\b(?:internal|dedicated|its own)\b[^.]{0,160}\b(?:group|staff|engineers?|organization|personnel)\b/i.test(s) && !OG_ATTR_HYPO.test(s));
    if (sent) {
      // The Item 1202(a)(7) heading glues onto the zone's first sentence; strip only that
      // bounded, anchored heading run, never sentence content.
      sent = sent.replace(/^Qualifications of\b.{0,140}?Proved Reserves\s+(?=[A-Z])/, "");
      weld(sent, []);
      return { fy, internal: true, sentence: sent };
    }
  }
  return null;
}

// A cross-reference names a topic without discussing it — EGY's notes point "see 'Item 1.
// Business Reserve Information'" at a section that lives elsewhere; the pointer is not the
// filer naming a judgment.
const OG_CRIT_XREF = /\bsee\b[^.]{0,90}\b(?:item|note|business|report)\b|\bdiscussed\s+(?:in|under|below)\b|\brefer\s+to\b|\bfor further discussion\b|\bin item\s+\d/i;
const OG_CRIT_TOPICS = [
  ["Oil & gas reserve estimates", /\b(?:proved|oil and(?: natural)? gas|crude oil|natural gas)\b[^.;]{0,60}\breserves?\b[^.;]{0,120}\bestimat|\bestimat\w*[^.;]{0,60}\b(?:proved|oil and(?: natural)? gas)\s+reserves?\b|\breserves?\s+estimat(?:es?|ion)\b|\bestimat(?:es?|ion|ing)\s+of\s+(?:proved\s+)?(?:oil|gas|crude|natural gas|reserves)/i],
  ["Depletion & DD&A", /\bunits?[\s-]of[\s-]production\b|\bdepletion\b|\bDD&A\b/i],
  ["Ceiling test / impairment of properties", /\bceiling\s+test\b|\bimpair\w*[^.;]{0,80}\b(?:proved|oil and(?: natural)? gas|unproved)\s+propert|\b(?:proved|oil and(?: natural)? gas|unproved)\s+propert\w*[^.;]{0,80}\bimpair/i],
  ["Asset retirement obligations", /\basset\s+retirement\s+obligations?\b/i],
];

function ogCriticalTopics(fullText, { maxChars = 12000 } = {}) {
  if (!fullText) return null;
  const found = new Map();
  const re = new RegExp(CRIT_HEAD.source, "gi");
  let m, lastEnd = -1;
  while ((m = re.exec(fullText)) !== null) {
    if (m.index < lastEnd) continue;
    const win = fullText.slice(m.index, m.index + maxChars);
    lastEnd = m.index + win.length;
    const sents = ogSentences(win).filter((s) => {
      if (OG_CRIT_XREF.test(s)) return false;
      if (OG_PV.test(s) || /following tables?\b|tables? (?:below|above)\b/i.test(s)) return false;
      // Evidence must be prose-grade: a flattened reserve-rollforward row is not the filer
      // naming a judgment (EQT's "Balance at January 1, 2025 7,460 …").
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[a-zA-Z]/g) || []).length;
      return digits / (digits + letters) <= 0.09;
    });
    for (const [label, tre] of OG_CRIT_TOPICS) {
      if (found.has(label)) continue;
      const hit = sents.find((s) => tre.test(s));
      if (hit) found.set(label, hit);
    }
  }
  if (!found.size) return null;
  // List order, not discovery order: reserve estimation is THE sector judgment and leads.
  const topics = OG_CRIT_TOPICS.map(([label]) => label).filter((l) => found.has(l));
  return { topics, quote: cleanQuote(found.get(topics[0]) || "").slice(0, 280) || null };
}

// ---- REIT re-leasing spreads + occupancy (Build 9 of the qualitative survey, 2026-07-31;
// docs/qualitative-desks-survey.md §REIT P1 + P2 bundled on quoteWeld) ----
//
// LANE A — re-leasing economics, the landlord's own pricing line: the MD&A/Business sentence
// where the filer states the rent achieved on new and renewal leases against the expiring
// rent. Gates, each measured on the survey's 10-filing FY2025 corpus (PLD BRX REXR O KIM BDN
// SPG AVB HST + the residential/hotel refusal class):
//   COMPOUND-TOKEN ANCHORS ONLY, never bare "spread" — a REIT 10-K's bare "spread" is
//     interest-rate language (all 8 KIM and 5 BDN occurrences are SOFR/credit spreads:
//     "plus an applicable spread determined by the Company's credit ratings"); the anchors
//     are the doc's three: rent/leasing/re-leasing/releasing spreads, rent change on leases,
//     rent recapture rate. SOFR/basis-point/credit-rating sentences are rejected outright.
//   PERIOD IN THE QUOTE — the record's fiscal year named in the sentence (BRX "During 2025",
//     O "During the year ended December 31, 2025"); sub-annual periods rejected (O's Q4
//     recapture sentence dies on "three months ended"). One measured extension: a verb-led
//     highlights BULLET ("Executed a total 478 new and renewal leases… with leasing spreads
//     of 23.4%…", Rexford) carries no period of its own — the quote becomes the contiguous
//     two-sentence span with its immediately preceding, fiscal-year-dated sibling, so the
//     period is in the rendered quote verbatim (the Build 2 letter-span-glue precedent).
//   CLAUSE-SCOPED FIGURES — each anchor's figures are the pct tokens between it and the next
//     anchor/comparator, so BRX's one sentence yields 38.7 / 21.7 / 16.4 in the filer's own
//     class order and PLD's occupancy figure in the same sentence never chips as a spread. A
//     pct trailed by a different year's own period phrase ("…16.5% during the year ended
//     December 31, 2024") is the prior year's figure and never chips.
//   INTERNAL DOLLAR-PAIR TIE (the Realty Income class) — when the recapture sentence carries
//     both dollars, the computed ratio must tie the stated rate at the sentence's own
//     precision ($301.99M / $290.61M = 103.92% against the stated 103.9%); the tie is the
//     verification, and a same-scope disagreement withholds the row with its reason stated.
//
// LANE B — portfolio occupancy, dated, in the filer's words: the percent-leased/occupied
// sentence from Items 1/2/7 whose IN-SENTENCE as-of date equals the record's fiscal year end
// (the gate that kills stale mid-year figures, TOC rows and table glue at the root). Figures
// in a comparison clause ("compared to 91.4% and 95.2%… as of December 31, 2024") never
// chip; a dual-year "respectively" sentence pairs figures to years positionally (the Build 7
// parallel-structure law) and chips only the record year's; a multi-scope filer (Rexford's
// consolidated / stabilized / Same Property scopes) renders each scope as its own row with
// its own scope words inside the quote — never a blend. Same-scope rows that agree collapse
// to the prior-year-comparison form (the BDN/KIM doc samples); same-scope rows that DISAGREE
// withhold both, neither quoted as the fact.
const REIT_SPREAD_ANCHOR = /\b(?:(?:rent|leasing|re-?leasing|releasing)\s+spreads?|rent\s+change\s+on\s+(?:new\s+and\s+renewal\s+)?leases|rent\s+recapture\s+rate)\b/gi;
const REIT_CREDIT = /\bSOFR\b|\bbasis\s+points?\b|\bbps\b|\bcredit\s+spread|\bcredit\s+rating|\binterest\s+rate|\bswap\b|\byield\s+spread/i;
const REIT_SUBANNUAL = /\b(?:three|six|nine)\s+months\b|\bquarter(?:ly|s)?\b|\bQ[1-4][\s-]?(?:19|20)\d\d\b/i;
const REIT_TABLE_GLUE = /\bfollowing\s+tables?\b|\(dollars?\s+in\b|\(in\s+(?:thousands|millions)\b|\(square\s+(?:feet|footage)\b|\bweighted\s+average\s+lease\s+term\b/i;
const REIT_HYPO = /\b(?:if\s|may\s|might\s|could\s|would\s|expect|assum|estimate|believe|anticipat|project|forecast|target)/i;
// Anaphoric scope ("in these markets", "at these properties") points at a paragraph the
// quote does not carry — scope words must live inside the sentence, so the reference-shaped
// form is refused (REXR's "…in these markets was 95.3%, 99.2% and 96.4%, respectively" names
// its markets only in the sentences before it). A same-sentence back-reference ("…exclusive
// of such space…" after naming the space) is self-contained and stays.
const REIT_ANAPHORA = /\bthese\s+(?:markets|properties|assets|submarkets|centers)\b/i;
const REIT_PCT = /(?<!\d)(?:approximately\s+)?\(?\d{1,3}(?:\.\d{1,2})?\)?\s?%/g;
const REIT_BULLET_VERB = /^(?:Executed|Achieved|Completed|Signed|Leased|Delivered|Stabilized|Commenced|Renewed)\b/;
const REIT_COMPARATOR = /\bcompared\s+(?:to|with)\b|\bversus\b|\bup\s+from\b|\bdown\s+from\b|\bfrom\s+(?=(?:approximately\s+)?\d{2}(?:\.\d)?\s?%)/i;

// The lane's own splitter (the devSentences/ogSentences precedent — local by design): the
// occupancy forms run short ("As of December 31, 2025, leased occupancy was 92.2%…"), so the
// floor sits at 40; prose-shape is a separate test so the spread gates can report honestly.
// "U.S."/"U.K." join the abbreviation lookbehind: Simon's occupancy sentence ("Ending
// occupancy for our U.S. Malls and Premium Outlets decreased 0.1% to 96.4%…") split at
// "U.S." and lost its anchor token to the fragment — measured, the survey pins SPG 96.4.
function reitSentences(text) {
  if (!text) return [];
  return String(text)
    .replace(/\d+\s+table of contents/gi, " ")
    // A highlights list ends on a footnote rule ("cash basis. ____ (1) For a
    // reconciliation…"); the underscore run is never content and, unstripped, it glues the
    // last bullet to its footnote past the length ceiling (REXR's spread bullet, measured).
    .replace(/_{3,}/g, " ")
    .split(/(?<=[.!?]["”’']?)(?<!\b(?:Inc|Ltd|Corp|Co|No|L\.P|U\.S|U\.K)\.["”’']?)\s+(?=[A-Z(“"$0-9])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 40 && s.length <= 700);
}
function reitProse(s) {
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  return letters >= 35 && digits / (digits + letters) <= 0.28 && !/table of contents/i.test(s);
}

const REIT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// The in-sentence as-of date must equal the record's fiscal year end — exact month, day, year.
function reitFyeInSentence(s, fyeDate) {
  if (!fyeDate) return false;
  const [y, m, d] = fyeDate.split("-").map(Number);
  return new RegExp(`\\b${REIT_MONTHS[m - 1]}\\s+${d},?\\s+${y}\\b`).test(s);
}
function reitNamesFyPeriod(s, fy) {
  return new RegExp(`\\b(?:during|in|for)\\s+(?:fiscal\\s+(?:year\\s+)?)?${fy}\\b|\\byears?\\s+ended\\s+\\w+\\s+\\d{1,2},?\\s+${fy}\\b|\\b(?:at|as\\s+of)\\s+\\w+\\s+\\d{1,2},?\\s+${fy}\\b`, "i").test(s);
}

function reitSpreadRead(zones, fy, fyeDate) {
  const rows = [], withheld = [];
  const seen = new Set();
  for (const zone of zones) {
    const sents = reitSentences(zone);
    for (let i = 0; i < sents.length; i++) {
      const s = sents[i];
      REIT_SPREAD_ANCHOR.lastIndex = 0;
      if (!REIT_SPREAD_ANCHOR.test(s)) continue;
      REIT_SPREAD_ANCHOR.lastIndex = 0;
      if (!reitProse(s)) continue;
      if (REIT_CREDIT.test(s) || REIT_SUBANNUAL.test(s) || REIT_TABLE_GLUE.test(s) || REIT_HYPO.test(s)) continue;
      // The period gate, with the measured highlights-bullet extension (see the lane header).
      let quote = s;
      if (!reitNamesFyPeriod(s, fy) && !reitFyeInSentence(s, fyeDate)) {
        const prev = sents[i - 1];
        if (prev && REIT_BULLET_VERB.test(s) && (reitNamesFyPeriod(prev, fy) || reitFyeInSentence(prev, fyeDate)) && zone.includes(prev + " " + s)) {
          quote = prev + " " + s;
        } else continue;
      }
      // Clause-scoped figures: each anchor's pct tokens, up to the next anchor or comparator.
      const anchors = [...s.matchAll(REIT_SPREAD_ANCHOR)];
      const cm = s.match(REIT_COMPARATOR);
      const cmpAt = cm ? cm.index : s.length;
      const figures = [];
      for (let a = 0; a < anchors.length; a++) {
        const from = anchors[a].index + anchors[a][0].length;
        let to = a + 1 < anchors.length ? anchors[a + 1].index : s.length;
        if (cmpAt > from && cmpAt < to) to = cmpAt;
        for (const pm of s.slice(from, to).matchAll(REIT_PCT)) {
          const tok = pm[0].trim();
          const n = parseFloat(tok.replace(/[^\d.]/g, ""));
          if (!(n >= 0.1 && n <= 400)) continue;
          // A figure whose own trailing period phrase names a different year is the prior
          // year's — it never chips (BRX's "…and 16.5% during the year ended December 31, 2024").
          const tail = s.slice(from + pm.index + pm[0].length, from + pm.index + pm[0].length + 55);
          const ym = tail.match(/\b(?:19|20)\d\d\b/);
          if (ym && Number(ym[0]) !== fy) continue;
          if (!figures.includes(tok)) figures.push(tok);
        }
      }
      if (!figures.length) continue;
      const cleaned = cleanQuote(quote);
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      // The internal dollar-pair tie (Realty Income): stated rate vs the sentence's own pair.
      let tie = null;
      if (/recapture/i.test(s)) {
        const dm = [...s.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(?:million|billion|thousand)?/gi)];
        if (dm.length === 2) {
          const a = parseFloat(dm[0][1].replace(/,/g, "")), b = parseFloat(dm[1][1].replace(/,/g, ""));
          const statedTok = figures[0];
          const stated = parseFloat(statedTok.replace(/[^\d.]/g, ""));
          const dp = (statedTok.match(/\.(\d+)/) || [, ""])[1].length;
          if (b > 0 && Number.isFinite(stated)) {
            const computed = (a / b) * 100;
            if (Math.abs(computed - stated) <= Math.pow(10, -dp)) {
              tie = { computed: computed.toFixed(Math.max(dp + 1, 2)) + "%", a: dm[0][0].trim(), b: dm[1][0].trim() };
            } else {
              withheld.push({ reason: "the stated recapture rate disagrees with the sentence's own dollar pair", stated: statedTok, computed: computed.toFixed(2) + "%", sentence: cleaned });
              continue;
            }
          }
        }
      }
      // The weld law at write time: every figure — and both halves of any tie — is the
      // filer's own characters; the tie value itself is the desk's computed chip, sourced.
      weld(cleaned, [
        ...figures.map((f) => ({ text: f, kind: "verbatim" })),
        ...(tie ? [{ text: tie.a, kind: "verbatim" }, { text: tie.b, kind: "verbatim" }, { text: tie.computed, kind: "computed", source: `${tie.a} ÷ ${tie.b}, the sentence's own dollar pair` }] : []),
      ]);
      rows.push({ sentence: cleaned, figures, ...(tie ? { tie } : {}) });
    }
  }
  // A row whose figure set is contained in an earlier row's is the same disclosure restated
  // in part (BRX's base-rent decomposition repeats the 16.4% headline) — the fuller row stands.
  const kept = [];
  for (const r of rows) {
    if (kept.some((k) => r.figures.every((f) => k.figures.includes(f)))) continue;
    kept.push(r);
  }
  return { rows: kept.slice(0, 2), withheld };
}

const REIT_OCC_A1 = /(?<!\d)\d{2}(?:\.\d)?\s?%\s?(?:leased|occupied)\b/g;
// The doc's second anchor, sentence-scoped. The gap class is [\s\S] rather than the survey
// note's [^.] because the lane is already sentence-scoped and the real SPG sentence crosses
// dots the note's shorthand could not ("…occupancy for our U.S. Malls and Premium Outlets
// decreased 0.1% to 96.4%…" — measured, the survey pins SPG 96.4 as covered).
const REIT_OCC_A2 = /\b(?:occupancy|percent(?:age)?\s+leased)\b[\s\S]{0,60}?(?<!\d)\d{2}(?:\.\d)?\s?%/gi;
const REIT_SCOPE_STOP = new Set(["occupancy", "occupied", "leased", "percent", "respectively", "approximately", "compared", "versus", "was", "were", "and", "the", "our", "its", "for", "with", "while", "from", "that", "this", "year", "years", "ended", "end", "december", "january", "february", "march", "april", "june", "july", "august", "september", "october", "november"]);
const reitScopeTokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !REIT_SCOPE_STOP.has(w)));

function reitOccupancyRead(zones, fy, fyeDate) {
  const rows = [], withheldRows = [];
  const seen = new Set();
  for (const zone of zones) {
    for (const s of reitSentences(zone)) {
      if (!reitProse(s)) continue;
      if (REIT_TABLE_GLUE.test(s) || REIT_HYPO.test(s) || REIT_ANAPHORA.test(s)) continue;
      if (!reitFyeInSentence(s, fyeDate)) continue;
      const cm = s.match(REIT_COMPARATOR);
      const cmpAt = cm ? cm.index : s.length;
      const figures = [];
      const take = (tok, at) => {
        const t = tok.trim();
        if (at >= cmpAt) return; // a comparison-clause figure is the prior period's — never chips
        const n = parseFloat(t.replace(/[^\d.]/g, ""));
        if (n >= 10 && n <= 100 && !figures.some((f) => f.at === at)) figures.push({ text: t, at });
      };
      for (const m of s.matchAll(REIT_OCC_A1)) take(m[0].match(/\d{2}(?:\.\d)?\s?%/)[0], m.index);
      for (const m of s.matchAll(REIT_OCC_A2)) {
        const pm = m[0].match(/\d{2}(?:\.\d)?\s?%$/);
        if (!pm) continue;
        take(pm[0], m.index + m[0].length - pm[0].length);
        // Run-extension: "billed and leased occupancy were 91.6% and 95.1%, respectively" —
        // the contiguous and/or-run belongs to the same anchored statement.
        const after = s.slice(m.index + m[0].length);
        const run = after.match(/^(?:\s?,?\s?(?:and|or)\s+(?:approximately\s+)?\d{2}(?:\.\d)?\s?%)+/);
        if (run) for (const rm of run[0].matchAll(/\d{2}(?:\.\d)?\s?%/g)) take(rm[0], m.index + m[0].length + rm.index);
      }
      if (!figures.length) continue;
      figures.sort((a, b) => a.at - b.at);
      let figs = figures.map((f) => f.text);
      // Dual-year positional pairing (the Build 7 parallel-structure law): "As of December 31,
      // 2025 and 2024, … 96.5% and 96.4%, respectively" chips only the record year's figure;
      // a count mismatch means the pairing is unreadable and the sentence ships nothing.
      const head = s.slice(0, figures[0].at);
      const dual = head.match(/\b((?:19|20)\d\d)\s+and\s+((?:19|20)\d\d)\b/);
      if (dual && cmpAt === s.length) {
        const yrs = [Number(dual[1]), Number(dual[2])];
        if (!yrs.includes(fy)) continue;
        if (figs.length !== yrs.length) continue;
        figs = [figs[yrs.indexOf(fy)]];
      }
      const cleaned = cleanQuote(s);
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      weld(cleaned, figs.map((f) => ({ text: f, kind: "verbatim" })));
      rows.push({ sentence: cleaned, figures: figs, scope: reitScopeTokens(s), compared: cmpAt < s.length || !!dual });
    }
  }
  // Scope-collapse: rows about the SAME scope (token containment — the appositive-heavy KIM
  // form holds the shorter row's every word) either agree, in which case the prior-year-
  // comparison form with the most figures stands (the doc's BDN/KIM samples are both the
  // "compared to" form), or they disagree, in which case BOTH withhold, neither as the fact.
  const kept = [];
  for (const r of rows) {
    const match = kept.find((k) => {
      const [small, big] = r.scope.size <= k.scope.size ? [r.scope, k.scope] : [k.scope, r.scope];
      if (!small.size) return false;
      let inter = 0;
      for (const w of small) if (big.has(w)) inter++;
      return inter / small.size >= 0.75;
    });
    if (!match) { kept.push(r); continue; }
    const sameFigs = match.figures.length === r.figures.length && match.figures.every((f, i) => parseFloat(f) === parseFloat(r.figures[i]));
    const overlap = match.figures.some((f) => r.figures.some((g) => parseFloat(f) === parseFloat(g)));
    if (sameFigs || overlap) {
      // Agreement: prefer more figures, then the comparison-bearing form.
      if (r.figures.length > match.figures.length || (r.figures.length === match.figures.length && r.compared && !match.compared)) {
        kept[kept.indexOf(match)] = r;
      }
    } else {
      withheldRows.push({ reason: "two same-scope occupancy sentences disagree", a: match.sentence, b: r.sentence });
      kept.splice(kept.indexOf(match), 1);
    }
  }
  return { rows: kept.slice(0, 4).map(({ sentence, figures }) => ({ sentence, figures })), withheld: withheldRows };
}

function reitLeasingRead({ businessText = "", item2Text = "", mdnaText = "", fy, fyeDate }) {
  if (!fy || !fyeDate) return null;
  const zones = [businessText, item2Text, mdnaText].filter(Boolean);
  const sp = reitSpreadRead(zones, fy, fyeDate);
  const occ = reitOccupancyRead(zones, fy, fyeDate);
  if (!sp.rows.length && !sp.withheld.length && !occ.rows.length && !occ.withheld.length) return null;
  return {
    fy,
    asOf: fyeDate,
    ...(sp.rows.length ? { spreads: sp.rows } : {}),
    ...(sp.withheld.length ? { spreadsWithheld: sp.withheld.slice(0, 2) } : {}),
    ...(occ.rows.length ? { occupancy: occ.rows } : {}),
    ...(occ.withheld.length ? { occupancyWithheld: occ.withheld.slice(0, 2) } : {}),
  };
}

// ---- Utilities: the disallowance ledger + the securitization keyhole (Build 10 of the
// qualitative survey, 2026-07-31; docs/qualitative-desks-survey.md §Utilities P1 + P3, same
// M5/M6 machinery, both QUOTE-ONLY) ----
//
// Two lanes over one candidate pool (MD&A + heading-scoped Regulatory/Rate Matters note
// windows), both shipping the filer's own sentences with every rendered dollar a verbatim
// substring — the lane never computes, totals, or restates a number.
//
// LANE 1 — the commission's pen: declarative past-tense sentences where a NAMED commission
// disallowed costs, denied recovery, or forced a charge/impairment, with the dollar in the
// filer's own sentence. The gate is the triple: a commission ACTOR (in the sentence or the
// immediately prior sentence) + an IN-SENTENCE DOLLAR + a PAST-TENSE verb of the completed
// action. A REQUEST is never a disallowance (the request/testimony/proposal frames die), a
// commission DENYING a proposed disallowance is the company's win and dies, and the
// hypothetical/forward frames die (the SFAS-90 "will be disallowed… reasonable estimate…
// can be made" boilerplate in every utility's accounting-policies note). An appeal sentence
// — a court/rehearing ACTION, dollar-bearing preferred — ships alongside its disallowance
// (Nicor's "$ 43 million" rehearing petition beside the Illinois Commission's $ 127 million
// order). Verb-class label (the commission ISSUED the act vs merely narrated-as-FILED)
// fails closed to "filed". Jaccard dedupe, gravest dollars first, cap 3.
//
// LANE 2 — costs moved off the meter: storm/wildfire/plant-retirement costs financed
// through securitization bonds, dollar-anchored. Anchor + in-sentence dollar + a measured
// OBJECT token (storm/hurricane/wildfire/system restoration/plant retirement/regulatory
// asset/settlement/restoration costs — the widened securitized-bonds anchor is what reaches
// EIX's TKM financing). A FILED request renders as a request, never an issuance: the
// "issued" label requires the bonds-issued verb pattern and fails closed to "filed" (APCo's
// proposed $ 1.4 billion Virginia securitization stays a request on the page).
//
// Measured on the 14 real utility 10-Ks (AEP ATO AWK CNP DUK EIX ETR HE PNW SO UTL WEC WMB
// XEL, fetched 2026-07-31): disallowances fire on 5 (AEP EIX ETR SO WEC), securitization on
// 5 (AEP CNP DUK EIX ETR); WEC 177.2/178.9 (one contiguous span), SO 127 + rehearing 43,
// EIX 88 (the CPUC-issued span), AEP KPCo 478/500 issued + Virginia 1.4B as a request, ETR
// 2.57B/1.657B all reproduce; the 9 zero-incidence names and 14 cross-sector non-utility
// controls (JPM FLG TRV UNH PLD O SPG MSFT DDOG XOM DVN WMT CAT AAL) score zero on both.
const REG_NOTE_HEADS = /Regulatory\s+(?:Matters|Environment)|Rate\s+(?:Matters|Proceedings)|Regulatory\s+Assets\s+and\s+Liabilities|Storm\s+Cost\s+Recovery|Securitization/i;
// A named commission, never the SEC/FTC/CFTC/European Commission (each present in every
// 10-K and each a false actor for a RATE regulator).
const REG_ACTOR_NOT = /Securities\s+and\s+Exchange\s+Commission|Exchange\s+Commission|Federal\s+Trade\s+Commission|Futures\s+Trading\s+Commission|European\s+Commission|Commission\s+file/gi;
// State commission acronyms as the corpus writes them, the spelled-out form, a titled
// "<Name> Commission", and the GRC token (measured: EIX narrates its decision only as
// "SCE's 2025 GRC final decision" — the acronym is load-bearing, the survey's own finding).
const REG_ACTOR = /\b(?:[A-Z]{2,6}P[SU]C|CPUC|FERC|ICC|LPSC|MPSC|APSC|PSCW|PUCO|PUCT|IURC|NCUC|KPSC|OPUC|WUTC|SCC|ACC|PUC|PSC)\b|Public\s+(?:Utility|Utilities|Service)\s+Commission|\b[A-Z][a-z]+\s+Commission\b|\bthe\s+Commission\b|\bGRC\b/;
const regHasActor = (s) => !!s && REG_ACTOR.test(String(s).replace(REG_ACTOR_NOT, " "));
const REG_DIS_VOCAB = /disallow\w*|denied\s+recovery|denial\s+of\s+recovery|write-?off|impairment/i;
const REG_DOLLAR = /\$\s?[\d,]+(?:\.\d+)?\s*(?:million|billion)/i;
const REG_DIS_PAST = /\b(?:disallowed|denied|excluded|rejected|upheld|ordered|imposed|issued|recorded|wrote\s+off|written\s+off|impaired|resulted\s+in)\b/i;
const REG_HYPO = /\b(?:if|could|would|might|should|may\s+be|may\s+result|unless|to\s+the\s+extent|is\s+probable\s+that|will\s+be|cannot\s+predict|potential\s+for|expects?\s+to|anticipates?\b)\b/i;
const REG_REQUEST = /\b(?:filed\s+(?:a|an|its)\s+(?:request|application|petition)|request(?:ed|ing)?\s+(?:approval|authorization|recovery)|propos(?:ed|es|ing|al)|seek(?:s|ing)?|sought|recommend(?:ed|s|ing)?|testimony)\b/i;
const REG_TABLE = /\b(19|20)\d{2}\s+(19|20)\d{2}\b|\(in\s+(?:thousands|millions)|following\s+tables?\b|tables?\s+(?:below|above)\b/i;
const REG_DENIED_DISALLOWANCE = /denied[^.;]{0,80}disallowance/i;
// Flattened-list debris: a colon feeding a bare dollar is a bullet list the HTML collapsed
// (EIX's "…primarily related to: $88 million impairment…" quotes ONE bullet of two as if it
// were the sentence), and an MD&A variance bullet narrates an earnings delta, not the act.
const REG_COLON_LIST = /:\s*\$/;
const REG_VARIANCE_BULLET = /^An?\s+\$\s?[\d,]+(?:\.\d+)?\s*(?:million|billion)\s+(?:increase|decrease)\b/i;
// The appeal sentence is a court ACTION — a filing or a ruling — not any sentence saying
// "rehearing" (WEC's "As the ICC did not grant a rehearing… we recorded…" is the charge).
const REG_APPEAL = /\b(?:appeal\w*|rehearing|petition\s+for\s+(?:review|rehearing)|notice\s+of\s+appeal|appellate)\b/i;
const REG_APPEAL_VERB = /\b(?:filed|appeal(?:ed|ing)?|upheld|granted|denied|dismissed|affirmed|reversed|remanded|vacated)\b/i;
const REG_SEC_ANCHOR = /securitiz\w+|securitized\s+bonds|recovery\s+bonds/i;
const REG_SEC_OBJECT = /\b(?:storms?|hurricanes?|wildfires?|winter\s+storm|system\s+restoration|plant\s+retirement|regulatory\s+assets?|settlement|restoration\s+costs)\b/i;
const REG_SEC_ISSUED = /\b(?:issued|sold)\b[^.;]{0,160}?\b(?:securitization|securitized|storm\s+recovery|recovery)\s+bonds\b|\b(?:securitization|securitized|storm\s+recovery|recovery)\s+bonds\b[^.;]{0,60}\bwere\s+(?:issued|sold)\b|\bissued\s+securitized\s+bonds\b/i;
const REG_SEC_STAFF = /\bstaff\b[^.;]{0,60}\brecommend/i;
const REG_ANAPHORA = /^(?:This|These|Such|It\b|The\s+(?:net\s+)?(?:bond\s+)?proceeds)\b/;
// An anaphoric open ships only as the contiguous span with its own preceding sentence
// (the Build 2 letter-span / Build 9 dated-sibling precedent) — or not at all.
const REG_GLUE_LEAD = /^(?:This|These|Such|It\b|As\s+a\s+result|In\s+the\s+order|The\s+amount|This\s+amount)/;
// A glued section label before a date-led open: "Kentucky Securitization Case In June 2025,
// KPCo issued…" — the label run tolerates parenthesized asides and comma'd storm names
// (AEP's "(Applies to AEP and APCo)", ETR's "Bonds - Hurricane Laura, …, and Winter Storm
// Uri"); the lookahead demands a date-led or in-connection open, which running prose never
// hands a bare Title-Case run.
const stripRegHeading = (s) =>
  s.replace(/^(?:[A-Z][A-Za-z&\-']+)(?:[\s,]+(?:and|of|the|or|&|-|—|[A-Z][A-Za-z&\-']+|\([^)]{0,44}\)|(?:19|20)\d{2}|[IVX]+)){0,11}\s+(?=(?:In|On|During|As|At|Following|Under)\s(?:[A-Z]|the\s|its\s|a\s|an\s|early|late|mid|connection|addition|response|third|fourth|first|second|(?:19|20)\d{2}))/, "");

// Raw pieces (split + trimmed, unfiltered) so a candidate's PRIOR is the true adjacent
// sentence — the immediately-prior actor rung and the glue both depend on adjacency, and a
// filtered-out short declarative (EIX's 57-letter "the CPUC issued a final decision…") must
// still serve as prior. Local by design, the devSentences precedent.
function regPieces(text) {
  if (!text) return [];
  return String(text)
    .split(/(?<=[.!?]["”’']?)\s+(?=[A-Z(“"$0-9]|i[A-Z])/)
    .map((s) => s.replace(/\s+/g, " ").trim().replace(/^(?:(?:19|20)\d{2}\s+)+(?=[A-Z“"$])/, ""));
}
function regProse(s) {
  if (s.length < 50 || s.length > 520) return false;
  if (!/^[A-Z“"(]/.test(s)) return false; // a lowercase or bare-dollar open is a fragment / list bullet
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  return letters >= 60 && digits / (digits + letters) <= 0.4;
}
const regGlueOk = (prior) => !!prior && prior.length >= 40 && prior.length <= 400 && /^[A-Z“"(]/.test(prior);

const regDollarsIn = (s) => [...s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion)/gi)]
  .map((m) => ({ text: m[0], value: parseFloat(m[1].replace(/,/g, "")) * (/billion/i.test(m[2]) ? 1e9 : 1e6) }));

// Rank ("gravest dollars first") by the dollar the verb acts on — the first dollar within
// reach after a vocab verb ("disallowed $ 127 million of the $ 415 million" ranks 127, not
// the in-sentence maximum) — else the largest dollar in the sentence. Ordering only: the
// rank never renders, every visible figure stays a verbatim substring of its quote.
function regRankDollar(s) {
  const m = s.match(/(?:disallow\w*|denied|write-?off|wrote\s+off|impairment(?:s)?|charge(?:s)?)(?:\s+\S+){0,7}?\s(\$\s?[\d,]+(?:\.\d+)?\s*(?:million|billion))/i);
  if (m) { const d = regDollarsIn(m[1]); if (d.length) return d[0].value; }
  const all = regDollarsIn(s);
  return all.length ? Math.max(...all.map((d) => d.value)) : 0;
}

// One candidate pool for both lanes: the extracted MD&A, then every Regulatory/Rate-Matters
// note window (the M5 noteWindows scoper — the real note hides behind TOC echoes and
// cross-references). Zones keep their internal order for the prior-sentence rung and the
// appeal search; a sentence already seen in an earlier zone is marked dup, never re-gated.
function regZones(mdnaText, fullText) {
  const pools = [];
  const seen = new Set();
  const addZone = (text) => {
    const ss = regPieces(text).map(stripRegHeading);
    const zone = [];
    for (let i = 0; i < ss.length; i++) {
      const prose = regProse(ss[i]);
      const k = ss[i].toLowerCase().slice(0, 160);
      const dup = prose && seen.has(k);
      if (prose && !dup) seen.add(k);
      zone.push({ s: ss[i], prior: ss[i - 1] || "", dup, prose });
    }
    if (zone.length) pools.push(zone);
  };
  addZone(mdnaText);
  for (const win of noteWindows(fullText, REG_NOTE_HEADS)) addZone(win);
  return pools;
}

// Gravest dollars first, THEN the M6 Jaccard dedupe (so the largest-dollar member of a
// near-dup cluster is the one that stands; length breaks rank ties so a glued span beats
// its own member), then a substring pass (a span absorbs the member sentences it contains).
function regCapRows(hits, cap = 3) {
  hits.sort((a, b) => b.rank - a.rank || b.quote.length - a.quote.length);
  const kept = jaccardDedupe(hits.map((h) => h.quote));
  const out = [];
  for (const r of hits) {
    if (!kept.includes(r.quote)) continue;
    if (out.some((o) => o.quote.includes(r.quote) || r.quote.includes(o.quote))) continue;
    out.push(r);
  }
  return out.slice(0, cap);
}

function utilityDisallowances(zones) {
  const hits = [];
  for (const zone of zones) {
    for (let i = 0; i < zone.length; i++) {
      const { s, prior, dup, prose } = zone[i];
      if (dup || !prose) continue;
      if (!REG_DIS_VOCAB.test(s) || !REG_DOLLAR.test(s)) continue;
      if (!(regHasActor(s) || regHasActor(prior))) continue;
      if (!REG_DIS_PAST.test(s)) continue;
      if (REG_HYPO.test(s) || REG_REQUEST.test(s) || REG_TABLE.test(s) || REG_DENIED_DISALLOWANCE.test(s)) continue;
      if (REG_COLON_LIST.test(s) || REG_VARIANCE_BULLET.test(s)) continue;
      let quote = s;
      if (REG_GLUE_LEAD.test(s)) {
        if (!regGlueOk(prior) || REG_TABLE.test(prior) || REG_HYPO.test(prior) || (prior + " " + s).length > 800) continue;
        quote = prior + " " + s;
      }
      let appeal = null;
      for (let j = i + 1; j < zone.length && j <= i + 25; j++) {
        if (!zone[j].prose) continue;
        const a = zone[j].s;
        if (!REG_APPEAL.test(a) || !REG_APPEAL_VERB.test(a) || REG_TABLE.test(a) || REG_HYPO.test(a)) continue;
        if (REG_DOLLAR.test(a)) { appeal = a; break; }
        if (!appeal) appeal = a;
      }
      const issued =
        /\bdisallowed\s+by\s+(?:the\s+)?[A-Z]/.test(quote) ||
        new RegExp(REG_ACTOR.source + "[^.;]{0,60}\\b(?:disallowed|denied|excluded|imposed|ordered|upheld|issued|entered)\\b").test(quote.replace(REG_ACTOR_NOT, " ")) ||
        new RegExp(REG_ACTOR.source + "[^.;]{0,60}\\b(?:issued|entered)\\b[^.;]{0,60}\\b(?:order|decision)s?\\b").test(String(prior).replace(REG_ACTOR_NOT, " "));
      hits.push({ quote, appeal, kind: issued ? "issued" : "filed", rank: regRankDollar(quote) });
    }
  }
  return regCapRows(hits).map(({ quote, appeal, kind }) => {
    const figures = regDollarsIn(quote).map((d) => d.text);
    // The weld law, asserted at write time: every figure is the filer's own characters.
    weld(quote, figures.map((text) => ({ text, kind: "verbatim" })));
    return { quote, figures, kind, ...(appeal ? { appeal } : {}) };
  });
}

function utilitySecuritization(zones) {
  const hits = [];
  for (const zone of zones) {
    for (const { s, dup, prose } of zone) {
      if (dup || !prose) continue;
      if (!REG_SEC_ANCHOR.test(s) || !REG_DOLLAR.test(s) || !REG_SEC_OBJECT.test(s)) continue;
      if (REG_HYPO.test(s) || REG_TABLE.test(s) || REG_ANAPHORA.test(s) || REG_SEC_STAFF.test(s)) continue;
      const all = regDollarsIn(s);
      hits.push({ quote: s, kind: REG_SEC_ISSUED.test(s) ? "issued" : "filed", rank: Math.max(...all.map((d) => d.value)) });
    }
  }
  return regCapRows(hits).map(({ quote, kind }) => {
    const figures = regDollarsIn(quote).map((d) => d.text);
    weld(quote, figures.map((text) => ({ text, kind: "verbatim" })));
    return { quote, figures, kind };
  });
}

function utilityRegRead({ mdnaText = "", fullText = "", fy }) {
  if (!fy) return null;
  const zones = regZones(mdnaText, fullText);
  const disallowances = utilityDisallowances(zones);
  const securitizations = utilitySecuritization(zones);
  if (!disallowances.length && !securitizations.length) return null;
  return {
    fy,
    ...(disallowances.length ? { disallowances } : {}),
    ...(securitizations.length ? { securitizations } : {}),
  };
}

// ---- Managed care: pricing against the trend — the MLR-anchored cost-trend read (Build 11
// of the qualitative survey, 2026-07-31; docs/qualitative-desks-survey.md §Managed care P2,
// the sector's replacement for the withheld pricing facet) ----
//
// The filer's own medical-cost-trend sentence from the MD&A, TIERED against the desk's own
// computed medical loss ratio (lines.claimsIncurred ÷ lines.premiumsEarned via
// medicalLossRatio — the same guarded figure the scorecard shows). No computed MLR for the
// filing's fiscal year = no lane at all: Alignment (extension-tag costs) and Trupanion (a pet
// insurer inside SIC 6324 with neither line tagged) never even scan — the archetype rule plus
// the computed-figure wall, both measured.
//
// The tiers, measured on the 10 real FY2025 10-Ks (fetched 2026-07-31):
//   LEVEL BADGE — a consolidated sentence stating the ratio's level(s) earns the badge only
//     when every stated level matches the desk's computed MLR at the sentence's OWN declared
//     precision (MOH: "The consolidated MCR increased to 91.7% in 2025, compared with 89.1%
//     in 2024, or 260 basis points." — computed 91.722%/89.129% round to the filer's own
//     91.7/89.1; the 260 bps is consistent within one rounding unit of the computed 259.3).
//   DIRECTION-ONLY — a sentence that agrees only in direction ships without the badge: a
//     stated point-change that is CONSISTENT with the computed delta within one unit at its
//     own precision (OSCR: "MLR increased 5.7%…" — the difference of its own rounded levels —
//     beside the desk's 5.6pt), or a figure-free trend sentence, including the
//     pricing-fell-short idiom (UNH: "For 2025, our pricing trends and patient and member
//     health status assumptions were well-short of the medical cost trends incurred…").
//   SEGMENT KILL — a segment-scoped sentence never ships, however well its number ties (a
//     segment's MLR is not the consolidated record's — the coincidence class): in-sentence
//     subject scope (MOH's "The Medicaid MCR increased…", and its Medicare MCR sentence whose
//     89.1% ties the consolidated prior by pure coincidence) and zone scope (CI's "The
//     medical care ratio increased 120 bps…" sits under the "Cigna Healthcare Segment"
//     heading, and its 120 bps loosely ties the desk's consolidated 129 — the tie cannot
//     rescue it, because it is the segment's figure on the segment's adjusted basis).
//   WRONG-NUMBER KILL — any stated level or point-change that CONTRADICTS the computed record
//     beyond one unit at its own precision dies outright (never downgraded to direction-only:
//     a wrong number inside a rendered quote is worse than silence). CI's "Medical costs and
//     other benefit expenses decreased 11%…" — an expense-line variance, not the ratio — dies
//     here (11 points against the desk's 1.3). Dollar-bearing sentences die whole: this lane
//     verifies ratios, and a dollar it cannot check never ships; Evernorth's pharmacy-cost
//     sentences are not the medical book and die on the pharmacy kill.
// One row ships: the badge outranks direction-only; within a tier the earliest MD&A sentence
// (the overview's thesis) wins — measured on UNH, where the well-short admission leads.
const MC_ANCHOR = /\bmedical\s+costs?\b|\bbenefit\s+expenses?\b|\bMCR\b|\bMLR\b|\bHBR\b|\bBER\b|\bmedical\s+cost\s+trends?\b|\bcare\s+activity\b|\bcare\s+patterns?\b|\bmedical\s+care\s+ratio\b|\bmedical\s+loss\s+ratio\b|\bhealth\s+benefits?\s+ratio\b|\bbenefit\s+expense\s+ratio\b|\bbenefits?\s+ratio\b|\bhealthcare\s+costs?\b|\bmedical\s+expenses?\b/i;
// The pricing-fell-short idiom, its own accepted shape (the subject is pricing, the object is
// the cost trend — the one form where the anchor legitimately follows the verb).
const MC_IDIOM = /\b(?:pricing|premium|rate)s?\b[^.;]{0,120}?\b(?:well[- ]short\s+of|short\s+of|lagged(?:\s+behind)?|fell\s+behind)\b[^.;]{0,80}?\bmedical\s+cost\s+trends?\b/i;
// Declarative past / present-perfect TREND verbs — never bare was/were, which let a
// subordinate clause ("…retroactive premium items … that were recognized…", MOH's Medicaid
// subsection) masquerade as the trend statement. The FIRST match splits subject from
// predicate, and the anchor must sit on the subject side (revenue/income-anchored sentences
// and impact attributions — UNH's "$2.5 billion impact … increased medical costs" — die here).
const MC_VERB = /\b(?:increased|decreased|rose|declined|grew|fell|improved|deteriorated|worsened|moderated)\b/i;
const MC_UP = /\b(?:increased?|increases|rose|grew|higher|elevated|deteriorated|worsened|accelerated)\b/i;
const MC_DOWN = /\b(?:decreased?|decreases|declined?|fell|lower|moderated|improved)\b/i;
// Forward-looking frames (never "than we expected" — the backward comparison that carries the
// sector's genuine trend narration); fy+1 is bound in the function.
const MC_FORWARD = /\b(?:we\s+)?(?:expect|anticipate|believe|project|intend)s?\b|\boutlook\b|\bguidance\b|\bgoing\s+forward\b|\bwill\s+(?:likely\s+)?(?:be|continue|result|increase|decrease|remain|vary|impact)\b|\bfuture\s+periods?\b/i;
// Definitional / methodology frames: CLOV's non-GAAP BER apparatus ("We calculate our BER by
// taking…", "…BER adjusts out activity…" dies on tense), MOH's "MCR represents…".
const MC_DEFN = /\brepresents?\b|\bis\s+(?:a\s+|an\s+)?(?:metric|measure|key|defined|calculated|included|impacted|subject)\b|\bdefined\s+as\b|\bwe\s+(?:calculate|use|regularly\s+review|consider|start)\b|\bmanagement\s+uses\b|\bmeans\b/i;
// Flattened-table debris: the DEV_TABLE forms plus a parenthesized negative dollar and an
// adjacent bare-percent pair — OSCR's "$ (443,151) … 87.4 % 81.7 %" table row would otherwise
// BADGE (its levels round exactly to the computed record); the guard is measured-necessary.
const MC_TABLE = /\b(19|20)\d{2}\s+(19|20)\d{2}\b|\(in\s+(?:thousands|millions)|following\s+tables?\b|tables?\s+(?:below|above)\b|\$\s?\(|\d\s?%\s+\d[\d,.]*\s?%|Table\s+of\s+Contents/i;
// The pharmacy book is not the medical book (CI's Evernorth class).
const MC_PHARM = /\bpharmacy\b|\bprescription\s+drugs?\b/i;
// In-sentence segment scope, tested on the SUBJECT side only (M4's words: scope noun or
// segment label BEFORE the verb rejects the sentence — Humana's cause tail may name its
// Medicare PDP ratio without scoping the consolidated subject): a program / segment word
// reaching the ratio noun (MOH's "The Medicaid MCR", "The Medicare MCR"). Program names stay
// case-sensitive.
const MC_RATIO_SRC = "(?:MCR|MLR|HBR|BER|[Mm]edical\\s+(?:care|loss)\\s+ratio|[Hh]ealth\\s+benefits?\\s+ratio|[Bb]enefits?\\s+(?:expense\\s+)?ratio)";
const MC_SEG_INLINE = new RegExp("\\b(?:Medicaid|Medicare(?:\\s+Advantage)?|Marketplace|Commercial|Specialty|International|Employer\\s+Group|D-SNP)\\b[^.;:]{0,30}?" + MC_RATIO_SRC);
const MC_SEG_INLINE2 = new RegExp("\\b(?:segment|division)(?:'s)?\\b[^.;:]{0,40}?" + MC_RATIO_SRC, "i");
// Zone scope, measured on the 10 MD&As: a heading-shaped "<Name…> Segment" run (never the
// quoted "Segment Reporting" cross-reference — the {1,6} title words and the tail guard
// exclude it) versus the consolidated-results markers. CI's 120 bps sits at 26.8k, after
// "Cigna Healthcare Segment" at 23.2k with no consolidated marker before it; UNH's well-short
// sentence at 6.6k precedes UNH's first segment heading at 19.7k.
const MC_SEG_HEAD = /(?<!["“”])\b(?:[A-Z][\w&'.,-]*\s+){1,6}Segments?\b(?!\s+(?:Reporting|reporting|Performance|performance))/g;
const MC_CONS_MARK = /\bconsolidated\s+results\s+of\s+operations\b|\bCONSOLIDATED\s+RESULTS\b|\bConsolidated\s+Operating\s+Results\b|C\s?ONSOLIDATED\s+R\s?ESULTS/g;

// The lane's own splitter, offset-tracking (the zone rule needs each sentence's position) and
// glue-stripping: leading "NN Table of Contents", "Form 10-K | NN", bare years, and the
// ALL-CAPS heading run MOH glues onto its badge sentence ("MEDICAL CARE RATIO The
// consolidated MCR increased…" — the quote must ship as the filer's sentence, not the page
// furniture). Local by design, the devSentences precedent.
function mcSentences(text) {
  if (!text) return [];
  const out = [];
  const push = (raw, at) => {
    let s = raw.replace(/\s+/g, " ").trim();
    s = s.replace(/^\d{1,4}\s+Table\s+of\s+Contents\s+/i, "")
      .replace(/^Form\s+10-K\s*\|\s*\d{1,4}\s+/i, "")
      .replace(/^(?:(?:19|20)\d{2}\s+)+(?=[A-Z“"$])/, "")
      .replace(/^(?:[A-Z][A-Z&'’-]*\s+){2,}(?=[A-Z][a-z])/, "");
    // 600-char ceiling (over devSentences' 520): Humana narrates its ratio in one 560-char
    // sentence whose levels tie the computed record exactly. 45-letter floor (the
    // uninsSentences precedent): MOH's badge sentence runs 58 letters — ratio sentences are
    // digit-heavy and short by construction.
    if (s.length < 50 || s.length > 600) return;
    const digits = (s.match(/\d/g) || []).length;
    const letters = (s.match(/[a-zA-Z]/g) || []).length;
    if (letters < 45 || digits / (digits + letters) > 0.4) return;
    out.push({ s, at });
  };
  const re = /(?<=[.!?]["”’']?)\s+(?=[A-Z(“"$0-9]|i[A-Z])/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) { push(text.slice(last, m.index), last); last = re.lastIndex; }
  push(text.slice(last), last);
  return out;
}

// Stated figures, year-bound. Levels only in the paired "X% in <year>" form (an unpaired
// level is unverifiable against a dated record and dies); point-changes in the verb-led
// "% / percentage point" form and the bps form. Declared precision = the filer's own decimals.
const mcLevelPairs = (s) => [...s.matchAll(/(\d{2,3}(?:\.\d+)?)\s?%\s+in\s+(?:the\s+)?(20\d\d)/g)]
  .map((m) => ({ text: `${m[1]}%`, value: parseFloat(m[1]), year: +m[2], unit: Math.pow(10, -((m[1].split(".")[1] || "").length)) }));
const mcDeltaPct = (s) => [...s.matchAll(/(?:increased|decreased|rose|declined|grew|improved|deteriorated|higher|lower)\s+(?:by\s+)?(?:approximately\s+)?(\d{1,2}(?:\.\d+)?)\s?(?:%|percent\b|percentage\s+points?\b)/gi)]
  .map((m) => ({ text: `${m[1]}%`, pts: parseFloat(m[1]), unit: Math.pow(10, -((m[1].split(".")[1] || "").length)) }));
// A bps delta stated to a trailing zero declares tens-of-bps precision (HUM's "40 basis
// points" is the difference of its own 0.1%-rounded levels — 42.4 computed; MOH's "260" sits
// 0.8 from the computed 259.2); a non-round bps figure declares single-bp precision.
const mcDeltaBps = (s) => [...s.matchAll(/(\d{1,4})\s?(?:bps|basis\s+points)\b/gi)]
  .map((m) => { const n = parseInt(m[1], 10); return { text: m[0], pts: n / 100, unit: n % 10 === 0 ? 0.1 : 0.01 }; });

function mlrCostTrendRead({ mdnaText = "", fy, mlr, mlrPrior }) {
  // The wall: no desk-computed MLR for THIS filing's fiscal year, no lane at all.
  if (mlr == null || !fy || !mdnaText) return null;
  const pct = mlr * 100;
  const priorPct = mlrPrior == null ? null : mlrPrior * 100;
  const deltaPts = priorPct == null ? null : pct - priorPct;
  const fwd = new RegExp(MC_FORWARD.source + `|\\b${fy + 1}\\b`, "i");
  // Zone events once per text: the last segment heading vs the last consolidated marker
  // before a sentence decides its zone; before any marker, the overview is consolidated.
  const segAt = [...mdnaText.matchAll(MC_SEG_HEAD)].map((m) => m.index);
  const consAt = [...mdnaText.matchAll(MC_CONS_MARK)].map((m) => m.index);
  const inSegmentZone = (at) => {
    const lastSeg = segAt.filter((i) => i < at).pop() ?? -1;
    const lastCons = consAt.filter((i) => i < at).pop() ?? -1;
    return lastSeg > lastCons;
  };

  const rows = [];
  for (const { s, at } of mcSentences(mdnaText)) {
    const idiom = MC_IDIOM.test(s);
    if (!idiom && !MC_ANCHOR.test(s)) continue;
    if (MC_TABLE.test(s) || MC_PHARM.test(s)) continue;
    if (HYPO.test(s) || fwd.test(s) || MC_DEFN.test(s)) continue;
    let subj = s;
    if (!idiom) {
      // Subject-side anchor: the cost line or ratio must be what the sentence is ABOUT.
      const v = s.match(MC_VERB);
      if (!v) continue;
      subj = s.slice(0, v.index);
      if (!MC_ANCHOR.test(subj)) continue;
    }
    if (!devYearOk(s, fy)) continue;
    // A dollar this lane cannot verify never ships inside a rendered quote.
    if (/\$\s?[\d,.]+/.test(s)) continue;
    // Segment scope: the in-sentence subject first, then the zone; an in-sentence
    // "consolidated" subject is the filer's own scope word and overrides the zone.
    if (MC_SEG_INLINE.test(subj) || MC_SEG_INLINE2.test(subj)) continue;
    if (!/\bconsolidated\b/i.test(s) && inSegmentZone(at)) continue;
    // Stated figures against the desk's computed record — the verification gate. A stated
    // figure beyond one unit at its own precision is a contradiction and the sentence dies;
    // within a unit but not exact at the declared rounding is the rounding-path divergence
    // class, eligible for direction-only (never the badge).
    const levels = mcLevelPairs(s);
    const deltas = [...mcDeltaPct(s), ...mcDeltaBps(s)];
    let contradiction = false, statedDelta = null;
    let fyLevels = 0, fyExact = 0, prLevels = 0, prExact = 0, levelMatch = null, priorMatch = null;
    for (const lv of levels) {
      const dp = (lv.text.match(/\.(\d+)/) || [, ""])[1].length;
      if (lv.year === fy) {
        if (Math.abs(lv.value - pct) > lv.unit) { contradiction = true; break; }
        fyLevels++;
        if (lv.value.toFixed(dp) === pct.toFixed(dp)) { fyExact++; levelMatch = levelMatch || lv; }
      } else if (lv.year === fy - 1) {
        if (priorPct == null || Math.abs(lv.value - priorPct) > lv.unit) { contradiction = true; break; }
        prLevels++;
        if (lv.value.toFixed(dp) === priorPct.toFixed(dp)) { prExact++; priorMatch = priorMatch || lv; }
      } else { contradiction = true; break; }
    }
    if (!contradiction) for (const d of deltas) {
      if (deltaPts == null || Math.abs(d.pts - Math.abs(deltaPts)) > d.unit) { contradiction = true; break; }
      statedDelta = statedDelta || d;
    }
    if (contradiction) continue;
    // Level badge: EVERY stated level equals the computed record at the sentence's own
    // declared precision — exact at that rounding, not merely within a unit.
    const badge = fyLevels > 0 && fyExact === fyLevels && prExact === prLevels;
    if (badge) { rows.push({ tier: "level", s, at, levelMatch, priorMatch }); continue; }
    // Direction-only: the sentence's own direction (or the idiom, which reads costs as
    // outrunning pricing) must agree with the computed delta's sign.
    if (deltaPts == null || Math.abs(deltaPts) < 0.05) continue;
    const up = MC_UP.test(s), down = MC_DOWN.test(s);
    const dir = idiom ? "up" : up && !down ? "up" : down && !up ? "down" : null;
    if (!dir) continue;
    if ((dir === "up") !== (deltaPts > 0)) continue;
    rows.push({ tier: "direction", s, at, statedDelta, dir });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (a.tier === b.tier ? a.at - b.at : a.tier === "level" ? -1 : 1));
  const w = rows[0];
  const round3 = (v) => (v == null ? null : +v.toFixed(3));
  const computed = { pct: round3(pct), priorPct: round3(priorPct), deltaPts: round3(deltaPts) };
  const chips = [{ text: String(computed.pct), kind: "computed", source: "lines.claimsIncurred ÷ lines.premiumsEarned (medicalLossRatio)" }];
  if (w.tier === "level") {
    const stated = { level: w.levelMatch.text, ...(w.priorMatch ? { prior: w.priorMatch.text } : {}) };
    // The weld law, asserted at write time: every stated figure is the filer's own characters.
    weld(w.s, [{ text: stated.level, kind: "verbatim" }, ...(stated.prior ? [{ text: stated.prior, kind: "verbatim" }] : []), ...chips]);
    return { fy, tier: "level", sentence: w.s, stated, computed };
  }
  const stated = w.statedDelta ? { delta: w.statedDelta.text, deltaPts: w.statedDelta.pts } : {};
  weld(w.s, [...(stated.delta && w.s.includes(stated.delta) ? [{ text: stated.delta, kind: "verbatim" }] : []), ...chips]);
  return { fy, tier: "direction", sentence: w.s, dir: w.dir === "up" ? "rose" : "fell", ...(stated.delta ? { stated } : {}), computed };
}

// ---- Utilities: rate cases on the record — requested vs granted (Build 12 of the qualitative
// survey, 2026-07-31; docs/qualitative-desks-survey.md §Utilities P2, the survey's largest and
// last build, deliberately sequenced after Builds 3 and 10 proved the window scoper and the
// weld on utilities text) ----
//
// For a rate-regulated utility the price is not set in a market; it is granted, case by case,
// by a named commission. This lane ships that record ALWAYS AS A LIST of the filer's own
// sentences — what was asked for and what was granted — with every rendered figure a verbatim
// substring of its quote. QUOTE-ONLY, like Build 10: the lane never computes, totals, sums
// jurisdictions, or restates a number, and it never states a case's STATUS. A status field was
// REFUSED by the survey on measured staleness (FY2025 10-Ks narrate timing already past at
// read time: XEL's "A SDPUC decision is expected in the first half of 2026"), so a row says
// what the filer said and when, and nothing about what happens next.
//
// THE NEW PARSING THIS BUILD CARRIES — glued-heading case labels. A rate-case disclosure opens
// with its own case heading welded onto the first sentence by the HTML flattener: PNW's
// "Regulatory Matters ACC General Retail Rate Cases 2025 Rate Case On June 13, 2025, APS filed
// …", XEL's "Pending and Recently Concluded Regulatory Proceedings 2025 Minnesota Natural Gas
// Rate Case — In October 2025, NSP-Minnesota filed …", EIX's "66 Table of Contents Regulatory
// Proceedings 2025 General Rate Case In September 2025, the CPUC approved …". Build 10's
// stripRegHeading throws such a run away; here it is EVIDENCE. The head is split off the
// quote, its trailing case label is parsed out as the row's name, and it also opens a case
// BLOCK: the two or three sentences that follow belong to the same proceeding and inherit both
// the label and the subject token (measured-necessary — XEL narrates the Wisconsin grant two
// sentences below its heading and never repeats the words "rate case"). The label parse FAILS
// CLOSED: no parsable case label, and the row is named by the commission acronym in its own
// quote; neither, and the row does not ship.
//
// THE GATES (the doc's, verbatim in intent):
//   SUBJECT — /general rate (case|review|application)|base rate (case|proceeding|application)|
//     rate case|rate review|\bGRC\b/ in the piece or its case-block opener. The GRC acronym is
//     load-bearing, and it is the survey's own finding: EIX narrates only as "2025 GRC".
//   DATE — the sentence's own action date (the FIRST year in the quote) must fall in
//     {fy-1, fy, fy+1}. This is what retires a superseded case: XEL's "In July 2023, the MPUC
//     approved a three-year rate increase of approximately $332 million for 2022-2024" carries
//     2024 inside it and would survive a loosest-year test, and it is stale.
//   ACTOR — a named rate commission (Build 10's REG_ACTOR, which excludes the SEC/FTC/CFTC and
//     the European Commission) in the quote or the immediately prior sentence.
//   FIGURES — at least one chip. Every chip is a verbatim substring of the quote, taken by role:
//     the amount the request or the order acts on, the increase percent, the allowed ROE, the
//     rate base. A dollar the lane cannot attribute to a role is never chipped (the sentence
//     still carries it, in the filer's own words).
//   ROE BOUNDS 8.0–13.0 — the desk's measured guard. The utilities desk REFUSED an allowed-ROE
//     column outright because the same concept verifiably carries equity RATIOS (0.537) beside
//     genuine 9–10% returns; here the bound is a CHIP gate, not a row gate: an out-of-band
//     figure is never labelled a return on equity, and the row's dollar — which is true — still
//     stands. AWK's "an equity component of 49.00%" and PNW's "4.39%" effective fair value rate
//     of return both die on it.
//   VERB CLASS — "granted" requires a commission-subject grant verb; it FAILS CLOSED to
//     "requested", so a pending application can never render as a decided outcome.
// Gravest dollars first, Jaccard dedupe (the combined-registrant swap), cap 6 — a list, because
// a utility of any size is several proceedings at once and one row would be a chosen one.
//
// WITHHOLD: a rate-regulated filer with no qualifying case does not go silent if it says why.
// The lane quotes the filer's OWN regime sentence — the sentence describing how its rates get
// set when they are not set case by case. Measured: HE ("The PBR Framework implemented a
// five-year multi-year rate period (MRP), during which there will be no general rate case
// applications."), ATO (formula rate mechanisms refreshing rates annually "without filing a
// formal rate case"), WMB (a FERC pipeline settling its Transco case with no figure disclosed).
const RC_NOTE_HEADS = /Regulatory\s+(?:Matters|Environment|Proceedings)|Rate\s+(?:Matters|Proceedings|Cases?|Review)|Pending\s+and\s+Recently\s+Concluded/i;
const RC_SUBJECT = /general\s+rate\s+(?:case|review|application)|base\s+rate\s+(?:case|proceeding|application)|rate\s+cases?\b|rate\s+review|\bGRC\b/i;
// Page furniture the flattener glues to the head of a piece (the mcSentences precedent).
const RC_FURNITURE = [/^\d{1,4}\s+Table\s+of\s+Contents\s+/i, /^Form\s+10-K\s*\|\s*\d{1,4}\s+/i, /^(?:(?:19|20)\d{2}\s+)+(?=[A-Z“"$])/];
// The body open a glued heading sits in front of. Case-SENSITIVE by design: a mid-sentence
// "…filed the general rate case on March 31, 2023, and on February 14, 2024, the IURC…" opens
// with lowercase "on" and must never be read as a heading boundary.
const RC_BODY_OPEN = /\b(?:In|On|During|Effective|Beginning|Following|Pursuant)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|the\s|its\s|a\s|an\s|early|late|mid|(?:19|20)\d{2})/;
// The case-label tail, and the section nouns that bound a label on its left. "Cases" and
// "Case" are stop words themselves, so a run of stacked headings ("…General Retail Rate Cases
// 2025 Rate Case") yields the innermost case, never the shelf it sits on.
const RC_LABEL_TAIL = /\b(?:General\s+)?Rate\s+(?:Cases?|Reviews?|Proceedings?)\b|\bGRCs?\b/g;
const RC_LABEL_STOP = /^(?:Regulatory|Regulation|Regulations|Proceedings?|Matters?|Overview|Overviews|Pending|Recently|Concluded|Table|Contents|Item|Items|Note|Notes|Combined|Consolidated|Financial|Statements|Summary|Filings?|Activity|Activities|Cases?|Reviews?|Other|Recent|Current|Update|Updates|Discussion|Analysis|Management|Business|Company|Item\d*)$/;
// Word-shaped tokens a label may absorb walking left; the lowercase connectors are traversable
// but may never START a label ("Wisconsin Electric and Natural Gas Rate Case").
const RC_LABEL_WORD = /^(?:(?:19|20)\d{2}|[A-Z][A-Za-z0-9&.'’\-\/]*)$/;
const RC_LABEL_LINK = /^(?:and|of|the|for|in|to|or|&)$/;
// The acronym the label falls closed to. Build 10's REG_ACTOR remains the ACTOR gate (never
// weakened, never widened); this narrower set exists only to name a row, and it must produce a
// literal substring of the quote.
// then, where the filer's house style spells it out instead, the titled commission itself.
// Measured-necessary: Southern writes "the Illinois Commission" throughout where Wisconsin
// Energy writes "the ICC" for the same regulator, and an acronym-only fallback would take
// Nicor's January 2026 general base rate case off the record for a typographic habit.
const RC_ACRONYM = /\b(?:[A-Z]{2,4}P[SU]C|CPUC|FERC|NMPRC|SDPUC|NDPSC|MoPSC|WVPSC|PSCW|PUCO|PUCT|IURC|NCUC|KPSC|OPUC|WUTC|LPSC|MPSC|APSC|MPUC|ICC|SCC|ACC|KCC|RRC|OCC|PUC|PSC)\b/;
const RC_COMMISSION_NAME = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+(?:Commission|Public\s+Service\s+Commission)\b/;
// An accounting-line variance is not a proceeding, however often it names one as its cause:
// UNITIL's "Depreciation and Amortization expense increased $12.6 million in 2025 … reflecting
// higher depreciation rates from recent base rate cases" is the income statement talking.
const RC_VARIANCE = /\b(?:expenses?|revenues?|income|earnings|costs?|margin)\b[^.;]{0,30}?\b(?:increased|decreased)\s+(?:by\s+)?\$/i;
// A commission-subject grant. Fails closed: no match, and the row renders as a request.
// The ILLUSTRATIVE FRAME: a hypothetical reaching for a real case as its example. "For instance"
// after a no-assurance paragraph is a risk factor, not the regulatory record (CenterPoint's Item
// 1A, whose recited case had a DECREASE awarded and shipped it beside the ask).
const RC_ILLUSTRATION = /^(?:For (?:instance|example)|By way of (?:example|illustration)|As an example)\b/i;
const RC_NO_ASSURANCE = /\b(?:can|could) make no assurance\b|\bno assurance (?:can|that)\b|\bmay not (?:result in|be granted)\b/i;
// A sentence narrating BOTH an increase and a decrease cannot be chipped under one set of labels:
// the reader would meet two identically-labelled amounts meaning opposite things. Silence instead.
const RC_BOTH_DIRECTIONS = /\bincreases?\b[\s\S]{0,200}?\bdecreases?\b|\bdecreases?\b[\s\S]{0,200}?\bincreases?\b/i;
// A multi-year award list carries more values than one row can label — Build 7's parallel-structure
// law in this lane's clothes: "$41 million, $113 million, and $25 million ... in 2024, 2025, and
// 2026, respectively" cannot ship as one figure with three fifths dropped unlabelled (Exelon).
const RC_PARALLEL_LIST = /\$[\d,.]+\s*(?:million|billion)[\s\S]{0,180}?\brespectively\b/i;
const RC_GRANT_VERB = /\b(?:approved|authorized|granted|awarded|adopted|issued|ordered|accepted)\b/i;
const RC_GRANT_NOUN = /\b(?:order|decision|approval|settlement)\b[^.;]{0,70}?\b(?:approved|authorized|granted|adopted|issued)\b/i;
// Anaphoric opens that ship only as the contiguous span with their own prior sentence — the
// Build 10 rule, extended by the shape this corpus adds: AWK's granted row opens "The general
// rate case order approved an increase of $105 million…" and carries neither date nor actor.
const RC_GLUE_LEAD = /^(?:The\s+(?:general\s+)?rate\s+(?:case|review)\s+(?:order|decision)|The\s+(?:final\s+)?(?:order|decision|approval|settlement)\b|This|These|Such|It\b|As\s+a\s+result|In\s+the\s+(?:order|decision))/;
// Forward frames and the flattened-table debris guard (ATO discloses its whole rate-case
// record as a thousands-denominated table, which must never be quoted as a sentence).
const RC_FORWARD = /\bis\s+expected\b|\bare\s+expected\b|\bwe\s+expect\b|\banticipat(?:e|es|ed)\b|\bwould\s+(?:result|be|increase|allow)\b|\bif\s+approved\b|\bmay\s+(?:be|result|file)\b|\bcannot\s+predict\b/i;
const RC_TABLE = /\b(19|20)\d{2}\s+(19|20)\d{2}\b|\(in\s+(?:thousands|millions)|\(Millions\s+of\s+Dollars\)|following\s+tables?\b|tables?\s+(?:below|above)\b|\d\s?%\s+\d[\d,.]*\s?%|Table\s+of\s+Contents|\$\s?\d{1,3}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
// A flattened regulatory-mechanism TABLE reads as a sentence and carries real dollars. The tell
// the corpus gives is a run of bare month-year cells: CenterPoint's "…(IURC) CSIA $ 9 April
// 2025 August 2025 July 2025 Requested an increase of $94.9 million to rate base…" packs three,
// while the densest genuine sentence in the sample (AWK's Illinois span) carries two full dates.
const RC_MONTH_YEAR = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2}\b/g;
// Advocacy is not the record: intervenor and commission-STAFF testimony, recommendations and
// challenges argue about a case, they do not make it. Build 10 refused the same class on the
// disallowance lane (AEP's remand testimony "supporting a reduction… of at least $179 million").
const RC_ADVOCACY = /\btestimony\b|\bintervenors?\b[^.;]{0,40}?\b(?:testimony|recommend\w*|challeng\w*|oppos\w*|propos\w*|argu\w*)|\bstaff\b[^.;]{0,40}?\b(?:filed|report|recommend\w*|propos\w*|position)|\brecommend(?:ed|ing|s)?\b|\bchalleng\w+\b|\bcontested\s+by\b|\bwitness(?:es)?\b/i;
// A definitional frame is the glossary, not the year's proceeding (ATO: "A rate case is a
// formal request from Atmos Energy to a regulatory authority to increase rates…"). Deliberately
// WITHOUT a "represents" clause: the corpus's canonical increase-percent idiom is "…$579.5
// million, which represents a 13.99% net increase" (PNW), and a represents-guard would kill the
// doc's own pinned sentence — measured, not assumed.
const RC_DEFN = /\bis\s+a\s+formal\s+request\b|\bare\s+intended\s+to\b|\bis\s+defined\s+as\b|\bmeans\b|\ballows?\s+us\s+to\b|\bprovide\s+a\s+method\b/i;

// The lane's own splitter (local by design — the devSentences / mcSentences / regPieces
// precedent): it keeps the RAW piece so the glued head is still readable, strips the page
// furniture, then splits head from body.
function rcSentences(text) {
  if (!text) return [];
  const out = [];
  // The abbreviation guard is this lane's own: rate-case sentences are dense with effective
  // dates, and XEL writes them "effective Jan. 1, 2025" — the shared splitter cuts after "Jan."
  // because a digit follows, and ships a sentence that ends mid-date. A truncated quote is a
  // misquote, so the abbreviations that actually occur here never end a sentence.
  const raws = String(text)
    .split(/(?<!\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|No|Nos|Inc|Corp|Co|Ltd|Mr|Mrs|Ms|Dr|St|Art|Sec|Fig|approx)\.)(?<=[.!?]["”’']?)\s+(?=[A-Z(“"$0-9]|i[A-Z])/)
    .map((s) => s.replace(/\s+/g, " ").trim());
  for (const r0 of raws) {
    let raw = r0;
    for (const f of RC_FURNITURE) raw = raw.replace(f, "");
    raw = raw.trim();
    let head = "", body = raw;
    const m = raw.match(RC_BODY_OPEN);
    // A head is only ever split off when it is a RATE-CASE heading: the run before the body
    // open must carry the subject token, be free of sentence punctuation, and stay short.
    if (m && m.index > 0 && m.index <= 130) {
      const cand = raw.slice(0, m.index);
      if (RC_SUBJECT.test(cand) && !/[.;:!?]/.test(cand) && cand.trim().split(/\s+/).length <= 14) {
        head = cand.replace(/\s*[—–-]\s*$/, "").trim();
        body = raw.slice(m.index).trim();
      }
    }
    out.push({ raw, head, body });
  }
  return out;
}

// Prose test, this lane's own. Looser than regProse on the digit ratio (a rate-case sentence
// is figures by construction: XEL's Wisconsin grant runs 26% digits) and on the opening
// character (the head may be stripped, leaving a date-led body), tighter on nothing.
function rcProse(s) {
  if (!s || s.length < 55 || s.length > 620) return false;
  if (!/^[A-Z“"(]/.test(s)) return false;
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  return letters >= 55 && digits / (digits + letters) <= 0.42;
}

// The glued-heading case label. Walks LEFT from the last case-label tail in the head, over at
// most five word-shaped tokens, stopping at a section noun or a previous case tail. Returned
// by INDEX, so the label is guaranteed to be the head's own characters.
function rcLabelFrom(head) {
  if (!head) return null;
  const tails = [...head.matchAll(RC_LABEL_TAIL)];
  if (!tails.length) return null;
  const t = tails[tails.length - 1];
  const before = head.slice(0, t.index);
  const toks = [...before.matchAll(/\S+/g)];
  let start = -1, taken = 0;
  // Six leading tokens: measured on the longest real case name in the sample, Duke's "Duke
  // Energy Kentucky 2024 Electric Base Rate Case" — a five-token walk beheads it to "Energy
  // Kentucky…", and a beheaded name is the hero-lede defect this survey already fixed once.
  for (let i = toks.length - 1; i >= 0 && taken < 6; i--) {
    const w = toks[i][0];
    if (RC_LABEL_LINK.test(w)) { if (start < 0) break; taken++; continue; }
    if (!RC_LABEL_WORD.test(w) || RC_LABEL_STOP.test(w)) break;
    start = toks[i].index;
    taken++;
  }
  if (start < 0) return null; // no qualifier: fail closed to the commission acronym
  const label = head.slice(start, t.index + t[0].length).replace(/\s+/g, " ").trim();
  return label.length >= 6 && label.length <= 80 ? label : null;
}

// Figures by ROLE, each a literal substring of the quote. The lookbehind window never crosses a
// sentence boundary or another dollar sign, so an excluded surcharge ("…increase of $105
// million in annualized … revenues, excluding previously recovered infrastructure surcharges of
// $5 million") and a parenthesised tranche ("$126 million … ($68 million in 2026…)") are read
// for what they are and left unchipped.
function rcFigures(s) {
  const figs = [];
  const seen = new Set();
  const push = (text, role) => { const k = role + "|" + text; if (!seen.has(k) && s.includes(text)) { seen.add(k); figs.push({ text, role }); } };
  for (const m of s.matchAll(/\$\s?[\d,]+(?:\.\d+)?\s*(?:million|billion)/gi)) {
    const back = s.slice(Math.max(0, m.index - 110), m.index);
    // Forward window too: the corpus writes the noun on either side of the figure — "an
    // increase of $105 million" (AWK) and "a net $251 million annual increase" (AEP). Neither
    // window may cross a sentence break or another dollar sign, which is what leaves an
    // excluded surcharge and a parenthesised tranche unchipped.
    const fwd = s.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (/rate\s+base[^.;$]{0,25}$/i.test(back)) push(m[0], "rateBase");
    else if (/revenue\s+requirement[^.;$]{0,25}$/i.test(back)) push(m[0], "requirement");
    else if (/\b(?:increase|decrease|deficiency)[^.;$]{0,60}$/i.test(back)) push(m[0], "amount");
    // The forward form must reach an increase that is ABOUT rates: "a $251 million annual
    // increase in base rates" chips, "a $29 million increase in a regulatory liability" (Duke's
    // post-retirement entry, sitting inside a rate-case block) does not.
    else if (/^[^.;$]{0,40}?\b(?:annual|annualized|net|base\s+rate|rate|revenue)\b[^.;$]{0,30}?\b(?:increase|decrease)\b/i.test(fwd)) push(m[0], "amount");
    else if (/\b(?:seeking|seeks|sought|requesting|requested|approved|authorized|granted|approving|authorizing)[^.;$]{0,80}$/i.test(back)) push(m[0], "amount");
  }
  // The increase percent: the filer's own parenthesised share beside the amount it just stated,
  // or the "which represents a 13.99 % net increase" clause. Never a bare percent — and always
  // the filer's own characters, spacing included, because the flattener writes both "13.99%"
  // (PNW's MD&A) and "13.99 %" (the same sentence in PNW's notes).
  const amt = figs.find((f) => f.role === "amount");
  if (amt) {
    const at = s.indexOf(amt.text) + amt.text.length;
    const par = s.slice(at, at + 8).match(/^\s*\(\s*(\d{1,3}(?:\.\d+)?\s?%)/);
    if (par) push(par[1], "pct");
  }
  const rep = s.match(/represents?\s+(?:a|an)\s+(\d{1,3}(?:\.\d+)?\s?%)/i);
  if (rep && /\b(?:increase|decrease)\b/i.test(s.slice(s.indexOf(rep[0]), s.indexOf(rep[0]) + rep[0].length + 40))) push(rep[1], "pct");
  // The allowed ROE, bounded 8.0–13.0 — the desk's measured guard against an equity RATIO or a
  // fair-value rate of return wearing the ROE label. Both orders the corpus writes it in.
  for (const re of [/(?:\bROE\b|returns?\s+on\s+(?:common\s+)?equity)\s*(?:of|at|:)?\s*(?:approximately\s+)?(\d{1,2}(?:\.\d+)?\s?%)/gi,
    /(\d{1,2}(?:\.\d+)?\s?%)\s+(?:\bROE\b|return\s+on\s+(?:common\s+)?equity)/gi]) {
    for (const m of s.matchAll(re)) {
      const v = parseFloat(m[1]);
      if (v >= 8.0 && v <= 13.0) push(m[1], "roe");
    }
  }
  return figs.slice(0, 4);
}

// The action date: the FIRST year in the quote. A sentence that opens on its own act's date is
// this corpus's universal shape, and reading the first year is what retires a superseded case.
function rcYearOk(s, fy) {
  const m = String(s).match(/\b(19|20)\d{2}\b/);
  if (!m) return false;
  const y = parseInt(m[0], 10);
  return y >= fy - 1 && y <= fy + 1;
}

// One candidate pool: the MD&A first (so a filer that narrates a case in both places ships the
// MD&A's own wording), then every Regulatory/Rate Matters/Pending Proceedings window. Case
// blocks are computed per zone: a piece whose head parses a label opens one, and the three
// pieces that follow inherit its label and its subject token.
function rcZones(mdnaText, fullText) {
  const pools = [];
  const seen = new Set();
  const addZone = (text) => {
    const ss = rcSentences(text);
    if (!ss.length) return;
    const zone = [];
    let block = null, blockAt = -1;
    for (let i = 0; i < ss.length; i++) {
      const { raw, head, body } = ss[i];
      const lab = rcLabelFrom(head);
      if (lab) { block = { label: lab, head }; blockAt = i; }
      // An inherited label must travel with the heading it came from, so the render-time
      // re-check can still find it: a piece that carries a heading of its own but no parsable
      // case name would otherwise be handed the block's label beside its own heading.
      const inherited = !lab && !!block && i - blockAt <= 3;
      const k = body.toLowerCase().slice(0, 160);
      const prose = rcProse(body);
      const dup = prose && seen.has(k);
      if (prose && !dup) seen.add(k);
      zone.push({
        raw, head, body, prose, dup,
        prior: i > 0 ? ss[i - 1].body : "",
        label: lab || (inherited ? block.label : null),
        heading: lab ? head : inherited ? block.head : "",
        // The subject rung: the token in the sentence's OWN words, or membership in a case
        // block whose heading parsed a real case name. A heading that carries the token but no
        // parsable label confers nothing — measured-necessary: EIX's "GRC Wildfire Mitigation
        // Memorandum Account Balances In June 2025, the CPUC issued a final decision that
        // authorized recovery of $291 million…" is a memorandum-account recovery, not the rate
        // case, and it would otherwise render as one. The parse fails closed here too.
        subject: RC_SUBJECT.test(body) || !!lab || inherited,
      });
    }
    pools.push(zone);
  };
  addZone(mdnaText);
  for (const win of noteWindows(fullText, RC_NOTE_HEADS)) addZone(win);
  return pools;
}

function utilityRateCases(zones, fy) {
  const hits = [];
  let seq = 0;
  for (const zone of zones) {
    for (let i = 0; i < zone.length; i++) {
      const z = zone[i];
      seq++;
      if (z.dup || !z.prose) continue;
      if (!z.subject) continue;
      if (RC_TABLE.test(z.body) || RC_DEFN.test(z.body) || HYPO.test(z.body) || RC_FORWARD.test(z.body)) continue;
      if (RC_ADVOCACY.test(z.body) || RC_VARIANCE.test(z.body)) continue;
      if ((z.body.match(RC_MONTH_YEAR) || []).length >= 3) continue;
      // The anaphoric open ships only as the contiguous span with its own prior sentence.
      let quote = z.body;
      if (RC_GLUE_LEAD.test(z.body)) {
        const p = z.prior;
        if (!regGlueOk(p) || RC_TABLE.test(p) || HYPO.test(p) || (p + " " + z.body).length > 800) continue;
        quote = p + " " + z.body;
      }
      // The guards run again on the SPAN, so a glued prior can never smuggle in the debris the
      // body was cleared of.
      if (RC_TABLE.test(quote) || RC_ADVOCACY.test(quote) || RC_VARIANCE.test(quote)) continue;
      // THE ILLUSTRATION. A risk factor arguing that proceedings MAY go badly, and then reaching
      // for a past case to show what that looks like, is not the regulatory record — it is the
      // filer's own hypothetical wearing a real docket's clothes. CenterPoint's only row came
      // from exactly there: an Item 1A paragraph opening "The Registrants can make no assurance
      // that ... base rate proceedings will result in requested or favorable adjustments", whose
      // next sentence opens "For instance," and recites a case whose award was a DECREASE. The
      // window scoper cannot see the difference (measured: Build 10's heads, Build 12's, and the
      // doc-strict set all admit it, the last through CenterPoint's own cross-reference), so the
      // refusal is made on the frame, where the difference actually lives.
      if (RC_ILLUSTRATION.test(quote) || RC_NO_ASSURANCE.test(z.prior || "")) continue;
      if (RC_BOTH_DIRECTIONS.test(quote) || RC_PARALLEL_LIST.test(quote)) continue;
      if (!rcYearOk(quote, fy)) continue;
      // Build 10's actor rung, required of any row the filer has NOT already named: a sentence
      // with no case heading over it must name its own commission (in itself or its immediate
      // prior) or it is not on the regulatory record. A heading-labelled row is exempt because
      // the filer has already told us which proceeding it is — measured: XEL's "In October
      // 2025, NSP-Minnesota filed a natural gas rate case in Minnesota, seeking a total revenue
      // increase of $63 million (8.2%)" names the MPUC only two sentences later.
      if (!z.label && !(regHasActor(quote) || regHasActor(z.prior))) continue;
      const figures = rcFigures(quote);
      if (!figures.length) continue;
      // The label: the glued heading's case name, else the commission as this quote's own
      // characters — the acronym first, its spelled-out title second. Neither, and the row does
      // not ship: the parse fails closed, never to a guess.
      const acr = (quote.match(RC_ACRONYM) || [])[0] || (quote.match(RC_COMMISSION_NAME) || [])[0] || null;
      const label = z.label || acr;
      if (!label) continue;
      const heading = z.label ? z.heading : "";
      if (!(quote.includes(label) || (heading && heading.includes(label)))) continue;
      // The verb class, FAILING CLOSED to "requested": the commission must be the subject of a
      // grant verb within reach. REG_ACTOR is parenthesised before concatenation — its source
      // carries top-level alternations, so an unwrapped splice would bind the verb clause to the
      // last alternative alone and every row would read "granted".
      const actorFirst = new RegExp("(?:" + REG_ACTOR.source + "|" + RC_ACRONYM.source + "|" + RC_COMMISSION_NAME.source + ")[^.;]{0,90}?" + RC_GRANT_VERB.source, "i");
      const kind = actorFirst.test(quote.replace(REG_ACTOR_NOT, " ")) || RC_GRANT_NOUN.test(quote) ? "granted" : "requested";
      // FAILING CLOSED MUST NOT MEAN ASSERTING THE OTHER THING. The doc's rule — an unresolved
      // verb class falls to "requested" — is right for a sentence carrying no grant signal at all,
      // where a filer narrating its own case has plainly requested something. It is NOT right for a
      // sentence that says "approved" in the filer's own words and merely fails the actor-first
      // test because the commission is named after the verb: the page renders the class as
      // "requested by the filer", so shipping that is a false statement about the regulatory
      // record, not a conservative one. Exelon surfaced it — "PECO's approved annual electric
      // revenue requirement increase of 54 million" would have rendered as a request. Where the
      // filer says granted and the gate cannot prove who granted it, the row says nothing.
      if (kind === "requested" && RC_GRANT_VERB.test(quote)) continue;
      const rank = Math.max(0, ...figures.filter((f) => f.role === "amount" || f.role === "requirement").map((f) => rcDollarValue(f.text)));
      hits.push({ label, kind, quote, figures, ...(heading ? { heading } : {}), rank, seq });
    }
  }
  // Gravest dollars first, then the combined-registrant Jaccard pass and substring absorption.
  return rcCapRows(hits, 6).map(({ label, kind, quote, figures, heading }) => {
    // The weld law, asserted at write time: every rendered figure, and the row's own name, are
    // the filer's own characters.
    weld(quote, figures.map((f) => ({ text: f.text, kind: "verbatim" })));
    weld(quote.includes(label) ? quote : heading, [{ text: label, kind: "verbatim" }]);
    return { label, kind, quote, figures, ...(heading ? { heading } : {}) };
  });
}

const rcDollarValue = (t) => {
  const m = String(t).match(/([\d,]+(?:\.\d+)?)\s*(million|billion)/i);
  return m ? parseFloat(m[1].replace(/,/g, "")) * (/billion/i.test(m[2]) ? 1e9 : 1e6) : 0;
};

// Gravest dollars first, then the Jaccard pass and substring absorption — Build 10's regCapRows
// with ONE difference this lane needs: the rank tie-break is the sentence's own POSITION, not
// its length. A utility narrates the same case twice, once in the MD&A and once in the notes,
// and the note copy is the longer of the two only because it repeats the docket alias ("…with
// the ACC (the "2025 Rate Case") seeking…"). Position keeps the MD&A's plainer wording, which
// is the sentence the survey pinned. regCapRows itself is untouched; Build 10 keeps its rule.
function rcCapRows(hits, cap = 6) {
  hits.sort((a, b) => b.rank - a.rank || a.seq - b.seq);
  const kept = jaccardDedupe(hits.map((h) => h.quote));
  const out = [];
  for (const r of hits) {
    if (!kept.includes(r.quote)) continue;
    if (out.some((o) => o.quote.includes(r.quote) || r.quote.includes(o.quote))) continue;
    out.push(r);
  }
  return out.slice(0, cap);
}

// The regime sentence: how this filer's rates get set when they are not set case by case. Only
// ever reached when the case list is empty — an explanation of silence, never a substitute for
// a case. The vocabulary is measured on the three withholding filers, not decorative.
// Only the forms that explain an ABSENT case qualify. A sentence that merely mentions a formula
// rate plan is not an explanation of silence — measured: ETR's "The electric formula rate plan
// decrease implemented was $19.2 million." and UTL's list of what a filing contains would both
// pass a looser vocabulary, and neither says why no case is on the record. A regime quote may
// carry no dollar at all: this lane verified none, so it renders none.
const RC_REGIME = /\bno\s+general\s+rate\s+case\b|\bwithout\s+filing\s+(?:a\s+)?(?:formal\s+)?rate\s+case\b|\bin\s+lieu\s+of\s+(?:a\s+)?(?:general\s+)?rate\s+case\b|\beliminate\s+the\s+need\s+for\s+a\s+general\s+rate\s+case\b|\bsettle\s+all\s+aspects\s+of\s+the\s+rate\s+case\b/i;
// A Title-Case section heading glued to a regime sentence, stripped only where the run is
// followed by a subordinating connective and a lowercase word — Atmos's "Annual Formula Rate
// Mechanisms As an instrument to reduce regulatory lag, …". The connective test is what keeps
// the strip off a real sentence: Hawaiian Electric's "The PBR Framework implemented a five-year
// multi-year rate period…" opens with three capitalised words and must not lose them.
const RC_REGIME_HEAD = /^(?:[A-Z][A-Za-z&'’\-]*\s+){2,6}(?=(?:As|In|On|Under|During|Because|While|Although|Through)\s+[a-z])/;

function utilityRateRegime(zones) {
  const hits = [];
  for (const zone of zones) {
    for (const z of zone) {
      if (z.dup || !z.prose) continue;
      if (!RC_REGIME.test(z.body)) continue;
      if (/\$/.test(z.body)) continue;
      if (RC_TABLE.test(z.body) || HYPO.test(z.body) || RC_FORWARD.test(z.body) || RC_ADVOCACY.test(z.body)) continue;
      if (RC_GLUE_LEAD.test(z.body)) continue; // an anaphoric fragment explains nothing on its own
      hits.push({ quote: z.body.replace(RC_REGIME_HEAD, "").trim() });
    }
  }
  if (!hits.length) return null;
  // The shortest qualifying statement: the regime sentence is a definition of the regime, and
  // the longest match in this corpus is always a clause of procedural detail wrapped around it.
  hits.sort((a, b) => a.quote.length - b.quote.length);
  return { quote: hits[0].quote };
}

function rateCaseRead({ mdnaText = "", fullText = "", fy }) {
  if (!fy) return null;
  const zones = rcZones(mdnaText, fullText);
  const cases = utilityRateCases(zones, fy);
  if (cases.length) return { fy, cases };
  const regime = utilityRateRegime(zones);
  return regime ? { fy, cases: [], withheld: regime } : null;
}

async function main() {
  // Carry-over: start from the existing file, so a partial run (a ticker limit, or a pool that comes
  // up empty) never wipes good entries — fresh results overlay, and names no longer in either
  // universe are dropped at the end.
  let out = {};
  try { out = JSON.parse(fs.readFileSync(path.join(dataDir, "language.json"), "utf8")).companies || {}; } catch { out = {}; }

  // One roster across both pools: US 10-K filers and ADR 20-F/40-F filers, each tagged so the proxy
  // (DEF 14A) pull is skipped for foreign private issuers, which do not file one. POL limits which
  // pool is fetched this run (us | adr | both) — so an ADR-only pass need not re-fetch the US names,
  // whose entries carry over.
  const POOL = (process.env.POOL || "both").toLowerCase();
  const roster = [
    ...(POOL !== "adr" ? (fundamentals.companies || []).map((c) => ({ c, isAdr: false })) : []),
    ...(POOL !== "us" ? (adrFundamentals.companies || []).map((c) => ({ c, isAdr: true })) : []),
  ];
  // inUniverse is always BOTH pools, so a single-pool run's carry-over cleanup never drops the other.
  const inUniverse = new Set(
    [...(fundamentals.companies || []), ...(adrFundamentals.companies || [])].map((c) => String(c.ticker).toUpperCase())
  );
  // Optional ticker limit (the rest carry over), so a run can validate a handful of names quickly.
  const only = (process.env.ONLY_TICKERS || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const onlySet = only.length ? new Set(only) : null;

  let ok = 0;
  for (const { c, isAdr } of roster) {
    const tk = c.ticker;
    if (!c.cik) continue;
    if (onlySet && !onlySet.has(String(tk).toUpperCase())) continue;
    await sleep(THROTTLE);
    let filings;
    try {
      filings = await latestAnnual(c.cik, 2);
    } catch (e) { console.warn(`  ! ${tk}: submissions ${e.message}`); continue; }
    if (!filings.length) { console.warn(`  ! ${tk}: no annual report found`); continue; }

    // Balance-sheet long-term debt ($ millions), the reconciliation anchor for the maturity ladder.
    // Prefer the trailing-twelve-months figure, then the latest annual — the SAME source the believability
    // gate checks the extracted wall against, so the extractor's anchor can't diverge from the gate's and
    // let through a wall the gate then rejects (which is how Axis Capital's mis-parse blocked a refresh).
    const anchorDebt = c.ttm?.lines?.totalDebt ?? c.lines?.totalDebt;
    const totalDebtMillions = anchorDebt != null ? anchorDebt / 1e6 : null;
    // The reserve-development weld target (Build 4): the filed prior-year development number
    // for the CURRENT filing's fiscal year, from the same history the record table reads.
    // Archetype-scoped (insurer / managed care), never SIC alone; no filed number, no lane —
    // Trupanion (SIC 6324, no tagged development line) never even scans.
    let devTarget = null;
    const devKind = financialKind(c);
    if (devKind === "insurer" || devKind === "managedCare") {
      const fyYear = filings[0].reportDate ? parseInt(filings[0].reportDate.slice(0, 4)) : null;
      const devStored = (c.history || []).find((h) => h.fy === fyYear)?.lines?.reserveDevelopmentPriorYear
        ?? (String(c.fy) === String(fyYear) ? c.lines?.reserveDevelopmentPriorYear : null);
      if (fyYear && devStored != null && devStored !== 0) devTarget = { stored: devStored, kind: devKind };
    }
    // The uninsured-deposits weld denominator (Build 6): stored XBRL Deposits for the CURRENT
    // filing's fiscal year, banks only (the archetype, never SIC alone — the Build 4 precedent).
    // No fiscal-year-matched deposits line, no lane: a stale denominator would fail the check
    // for the wrong reason, so the lane waits for the fundamentals heal instead.
    let depTarget = null;
    if (devKind === "bank") {
      const fyYear = filings[0].reportDate ? parseInt(filings[0].reportDate.slice(0, 4)) : null;
      const depStored = (c.history || []).find((h) => h.fy === fyYear)?.lines?.deposits
        ?? (String(c.fy) === String(fyYear) ? c.lines?.deposits : null);
      if (fyYear && depStored > 0) depTarget = { deposits: depStored };
    }
    // The software desk's lanes (Build 7): the desk's own SIC scope (7370-7374, the shelf
    // definition), US 10-K filers only. The prior filing is read through the same gates so
    // the current record has a corroboration and tripwire counterparty.
    const sicSw = Number(c.sic) || 0;
    const swTarget = !isAdr && sicSw >= 7370 && sicSw <= 7374;
    // The O&G desk's scope (Build 8): producers (1311), integrateds (2911) and the oil
    // royalty SIC (6792 — Texas Pacific, per the M7 re-route), US 10-K filers only. A pure
    // refiner inside 2911 carries no reserves disclosure and the dictionary-miss rule keeps
    // it silent.
    const ogTarget = !isAdr && (sicSw === 1311 || sicSw === 2911 || sicSw === 6792);
    // The REIT desk's scope (Build 9): the ARCHETYPE gate, never SIC alone (the Build 4
    // precedent) — equity REITs as the pipeline classifies them, US 10-K filers only.
    const reitTarget = !isAdr && devKind === "reit";
    // The utilities desk's scope (Build 10): the rateRegulated flag — the desk's own tag
    // census on the record (utilitiesLines' ≥5-concept gate), never SIC alone. 73 filers.
    const utilTarget = !isAdr && !!c.rateRegulated;
    // The managed-care MLR target (Build 11): the desk's OWN computed medical loss ratio for
    // the CURRENT filing's fiscal year (and the prior year, for the direction tier), from the
    // same history the scorecard reads. Archetype-scoped, never SIC alone (the Build 4
    // precedent), and the computed figure is the wall: no computed MLR, no lane — Alignment
    // (extension-tag costs) and Trupanion (neither line tagged) never scan.
    let mcTarget = null;
    if (!isAdr && devKind === "managedCare") {
      const fyYear = filings[0].reportDate ? parseInt(filings[0].reportDate.slice(0, 4)) : null;
      const linesFor = (y) => (c.history || []).find((h) => h.fy === y)?.lines
        ?? (String(c.fy) === String(y) ? c.lines : null);
      const mlr = fyYear ? medicalLossRatio(linesFor(fyYear)) : null;
      if (fyYear && mlr != null) mcTarget = { mlr, mlrPrior: medicalLossRatio(linesFor(fyYear - 1)) };
    }
    let cur, prior;
    try {
      await sleep(THROTTLE);
      cur = await getFiling(c.cik, filings[0], totalDebtMillions, devTarget, depTarget, swTarget, ogTarget, reitTarget, utilTarget, mcTarget);
      if (filings[1]) { await sleep(THROTTLE); prior = await getFiling(c.cik, filings[1], null, null, null, swTarget); }
    } catch (e) { console.warn(`  ! ${tk}: filing ${e.message}`); continue; }

    // Quality gate: a clean qualitative extraction (Business + MD&A + Risk) runs
    // to several thousand words. Skip companies we couldn't parse rather than emit
    // garbage. The owner-flags can carry even if one section came up short.
    const qualWords = cur.business.words + cur.mdna.words + cur.risk.words;
    if (qualWords < 1500) {
      console.warn(`  ! ${tk}: qualitative sections not cleanly extracted (${qualWords}w${isAdr ? `, ${filings[0].form}` : ""}), skipping`);
      continue;
    }

    // The timeless read: what an owner would flag, from the latest filing only.
    const pool = [];
    for (const [sec, m] of [["Business", cur.business], ["MD&A", cur.mdna], ["Risk Factors", cur.risk]])
      for (const s of m.sents || []) pool.push({ s, section: sec });
    // The concentration lens is retired where it misreads by construction (audit-fix item 9):
    // a bank's "customers" are depositors (27/42 measured deposit-side), a REIT's are tenants
    // the lens reads blind in both directions, a utility's are ratepayers (38/60 off-lens).
    // Absence over mislabels until the sector-correct replacements ship.
    const sicN = Number(c.sic) || 0;
    const ccRetired = (sicN >= 6020 && sicN <= 6199) || sicN === 6798 || (sicN >= 4900 && sicN <= 4991);
    const flags = ownerFlags(pool, ccRetired ? new Set(["Customer concentration"]) : null);

    // Executive pay from the latest proxy (non-fatal, a bonus layer). US only: foreign private
    // issuers file no DEF 14A, so the proxy pull is skipped for the ADR pool.
    let comp = null;
    if (!isAdr) {
      try {
        const proxy = await latestProxy(c.cik);
        if (proxy) { await sleep(THROTTLE); comp = await getComp(c.cik, proxy); }
      } catch (e) { console.warn(`  ! ${tk}: proxy ${e.message}`); }
    }

    // The lede candidates (MD&A Overview first, then Item 1 Business), scored once and reused for
    // both the hero sentence and the "in brief" detail lines beneath it. The whole record assembly
    // is wrapped so a single odd filing that trips one of the text detectors logs and is skipped
    // rather than aborting a long run mid-way and losing every company parsed before it.
    try {
      // Item 1 (Business) is the SEC-required description of the business, so it leads the candidate
      // pool and earns the earliness bonus; the MD&A Overview follows only as a fallback for names
      // whose Item 1 is thin or incorporated by reference. (Prepending MD&A, as before, let its
      // heading and boilerplate — "Management's Discussion and Analysis…" — drown the real Item 1
      // opener for J&J, Disney, UPS, FedEx, AT&T, Marathon and dozens like them.)
      const bizLead = cur.business.lead?.length ? cur.business.lead : (cur.business.sents || []);
      const bizSents = [...bizLead, ...(cur.mdna?.lead || [])];
      const bizLede = businessDescription(bizSents, c.name, c.ticker);
      // The debt-maturity ladder, normalised from $ millions to whole dollars so the page formats it
      // with the same fmtMoney as every other line item, dated and sourced to this filing.
      const dm = cur.debtMaturity;
      const debtMaturity = dm ? {
        ...dm,
        schedule: dm.schedule.map((s) => ({ year: s.year, amount: Math.round(s.amount * 1e6) })),
        thereafter: dm.thereafter != null ? Math.round(dm.thereafter * 1e6) : null,
        total: Math.round(dm.total * 1e6),
        declaredTotal: dm.declaredTotal != null ? Math.round(dm.declaredTotal * 1e6) : null,
        dueNextYear: dm.dueNextYear != null ? Math.round(dm.dueNextYear * 1e6) : null,
        within2yr: Math.round(dm.within2yr * 1e6),
        peakAmount: dm.peakAmount != null ? Math.round(dm.peakAmount * 1e6) : null,
        asOf: cur.reportDate || null,
        sourceUrl: cur.url,
      } : null;
      out[tk] = {
        fy: cur.reportDate?.slice(0, 4) || null,
        priorFy: prior?.reportDate?.slice(0, 4) || null,
        sourceUrl: cur.url,
        // Item 1 Business leads, MD&A Overview follows as a fallback: businessDescription scores every
        // candidate and picks the strongest, falling back to the computed industry phrase when none is
        // a real description, so keeping the Overview as a backup only helps a thin Item 1.
        business: bizLede,
        brief: businessBrief(bizSents, bizLede, c.name),
        // Extraction diagnostics for the qualitative audit: the word count of each parsed section, so
        // a missing lede can be read as an EXTRACTION failure (Item 1 came up empty) versus a SCORER
        // failure (Item 1 is full but no sentence was accepted) — the distinction that drives the fix.
        extract: {
          business: cur.business.words, mdna: cur.mdna.words, risk: cur.risk.words, ledeFromFiling: !!bizLede,
          // When no lede was accepted, keep the first sentences the scorer actually saw, so the scorer's
          // over-rejection can be diagnosed and fixed from the real openings (AAPL/NVDA), not guessed at.
          sample: bizLede ? undefined : bizSents.slice(0, 5).map((s) => cleanQuote(String(s || "")).slice(0, 180)).filter(Boolean),
          // The raw head of the extracted Item 1 section, so a re-fetch shows WHERE the section boundary
          // landed. On the largest filers an early in-text cross-reference to "Item 1A. Risk Factors"
          // truncates the true section, and the longest-chunk rule then hands the hero a span that starts
          // mid-section — risk or competition text reaching the description (Walmart, Coca-Cola, BofA).
          // This makes that visible on real text rather than guessed; kept only when no lede was found.
          bizHead: bizLede ? undefined : (cur.business.head || null),
        },
        ownerFlags: flags,
        // Retired from the record (2026-07): fog/hedge readability scores and the mdnaChange/
        // riskChange sentence diffs. Nothing on the site read them — the "what changed" section
        // was stripped as below the bar (see docs/workstreams-2026-07.md) — and dead fields in a
        // 1,375-company file are pure weight. candorPrior stays: the candor-drift Inversion test
        // is queued work.
        mdna: {
          words: cur.mdna.words, wordsPrior: prior?.mdna.words ?? null,
          candor: cur.mdna.candor || null, candorPrior: prior?.mdna.candor || null,
        },
        risk: { words: cur.risk.words, wordsPrior: prior?.risk.words ?? null },
        aiRead: aiSignal(cur, prior),
        buffettRead: buffettRead(cur, isFinancialSic(c.sic) || isPriceTakerSic(c.sic), cur.ogRead?.crit ?? null),
        comp,
        debtMaturity,
        // The reserve-development sentence, welded to the filed number (Build 4). Absent means
        // the lane found nothing that passed all four rungs — silence over filler.
        ...(cur.reserveRead ? { reserveDevelopment: cur.reserveRead } : {}),
        // The uninsured-deposits read (Build 6, banks): a welded or quote-only disclosure
        // sentence, or a stated withhold with its reason. Absent means the lane found no
        // level statement that passed the gates — silence over filler.
        ...(cur.uninsuredRead ? { uninsuredDeposits: cur.uninsuredRead } : {}),
        // The software NRR + customer-ladder read (Build 7): the filer's own retention and
        // customer-count sentences with their figures as verbatim substrings, prior-year
        // corroborated across filings, plus the KPI discontinuity tripwire. Absent means
        // the gates passed nothing — silence over filler.
        ...((() => { const sw = softwareKpiAssemble(cur.swRead, prior?.swRead ?? null); return sw ? { softwareRead: sw } : {}; })()),
        // Who stands behind the reserves (Build 8, O&G): the Item 1202 attribution — firm,
        // the filer's own verb, and any in-sentence coverage share, all welded to the quoted
        // sentence; or the filer's own internal-process sentence. Absent means the firm
        // dictionary missed and no qualifications sentence exists — silence over filler.
        ...(cur.ogRead?.attribution ? { reserveAttribution: cur.ogRead.attribution } : {}),
        // The REIT re-leasing spreads + occupancy read (Build 9): the landlord's own pricing
        // sentence and the dated occupancy sentence(s), every rendered figure a verbatim
        // substring of its quote (the only computed value — the recapture tie — is sourced to
        // the sentence's own dollar pair). Absent means the gates passed nothing — silence
        // over filler; a stated withhold carries its reason.
        ...(cur.reitRead ? { reitLeasing: cur.reitRead } : {}),
        // The utilities disallowance ledger + securitization keyhole (Build 10): the
        // commission's completed acts and the storm/retirement costs moved off the meter, in
        // the filer's own sentences, every dollar a verbatim substring, quote-only — the lane
        // never computes. Absent means zero incidence — silence over filler.
        ...(cur.utilRead ? { utilityReg: cur.utilRead } : {}),
        // The utilities rate-case list (Build 12): what the commission was asked for and what
        // it granted, ALWAYS a list, in the filer's own sentences, every chip a verbatim
        // substring, no status field. Absent means the filer carries neither a qualifying case
        // nor a regime sentence — silence over filler; `withheld` carries the regime sentence
        // where the filer explains why rates are not set case by case.
        ...(cur.rateRead ? { rateCases: cur.rateRead } : {}),
        // The managed-care MLR cost-trend read (Build 11): the filer's own cost-trend
        // sentence tiered against the desk's computed medical loss ratio — a level badge only
        // at the sentence's own declared precision, direction-only beneath it, segment
        // figures never. Absent means no computed MLR or nothing passed — silence over
        // filler.
        ...(cur.mcRead ? { mlrTrend: cur.mcRead } : {}),
      };
      ok++;
      console.log(`  ✓ ${tk}: ${flags.length} owner-flags, MD&A ${cur.mdna.words}w` + (comp ? `, payRatio ${comp.payRatio}:1` : "") + (debtMaturity ? `, debt-wall $${(debtMaturity.total / 1e9).toFixed(1)}B` : ""));
    } catch (e) {
      console.warn(`  ! ${tk}: record assembly ${e.message}`);
    }
  }

  // Drop any carried-over entry whose company has left both universes, so a removed name does not
  // linger as stale qualitative text.
  for (const tk of Object.keys(out)) if (!inUniverse.has(tk.toUpperCase())) delete out[tk];

  // Atomic write (temp + rename), so an OOM or SIGKILL mid-write can't truncate the large language
  // file into JSON the next run would fail to parse. Rename is atomic on a single volume.
  const dest = path.join(dataDir, "language.json");
  const tmp = dest + ".tmp";
  fs.writeFileSync(tmp, compactJson({ asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR, 10-K and 20-F/40-F annual reports", sample: false, companies: out }));
  fs.renameSync(tmp, dest);
  console.log(`\n✅ Wrote language analysis for ${ok} companies this run (${Object.keys(out).length} total across both pools)`);
}

// Exported for the offline logic test; only hit EDGAR when run directly.
export { RC_ILLUSTRATION, RC_NO_ASSURANCE, RC_BOTH_DIRECTIONS, RC_PARALLEL_LIST, RC_GRANT_VERB, ownerFlags, FLAG_THEMES, sentences, isProse, diff, extractPayRatio, extractInsiderOwnership, extractInsiderGroup, htmlToText, section, fetchText, businessDescription, candorSignals, businessBrief, buffettRead, BIZ_HUMANCAP, BIZ_LINEAGE, BIZ_ASPIRATIONAL, BRIEF_ORPHAN, PROMO, smellsLikeRisk, fortyFSections, folderDocs, extractSections, MW_DECLARED, MW_ABSENT, MW_OTHER_ENTITY, RESTATED, RESTATED_CONTRACT, INTEGRITY_FUTURE, ADMIT, NOT_ADMIT, BLAME_OTHERS, reserveDevelopmentRead, devSentences, uninsuredDepositsRead, uninsSentences, softwareRetentionRead, customerLadderRead, softwareKpiRead, softwareKpiAssemble, swSentences, swCounts, reserveEngineerRead, ogCriticalTopics, ogSentences, reitLeasingRead, reitSpreadRead, reitOccupancyRead, reitSentences, utilityRegRead, utilityDisallowances, utilitySecuritization, regZones, regPieces, mlrCostTrendRead, mcSentences, rateCaseRead, rcSentences, rcLabelFrom, rcFigures, rcZones, utilityRateCases, utilityRateRegime };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
