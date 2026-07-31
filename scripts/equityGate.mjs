// equityGate.mjs — Gate B of the record-table accounting survey (2026-07-31,
// docs/record-table-accounting-survey.md): the equity line, corroborated by the filer's own
// arithmetic before it ships. Two filed identities are the witnesses:
//
//   the CHAIN:   parent equity + noncontrolling interests = equity including NCI
//   the WITNESS: assets − liabilities − temporary (mezzanine) equity = equity including NCI
//
// Twelve issuer-years of bogus equity were shipping on the flagship when this gate was designed:
// National Fuel Gas tags −$625.7M as parent equity beside a true $2,079.9M (its page printed a
// 34.2% ROIC against a real 14.4%), Kemper, Designer Brands and Quad/Graphics carry the same
// disease in other years — while HCA's and Playtika's genuinely negative equity tie both
// identities to the dollar, which is why sign and magnitude can never be the discriminator and
// corroboration is. The auditors measured the chain tying on 92.5% of 8,385 gap-years and the
// witness arbitrating 18 of 19 stratified disagreements.
//
// The rule, per fiscal year:
//   both tags agree (chain ties within tolerance)      → parent stored, basis "parent"
//   they disagree and ONE side equals a filed EQUITY-COMPONENT fact (AOCI, retained earnings,
//     APIC, treasury) while NCI evidence is absent or 100x too small to explain the gap — the
//     component-mistag disease — and/or the witness ties the OTHER side                → the
//     corroborated side stored, basis says which
//   neither side corroborable                           → the year WITHHELD, and with it every
//     dependent (ROE, ROIC, book value, retained-to-equity) — a wrong denominator is worse
//     than a missing row
//
// AON and MAS are the standing warning: real-NCI filers whose parent equity coincidentally
// equals nothing — their chain ties and they pass untouched. The component test alone
// false-positives on them; it fires only WITH the NCI-evidence test.

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function vintagesByYear(facts, tag, fyEnds, unit = "USD") {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!units) return null;
  const perYear = {};
  for (const u of units) {
    if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
    const fy = new Date(u.end).getUTCFullYear();
    if (fyEnds?.[fy] && Math.abs(days(fyEnds[fy], u.end)) > 14) continue;
    (perYear[fy] ||= []).push({ val: u.val, end: u.end, filed: u.filed || "" });
  }
  for (const fy of Object.keys(perYear)) perYear[fy].sort((a, b) => (a.end !== b.end ? (a.end > b.end ? -1 : 1) : (a.filed > b.filed ? -1 : 1)));
  return perYear;
}
function instantByYear(facts, tag, fyEnds, unit = "USD") {
  const per = vintagesByYear(facts, tag, fyEnds, unit);
  if (!per) return null;
  const out = {};
  for (const fy of Object.keys(per)) out[fy] = per[fy][0].val;
  return out;
}

const MEZZ_TAGS = [
  "TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests",
  "TemporaryEquityCarryingAmountAttributableToParent",
  "RedeemableNoncontrollingInterestEquityCarryingAmount",
];
const COMPONENT_TAGS = [
  "AccumulatedOtherComprehensiveIncomeLossNetOfTax",
  "RetainedEarningsAccumulatedDeficit",
  "AdditionalPaidInCapital",
  "TreasuryStockValue",
  "TreasuryStockCommonValue",
];

const tol = (v) => Math.max(1e-4 * Math.abs(v || 0), 1e6);

// The full gate: returns { series, inclNci, minorityInterest, temporaryEquity, basis, warns }.
// `series` is the equity the record stores per year; `basis[fy]` says which side it is.
export function equityByYear(facts, fyEnds) {
  const warns = [];
  const parV = vintagesByYear(facts, "StockholdersEquity", fyEnds) || {};
  const inclV = vintagesByYear(facts, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", fyEnds) || {};
  const par = {}, incl = {};
  for (const fy of Object.keys(parV)) par[fy] = parV[fy][0].val;
  for (const fy of Object.keys(inclV)) incl[fy] = inclV[fy][0].val;
  const mi = instantByYear(facts, "MinorityInterest", fyEnds) || {};
  const A = instantByYear(facts, "Assets", fyEnds) || {};
  const L = instantByYear(facts, "Liabilities", fyEnds) || {};
  let mezz = {};
  for (const t of MEZZ_TAGS) {
    const m = instantByYear(facts, t, fyEnds);
    if (m) { mezz = m; break; }
  }
  const comps = COMPONENT_TAGS.map((t) => instantByYear(facts, t, fyEnds)).filter(Boolean);

  const series = {}, basis = {}, inclOut = {};
  const fys = new Set([...Object.keys(par), ...Object.keys(incl)]);
  for (const fy of fys) {
    const p = par[fy], q = incl[fy], m = mi[fy];
    inclOut[fy] = q ?? null;
    // Single-tag years pass through on the chain's own law (parent first, incl fills gaps) —
    // the measured disease lives in disagreeing pairs.
    if (p == null || q == null) { series[fy] = p ?? q; basis[fy] = p != null ? "parent" : "inclNci"; continue; }
    const gap = Math.abs(p + (m || 0) - q);
    if (gap <= tol(q)) { series[fy] = p; basis[fy] = "parent"; continue; }
    // THE VINTAGE RUNG, before any arbitration: a later filing's comparative can poison ONE tag
    // while the year's own 10-K holds a self-agreeing pair — Kemper's FY2021 was 4,007.7M in its
    // own filing (assets − liabilities exactly) until the FY2024 10-K re-tagged the comparative
    // as −849.7M. The newest VINTAGE at which the two tags agree with each other is the filer's
    // last self-consistent statement of the year; it stands, and the poisoned re-tag is named.
    {
      const pv = parV[fy] || [], qv = inclV[fy] || [];
      let best = null;
      for (const a of pv) {
        for (const b of qv) {
          if (Math.abs(a.val + (m || 0) - b.val) <= tol(b.val) || Math.abs(a.val - b.val) <= tol(b.val)) {
            const filed = a.filed < b.filed ? a.filed : b.filed;
            if (!best || filed > best.filed) best = { val: a.val, filed };
          }
        }
      }
      if (best) {
        series[fy] = best.val;
        basis[fy] = "parent";
        warns.push(`equity ${fy}: the newest tags disagree (parent ${p}, incl-NCI ${q}) but the filer's ${best.filed} vintage agrees with itself — ${best.val} stands and the later re-tag is set aside`);
        continue;
      }
    }
    // MI untagged with a small positive wedge is the ORDINARY shape of real noncontrolling
    // interests whose tag this reader didn't find — Aon's $184M and hundreds like it. That is
    // not a broken chain; parent stands, untouched, no warning. Only a COMPONENT MATCH — the
    // filer's own AOCI/retained/APIC/treasury figure wearing the equity tag — opens arbitration.
    const matchesComponent = (v) => comps.some((c) => c[fy] != null && Math.abs(c[fy] - v) <= tol(v));
    const nciCannotExplain = m == null || Math.abs(p - q) > 100 * Math.abs(m || 1);
    const parPoison = matchesComponent(p) && nciCannotExplain;
    const inclPoison = matchesComponent(q) && nciCannotExplain;
    if (!parPoison && !inclPoison) { series[fy] = p; basis[fy] = "parent"; continue; }
    // A side is refused only when the component match is CONFIRMED by the filer's balance-sheet
    // arithmetic pointing at the other side (assets − liabilities − mezzanine ≈ the survivor).
    const witness = A[fy] != null && L[fy] != null ? A[fy] - L[fy] - (mezz[fy] || 0) : null;
    const witTiesIncl = witness != null && Math.abs(witness - q) <= Math.max(tol(q), 0.02 * Math.abs(witness));
    const witTiesPar = witness != null && Math.abs(witness - (p + (m || 0))) <= Math.max(tol(witness), 0.02 * Math.abs(witness));
    if (parPoison && !inclPoison && (witness == null || witTiesIncl)) {
      // Parent is the mistag (National Fuel Gas: −625.7M equals its AOCI-family fact while the
      // including-NCI tag carries the true book, and assets − liabilities confirms it).
      series[fy] = q;
      basis[fy] = "inclNci";
      warns.push(`equity ${fy}: the parent tag (${p}) matches an equity COMPONENT and fails the filer's arithmetic — the including-NCI figure (${q}) is the corroborated book`);
      continue;
    }
    if (inclPoison && !parPoison && (witness == null || witTiesPar)) {
      series[fy] = p;
      basis[fy] = "parent";
      warns.push(`equity ${fy}: the including-NCI tag (${q}) matches an equity COMPONENT — the parent figure (${p}) stands`);
      continue;
    }
    // A component match without a confirming witness, or both sides matching: withhold the year
    // rather than choose a side by taste.
    series[fy] = null;
    basis[fy] = "withheld";
    warns.push(`equity ${fy}: the filer's equity tags disagree (parent ${p}, incl-NCI ${q}, NCI ${m ?? "untagged"}) and neither side is corroborated — the year is withheld`);
  }
  return { series, inclNci: inclOut, minorityInterest: mi, temporaryEquity: mezz, basis, warns };
}
