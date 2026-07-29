// filingFacts.mjs — the FRESH-FILING MERGE (2026-07-29). The pipeline's source, SEC's companyfacts
// API, can lag a filing's acceptance by a day or more: Rambus filed its June-quarter 10-Q on
// 2026-07-28 and the API was still serving the March quarter as its newest fact a full day later,
// so the morning refresh faithfully re-extracted a stale record. No amount of re-running fixes an
// upstream gap. What EDGAR DOES publish at the moment of acceptance is the filing's own extracted
// XBRL instance (the `*_htm.xml` beside the inline document), and that is the same data
// companyfacts will eventually serve.
//
// THE GATE IS THE FILING'S OWN COMPARATIVES (the corroborated-fill doctrine, third application —
// OGS revenue and Brixmor dividends are the first two). A 10-Q carries prior-period facts that
// already exist in companyfacts: before a single new fact is admitted, every overlapping
// (tag, unit, period) pair must agree — at least ten of them, each to the dollar. A parse error,
// a scale slip or a generator quirk cannot pass that test by accident; a document that proves
// itself on its comparatives is then trusted for the one period companyfacts lacks. Facts are
// only ever APPENDED where companyfacts is silent, never overridden, so the merge no-ops itself
// out of existence as the upstream API catches up.
//
// Scope, deliberately narrow: 10-K/10-Q (and amendments) no older than 45 days; undimensioned
// contexts only (companyfacts' own scope — a context carrying any explicit or typed member is
// skipped); us-gaap and dei numeric facts in USD, shares or pure units. Anything outside that
// shape is refused, never guessed at.

async function getText(url, headers) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1000 * attempt)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// The latest periodic filing in a submissions payload: form, accession, dates, or null.
export function latestPeriodicFiling(sub) {
  const r = sub?.filings?.recent;
  if (!r?.form?.length) return null;
  for (let i = 0; i < r.form.length; i++) {
    const form = r.form[i];
    if (form !== "10-K" && form !== "10-Q" && form !== "10-K/A" && form !== "10-Q/A") continue;
    return {
      form,
      accn: r.accessionNumber[i],
      filed: r.filingDate[i],
      reportDate: r.reportDate[i] || null,
    };
  }
  return null;
}

// The newest period end companyfacts carries from any 10-K/10-Q, across every us-gaap tag — the
// fact that says how current the API's view of this filer is.
export function maxPeriodicEnd(facts) {
  let max = "";
  const g = facts?.facts?.["us-gaap"] || {};
  for (const tag of Object.keys(g)) {
    for (const arr of Object.values(g[tag]?.units || {})) {
      for (const u of arr || []) {
        if (!u.form || !u.form.startsWith("10-")) continue;
        if (u.end && u.end > max) max = u.end;
      }
    }
  }
  return max || null;
}

// Parse the extracted XBRL instance into companyfacts-shaped fact arrays.
// Returns { "us-gaap": { Tag: { units: { USD: [facts] } } }, "dei": {...} } plus the document's
// fiscal focus, or throws on a shape it does not understand.
export function parseInstance(xml, { form, filed, accn }) {
  // Namespace prefixes, from the document's own declarations — never assumed.
  const nsToPrefix = {};
  for (const m of xml.matchAll(/xmlns:([A-Za-z0-9_.-]+)="([^"]+)"/g)) nsToPrefix[m[2]] = m[1];
  const prefixFor = (needle) => {
    for (const [ns, p] of Object.entries(nsToPrefix)) if (ns.includes(needle)) return p;
    return null;
  };
  const gaapP = prefixFor("fasb.org/us-gaap");
  const deiP = prefixFor("xbrl.sec.gov/dei");
  if (!gaapP) throw new Error("no us-gaap namespace declared");

  // Contexts: id -> {start, end} (durations) or {end} (instants); dimensioned contexts are
  // dropped, mirroring companyfacts' own scope.
  const contexts = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?context id="([^"]+)">([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const [, id, body] = m;
    if (/explicitMember|typedMember/.test(body)) continue;
    const instant = body.match(/<(?:xbrli:)?instant>([0-9-]+)<\/(?:xbrli:)?instant>/);
    if (instant) { contexts[id] = { end: instant[1] }; continue; }
    const start = body.match(/<(?:xbrli:)?startDate>([0-9-]+)<\/(?:xbrli:)?startDate>/);
    const end = body.match(/<(?:xbrli:)?endDate>([0-9-]+)<\/(?:xbrli:)?endDate>/);
    if (start && end) contexts[id] = { start: start[1], end: end[1] };
  }

  // Units: id -> USD | shares | pure. Ratio units (per-share) and everything else are skipped.
  const units = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?unit id="([^"]+)">([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const [, id, body] = m;
    if (/divide/i.test(body)) continue;
    if (/iso4217:USD/i.test(body)) units[id] = "USD";
    else if (/>\s*(?:xbrli:)?shares\s*</i.test(body)) units[id] = "shares";
    else if (/>\s*(?:xbrli:)?pure\s*</i.test(body)) units[id] = "pure";
  }

  // The document's fiscal focus, for the fy/fp fields the annual pickers read on 10-K facts.
  const fyM = xml.match(new RegExp(`<${deiP}:DocumentFiscalYearFocus[^>]*>\\s*(\\d{4})\\s*<`));
  const fpM = xml.match(new RegExp(`<${deiP}:DocumentFiscalPeriodFocus[^>]*>\\s*(FY|Q1|Q2|Q3|Q4)\\s*<`));
  const docFy = fyM ? Number(fyM[1]) : null;
  const docFp = fpM ? fpM[1] : null;

  // Facts: `<prefix:Tag contextRef=... unitRef=...>value</prefix:Tag>`, numeric, not nil. The
  // `decimals` attribute is the fact's own declared precision (−5 = rounded to the hundred-
  // thousand) and travels with it: the corroboration gate compares at THAT precision, because a
  // filer may re-tag last year's exact 9,904,000 as this document's rounded 9,900,000 — the same
  // figure at its own printed rounding, which is agreement, not disagreement (Rambus's June-2026
  // 10-Q does exactly this to every comparative).
  const out = { "us-gaap": {}, dei: {} };
  let count = 0;
  const factRe = new RegExp(`<(${gaapP}${deiP ? `|${deiP}` : ""}):([A-Za-z0-9]+)((?:\\s+[^>]*?)?)>([^<]*)<\\/\\1:\\2>`, "g");
  for (const m of xml.matchAll(factRe)) {
    const [, prefix, tag, attrs, raw] = m;
    if (/xsi:nil="true"/.test(attrs)) continue;
    const ctxM = attrs.match(/contextRef="([^"]+)"/);
    const unitM = attrs.match(/unitRef="([^"]+)"/);
    if (!ctxM || !unitM) continue;
    const ctx = contexts[ctxM[1]];
    const unit = units[unitM[1]];
    if (!ctx || !unit) continue;
    const txt = raw.trim();
    if (!/^-?\d+(\.\d+)?$/.test(txt)) continue;
    const decM = attrs.match(/decimals="(-?\d+|INF)"/i);
    const decimals = decM ? (decM[1].toUpperCase() === "INF" ? Infinity : Number(decM[1])) : null;
    const ns = prefix === gaapP ? "us-gaap" : "dei";
    const fact = {
      ...(ctx.start ? { start: ctx.start } : {}),
      end: ctx.end,
      val: Number(txt),
      accn,
      fy: docFy,
      fp: docFp,
      form,
      filed,
      ...(decimals != null ? { _dec: decimals } : {}),
    };
    const slot = ((out[ns][tag] ||= { units: {} }).units[unit] ||= []);
    slot.push(fact);
    count++;
  }
  if (!count) throw new Error("no undimensioned numeric facts parsed");
  return { facts: out, count };
}

// The corroboration gate and the append. Mutates `facts` (the companyfacts payload) only where the
// document proves itself; returns a small report either way.
//
// The gate is TAG-LEVEL (refined 2026-07-29, same day, on the first live cohort): filings routinely
// RESTATE a few of their prior-year comparatives — Cadence reclassified other-nonoperating income,
// Carrier revised its acquisition-cost lines — and a document-level refusal over one restated
// minor line was holding back the revenue and cash flow lines that agreed to the dollar. So each
// tag earns admission on its own comparatives: every overlap agreeing (at the filing fact's own
// declared precision) admits that tag's new facts; a single disagreement holds that tag back for
// companyfacts to arbitrate. Two document-level floors stay: at least ten agreeing overlaps
// overall (a document that shares almost nothing with the record proves nothing), and no more
// than a fifth of overlapping tags in disagreement (a filing restating that much of itself is a
// re-baselining nothing should be read out of early).
export function mergeFilingFacts(facts, parsed, { minOverlap = 10, maxDisagreeShare = 0.2 } = {}) {
  const g = facts?.facts;
  if (!g) return { merged: 0, refused: "no companyfacts payload" };
  const key = (u) => `${u.start || ""}|${u.end}`;
  // The floor counts UNIQUE (tag, unit, period) agreements: Workiva tags the same figure up to
  // four times in same-period contexts (Ford: 204 raw overlaps, 171 unique), and a sparse
  // document must not clear a ten-fact floor on duplicates of three facts.
  const overlapKeys = new Set();
  const overlapTags = new Set();
  const disagreeTags = new Set();
  const examples = [];
  for (const ns of ["us-gaap", "dei"]) {
    for (const [tag, node] of Object.entries(parsed.facts[ns] || {})) {
      const have = g[ns]?.[tag]?.units || {};
      for (const [unit, arr] of Object.entries(node.units)) {
        const existing = new Map((have[unit] || []).map((u) => [key(u), u.val]));
        for (const f of arr) {
          if (!existing.has(key(f))) continue;
          overlapKeys.add(`${ns}:${tag}|${unit}|${key(f)}`);
          overlapTags.add(`${ns}:${tag}`);
          const a = existing.get(key(f)), b = f.val;
          // Agreement at the filing fact's own declared precision: decimals="-5" means the filer
          // printed this figure rounded to the hundred-thousand, and the exact value already in
          // companyfacts must round TO it. Never looser than the fact's own declaration.
          const halfStep = f._dec != null && f._dec < 0 ? Math.pow(10, -f._dec) / 2 : 0.5;
          if (Math.abs(b - a) > Math.max(1e-5 * Math.abs(a), halfStep)) {
            disagreeTags.add(`${ns}:${tag}`);
            if (examples.length < 3) examples.push(`${tag} ${key(f)}: companyfacts ${a} vs filing ${b}`);
          }
        }
      }
    }
  }
  const overlaps = overlapKeys.size;
  if (overlaps < minOverlap) return { merged: 0, overlaps, refused: `only ${overlaps} overlapping facts — the document cannot prove itself` };
  if (disagreeTags.size > maxDisagreeShare * overlapTags.size) {
    return { merged: 0, overlaps, refused: `${disagreeTags.size} of ${overlapTags.size} overlapping tags restate their comparatives (${examples.join("; ")}) — a re-baselining, left for companyfacts` };
  }

  let merged = 0;
  for (const ns of ["us-gaap", "dei"]) {
    for (const [tag, node] of Object.entries(parsed.facts[ns] || {})) {
      if (disagreeTags.has(`${ns}:${tag}`)) continue; // the restated tags wait for the API
      g[ns] ||= {};
      const target = (g[ns][tag] ||= { units: {} });
      for (const [unit, arr] of Object.entries(node.units)) {
        // The instance tags many figures TWICE — exact on the statement face, rounded in a note
        // (Rambus's tax expense: 11,884,000 beside 11,900,000 at decimals −5). companyfacts keeps
        // the precise one, so the merge does the same: per period, the fact with the finest
        // declared precision wins; an undeclared precision loses to any declared one.
        const best = new Map();
        for (const f of arr) {
          const k = key(f);
          const prev = best.get(k);
          if (!prev || (f._dec ?? -Infinity) > (prev._dec ?? -Infinity)) best.set(k, f);
        }
        const slot = (target.units[unit] ||= []);
        const existing = new Set(slot.map((u) => key(u)));
        for (const f of best.values()) {
          if (existing.has(key(f))) continue;
          const { _dec, ...clean } = f; // keep merged facts companyfacts-shaped
          slot.push(clean);
          existing.add(key(f));
          merged++;
        }
      }
    }
  }
  return { merged, overlaps, held: disagreeTags.size ? `${disagreeTags.size} restated tag(s) held back (${examples[0] || ""})` : null };
}

// The whole move, called per company from the fetch loop: does the latest periodic filing
// postdate everything companyfacts knows? Then fetch its instance, corroborate, append.
// Failures warn and return null — a freshness patch must never break the base extraction.
export async function freshFilingMerge(facts, sub, cik, { headers, warn = () => {}, maxAgeDays = 45 } = {}) {
  try {
    const filing = latestPeriodicFiling(sub);
    if (!filing || !filing.reportDate) return null;
    const ageDays = (Date.now() - new Date(filing.filed).getTime()) / 86400000;
    if (ageDays > maxAgeDays) return null;
    const covered = maxPeriodicEnd(facts);
    if (covered && covered >= filing.reportDate) return null; // companyfacts is current — the usual case

    const accnNoDash = filing.accn.replace(/-/g, "");
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}`;
    const idx = JSON.parse(await getText(`${base}/index.json`, headers));
    const inst = (idx?.directory?.item || []).find((it) => /_htm\.xml$/.test(it.name));
    if (!inst) { warn(`fresh filing ${filing.accn}: no extracted XBRL instance in the filing directory`); return null; }
    const xml = await getText(`${base}/${inst.name}`, headers);
    const parsed = parseInstance(xml, { form: filing.form, filed: filing.filed, accn: filing.accn });
    const res = mergeFilingFacts(facts, parsed);
    if (res.refused) { warn(`fresh filing ${filing.accn} refused: ${res.refused}`); return null; }
    if (res.held) warn(`fresh filing ${filing.accn}: ${res.held}`);
    return { ...res, form: filing.form, reportDate: filing.reportDate, accn: filing.accn };
  } catch (err) {
    warn(`fresh-filing merge failed (${err.message}) — extraction continues on companyfacts alone`);
    return null;
  }
}
