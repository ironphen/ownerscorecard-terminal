// adrBasis.mjs — one conversion, shared by every surface that meets a price.
//
// A foreign filer reports in its home currency on its ordinary-share count, but the US reader
// holds an ADS quoted in dollars. When both bridge terms are known — the ADS ratio parsed
// verbatim from the filer's own 20-F/40-F cover (adrRatios.json) and the daily reference FX rate
// (rates.json) — convert ONCE: every monetary figure × FX, the share count ÷ the ADS ratio.
// Everything downstream is then USD per ADS, the exact basis of the quote the reader types, and
// no consumer needs to know the company is foreign. When either term is missing, `auto` is false
// and the consumer stays in warn mode (home-market ordinary-share price), never guessing.
//
// Used by Valuation.astro (the company page) and compareCard.mjs (the head-to-head columns), so
// the two can never again give one ticker two contradictory price-entry instructions.

const SHARE_KEYS = new Set(["sharesDiluted", "repurchasedShares"]);

export function adrBasis(company, adrRatios, rates) {
  const isADR = company?.market === "ADR";
  const rec = isADR ? adrRatios?.companies?.[String(company.ticker || "").toUpperCase()] : null;
  const fxUsd = !isADR ? null : company.currency === "USD" ? 1 : rates?.fx?.[company.currency] ?? null;
  const auto = !!(isADR && rec && rec.ratio > 0 && fxUsd != null);

  const scaleLines = (o) => {
    if (!o) return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = typeof v === "number" ? (SHARE_KEYS.has(k) ? v / rec.ratio : v * fxUsd) : v;
    return out;
  };

  const co = auto
    ? {
        ...company,
        currency: "USD",
        lines: scaleLines(company.lines),
        ttm: company.ttm ? { ...company.ttm, lines: scaleLines(company.ttm.lines) } : company.ttm,
        history: (company.history || []).map((h) => ({ ...h, lines: scaleLines(h.lines) })),
      }
    : company;

  return {
    co,                                   // the company to compute from (converted, or the original)
    auto,                                 // true when the conversion ran
    isADR,
    homeCcy: company?.currency || "USD",  // the filing currency, for basis notes
    ratio: rec?.ratio ?? null,
    basis: rec?.basis ?? null,            // "ads" | "direct" | null
    quote: rec?.quote || null,            // the verbatim cover clause, the receipt
    fxUsd,
    fxAsOf: rates?.fxAsOf || null,
  };
}
