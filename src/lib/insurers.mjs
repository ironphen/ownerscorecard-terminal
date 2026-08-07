// Insurers: Buffett's home turf. An insurer is read on its underwriting discipline,
// the combined ratio (does it pay out less in claims and costs than it takes in
// premiums?), and on the float, the policyholder money it holds and invests before
// claims come due, the closest thing to free leverage there is. Plus the universal
// measure Berkshire itself is judged on: growth in book value per share, and the
// return earned on equity. Underwriting at a profit while the float compounds is the
// whole game. Arithmetic on the filings; the combined ratio here is approximate, built
// from the filer's total benefits, losses and expenses over premiums earned, so
// non-underwriting costs can nudge it a point or two either way from the headline.

import { fmtMoney, currencySymbol, latestReported } from "./fundamentals.mjs";
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
// The reserves-only fallback reading, NET of reinsurance wherever a net leg exists (the money
// recoverable from reinsurers is not float — it is the reinsurers' float). Returns the basis so
// the caller's note can state the error direction honestly: a net-only basis understates true
// float (unearned premiums excluded); a gross-only basis on a reinsured book OVERSTATES it, the
// opposite claim from the one the old note made. Measured 2026-08-05: 22 fallback rows move
// gross→net (AIG 70.7B→41.8B, CNA 26.6→20.6, JRVR −65%).
export function insuranceFloat(L) {
  if (!L) return null;
  const net = L.lossReservesNet ?? (L.lossReserves != null && L.reinsuranceRecoverables != null ? L.lossReserves - L.reinsuranceRecoverables : null);
  if (net != null) return { value: net, basis: "net" };
  return L.lossReserves != null ? { value: L.lossReserves, basis: "gross" } : null;
}
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
  // THE RESERVE-DOMINANCE FENCE (solvency-sight survey, 2026-08-05): a book whose GROSS claims
  // reserves exceed its life base is P&C-shaped, and reaching this line means Formula A could not
  // run — its deduction legs are missing, not its nature. Falling through to a life-basis print
  // here is how Hartford showed "Float $4.8B" against $46.3B of gross loss reserves and Cincinnati
  // Financial $3.8B against $11.5B — wrong by 3x to 10x, silently. An underivable P&C float
  // WITHHOLDS (the reserves-only fallback carries the page honestly); it never borrows the other
  // formula. Measured: exactly CINF and HIG print wrong today; PGR/TRV/CB unchanged to the dollar.
  if (L.lossReserves != null && L.lossReserves > base) return null;
  let value = base + (L.policyholderDeposits || 0) + (L.marketRiskBenefits || 0) + (L.unearnedPremiums || 0);
  if (L.reinsuranceRecoverables != null) value -= L.reinsuranceRecoverables; else notes.push("recoverables deduction unavailable");
  if (L.dacBalance != null) value -= L.dacBalance; else notes.push("DAC deduction unavailable");
  if (L.premiumsReceivable != null) value -= L.premiumsReceivable; else notes.push("receivables deduction unavailable");
  // Coherence belt behind the fence above: float CONTAINS the claims reserves, so a life-basis
  // figure smaller than the same filer's gross loss reserves is mechanically impossible — the
  // claims stack was ignored, not netted. Withhold rather than print the impossible.
  if (value > 0 && L.lossReserves != null && value < L.lossReserves) return null;
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

// Cost of float on the LETTERS' denominator (solvency-sight Build 5): Buffett's tables divide the
// underwriting result by the two-year AVERAGE of float, not the year-end point — and the
// difference is systematic, not noise: measured across 21 P&C issuers with consecutive same-basis
// years, point-in-time understates the benefit magnitude for every GROWING float (Palomar by
// 1,078bp, Progressive by 105bp) and overstates it for every shrinking one (Axis +29bp), because
// this year's result was earned on money that arrived through the year. The averaged form is used
// whenever the prior consecutive fiscal year resolves a float ON THE SAME BASIS; otherwise the
// point-in-time figure stands, labeled as such. denomBasis names which denominator the figure
// carries — a cost of float never prints without it.
export function costOfFloatAveraged(L, priorL = null) {
  const f = floatOf(L);
  const uw = underwritingResult(L);
  if (f?.basis !== "pc" || uw == null || !(f.value > 0)) return null;
  const pf = priorL ? floatOf(priorL) : null;
  if (pf?.basis === "pc" && pf.value > 0) {
    const avg = (f.value + pf.value) / 2;
    return { value: -uw / avg, denom: avg, denomBasis: "two-year average float" };
  }
  return { value: -uw / f.value, denom: f.value, denomBasis: "year-end float (no prior-year float on the same basis to average)" };
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
  const fallback = full ? null : insuranceFloat(L);
  const fl = full?.value ?? fallback?.value ?? null;
  const fe = fl != null && L.stockholdersEquity ? fl / L.stockholdersEquity : null;
  // The fallback's note states the error DIRECTION its basis actually has: net-of-reinsurance
  // understates (unearned premiums and funds held excluded); gross-of-reinsurance on a reinsured
  // book overstates — the reinsurers' share of reserves is their float, not this company's. The
  // old single note claimed "somewhat larger" for every fallback, wrong on cedents (Markel ~55%).
  // Component impurity flags travel from extraction (insuranceLines) on the company record; the
  // broad-receivable case over-deducts, so the float shown is slightly UNDERSTATED — named, since
  // an unnamed conservative bias is still a bias.
  const flagNotes = [];
  if (company?.insuranceFlags?.receivableIncludesOther) flagNotes.push("the receivables deduction includes non-premium receivables (the filer files one combined line), so the float shown is slightly understated");
  if (company?.insuranceFlags?.dacIncludesVoba) flagNotes.push("the DAC deduction includes value of business acquired");
  const basisNote = full
    ? ((full.notes.length || flagNotes.length) ? ` Basis note: ${[...full.notes, ...flagNotes].join("; ")}.` : "")
    : fallback?.basis === "net"
    ? " Measured here from net loss and claim reserves only; it excludes unearned premiums and funds held, so the true float is somewhat larger than shown."
    : " Measured here from gross loss and claim reserves; amounts recoverable from reinsurers are not extracted for this filer, so a heavily reinsured book is overstated here — the reinsurers' share of these reserves is their float, not this company's.";
  const floatCheck = fl == null ? none("Float", "The float components weren't cleanly tagged, and a partial figure would mislead — withheld rather than approximated.", "insurance-float") : {
    title: full ? "Float" : fallback.basis === "net" ? "Float (net reserves)" : "Float (gross reserves)",
    concept: "insurance-float",
    value: $(fl),
    formula: full
      ? (full.basis === "pc"
        ? `Net reserves + unearned premiums − prepaid reinsurance − receivables − DAC = ${$(fl)}`
        : `Policy benefits + deposits + guarantees − recoverables − DAC − receivables = ${$(fl)}`)
      : `Loss and claim reserves${fallback.basis === "net" ? ", net of reinsurance" : ", gross of reinsurance"}: ${$(fl)}${fe != null ? `, ${fe.toFixed(1)}× equity` : ""}`,
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
    // The record fallback (the Bank7 shape): a crediting spread is a flow read, so the most
    // recent reported year, named, beats falling silently back to plain investment income.
    // Measured: 1 of 31 life rows recovers. All three legs read from the same prior year.
    const priorSpread = spread == null
      ? latestReported(company, (l) => {
          const v = spreadOverCrediting(l);
          return v != null ? { spread: v, inv: l.investmentIncome, credited: Math.abs(l.interestCredited), fl: floatOf(l)?.value } : null;
        })
      : null;
    const spreadCheck = spread == null ? (priorSpread ? {
      title: "Spread over crediting",
      concept: "insurance-float",
      value: `${pc(priorSpread.value.spread, 1)} · FY${priorSpread.fy}`,
      formula: `FY${priorSpread.fy}, the most recent year reported: (investment income ${$(priorSpread.value.inv)} − interest credited ${$(priorSpread.value.credited)}) ÷ that year's float ${$(priorSpread.value.fl)}`,
      tone: "info",
      label: `Last reported FY${priorSpread.fy}`,
      note: "The life insurer's engine — what the float earns invested less what is credited to policyholders — read at the most recent year the filing data carries all three legs, and named rather than passed off as current.",
    } : invCheck) : {
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
  // The record fallback for the latest-year-missing case (the Bank7 shape, carried over from the
  // banks desk 2026-07-28): an underwriting result is a FLOW read, so when the latest year's
  // premiums or claims are not yet tagged but the record holds them, the most recent reported
  // year — named, never passed off as current — beats a false "not found." Measured before
  // shipping: 7 of 80 P&C rows recover a ratio this way; the other blanks are genuine.
  const priorComb = comb == null && lr == null
    ? latestReported(company, (l) => {
        if (!l) return null;
        const c2 = combinedRatio(l);
        if (c2 != null) return { comb: c2, total: Math.abs(l.lossesAndExpenses), prem: l.premiumsEarned };
        const l2 = lossRatio(l);
        return l2 != null ? { lr: l2, claims: Math.abs(l.claimsIncurred), prem: l.premiumsEarned } : null;
      })
    : null;
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
  } : priorComb ? {
    title: priorComb.value.comb != null ? "Combined ratio" : "Loss ratio",
    concept: "combined-ratio",
    value: `${priorComb.value.comb != null ? `≈ ${pc(priorComb.value.comb)}` : pc(priorComb.value.lr)} · FY${priorComb.fy}`,
    formula: priorComb.value.comb != null
      ? `FY${priorComb.fy}, the most recent year reported: total benefits, losses and expenses ${$(priorComb.value.total)} ÷ premiums earned ${$(priorComb.value.prem)}`
      : `FY${priorComb.fy}, the most recent year reported: claims incurred ${$(priorComb.value.claims)} ÷ premiums earned ${$(priorComb.value.prem)}`,
    tone: "info",
    label: `Last reported FY${priorComb.fy}`,
    note: "The latest fiscal year's premiums or claims are not yet tagged in the structured data, so this reads the most recent year that is — named, never passed off as current. The underwriting question it answers is the same: did the policies pay for themselves, or is the float being rented at a loss?",
  } : none("Combined ratio", "Premiums or claims weren't found in the filing data.", "combined-ratio");

  // Cost of float, the Buffett line itself: negative cost means the insurer was PAID to hold
  // other people's money. Computable only on the full float arithmetic with a banded
  // underwriting total; withheld otherwise.
  // The letters' denominator: prior consecutive fiscal year's lines, for the two-year average.
  const priorLines = (company?.history || []).find((h) => String(h?.fy) === String(Number(company?.fy) - 1))?.lines ?? null;
  const cofA = costOfFloatAveraged(L, priorLines);
  const cof = cofA?.value ?? null;
  // Same record fallback as the combined ratio, and both legs read from the SAME prior year —
  // a prior underwriting result over today's float would be two years dressed as one figure.
  // Measured: 5 of 80 P&C rows recover.
  const priorCof = cof == null
    ? latestReported(company, (l) => {
        const v = costOfFloat(l);
        return v != null ? { cof: v, uw: underwritingResult(l), fl: floatOf(l)?.value } : null;
      })
    : null;
  const costCheck = cof == null
    ? (priorCof ? {
      title: "Cost of float",
      concept: "insurance-float",
      value: `${pc(priorCof.value.cof, 1)} · FY${priorCof.fy}`,
      formula: `FY${priorCof.fy}, the most recent year reported: underwriting ${priorCof.value.cof <= 0 ? "profit" : "loss"} ${$(Math.abs(priorCof.value.uw))} ÷ that year's float ${$(priorCof.value.fl)}`,
      tone: "info",
      label: `Last reported FY${priorCof.fy}`,
      note: "Buffett's own yardstick — the underwriting result as the price of holding the float — read at the most recent year the filing data carries it, both legs from that same year, and named rather than passed off as current.",
    } : none("Cost of float", "Needs the full float arithmetic and a cleanly tagged underwriting total; a partial figure would mislead.", "insurance-float"))
    : {
      title: "Cost of float",
      concept: "insurance-float",
      value: pc(cof, 1),
      formula: `Underwriting ${cof <= 0 ? "profit" : "loss"} ${$(Math.abs(underwritingResult(L)))} ÷ ${cofA.denomBasis} ${$(cofA.denom)}`,
      tone: cof <= 0 ? "good" : cof < 0.03 ? "ok" : "warn",
      label: cof <= 0 ? "Paid to hold the money" : "Pays for its float",
      note: "Buffett's own yardstick: the underwriting result as the price of holding the float, divided the way his tables divide it — over the two-year average of float where the record carries both years, since the year's result was earned on money that arrived through the year. At or below zero, policyholders are paying the company to invest their money — the gold standard. A modest positive cost can still beat borrowing; a chronic high cost means the float is expensive leverage.",
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
