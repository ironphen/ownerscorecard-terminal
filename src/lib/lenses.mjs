// The discovery layer — "Archetypes." A small set of business types, each defined by a test verifiable from
// the filings. Membership uses only price-INDEPENDENT quality (balance sheet, returns, durability, candor,
// accounting integrity); the company page does the pricing, where the reader brings the price. Each entry is
// a factual membership in a test, ranked on the test's own figure — never on "attractiveness," never a
// return or a recommendation. The computations reuse the same libraries the company page runs, so an
// archetype can never disagree with the page it links to.
import { currentPosition } from "./currentPosition.mjs";
import { grahamTests } from "./graham.mjs";
import { capitalHistory } from "./capital.mjs";
import { forensicScreen, fmtMoney, roicValue, operatingMargin, cashPosition, grossMargin, ownerEarningsAbs } from "./fundamentals.mjs";
import { classify } from "./archetype.mjs";

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
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : null);
const profitableMost = (H) => {
  const ni = H.map((h) => h.lines.netIncome).filter((v) => v != null);
  return ni.length >= 4 && ni.filter((v) => v > 0).length / ni.length >= 0.7;
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

  // A wide operating margin and a net-cash balance sheet are OPERATING-company concepts: for a bank, an
  // insurer or a REIT they are category errors (a bank's "operating margin" and "net cash" mean nothing
  // like a manufacturer's), and they're what polluted these lists with financials reading 137% margins.
  // The company page already withholds these reads from financials; the lenses follow the same line.
  const cls = safe(classify, company);
  const isFin = !!cls && ["financial", "reit"].includes(cls.sector?.key);
  const H = (company.history || []).filter((h) => h?.lines?.revenue != null);

  // Durable economics: a wide through-cycle operating margin AND a high return on capital in most years
  // (the moat signature). roicValue self-guards (it declines an unknowable or inflated base), so a year it
  // can't read is simply not counted; an implausible median margin above 60% is a mis-tagged top line, not
  // a moat, so it's withheld.
  let durable = null;
  if (!isFin && H.length >= 4) {
    const medOM = median(H.map((h) => operatingMargin(h.lines)).filter((v) => v != null));
    const roics = H.map((h) => roicValue(h.lines)).filter((v) => v != null);
    if (medOM != null && medOM >= 0.15 && medOM <= 0.6 && roics.length >= 3) {
      const hiRoic = roics.filter((r) => r >= 0.15).length;
      if (hiRoic / roics.length >= 0.7) durable = { medOM, hiRoic, nRoic: roics.length };
    }
  }

  // Fortress balance sheet: net cash (cash + short-term investments exceed all debt) behind a durably
  // profitable record. cashPosition reads tone "good" only when net cash and the debt is reliably captured,
  // so an under-tagged balance sheet can never read as a fictional fortress; a net-cash cushion above 90%
  // of all assets is a cash shell or a corrupt asset base, not an operating fortress, so it's withheld.
  let fortress = null;
  const cpos = !isFin ? safe(cashPosition, company) : null;
  if (cpos && cpos.tone === "good" && profitableMost(H)) {
    const Lc = company.lines || {};
    const netCash = (Lc.cashAndEquivalents || 0) + (Lc.shortTermInvestments || 0) - (Lc.totalDebt || 0);
    const ratio = Lc.totalAssets > 0 ? netCash / Lc.totalAssets : null;
    if (netCash > 0 && ratio != null && ratio <= 0.9) fortress = { label: cpos.label, ratio };
  }

  // Gross profitability (Novy-Marx): gross profit as a share of total assets — the quality signal a wide
  // margin alone misses (a fat margin on a bloated asset base is not gross profit working its capital
  // hard). Median through the record; a gross margin outside a plausible band is a mis-tagged or missing
  // cost line, so that year is not counted.
  let grossProf = null;
  if (!isFin && H.length >= 4) {
    const gpas = [];
    for (const h of H) {
      const L2 = h.lines, gm = grossMargin(L2);
      if (gm == null || gm <= 0.05 || gm >= 0.95 || !(L2.revenue > 0) || !(L2.totalAssets > 0)) continue;
      gpas.push((gm * L2.revenue) / L2.totalAssets);
    }
    if (gpas.length >= 3) { const m = median(gpas); if (m != null && m >= 0.4) grossProf = { gpa: m }; }
  }

  // Capital-light compounding: owner earnings that grew faster than the asset base behind them — growth
  // that doesn't gorge on capital (the mirror of the asset-growth anomaly). Owner earnings must have grown
  // from a positive base, on total assets rising no more than 8% a year.
  let capitalLight = null;
  if (!isFin && H.length >= 5) {
    const span = (H[H.length - 1].fy ?? 0) - (H[0].fy ?? 0);
    const taFirst = H[0]?.lines?.totalAssets;
    const taLast = company.lines?.totalAssets ?? H[H.length - 1]?.lines?.totalAssets;
    const oeMed = (hs) => { const xs = hs.map((h) => ownerEarningsAbs(h.lines, company)).filter((v) => v != null); return xs.length ? median(xs) : null; };
    const oeFirst = oeMed(H.slice(0, 3)), oeLast = oeMed(H.slice(-3));
    if (span >= 4 && taFirst > 0 && taLast > 0 && oeFirst != null && oeFirst > 0 && oeLast != null && oeLast > oeFirst) {
      const assetCAGR = Math.pow(taLast / taFirst, 1 / span) - 1;
      const oeCAGR = Math.pow(oeLast / oeFirst, 1 / span) - 1;
      if (assetCAGR <= 0.08 && oeCAGR > assetCAGR) capitalLight = { assetCAGR, oeCAGR };
    }
  }

  // Cash-backed earnings (the positive side of Sloan's accrual signal): operating cash at or above
  // reported profit across the record — earnings that show up as cash, not accruals. The opposite of the
  // red-flags accrual test. Only profitable years count toward the ratio.
  let cashBacked = null;
  if (!isFin && profitableMost(H)) {
    const ratios = [];
    for (const h of H) {
      const ni = h.lines.netIncome, cfo = h.lines.cashFromOps;
      if (ni != null && cfo != null && ni > 0) ratios.push(cfo / ni);
    }
    if (ratios.length >= 4) { const m = median(ratios); if (m != null && m >= 1.05) cashBacked = { ratio: m }; }
  }

  return { company, shares, ta, cp, g, cap, f, cd, integrity, ncav, durable, fortress, grossProf, capitalLight, cashBacked };
}

// ---- the archetypes ----
// Each entry: identity, a one-line description, the precise test, the `group` it sits under, and
// `pick(facts)` returning the display figure + a numeric `sort` when the company is a member, else null.
// `positive` marks the archetypes that count toward the Confluence (the flags do not). Copy stays factual:
// what the test measures and what trips it, never a verdict.
export const LENSES = [
  {
    key: "compounders",
    group: "buffett",
    title: "Compounders",
    tagline: "Each retained dollar that came back as more owner earnings.",
    principle:
      "How much annual owner earnings grew for each dollar the business retained instead of paying out. Measured on owner earnings, so no market price is needed.",
    test: "Owner earnings (first three years of the record vs. the last three) grew $0.40–$1.50 for every dollar retained. Above that band the ratio is a small-denominator artifact and is withheld.",
    positive: true,
    pick(F) {
      const r = F.cap?.returnOnRetained;
      if (r == null || r < 0.4 || r > 1.5) return null;
      return { sort: r, figure: `$${r.toFixed(2)} more annual owner earnings per $1 retained` };
    },
  },
  {
    key: "durable",
    group: "buffett",
    title: "Durable economics",
    tagline: "Wide margins held through the cycle, on capital that earns its keep.",
    principle:
      "A wide operating margin sustained across the cycle, and a high return on the capital employed — pricing power that holds, not one good year.",
    test: "Median operating margin ≥15% through the cycle, and return on invested capital ≥15% in at least seven of every ten years it can be measured. Financials excluded; a median margin above 60% is withheld as a mis-tagged top line.",
    positive: true,
    pick(F) {
      const d = F.durable;
      if (!d) return null;
      return { sort: d.medOM, figure: `operating margin ${pctStr(d.medOM)} through the cycle · ROIC ≥15% in ${d.hiRoic} of ${d.nRoic} yrs` };
    },
  },
  {
    key: "fortress",
    group: "buffett",
    title: "Fortress balance sheets",
    tagline: "More cash than debt, behind a durably profitable business.",
    principle:
      "Cash and short-term investments above all debt, behind a record that has made money. Net cash leaves the business beholden to no lender — a bad year or a closed credit window can't force its hand.",
    test: "Net cash, behind a record profitable in at least seven of every ten years. Financials excluded; a cushion above 90% of assets is withheld as a shell or corrupt data. Ranked by cushion strength.",
    positive: true,
    pick(F) {
      const f = F.fortress;
      if (!f) return null;
      return { sort: f.ratio, figure: `${f.label} · ${pctStr(f.ratio)} of assets in net cash` };
    },
  },
  {
    key: "defensive",
    group: "graham",
    title: "The defensive checklist",
    tagline: "Size, liquidity, debt, an unbroken earnings and dividend record.",
    principle:
      "The price-independent defensive-investor tests: adequate size, a current ratio of two, debt within working capital, an unbroken earnings record, a paid dividend, and a decade of growth. A floor of safety, not a buy signal.",
    test: "Clears at least five of the testable criteria. The price test is left to the company page, where you bring the price.",
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
      "Net current asset value — current assets minus every liability, ignoring plant and goodwill. Positive means liquid assets alone could clear all debt with something left for the owner. Whether it trades below that is for the price you bring.",
    test: "Net current asset value (latest annual balance sheet) is positive and at least a tenth of total assets. Ranked by cushion strength.",
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
    tagline: "Reports plainly — an owner's vocabulary, no sales pitch, no steering past GAAP.",
    principle:
      "The MD&A reasons in per-share value and returns, carries little or no promotional language, and leans on no non-GAAP measures.",
    test: "Owner's vocabulary present, promotional language minimal, no reliance on non-GAAP figures.",
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
    key: "gross-profitability",
    group: "buffett",
    title: "High gross profitability",
    tagline: "Gross profit that works the whole asset base hard, not just a fat headline margin.",
    principle:
      "Gross profit as a share of total assets — the quality signal a margin alone misses. A wide margin on a bloated asset base is not the same as gross profit that earns its keep on the capital employed. Price-independent, from the record.",
    test: "Median gross profit ÷ total assets ≥40% through the record. Financials excluded; a gross margin outside a plausible band is withheld as a mis-tagged cost line.",
    positive: true,
    pick(F) {
      const g = F.grossProf;
      if (!g) return null;
      return { sort: g.gpa, figure: `gross profit ${pctStr(g.gpa)} of assets through the record` };
    },
  },
  {
    key: "capital-light",
    group: "buffett",
    title: "Capital-light compounding",
    tagline: "Owner earnings grew while the asset base barely did — growth that doesn't gorge on capital.",
    principle:
      "Owner earnings that compounded faster than the assets behind them — Buffett's ideal of a business that grows without swallowing capital, and the mirror of the asset-growth anomaly (a bloating balance sheet is the warning, not the goal).",
    test: "Owner earnings grew, and grew faster than a total-asset base rising ≤8% a year, across the record. Financials excluded.",
    positive: true,
    pick(F) {
      const c = F.capitalLight;
      if (!c) return null;
      const a = `${c.assetCAGR >= 0 ? "+" : ""}${pctStr(c.assetCAGR)}`;
      return { sort: c.oeCAGR - c.assetCAGR, figure: `owner earnings +${pctStr(c.oeCAGR)}/yr on assets ${a}/yr` };
    },
  },
  {
    key: "cash-backed",
    group: "buffett",
    title: "Cash-backed earnings",
    tagline: "Operating cash has met or beaten reported profit, year after year — earnings you can bank.",
    principle:
      "Reported profit that shows up as cash rather than accruals — the positive side of the accrual signal the red-flags screen catches in reverse. Operating cash comfortably at or above net income across the record.",
    test: "Median operating cash ÷ net income ≥1.05, over profitable years, across the record. Financials excluded.",
    positive: true,
    pick(F) {
      const c = F.cashBacked;
      if (!c) return null;
      return { sort: c.ratio, figure: `operating cash ${c.ratio.toFixed(2)}× reported earnings through the record` };
    },
  },
  {
    key: "red-flags",
    group: "munger",
    title: "Red flags",
    tagline: "A restatement, a control weakness, earnings ahead of cash, or heavy dilution.",
    principle:
      "Companies that tripped an accounting-integrity or capital-structure flag. Stated as facts to read harder, not a verdict.",
    test: "Tripped at least one: a restatement or material weakness, earnings ahead of cash (on both the accrual and Beneish reads), the share count more than doubled, or heavy promotional plus off-GAAP language.",
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
export const GROUP_LABEL = { graham: "Value & safety", buffett: "Quality & durability", munger: "Flags" };
export const GROUP_SUB = {
  graham: "Asset value and balance-sheet strength, verifiable from the filings.",
  buffett: "Wide durable returns, a clean balance sheet, plain reporting.",
  munger: "Accounting and capital-structure warning signs.",
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
      caution: cleared.includes("red-flags"),
      sort: pos.length,
    });
  }
  confluence.sort((a, b) => b.sort - a.sort || a.ticker.localeCompare(b.ticker));

  _cache = { byLens, byTicker, confluence };
  return _cache;
}
