// Debt-maturity wall — the schedule of when a company's borrowings come due, read straight from the
// debt footnote of the 10-K. This is the question Graham asked first and Buffett never stops asking:
// not "how much debt?" but "when must it be paid, and against what?" A business can carry a great deal
// of debt safely if it matures far out and the cash keeps coming; a smaller load that all comes due at
// once, into a closed credit window, is how solvent companies die. So we recover the actual maturity
// ladder — what's due next year, the year after, the biggest single year, and what sits beyond five —
// and leave the judgement to the reader (the component pairs it with cash on hand and a year of owner
// earnings as the coverage an owner would weigh).
//
// The text we parse is htmlToText's flattening of the filing: the maturities table becomes a single
// space-separated run, "2026 $ 433 2027 571 … Thereafter 1,233 Total $ 5,000", with its column
// structure gone. Recovering a schedule from that is fragile, so the governing rule here is the rest
// of the product's: PRECISION OVER RECALL. Every extraction must reconcile — against the table's own
// declared total when it states one, else against the balance-sheet long-term debt — and anything that
// doesn't reconcile is withheld, never shown wrong. A blank debt-wall is a fine outcome; a wrong one
// is not. (Finance-arm companies like Ford, whose consumer-credit book dwarfs the industrial debt and
// is match-funded against receivables, have no single honest "wall" and correctly come up blank.)
//
// All monetary fields returned are in the filing's native table unit — $ millions — EXCEPT that a
// "(in billions)" table is normalised to millions on the way out. The caller converts to whole dollars.

const num = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// A caption is about debt — not leases, pensions, purchase commitments, intangibles, revenue, benefits,
// which are the look-alike "year amount year amount" ladders the same filing is full of.
// Note the absence of a trailing \b: these are word STEMS, and a trailing boundary would refuse the
// very inflections the footnotes use — "maturit" wouldn't match "maturities", "payment" wouldn't match
// "payments". The leading \b still anchors each stem to a word start.
const DEBT = /\b(long[- ]?term debt|senior notes|term debt|notes payable|principal (?:payment|maturit)|aggregate (?:annual )?(?:principal )?maturit|maturities of (?:long-term )?debt|future principal|debt maturit|debt obligation|debt repayment|long-term borrowings|debt and other notes|scheduled principal|fixed[- ]rate debt|maturities of total debt)/i;
const NOTDEBT = /\b(lease|pension|benefit|amortization|intangible|purchase oblig|unconditional|minimum rental|revenue|receivable|deposit|guarantee|contribution|repurchase)\b/i;

// Pull the amounts that follow a debt label, dropping the stray footnote-reference digits that sit
// between the label and the first "$" — e.g. AT&T's "Debt repayments 1,2 $ 8,652", where the "1,2"
// are note markers, not a 2026 figure. We anchor on the first "$" when one is close, then read the
// figures: $-amounts, an em-dash (a zero in a column), decimals, comma-grouped numbers, and bare
// integers (Boeing's "480", a sub-thousand year). A lone one- or two-digit bare token is itself a
// footnote marker and is skipped.
function amountsAfter(s, n) {
  let body = s;
  const dollar = body.search(/\$/);
  if (dollar >= 0 && dollar < 24) body = body.slice(dollar);
  const toks = body.match(/\$\s*[\d,]+(?:\.\d+)?|—|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b|\b\d+\b/g) || [];
  const out = [];
  for (const tk of toks) {
    if (out.length >= n) break;
    if (tk === "—") { out.push(0); continue; }
    const t = tk.trim();
    if (!/[$,.]/.test(t) && /^\d{1,2}$/.test(t)) continue; // bare 1-2 digit token = footnote ref
    const v = num(t);
    if (v != null) out.push(v);
  }
  return out;
}

// Layout A — interleaved, one row per year: "YEAR amount YEAR amount … [Thereafter amount] [Total amount]".
// The most common shape (Apple, CVS, Microsoft, Home Depot, Verizon, Coca-Cola, Southwest). Also the
// SEC contractual-obligations table, where each year carries extra columns — "2026 2,000 1,458 3,458"
// (debt, interest, total) — and the tail reads "After 2030 …" then "Total …"; there the FIRST amount
// per year is the debt principal, and the reconciliation gate confirms it (a wrong column won't tie out).
const COLUMNS_ONLY = /^[\s$,.():;\d—-]*$/; // between two years: only numeric columns/separators, never prose
function layoutA(text, fy) {
  const out = [];
  const pairRe = /(20[2-4]\d)\s+(\$?\s?(?:[\d,]+(?:\.\d+)?|—))(?=\s)/g;
  const pairs = []; let m;
  while ((m = pairRe.exec(text))) pairs.push({ year: +m[1], raw: m[2].trim(), amount: /—/.test(m[2]) ? 0 : num(m[2]), idx: m.index, end: pairRe.lastIndex });
  for (let i = 0; i < pairs.length; i++) {
    const run = [pairs[i]];
    for (let j = i + 1; j < pairs.length; j++) {
      const prev = run[run.length - 1];
      if (pairs[j].year !== prev.year + 1) break;
      const gap = pairs[j].idx - prev.end;
      // adjacent (single column), or separated only by this year's extra numeric columns (multi-column table)
      if (gap <= 12 || (gap <= 44 && COLUMNS_ONLY.test(text.slice(prev.end, pairs[j].idx)))) run.push(pairs[j]);
      else break;
    }
    if (run.length < 4) continue;          // a schedule is at least four consecutive years
    if (run[0].year < fy) continue;        // it starts at/after the fiscal year, never before
    if (run.some((p) => /^20[2-4]\d$/.test(p.raw))) continue; // a bare year sitting where an amount should be → not a schedule
    const cap = text.slice(Math.max(0, run[0].idx - 340), run[0].idx).replace(/\s+/g, " ");
    const tail = text.slice(run[run.length - 1].end, run[run.length - 1].end + 150);
    // Thereafter ("Thereafter" or "After 2030"), allowing the last year's extra columns to precede it,
    // but never prose — so a stray "after 2030, the company…" sentence can't be mistaken for a bucket.
    let thereafter = null, after = tail;
    const tm = tail.match(/(?:Thereafter|After\s+20\d\d)[\s—-]+(\$?\s?\d[\d,]*(?:\.\d+)?)/i); // dash: htmlToText column-break artifact ("Thereafter-$ 25,130")
    if (tm && tm.index <= 60 && COLUMNS_ONLY.test(tail.slice(0, tm.index))) { thereafter = num(tm[1]); after = tail.slice(tm.index + tm[0].length); }
    const totM = after.match(/(?:Total|Subtotal)[^$\d\n]{0,30}(\$?\s?\d[\d,]*(?:\.\d+)?)/i);
    const declaredTotal = totM && totM.index <= 60 && COLUMNS_ONLY.test(after.slice(0, totM.index)) ? num(totM[1]) : null;
    i = pairs.indexOf(run[run.length - 1]);
    out.push({ layout: "A", cap, schedule: run.map((p) => ({ year: p.year, amount: p.amount })), thereafter, declaredTotal, billions: /\(in billions\)/i.test(cap) });
  }
  return out;
}

// Layout B — years as a column header, then a debt-labelled amounts row:
// "2026 2027 2028 2029 2030 [Thereafter] [Total] [Fair Value] LABEL $a $b …" (Boeing, AT&T, GE, Comcast).
function layoutB(text, fy) {
  const out = [];
  const yhRe = /(20[2-4]\d)(?:\s+(?:20[2-4]\d)){2,5}/g; let m;
  while ((m = yhRe.exec(text))) {
    const years = m[0].trim().split(/\s+/).map(Number);
    if (years.some((y, i) => i > 0 && y !== years[i - 1] + 1) || years[0] < fy) continue;
    const win = text.slice(yhRe.lastIndex, yhRe.lastIndex + 380);
    const hasT = /^\s*Thereafter/i.test(win);
    const hasTot = /\bTotal\b/i.test(win.slice(0, 60));
    const hasFV = /fair value/i.test(win.slice(0, 80)); // Comcast's market-risk table carries a fair-value column after Total
    const labM = win.match(/(fixed[- ]rate debt|long-term debt maturities|debt maturit(?:y|ies)|debt obligations?|debt repayments?|debt and other notes|scheduled principal[^$\d]{0,40}|principal payments?(?:\s+(?:on|of)\s+(?:long-term\s+)?debt)?|long-term debt|term debt|total debt|notes payable)/i);
    if (!labM) continue;
    if (/lease/i.test(labM[0])) continue;
    const rest = win.slice(labM.index + labM[0].length);
    const nNum = years.length + (hasT ? 1 : 0) + (hasTot ? 1 : 0) + (hasFV ? 1 : 0);
    const amts = amountsAfter(rest, nNum);
    if (amts.length < years.length) continue;
    const cap = text.slice(Math.max(0, m.index - 240), m.index).replace(/\s+/g, " ");
    let k = years.length;
    const thereafter = hasT ? amts[k++] ?? null : null;
    const declaredTotal = hasTot ? amts[k++] ?? null : null;
    out.push({ layout: "B", cap: cap + " " + labM[0], schedule: years.map((y, i) => ({ year: y, amount: amts[i] })), thereafter, declaredTotal, billions: /\(in billions\)/i.test(cap) });
  }
  return out;
}

// The public entry point. `fy` is the fiscal year of the report (the schedule starts at fy or after);
// `totalDebtMillions` is the balance-sheet long-term debt in $ millions, used as the reconciliation
// anchor when a table states no total of its own. Returns null (withhold) when nothing reconciles.
export function extractDebtMaturity(text, fy, totalDebtMillions = null) {
  if (!text || !fy) return null;
  const cands = [...layoutA(text, fy), ...layoutB(text, fy)]
    .filter((c) => DEBT.test(c.cap) && !NOTDEBT.test(c.cap.slice(-90)) && c.schedule.every((s) => s.amount != null));
  const scored = [];
  for (const c of cands) {
    const mult = c.billions ? 1000 : 1;
    const schedule = c.schedule.map((s) => ({ year: s.year, amount: s.amount * mult }));
    const thereafter = c.thereafter != null ? c.thereafter * mult : null;
    const declaredTotal = c.declaredTotal != null ? c.declaredTotal * mult : null;
    const schedSum = schedule.reduce((a, b) => a + b.amount, 0) + (thereafter || 0);

    // Reconciliation gate — the precision guarantee:
    //  • declared total present  → sum(schedule)+thereafter must match it within 2%.
    //  • else, with a thereafter → it's a full ladder, so it should be near the balance-sheet debt (≤30%).
    //  • else (five-year-only)   → it's just the near slice of total debt: a meaningful fraction of it
    //    (≥10%), never exceeding it. This rejects the tiny unrelated ladders a finance-arm filer throws off.
    //  • no anchor at all        → trust only the richer, with-thereafter shape.
    let ok, total = declaredTotal ?? Math.round(schedSum), basis;
    if (declaredTotal != null) {
      ok = Math.abs(schedSum - declaredTotal) / declaredTotal <= 0.02; basis = "declared";
    } else if (totalDebtMillions && totalDebtMillions > 0) {
      ok = thereafter != null
        ? Math.abs(schedSum - totalDebtMillions) / totalDebtMillions <= 0.30
        : schedSum >= totalDebtMillions * 0.10 && schedSum <= totalDebtMillions * 1.15 && schedule[0].amount <= totalDebtMillions;
      basis = "balance-sheet";
    } else {
      ok = thereafter != null; basis = "summed";
    }
    if (!ok) continue;
    // Balance-sheet sanity ceiling (every basis, including a self-consistent declared total): a maturity
    // schedule sums to roughly the company's actual debt, so a total several times the balance-sheet debt
    // means the parser locked onto the wrong table — a revenue or share-count ladder on an obscure filing,
    // not the debt note. Withhold rather than emit an absurd wall (Barrick's "$413T", etc.). This matches
    // the 3× bound the believability gate enforces on the committed data, so the extractor never emits a
    // wall that gate would have to reject — turning a refresh-blocking error into a quiet, correct blank.
    if (totalDebtMillions && totalDebtMillions > 0 && total > totalDebtMillions * 3) continue;
    scored.push({ layout: c.layout, schedule, thereafter, declaredTotal, total, basis });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => (b.declaredTotal ? 1 : 0) - (a.declaredTotal ? 1 : 0) || b.total - a.total);
  const r = scored[0];
  const within2 = (r.schedule[0]?.amount || 0) + (r.schedule[1]?.amount || 0);
  const peak = r.schedule.slice().sort((a, b) => b.amount - a.amount)[0];
  return {
    layout: r.layout,
    basis: r.basis,                // declared | balance-sheet | summed — how the total was reconciled
    schedule: r.schedule,          // [{year, amount}], the per-year ladder ($ millions)
    thereafter: r.thereafter,      // due beyond the listed years, or null
    fiveYearOnly: r.thereafter == null, // true → `total` is only the near window, NOT the whole debt
    total: r.total,                // declared total, or sum of the ladder
    declaredTotal: r.declaredTotal,
    dueNextYear: r.schedule[0]?.amount ?? null,
    within2yr: within2,
    within2pct: r.total ? Math.round((within2 / r.total) * 100) : null,
    peakYear: peak?.year ?? null,
    peakAmount: peak?.amount ?? null,
  };
}
