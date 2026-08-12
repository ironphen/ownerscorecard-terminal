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

  // Cumulative flows across the WINDOWED record: cash spent acquiring, capital spent building,
  // goodwill written off. The windowed sum keeps two jobs after Build 5: the materiality gate
  // (whose membership must never move with a display change) and the written-down share (whose
  // numerator is also windowed — the two legs of a ratio must share one window).
  const cumAcqWindow = H.reduce((a, h) => a + Math.abs(h.lines.acquisitionSpend || 0), 0);
  const cumCapex = H.reduce((a, h) => a + Math.abs(h.lines.capex || 0), 0);
  // The DISPLAYED cash figure reads the full concept history where the extraction stored it
  // (acqFlows, oe-bridge survey Build 5): Danaher's ten-year window undersells its record by
  // half. Signed at extraction (ADI's negative all-stock year subtracts, never inflates).
  const af = company?.acqFlows || null;
  const cumAcq = af?.cumAcq ?? cumAcqWindow;
  const impByYear = H
    .filter((h) => Math.abs(h.lines.goodwillImpairment || 0) > 0)
    .map((h) => ({ fy: h.fy, amt: Math.abs(h.lines.goodwillImpairment) }));
  const cumImp = impByYear.reduce((a, h) => a + h.amt, 0);

  const gwPctAssets = goodwill / assets;
  const gwIntPctAssets = gwPlusInt / assets;
  const equityPositive = equity != null && equity > 0;
  const gwVsEquity = equityPositive ? goodwill / equity : null; // goodwill as a multiple of book equity
  const exceedsEquity = equityPositive && goodwill > equity;    // the premium is larger than all book equity (only meaningful when equity is positive — goodwill > a negative equity is trivially true, 2026-07-17 sweep #3)

  // Materiality (editorial, not a verdict): the acquisition lens earns its place when goodwill and
  // acquired intangibles are a real part of the balance sheet, when cash deployed on deals is a real part
  // of the business, or when the company has already written acquisitions down. A business built rather
  // than bought (little goodwill, no write-downs) is told by the other panels and isn't cluttered here.
  const material =
    gwIntPctAssets >= 0.20 ||
    (cumImp > 0 && (!equityPositive || cumImp >= equity * 0.05)) ||
    (cumAcqWindow >= assets * 0.15);
  if (!material) return null;

  // The amortization sentence's facts (Build 5): the cumulative amortization of acquired
  // intangibles beside the cash spent, each with its own stated coverage — NEVER divided into
  // each other. The consideration caveat fires when the balance sheet's goodwill dwarfs the
  // cash ever paid through the cash-flow statement: stock consideration (AMD's all-stock
  // Xilinx — $24.8B of goodwill against ~$0.3B of cash ever paid) never passes through that
  // line, and the reader must know the cash figure is not the whole price.
  const amort = af?.cumAmort != null && af.cumAmort > 0
    ? { cum: af.cumAmort, fromFy: af.amortFromFy, years: af.amortYears, gaps: af.amortGaps }
    : null;
  const considerationCaveat = goodwill > 0 && cumAcq < goodwill * 0.4;

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
    acqFrom: af?.fromFy ?? null,   // first tagged year of the full history (null = windowed sum)
    acqYears: af?.years ?? H.length,
    amort,
    considerationCaveat,
    cumCapex,
    cumImp,
    impByYear,            // [{fy, amt}] — the years a write-down was taken
    span: H.length,
    writtenDownShare: cumAcqWindow > 0 ? cumImp / cumAcqWindow : null, // both legs windowed — a ratio never mixes windows
  };
}
