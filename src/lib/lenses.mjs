// Graham's two named tests — the machinery behind /tests/defensive (the Defensive Workbook) and
// /tests/net-nets (the Net-Net Ledger). These are HIS published procedures, cited on their pages:
// the defensive-investor checklist and the net-current-asset-value test, each verifiable from the
// filings, membership ranked on the test's own figure — never on "attractiveness," never a return
// or a recommendation. The computations reuse the same libraries the company page runs, so a test
// page can never disagree with the page it links to.
//
// The coined archetype labels that once lived here (and the Confluence that counted them) were
// retired 2026-07: a flatteringly-named category the publication awards is a verdict by
// arrangement. The groupings (/groupings) are the browse now; Graham's tests keep their name
// because they are his, not ours.
import { fmtMoney } from "./fundamentals.mjs";

const pctStr = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const SYM = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", AUD: "A$", CHF: "CHF " };
// A per-share figure keeps its cents (NCAV/share is the number the reader sets against the price
// they bring, so $2.40 must not round to $2). Distinct from fmtMoney, which renders billions.
const perShareStr = (v, cur = "USD") => {
  const s = SYM[cur] || "";
  return s ? `${s}${v.toFixed(2)}` : `${v.toFixed(2)} ${cur}`;
};

// The published copy the two test pages render: what each test measures and what trips it, in
// Graham's terms, never a verdict. One source so the pages can't drift from each other.
export const GRAHAM_TESTS = {
  defensive: {
    title: "The defensive checklist",
    principle:
      "The price-independent defensive-investor tests: adequate size, a current ratio of two, debt within working capital, an unbroken earnings record, a paid dividend, and a decade of growth. ",
    test: "Clears at least five of the testable criteria. The price test is left to the company page, where you bring the price. Banks, insurers and REITs are excluded: their pages read them on their own statements, and these operating tests are a category error there.",
  },
  "net-nets": {
    title: "Net-net candidates",
    principle:
      "Net current asset value: current assets minus every liability, ignoring plant and goodwill. Positive means liquid assets alone could clear all debt with something left for the owner. Whether it trades below that is for the price you bring.",
    test: "Net current asset value (latest annual balance sheet) is positive and at least a tenth of total assets. Ranked by cushion strength.",
  },
};

// The net-net read for one company. Compute NCAV and the cushion from ONE coherent balance sheet
// (the latest annual lines), so the numerator and denominator can't drift apart and report an
// impossible >100% cushion. Total liabilities = total assets − equity. Incoherent sheets (current
// or equity above total assets, a negative liability) are withheld, not clamped.
export function netNetPick(company) {
  const L = company.lines || {};
  const { currentAssets: ca, totalAssets: ta, stockholdersEquity: eq } = L;
  if (ca == null || ta == null || eq == null || !(ta > 0)) return null;
  if (ca > ta * 1.02 || eq > ta) return null;
  const totLiab = ta - eq;
  if (totLiab < 0) return null;
  const ncav = ca - totLiab;
  const cushion = ncav / ta;
  if (ncav <= 0 || cushion < 0.1 || cushion > 1.001) return null;
  const cur = company.currency || "USD";
  const shares = company.ttm?.lines?.sharesDiluted ?? L.sharesDiluted ?? null;
  const perShareNum = shares && shares > 0 ? ncav / shares : null;
  const perShare = perShareNum != null ? `${perShareStr(perShareNum, cur)}/share` : `${fmtMoney(ncav, cur)} total`;
  return {
    sort: cushion,
    figure: `NCAV ${perShare} · cushion ${pctStr(cushion)} of assets`,
    // The as-filed components behind the figure, emitted so the ledger page can lay the
    // subtraction out for the reader to redo by hand. Same coherent balance sheet as above.
    data: { ncav, perShare: perShareNum, ca, totLiab, shares: perShareNum != null ? shares : null, fy: company.fy, currency: cur },
  };
}

// Every net-net in the universe, strongest cushion first — the Net-Net Ledger's rows. Null-tolerant
// throughout: a company missing the inputs is simply absent, never shown as failing.
export function netNetRows(companies) {
  const rows = [];
  for (const company of companies || []) {
    const tk = String(company.ticker || "").toUpperCase();
    if (!tk) continue;
    const hit = netNetPick(company);
    if (!hit) continue;
    rows.push({ ticker: tk, name: company.name || "", ...hit });
  }
  rows.sort((a, b) => b.sort - a.sort);
  return rows;
}
