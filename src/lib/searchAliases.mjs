// Colloquial, brand, and former names that plain substring search can't bridge to a different legal
// name — "google" to Alphabet, "facebook" to Meta, "coke" to The Coca-Cola Company (not the bottler
// whose ticker happens to be COKE), "square" to Block, "amex" to American Express. Without this, the
// front door silently fails on some of the most-searched names in the catalog. A curated bridge —
// dev-time judgment, not a runtime feed — mapping a typed key (lowercase, letters and digits only) to
// the ticker(s) it should surface. Emitted once per page as a JSON blob (#searchAliases) and read by
// both the home search and the site-wide "/" search, so the two behave identically.
export const SEARCH_ALIASES = {
  google: ["GOOGL", "GOOG"],
  youtube: ["GOOGL", "GOOG"],
  facebook: ["META"],
  fb: ["META"],
  instagram: ["META"],
  whatsapp: ["META"],
  coke: ["KO"],
  amex: ["AXP"],
  square: ["XYZ"],
  jandj: ["JNJ"],
  jj: ["JNJ"],
  marlboro: ["MO"],
};
