// Durability & moat report card, turns ~10 years of filings into the judgments
// Graham (stability) and Buffett (a moat that doesn't fade, capital reinvested at
// high returns) actually rendered. Every line is computed from the record; no
// opinion is added. The centerpiece is incremental ROIC, the return earned on
// the capital the business plowed back, which separates a compounding moat from
// one that's merely being milked.

import { debtReliable, ownerEarningsAbs } from "./fundamentals.mjs";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const firstN = (arr, n) => arr.filter((x) => x != null).slice(0, n);
const lastN = (arr, n) => arr.filter((x) => x != null).slice(-n);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const avgFirst = (arr, n) => { const s = firstN(arr, n); return s.length ? mean(s) : null; };
const avgLast = (arr, n) => { const s = lastN(arr, n); return s.length ? mean(s) : null; };
const cagr = (a, b, yrs) => (a > 0 && b > 0 && yrs > 0 ? Math.pow(b / a, 1 / yrs) - 1 : null);
const pct = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);

function nopat(L) {
  if (!L || L.operatingIncome == null) return null;
  let t = 0.21;
  if (L.incomeTaxExpense != null && L.netIncome != null && L.netIncome + L.incomeTaxExpense > 0)
    t = clamp(L.incomeTaxExpense / (L.netIncome + L.incomeTaxExpense), 0, 0.5);
  return L.operatingIncome * (1 - t);
}
function invested(L) {
  if (!L || L.totalDebt == null || L.stockholdersEquity == null) return null;
  const iv = L.totalDebt + L.stockholdersEquity - (L.cashAndEquivalents || 0);
  return iv > 0 ? iv : null;
}

// Wire the filing's own words about pricing into the margin number. Pricing power is the single
// judgment Buffett calls most important in evaluating a business, and the margin trajectory alone
// only shows the result, never the cause. The company's language — does it set its price or take
// it, did a price increase hold its volume, were rising costs passed through — either corroborates
// the number, explains it, or stands in honest tension with it. The number stays the spine; the
// words make it smarter. Present, never pronounce: we reconcile the two, we never crown a moat.
// Pure: the caller (the .astro component, which can import the language JSON under Vite) passes the
// buffettRead.pricing object in, so this lib still runs under plain node. Returns a short clause and
// its tone, or null when the filing offers no pricing signal and the number must stand alone.
export function pricingReconciliation(marginDelta, pricing) {
  if (!pricing || marginDelta == null) return null;
  const { power, powerStrong, pressure, costInflation, passedThrough } = pricing;
  const dir = marginDelta > 0.02 ? "up" : marginDelta < -0.02 ? "down" : "flat";
  const contested = !!(power && pressure);

  // The strongest form Buffett names: a price increase that did not cost volume.
  if (powerStrong) {
    return dir === "up"
      ? { tone: "good", text: "The words confirm the number: the filing says price increases held their volume, and the margin widened with them — Buffett’s strongest mark of pricing power." }
      : { tone: "info", text: "The filing claims pricing power in its strongest form — price raised, volume held — yet the margin here has not widened to match. The claim leads the record; weigh them together." };
  }
  // The filing ties gains to its own pricing.
  if (power) {
    if (contested)
      return dir === "down"
        ? { tone: "warn", text: "The filing attributes gains to higher prices but names price competition too — and the margin slipped, so the pressure is winning here." }
        : { tone: "ok", text: "The filing ties gains to its own pricing, but names price competition too — pricing power that is real yet contested, not unopposed. The margin shows who is winning." };
    return dir === "up"
      ? { tone: "good", text: "The record and the words agree: the margin widened and the filing attributes the gain to its own pricing, not volume alone." }
      : { tone: "info", text: "The filing attributes gains to higher prices, but the margin in the record has not followed — the claim outruns the result here." };
  }
  // No claim of power, but the filing names price competition or cuts.
  if (pressure) {
    if (dir === "down") return { tone: "warn", text: "The words explain the slip: the filing names price competition rather than pricing actions of its own — a business that looks to take its price, not set it." };
    if (dir === "up") return { tone: "info", text: "The margin widened even though the filing names price competition — the gain came from volume or cost, not pricing power. Read where." };
    return { tone: "warn", text: "The margin has held, but the filing names price competition — the pressure is present even where the margin has absorbed it so far." };
  }
  // No pricing-power signal either way: fall back to cost pass-through, the margin-durability
  // complement, when the filing discussed input-cost inflation.
  if (costInflation && passedThrough === true && dir !== "down")
    return { tone: "good", text: "Input costs rose and the filing says it recovered them in price — consistent with the margin holding here." };
  if (costInflation && passedThrough === false && dir === "down")
    return { tone: "warn", text: "Input costs rose and the filing says it could not fully pass them on — which is where this margin compressed." };
  return null;
}

// The catalog's 90th percentiles for an owner's vocabulary (per-share value, return on capital,
// intrinsic value, free cash flow, the long term) and a promoter's (world-class, best-in-class,
// paradigm, synergies, disruptive), counted per 1,000 MD&A words. Above its own line, a register is
// as pronounced as the loudest tenth of the catalog. Relative to the catalog, the way the Candor
// Read scales its bars — never an absolute the reader must calibrate.
const OWNER_HI = 2.9, PROMO_HI = 0.8;

// Wire the language register into the durability read. Buffett and Munger read a filing for how
// management talks as much as for what it reports, and the tell sharpens against the record: a
// promoter's vocabulary sitting over a fading return is a different story than an owner's. We read
// the register only where one voice clearly dominates — heavy owner-talk and light promoter-talk, or
// the reverse — and withhold on the mixed or unremarkable middle, then set it against whether the
// business is actually compounding. The counted densities are the company's own word choices, not our
// opinion; we reconcile them with the record and hand the weight to the reader. Present, never
// pronounce. Pure: the caller passes the candor object in. Returns a value tag, tone and clause, or null.
export function registerReconciliation(trajectory, candor) {
  if (!candor || !trajectory) return null;
  const ownerHi = candor.owner != null && candor.owner >= OWNER_HI;
  const promoHi = candor.promo != null && candor.promo >= PROMO_HI;
  // Only the clear cases: one register plainly dominates. High in both, or in neither, is mixed or
  // unremarkable — we withhold rather than force a character onto the filing.
  let register;
  if (promoHi && !ownerHi) register = "promoter";
  else if (ownerHi && !promoHi) register = "owner";
  else return null;

  if (register === "promoter") {
    if (trajectory === "fading")
      return { value: "Promotional", tone: "warn", text: "The returns have faded, yet the filing reaches for a promoter’s vocabulary — world-class, best-in-class, disruptive — more than an owner’s. When the words sell harder than the results deliver, the gap is the thing to weigh." };
    if (trajectory === "compounding")
      return { value: "Promotional", tone: "info", text: "The record is compounding, but the filing leans on a promoter’s vocabulary rather than the per-share, return-on-capital terms an owner uses. The results back the talk here; the register is still worth noting." };
    return { value: "Promotional", tone: "info", text: "Results have held roughly flat while the filing leans on a promoter’s vocabulary — watch whether the words are doing work the numbers are not." };
  }
  if (trajectory === "compounding")
    return { value: "Owner’s terms", tone: "good", text: "The record and the register agree: capital is compounding and the filing reasons in an owner’s terms — per-share value, return on capital, the long term — not a promoter’s." };
  if (trajectory === "fading")
    return { value: "Owner’s terms", tone: "ok", text: "Returns have thinned, but the filing discusses it in an owner’s vocabulary rather than selling past it — candor about a hard stretch counts for more than an adjective." };
  return { value: "Owner’s terms", tone: "ok", text: "The filing reasons in an owner’s terms — per-share, return on capital, the long term — and the record has held; the words and the results are of a piece." };
}

export function moatReport(company, opts = {}) {
  const H = (company.history || []).filter((h) => h?.lines?.revenue != null);
  if (H.length < 4) return null;
  const pricing = opts.pricing || null;
  const L = H.map((h) => h.lines);
  const years = H.map((h) => h.fy);
  const span = years[years.length - 1] - years[0];
  // Skip the invested-capital facts when the debt is under-captured (Ford), or invested
  // capital and the return on it would read off a fraction of the real borrowings.
  const debtOk = debtReliable(company.lines || {}) && debtReliable(company.ttm?.lines || {});
  const facts = [];
  const add = (label, value, tone, note) => facts.push({ label, value, tone, note });
  // The record's trajectory, captured for the closing register read: the margin trend and the
  // owner-earnings growth rate, set below as they are computed.
  let marginDelta = null;

  // 1, Stability: did it ever lose money?
  const ni = L.map((x) => x.netIncome).filter((x) => x != null);
  const profitable = ni.filter((x) => x > 0).length;
  add("Profitable years", `${profitable} of ${ni.length}`,
    profitable === ni.length ? "good" : profitable >= ni.length - 1 ? "ok" : "warn",
    profitable === ni.length
      ? "Never lost money over the record, the earnings stability Graham insisted on."
      : `Lost money in ${ni.length - profitable} year(s), look at what happened there before trusting the average.`);

  // 2, Moat: does the return on capital persist?
  const roics = L.map((x) => { const iv = invested(x), np = nopat(x); return iv && np != null ? np / iv : null; }).filter((r) => r != null);
  if (debtOk && roics.length >= 3) {
    const above = roics.filter((r) => r >= 0.15).length;
    add("Return on capital ≥ 15%", `${above} of ${roics.length} yrs`,
      above >= roics.length - 1 ? "good" : above >= roics.length * 0.5 ? "ok" : "warn",
      "A moat shows up as a high return on invested capital that holds year after year, not one good vintage.");
  }

  // 3, Pricing power: where did the operating margin go? Anchored to the first
  // and last years on record (both findable in the table), not hidden averages.
  const om = L.map((x) => (x.operatingIncome != null && x.revenue ? x.operatingIncome / x.revenue : null));
  const fI = om.findIndex((v) => v != null);
  const lI = om.length - 1 - [...om].reverse().findIndex((v) => v != null);
  if (fI >= 0 && lI > fI) {
    const d = om[lI] - om[fI];
    marginDelta = d;
    const dir = d > 0.02 ? "good" : d < -0.02 ? "warn" : "ok";
    add("Operating margin", `${pct(om[fI])} (FY${years[fI]}) → ${pct(om[lI])} (FY${years[lI]})`, dir,
      d > 0.02 ? "Margins widened over the record, pricing power intact or improving."
        : d < -0.02 ? "Margins slipped over the record, competition or costs are biting in."
        : "Margins held roughly steady across the record.");
    // Bring the filing's own pricing words to the margin number, so the moat's defining
    // question reads the record and the company's language together, not in two sections.
    const recon = pricingReconciliation(d, pricing);
    if (recon) { const f = facts[facts.length - 1]; f.lang = recon.text; f.langTone = recon.tone; }
  }

  // 4, The centerpiece: incremental ROIC (what reinvested capital earned).
  const npE = avgFirst(L.map(nopat), 3), npL = avgLast(L.map(nopat), 3);
  const ivE = avgFirst(L.map(invested), 3), ivL = avgLast(L.map(invested), 3);
  if (debtOk && npE != null && npL != null && ivE != null && ivL != null) {
    const dNop = npL - npE, dInv = ivL - ivE;
    // The denominator must be both positive and meaningfully large (the base grew by more
    // than ~30%); a small or near-zero change in invested capital turns dNop/dInv into a
    // triple-digit artifact, not a moat reading. And cap the magnitude: a "200% incremental
    // ROIC" is noise dressed as a verdict, so decline it rather than print "still compounding".
    if (ivE > 0 && dInv > ivE * 0.3) {
      const inc = dNop / dInv;
      if (!Number.isFinite(inc) || Math.abs(inc) > 0.6) {
        add("Reinvestment, incremental ROIC", "—", "info",
          "The reinvested base moved too little against the change in profit to read a reliable return on it here — the figure would be a small-denominator artifact, not a moat. Judge this one on the owner-earnings record and the cash it returns instead.");
      } else {
        add("Reinvestment, incremental ROIC", pct(inc),
          inc >= 0.15 ? "good" : inc >= 0.08 ? "ok" : "warn",
          inc >= 0.15 ? "Every extra dollar the company reinvested earned a high return, it is still compounding, not coasting on an old moat."
            : inc >= 0 ? "Reinvested capital earned only a modest return, growth is getting expensive."
            : "Reinvested capital earned a negative return, the business spent money to shrink its own economics.");
      }
    } else {
      add("Reinvestment, incremental ROIC", "returns capital", "info",
        "The capital base barely grew: this business returns cash through dividends and buybacks rather than reinvesting. Judge it on the cash returned, not on compounding.");
    }
  }

  // 5, How fast did owner earnings compound? Buffett's figure (operating cash less the
  // maintenance capex), not free cash flow, so a builder's growth spending isn't read as shrinkage.
  const oe = L.map((x) => ownerEarningsAbs(x, company));
  const oeE = avgFirst(oe, 2), oeL = avgLast(oe, 2);
  const g = oeE != null && oeL != null ? cagr(oeE, oeL, span) : null;
  if (g != null) add("Owner earnings growth", `${g >= 0 ? "+" : "−"}${pct(Math.abs(g))}/yr`,
    g >= 0.1 ? "good" : g >= 0 ? "ok" : "warn",
    `Owner earnings ${g >= 0 ? "grew" : "shrank"} about ${pct(Math.abs(g))} a year over the record.`);

  // 6, Resilience: the worst year.
  let wi = -1, wv = Infinity;
  om.forEach((v, i) => { if (v != null && v < wv) { wv = v; wi = i; } });
  if (wi >= 0) add("Worst year", `${years[wi]} · ${pct(wv, 1)} op. margin`,
    wv > 0 ? "good" : "warn",
    wv > 0 ? "Stayed profitable even in its hardest year, the resilience that survives recessions."
      : `Operations went underwater in ${years[wi]}, understand why before trusting the good years.`);

  // 7, Per-share: is the slice growing or shrinking? (guard against unadjusted splits)
  const sh = L.map((x) => x.sharesDiluted);
  const shF = sh.find((x) => x != null), shL = [...sh].reverse().find((x) => x != null);
  if (shF && shL && Math.max(shF, shL) / Math.min(shF, shL) <= 1.8 && span > 0) {
    const sg = Math.pow(shL / shF, 1 / span) - 1;
    add("Share count", `${sg >= 0 ? "+" : "−"}${pct(Math.abs(sg), 1)}/yr`,
      sg < -0.005 ? "good" : sg > 0.01 ? "warn" : "ok",
      sg < -0.005 ? "The share count is shrinking, buybacks are quietly growing your slice of the business."
        : sg > 0.01 ? "The share count is rising, dilution works against you on a per-share basis."
        : "Roughly flat share count, little dilution, little buyback.");
  }

  // 8, Dividend continuity.
  const divs = L.map((x) => (x.dividendsPaid != null ? Math.abs(x.dividendsPaid) : null));
  const paidYrs = divs.filter((d) => d != null && d > 0).length;
  if (paidYrs > 0) {
    const dF = divs.find((d) => d), dL = [...divs].reverse().find((d) => d);
    const grew = dF && dL && dL > dF * 1.05;
    add("Dividend record", grew ? "rising" : "paid", grew ? "good" : "ok",
      grew ? "Paid and raised the dividend across the record, the continuity Graham prized."
        : `Paid a dividend in ${paidYrs} of the years on record.`);
  }

  // 9, The register, set against the record: how management talks, reconciled with whether the
  // business is actually compounding. The trajectory is read from owner-earnings growth where the
  // record carries it, else the margin trend — and withheld where neither is legible, since the
  // whole point is to reconcile the words with a record we could actually read.
  const trajectory = (g != null || marginDelta != null)
    ? ((g != null ? g >= 0.04 : marginDelta > 0.02) ? "compounding"
        : (g != null ? g < 0 : marginDelta < -0.02) ? "fading" : "holding")
    : null;
  const reg = registerReconciliation(trajectory, opts.candor);
  if (reg) add("How management talks about it", reg.value, reg.tone, reg.text);

  return { years, facts };
}
