// readability.mjs — the publication's own basket (docs/discovery-design.md, feature 11).
//
// A per-company readability record, built from the same withhold guards the lenses and the
// valuation basis already run — the guards currently discard their reasons; this collects them.
// The subject of every sentence here is this publication, never the reader and never the
// business: a record carrying this record is one WE could not read reliably from the filings,
// stated with its specific reason. It says nothing about what the business is, or about who
// can understand it; those judgments stay with the reader, along with the price.
//
// The reasons, each mirroring an existing guard:
//   short-record          — fewer than four fiscal years with a readable revenue line, the
//                           floor every through-cycle lens in lenses.mjs already requires
//   incoherent-current    — current assets above total assets on the latest annual lines
//                           (the net-nets pick withholds on the same line, ca > ta × 1.02)
//   incoherent-equity     — equity above total assets on the latest annual lines, which makes
//                           total liabilities negative (the same pick's totLiab < 0 guard)
//   adr-basis             — an ADR whose dollars-per-ADS bridge is missing a term (the ADS
//                           ratio unparsed from the depositary cover, or no reference FX
//                           rate), so adrBasis stays in warn mode and per-share reads are
//                           withheld rather than guessed
//
// Pool-level staleness (freshness.mjs) is deliberately NOT a reason here: freshness judges the
// dataset's refresh stamps, not any one company's record, and inventing a per-company staleness
// test would be a new judgment, not a collected one.
//
// Returns null when the record read fine, else { reasons: [{ key, text }] }. Consumed by the
// /withheld page and by the case-against strip on company pages (which shows the withheld form
// instead of its normal lines). Withheld records still appear in the manual and the chapters —
// reading surfaces, not tests — and are simply absent from lens pages, never shown as failing.
import { adrBasis } from "./adrBasis.mjs";

export function readabilityOf(company, adrRatios, rates) {
  const reasons = [];

  // Fewer than four readable years: the same H every through-cycle lens filters to.
  const readableYears = (company?.history || []).filter((h) => h?.lines?.revenue != null).length;
  if (readableYears < 4) {
    const n = readableYears === 0 ? "no fiscal year" : readableYears === 1 ? "one fiscal year" : `${readableYears} fiscal years`;
    reasons.push({
      key: "short-record",
      text: `record shorter than four readable years: ${n} with a readable revenue line`,
    });
  }

  // Balance-sheet coherence, on the latest annual lines, only where the fields exist. The same
  // two impossibilities the net-nets pick withholds on: current assets above total assets, and
  // equity above total assets (negative total liabilities).
  const L = company?.lines || {};
  const { currentAssets: ca, totalAssets: ta, stockholdersEquity: eq } = L;
  if (ca != null && ta != null && ca > ta * 1.02) {
    reasons.push({
      key: "incoherent-current",
      text: "balance sheet incoherent: current assets exceed total assets on the latest annual lines",
    });
  }
  if (eq != null && ta != null && eq > ta) {
    reasons.push({
      key: "incoherent-equity",
      text: "balance sheet incoherent: equity exceeds total assets on the latest annual lines",
    });
  }

  // The ADR bridge: when either term is missing, adrBasis stays in warn mode (auto = false) and
  // nothing downstream guesses. The reason names the missing term.
  if (company?.market === "ADR") {
    const basis = adrBasis(company, adrRatios, rates);
    if (!basis.auto) {
      const ratioMissing = !(basis.ratio > 0);
      reasons.push({
        key: "adr-basis",
        text: ratioMissing
          ? "ADR ratio unverified: no ADS ratio read from the depositary filing's cover; per-share reads withheld"
          : `ADR ratio verified but no reference dollar rate for ${basis.homeCcy}; per-share reads withheld`,
      });
    }
  }

  return reasons.length ? { reasons } : null;
}
