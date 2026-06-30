// The discovery layer — "Find." Not a screener with fifty sliders (the opposite of how Graham, Buffett
// and Munger worked) but a small set of NAMED LENSES, each a real GBM test that teaches as it filters. The
// division of labour keeps the whole thing true to the no-price-feed doctrine: a lens finds the businesses
// worth pricing using only price-INDEPENDENT quality (balance sheet, returns, durability, candor, accounting
// integrity); the company page does the pricing, where the reader brings the price. So every lens is a
// factual membership in a test ("these clear Graham's defensive criteria"), ranked on the lens's own
// business figure — never on "attractiveness," never with a return or a recommendation. Present, never
// pronounce. The computations reuse the same libraries the company page already runs, so a lens can never
// disagree with the page it links to.
import { currentPosition } from "./currentPosition.mjs";
import { grahamTests } from "./graham.mjs";
import { capitalHistory } from "./capital.mjs";
import { forensicScreen, fmtMoney } from "./fundamentals.mjs";

const safe = (fn, c) => {
  try {
    return fn(c);
  } catch {
    return null;
  }
};
const pctStr = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const SYM = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", AUD: "A$", CHF: "CHF " };
// A per-share figure keeps its cents (NCAV/share is the number the reader sets against the price they bring,
// so $2.40 must not round to $2). Distinct from fmtMoney, which renders billions.
const perShareStr = (v, cur = "USD") => {
  const s = SYM[cur] || "";
  return s ? `${s}${v.toFixed(2)}` : `${v.toFixed(2)} ${cur}`;
};

// The per-company facts each lens reads, computed once per company (the heavy library calls run a single
// time, then every lens derives its verdict from this). Null-tolerant throughout: a company missing the
// inputs for a lens is simply absent from it, never shown as failing.
function companyFacts(company, langMap) {
  const cur = company.ttm?.lines || company.lines || {};
  const shares = cur.sharesDiluted ?? company.lines?.sharesDiluted ?? null;
  const ta = company.lines?.totalAssets ?? null;
  const cp = safe(currentPosition, company);
  const g = safe(grahamTests, company);
  const cap = safe(capitalHistory, company);
  const f = safe(forensicScreen, company);
  const lang = langMap?.[company.ticker] || null;
  const cd = lang?.mdna?.candor || null;
  const integrity = lang?.buffettRead?.integrity || null;
  const ncav = cp?.ncav ?? null;
  return { company, shares, ta, cp, g, cap, f, cd, integrity, ncav };
}

// ---- the lenses ----
// Each lens: identity + the teaching copy (principle, a real GBM line, the precise test), a `group` (which
// of the three the lens belongs to), and `pick(facts)` returning the display figure + a numeric `sort` when
// the company is a member, or null when it is not. `positive` marks the lenses that count toward the
// Confluence (Handle-with-care is a caution, not a virtue, so it is excluded from the agreement count).
export const LENSES = [
  {
    key: "compounders",
    group: "buffett",
    title: "Compounders",
    tagline: "Each dollar retained that came back as more owner earnings.",
    principle:
      "Buffett's one-dollar test: a company should keep earnings rather than pay them out only when each retained dollar creates at least a dollar of value. Run here on owner earnings instead of market price — no price needed — by asking how much annual owner earnings grew for every dollar the business kept.",
    quote:
      "Unrestricted earnings should be retained only when there is a reasonable prospect that for every dollar retained, at least one dollar of market value will be created for owners.",
    quoteWho: "Warren Buffett, 1984 letter",
    test: "Owner earnings (first three years of the record vs. the last three) grew by $0.40 to $1.50 for every dollar the company retained rather than paid out. The upper bound is deliberate: a ratio far above that is a small-denominator artifact, not a compounder, so it is withheld rather than shown as a fiction.",
    positive: true,
    pick(F) {
      const r = F.cap?.returnOnRetained;
      if (r == null || r < 0.4 || r > 1.5) return null;
      return { sort: r, figure: `$${r.toFixed(2)} more annual owner earnings per $1 retained` };
    },
  },
  {
    key: "defensive",
    group: "graham",
    title: "The defensive checklist",
    tagline: "Clears most of Graham's criteria for the defensive investor.",
    principle:
      "Graham's seven tests for the defensive investor (The Intelligent Investor, ch. 14): adequate size, a strong current ratio, debt within working capital, an unbroken earnings record, a dividend record, and earnings growth over the decade. Passing them is a floor of safety, not a buy signal — and many fine modern businesses fail his strictest liquidity tests by design.",
    quote:
      "The defensive investor must confine himself to the shares of important companies with a long record of profitable operations and in strong financial condition.",
    quoteWho: "Benjamin Graham, The Intelligent Investor",
    test: "Passes at least five of the criteria the record can test (the price-based test is left to the company page, where you bring the price).",
    positive: true,
    pick(F) {
      const g = F.g;
      if (!g || g.testable < 5 || g.passes < 5) return null;
      return { sort: g.passes + g.passes / (g.testable + 1), figure: `passes ${g.passes} of ${g.testable} testable criteria` };
    },
  },
  {
    key: "net-nets",
    group: "graham",
    title: "Net-net candidates",
    tagline: "Current assets alone cover every liability, with money left over.",
    principle:
      "Graham's net current asset value: subtract ALL liabilities from current assets alone — ignoring the factories, the brands, the goodwill — and see what's left for the owner. When that figure is positive, the business could in principle pay off everything it owes from its liquid assets and still have value in your hands. Whether it's an actual net-net depends on the price you bring.",
    quote:
      "We feel on very safe ground when buying at a price two-thirds or less of net current asset value.",
    quoteWho: "Benjamin Graham",
    test: "Net current asset value (current assets minus every liability, from the latest annual balance sheet) is positive and at least a tenth of the whole balance sheet. Ranked by how strong that cushion is.",
    positive: true,
    pick(F) {
      // Compute NCAV and the cushion from ONE coherent balance sheet (the latest annual lines), so the
      // numerator and denominator can't drift apart and report an impossible >100% cushion. Total
      // liabilities = total assets − equity. Incoherent sheets (current or equity above total assets, a
      // negative liability) are withheld, not clamped.
      const L = F.company.lines || {};
      const { currentAssets: ca, totalAssets: ta, stockholdersEquity: eq } = L;
      if (ca == null || ta == null || eq == null || !(ta > 0)) return null;
      if (ca > ta * 1.02 || eq > ta) return null;
      const totLiab = ta - eq;
      if (totLiab < 0) return null;
      const ncav = ca - totLiab;
      const cushion = ncav / ta;
      if (ncav <= 0 || cushion < 0.1 || cushion > 1.001) return null;
      const cur = F.company.currency || "USD";
      const perShare = F.shares && F.shares > 0 ? `${perShareStr(ncav / F.shares, cur)}/share` : `${fmtMoney(ncav, cur)} total`;
      return { sort: cushion, figure: `NCAV ${perShare} · cushion ${pctStr(cushion)} of assets` };
    },
  },
  {
    key: "owner-minded",
    group: "buffett",
    title: "Owner-minded managements",
    tagline: "Talks to owners plainly — no sales pitch, no steering past GAAP.",
    principle:
      "Buffett reads a report for how management talks to its owners: does it reason in per-share value and returns, or sell? Does it let the GAAP numbers stand, or keep steering you to its own adjusted figures? This lens surfaces the filings whose MD&A leans on an owner's vocabulary, reaches for no promoter's superlatives, and stays faithful to GAAP.",
    quote:
      "We will be candid in our reporting to you, emphasizing the pluses and minuses important in appraising business value.",
    quoteWho: "Warren Buffett, Owner's Manual",
    test: "The MD&A uses an owner's vocabulary, carries little or no promotional language, and does not lean on non-GAAP measures.",
    positive: true,
    pick(F) {
      const c = F.cd;
      if (!c) return null;
      const owner = c.owner || 0, promo = c.promo || 0, adjusted = c.adjusted || 0;
      if (owner < 2 || promo > 0.2 || adjusted > 0.5) return null;
      return { sort: owner - promo, figure: "owner's vocabulary, plainspoken, GAAP-faithful" };
    },
  },
  {
    key: "handle-with-care",
    group: "munger",
    title: "Handle with care",
    tagline: "Tripped a test GBM used to AVOID — understand why before going further.",
    principle:
      "Munger's inversion: invert, always invert — to find what to seek, study what to avoid. This is the only lens that surfaces a caution rather than a quality. It collects the filings that tripped a red flag: earnings running ahead of the cash behind them, a restatement or a control weakness, owners diluted year after year, or a report that sells hard and steers past GAAP. Not a verdict, and not a short list — a place to read harder before anything else.",
    quote: "All I want to know is where I'm going to die, so I'll never go there.",
    quoteWho: "Charlie Munger",
    test: "Tripped at least one: a restatement or material weakness (the gravest, from the filing itself), earnings running ahead of the cash behind them (corroborated by both the accrual and Beneish reads, not one alone), the share count more than doubled over the record, or heavy promotional AND off-GAAP language together.",
    positive: false,
    pick(F) {
      // Severity-weighted, and deliberately selective: the grave, filing-stated tells (a restatement, a
      // control weakness) weigh most; the forensic flag fires only when corroborated, so a benign accrual
      // (a homebuilder's inventory) doesn't trip it; dilution must be egregious, not the ordinary issuance
      // every growing company does. Each flag carries a weight so the gravest, most-flagged names rank first.
      const flags = [];
      let weight = 0;
      if (F.integrity?.materialWeakness) { flags.push("material weakness"); weight += 3; }
      if (F.integrity?.restatement) { flags.push("restatement"); weight += 3; }
      const fcorr = F.f && ((F.f.mElevated && F.f.accrualTC > 0.02) || F.f.accrualTC > 0.05);
      if (fcorr) { flags.push("earnings ahead of cash"); weight += 2; }
      if (F.cap?.shareChange != null && F.cap.shareChange >= 1.0) { flags.push(`share count +${pctStr(F.cap.shareChange)}`); weight += 1; }
      if ((F.cd?.promo || 0) >= 0.8 && (F.cd?.adjusted || 0) >= 4.8) { flags.push("sells hard, steers past GAAP"); weight += 1; }
      if (!flags.length) return null;
      return { sort: weight + flags.length / 100, figure: flags.join(" · ") };
    },
  },
];

export const LENS_BY_KEY = Object.fromEntries(LENSES.map((l) => [l.key, l]));
export const GROUP_LABEL = { graham: "Through Graham's eyes", buffett: "Through Buffett's eyes", munger: "Through Munger's eyes" };
export const GROUP_SUB = {
  graham: "The floor of safety, and value you can verify from the balance sheet.",
  buffett: "The compounding machine — quality, returns, and a management that talks straight.",
  munger: "Invert. Study what to avoid.",
};

// Compute every lens over the whole universe, once. Memoized globally for the build: the hub, each lens
// page, and the per-company lens-trail all call this — every company page spreads its own `allCompanies`
// array, so keying the cache on the argument would recompute the whole universe thousands of times. The
// dataset is always the same canonical set, so the first call wins and the heavy pass runs a single time.
let _cache = null;
export function computeLenses(companies, langMap) {
  if (_cache) return _cache;
  // Per-lens member lists and a per-ticker membership index (for the Confluence and the company-page trail).
  const byLens = Object.fromEntries(LENSES.map((l) => [l.key, []]));
  const byTicker = {};
  for (const company of companies || []) {
    const tk = String(company.ticker || "").toUpperCase();
    if (!tk) continue;
    const F = companyFacts(company, langMap);
    const cleared = [];
    for (const lens of LENSES) {
      const hit = lens.pick(F);
      if (!hit) continue;
      byLens[lens.key].push({ ticker: tk, name: company.name || "", figure: hit.figure, sort: hit.sort });
      cleared.push(lens.key);
    }
    if (cleared.length) byTicker[tk] = cleared;
  }
  for (const key of Object.keys(byLens)) byLens[key].sort((a, b) => b.sort - a.sort);

  // The Confluence: companies clearing two or more INDEPENDENT positive lenses. The count is a count of
  // memberships, explicitly not a rating. A company can also carry a caution; we surface that alongside,
  // because a net-net that also trips the forensic screen is exactly what a reader needs to see.
  const positiveKeys = new Set(LENSES.filter((l) => l.positive).map((l) => l.key));
  const confluence = [];
  for (const [tk, cleared] of Object.entries(byTicker)) {
    const pos = cleared.filter((k) => positiveKeys.has(k));
    if (pos.length < 2) continue;
    confluence.push({
      ticker: tk,
      name: (byLens[pos[0]].find((r) => r.ticker === tk)?.name) || "",
      lenses: pos,
      caution: cleared.includes("handle-with-care"),
      sort: pos.length,
    });
  }
  confluence.sort((a, b) => b.sort - a.sort || a.ticker.localeCompare(b.ticker));

  _cache = { byLens, byTicker, confluence };
  return _cache;
}
