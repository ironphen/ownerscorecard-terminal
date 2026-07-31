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
    if (PAGE_AFTER.test(after) || START_XREF_AFTER.test(after) || START_QUOTE_BEFORE.test(text.slice(Math.max(0, from - 8), from)) ||
        XREF_BEFORE.test(text.slice(Math.max(0, from - 28), from))) continue;
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
        if (!XREF_BEFORE.test(text.slice(Math.max(0, em.index - 34), em.index)) &&
            !START_QUOTE_BEFORE.test(text.slice(Math.max(0, em.index - 4), em.index))) break;
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
const BIZ_SKIP = /(was|were)\s+incorporated|incorporated\s+(under|in)\b|reincorporat|organized under the laws|founded in\s+\d|fiscal year|forward-looking|securities (act|exchange) of|report on form|unless the context|initial public offering|principal executive offices|market for (the )?registrant|common equity|equity securities|stockholder matters|\bmay\b|could\s+(adversely|result|harm|cause|materially|impair)|no assurance|our ability to|unsubstantiated|misleading|negative publicity|table of contents|\bcould\b|\bif (we|our|the company|a |an |adverse)|decline in (consumer|demand|sales)|reasonable basis for (our|the) opinion|provide a reasonable basis|standards of the public company accounting|fair value\b|cost of capital|non-?gaap|balance sheets? (include|reflect)|internally generated cash|dividends are reinvested|consideration we expect|we expect to be entitled|notice letter|corporate headquarters|(listed|traded|trades|trading|registered)\s+on (the )?(nasdaq|new york|nyse)|began trading|common stock (is|has)\s*(been\s*)?(listed|registered|traded)|in our (definitive )?proxy|responsive to this item|incorporated by reference|does not trade in the public market|\b(is|are) subject to\b|corporation (formed|organized)\b|further described (in|below|elsewhere)|\bor in the value of\b|value of the collateral|(reportable|reporting)\s+(business\s+)?segments?\s+are\b|represent(s|ed)\s+[^.]{0,28}\b(majority|\d+%)[^.]{0,18}\brevenue/i;
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

async function getFiling(cik, f, totalDebtMillions = null) {
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
  return { url, business: { ...metrics(business), lead: leadSentences(bizLeadText(business, f.form)), head: business.slice(0, 800) }, mdna: { ...md, lead: leadSentences(mdna), candor: candorSignals(mdna, md.sents) }, risk: metrics(risk), reportDate: f.reportDate, debtMaturity };
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
  return {
    inRisk: compHits.length > 0,        // names AI specifically as a competitive risk
    mentionsAIRisk: anyAIrisk,          // mentions AI anywhere in the risk factors
    riskMentions: compHits.length,
    riskQuote: pointed ? cleanQuote(pointed).slice(0, 320) : null,
    newThisYear: !!newComp,
    newQuote: newComp ? cleanQuote(newComp).slice(0, 320) : null,
    asCapability: capHits.length > 0,
    capabilityQuote: capHits.length ? cleanQuote(capHits[0]).slice(0, 280) : null,
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
function ownerFlags(pool) {
  const used = new Set();
  const out = [];
  for (const th of FLAG_THEMES) {
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

function buffettRead(cur, isFinancial) {
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
    const pressure = bestSentence(mdna, PRICE_DOWN, [HYPO, PRICE_NONPRODUCT]);
    // The cost sentence must itself resolve the question — pass-through (COST_OFFSET) or squeeze
    // (OFFSET_NEG) — not merely name inflation. Prefer a quantified one.
    const costStance = mdna
      .map(cq)
      .filter((s) => s.length >= 45 && s.length <= 300 && COST_UP.test(s) && !COST_HYPO.test(s) && (COST_OFFSET.test(s) || OFFSET_NEG.test(s)))
      .sort((a, b) => (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0))[0] || null;
    pricing = (power || pressure || costStance)
      ? {
          power: power || null, powerStrong: power ? powerStrong : false, powerCount,
          pressure: pressure || null,
          costInflation: costStance, passedThrough: costStance ? COST_OFFSET.test(costStance) && !OFFSET_NEG.test(costStance) : null,
        }
      : null;
  }

  // 2. Where the numbers are soft.
  const judgment = criticalEstimates(mdna);

  // 3. Accounting integrity.
  const materialWeakness = integritySentence([...mdna, ...risk], MW_DECLARED, MW_ABSENT, MW_OTHER_ENTITY);
  const restatement = integritySentence([...mdna, ...risk], RESTATED, RESTATED_CONTRACT);
  const integrity = materialWeakness || restatement ? { materialWeakness: materialWeakness || null, restatement: restatement || null } : null;

  if (!pricing && !judgment && !integrity) return null;
  return { pricing, judgment, integrity };
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
    let cur, prior;
    try {
      await sleep(THROTTLE);
      cur = await getFiling(c.cik, filings[0], totalDebtMillions);
      if (filings[1]) { await sleep(THROTTLE); prior = await getFiling(c.cik, filings[1]); }
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
    const flags = ownerFlags(pool);

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
        buffettRead: buffettRead(cur, isFinancialSic(c.sic)),
        comp,
        debtMaturity,
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
export { ownerFlags, FLAG_THEMES, sentences, isProse, diff, extractPayRatio, extractInsiderOwnership, extractInsiderGroup, htmlToText, section, fetchText, businessDescription, candorSignals, businessBrief, buffettRead, BIZ_HUMANCAP, BIZ_LINEAGE, BIZ_ASPIRATIONAL, BRIEF_ORPHAN, PROMO, smellsLikeRisk, fortyFSections, folderDocs, extractSections, MW_DECLARED, MW_ABSENT, MW_OTHER_ENTITY, RESTATED, RESTATED_CONTRACT, INTEGRITY_FUTURE, ADMIT, NOT_ADMIT, BLAME_OTHERS };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
