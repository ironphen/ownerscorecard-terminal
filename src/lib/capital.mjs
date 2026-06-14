// Capital allocation over the record, Buffett's "most important job of management."
// Where did the cash the business generated actually go, across the whole span:
// back into the business (capex), out to owners (dividends, buybacks), or to the
// balance sheet (debt paydown, cash). Pure arithmetic on figures the pipeline
// already pulls; no judgment baked in beyond characterising the dominant use.

export function capitalHistory(company) {
  const H = (company.history || []).filter((h) => h?.lines?.cashFromOps != null);
  if (H.length < 4) return null;

  const years = H.map((h) => h.fy);
  const per = H.map((h) => {
    const L = h.lines;
    return {
      fy: h.fy,
      cfo: L.cashFromOps || 0,
      capex: L.capex != null ? Math.abs(L.capex) : 0,
      div: L.dividendsPaid != null ? Math.abs(L.dividendsPaid) : 0,
      bb: L.buybacks != null ? Math.abs(L.buybacks) : 0,
    };
  });
  const sum = (k) => per.reduce((a, p) => a + p[k], 0);
  const cfo = sum("cfo"), capex = sum("capex"), div = sum("div"), bb = sum("bb");
  if (cfo <= 0) return null;

  const returned = div + bb;
  const retained = cfo - capex - div - bb; // debt paydown / cash build / acquisitions (residual)

  const endL = company.ttm?.lines || H[H.length - 1].lines;
  const debtChange = H[0].lines.totalDebt != null && endL.totalDebt != null ? endL.totalDebt - H[0].lines.totalDebt : null;
  const cashChange = H[0].lines.cashAndEquivalents != null && endL.cashAndEquivalents != null ? endL.cashAndEquivalents - H[0].lines.cashAndEquivalents : null;

  const p = (x) => x / cfo;
  // The dominant use, for a one-line character.
  let character;
  if (p(returned) >= 0.6) character = "a mature cash machine, most of what it earns goes straight back to owners";
  else if (p(capex) >= 0.5) character = "a reinvestor, most operating cash is plowed back into the business";
  else if (debtChange != null && debtChange < -0.2 * cfo) character = "a deleverager, a meaningful share of cash went to paying down debt";
  else if (cashChange != null && cashChange > 0.25 * cfo) character = "a hoarder, a large share of cash simply built the balance sheet";
  else character = "a balanced allocator, splitting cash between the business, owners, and the balance sheet";

  return {
    span: `${years[0]}–${years[years.length - 1]}`,
    cfo, capex, div, bb, returned, retained,
    pReinvest: p(capex), pDiv: p(div), pBB: p(bb), pReturn: p(returned), pRetained: Math.max(0, p(retained)),
    overspent: retained < 0,
    debtChange, cashChange, character,
  };
}
