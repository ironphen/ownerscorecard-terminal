// Insurers: Buffett's home turf. An insurer is read on its underwriting discipline,
// the combined ratio (does it pay out less in claims and costs than it takes in
// premiums?), and on the float, the policyholder money it holds and invests before
// claims come due, the closest thing to free leverage there is. Plus the universal
// measure Berkshire itself is judged on: growth in book value per share, and the
// return earned on equity. Underwriting at a profit while the float compounds is the
// whole game. Arithmetic on the filings; the combined ratio here is approximate, built
// from the filer's total benefits, losses and expenses over premiums earned, so
// non-underwriting costs can nudge it a point or two either way from the headline.

import { fmtMoney, currencySymbol } from "./fundamentals.mjs";
import { returnOnEquity } from "./financials.mjs";

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pc = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);

export function lossRatio(L) {
  if (!(L && L.claimsIncurred != null && L.premiumsEarned)) return null;
  const r = Math.abs(L.claimsIncurred) / L.premiumsEarned;
  // Only within a believable P&C band; outside it the claims or premiums tag is wrong (or
  // this isn't a P&C book — a life/annuity or blended total lands above this, as Berkshire's
  // ~108% does). A loss ratio above ~95% already implies a combined ratio well over 100%, so
  // beyond the band we show nothing rather than a graded verdict — the discipline combinedRatio()
  // already applies.
  return r >= 0.4 && r <= 0.95 ? r : null;
}
export function expenseRatio(L) { return L && L.underwritingExpense != null && L.premiumsEarned ? Math.abs(L.underwritingExpense) / L.premiumsEarned : null; }
export function combinedRatio(L) {
  if (!L || !L.premiumsEarned) return null;
  // Use the filer's own all-in total of benefits, losses and expenses over premiums
  // earned. Summing our single expense pick understates the cost side badly (it misses
  // acquisition costs), so we trust only the total tag, and only when it lands in a
  // believable band; otherwise we show the loss ratio alone rather than a wrong figure.
  if (L.lossesAndExpenses != null) {
    const r = Math.abs(L.lossesAndExpenses) / L.premiumsEarned;
    if (r >= 0.6 && r <= 1.6) return r;
  }
  return null;
}
export function insuranceFloat(L) { return L && L.lossReserves != null ? L.lossReserves : null; }
export function floatToEquity(L) { return L && L.lossReserves != null && L.stockholdersEquity ? L.lossReserves / L.stockholdersEquity : null; }

// The desk's float arithmetic (insurance Wave A, ratified 2026-07-21): Buffett's definition,
// computed from the extracted components, with the basis stated and the withholds explicit.
//
//   P&C-shaped book: net loss reserves + (unearned premiums − prepaid reinsurance)
//                    − premiums receivable − DAC
//   Life-shaped book: future policy benefits (or the combined liability where only that is
//                    filed) + policyholder deposits + market risk benefits + unearned premiums
//                    − reinsurance recoverables − DAC − premiums receivable
//
// Withholds, per the ratified spec: a P&C computation without its deduction side (the AIG case)
// returns null rather than an overstated float; a heavy cedent without prepaid reinsurance (the
// NODK case) returns null rather than a gross-of-reinsurance float. A life computation missing a
// deduction is returned WITH the missing pieces named — the ratified labeled-basis treatment —
// because the direction of the error is known and stated. `basis` and `notes` are for display:
// a float figure never prints without its basis.
export function floatOf(L) {
  if (!L) return null;
  const fpb = L.futurePolicyBenefits ?? null;
  const combined = L.fpbCombined ?? null;
  const notes = [];
  const net = L.lossReservesNet ?? (L.lossReserves != null && L.reinsuranceRecoverables != null ? L.lossReserves - L.reinsuranceRecoverables : null);

  // Formula A — the underwriting (P&C-first) book, whenever the claims stack leads: net loss
  // reserves + (unearned premiums − prepaid reinsurance) + any life-benefit reserves and deposits
  // the filer also carries (Chubb's Huatai book) − premiums receivable − DAC. The deduction side
  // is REQUIRED (the AIG withhold), and a heavy cedent without prepaid reinsurance is withheld
  // rather than shown gross of the reinsurers' money (the NODK withhold).
  const pcLeads = net != null && L.unearnedPremiums != null && (fpb == null || net >= fpb);
  if (pcLeads) {
    if (L.premiumsReceivable == null || L.dacBalance == null) return null;
    const ceded = L.cededPremiumsWritten ?? L.cededPremiumsEarned ?? null;
    const cededShare = ceded != null && L.premiumsEarned ? Math.abs(ceded) / L.premiumsEarned : null;
    if (L.prepaidReinsurance == null && cededShare != null && cededShare > 0.15) return null;
    const value = net
      + (L.unearnedPremiums - (L.prepaidReinsurance || 0))
      + (fpb || 0) + (L.policyholderDeposits || 0) + (L.marketRiskBenefits || 0)
      - L.premiumsReceivable - L.dacBalance;
    if (L.lossReservesNet == null) notes.push("net reserves derived as gross less recoverables");
    if (fpb) notes.push("life-benefit reserves gross of their reinsurance");
    return value > 0 ? { value, basis: "pc", notes } : null;
  }

  // Formula B — the life book: future policy benefits (or the combined liability where only that
  // is filed — it already contains the unpaid claims, so the two are never summed) + deposits +
  // market risk benefits + any unearned premiums, less recoverables, DAC and receivables. A
  // missing deduction is named, per the ratified labeled-basis treatment; where net claims
  // reserves ride alongside pure FPB, the full recoverables deduction leans conservative (the
  // claims slice nets twice), which is the direction doctrine tolerates.
  const base = fpb != null ? fpb + (L.lossReservesNet ?? 0) : combined;
  if (base == null) return null;
  let value = base + (L.policyholderDeposits || 0) + (L.marketRiskBenefits || 0) + (L.unearnedPremiums || 0);
  if (L.reinsuranceRecoverables != null) value -= L.reinsuranceRecoverables; else notes.push("recoverables deduction unavailable");
  if (L.dacBalance != null) value -= L.dacBalance; else notes.push("DAC deduction unavailable");
  if (L.premiumsReceivable != null) value -= L.premiumsReceivable; else notes.push("receivables deduction unavailable");
  return value > 0 ? { value, basis: "life", notes } : null;
}

// The underwriting result, from the filer's own all-in total (the same band discipline as
// combinedRatio): what it cost, or paid, to hold the float this year.
export function underwritingResult(L) {
  const cr = combinedRatio(L);
  return cr != null && L.premiumsEarned ? L.premiumsEarned * (1 - cr) : null;
}

// Cost of float, Buffett's arithmetic: the underwriting loss over the float (negative = an
// underwriting PROFIT — the insurer was paid to hold other people's money). P&C books only;
// a life insurer's cost is a crediting spread, not an underwriting result.
export function costOfFloat(L) {
  const f = floatOf(L);
  const uw = underwritingResult(L);
  return f?.basis === "pc" && uw != null && f.value > 0 ? -uw / f.value : null;
}

// The life insurer's published cost side, per the ratified spec: spread over crediting — what
// the portfolio earned less what was credited to policyholders, over the float. (The LDTI
// remeasurement line is extracted but not yet folded in: its sign polarity is not verified
// filer-by-filer, and an unverified sign is a wrong number waiting to print.)
export function spreadOverCrediting(L) {
  const f = floatOf(L);
  if (f?.basis !== "life" || !(f.value > 0)) return null;
  if (L.investmentIncome == null || L.interestCredited == null) return null;
  return (L.investmentIncome - Math.abs(L.interestCredited)) / f.value;
}
export function bookValuePerShare(L) { return L && L.stockholdersEquity != null && L.sharesDiluted ? L.stockholdersEquity / L.sharesDiluted : null; }

export function buildInsurerScorecard(company, subtype = "insurer") {
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const sym = currencySymbol(company?.currency || "USD");
  const L = company?.lines || {};
  const none = (title, note, concept = null) => ({ title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note });

  const roe = returnOnEquity(L);
  const roeCheck = roe == null ? none("Return on equity", "Net income or equity missing.", "return-on-equity") : {
    title: "Return on equity",
    concept: "return-on-equity",
    value: pc(roe), formula: `Net income ${$(L.netIncome)} ÷ equity ${$(L.stockholdersEquity)}`,
    tone: roe < 0 ? "bad" : roe < 0.1 ? "warn" : roe < 0.13 ? "ok" : "good",
    label: roe < 0 ? "Loss on equity" : roe < 0.1 ? "Below the cost of equity" : roe < 0.15 ? "Solid" : "Strong",
    note: "What it earns on shareholders' capital, the underwriting result plus what the float earns invested. Durably above the ~10% cost of equity is what compounds book value.",
  };

  // The float, on the desk's full arithmetic where the Wave A components extract (basis stated),
  // falling back to the old reserves-only reading with its honest caveat where they don't.
  const full = floatOf(L);
  const fl = full?.value ?? insuranceFloat(L);
  const fe = fl != null && L.stockholdersEquity ? fl / L.stockholdersEquity : null;
  const basisNote = full
    ? (full.notes.length ? ` Basis note: ${full.notes.join("; ")}.` : "")
    : " Measured here from loss and claim reserves only; it excludes unearned premiums and funds held, so the true float is somewhat larger than shown.";
  const floatCheck = fl == null ? none("Float", "The float components weren't cleanly tagged, and a partial figure would mislead — withheld rather than approximated.", "insurance-float") : {
    title: full ? "Float" : "Float (reserves)",
    concept: "insurance-float",
    value: $(fl),
    formula: full
      ? (full.basis === "pc"
        ? `Net reserves + unearned premiums − prepaid reinsurance − receivables − DAC = ${$(fl)}`
        : `Policy benefits + deposits + guarantees − recoverables − DAC − receivables = ${$(fl)}`)
      : `Loss and claim reserves ${$(fl)}${fe != null ? `, ${fe.toFixed(1)}× equity` : ""}`,
    tone: "info", label: fe != null ? `${fe.toFixed(1)}× equity` : "policyholder money held",
    note: `Money held against future claims and invested in the meantime. Buffett's insight was that good underwriting makes this float cost less than nothing, a pool of other people's money the owners earn on.${basisNote} The larger it is against equity, the more that leverage works, for better or worse.`,
  };
  const inv = L.investmentIncome;
  // Yield on the float: the full-arithmetic denominator where it exists (the 2026-07-21 float
  // correction), else the old reserves-only ratio behind its plausibility cap.
  const yld = fl && inv != null && inv / fl > 0 && (full || inv / fl <= 0.15) ? inv / fl : null;
  const invCheck = inv == null ? none("Investment income", "Net investment income wasn't found.", "insurance-float") : {
    title: "Investment income",
    concept: "insurance-float",
    value: $(inv), formula: `Net investment income ${$(inv)}${yld != null ? `, ${pc(yld, 1)} on the float` : ""}`,
    tone: "info", label: yld != null ? `${pc(yld, 1)} on the float` : "earned on investments",
    note: "What the float and capital earned this year. This is the second engine: an insurer that breaks even on underwriting still wins if the float is large and invested well.",
  };

  // The reserve-development honesty check: the company's own restatement of its past promises,
  // read across the record. Negative = favorable (the past was over-reserved and released);
  // positive = the past under-reserved, the industry's chronic sin by Buffett's telling. Where a
  // filer never tags the line (Lincoln), the absence is shown as the fact it is. Some filers
  // scope the tagged line to their short-duration (P&C-style) book rather than the whole
  // enterprise; the count reads the line as filed.
  const devSeries = (company?.history || [])
    .map((h) => ({ fy: h.fy, v: h?.lines?.reserveDevelopmentPriorYear }))
    .filter((x) => x.v != null);
  const devLatest = devSeries.length ? devSeries[devSeries.length - 1] : null;
  const favYears = devSeries.filter((x) => x.v < 0).length;
  const unfavYears = devSeries.filter((x) => x.v > 0).length;
  const developmentCheck = !devSeries.length
    ? none("Reserve development", "Not disclosed in the filings' structured data — the absence is itself worth knowing on a business whose product is a promise.", "combined-ratio")
    : {
      title: "Reserve development",
      concept: "combined-ratio",
      value: `${devLatest.v < 0 ? "−" : "+"}${$(Math.abs(devLatest.v))}`,
      formula: `Prior-year development, FY${devLatest.fy}: ${devLatest.v < 0 ? "favorable (reserves released)" : "unfavorable (past years strengthened)"} · record: ${favYears} favorable, ${unfavYears} unfavorable of ${devSeries.length}`,
      tone: devLatest.v < 0 ? "good" : "warn",
      label: devLatest.v < 0 ? "Past promises held" : "Past reserves fell short",
      note: "Each year an insurer restates what its old accident years actually cost. Persistent favorable development means management reserved honestly and released the cushion; persistent unfavorable development means past profits were overstated by under-reserving — the industry's chronic sin, and the single most tell-tale line an owner can read. Signed as the company files it: negative favorable, positive unfavorable.",
    };

  // Life insurers are a spread-and-book-value business, not a combined-ratio one. Their
  // benefits exceed premiums by design, because claims fall due decades after the premium
  // and are funded by the investment income on accumulated reserves, so a P&C combined
  // ratio reads as a permanent "underwriting loss" and teaches the wrong thing. Read them
  // on the return on equity, the yield the float earns, the scale of that float, and the
  // growth in book value per share.
  if (subtype === "life-insurer") {
    const bvps = bookValuePerShare(L);
    const bvpsCheck = bvps == null ? none("Book value per share", "Equity or share count missing.", "tangible-book") : {
      title: "Book value per share",
      concept: "tangible-book",
      value: `${sym}${bvps.toFixed(0)}`, formula: `Equity ${$(L.stockholdersEquity)} ÷ ${(L.sharesDiluted / 1e6).toFixed(0)}M shares`,
      tone: "info", label: "the compounding scoreboard",
      note: "A life insurer is judged the way Berkshire is, by the growth in book value per share over the years as the spread on the float and the mortality and fee margins compound into equity. This is the level today; the record below shows whether it has grown. Note that reported book value swings with interest rates, which mark the bond portfolio up and down through other comprehensive income.",
    };
    // The published cost side for a life book (ratified 2026-07-21): the spread the portfolio
    // earns over what is credited to policyholders — never a combined ratio, which reads a
    // life insurer's designed benefit excess as a permanent "underwriting loss."
    const spread = spreadOverCrediting(L);
    const spreadCheck = spread == null ? invCheck : {
      title: "Spread over crediting",
      concept: "insurance-float",
      value: pc(spread, 1),
      formula: `(Investment income ${$(inv)} − interest credited ${$(Math.abs(L.interestCredited))}) ÷ float ${$(fl)}`,
      tone: spread > 0.01 ? "good" : spread > 0 ? "ok" : "bad",
      label: spread > 0 ? "Earning more than it credits" : "Crediting more than it earns",
      note: "The life insurer's engine in one figure: what the float earns invested, less what is credited to policyholders, as a share of the float. A durable positive spread is the business; a negative one means the promises cost more than the portfolio produces.",
    };
    return {
      sections: [
        { heading: "Is it a good business?", checks: [roeCheck, spreadCheck] },
        { heading: "The float and book value", checks: [floatCheck, bvpsCheck] },
        { heading: "The reserves", checks: [developmentCheck] },
      ],
    };
  }

  // Property & casualty, and general insurers: the combined ratio is the right lens.
  const comb = combinedRatio(L), lr = lossRatio(L);
  const combCheck = comb != null ? {
    title: "Combined ratio",
    concept: "combined-ratio",
    value: `≈ ${pc(comb)}`, formula: `Total benefits, losses and expenses ${$(Math.abs(L.lossesAndExpenses))} ÷ premiums earned ${$(L.premiumsEarned)}`,
    tone: comb > 1.05 ? "bad" : comb > 1 ? "warn" : comb > 0.95 ? "ok" : "good",
    label: comb > 1 ? "Underwriting loss" : comb > 0.95 ? "Roughly breakeven" : "Underwriting profit",
    note: "The heart of a property-casualty insurer: claims and costs as a share of premiums. Below 100% means it is paid to hold the float, the gold standard; above 100% means it loses money on the policies and must make it back on investments. Approximate here, taken from the filer's total benefits, losses and expenses over premiums, so it can sit a point or two off the company's headline figure; a number held below 100% across cycles is the mark of a disciplined underwriter, the rarest thing in the business.",
  } : lr != null ? {
    title: "Loss ratio",
    concept: "combined-ratio",
    value: pc(lr), formula: `Claims incurred ${$(Math.abs(L.claimsIncurred))} ÷ premiums earned ${$(L.premiumsEarned)}`,
    tone: lr > 0.8 ? "warn" : "ok", label: "Claims share of premiums",
    note: "Claims as a share of premiums (the expense side was not cleanly tagged, so we show the loss ratio alone rather than a full combined ratio). Lower is better; the rest of underwriting cost sits on top of this.",
  } : none("Combined ratio", "Premiums or claims weren't found in the filing data.", "combined-ratio");

  // Cost of float, the Buffett line itself: negative cost means the insurer was PAID to hold
  // other people's money. Computable only on the full float arithmetic with a banded
  // underwriting total; withheld otherwise.
  const cof = costOfFloat(L);
  const costCheck = cof == null
    ? none("Cost of float", "Needs the full float arithmetic and a cleanly tagged underwriting total; a partial figure would mislead.", "insurance-float")
    : {
      title: "Cost of float",
      concept: "insurance-float",
      value: pc(cof, 1),
      formula: `Underwriting ${cof <= 0 ? "profit" : "loss"} ${$(Math.abs(underwritingResult(L)))} ÷ float ${$(fl)}`,
      tone: cof <= 0 ? "good" : cof < 0.03 ? "ok" : "warn",
      label: cof <= 0 ? "Paid to hold the money" : "Pays for its float",
      note: "Buffett's own yardstick: the underwriting result as the price of holding the float. At or below zero, policyholders are paying the company to invest their money — the gold standard. A modest positive cost can still beat borrowing; a chronic high cost means the float is expensive leverage.",
    };
  return {
    sections: [
      { heading: "Is it a good business?", checks: [combCheck, roeCheck] },
      { heading: "The float", checks: [floatCheck, invCheck] },
      { heading: "The cost and the reserves", checks: [costCheck, developmentCheck] },
    ],
  };
}

export function insurerQuality(company, subtype = "insurer") {
  const H = (company?.history || []).filter((h) => h?.lines?.stockholdersEquity && h?.lines?.sharesDiluted);
  const bvps = H.map((h) => h.lines.stockholdersEquity / h.lines.sharesDiluted);
  let g = null;
  if (bvps.length >= 3) { const span = bvps.length - 1; const a = bvps[0], b = bvps[bvps.length - 1]; if (a > 0 && b > 0) g = Math.pow(b / a, 1 / span) - 1; }
  const fe = floatToEquity(company.lines || {});

  // Life: the spread-and-book-value read, not the combined ratio (see the scorecard note).
  if (subtype === "life-insurer") {
    let s1 = "A life insurer is read on the spread it earns on a large float and the growth in book value, not a combined ratio: benefits exceed premiums by design, since claims fall due decades after the premium and are funded by the investment income on accumulated reserves.";
    let s2 = "";
    if (g != null) s2 = g >= 0
      ? ` Book value per share, the measure Berkshire is judged on, has compounded about ${pc(g)} a year across the record.`
      : ` Book value per share has slipped about ${pc(Math.abs(g))} a year across the record, though much of that swing is rising rates marking the bond portfolio down through other comprehensive income rather than economic loss.`;
    if (fe != null) s2 += ` The float runs about ${fe.toFixed(1)}× equity, the leverage that magnifies the spread.`;
    const s3 = " Whether the spread holds as rates move, and whether the reserves prove adequate, are what the 10-K decides, not an earnings multiple.";
    return { text: s1 + s2 + s3 };
  }

  const comb = combinedRatio(company.lines || {}), lr = lossRatio(company.lines || {});
  let s1;
  if (comb != null) s1 = comb < 1 ? `It underwrites at a profit, about a ${pc(comb)} combined ratio (it keeps roughly ${pc(1 - comb)} of premiums before investing the float)` : `It runs an underwriting loss, about a ${pc(comb)} combined ratio, and must earn the difference back on the float`;
  else if (lr != null) s1 = `Claims run ${pc(lr)} of premiums, with underwriting costs on top`;
  else s1 = "The underwriting result is not cleanly tagged in the filings";
  s1 += ".";

  let s2 = "";
  if (g != null) s2 = ` Book value per share, the measure Berkshire is judged on, has compounded about ${pc(g)} a year across the record.`;
  if (fe != null) s2 += ` The float runs about ${fe.toFixed(1)}× equity, the leverage that magnifies both the underwriting and the investing.`;

  const s3 = " Whether the discipline holds through a soft market, and how the float is invested, are what the 10-K decides.";
  return { text: s1 + s2 + s3 };
}
