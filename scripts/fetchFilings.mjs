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

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE = 200;

const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
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

// Capture from a start heading to the earliest following end heading. With a TOC
// at the front, the real section is the longest candidate, so keep the largest.
function section(text, startRe, endRes) {
  let best = "";
  let m;
  const re = new RegExp(startRe, "gi");
  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    let to = text.length;
    for (const er of endRes) {
      const e = new RegExp(er, "gi");
      e.lastIndex = from + 40;
      const em = e.exec(text);
      if (em && em.index < to) to = em.index;
    }
    const chunk = text.slice(from, to);
    if (chunk.length > best.length) best = chunk;
  }
  return best;
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
    .split(/(?<=[.!?])\s+(?=[A-Z(“"])/)
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
    .split(/(?<=[.!?])\s+(?=[A-Z(“"])/)
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
// a miss. No model, no sentiment lexicon bought off the shelf; just the vocabulary an owner cares
// about. Present, never pronounce: the page shows the densities, the trajectory and the actual
// sentences, and the reader judges the character.
const OWNER_TALK = /\b(per[\s-]?share|return on (invested |tangible )?(capital|equity)|intrinsic value|capital allocation|free cash flow|long[\s-]?term|compound\w*|reinvest\w*|book value|owner[\s']?s?\b)/gi;
const PROMO = /\b(world[\s-]?class|best[\s-]?in[\s-]?class|best[\s-]?of[\s-]?breed|industry[\s-]?leading|cutting[\s-]?edge|state[\s-]?of[\s-]?the[\s-]?art|revolutionary|transformational|disrupt\w*|synerg\w*|leverage our|unprecedented|paradigm|next[\s-]?gen\w*|seamless\w*|turnkey|holistic|mission[\s-]?critical|game[\s-]?chang\w*|robust\w*|compelling)/gi;
const ADJUSTED = /\b(non[\s-]?GAAP|adjusted (EBITDA|earnings|net income|operating income|operating|diluted|results|EPS|margin)|pro[\s-]?forma|constant currency|excluding (certain|the impact|special|one[\s-]?time|the effect)|core (earnings|operating)|normalized (earnings|EBITDA|results)|one[\s-]?time (item|charge|cost)s?|special items)/gi;
// A management owning a miss, in the first person and past tense, the rarest and most prized tell.
// The conditional/hypothetical guard keeps a forward-looking risk factor ("our results could fall
// short if…") out; genuine candor is declarative about what already happened. "should have" must be
// the regretful kind ("we should have acted sooner"), not "investors should have access."
const ADMIT = /\b(were wrong|made (a |several |some )?mistakes?|misjudged|overpaid|over[\s-]?estimated|too optimistic|fell short of|did not meet (our|the)|failed to (meet|deliver|achieve|execute)|were disappointed|disappointing (results|performance|year|quarter)|underperformed|below (our )?expectations|in hindsight|should have (done|known|anticipated|recognized|acted|been|moved|invested|exited|sold|reduced|avoided|foreseen|started|focused))\b/i;
const NOT_ADMIT = /\b(may|might|could|would|if\s|risk that|in the event|to the extent|no assurance|cannot assure|future)\b/i;
// Owning a miss means OWNING it. When the failure is pinned on someone else — a supplier, a partner,
// a customer who "failed to meet its obligations" — it is the opposite of candor, so it is excluded.
const BLAME_OTHERS = /\b(supplier|vendor|manufacturer|co-?manufacturer|co-?packer|partner|customer|client|counterparty|contractor|subcontractor|licensee|licensor|third[- ]party|distributor|borrower|tenant|reseller|franchisee|joint venture|other party)\b[\s\S]{0,30}\b(failed to|did not (meet|deliver|perform|pay|complete)|fell short|breached|defaulted|was unable)/i;
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
  return { owner: per1k(OWNER_TALK), promo: per1k(PROMO), adjusted: per1k(ADJUSTED), admissions };
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
const HEAD_TOKEN = /^(item\s*1[ab]?\b\.?|part\s*i+\b\.?|general development of (the )?business|executive overview|business overview|company overview|our company|our business|the company|introduction|business|general|overview)\s*[:.\-–—]?\s+/i;
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
const LEAD_HEADING = /^((overview|description|summary|nature)\s+of\s+(the\s+)?business|general\s+development\s+of\s+(the\s+)?business|executive\s+overview|business\s+overview|company\s+overview|overview\s+of\s+operations|business\s+update|recent\s+developments|results\s+of\s+operations|business\s+factors[\w\s]{0,45}?operations|segment\s+reporting|our\s+business|our\s+company|the\s+(business|company)|overview|introduction|business|general|properties)\b[\s:.\-–—]+/i;
const stripLeadingHeading = (s) => { let o = String(s || ""); for (let k = 0; k < 2 && LEAD_HEADING.test(o); k++) o = o.replace(LEAD_HEADING, ""); return o ? o.charAt(0).toUpperCase() + o.slice(1) : o; };
const LEAD_VERB = /^(is|are|operates?|provides?|markets?|designs?|develops?|sells?|offers?|supplies|distributes?|delivers?|produces?|manufactures?|engages?)\b/i;
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
  const startsWithSubject = (t) => /^(we|our|us|the (company|registrant|firm|group))\b/i.test(t) ||
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
        if (m2 && m2.index > 0 && m2.index < 160) at = m2.index;
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
          const headingish = /\b(mission|vision|overview|strateg|history|organization|introduction|purpose|founded|headquarter|business|general|company|incorporated|together with|referred to|first-person|notations|principal|trends?|as of|during|for the (year|fiscal|quarter|period|three|six|nine|twelve)|for fiscal)\b/i;
          // Only when the name does not already appear in the prefix: if it does, the prefix
          // is the real subject ("Huntington Ingalls is …"), not a heading to jump over.
          if (!subjVerb.test(prefix) && !nameWords.some((w) => prefix.toLowerCase().includes(w)) &&
              (headingish.test(prefix) || (prefix.trim().length < 42 && !prefix.includes(",")))) at = m.index;
        }
      }
      if (at > 0) s = s.slice(at).trim();
    }
    if (LEAD_VERB.test(s) && name) s = `${name.trim()} ${s}`; // restore a subject split off entirely
    if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.length < 34 || s.length > 700) continue;
    if (BIZ_SKIP.test(s) || BIZ_WEAK.test(s) || BIZ_FRAGMENT.test(s) || BIZ_RESULTS.test(s) || BIZ_NOTDESC.test(s)) continue;
    const isa = BIZ_ISA.test(s);
    if (!BIZ_DOING.test(s) && !isa && !BIZ_ENGAGED.test(s)) continue;
    const head = s.split(/\s+/).slice(0, 6).join(" ");
    const headNorm = head.toLowerCase().replace(/[^a-z0-9]/g, "");
    const weSubject = /^(we|our|the (company|registrant|firm|group)|us)\b/i.test(s);
    const namedSubject = nameWords.some((w) => headNorm.includes(w));
    if ((!weSubject && !namedSubject) || !/^[A-Z]/.test(s)) continue;
    let score = 0;
    if (isa) score += 3;                        // the canonical "is a/an/one of <type>" form
    if (namedSubject && !weSubject) score += 2; // names the company, not a bare "we"
    if (BIZ_RICH.test(s)) score += 1;           // products, markets, segments
    if (BIZ_STRUCTURAL.test(s)) score -= 3;     // org chart, not a description
    score -= i * 0.6;                           // the opener is usually the intended one
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
  const best = cands[0].s;
  return best.length > 300 ? best.slice(0, 297).replace(/[\s,;]+\S*$/, "") + "…" : best;
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
    if (LEAD_VERB.test(s) && name) s = `${name.trim()} ${s}`;
    if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.length < 60 || s.length > 340) continue;
    if (!isProse(s) || BIZ_SKIP.test(s) || BIZ_WEAK.test(s) || BIZ_STRUCTURAL.test(s)) continue;
    if (!BIZ_RICH.test(s)) continue; // must name products, markets, segments or customers
    const sNorm = normalize(s);
    if (sNorm === ledeNorm || ledeNorm.includes(sNorm.slice(0, 50)) || sNorm.includes(ledeNorm.slice(0, 50))) continue; // not the lede again
    // The lede is often the cleaned form of one of these sentences (a "together with its subsidiaries"
    // clause inserted, a heading prefixed), so the substring check above misses it. A high token
    // overlap catches the near-duplicate — CVS's "Overview of Business … is a leading health solutions
    // company …" repeating its own lede.
    if (jaccard(tokenize(s), tokenize(lede)) > 0.5) continue;
    if (extras.some((e) => jaccard(tokenize(e), tokenize(s)) > 0.5)) continue; // distinct from a prior extra
    extras.push(s.length > 320 ? s.slice(0, 317).replace(/[\s,;]+\S*$/, "") + "…" : s);
  }
  return extras;
}

// ---- EDGAR document discovery ----

async function latestTenKs(cik, n = 2) {
  const sub = await fetchText(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const j = JSON.parse(sub);
  const r = j.filings?.recent;
  if (!r) return [];
  const out = [];
  for (let i = 0; i < r.form.length && out.length < n; i++) {
    if (r.form[i] === "10-K" && r.primaryDocument[i]) {
      out.push({ accn: r.accessionNumber[i], doc: r.primaryDocument[i], date: r.filingDate[i], reportDate: r.reportDate?.[i] });
    }
  }
  return out;
}

async function getFiling(cik, f) {
  const accnNoDash = f.accn.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${f.doc}`;
  const html = await fetchText(url);
  const text = htmlToText(html);
  const business = section(text, "item\\s*1[\\.\\s]+business", ["item\\s*1a[\\.\\s]+risk", "item\\s*1b[\\.\\s]", "item\\s*2[\\.\\s]+propert"]);
  const mdna = section(text, "item\\s*7[\\.\\s]+management", ["item\\s*7a[\\.\\s]+quantitative", "item\\s*8[\\.\\s]+financial"]);
  const risk = section(text, "item\\s*1a[\\.\\s]+risk\\s*factors", ["item\\s*1b[\\.\\s]", "item\\s*2[\\.\\s]+propert"]);
  const md = metrics(mdna);
  return { url, business: { ...metrics(business), lead: leadSentences(business) }, mdna: { ...md, lead: leadSentences(mdna), candor: candorSignals(mdna, md.sents) }, risk: metrics(risk), reportDate: f.reportDate };
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

async function getComp(cik, f) {
  const accnNoDash = f.accn.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${f.doc}`;
  const text = htmlToText(await fetchText(url));
  const payRatio = extractPayRatio(text);
  return payRatio != null ? { payRatio, fy: f.date?.slice(0, 4) || null, sourceUrl: url } : null;
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
// Classic NLP, no model. Two questions, answered from the filing's own words: does the
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
    test: (s) => /(single source|sole source|sole supplier|single supplier|one supplier|limited number of suppliers|few suppliers|rely on a (single|limited)|depend\w* on .{0,30}suppl)/i.test(s),
    bonus: () => 0,
  },
  {
    lens: "Concentrated dependence",
    why: "What the whole business leans on, a product, a platform, a partner. Concentration cuts both ways, and the filing is where management has to admit it.",
    // Require a concrete object of dependence (product/platform/customer/supplier/
    // single-something), so generic "our success depends on our employees", true of
    // every company, doesn't fill the slot.
    test: (s) =>
      /(substantially depend|depend\w* heavily|depend\w* significantly|materially depend|a significant (portion|percentage) of (our )?(revenue|net sales|sales|business))/i.test(s) ||
      /\bdepend\w*\s+(?:on|upon)\s+(?:the\s+)?(?:price|availability|supply|cost)s?\b/i.test(s) ||
      (/(our (success|business|growth|results|revenue))[\s\S]{0,50}depend/i.test(s) &&
        /(product|platform|customer|supplier|vendor|single|sole|concentrat|one |few |limited|key (account|customer|supplier|product))/i.test(s)),
    bonus: (s) => (/\d/.test(s) ? 1 : 0),
  },
  {
    lens: "Debt terms & refinancing",
    why: "The fine print behind the debt. Covenants and near-term maturities decide who is really in control when a year goes badly.",
    test: (s) => /(financial covenant|covenants (under|contained|require)|indenture|refinanc|debt maturit|maturities of|revolving credit facility|default under)/i.test(s),
    bonus: (s) => (/(covenant|default)/i.test(s) ? 2 : 0),
  },
  {
    lens: "Litigation & contingencies",
    why: "Claims an owner inherits. Most disclosure is boilerplate; this fires only on an actual matter, a named suit, a settlement, a contingency, a number.",
    // Require an actual legal/regulatory/tax matter (a named suit, a settlement of
    // a lawsuit, a fine, a court ruling, a defendant, a specific allegation), never
    // an operational $-line with an incidental "settle"/"penalty"/"contingency".
    test: (s) =>
      /(class action|securities (class action|fraud)|antitrust (suit|claim|lawsuit|investigation|matter|case|action|complaint|litigation|fine|probe)|monopoliz|anticompetitive|patent (infringement|dispute|suit|litigation)|product liability|qui tam|whistleblower|consent decree|(named (as )?a defendant|is a defendant|are defendants|sued (us|the company|the))|(lawsuit|complaint|class action|legal proceeding)s? (filed|brought|pending|alleging|seeking|that allege)|settle\w+ (of |a |an |the |this |that |certain |previously )*(lawsuit|litigation|class action|legal (matter|proceeding|claim|action)|patent|antitrust|opioid)|jury (verdict|award\w*|found)|(court|circuit|appeals?|tribunal|judge)[\sa-zA-Z']{0,30}(ruled|awarded|affirmed|reversed|judgment|denial|dismiss|enjoin)|investigation by (the )?(SEC|DOJ|FTC|EU|European Commission|attorney general|Department of Justice|state)|(fine|penalty)[\s\S]{0,25}(EC|European Commission|antitrust|competition authorit)|appeal\w+ the (EC|EU|European|decision)|infring\w+ (our|its|the|on|upon)|alleg\w+ (that|monopoli|fraud|infring|breach|violations? of|discriminat)|(IRS|tax authorit\w+)[\s\S]{0,55}(propos\w+|seeking|asserted|deficiency|adjustment|disput|notice)|(charge|liability|accru\w+|reserve|provision|net gains?)[\s\S]{0,50}(litigation|legal (matter|proceeding|settlement|claim)|class action|antitrust|opioid|interchange))/i.test(s),
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
    test: (s) => /(cyclical|highly seasonal|(industry|severe|sharp|prolonged|economic) downturn|downturn in (the|our|demand)|recession\w*[\s\S]{0,30}(reduce|decreas|lower|impact|demand|weaken|soften))/i.test(s),
    bonus: (s) => (/(cyclical|industry downturn|severe downturn)/i.test(s) ? 1 : 0),
  },
  {
    lens: "Regulation & policy",
    why: "Rules that can rewrite the economics, tariffs, antitrust, data, export controls.",
    // Require a specific named regime, not generic "we comply with regulations".
    test: (s) =>
      /(tariff|export control|economic sanction|antitrust|data privacy|GDPR|CHIPS Act|Inflation Reduction Act|Dodd-Frank|emissions?|FDA|EPA|FTC|DOJ|European Commission|net neutrality|price (control|cap)|excise tax|sugar tax|container deposit|extended producer responsibility)/i.test(s) &&
      /(could|may|would|adversely|materially|restrict|increase|impose|prohibit|penalt|fine|subject to|harm|impact|require|cost|ban|limit|tax)/i.test(s),
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
const MW_ABSENT = /\b(no|not|without|did not (identify|have|note|find)|none|free (of|from)|absence of|reasonable assurance|were not|was not|have not|is not|are not|remediated|been remediated)\b[\s\S]{0,40}material weakness|material weakness(es)?[\s\S]{0,40}\b(did not|were not|was not|have not|not (identif|exist|present)|been remediated|was remediated)/i;
// A restatement that actually happened: past-tense "restated", tied to the financial statements.
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
function integritySentence(sents, declared, absent) {
  for (const raw of sents || []) {
    const s = cleanQuote(String(raw || ""));
    if (s.length < 40 || s.length > 300) continue;
    if (INTEGRITY_FUTURE.test(s) || !declared.test(s)) continue;
    if (absent && absent.test(s)) continue;
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
  const materialWeakness = integritySentence([...mdna, ...risk], MW_DECLARED, MW_ABSENT);
  const restatement = integritySentence([...mdna, ...risk], RESTATED, null);
  const integrity = materialWeakness || restatement ? { materialWeakness: materialWeakness || null, restatement: restatement || null } : null;

  if (!pricing && !judgment && !integrity) return null;
  return { pricing, judgment, integrity };
}

async function main() {
  const out = {};
  let ok = 0;
  for (const c of fundamentals.companies) {
    const tk = c.ticker;
    if (!c.cik) continue;
    await sleep(THROTTLE);
    let filings;
    try {
      filings = await latestTenKs(c.cik, 2);
    } catch (e) { console.warn(`  ! ${tk}: submissions ${e.message}`); continue; }
    if (!filings.length) { console.warn(`  ! ${tk}: no 10-K found`); continue; }

    let cur, prior;
    try {
      await sleep(THROTTLE);
      cur = await getFiling(c.cik, filings[0]);
      if (filings[1]) { await sleep(THROTTLE); prior = await getFiling(c.cik, filings[1]); }
    } catch (e) { console.warn(`  ! ${tk}: filing ${e.message}`); continue; }

    // Quality gate: a clean qualitative extraction (Business + MD&A + Risk) runs
    // to several thousand words. Skip companies we couldn't parse rather than emit
    // garbage. The owner-flags can carry even if one section came up short.
    const qualWords = cur.business.words + cur.mdna.words + cur.risk.words;
    if (qualWords < 1500) {
      console.warn(`  ! ${tk}: qualitative sections not cleanly extracted (${qualWords}w), skipping`);
      continue;
    }

    // The timeless read: what an owner would flag, from the latest filing only.
    const pool = [];
    for (const [sec, m] of [["Business", cur.business], ["MD&A", cur.mdna], ["Risk Factors", cur.risk]])
      for (const s of m.sents || []) pool.push({ s, section: sec });
    const flags = ownerFlags(pool);

    // The diff: what's genuinely new versus last year (needs the prior filing).
    const mdnaDiff = prior ? diff(cur.mdna.sents, prior.mdna.sents) : null;
    const riskDiff = prior ? diff(cur.risk.sents, prior.risk.sents) : null;

    // Executive pay from the latest proxy (non-fatal, a bonus layer).
    let comp = null;
    try {
      const proxy = await latestProxy(c.cik);
      if (proxy) { await sleep(THROTTLE); comp = await getComp(c.cik, proxy); }
    } catch (e) { console.warn(`  ! ${tk}: proxy ${e.message}`); }

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
        },
        ownerFlags: flags,
        mdna: {
          words: cur.mdna.words, fog: cur.mdna.fog, hedgeDensity: Math.round(cur.mdna.hedgeDensity * 1e4) / 1e4,
          wordsPrior: prior?.mdna.words ?? null, fogPrior: prior?.mdna.fog ?? null,
          hedgePrior: prior ? Math.round(prior.mdna.hedgeDensity * 1e4) / 1e4 : null,
          candor: cur.mdna.candor || null, candorPrior: prior?.mdna.candor || null,
        },
        risk: { words: cur.risk.words, wordsPrior: prior?.risk.words ?? null },
        mdnaChange: mdnaDiff,
        riskChange: riskDiff,
        aiRead: aiSignal(cur, prior),
        buffettRead: buffettRead(cur, isFinancialSic(c.sic)),
        comp,
      };
      ok++;
      console.log(`  ✓ ${tk}: ${flags.length} owner-flags, MD&A ${cur.mdna.words}w` + (comp ? `, payRatio ${comp.payRatio}:1` : ""));
    } catch (e) {
      console.warn(`  ! ${tk}: record assembly ${e.message}`);
    }
  }

  fs.writeFileSync(
    path.join(dataDir, "language.json"),
    JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR, 10-K documents", sample: false, companies: out }, null, 2) + "\n"
  );
  console.log(`\n✅ Wrote language analysis for ${ok}/${fundamentals.companies.length} companies`);
}

// Exported for the offline logic test; only hit EDGAR when run directly.
export { ownerFlags, FLAG_THEMES, sentences, isProse, diff, extractPayRatio, htmlToText, section, fetchText, businessDescription, candorSignals, businessBrief, buffettRead };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
