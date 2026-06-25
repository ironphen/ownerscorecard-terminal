// Shared, framework-agnostic compute for the fundamentals tools.
// Imported by both Astro pages (server) and React islands (client), so keep it
// pure ESM with no Node or browser built-ins.
import { financialKind } from "./archetype.mjs";

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
  const oi = company?.lines?.operatingIncome;
  const interest = company?.lines?.interestExpense;
  if (oi == null) return null;
  if (!oiReliable(company)) return { ratio: null, oi, interest, notMeaningful: true };
  if (interest == null) return { ratio: null, oi, interest: null, noBurden: true };
  if (interest <= 0) return { ratio: null, oi, interest, noBurden: true };
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

  let tone, label;
  if (netCash) { tone = "good"; label = gross === 0 ? "Net cash, debt-free" : "Net cash"; }
  else if (net === 0) { tone = "good"; label = "Cash equals debt"; }
  else if (years != null && years < 2) { tone = "ok"; label = "Modest net debt"; }
  else if (years != null && years < 4) { tone = "warn"; label = "Meaningful net debt"; }
  else if (years != null) { tone = "bad"; label = "Heavy net debt"; }
  else { tone = "warn"; label = "Net debt"; }

  const value = netCash ? `+${$(-net)}` : $(net);
  const formula =
    `Cash ${$(cash || 0)}` + (st ? ` + ST investments ${$(st)}` : "") + ` − debt ${$(gross)}`;

  let note = netCash
    ? `Cash and short-term investments exceed every dollar of debt by ${$(-net)}, on net the company owes nothing, and can act from strength when others can't.`
    : `Netting ${$(liquid)} of cash and short-term investments against ${$(gross)} of debt leaves ${$(net)} owed${years != null ? `, about ${years.toFixed(1)}× a year's operating profit, versus the gross figure above` : ""}.`;
  if (lt) {
    const full = net - lt;
    note += ` It also holds ${$(lt)} in longer-dated marketable securities; counting those, it sits at ${full < 0 ? `net cash of ${$(-full)}` : `${$(full)} of net debt`}.`;
  }
  note += " Net debt is the leverage figure that matters; the gross ratio above ignores the cash already set against it. Strategic or illiquid investments aren't counted here.";
  return { value, formula, tone, label, note };
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
  const label = (j < 0.08 ? "Below average" : j < 0.15 ? "Solid" : j < 0.25 ? "High" : "Exceptional") + (tc ? " through the cycle" : "");
  return {
    value: tc ? pct(j) : pct(r),
    formula: tc
      ? `${tc.n}-yr median, range ${pct(tc.lo)}–${pct(tc.hi)}` + (r != null
          ? `; ${pct(r)} latest = NOPAT ${$(nopat)} ÷ invested capital ${$(invested)}`
          : `; the latest year is left out — large non-operating charges put its operating line well above pretax profit`)
      : `NOPAT ${$(nopat)} ÷ invested capital ${$(invested)} (debt + equity − cash)`,
    tone,
    label,
    note: "The rate the business earns on the money tied up in it, Buffett's north star, because over time a stock tracks the ROIC beneath it. Above ~15% sustained hints at a moat; below ~8% the company may destroy value as it grows."
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
  const j = tc ? tc.median : margin;
  const tone = j == null ? (oe <= 0 ? "bad" : "ok") : j <= 0 ? "bad" : j < 0.05 ? "warn" : j < 0.15 ? "ok" : "good";
  const base = j == null ? (oe <= 0 ? "Consumes cash" : "Positive") : j <= 0 ? "Consumes cash" : j < 0.05 ? "Thin" : j < 0.15 ? "Solid" : "Cash machine";
  return {
    value: tc ? pct(j) : margin != null ? pct(margin) : $(oe),
    formula: tc
      ? `${tc.n}-yr median margin, range ${pct(tc.lo)}–${pct(tc.hi)}; latest ${$(oe)} = operating cash ${$(cfo)} − maintenance capex ${$(maint)}`
      : `Owner earnings ${$(oe)} = operating cash ${$(cfo)} − maintenance capex ${$(maint)}`,
    tone,
    label: base + (tc ? " through the cycle" : ""),
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
export function ownerEarningsBridge(c) {
  const L = c?.lines || {};
  const ni = L.netIncome, cfo = L.cashFromOps, capex = L.capex;
  if (ni == null || cfo == null || capex == null) return null;
  const dep = L.depreciation != null ? L.depreciation : null;
  const sbc = L.stockBasedComp != null ? L.stockBasedComp : null;
  const capexAbs = Math.abs(capex);
  const other = cfo - ni - (dep || 0) - (sbc || 0);
  const maint = maintenanceCapex(c) ?? capexAbs;
  const growth = Math.max(0, capexAbs - maint);
  return {
    fy: c.fy ?? null,
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

// Capital allocation: of the Owner Earnings, how much was returned, and was it real?
export function capitalAllocation(c) {
  const $ = (v) => fmtMoney(v, c?.currency || "USD");
  const L = c?.lines || {};
  const cfo = L.cashFromOps, capex = L.capex, div = L.dividendsPaid, bb = L.buybacks;
  if (cfo == null || capex == null || (div == null && bb == null)) return null;
  const oc = cfo - Math.abs(capex);
  if (oc <= 0)
    return { value: "—", formula: "", tone: "warn", label: "No surplus to allocate", note: "The business didn't generate positive Owner Earnings this year, so any distributions came from the balance sheet or borrowing, not from operations." };
  const dividends = Math.abs(div || 0), buybacks = Math.abs(bb || 0), sbc = L.stockBasedComp;
  const returned = dividends + buybacks;
  const payout = returned / oc;
  const label = payout >= 0.9 ? "Returns most of it" : payout >= 0.4 ? "Returns about half" : "Reinvests most of it";
  let note = `Of ${$(oc)} Owner Earnings, ${$(returned)} (${(payout * 100).toFixed(0)}%) went back to shareholders, ${$(dividends)} dividends, ${$(buybacks)} buybacks.`;
  if (buybacks > 0 && sbc != null)
    note += buybacks - sbc <= 0
      ? ` But the buybacks barely exceed stock issued to employees (${$(sbc)} SBC), net of dilution, little was truly returned.`
      : ` Net of ${$(sbc)} stock comp, the real buyback was about ${$(buybacks - sbc)}.`;
  note += " Returning most of it signals a mature cash machine; reinvesting most could mean a long runway, or empire-building. The split doesn't say which; the return earned on it (see ROIC) does.";
  return { value: `${(payout * 100).toFixed(0)}%`, formula: `Dividends + buybacks ${$(returned)} ÷ Owner Earnings ${$(oc)}`, tone: "info", label, note };
}

// Cash-conversion cycle: DSO + DIO − DPO (days). A liquidity check that doubles
// as a moat detector, a negative cycle means others fund the business.
export function cashConversionCycle(c) {
  const L = c?.lines || {};
  const rev = L.revenue, cogs = L.costOfRevenue, recv = L.receivables, ap = L.accountsPayable;
  if (rev == null || cogs == null || recv == null || ap == null || cogs <= 0 || rev <= 0) return null;
  const inv = L.inventory;
  const hasInv = inv != null && inv > 0;
  const dso = (recv / rev) * 365;
  const dio = hasInv ? (inv / cogs) * 365 : 0;
  const dpo = (ap / cogs) * 365;
  const ccc = dso + dio - dpo;
  const tone = ccc < 0 ? "good" : ccc < 60 ? "ok" : "warn";
  const label = ccc < 0 ? "Negative, funded by others" : ccc < 60 ? "Tight" : "Capital-hungry";
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
  return L && L.operatingIncome != null && L.revenue ? L.operatingIncome / L.revenue : null;
}

// Gross margin, with an arithmetic sanity check: it can never sit below the operating margin
// (operating profit is gross profit less operating costs, which are not negative). When it computes
// below — a cost-of-revenue line mis-tagged, printing a negative gross beside a healthy operating
// margin, as GE's does — the cost figure is wrong, so withhold rather than render an impossible number.
export function grossMargin(L) {
  if (!L || !L.revenue || L.costOfRevenue == null) return null;
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
export function corruptGrossMarginYears(company) {
  if (!grossMarginSwings(company)) return new Set();
  return new Set(grossMarginRecord(company).filter((r) => r.gm >= 0.85).map((r) => r.fy));
}

export function ownerEarningsMargin(L, company) {
  if (!L || L.cashFromOps == null || L.capex == null || !L.revenue) return null;
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
  return { median: sorted[Math.floor((sorted.length - 1) / 2)], n: recent.length, lo: sorted[0], hi: sorted[sorted.length - 1] };
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
    formula: cov && cov.notMeaningful ? "" : cov && !cov.noBurden ? `Operating income ${$(cov.oi)} ÷ interest expense ${$(cov.interest)}` : "Little or no interest expense reported",
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

  return {
    sections: [
      {
        heading: "Will it survive?",
        checks: [
          coverageCheck,
          wrap("How heavy is the debt?", "net-debt", leverage(company)),
          wrap("Debt, net of cash", "net-debt", cashPosition(company)),
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
    ],
  };
}
