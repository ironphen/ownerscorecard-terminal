// Shared, framework-agnostic compute for the fundamentals tools.
// Imported by both Astro pages (server) and React islands (client), so keep it
// pure ESM with no Node or browser built-ins.
import { financialKind } from "./archetype.mjs";
// Circular by construction (software.mjs formats money with fmtMoney below), which ESM resolves
// because every use sits inside a function body rather than at module load.
import { softwareSection } from "./software.mjs";
import { oilGasSection } from "./oilgas.mjs";

// The headline top line. For most companies this is reported revenue, but banks and
// insurers tag "Revenues" erratically (often a sliver, or not at all: Regions reports
// $104M against $5B of net interest income, MetLife $2B against $50B of premiums), so we
// reconstruct the real total from its components, a bank's net interest income plus fee
// income, an insurer's premiums plus net investment income. We only ever correct upward,
// when the reported tag clearly under-captures, so a cleanly-tagged filer is left alone.
export function topLineRevenue(lines, company) {
  const L = lines || {};
  const rev = L.revenue ?? null;
  const fk = financialKind(company);
  if (fk === "bank") {
    const recon = (L.netInterestIncome || 0) + (L.noninterestIncome || 0);
    return recon > (rev || 0) ? recon : rev;
  }
  if (fk === "insurer" || fk === "managedCare") {
    const recon = (L.premiumsEarned || 0) + (L.investmentIncome || 0);
    return recon > (rev || 0) ? recon : rev;
  }
  return rev;
}

// The minimum a company must clear to earn a page. Coverage is worth pushing toward the whole
// investable universe, but only with clean data: a page with a blank headline, or a husk with a
// top line and nothing to read it against, damages trust more than a missing name costs. So the
// pipeline withholds a company that can't clear this floor, rather than ship a broken page. A
// usable headline (a positive top line after the bank/insurer reconstruction) plus at least one
// earnings figure is the bar. Used by the fetch to exclude and by the audit to flag.
export function passesQualityFloor(company) {
  const L = company.ttm?.lines || company.lines || {};
  const rev = topLineRevenue(L, company);
  if (!(rev != null && rev > 0)) return false;
  if (L.netIncome == null && L.cashFromOps == null) return false;
  return true;
}

// Decide what insider-ownership figure to surface from the proxy `comp` block, using the group's
// beneficially-owned share count as an independent check on its stated percent. Below ~80% the percent
// is in the plausible economic range and shown as-is. Above ~80% it is trusted ONLY when the group's
// shares really are most of the shares outstanding — a genuine thin-float owner-operator (Ubiquiti's
// founder owns ~93% of a tiny float); when the percent is a super-voting-CLASS column the group's
// shares are a small slice of the total (Regeneron: ~97% of Class A, ~1.5% economically) and the check
// exposes it, so it's suppressed rather than shown as a wrong incentives figure. The "<1%" placeholder
// is always low and kept. Returns a number, "<1%", or null. `totalShares` is the diluted shares
// outstanding; when it's unavailable a high percent can't be corroborated and is suppressed.
export function resolveInsiderOwnership(comp, totalShares) {
  const pct = comp?.insiderOwnership;
  if (pct == null) return null;
  if (typeof pct !== "number") return pct;        // "<1%" placeholder
  const sh = comp.insiderShares;
  const econ = sh != null && totalShares > 0 ? sh / totalShares : null;
  // When the group's beneficially-owned shares are a reliable fraction of the shares outstanding, that
  // economic stake is the check on the proxy's stated percent. A percent sitting well ABOVE it (more
  // than 25 points — a tolerance that absorbs share-count basis/date noise) is a super-voting-CLASS or
  // voting-power column, not economic ownership, in any band: Regeneron's 97% against a ~1.6% stake,
  // but also a sub-80 reading like 74% against a 31% stake. Suppress those; show the rest, since a
  // percent at or below the economic stake doesn't overstate it (Ubiquiti's 93% against a ~93% stake).
  if (econ != null && econ >= 0 && econ <= 1.1) return econ * 100 < pct - 25 ? null : pct;
  // No reliable share count to corroborate (missing, or more shares than outstanding): a high (>80%)
  // reading is too likely a voting-class column to trust, so suppress it; a sub-80 reading is in the
  // plausible economic range and shown as before.
  return pct > 80 ? null : pct;
}

// Compact money formatting, currency-aware so the same compute serves the US pool (USD)
// and the Japanese pool (JPY, which reaches trillions): 123e9 -> "$123.0B", 50.7e12 ->
// "¥50.7T". The symbol is chosen by currency code; everything else is identical.
// ADRs report in their home currency, so the symbol map covers the major ones; anything unmapped
// falls back to its ISO code (e.g. "SEK 5B") rather than a wrong "$", so a currency is never mislabeled.
const CCY_SYMBOL = {
  USD: "$", JPY: "¥", EUR: "€", GBP: "£", CHF: "CHF ", TWD: "NT$", HKD: "HK$", KRW: "₩",
  CNY: "CN¥", BRL: "R$", INR: "₹", CAD: "C$", AUD: "A$", SGD: "S$", ILS: "₪", MXN: "MX$",
  ZAR: "R ", SEK: "SEK ", DKK: "DKK ", NOK: "NOK ", PLN: "zł ", IDR: "Rp ",
};
export function currencySymbol(ccy) { return CCY_SYMBOL[ccy] || (ccy ? ccy + " " : "$"); }
export function fmtMoney(v, ccy = "USD") {
  if (v == null) return "—";
  const sym = currencySymbol(ccy);
  const neg = v < 0;
  const a = Math.abs(v);
  let s;
  if (a >= 1e12) s = `${sym}${(a / 1e12).toFixed(2)}T`;
  else if (a >= 1e9) s = `${sym}${(a / 1e9).toFixed(1)}B`;
  else if (a >= 1e6) s = `${sym}${Math.round(a / 1e6)}M`;
  else if (a >= 1e3) s = `${sym}${Math.round(a / 1e3)}K`;
  else s = `${sym}${Math.round(a)}`;
  return neg ? `(${s})` : s;
}
// Back-compat: the US pages call fmtUSD directly. New, currency-bearing code uses fmtMoney.
export function fmtUSD(v) { return fmtMoney(v, "USD"); }

// Interest coverage = operating income (EBIT) / interest expense.
// Returns null when it can't be computed honestly (missing EBIT, or no
// meaningful interest burden, which is a *good* sign, handled by the verdict).
export function coverage(company) {
  const L = company?.lines || {};
  const oi = L.operatingIncome;
  const interest = L.interestExpense;
  if (oi == null) return null;
  if (!oiReliable(company)) return { ratio: null, oi, interest, notMeaningful: true };
  if (interest == null || interest <= 0) {
    // A missing (or negative) interest tag beside material balance-sheet debt is a data gap, not a
    // virtue: the burden is unknown, never "none" — a good-tone "isn't leaning on lenders" would sit
    // directly above a net-debt check showing real borrowing. Material: net debt at least half a
    // year's operating profit (or any net debt when there's no operating profit to measure against).
    const netDebt = (L.totalDebt || 0) - ((L.cashAndEquivalents || 0) + (L.shortTermInvestments || 0));
    if (L.totalDebt > 0 && netDebt > 0 && (oi <= 0 || netDebt >= 0.5 * oi))
      return { ratio: null, oi, interest, untagged: true };
    return { ratio: null, oi, interest, noBurden: true };
  }
  return { ratio: oi / interest, oi, interest, noBurden: false };
}

// Verdict bands. Graham wanted a real margin of safety in coverage, several
// years of earnings covering interest many times over, not scraping by once. A
// common distillation of his bond-selection tests is ~5x for an industrial;
// treat it as a reference line, not a law, and read the original.
export const GRAHAM_REFERENCE = 5;

export function coverageVerdict(result) {
  if (!result) return { tone: "none", label: "Not enough data", note: "Operating income wasn't found in the filing data." };
  if (result.notMeaningful)
    return { tone: "none", label: "Not the right lens here", note: "This business earns through equity-method affiliates, so interest coverage on its operating line isn't meaningful. Read its solvency on net debt against equity instead." };
  if (result.untagged)
    return { tone: "none", label: "Interest expense not tagged in the data", note: "No usable interest-expense line was tagged in the filing data, but the balance sheet carries real net debt — so the interest burden here is unknown, not absent. Read the debt on the net-debt check below." };
  if (result.noBurden)
    return {
      tone: "good",
      label: "No meaningful interest burden",
      note: "Little or no interest expense reported, the business isn't leaning on lenders to operate.",
    };
  const r = result.ratio;
  if (r < 1)
    return {
      tone: "bad",
      label: "Does not cover its interest",
      note: "A full year of operating profit didn't cover the interest bill. This is the zombie zone: the business depends on refinancing, asset sales, or forbearance to service its debt.",
    };
  if (r < 2)
    return {
      tone: "warn",
      label: "Thin",
      note: "Operating profit covers interest, but with little room. A bad year, a refinancing at higher rates, or a revenue wobble closes the gap fast.",
    };
  if (r < GRAHAM_REFERENCE)
    return {
      tone: "ok",
      label: "Adequate",
      note: "Comfortable in a normal year, but below the margin of safety Graham looked for. Worth checking how stable the coverage has been across a full cycle.",
    };
  return {
    tone: "good",
    label: "Comfortable",
    note: "Operating profit covers interest with the kind of margin Graham wanted for a defensive holding. Necessary, not sufficient, it says solvent, not cheap.",
  };
}

// Theme-aware tones: each resolves to a CSS variable so the same value reads correctly
// in both light and dark (defined in BaseLayout). Applied as inline color styles.
export const TONE_COLOR = {
  good: "var(--good)",
  ok: "var(--muted)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  info: "var(--info)",
  none: "var(--faint)",
};

const fmtX = (v, dp = 1) => (v == null ? "—" : `${v.toFixed(dp)}×`);

// --- additional checks, all from data the pipeline already pulls ---

// Earnings quality: does reported profit show up as cash?
export function earningsQuality(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const ni = c?.lines?.netIncome;
  const cfo = c?.lines?.cashFromOps;
  if (ni == null || cfo == null) return null;
  if (ni <= 0) {
    return {
      value: $(cfo),
      formula: `Net income ${$(ni)} · cash from operations ${$(cfo)}`,
      tone: cfo > 0 ? "warn" : "bad",
      label: cfo > 0 ? "Loss, but cash-generative" : "Loss, and burning cash",
      note:
        "The company reported a net loss, so a conversion ratio isn't meaningful. What matters then is whether operations still threw off cash, here, " +
        (cfo > 0 ? "they did." : "they did not."),
    };
  }
  const ratio = cfo / ni;
  const tone = ratio >= 1 ? "good" : ratio >= 0.6 ? "ok" : "warn";
  const label = ratio >= 1 ? "Cash-backed" : ratio >= 0.6 ? "Mostly cash-backed" : "Thinly cash-backed";
  return {
    value: fmtX(ratio, 2),
    formula: `Cash from ops ${$(cfo)} ÷ net income ${$(ni)}`,
    tone,
    label,
    note: "How much of reported profit showed up as operating cash. Above 1× is reassuring; well below suggests earnings lean on accruals. One year is noisy, growth and working-capital swings distort it, and this is operating cash, not free cash. Watch the multi-year trend.",
  };
}

// The catalog's 90th percentile for "look past GAAP" language — adjusted, non-GAAP, pro-forma,
// one-time, excluding-certain-items — counted per 1,000 MD&A words. Above it, the filing leans on
// adjusted numbers as heavily as the noisiest tenth of the catalog. Relative to the catalog's own
// distribution, the way the Candor Read scales its bars, never an absolute the reader must calibrate.
const ADJUSTED_HEAVY = 4.8;

// Wire the filing's language about the numbers into the cash-backing judgment. The cash-conversion
// ratio asks whether reported profit is real; the words say how management talks about that profit —
// whether it had to admit the numbers themselves are unreliable (a material weakness or a
// restatement, the gravest tells Graham's honesty test stops on), and how hard it steers you off
// GAAP. Read together: a thin cash-backing under heavy non-GAAP steering is a compounding worry; the
// same steering over cash-backed GAAP profit is a tension the cash itself resolves. The ratio stays
// the spine; the words make it smarter. Present, never pronounce. Pure: the caller passes the
// language signals in (qualityTone from earningsQuality, the rest from the language JSON), so this
// lib still runs under plain node. For a financial — read on a balance sheet, not a cash-conversion
// ratio — the caller passes qualityTone "none" and no adjusted density, so only the integrity branch
// speaks: Graham's honesty test, which comes before any ratio. Returns a clause and its tone, or null.
export function earningsQualityReconciliation(qualityTone, lang, forensic = null) {
  if (!lang) return null;
  // The gravest admissions first: they undermine the numbers themselves, whatever the ratio says.
  if (lang.materialWeakness)
    return { tone: "bad", text: "The filing discloses a material weakness in its financial controls — the reported numbers here, and the record built on them, are only as reliable as the controls that produced them." };
  if (lang.restatement)
    return { tone: "warn", text: "The filing discloses a restatement of previously reported figures — some numbers in the record have moved since they were first filed; read what changed, and why, before trusting the trend." };
  const clauses = [], tones = [];
  // The forensic screen (Munger's no-flim-flam, read through the cycle, never a verdict): when reported
  // earnings have run materially ahead of the operating cash they generated over the record — or a
  // manipulation screen of eight balance-sheet ratios trips where cash is not backing the profit — the
  // gap is named as a place to look, with the benign reading (an inventory- or content-heavy grower ties
  // up cash in real assets as it expands) set beside the concerning one (earnings leaning on estimates).
  if (forensic) {
    const aheadOfCash = forensic.accrualTC != null && forensic.accrualTC > 0.05;
    const corroborated = forensic.mElevated && forensic.accrualTC != null && forensic.accrualTC > 0.02;
    if (aheadOfCash || corroborated) {
      const screen = forensic.mElevated ? (aheadOfCash ? ", and a manipulation screen of eight balance-sheet ratios trips here too" : ", and a manipulation screen of eight balance-sheet ratios trips on it") : "";
      clauses.push(`Read against the cash, reported earnings have run ahead of the operating cash the business generated over the record${aheadOfCash ? ` — about ${(forensic.accrualTC * 100).toFixed(0)}% of assets a year, among the widest gaps in the catalogue` : ""}${screen}. For an inventory- or content-heavy grower that can be cash tied up in real assets as it expands; elsewhere it can mean the earnings lean on accounting estimates — the cash-flow statement against the income statement is where to tell which.`);
      tones.push(corroborated ? "warn" : "info");
    }
  }
  // Then the non-GAAP steering, read against whether cash actually backs the GAAP profit.
  const heavyAdjusted = lang.adjusted != null && lang.adjusted >= ADJUSTED_HEAVY;
  if (heavyAdjusted) {
    if (qualityTone === "warn" || qualityTone === "bad") {
      clauses.push("And the filing leans heavily on adjusted, non-GAAP earnings — steering you off the GAAP figure just where the cash is not backing it. Read the reconciliation in the notes before taking the adjusted number.");
      tones.push("warn");
    } else if (qualityTone === "good") {
      clauses.push("The filing leans on adjusted, non-GAAP earnings, but the GAAP profit is itself cash-backed — the adjustments are not papering over a cash shortfall here.");
      tones.push("ok");
    }
  }
  if (!clauses.length) return null;
  const order = { bad: 3, warn: 2, ok: 1, info: 0 };
  return { tone: tones.sort((a, b) => order[b] - order[a])[0], text: clauses.join(" ") };
}

// The forensic screen behind the reconciliation above — read THROUGH THE CYCLE, so a single growth year's
// working-capital swing can't drive it. Two deterministic, primary-source signals, no runtime model:
//  • Accruals: the median gap between reported net income and operating cash, scaled by assets (Sloan's
//    earnings-quality measure in its cash-flow form). Most businesses run negative — cash exceeds reported
//    profit — so a persistently POSITIVE gap (profit ahead of cash) is the rare tell.
//  • The Beneish M-score: eight year-over-year ratios (receivables vs sales, margin, asset quality, sales
//    growth, depreciation, overhead, leverage, accruals) that statistically separated past earnings
//    manipulators from honest filers. It also trips on fast growth and heavy acquisitions, so the caller
//    reconciles it against the cash-backing rather than pronouncing on it. Returns null when the record is
//    too short, or (for the M-score) when any input year is missing — precision over recall.
function beneishMScore(t, p) {
  if (!t || !p) return null;
  const r = (n, d) => (n != null && d != null && d !== 0 ? n / d : null);
  const gm = (L) => (L.revenue ? (L.revenue - (L.costOfRevenue ?? 0)) / L.revenue : null);
  const aq = (L) => (L.totalAssets ? 1 - ((L.currentAssets || 0) + (L.netPPE || 0)) / L.totalAssets : null);
  const depr = (L) => r(L.depreciation, (L.depreciation || 0) + (L.netPPE || 0));
  const lev = (L) => r((L.totalDebt || 0) + (L.currentLiabilities || 0), L.totalAssets);
  const gmt = gm(t), gmp = gm(p);
  const v = {
    dsri: r(r(t.receivables, t.revenue), r(p.receivables, p.revenue)),
    gmi: gmt != null && gmp != null && gmt !== 0 ? gmp / gmt : null,
    aqi: r(aq(t), aq(p)),
    sgi: r(t.revenue, p.revenue),
    depi: r(depr(p), depr(t)),
    sgai: r(r(t.sgaExpense, t.revenue), r(p.sgaExpense, p.revenue)),
    lvgi: r(lev(t), lev(p)),
    tata: t.netIncome != null && t.cashFromOps != null && t.totalAssets ? (t.netIncome - t.cashFromOps) / t.totalAssets : null,
  };
  for (const k of Object.keys(v)) if (v[k] == null || !Number.isFinite(v[k])) return null; // need all eight
  return -4.84 + 0.92 * v.dsri + 0.528 * v.gmi + 0.404 * v.aqi + 0.892 * v.sgi + 0.115 * v.depi - 0.172 * v.sgai + 4.679 * v.tata - 0.327 * v.lvgi;
}
export function forensicScreen(company) {
  const H = (company?.history || []).filter((h) => h?.lines?.revenue != null);
  if (H.length < 4) return null;
  const accs = [];
  for (let i = 0; i < H.length; i++) {
    const L = H[i].lines, P = i > 0 ? H[i - 1].lines : null;
    if (L.netIncome == null || L.cashFromOps == null || L.totalAssets == null) continue;
    const avgTA = P && P.totalAssets != null ? (L.totalAssets + P.totalAssets) / 2 : L.totalAssets;
    if (!(avgTA > 0)) continue;
    accs.push((L.netIncome - L.cashFromOps) / avgTA);
  }
  if (accs.length < 3) return null;
  const s = [...accs].sort((a, b) => a - b);
  const accrualTC = s[Math.floor((s.length - 1) / 2)]; // through-cycle median
  const m = beneishMScore(H[H.length - 1].lines, H[H.length - 2]?.lines);
  return { accrualTC, mScore: m, mElevated: m != null && m > -2.22 };
}

// Leverage: how many years of operating profit would repay the debt?
export function leverage(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const debt = c?.lines?.totalDebt;
  const oi = c?.lines?.operatingIncome;
  // Before the null check: a heavy interest bill with little or no debt tagged is the
  // under-capture case, and showing nothing there reads as "no debt" just as wrongly as a low
  // ratio would. Name it instead.
  if (!debtReliable(c?.lines || {}))
    return { value: "—", formula: "", tone: "none", label: "Debt under-captured — leverage unknown, not low", note: "This company's interest bill implies far more debt than its filings tag at the consolidated level (the rest sits under segment dimensions the data source strips), so years of operating profit to repay it cannot be read honestly here, and a low figure would be a fiction. Judge it on the record and owner earnings instead." };
  if (debt == null || oi == null) return null;
  if (!oiReliable(c))
    return { value: "—", formula: "", tone: "none", label: "Read on equity, not operating income", note: "Years of operating profit to repay debt is not the right leverage read for a holding or trading company, whose earnings flow through affiliates rather than an operating line. Look at net debt and the return on equity instead." };
  if (debt === 0)
    return { value: "0×", formula: "No interest-bearing debt reported", tone: "good", label: "Debt-free", note: "The business doesn't depend on lenders, the strongest position to negotiate, wait, or weather a bad year from." };
  if (oi <= 0)
    return { value: "—", formula: `Total debt ${$(debt)} · operating income ${$(oi)}`, tone: "bad", label: "Debt against an operating loss", note: "There's debt but no operating profit to measure it against, understand that combination before anything else about the company." };
  const years = debt / oi;
  const tone = years < 2 ? "good" : years < 4 ? "ok" : years < 6 ? "warn" : "bad";
  const label = years < 2 ? "Conservative" : years < 4 ? "Moderate" : years < 6 ? "Heavy" : "High";
  return {
    value: `${years.toFixed(1)}×`,
    formula: `Total debt ${$(debt)} ÷ operating income ${$(oi)}`,
    tone,
    label,
    note: "Years of operating profit it would take to repay all debt. A first read, not a credit rating: it's gross debt (not netted against cash) over EBIT (not EBITDA), and a cyclical year distorts it.",
  };
}

// Liquid assets an owner can count against the debt: cash, plus short-term and
// longer-dated marketable securities (not strategic or illiquid stakes).
export function liquidAssets(L) {
  if (!L) return null;
  if (L.cashAndEquivalents == null && L.shortTermInvestments == null && L.longTermMarketable == null) return null;
  return (L.cashAndEquivalents || 0) + (L.shortTermInvestments || 0) + (L.longTermMarketable || 0);
}

// Net debt = gross debt − (cash + short-term investments). The truer leverage
// figure: gross debt ignores the cash already sitting against it. Negative means
// net cash. Longer-dated marketable securities are surfaced in the note, not the
// headline, to keep the definition conventional.
//
// ONE definition for every surface. The headline net-debt figure a reader compares
// across the company page, the compare card, the grouping table and the almanac must be
// identical, so all of them net against cash + short-term investments only — never the
// broader liquidAssets (which folds in long-term marketable and would flip the sign for a
// cash-rich name like Apple: net cash on one surface, net debt on another). liquidAssets
// stays the right measure for the valuation's enterprise-value toggle, which is a distinct,
// separately-labeled adjustment, not the headline. (2026-07-17 correctness sweep.)
export function netDebtOf(L) {
  if (!L) return null;
  if (L.cashAndEquivalents == null && L.totalDebt == null) return null;
  return (L.totalDebt || 0) - ((L.cashAndEquivalents || 0) + (L.shortTermInvestments || 0));
}

export function cashPosition(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const L = c?.lines || {};
  const cash = L.cashAndEquivalents, debt = L.totalDebt;
  if (cash == null && debt == null) return null;
  if (!debtReliable(L))
    return { value: "—", formula: "", tone: "none", label: "Debt under-captured — leverage unknown, not low", note: "This company pays far more interest than its tagged debt implies (the rest sits under segment dimensions the data source strips), so its net cash or net debt cannot be read honestly: the gap is unknown, not zero, and 'net cash' here would be exactly the fiction the figure is meant to prevent. Judge it on the record and owner earnings instead." };
  const st = L.shortTermInvestments || 0;
  const lt = L.longTermMarketable || 0;
  const liquid = (cash || 0) + st;
  const gross = debt || 0;
  const net = gross - liquid; // >0 net debt, <0 net cash
  const oi = L.operatingIncome;
  const years = oi && oi > 0 && net > 0 ? net / oi : null;
  const netCash = net < 0;

  // Net debt against an operating LOSS is the harshest read, not the mildest: a profitable 4.5×
  // borrower at least has the profit; here there is none to measure the debt against at all.
  // Gated on oiReliable, so a holding company whose affiliates dwarf its operating line (a negative
  // print beside a solid net profit) isn't misread as a loss-making borrower.
  const opLoss = oi != null && oi <= 0 && oiReliable(c);
  let tone, label;
  if (netCash) { tone = "good"; label = gross === 0 ? "Net cash, debt-free" : "Net cash"; }
  else if (net === 0) { tone = "good"; label = "Cash equals debt"; }
  else if (years != null && years < 2) { tone = "ok"; label = "Modest net debt"; }
  else if (years != null && years < 4) { tone = "warn"; label = "Meaningful net debt"; }
  else if (years != null) { tone = "bad"; label = "Heavy net debt"; }
  else if (opLoss) { tone = "bad"; label = "Net debt against an operating loss"; }
  else { tone = "warn"; label = "Net debt"; }

  const value = netCash ? `+${$(-net)}` : $(net);
  const formula =
    `Cash ${$(cash || 0)}` + (st ? ` + ST investments ${$(st)}` : "") + ` − debt ${$(gross)}`;

  // The gross multiple is context, not the headline: it earns a mention only when it differs
  // from the net multiple at display precision (a cash-light balance sheet makes them identical,
  // and "versus the gross figure" beside an equal figure reads as a contradiction).
  const grossYears = oi && oi > 0 && gross > 0 ? gross / oi : null;
  const grossDiffers = years != null && grossYears != null && grossYears.toFixed(1) !== years.toFixed(1);
  let note = netCash
    ? `Cash and short-term investments exceed every dollar of debt by ${$(-net)}, on net the company owes nothing, and can act from strength when others can't.`
    : `Netting ${$(liquid)} of cash and short-term investments against ${$(gross)} of debt leaves ${$(net)} owed${years != null ? `, about ${years.toFixed(1)}× a year's operating profit${grossDiffers ? ` (${grossYears.toFixed(1)}× on the gross debt, before the cash)` : ""}` : opLoss ? `, with no operating profit this year to measure it against — understand that combination before anything else about the company` : ""}.`;
  if (lt) {
    const full = net - lt;
    note += ` It also holds ${$(lt)} in longer-dated marketable securities; counting those, it sits at ${full < 0 ? `net cash of ${$(-full)}` : `${$(full)} of net debt`}.`;
  }
  note += " Net debt is the leverage figure that matters: the cash is already set against the debt. Strategic or illiquid investments aren't counted here.";
  return { value, formula, tone, label, note, years };
}

// Capex vs. depreciation: a lens, not a grade.
export function capexVsDepreciation(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const capex = c?.lines?.capex;
  const dep = c?.lines?.depreciation;
  if (capex == null || dep == null || dep === 0) return null;
  const ratio = capex / dep;
  const label = ratio < 0.8 ? "Harvesting" : ratio <= 1.2 ? "Maintaining" : "Expanding";
  return {
    value: fmtX(ratio, 2),
    formula: `Capex ${$(capex)} ÷ depreciation ${$(dep)}`,
    tone: "info",
    label,
    note: "Descriptive, not a grade. Above ~1× means investing faster than assets wear out (growth, or, sustained for years, today's earnings carrying less depreciation than tomorrow's will). Below means spending less than it's wearing out (efficiency, or a melting asset base). The ratio won't tell you which; the filings will.",
  };
}

// Return on invested capital, Buffett's north star.
export function roic(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const L = c?.lines || {};
  if (financialKind(c))
    return {
      value: "—", formula: "", tone: "none", label: "Not the right lens here",
      note: "A bank, insurer or property trust is not read on return on invested capital — for these, capital is the raw material, not a means to an operating end. Read it on return on equity (and the combined ratio, or funds from operations) instead.",
    };
  if (!debtReliable(L))
    return {
      value: "—", formula: "", tone: "none", label: "Debt under-captured",
      note: "This company's interest bill implies far more debt than its filings tag at the consolidated level (the rest sits under segment dimensions the data source strips), so invested capital, and the return on it, cannot be read honestly. Judge this one on Owner Earnings and the record instead.",
    };
  if (!oiReliable(c))
    return {
      value: "—", formula: "", tone: "none", label: "Operating income not meaningful here",
      note: "This business earns mostly through equity-method affiliates, so its operating line understates its earning power and a ROIC built on it would mislead. Read it on return on equity and the record instead.",
    };
  const oi = L.operatingIncome, eq = L.stockholdersEquity, debt = L.totalDebt;
  if (oi == null || eq == null || debt == null) return null;
  const invested = debt + eq - (L.cashAndEquivalents || 0);
  if (invested <= 0)
    return {
      value: "—",
      formula: `Invested capital ${$(invested)} = debt ${$(debt)} + equity ${$(eq)} − cash`,
      tone: "none",
      label: "Not meaningful here",
      note: "Invested capital is near zero or negative, usually years of buybacks pulling equity down. ROIC explodes or flips sign and stops meaning anything. Judge this one on Owner Earnings instead.",
    };
  // Effective tax rate from the filing (pretax ≈ net income + tax); fallback 21%.
  let t = 0.21;
  const tax = L.incomeTaxExpense, ni = L.netIncome;
  if (tax != null && ni != null && ni + tax > 0) t = Math.min(Math.max(tax / (ni + tax), 0), 0.5);
  const nopat = oi * (1 - t);
  // The latest figure carries roicValue's distortion guard, so it is null when large non-operating
  // charges put the operating line well above pretax profit (an inflated print otherwise).
  const r = roicValue(L);
  // Judge on the through-cycle median, not this one year: the same franchise reads "exceptional"
  // at the peak and "below average" at the trough. The headline becomes the normalized rate when
  // the record allows; the latest year moves to the formula and note.
  const tc = throughCycle(c, roicValue);
  if (r == null && tc == null) return null;
  const j = tc ? tc.median : r;
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const tone = j < 0.08 ? "warn" : j < 0.15 ? "ok" : "good";
  const label = (j < 0.08 ? "Below average" : j < 0.15 ? "Solid" : j < 0.25 ? "High" : "Very high (≥25%)") + (tc ? " through the cycle" : "");
  return {
    value: tc ? pct(j) : pct(r),
    formula: tc
      ? `${tc.n}-yr median, range ${pct(tc.lo)}–${pct(tc.hi)}` + (r != null
          ? `; ${pct(r)} latest = NOPAT ${$(nopat)} ÷ invested capital ${$(invested)}`
          : `; the latest year is left out — large non-operating charges put its operating line well above pretax profit`)
      : `NOPAT ${$(nopat)} ÷ invested capital ${$(invested)} (debt + equity − cash)`,
    tone,
    label,
    note: "The rate the business earns on the money tied up in it, Buffett's north star, because over time a stock tracks the ROIC beneath it. Above ~15% sustained hints at a moat; a return below the cost of capital (~8%) erodes value as a business grows rather than building it — the test Buffett weighs most."
      + (tc && r != null ? ` The headline is the median of the last ${tc.n} years (it ran ${pct(r)} most recently), so one peak or trough year doesn't set the verdict.` : tc ? ` The headline is the median of the last ${tc.n} years, so one peak or trough year doesn't set the verdict.` : "")
      + " Asset-light businesses (R&D expensed, little capital) read artificially high, pair this with Owner Earnings.",
  };
}

// Owner earnings (Buffett's figure): operating cash minus the maintenance capex the business
// must spend to hold its position — what an owner can take out without starving it. Free cash
// flow (after growth capex too) is shown beside it in the note, so the two never get conflated.
export function ownerCash(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const L = c?.lines || {};
  const cfo = L.cashFromOps, capex = L.capex;
  if (cfo == null || capex == null) return null;
  const maint = maintenanceCapex(c) ?? Math.abs(capex);
  const oe = cfo - maint;            // Buffett owner earnings: operating cash less maintenance capex
  const fcf = cfo - Math.abs(capex); // free cash flow: after the discretionary growth capex too
  const rev = L.revenue, sbc = L.stockBasedComp;
  const margin = rev ? oe / rev : null;
  const oeSbc = sbc != null ? oe - sbc : null;
  const growthGap = oe - fcf > Math.max(Math.abs(oe) * 0.1, (rev || 0) * 0.01);
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  // Judge on the through-cycle median margin, so a heavy build-out year (or a one-off cash year)
  // doesn't set the verdict on a business that earns well across the record.
  const tc = throughCycle(c, (l) => ownerEarningsMargin(l, c));
  // A through-cycle median dragged underwater by an early loss stretch the business has since grown out
  // of (Carvana, Affirm) would read "consumes cash" here while the valuation panel runs on the
  // now-positive base — the two contradicting each other on one page. A company is not "consuming cash"
  // in a year it generates owner earnings. So when owner earnings are positive now but the cycle median
  // is not: if the last three years are ALL positive it's a clean turn — judge on the recent margin;
  // otherwise present both facts (positive this year, negative across the cycle) rather than a "bad"
  // verdict the valuation flatly disagrees with. The judgment stays the reader's.
  const oeHist = (c.history || []).map((h) => ownerEarningsAbs(h.lines, c)).filter((v) => v != null);
  const recent3 = oeHist.slice(-3);
  // The turn narrative ("recently turned positive, after an earlier loss stretch") requires an actual
  // loss in the record — a negative owner-earnings year, or a cycle median at or below zero. A business
  // that has been positive-but-thin every year (a grocer at a 3% margin) never "turned": it reads plain.
  const hadLoss = oeHist.some((v) => v < 0) || (tc != null && tc.median <= 0);
  const fullTurn = hadLoss && tc != null && tc.median <= 0.05 && oe > 0 && recent3.length >= 3 && recent3.every((v) => v > 0);
  const softTurn = tc != null && tc.median <= 0 && oe > 0 && !fullTurn;
  const j = fullTurn ? margin : tc ? tc.median : margin;
  let tone, base, suffix;
  if (softTurn) {
    tone = "warn";
    base = "Positive this year, negative across the cycle";
    suffix = "";
  } else {
    tone = j == null ? (oe <= 0 ? "bad" : "ok") : j <= 0 ? "bad" : j < 0.05 ? "warn" : j < 0.15 ? "ok" : "good";
    base = j == null ? (oe <= 0 ? "Consumes cash" : "Positive") : j <= 0 ? "Consumes cash" : j < 0.05 ? "Thin" : j < 0.15 ? "Solid" : "High";
    suffix = fullTurn ? ", recently turned positive" : tc ? " through the cycle" : "";
  }
  return {
    value: fullTurn || softTurn ? (margin != null ? pct(margin) : $(oe)) : tc ? pct(j) : margin != null ? pct(margin) : $(oe),
    formula: fullTurn || softTurn
      ? `latest ${$(oe)} = operating cash ${$(cfo)} − maintenance capex ${$(maint)}${fullTurn ? `; positive each of the last ${recent3.length} years` : " (positive this year)"}, after an earlier loss stretch (${tc.n}-yr median ${pct(tc.median)})`
      : tc
      ? `${tc.n}-yr median margin, range ${pct(tc.lo)}–${pct(tc.hi)}; latest ${$(oe)} = operating cash ${$(cfo)} − maintenance capex ${$(maint)}`
      : `Owner earnings ${$(oe)} = operating cash ${$(cfo)} − maintenance capex ${$(maint)}`,
    tone,
    label: base + suffix,
    note:
      `What an owner could take out without starving the business: operating cash less the maintenance capital it must spend to hold its position — Buffett's owner earnings.${margin != null ? ` That's ${pct(margin)} of revenue this year${tc ? `, a ${pct(tc.median)} median across ${tc.n} years` : ""}.` : ""}` +
      (growthGap ? ` It chose to put ${$(Math.abs(capex) - maint)} more into growth, so free cash flow this year was ${$(fcf)} — the gap is investment, not weakness.` : "") +
      `${oeSbc != null ? ` Treating stock comp as the real expense it is (less ${$(sbc)} of SBC) leaves ${$(oeSbc)}.` : ""}`,
  };
}

// Maintenance capex — the spending a business needs to hold its competitive position and unit
// volume, the figure Buffett's owner earnings actually subtracts (total capex also funds growth,
// which is discretionary). With no PP&E line to run the Greenwald sales-intensity split, we use
// depreciation, Buffett's own stand-in for the assets consumed each year. The rule is conservative —
// only a demonstrable builder gets growth capex carved out: capex at or below depreciation
// (harvesting, asset-light, steady state) IS the maintenance figure; capex well above depreciation
// counts as growth only when revenue is genuinely rising (else the excess is replacement-cost
// inflation on flat volume, still maintenance), in which case maintenance ≈ depreciation.
export function maintenanceCapex(c) {
  return maintenanceCapexFor(c?.lines || {}, c);
}
// Maintenance capex for a single year's lines, given the company (whose record decides whether it is
// genuinely growing). Used per-year so every owner-earnings surface — the bridge, the scorecard, the
// ten-year table, peers, durability — reads the same Buffett figure rather than free cash flow.
export function maintenanceCapexFor(L, company) {
  const capex = L?.capex != null ? Math.abs(L.capex) : null;
  if (capex == null) return null;
  let dep = L.depreciation;
  // Depreciation is missing for some early filing years (a tag gap) on ~4% of names. Without it the
  // maintenance-capex estimate flips to full capex, so owner earnings jumps the year the data appears
  // (Google's series climbing 17%→36% across the 2021 boundary). Backfill the missing year from the
  // company's own typical depreciation-to-revenue ratio so the estimate stays continuous; the reported
  // depreciation figures shown elsewhere are untouched.
  if ((dep == null || dep <= 0) && L.revenue) {
    const t = typicalDepToRev(company);
    if (t != null) dep = t * L.revenue;
  }
  if (dep == null || dep <= 0 || capex <= dep * 1.25) return capex;
  return revenueGrowing(company) ? dep : capex;
}
// The company's normal depreciation as a share of revenue, from the years that report it — used to
// backfill a year whose depreciation tag is missing so the maintenance-capex split stays consistent.
function typicalDepToRev(company) {
  const H = (company?.history || []).map((h) => h?.lines).concat(company?.lines ? [company.lines] : []);
  const r = H.filter((l) => l && l.depreciation > 0 && l.revenue > 0).map((l) => l.depreciation / l.revenue);
  if (!r.length) return null;
  const s = [...r].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}
// Owner earnings, the cash figure (not a margin): operating cash less the maintenance capex Buffett
// subtracts. The single definition the whole site reads, so the bridge and the tables never disagree.
export function ownerEarningsAbs(L, company) {
  if (!L || L.cashFromOps == null || L.capex == null) return null;
  const maint = maintenanceCapexFor(L, company);
  return maint == null ? null : L.cashFromOps - maint;
}
// Free cash flow: operating cash after ALL capital spending, maintenance and growth alike. The
// conservative companion to owner earnings — where the two part ways the gap is the growth investment,
// so showing both keeps a capex build-out from hiding behind the owner-earnings figure.
export function freeCashFlowAbs(L) {
  return L && L.cashFromOps != null && L.capex != null ? L.cashFromOps - Math.abs(L.capex) : null;
}
export function freeCashFlowMargin(L) {
  const f = freeCashFlowAbs(L);
  return f != null && L && L.revenue ? f / L.revenue : null;
}
// Did the business actually grow across the record? First few years of revenue vs the last few, so a
// one-year blip doesn't read as growth and a steady decliner isn't credited with growth capex.
function revenueGrowing(c) {
  const H = (c?.history || []).filter((h) => h?.lines?.revenue != null);
  if (H.length < 4) return true; // too short to judge; treat a build-out as growth (the AI-capex case)
  const m = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const early = m(H.slice(0, 3).map((h) => h.lines.revenue));
  const late = m(H.slice(-3).map((h) => h.lines.revenue));
  return early > 0 && late > early * 1.1;
}

// The owner-earnings bridge: how a year's reported profit becomes the cash an owner can take
// out. Reconciles net income → cash from operations, then splits capex into the maintenance the
// business needs and the growth it chooses, landing on Buffett's owner earnings (operating cash
// less maintenance capex) and, after growth capex too, free cash flow — the figure the scorecard's
// "free cash" margin reads, so the page never contradicts itself. Raw numbers (the component formats
// in the company's currency); null unless net income, operating cash and capex are all present.
// One year of the bridge from a lines object + its fiscal year, read in the company's context
// (which decides whether the year is genuinely growing, and so the maintenance-capex split). Shared
// by the single-year bridge and the multi-year series so every column reads the identical Buffett
// arithmetic. Null unless the year carries the three anchors: net income, operating cash, capex.
export function ownerEarningsBridgeFor(L, fy, company) {
  const ni = L?.netIncome, cfo = L?.cashFromOps, capex = L?.capex;
  if (ni == null || cfo == null || capex == null) return null;
  // A NEGATIVE depreciation is not a non-cash charge added back. AES tags
  // DepreciationAmortizationAndAccretionNet at −$1.46B — an accretion-swamped net line — and the
  // bridge printed it as an add-back with a minus sign on it. The record keeps the value as filed;
  // HERE the row claims "added back", so a non-positive value is withheld from that claim and the
  // residual line (`other`, computed below from whatever this excludes) absorbs the reconciliation,
  // which is arithmetically where a net accretion belongs. The walk still closes to the dollar.
  const dep = L.depreciation > 0 ? L.depreciation : null;
  const sbc = L.stockBasedComp != null ? L.stockBasedComp : null;
  const capexAbs = Math.abs(capex);
  const other = cfo - ni - (dep || 0) - (sbc || 0);
  const maint = maintenanceCapexFor(L, company) ?? capexAbs;
  const growth = Math.max(0, capexAbs - maint);
  return {
    fy: fy ?? null,
    revenue: L.revenue ?? null,
    netIncome: ni,
    depreciation: dep,
    stockBasedComp: sbc,
    other,
    cashFromOps: cfo,
    capex: capexAbs,
    maintCapex: maint,
    growthCapex: growth,
    ownerEarnings: cfo - maint,    // Buffett owner earnings: operating cash less maintenance capex
    freeCashFlow: cfo - capexAbs,  // after the discretionary growth capex too
  };
}

export function ownerEarningsBridge(c) {
  return ownerEarningsBridgeFor(c?.lines || {}, c?.fy ?? null, c);
}

// The bridge across the last `maxCols` fiscal years (returned oldest→newest), so an owner reads the
// trend of each step — whether owner earnings is growing and whether the gap to reported profit is
// widening or holding — not a single snapshot. Same per-year arithmetic; years missing an anchor
// drop out. `company.history` already includes the latest annual as its final entry.
export function ownerEarningsBridgeSeries(c, maxCols = 5) {
  const hist = Array.isArray(c?.history) ? c.history : [];
  return hist
    .map((h) => ownerEarningsBridgeFor(h?.lines || {}, h?.fy ?? null, c))
    .filter(Boolean)
    .slice(-maxCols);
}

// Capital allocation: of the Owner Earnings, how much was returned, and was it real?
// The denominator is the same Buffett owner-earnings figure the bridge and the valuation read
// (operating cash less MAINTENANCE capex, ownerEarningsAbs) — not free cash flow — so one page can
// never carry two different "Owner Earnings" dollars, or deny a surplus its own bridge proves.
export function capitalAllocation(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const L = c?.lines || {};
  const cfo = L.cashFromOps, capex = L.capex, div = L.dividendsPaid, bb = L.buybacks;
  if (cfo == null || capex == null || (div == null && bb == null)) return null;
  const oc = ownerEarningsAbs(L, c);
  if (oc == null || oc <= 0)
    return { value: "—", formula: "", tone: "warn", label: "No surplus to allocate", note: "The business didn't generate positive Owner Earnings this year, so any distributions came from the balance sheet or borrowing, not from operations." };
  const dividends = Math.abs(div || 0), buybacks = Math.abs(bb || 0), sbc = L.stockBasedComp;
  const returned = dividends + buybacks;
  const payout = returned / oc;
  const label = payout > 1 ? "Returned more than it generated" : payout >= 0.9 ? "Returns most of it" : payout >= 0.4 ? "Returns about half" : "Reinvests most of it";
  let note = payout > 1
    ? `The company returned more than it generated: against ${$(oc)} of Owner Earnings, ${$(returned)} (${(payout * 100).toFixed(0)}%) went back to shareholders, ${$(dividends)} dividends, ${$(buybacks)} buybacks — the excess came from the balance sheet or borrowing, not the year's operations.`
    : `Of ${$(oc)} Owner Earnings, ${$(returned)} (${(payout * 100).toFixed(0)}%) went back to shareholders, ${$(dividends)} dividends, ${$(buybacks)} buybacks.`;
  if (buybacks > 0 && sbc != null)
    note += buybacks - sbc <= 0
      ? ` But the buybacks barely exceed stock issued to employees (${$(sbc)} SBC), net of dilution, little was truly returned.`
      : ` Net of ${$(sbc)} stock comp, the real buyback was about ${$(buybacks - sbc)}.`;
  note += payout > 1
    ? " Sustained, that pattern draws down cash or adds debt; the net-debt line above shows where it stands."
    : " Returning most of it is the mark of a mature business with little left to reinvest at a high return; reinvesting most could mean a long runway, or empire-building. The split doesn't say which; the return earned on it (see ROIC) does.";
  return { value: `${(payout * 100).toFixed(0)}%`, formula: `Dividends + buybacks ${$(returned)} ÷ Owner Earnings ${$(oc)}`, tone: "info", label, note };
}

// A business that certainly carries inventory: makers and builders (agriculture through
// manufacturing, SIC 0100–3999) and wholesale/retail trade (5000–5999). For a filer without a SIC
// code (the Japanese pool), a cost-of-goods line dominating revenue is the fallback signal. Used to
// tell an untagged inventory line (a data gap) from a genuinely inventory-free services model.
function carriesInventory(c) {
  const s = parseInt(c?.sic, 10);
  if (!Number.isNaN(s)) return (s >= 100 && s < 4000) || (s >= 5000 && s < 6000);
  const L = c?.lines || {};
  return L.costOfRevenue != null && L.revenue > 0 && L.costOfRevenue / L.revenue >= 0.6;
}

// Cash-conversion cycle: DSO + DIO − DPO (days). A liquidity check that doubles
// as a moat detector, a negative cycle means others fund the business.
export function cashConversionCycle(c) {
  const L = c?.lines || {};
  const rev = L.revenue, cogs = L.costOfRevenue, recv = L.receivables, ap = L.accountsPayable;
  if (rev == null || cogs == null || recv == null || ap == null || cogs <= 0 || rev <= 0) return null;
  const inv = L.inventory;
  // An untagged inventory line on a goods business is missing data, not zero: computed without it, a
  // department store or grocer prints a fictional negative cycle praised as float. Withhold the figure
  // (not enough data) rather than praise a moat that isn't there. A services filer with no inventory
  // line keeps its cycle — there, the inventory leg genuinely rounds to zero.
  if (inv == null && carriesInventory(c)) return null;
  const hasInv = inv != null && inv > 0;
  const dso = (recv / rev) * 365;
  const dio = hasInv ? (inv / cogs) * 365 : 0;
  const dpo = (ap / cogs) * 365;
  const ccc = dso + dio - dpo;
  const tone = ccc < 0 ? "good" : ccc < 60 ? "ok" : "warn";
  const label = ccc < 0 ? "Negative, funded by others" : ccc < 60 ? "Tight" : "Long (60+ days)";
  return {
    value: `${Math.round(ccc)}d`,
    formula: `DSO ${Math.round(dso)} + DIO ${Math.round(dio)} − DPO ${Math.round(dpo)} days`,
    tone,
    label,
    note:
      "Days cash is tied up between paying suppliers and collecting from customers." +
      (ccc < 0
        ? " A negative cycle is a quiet moat: suppliers and customers fund the operation (Buffett's “float”), the company grows on other people's money."
        : " Lower is better; a long cycle means growth itself eats cash.") +
      (!hasInv ? " (Little or no inventory, a services / asset-light model, so the inventory leg is ~0.)" : ""),
  };
}

// Effective tax rate: the share of pre-tax profit paid in tax. A durably low rate can be a real
// edge (R&D credits, a foreign mix) or a one-off that flatters this year's growth; either way it
// is worth seeing, because a rate reverting to normal moves reported earnings without the business
// changing. Null on a loss year (the rate is meaningless) or an out-of-band figure (a tax benefit).
export function effectiveTaxRate(L) {
  const tax = L?.incomeTaxExpense, ni = L?.netIncome;
  if (tax == null || ni == null) return null;
  const pretax = ni + tax;
  if (!(pretax > 0)) return null;
  const r = tax / pretax;
  return r < -0.1 || r > 0.6 ? null : r;
}

// Where each revenue dollar goes: the cost structure as shares of revenue — cost of goods, then the
// operating buckets (overhead and research) — leaving the operating margin. Read across the record
// it shows operating leverage: whether growth widens the margin or the costs grow right along with
// it. R&D is carried apart because it is a choice, not a cost of the last sale.
export function costStack(L) {
  const rev = L?.revenue;
  if (!(rev > 0)) return null;
  const frac = (v) => (v != null ? v / rev : null);
  const cogs = frac(L.costOfRevenue), sga = frac(L.sgaExpense), rnd = frac(L.researchDevelopment), op = frac(L.operatingIncome);
  if (cogs == null && sga == null && rnd == null) return null;
  return { cogs, sga, rnd, op, grossMargin: cogs != null ? 1 - cogs : null };
}

// Raw metric values from a single year's lines, reused for the time series.
// Return null when not honestly computable.
// Debt we can trust as a leverage read. When a company pays material interest but little
// or no debt is tagged, the figure is grossly under-captured: Ford reports its ~$150B
// only under segment dimensions the companyfacts API strips, and AES and Textron tag none
// at all, so treating the gap as zero would paint a debt-laden company as net cash. In
// that case its leverage is unknown, not low, and the reads that lean on it should show
// nothing rather than an optimistic fiction. Immaterial interest (a small lease charge)
// is left alone, so a genuinely debt-light compounder still reads as net cash.
export function debtReliable(L) {
  const ie = L?.interestExpense;
  if (ie == null || ie <= 1e8) return true;
  const td = L?.totalDebt;
  if (td == null || td <= 0) return false;
  return ie / td <= 0.5;
}

// Whether the operating-income line is a meaningful read of earning power. The US pool
// always reports one, so it is trusted there. The Japanese pool includes the trading
// houses and other holding companies that earn mostly through equity-method affiliates:
// their operating line sits far below net income (or runs negative against a solid profit),
// so an operating margin, ROIC or interest-coverage built on it would mislead. We detect
// that signature and route those names to return on equity instead, never inventing a
// number. Scoped to JP so it can never misfire on a US name (Berkshire's operating income
// is the figure Buffett says to trust; its net income is the noisy one).
export function oiReliable(c) {
  if (c?.market !== "JP") return true;
  const L = c?.lines || {};
  const oi = L.operatingIncome, ni = L.netIncome;
  if (oi == null) return false;
  if (ni != null && ni > 0 && oi < ni * 0.4) return false; // affiliates dwarf the operating line
  return true;
}

export function roicValue(L) {
  if (!L) return null;
  const oi = L.operatingIncome, eq = L.stockholdersEquity;
  if (oi == null || eq == null) return null;
  // A debt-light company carries little debt (our capture is thorough), so a null reads as
  // zero rather than disqualifying the ratio, but when interest proves the debt is grossly
  // under-captured the invested-capital base is unknowable, so we decline the figure.
  if (!debtReliable(L)) return null;
  const debt = L.totalDebt || 0;
  const invested = debt + eq - (L.cashAndEquivalents || 0);
  if (invested <= 0) return null;
  const tax = L.incomeTaxExpense, ni = L.netIncome;
  // The numerator is the after-tax operating profit available to ALL capital. The operating line
  // should exceed pretax income by roughly the interest bill (interest being debt's share of the
  // return); when, NET of a known interest bill, it still exceeds pretax by far more, large
  // non-operating charges (impairments, pension, equity-method losses) sit below the operating line,
  // so it overstates what the capital earned — decline rather than print an inflated figure (Alcoa:
  // a ~48% print on a true ~16% return). Only when interest is actually tagged: with interest
  // unknown we cannot tell a real interest gap from a non-operating one, so we leave it alone.
  const pretax = ni != null && tax != null ? ni + tax : null;
  const ie = L.interestExpense;
  if (pretax != null && ie != null && ie > 0 && oi > 0 && oi - Math.abs(ie) > pretax * 1.5) return null;
  let t = 0.21;
  if (tax != null && ni != null && ni + tax > 0) t = Math.min(Math.max(tax / (ni + tax), 0), 0.5);
  const r = (oi * (1 - t)) / invested;
  // When invested capital is a thin sliver — a distributor running on negative working capital, or a
  // company whose buybacks have driven equity near zero — the denominator is unstable and the ratio
  // explodes into a figure no owner could underwrite (McKesson printing ~230%, not a real return on
  // capital). Decline it; the asset-light story still shows in the margins. A genuinely high-return
  // franchise (Apple, Mastercard) tops out well under this, on a base that is a real fraction of sales.
  if (r > 1.0 && (!L.revenue || invested < 0.06 * L.revenue)) return null;
  return r;
}

export function operatingMargin(L) {
  if (!revenueIsScale(L)) return null; // revenue under a tenth of what the business spent
  return L && L.operatingIncome != null && L.revenue ? L.operatingIncome / L.revenue : null;
}

// IS REVENUE THIS BUSINESS'S SCALE? A per-revenue ratio divides by revenue, so it only describes a
// business whose revenue is what the business runs on. A clinical-stage biotech with $2.1M of
// licensing revenue and $292M of costs has an operating margin of minus 13,907%. The arithmetic is
// correct and the figure describes nothing: it is a statement about a denominator, not about a
// company. Owner ruling, 2026-07-27 — withhold the rate and let the dollars speak, which the record
// table already does.
//
// THE THRESHOLD IS MEASURED, NOT CHOSEN, and the data separated itself. Across 32,829 company-years,
// revenue as a share of what the business spent (revenue less operating income): the years carrying a
// ratio beyond 1,000% top out at 0.0909, and ordinary years — an operating margin inside plus or
// minus 100% — begin at 0.5644 at their first percentile. There is a clear gap between the two
// populations and nothing lives in it. A cut at one tenth catches 784 of 784 absurd years and costs
// ZERO ordinary years, so this is a rule the pool drew rather than one imposed on it.
//
// This is the discipline the grouping tables already applied through oiReliable() and the company
// page never received, which is why 808 company pages carried such a figure against 35 grouping
// pages. Gross margin was the only guarded ratio on the site and is the only one with none.
export function revenueIsScale(L) {
  if (!L || !(L.revenue > 0)) return true; // nothing to judge on
  if (L.operatingIncome != null) {
    const spent = L.revenue - L.operatingIncome;
    if (!(spent > 0)) return true; // spent nothing measurable; not the case this guards
    return L.revenue / spent >= 0.1;
  }
  // NO OPERATING INCOME TAGGED — the first anchor's blind spot, and how Lyell Immunopharma printed
  // an owner-earnings margin of minus 418,900%: the gate had nothing to judge on and passed it
  // through. The second witness is the cash the business actually ran on that year — operating cash
  // flow plus capital spending, same period, present whenever an owner-earnings margin computes at
  // all. Measured over the 193 null-operating-income company-years: the absurd years top out at
  // 0.0587 and ordinary years begin at 0.6652, so the pool separates again, at the SAME tenth used
  // above — one rule, two witnesses, both drawn by the data. 9 of 9 caught, 0 ordinary years lost.
  const cash = Math.abs(L.cashFromOps ?? 0) + Math.abs(L.capex ?? 0);
  if (!(cash > 0)) return true; // no second witness either; nothing to judge on
  return L.revenue / cash >= 0.1;
}

// Gross margin, with an arithmetic sanity check: it can never sit below the operating margin
// (operating profit is gross profit less operating costs, which are not negative). When it computes
// below — a cost-of-revenue line mis-tagged, printing a negative gross beside a healthy operating
// margin, as GE's does — the cost figure is wrong, so withhold rather than render an impossible number.
export function grossMargin(L) {
  if (!L || !L.revenue || L.costOfRevenue == null) return null;
  // A COST OF REVENUE UNDER A HUNDREDTH OF REVENUE IS A FRAGMENT, NOT A TOTAL. The fetcher has
  // applied this floor to the record's own years since the CenterPoint case (a utility that buys
  // fuel, tagging $4M against $9,337M and printing a 100% gross margin), but it never reached the
  // TRAILING-TWELVE-MONTHS block: fetchFundamentals wrote the guarded value to rec.ttm.costOfRevenue
  // while the figures live at rec.ttm.lines.costOfRevenue, so the assignment landed on a property
  // nothing reads and the raw fragment shipped. Oracle carried $2,057M — an element it abandoned in
  // 2011 — against $67.4B of revenue, printing a 96.9% gross margin on its compare card and into the
  // Almanac's census median. 167 records were above 90%, one of them (GPGI) at 195.8%, which requires
  // a negative cost of sales.
  //
  // The floor belongs HERE as well as in the fetcher. A function that turns a cost line into a margin
  // is the right place to refuse a cost line that cannot be one, and putting it here fixes every
  // surface against the data already on disk rather than waiting on the next full refetch. A negative
  // cost line fails the same test, which is why 195.8% goes with it.
  if (L.costOfRevenue / L.revenue < 0.01) return null;
  const gm = 1 - L.costOfRevenue / L.revenue;
  const om = L.operatingIncome != null ? L.operatingIncome / L.revenue : null;
  if (om != null && gm < om - 0.01) return null;
  // A backstop for years that carry no operating income to check against: a gross margin below −100%
  // (cost of revenue more than double the top line) is never real — it means the cost line was
  // mis-tagged or the top line understated (Archer-Daniels printed −201%, Bunge −295%). Withhold it.
  if (gm < -1) return null;
  // The same impossibility on the high side: an inventory-intensive goods business holding 15%+ of its
  // revenue in inventory has a real, large cost of goods, so a near-100% gross margin means the cost
  // line was mis-tagged near zero (Caterpillar's 2022+ printed 100% on $18B of inventory). Withhold it
  // the way the negative side is withheld. A genuinely high-margin business — software, a drug — carries
  // only token inventory and reads through untouched.
  if (gm >= 0.92 && L.inventory != null && L.inventory > L.revenue * 0.15) return null;
  return gm;
}

// The single-year grossMargin() above can't see the record, so it can't catch the other cost-of-revenue
// mis-tag: a company whose gross margin SWINGS between a clearly moderate year (under ~60%) and a
// near-total one (≥85%). A real business holds a roughly steady gross margin — it does not go from 16%
// to 95% and back — so the near-total years are a captured-near-zero cost line, an impossible ~100%
// margin (an auto dealer, a distributor, a utility reading 100% one year and 20% the next). A genuinely
// high-margin business — software, a drug — holds a stable high margin and never dips to a moderate year,
// so it is never caught. These two helpers let the record table, the vital-signs strip and the
// believability gate withhold the same corrupt cells from a series the per-year function can't judge.
function grossMarginRecord(company) {
  return (company?.history || [])
    .filter((h) => h?.lines)
    .map((h) => ({ fy: h.fy, gm: grossMargin(h.lines) }))
    .filter((r) => r.gm != null);
}
export function grossMarginSwings(company) {
  const ser = grossMarginRecord(company);
  return ser.length >= 3 && Math.min(...ser.map((r) => r.gm)) < 0.6;
}
// True when a gross-margin reading sits anomalously high against a record that already dips to a
// moderate year — the cost-of-revenue-captured-near-zero artifact. A sticky cost structure does not
// double overnight, so a year at least twice the record's median and 25+ points above it (or simply
// near-total, ≥85%) is a tagging error, not a real jump. Keying off the full-series median tells a
// temporary spike (a minority of years; the median stays low, so the spike is flagged — Worthington's
// 81%, AAR's 50%) from a genuine step-up (the new level becomes the majority, the median rises with
// it, nothing is flagged). Shared so the record table can judge a TTM cell, which carries no fiscal
// year to look up, by exactly the same rule as the dated years.
export function gmCorrupt(gm, company) {
  if (gm == null || !grossMarginSwings(company)) return false;
  const ms = grossMarginRecord(company).map((r) => r.gm).sort((a, b) => a - b);
  const med = ms[Math.floor(ms.length / 2)];
  return gm >= 0.85 || (med != null && gm >= med * 2 && gm >= med + 0.25);
}
export function corruptGrossMarginYears(company) {
  if (!grossMarginSwings(company)) return new Set();
  return new Set(grossMarginRecord(company).filter((r) => gmCorrupt(r.gm, company)).map((r) => r.fy));
}

export function ownerEarningsMargin(L, company) {
  if (!L || L.cashFromOps == null || L.capex == null || !L.revenue) return null;
  if (!revenueIsScale(L)) return null; // a rate per dollar of revenue, where revenue is not the scale
  // Buffett's owner earnings: operating cash less maintenance capex, not total capex (which would be
  // free cash flow). `company` carries the record the growth test needs; without it we fall back to
  // total capex, so a stray call can never read higher than free cash flow.
  const maint = company ? maintenanceCapexFor(L, company) : Math.abs(L.capex);
  return (L.cashFromOps - maint) / L.revenue;
}

// The through-cycle reading of a per-year metric: its median across the record (up to the ~10 years
// of history we hold). Graham and Buffett judge a business on its normalized record, not one peak or
// trough year ("average out the good and bad years"), and a full cycle for a cyclical runs longer
// than five years, so we take the whole record — the same window the durability read and the
// business brief already use, so the page agrees with itself. Median, not mean, so a single freak
// year doesn't drag the read. Null below three years, where the caller falls back to the latest year.
export function throughCycle(company, metricFn, n = 12) {
  const hist = Array.isArray(company?.history) ? company.history : [];
  const vals = hist.map((h) => metricFn(h?.lines)).filter((v) => v != null && Number.isFinite(v));
  if (vals.length < 3) return null;
  const recent = vals.slice(-n);
  const sorted = [...recent].sort((a, b) => a - b);
  // The true median, averaging the two middle years on an even-length record. This used to take the
  // lower of the two, which is a defensible convention on its own and indefensible alongside
  // peers.mjs, which averages them: the grouping table and the peer table both printed "median over
  // the record" and, for any company with an even number of readable years, printed different
  // numbers for it. One concept must have one definition, and the standard one wins.
  const m = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  return { median, n: recent.length, lo: sorted[0], hi: sorted[sorted.length - 1] };
}

// The same reading, WITHOUT the three-year floor, plus the count of years it was read on.
//
// throughCycle above returns null under three readable years, on the reasoning that one year dressed
// as a level is a lie. That is right about the label and wrong about the figure: a two-year-old filer
// has a real record, just a short one, and blanking it tells the reader nothing where saying "two
// years" tells them everything. Owner ruling, 2026-07-27: normalized figures where we can, single
// years where we must, and the surface says which.
//
// The count is not decoration. It is what makes the header true — a table whose note claims every
// figure is a through-cycle median is making a false claim on any cell built from one year, and 3,720
// peer-table cells across 1,127 pages were exactly that. Callers print `years` wherever it is under
// three.
//
// Same 12-year window as throughCycle, deliberately: the two must never disagree on a company with a
// long record, and they are the same function above that floor.
// `of` is how many years the record HOLDS, against the `years` that were readable. The difference
// matters more than it looks. Cigna's return on tangible equity read 27.6% off two years out of ten,
// because its tangible equity went negative in 2018 and never came back — so the figure described a
// company that stopped existing when Express Scripts was bought, printed beside a Tangible equity
// cell reading minus $31.8B. The readable years are not a sample of the record; they are a selection,
// and the reason a year is missing is often the most important fact on the row. A caller that prints
// a figure read on three of ten years without saying so is making a normalized claim it has not
// earned, which is why both counts travel.
export function recordMedian(company, metricFn, n = 12) {
  const hist = Array.isArray(company?.history) ? company.history : [];
  const vals = hist.map((h) => metricFn(h?.lines || {}, company)).filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) {
    // No readable history at all. The latest figures still describe a year of the business, so they
    // are read as the one-year record they are rather than discarded.
    const latest = metricFn(company?.lines || {}, company);
    return latest != null && Number.isFinite(latest) ? { value: latest, years: 1, of: 1 } : null;
  }
  const recent = vals.slice(-n);
  const sorted = [...recent].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return {
    value: sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2,
    years: recent.length,
    of: Math.min(hist.length, n) || recent.length,
  };
}

// Whether a reading has to say what it rests on: too short to normalize at all (under three years),
// or read on under half a record it could have been read across. Both are the same failure to a
// reader — a figure that looks like a level and is not one — so both carry the count.
export function shortRecord(r) {
  return !!r && r.years != null && (r.years < 3 || (r.of != null && r.years * 2 < r.of));
}

// Read a yearly series the way an owner does — through the cycle, not on the endpoints. The single-year
// reporting calendar is an accident of accounting that GBM look through, so "this year's margin vs the
// one ten years ago" is a trap: a lone trough, a peak, or a one-off charge at either endpoint can make
// a flat business look like it's falling apart (or the reverse). Instead this compares the AVERAGE of the
// early years to the AVERAGE of the recent years, with the smoothing window adapting to how much record
// exists, and reports the through-cycle MEDIAN as the representative level. It also separates a cyclical
// dip — the recent average dragged down by a trough year the latest year has already climbed back out of
// — from a structural drift, where the level itself has moved and stayed.
//
// `values` are chronological (oldest→newest); nulls are dropped. `band` is the change, in the series'
// own units, below which the trend reads flat (e.g. 0.02 for a two-point margin move). Returns null when
// the record is too short to normalize at all (under three years); returns a level with a null direction
// when there's enough to state a level but too little (under four years) to call a trend without leaning
// on the very endpoints this exists to avoid. Window adapts: 3-year ends on a decade, down to 2 on a
// half-decade, never overlapping.
export function normalizedTrend(values, { band = 0.02, maxWindow = 3 } = {}) {
  const v = (values || []).filter((x) => x != null && Number.isFinite(x));
  if (v.length < 3) return null;
  const n = v.length;
  const sorted = [...v].sort((a, b) => a - b);
  const level = sorted[Math.floor((n - 1) / 2)]; // through-cycle median: where the metric actually runs
  const w = Math.min(maxWindow, Math.floor(n / 2)); // non-overlapping smoothed ends, sized to the record
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const early = mean(v.slice(0, w)), recent = mean(v.slice(-w)), latest = v[n - 1];
  const delta = recent - early;
  let direction = null, cyclical = false;
  if (n >= 4) { // four years buys two non-overlapping ends; below that, a level only, never endpoints
    // Material move: meaningful in absolute points OR as a fraction of where the metric runs. A fat
    // margin drifting a single point isn't over-read; a thin margin that halves — small in points, large
    // in truth — isn't dismissed as "steady". The absolute floor stops a near-zero level (3 bps → 9 bps)
    // from reading as a "tripling".
    const aLevel = Math.abs(level);
    const material = Math.abs(delta) >= band || (aLevel > band && Math.abs(delta) >= aLevel * 0.2);
    if (!material) direction = "flat";
    else if (delta > 0) direction = "up";
    else {
      // a recent-average drop the latest year has already recovered from is a trough dragging the window,
      // not a one-way slide — name it cyclical and read across the cycle, don't cry decline. Recovery is
      // judged relative to the early level, so a thin margin isn't called "recovered" merely because
      // everything sits within a couple of points of everything else.
      const recovered = early > 0 ? latest >= early * 0.9 : latest >= early - band;
      if (recovered) { direction = "flat"; cyclical = true; }
      else direction = "down";
    }
  }
  return { n, window: w, level, early, recent, latest, delta, direction, cyclical };
}

// (The former durability() export was removed: it was dead code, and being the one consumer of
// roicValue() that did not re-apply the oiReliable/financial-kind gate the rendered surfaces use,
// it was also the only place a Japanese trading house's meaningless operating line could have
// produced a ROIC. The live read is moatReport() in durability.mjs.)

// Assemble the panel, grouped into the two questions Graham and Buffett asked.
export function buildScorecard(company) {
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const cov = coverage(company);
  const covV = coverageVerdict(cov);
  const coverageCheck = {
    title: "Can it pay its interest?",
    concept: "interest-coverage",
    value: cov?.ratio != null ? `${cov.ratio.toFixed(1)}×` : "—",
    formula: cov && (cov.notMeaningful || cov.untagged) ? "" : cov && !cov.noBurden ? `Operating income ${$(cov.oi)} ÷ interest expense ${$(cov.interest)}` : "Little or no interest expense reported",
    tone: covV.tone,
    label: covV.label,
    note: covV.note,
  };

  const wrap = (title, concept, result) =>
    result
      ? { title, concept, ...result }
      : { title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note: "The filing data didn't include the inputs for this check." };

  // Capex is always shown: the AI build-out is turning historically asset-light names (cloud,
  // search, social) into heavy spenders, and that shift is exactly what an owner must see.
  const cashUseChecks = [
    wrap("Where do the earnings go?", "incremental-roic", capitalAllocation(company)),
    wrap("Investing or harvesting?", null, capexVsDepreciation(company)),
  ];

  // One leverage read, not two adjacent checklist lines, and ONE BASIS in the headline: the net
  // dollar and the net multiple of operating profit, the pair the note narrates. (The old headline
  // paired the net dollar with the GROSS multiple, labeled "gross" — and on a cash-light balance
  // sheet the two multiples display identically, so the note's "versus the gross figure beside it"
  // read as a self-contradiction. The gross multiple now appears in the note, and only when it
  // differs at display precision.)
  const cp = cashPosition(company);
  const lev = leverage(company);
  const netYears = cp && cp.years != null ? ` · ${cp.years.toFixed(1)}× operating profit` : "";
  const debtCheck = cp
    ? { title: "How heavy is the debt, net of cash?", concept: "net-debt", value: `${cp.value}${netYears}`, formula: cp.formula, tone: cp.tone, label: cp.label, note: cp.note }
    : wrap("How heavy is the debt, net of cash?", "net-debt", lev);

  return {
    sections: [
      {
        heading: "Will it survive?",
        checks: [
          coverageCheck,
          debtCheck,
          wrap("How long is cash tied up?", "cash-conversion-cycle", cashConversionCycle(company)),
        ],
      },
      {
        heading: "Is it a good business?",
        checks: [
          wrap("Return on invested capital", "roic", roic(company)),
          wrap("Owner-earnings margin", "owner-earnings", ownerCash(company)),
          wrap("Are earnings backed by cash?", "free-cash-flow", earningsQuality(company)),
        ],
      },
      {
        heading: "How is the cash used?",
        checks: cashUseChecks,
      },
      // The software desk's section, appended rather than substituted: a subscription business is
      // still an ordinary business, so the general reads above all apply. This adds only what the
      // general scorecard cannot ask — how much of next year is already contracted, what winning
      // a customer costs, and whether the buyback is buying ownership or cancelling the pay
      // packet. Absent for every company that carries none of those figures.
      ...(softwareSection(company) ? [softwareSection(company)] : []),
      // The oil & gas desk's section, appended on the same terms: a producer is still an ordinary
      // business, so everything above applies. This adds only what the general reads cannot ask —
      // how many years of production remain, whether the company replaced what it sold, and how
      // much of "proved" is still a plan. Absent for every company without the ASC 932 schedule.
      ...(oilGasSection(company) ? [oilGasSection(company)] : []),
    ],
  };
}
