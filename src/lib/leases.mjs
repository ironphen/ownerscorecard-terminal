// Lease obligations — the maturity ladder of what a business owes on the property, aircraft, stores and
// equipment it leases rather than owns. Since ASC 842 (2019) the lease liability sits on the balance
// sheet, but its SCHEDULE — when the payments come due — lives in the footnote, and the combined
// debt-plus-lease wall an owner actually faces is shown nowhere. Buffett adds leases back to debt to see
// the true fixed-claim schedule; for a retailer, airline or restaurant the lease ladder IS the leverage.
//
// Unlike the debt ladder (recovered from fragile footnote text), the lease buckets are cleanly,
// non-dimensionally tagged in XBRL — one consolidated value per year — so this reads from structured
// data and SELF-RECONCILES: the five annual buckets plus the thereafter bucket sum to the undiscounted
// total the filing reports, and that total less the imputed interest equals the discounted liability on
// the balance sheet. A ladder that doesn't tie out is withheld, never shown — precision over recall, the
// product's governing rule.

// Reconcile one ladder (operating OR finance) from its raw XBRL buckets. All values in whole dollars.
// Returns the validated ladder, or null when the buckets are absent or don't tie out.
export function reconcileLeaseLadder(raw) {
  if (!raw) return null;
  const b = [raw.y1, raw.y2, raw.y3, raw.y4, raw.y5];
  // The core five-year ladder must be present; a missing trailing year reads as zero only when the
  // company genuinely has no payment that year, which the reconciliation below confirms.
  if (b.slice(0, 1).some((v) => v == null)) return null; // no year-one payment tagged → no usable ladder
  const sched = b.map((v) => (v == null ? 0 : v));
  const after = raw.after == null ? 0 : raw.after;
  const sum = sched.reduce((a, c) => a + c, 0) + after;
  if (sum <= 0) return null;
  // Primary reconciliation: the buckets must sum to the undiscounted total the filing states (when it
  // states one). Exact in principle — XBRL rounds to the dollar — so the tolerance is tight.
  const undiscounted = raw.undiscounted == null ? sum : raw.undiscounted;
  const tol = Math.max(2e6, undiscounted * 0.01);
  if (Math.abs(sum - undiscounted) > tol) return null;
  // Secondary: undiscounted total less imputed interest should equal the discounted balance-sheet
  // liability. Kept as context; not a hard gate, since a filer may tag the liability under a split tag.
  const imputed = raw.imputed == null ? null : raw.imputed;
  const liability = raw.liability == null
    ? (imputed != null ? undiscounted - imputed : null)
    : raw.liability;
  return { schedule: sched, after, undiscounted: Math.round(undiscounted), imputed, liability };
}

// Approximate the calendar year of the first ("next twelve months") bucket from the balance-sheet date,
// so the lease wall lines up with the debt wall a reader sets beside it. A fiscal year ending in Jan/Feb
// belongs to the prior calendar year's operations, so its next twelve months fall in the period-end year;
// any later close rolls into the following year.
function firstYearFrom(asOf) {
  if (!asOf) return null;
  const y = parseInt(asOf.slice(0, 4)), m = parseInt(asOf.slice(5, 7));
  return Number.isFinite(y) ? y + (m <= 2 ? 0 : 1) : null;
}

// The combined display model an owner reads: operating and finance lease payments stacked by year, the
// near rung, the peak year, total payments and the present-value liability. Null when neither ladder
// reconciles. Reads the ladders already validated and stored on the company by the fundamentals fetch.
export function leaseObligations(company) {
  const lz = company?.leases;
  if (!lz) return null;
  const op = lz.operating || null, fin = lz.finance || null;
  if (!op && !fin) return null;
  const first = firstYearFrom(lz.asOf);
  const sched = [0, 1, 2, 3, 4].map((i) => {
    const o = op?.schedule[i] ?? 0, f = fin?.schedule[i] ?? 0;
    return { idx: i, year: first != null ? first + i : null, op: o, fin: f, total: o + f };
  });
  const after = { op: op?.after ?? 0, fin: fin?.after ?? 0 };
  after.total = after.op + after.fin;
  const totalPayments = (op?.undiscounted ?? 0) + (fin?.undiscounted ?? 0);
  const liability =
    (op?.liability != null || fin?.liability != null)
      ? (op?.liability ?? 0) + (fin?.liability ?? 0)
      : null;
  const peak = sched.slice().sort((a, c) => c.total - a.total)[0];
  return {
    asOf: lz.asOf || null,
    firstYear: first,
    schedule: sched,
    after,
    dueNextYear: sched[0].total,
    within2yr: sched[0].total + sched[1].total,
    peakYear: peak.year,
    peakIdx: peak.idx,
    peakAmount: peak.total,
    totalPayments,             // total undiscounted lease payments, all years
    liability,                 // present value on the balance sheet (op + finance), or null
    hasOperating: !!op,
    hasFinance: !!fin,
  };
}
