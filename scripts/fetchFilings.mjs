#!/usr/bin/env node
// fetchFilings.mjs — the qualitative read of the 10-K.
//
// Pulls each company's two most recent 10-K documents from EDGAR, extracts the
// Business (Item 1), MD&A (Item 7) and Risk Factors (Item 1A), and produces two
// things, both verbatim and sourced, never scored:
//   1. "What an owner would flag" — the timeless sentences Graham and Buffett
//      would stop on (customer concentration, pricing power, debt covenants,
//      going-concern doubt, dilution, …), one per lens, from the latest filing.
//   2. "What changed" — sentences genuinely new versus last year's filing
//      (number-normalized so figure updates don't count), plus length,
//      readability and hedging drift.
// Writes src/data/language.json.
//
// 100% EDGAR — no key, no LLM. Runs in CI (needs data.sec.gov + www.sec.gov).
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
// onto the sentence that follows). Conservative — only a leading Title-Case run or
// a short colon-led label, never sentence content.
function cleanQuote(s) {
  s = s.replace(/\s+/g, " ").trim();
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

// Keep prose only — drop table rows, figure dumps, and page artifacts.
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
  return { url, business: metrics(business), mdna: metrics(mdna), risk: metrics(risk), reportDate: f.reportDate };
}

// "New" = a prose sentence carrying a signal term whose wording doesn't closely
// match anything in last year's filing (fuzzy, so figure updates and light edits
// don't count). Returns only the notable handful — never a raw "everything
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

// ---- "What an owner would flag" ----
// The timeless read, not the year-over-year diff: the handful of sentences in the
// Business, MD&A and Risk Factors that Graham (solvency, stability) and Buffett
// (a moat, who you depend on, who sets the price) would stop on. Each theme is a
// lens; we surface the single most specific sentence that trips it, verbatim and
// sourced — never a score. Ordered so the gravest, rarest flags come first.
const FLAG_THEMES = [
  {
    lens: "Going-concern doubt",
    why: "The rarest and gravest flag — the company's own auditors questioning whether it survives the year. Graham's first test, failed.",
    test: (s) => /substantial doubt[\s\S]{0,60}(continue as a going concern|ability to continue)/i.test(s),
    bonus: () => 6,
  },
  {
    lens: "Customer concentration",
    why: "Who the revenue leans on. When one buyer is a large slice of sales, that buyer holds the pricing power — and its troubles become the company's.",
    // Require an actual share-of-revenue disclosure (a percentage), not merely the
    // word "customers" next to some number — that mislabels subscriber/headcount lines.
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
    why: "What the whole business leans on — a product, a platform, a partner. Concentration cuts both ways, and the filing is where management has to admit it.",
    // Require a concrete object of dependence (product/platform/customer/supplier/
    // single-something), so generic "our success depends on our employees" — true of
    // every company — doesn't fill the slot.
    test: (s) =>
      /(substantially depend|depend\w* heavily|depend\w* significantly|materially depend|a significant (portion|percentage) of (our )?(revenue|net sales|sales|business))/i.test(s) ||
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
    why: "Claims an owner inherits. Most are noise; the filing is where the ones that aren't first surface.",
    test: (s) => /(litigation|lawsuit|class action|patent infringement|legal proceeding|investigation by|subpoena|antitrust (suit|claim|lawsuit))/i.test(s),
    bonus: (s) => (/(material|adverse|damages|settle|enjoin)/i.test(s) ? 1 : 0),
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
    test: (s) => /(cyclical(ity)?|economic downturn|recession|volatil\w* demand|demand[\s\S]{0,30}(fluctuat|volatil))/i.test(s),
    bonus: () => 0,
  },
  {
    lens: "Regulation & policy",
    why: "Rules that can rewrite the economics — tariffs, antitrust, data, export controls.",
    // Must carry a consequence, so routine "we monitor legislation" compliance prose
    // doesn't surface as a risk flag.
    test: (s) =>
      /(tariff|export control|economic sanction|antitrust|data privacy|new regulation|regulatory (change|requirement|action)|recently enacted|legislation|GDPR)/i.test(s) &&
      /(could|may|would|adversely|materially|restrict|increase|impose|prohibit|penalt|fine|subject to|harm|impact|require|cost)/i.test(s),
    bonus: () => 0,
  },
];

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
      const score =
        (SIGNAL.test(p.s) ? 1 : 0) +
        (/\d/.test(p.s) ? 1 : 0) +
        (p.s.length >= 90 && p.s.length <= 320 ? 1 : 0) +
        th.bonus(p.s);
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
      console.warn(`  ! ${tk}: qualitative sections not cleanly extracted (${qualWords}w) — skipping`);
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

    out[tk] = {
      fy: cur.reportDate?.slice(0, 4) || null,
      priorFy: prior?.reportDate?.slice(0, 4) || null,
      sourceUrl: cur.url,
      ownerFlags: flags,
      mdna: {
        words: cur.mdna.words, fog: cur.mdna.fog, hedgeDensity: Math.round(cur.mdna.hedgeDensity * 1e4) / 1e4,
        wordsPrior: prior?.mdna.words ?? null, fogPrior: prior?.mdna.fog ?? null,
        hedgePrior: prior ? Math.round(prior.mdna.hedgeDensity * 1e4) / 1e4 : null,
      },
      risk: { words: cur.risk.words, wordsPrior: prior?.risk.words ?? null },
      mdnaChange: mdnaDiff,
      riskChange: riskDiff,
    };
    ok++;
    console.log(`  ✓ ${tk}: ${flags.length} owner-flags, MD&A ${cur.mdna.words}w fog ${cur.mdna.fog}` + (mdnaDiff ? `, ${mdnaDiff.notableCount} new` : ""));
  }

  fs.writeFileSync(
    path.join(dataDir, "language.json"),
    JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR — 10-K documents", sample: false, companies: out }, null, 2) + "\n"
  );
  console.log(`\n✅ Wrote language analysis for ${ok}/${fundamentals.companies.length} companies`);
}

// Exported for the offline logic test; only hit EDGAR when run directly.
export { ownerFlags, FLAG_THEMES, sentences, isProse, diff };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
