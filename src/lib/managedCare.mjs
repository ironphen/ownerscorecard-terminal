// Managed care (health plans): UNH, Cigna, Humana, Elevance, Centene. These look like
// insurers on the SEC's books, but they are not the float-and-combined-ratio business
// Buffett means by "insurer." A health plan pays most claims within weeks, so there is
// almost no investable float; the whole game is the medical loss ratio (the share of
// premiums paid back out as care), a thin operating margin earned on enormous volume,
// and membership growth across commercial, Medicare and Medicaid. A regulated floor
// (the ACA requires roughly 80-85% of premiums be spent on care or rebated) caps how
// wide that spread can ever be. Arithmetic on the filings; the verdict is the reader's.

import { fmtMoney, operatingMargin } from "./fundamentals.mjs";
import { returnOnEquity } from "./financials.mjs";

const pc = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Medical loss ratio: medical costs over premiums earned. Guarded to a believable band,
// because some filers tag only a slice of premiums (Centene shows a nonsense 364%
// otherwise), in which case we'd rather show nothing than a wrong number.
export function medicalLossRatio(L) {
  if (!L || L.claimsIncurred == null || !L.premiumsEarned) return null;
  const r = Math.abs(L.claimsIncurred) / L.premiumsEarned;
  return r >= 0.6 && r <= 1.1 ? r : null;
}

export function buildManagedCareScorecard(company) {
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const L = company?.lines || {};
  const none = (title, note, concept = null) => ({ title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note });

  const mlr = medicalLossRatio(L);
  // The withhold walls (managed-care desk, ratified 2026-07-21), each naming its reason: a filer
  // whose premiums are filed only on segment axes (Centene) fails the accuracy test any blended
  // proxy would flunk; a filer whose medical costs live only in extension tags (Alignment) has no
  // honestly computable ratio. The absence is information the reader can price.
  const mlrWallNote = L.premiumsEarned == null && L.claimsIncurred != null
    ? "This filer's premium revenue is filed only on segment axes the SEC's structured data omits, and a blended proxy misses its own reported ratio by more than a point — withheld rather than approximated."
    : L.claimsIncurred == null && L.premiumsEarned != null
    ? "This filer's medical costs live only in its own extension tags, outside the standard taxonomy — the ratio is not honestly computable from structured data, and the absence is itself worth knowing."
    : "Premiums or medical claims weren't cleanly tagged in the filing data.";
  const mlrCheck = mlr == null ? none("Medical loss ratio", mlrWallNote, "medical-loss-ratio") : {
    title: "Medical loss ratio",
    concept: "medical-loss-ratio",
    value: pc(mlr, 1), formula: `Medical costs ${$(Math.abs(L.claimsIncurred))} ÷ premiums earned ${$(L.premiumsEarned)}`,
    tone: mlr < 0.82 ? "info" : mlr < 0.87 ? "good" : mlr < 0.9 ? "ok" : mlr < 0.93 ? "warn" : "bad",
    label: mlr < 0.82 ? "Low, near the rebate floor" : mlr < 0.87 ? "Profitable band" : mlr < 0.9 ? "Costs well-covered" : mlr < 0.93 ? "Costs running high" : "Little spread on premiums",
    note: "The number that runs a health plan: cents of every premium dollar paid back out as medical care. A regulated floor (about 80-85% under the ACA, or rebates are owed) means the plan keeps only a thin sliver, so the discipline is in pricing premiums ahead of medical cost trend. Read it across years, because a single bad cost trend, like the recent Medicare Advantage squeeze, shows up here first.",
  };

  const om = operatingMargin(L);
  const omCheck = om == null ? none("Operating margin", "Operating income or revenue missing.", "operating-margin") : {
    title: "Operating margin",
    concept: "operating-margin",
    value: pc(om, 1), formula: `Operating income ${$(L.operatingIncome)} ÷ revenue ${$(L.revenue)}`,
    tone: om < 0.02 ? "bad" : om < 0.04 ? "warn" : om < 0.06 ? "ok" : "good",
    label: om < 0.02 ? "Very thin (<2%)" : om < 0.04 ? "Thin, as the model runs" : om < 0.06 ? "Typical for a plan" : "Wide for a plan",
    note: "Health plans earn a sliver on enormous revenue, so a few points of margin is the norm and the business is really a volume-and-cost-control game. Because the margin is so thin, a small miss on medical costs swings profit hard, which is why membership scale and cost management matter more than price.",
  };

  const roe = returnOnEquity(L);
  const roeCheck = roe == null ? none("Return on equity", "Net income or equity missing.", "return-on-equity") : {
    title: "Return on equity",
    concept: "return-on-equity",
    value: pc(roe), formula: `Net income ${$(L.netIncome)} ÷ equity ${$(L.stockholdersEquity)}`,
    tone: roe < 0 ? "bad" : roe < 0.1 ? "warn" : roe < 0.13 ? "ok" : "good",
    label: roe < 0 ? "Loss on equity" : roe < 0.1 ? "Below the cost of equity" : roe < 0.15 ? "Solid" : "Strong",
    note: "The thin margin turns over fast on a modest capital base, so a plan earning its keep still shows a good return on equity. Durably above the ~10% cost of equity is what compounds value; a year below it usually means medical costs outran premiums.",
  };

  // The claims and the reserves (the desk's second section, ratified 2026-07-21): a health
  // plan's float is small and fast, so the reserve reads are velocity reads.
  const H = company?.history || [];

  // Days claims payable: the claims liability against average daily medical costs (annual
  // average, basis labeled — the ratified convention; it lands within ~1.5 days of the filers'
  // own printed figures). The trend is the tell: a shrinking cushion while margins hold is
  // tomorrow's earnings borrowed from the reserve.
  const dcpOf = (l) => (l?.lossReserves != null && l?.claimsIncurred ? l.lossReserves / (Math.abs(l.claimsIncurred) / 365) : null);
  const dcp = dcpOf(L);
  const dcpSeries = H.map((h) => dcpOf(h.lines)).filter((v) => v != null && Number.isFinite(v));
  const dcpMed = median(dcpSeries.length >= 3 ? dcpSeries : []);
  const thinning = dcp != null && dcpMed != null && dcp < dcpMed - 5;
  const dcpCheck = dcp == null ? none("Days claims payable", "The claims liability or medical costs weren't cleanly tagged.", "medical-loss-ratio") : {
    title: "Days claims payable",
    concept: "medical-loss-ratio",
    value: `${dcp.toFixed(0)} days`,
    formula: `Claims payable ${$(L.lossReserves)} ÷ daily medical costs (annual average)${dcpMed != null ? ` · record median ${dcpMed.toFixed(0)} days` : ""}`,
    tone: thinning ? "warn" : dcp >= 35 && dcp <= 60 ? "ok" : "info",
    label: thinning ? "Cushion thinning against its own record" : "The reserve cushion, in days",
    note: "How many days of medical costs the plan holds in reserve against claims already incurred. The level varies by book; the TREND is the honesty read — a cushion shrinking against the company's own history while margins hold means earnings are being helped by the reserve, the fast-float version of under-reserving.",
  };

  // Prior-year development: the same honesty meter the insurers carry, here on a fast book —
  // and for a pure health insurer the short-duration book IS the enterprise.
  const devSeries = H.map((h) => ({ fy: h.fy, v: h?.lines?.reserveDevelopmentPriorYear })).filter((x) => x.v != null);
  const devLatest = devSeries.length ? devSeries[devSeries.length - 1] : null;
  const favYears = devSeries.filter((x) => x.v < 0).length;
  const unfavYears = devSeries.filter((x) => x.v > 0).length;
  const devCheck = !devSeries.length
    ? none("Reserve development", "Not disclosed in the filings' structured data.", "medical-loss-ratio")
    : {
      title: "Reserve development",
      concept: "medical-loss-ratio",
      value: `${devLatest.v < 0 ? "−" : "+"}${$(Math.abs(devLatest.v))}`,
      formula: `Prior-year development, FY${devLatest.fy}: ${devLatest.v < 0 ? "favorable" : "unfavorable"} · record: ${favYears} favorable, ${unfavYears} unfavorable of ${devSeries.length}`,
      tone: devLatest.v < 0 ? "good" : "warn",
      label: devLatest.v < 0 ? "Past estimates held" : "Past reserves fell short",
      note: "Each year the plan restates what last year's claims actually cost once the bills finished arriving. Persistent favorable development means honest reserving; unfavorable means past profits were flattered. Signed as filed: negative favorable. On a book this fast the estimates resolve within a year, so the meter reads management's candor almost in real time.",
    };

  // IBNR share: how much of the claims liability is estimate rather than bill.
  const ibnrShare = L.ibnrAmount != null && L.lossReserves ? L.ibnrAmount / L.lossReserves : null;
  const ibnrCheck = ibnrShare == null ? null : {
    title: "Incurred but not reported",
    concept: "medical-loss-ratio",
    value: pc(ibnrShare),
    formula: `IBNR ${$(L.ibnrAmount)} ÷ claims payable ${$(L.lossReserves)}`,
    tone: ibnrShare >= 0.5 && ibnrShare <= 0.8 ? "info" : "warn",
    label: ibnrShare >= 0.5 && ibnrShare <= 0.8 ? "The estimated share, in the normal band" : "Outside the usual band",
    note: "The share of the claims liability that is an actuarial estimate of care already delivered but not yet billed. Health plans typically run 50-80%; the figure frames how much of the reserve is judgment rather than arithmetic — which is exactly where the development line above keeps score.",
  };

  return {
    sections: [
      { heading: "Is it a good business?", checks: [mlrCheck, omCheck, roeCheck] },
      { heading: "The claims and the reserves", checks: [dcpCheck, devCheck, ...(ibnrCheck ? [ibnrCheck] : [])] },
    ],
  };
}

// The MLR cost-trend tie (qualitative survey Build 11): the render-side re-verification of
// the extraction-time weld. The stored sentence renders ONLY while (a) the fiscal year still
// ties the scorecard's, (b) the desk's medical loss ratio RECOMPUTED from today's lines still
// equals the one the sentence was tiered against (a healed or restated record retires the
// quote rather than sit beside a number it no longer ties), (c) every stated figure is still a
// literal substring of the sentence, and (d) the badge's level still matches at the sentence's
// own declared precision. Returns display fields or null; the computed figures are always
// named as the desk's own, never as the filer's.
export function mlrTrendTie(company, read) {
  if (!read || !read.sentence || String(read.fy) !== String(company?.fy)) return null;
  const cur = medicalLossRatio(company?.lines);
  if (cur == null || read.computed?.pct == null) return null;
  const pct = cur * 100;
  if (Math.abs(pct - read.computed.pct) > 0.05) return null;
  const priorLines = (company?.history || []).find((h) => Number(h.fy) === Number(company.fy) - 1)?.lines;
  const priorMlr = medicalLossRatio(priorLines);
  const priorPct = priorMlr == null ? null : priorMlr * 100;
  if (read.computed.priorPct != null && (priorPct == null || Math.abs(priorPct - read.computed.priorPct) > 0.05)) return null;
  const p1 = (v) => `${v.toFixed(1)}%`;
  const asFiled = "medical costs ÷ premiums earned, as filed";
  if (read.tier === "level") {
    const stated = read.stated || {};
    if (!stated.level || !read.sentence.includes(stated.level)) return null;
    const dp = (v) => (String(v).match(/\.(\d+)/) || [, ""])[1].length;
    if (parseFloat(stated.level).toFixed(dp(stated.level)) !== pct.toFixed(dp(stated.level))) return null;
    if (stated.prior) {
      if (!read.sentence.includes(stated.prior) || priorPct == null) return null;
      if (parseFloat(stated.prior).toFixed(dp(stated.prior)) !== priorPct.toFixed(dp(stated.prior))) return null;
    }
    return {
      tier: "level",
      sentence: read.sentence,
      figs: [stated.level, ...(stated.prior ? [stated.prior] : [])],
      label: "The filer's stated ratio",
      check: `the stated ${stated.level}${stated.prior ? ` and ${stated.prior}` : ""} match the desk's own computed medical loss ratio — ${p1(pct)} in FY${company.fy}${stated.prior && priorPct != null ? `, ${p1(priorPct)} in FY${Number(company.fy) - 1}` : ""} (${asFiled}) — at the sentence's own precision`,
    };
  }
  // Direction-only: the tier needs the prior-year record to still exist and to still move the
  // way the sentence reads.
  if (priorPct == null) return null;
  const delta = pct - priorPct;
  if ((read.dir === "rose") !== (delta > 0)) return null;
  const move = `${read.dir} ${Math.abs(delta).toFixed(1)} points, ${p1(priorPct)} to ${p1(pct)}`;
  if (read.stated?.delta) {
    if (!read.sentence.includes(read.stated.delta)) return null;
    return {
      tier: "direction",
      sentence: read.sentence,
      figs: [read.stated.delta],
      label: "The filer's stated move",
      check: `direction only, no level stated: the desk's own computed medical loss ratio ${move} (${asFiled}); the sentence's ${read.stated.delta} is the filer's own rounding of the same move`,
    };
  }
  return {
    tier: "direction",
    sentence: read.sentence,
    figs: [],
    label: "The cost trend, in management's words",
    check: `direction only: the sentence reads costs as ${read.dir === "rose" ? "outrunning" : "trailing"} premiums, and the desk's own computed medical loss ratio agrees — ${move} (${asFiled})`,
  };
}

export function managedCareQuality(company) {
  const H = (company?.history || []).filter((h) => h?.lines?.revenue != null);
  const mlrSeries = H.map((h) => medicalLossRatio(h.lines)).filter((v) => v != null);
  const omSeries = H.map((h) => operatingMargin(h.lines)).filter((v) => v != null);
  const roeSeries = H.map((h) => returnOnEquity(h.lines)).filter((v) => v != null);
  if (omSeries.length < 3) return null;
  const mlrMed = median(mlrSeries);
  const omMed = median(omSeries);
  const roeMed = median(roeSeries);

  let s1;
  if (mlrMed != null) s1 = `It pays out about ${pc(mlrMed)} of premiums as medical care across the record (the medical loss ratio), keeping the rest to cover administration and profit against a regulated floor`;
  else s1 = "The split between premiums and medical costs is not cleanly tagged in the filings";
  s1 += ".";

  let s2 = "";
  if (omMed != null) s2 = ` That leaves a thin operating margin, a median of about ${pc(omMed, 1)}, the sign of a volume-and-cost-control business rather than a high-margin one`;
  if (roeMed != null) s2 += `${omMed != null ? ", though" : " It"} turns that sliver over fast enough to earn roughly ${pc(roeMed)} on equity`;
  if (s2) s2 += ".";

  const s3 = " Whether membership keeps growing and medical costs stay below premiums, especially as the Medicare Advantage and Medicaid mix shifts, is what the 10-K decides, not an earnings multiple.";
  return { text: [s1, s2, s3].filter(Boolean).join(" ") };
}
