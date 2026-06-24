// Durability gate for the qualitative notes (src/data/notes.json), enforcing
// docs/qualitative-doctrine.md. The qualitative layer must describe enduring economic
// character, not current state, so it holds true for the same company for years. This
// linter fails the build if any reviewed note carries a figure, a temporal marker, or a
// trajectory / current-state claim — the three ways a note ages out. Deterministic, no
// model; run in `npm test`.
import notes from "../src/data/notes.json" with { type: "json" };

// A bare number, percentage, or money amount. The numbers live in the record below, never
// in the prose. (Allows ordinary words; targets digits and currency.)
const FIGURE = /(?<![A-Za-z])\d+(\.\d+)?\s*(%|percent|bn|billion|million)?|\$\s?\d|¥\s?\d/;
// A date-stamp in disguise: anything that implies "as of when you are reading this."
const TEMPORAL = /\b(now|today|currently|recently|this year|last year|lately|these days|nowadays|at present|going forward)\b/i;
// Which way the needle happens to be pointing — keep the lever, drop the direction.
const TRAJECTORY = /\b(growing|expanding|rising|climbing|surging|soaring|shrinking|declining|widening|narrowing|has (climbed|risen|grown|increased|expanded|widened)|have (climbed|risen|grown|increased|expanded|widened)|building up|on the rise|keeps? (climbing|rising|growing|building))\b/i;

const FIELDS = ["whatItIs", "needle"];
const companies = notes?.companies || {};
let failures = 0;
let checked = 0;

for (const [ticker, n] of Object.entries(companies)) {
  if (ticker.startsWith("_")) continue;
  if (n.reviewed !== true) continue; // only notes that actually render
  for (const field of FIELDS) {
    const s = n[field];
    if (!s) continue;
    checked++;
    const issues = [];
    let m;
    if ((m = s.match(FIGURE))) issues.push(`FIGURE "${m[0].trim()}"`);
    if ((m = s.match(TEMPORAL))) issues.push(`TEMPORAL "${m[0]}"`);
    if ((m = s.match(TRAJECTORY))) issues.push(`TRAJECTORY "${m[0]}"`);
    if (issues.length) {
      failures++;
      console.log(`✗ ${ticker}.${field}: ${issues.join(" | ")}`);
    }
  }
}

if (failures) {
  console.log(`\n${failures} durability violation(s) across ${checked} note field(s). See docs/qualitative-doctrine.md.`);
  process.exit(1);
}
console.log(`ok   ${checked} note field(s) pass the durability gate (no figures, temporal markers, or trajectory claims)`);
