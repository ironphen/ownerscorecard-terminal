// Insurers: Buffett's home turf. An insurer is read on its underwriting discipline,
// the combined ratio (does it pay out less in claims and costs than it takes in
// premiums?), and on the float, the policyholder money it holds and invests before
// claims come due, the closest thing to free leverage there is. Plus the universal
// measure Berkshire itself is judged on: growth in book value per share, and the
// return earned on equity. Underwriting at a profit while the float compounds is the
// whole game. Arithmetic on the filings; the combined ratio here can understate the
// expense side where a filer tags acquisition costs separately, so read it as a floor.

import { fmtUSD } from "./fundamentals.mjs";
import { returnOnEquity } from "./financials.mjs";

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pc = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);

export function lossRatio(L) { return L && L.claimsIncurred != null && L.premiumsEarned ? Math.abs(L.claimsIncurred) / L.premiumsEarned : null; }
export function expenseRatio(L) { return L && L.underwritingExpense != null && L.premiumsEarned ? Math.abs(L.underwritingExpense) / L.premiumsEarned : null; }
export function combinedRatio(L) { const lr = lossRatio(L), er = expenseRatio(L); return lr != null && er != null ? lr + er : null; }
export function insuranceFloat(L) { return L && L.lossReserves != null ? L.lossReserves : null; }
export function floatToEquity(L) { return L && L.lossReserves != null && L.stockholdersEquity ? L.lossReserves / L.stockholdersEquity : null; }
export function bookValuePerShare(L) { return L && L.stockholdersEquity != null && L.sharesDiluted ? L.stockholdersEquity / L.sharesDiluted : null; }

export function buildInsurerScorecard(company) {
  const L = company?.lines || {};
  const none = (title, note) => ({ title, value: "—", formula: "", tone: "none", label: "Not enough data", note });

  const comb = combinedRatio(L), lr = lossRatio(L);
  const combCheck = comb != null ? {
    title: "Combined ratio",
    value: pc(comb), formula: `Claims ${fmtUSD(Math.abs(L.claimsIncurred))} + expenses ${fmtUSD(Math.abs(L.underwritingExpense))} ÷ premiums ${fmtUSD(L.premiumsEarned)}`,
    tone: comb > 1.05 ? "bad" : comb > 1 ? "warn" : comb > 0.95 ? "ok" : "good",
    label: comb > 1 ? "Underwriting loss" : comb > 0.95 ? "Roughly breakeven" : "Underwriting profit",
    note: "The heart of an insurer: claims and costs as a share of premiums. Below 100% means it is paid to hold the float, the gold standard; above 100% means it loses money on the policies and must make it back on investments. A figure held below 100% across cycles is the mark of a disciplined underwriter, the rarest thing in the business.",
  } : lr != null ? {
    title: "Loss ratio",
    value: pc(lr), formula: `Claims incurred ${fmtUSD(Math.abs(L.claimsIncurred))} ÷ premiums earned ${fmtUSD(L.premiumsEarned)}`,
    tone: lr > 0.8 ? "warn" : "ok", label: "Claims share of premiums",
    note: "Claims as a share of premiums (the expense side was not cleanly tagged, so we show the loss ratio alone rather than a full combined ratio). Lower is better; the rest of underwriting cost sits on top of this.",
  } : none("Combined ratio", "Premiums or claims weren't found in the filing data.");

  const roe = returnOnEquity(L);
  const roeCheck = roe == null ? none("Return on equity", "Net income or equity missing.") : {
    title: "Return on equity",
    value: pc(roe), formula: `Net income ${fmtUSD(L.netIncome)} ÷ equity ${fmtUSD(L.stockholdersEquity)}`,
    tone: roe < 0 ? "bad" : roe < 0.1 ? "warn" : roe < 0.13 ? "ok" : "good",
    label: roe < 0 ? "Loss on equity" : roe < 0.1 ? "Below the cost of equity" : roe < 0.15 ? "Solid" : "Strong",
    note: "What it earns on shareholders' capital, the underwriting result plus what the float earns invested. Durably above the ~10% cost of equity is what compounds book value.",
  };

  const fl = insuranceFloat(L), fe = floatToEquity(L);
  const floatCheck = fl == null ? none("Float", "Loss reserves weren't found.") : {
    title: "Float (reserves)",
    value: fmtUSD(fl), formula: `Loss and claim reserves ${fmtUSD(fl)}${fe != null ? `, ${fe.toFixed(1)}× equity` : ""}`,
    tone: "info", label: fe != null ? `${fe.toFixed(1)}× equity` : "policyholder money held",
    note: "Money collected as premiums and held against future claims, invested in the meantime. Buffett's insight was that good underwriting makes this float cost less than nothing, a pool of other people's money the owners earn on. The larger it is against equity, the more that leverage works, for better or worse.",
  };
  const inv = L.investmentIncome;
  const invCheck = inv == null ? none("Investment income", "Net investment income wasn't found.") : {
    title: "Investment income",
    value: fmtUSD(inv), formula: `Net investment income ${fmtUSD(inv)}${fl ? `, ${pc(inv / fl, 1)} on the float` : ""}`,
    tone: "info", label: fl ? `${pc(inv / fl, 1)} on the float` : "earned on investments",
    note: "What the float and capital earned this year. This is the second engine: an insurer that breaks even on underwriting still wins if the float is large and invested well.",
  };

  return {
    sections: [
      { heading: "Is it a good business?", checks: [combCheck, roeCheck] },
      { heading: "The float", checks: [floatCheck, invCheck] },
    ],
  };
}

export function insurerQuality(company) {
  const H = (company?.history || []).filter((h) => h?.lines?.stockholdersEquity && h?.lines?.sharesDiluted);
  const bvps = H.map((h) => h.lines.stockholdersEquity / h.lines.sharesDiluted);
  let g = null;
  if (bvps.length >= 3) { const span = bvps.length - 1; const a = bvps[0], b = bvps[bvps.length - 1]; if (a > 0 && b > 0) g = Math.pow(b / a, 1 / span) - 1; }
  const comb = combinedRatio(company.lines || {}), lr = lossRatio(company.lines || {});
  const fe = floatToEquity(company.lines || {});

  let s1;
  if (comb != null) s1 = comb < 1 ? `It underwrites at a profit, a ${pc(comb)} combined ratio (it keeps ${pc(1 - comb)} of premiums before investing the float)` : `It runs an underwriting loss, a ${pc(comb)} combined ratio, and must earn the difference back on the float`;
  else if (lr != null) s1 = `Claims run ${pc(lr)} of premiums, with underwriting costs on top`;
  else s1 = "The underwriting result is not cleanly tagged in the filings";
  s1 += ".";

  let s2 = "";
  if (g != null) s2 = ` Book value per share, the measure Berkshire is judged on, has compounded about ${pc(g)} a year across the record.`;
  if (fe != null) s2 += ` The float runs about ${fe.toFixed(1)}× equity, the leverage that magnifies both the underwriting and the investing.`;

  const s3 = " Whether the discipline holds through a soft market, and how the float is invested, are what the 10-K decides.";
  return { text: s1 + s2 + s3 };
}
