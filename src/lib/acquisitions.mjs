// Acquisitions & goodwill — Munger's lens on growth-by-buying. "I've seen more companies die of
// indigestion than starvation": the surest way a good business destroys owner value is overpaying for
// other businesses. Goodwill is the running record of that risk — the price paid above the identifiable
// value of everything ever acquired, a number that only grows when a company buys and only falls when it
// concedes it overpaid (a write-down). So an owner reads three things: how big the acquisition bet is
// against the balance sheet and the equity, how much cash has gone to buying rather than building, and
// how much of it has already been written off. The figures are facts; whether the deals created or
// destroyed value is the reader's to judge.
//
// All deterministic, from the XBRL already fetched (goodwill, intangibles, equity, assets, and the
// acquisition-spend / goodwill-impairment flows across the record). Present-never-pronounce; withheld
// when acquisitions aren't a material part of the story (a business that grew by building, not buying).

export function acquisitionRecord(company) {
  const L = company?.lines || {};
  const H = (company?.history || []).filter((h) => h?.lines);
  const goodwill = L.goodwill ?? null;
  const assets = L.totalAssets ?? null;
  if (goodwill == null || assets == null || assets <= 0) return null;

  const intangibles = L.intangibleAssets ?? null;
  const equity = L.stockholdersEquity ?? null;
  const gwPlusInt = goodwill + (intangibles || 0);

  // Cumulative flows across the record: cash spent acquiring, capital spent building, goodwill written off.
  const cumAcq = H.reduce((a, h) => a + Math.abs(h.lines.acquisitionSpend || 0), 0);
  const cumCapex = H.reduce((a, h) => a + Math.abs(h.lines.capex || 0), 0);
  const impByYear = H
    .filter((h) => Math.abs(h.lines.goodwillImpairment || 0) > 0)
    .map((h) => ({ fy: h.fy, amt: Math.abs(h.lines.goodwillImpairment) }));
  const cumImp = impByYear.reduce((a, h) => a + h.amt, 0);

  const gwPctAssets = goodwill / assets;
  const gwIntPctAssets = gwPlusInt / assets;
  const equityPositive = equity != null && equity > 0;
  const gwVsEquity = equityPositive ? goodwill / equity : null; // goodwill as a multiple of book equity
  const exceedsEquity = equity != null && goodwill > equity;    // the premium is larger than all book equity

  // Materiality (editorial, not a verdict): the acquisition lens earns its place when goodwill and
  // acquired intangibles are a real part of the balance sheet, when cash deployed on deals is a real part
  // of the business, or when the company has already written acquisitions down. A business built rather
  // than bought (little goodwill, no write-downs) is told by the other panels and isn't cluttered here.
  const material =
    gwIntPctAssets >= 0.20 ||
    (cumImp > 0 && (!equityPositive || cumImp >= equity * 0.05)) ||
    (cumAcq >= assets * 0.15);
  if (!material) return null;

  return {
    goodwill,
    intangibles,
    gwPlusInt,
    gwPctAssets,
    gwIntPctAssets,
    equity,
    equityPositive,
    gwVsEquity,
    exceedsEquity,
    cumAcq,
    cumCapex,
    cumImp,
    impByYear,            // [{fy, amt}] — the years a write-down was taken
    span: H.length,
    writtenDownShare: cumAcq > 0 ? cumImp / cumAcq : null, // a rough "of the cash put into deals, how much conceded"
  };
}
