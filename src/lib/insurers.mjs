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

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
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

  const fl = insuranceFloat(L), fe = floatToEquity(L);
  const floatCheck = fl == null ? none("Float", "Loss reserves weren't found.", "insurance-float") : {
    title: "Float (reserves)",
    concept: "insurance-float",
    value: $(fl), formula: `Loss and claim reserves ${$(fl)}${fe != null ? `, ${fe.toFixed(1)}× equity` : ""}`,
    tone: "info", label: fe != null ? `${fe.toFixed(1)}× equity` : "policyholder money held",
    note: "Money held against future claims and invested in the meantime. Buffett's insight was that good underwriting makes this float cost less than nothing, a pool of other people's money the owners earn on. Measured here from loss and claim reserves only; it excludes unearned premiums and funds held, so the true float is somewhat larger than shown. The larger it is against equity, the more that leverage works, for better or worse.",
  };
  const inv = L.investmentIncome;
  const invCheck = inv == null ? none("Investment income", "Net investment income wasn't found.", "insurance-float") : {
    title: "Investment income",
    concept: "insurance-float",
    value: $(inv), formula: `Net investment income ${$(inv)}${fl ? `, ${pc(inv / fl, 1)} on the float` : ""}`,
    tone: "info", label: fl ? `${pc(inv / fl, 1)} on the float` : "earned on investments",
    note: "What the float and capital earned this year. This is the second engine: an insurer that breaks even on underwriting still wins if the float is large and invested well.",
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
    return {
      sections: [
        { heading: "Is it a good business?", checks: [roeCheck, invCheck] },
        { heading: "The float and book value", checks: [floatCheck, bvpsCheck] },
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

  return {
    sections: [
      { heading: "Is it a good business?", checks: [combCheck, roeCheck] },
      { heading: "The float", checks: [floatCheck, invCheck] },
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
