// Offline regression test for the discovery layer ("Find") — the named GBM lenses and the Confluence.
// Two parts. Part A unit-tests each lens's pick() against synthetic facts, the pure verdict logic: that a
// genuine compounder lands but a small-denominator artifact (a ratio above the band) is withheld, that a
// net-net's cushion is computed from one coherent balance sheet and can never exceed 100%, that the
// defensive lens needs a real number of testable criteria, that owner-minded reads the candor densities,
// and that handle-with-care is selective (a benign accrual or ordinary issuance does NOT trip it). Part B
// runs the whole computation over the real universe and asserts the invariants that must hold no matter how
// the data refreshes: every member carries a figure, every list is sorted, no impossible cushions, the
// Confluence only counts independent POSITIVE lenses, and each lens stays within a sane population band.
// Present, never pronounce: these guard that a lens reports a factual membership, never a recommendation.
import fundamentals from "../src/data/fundamentals.json" with { type: "json" };
import adr from "../src/data/fundamentals.adr.json" with { type: "json" };
import language from "../src/data/language.json" with { type: "json" };
import { LENS_BY_KEY, computeLenses, LENSES } from "../src/lib/lenses.mjs";

const L = LENS_BY_KEY;
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL " + name); } };

// ---- Part A: synthetic pick() logic ----
const co = (lines, currency = "USD") => ({ company: { lines, currency, ticker: "T" } });

// Compounders: in-band lands, artifact and below-floor withheld.
ok("compounder in band", !!L.compounders.pick({ cap: { returnOnRetained: 0.8 } }));
ok("compounder figure has $", /\$0\.80/.test(L.compounders.pick({ cap: { returnOnRetained: 0.8 } }).figure));
ok("compounder artifact withheld", L.compounders.pick({ cap: { returnOnRetained: 3.0 } }) === null);
ok("compounder below floor withheld", L.compounders.pick({ cap: { returnOnRetained: 0.2 } }) === null);
ok("compounder no data withheld", L.compounders.pick({ cap: null }) === null);

// Net-nets: coherent sheet, cushion in (0,1], decimals kept, incoherent withheld.
{
  const m = L["net-nets"].pick({ ...co({ currentAssets: 100, totalAssets: 200, stockholdersEquity: 150 }), shares: 10 });
  ok("net-net lands", !!m);
  ok("net-net cushion 25%", /cushion 25%/.test(m.figure));
  ok("net-net per-share keeps cents", /\$5\.00\/share/.test(m.figure));
}
ok("net-net incoherent (CA>TA) withheld", L["net-nets"].pick({ ...co({ currentAssets: 300, totalAssets: 200, stockholdersEquity: 150 }), shares: 10 }) === null);
ok("net-net negative NCAV withheld", L["net-nets"].pick({ ...co({ currentAssets: 40, totalAssets: 200, stockholdersEquity: 150 }), shares: 10 }) === null);
ok("net-net thin cushion withheld", L["net-nets"].pick({ ...co({ currentAssets: 60, totalAssets: 200, stockholdersEquity: 150 }), shares: 10 }) === null); // ncav 10 → cushion 5%

// Durable economics: precomputed facts drive the verdict.
{
  const m = L.durable.pick({ durable: { medOM: 0.28, hiRoic: 9, nRoic: 10 } });
  ok("durable lands", !!m);
  ok("durable figure shows margin + roic years", /28% through the cycle/.test(m.figure) && /9 of 10/.test(m.figure));
}
ok("durable absent withheld", L.durable.pick({ durable: null }) === null);

// Fortress: net cash behind a profitable record, ranked by cushion.
{
  const m = L.fortress.pick({ fortress: { label: "Net cash, debt-free", ratio: 0.4 } });
  ok("fortress lands", !!m);
  ok("fortress figure shows label + cushion", /Net cash, debt-free/.test(m.figure) && /40% of assets/.test(m.figure));
}
ok("fortress absent withheld", L.fortress.pick({ fortress: null }) === null);

// Defensive: needs >=5 testable AND >=5 passes.
ok("defensive 5/6 lands", !!L.defensive.pick({ g: { passes: 5, testable: 6 } }));
ok("defensive 4/6 withheld", L.defensive.pick({ g: { passes: 4, testable: 6 } }) === null);
ok("defensive few-testable withheld", L.defensive.pick({ g: { passes: 4, testable: 4 } }) === null);

// Owner-minded: candor densities.
ok("owner-minded lands", !!L["owner-minded"].pick({ cd: { owner: 3, promo: 0, adjusted: 0 } }));
ok("owner-minded thin owner withheld", L["owner-minded"].pick({ cd: { owner: 1, promo: 0, adjusted: 0 } }) === null);
ok("owner-minded promotional withheld", L["owner-minded"].pick({ cd: { owner: 3, promo: 0.5, adjusted: 0 } }) === null);
ok("owner-minded off-GAAP withheld", L["owner-minded"].pick({ cd: { owner: 3, promo: 0, adjusted: 2 } }) === null);

// Handle-with-care: selective. Grave tells land; benign accrual and ordinary issuance do not.
ok("hwc material weakness lands", !!L["handle-with-care"].pick({ integrity: { materialWeakness: "x" } }));
ok("hwc corroborated forensic lands", !!L["handle-with-care"].pick({ f: { mElevated: true, accrualTC: 0.03 } }));
ok("hwc benign accrual withheld", L["handle-with-care"].pick({ f: { mElevated: true, accrualTC: 0.01 } }) === null);
ok("hwc M-score-only-low-accrual withheld", L["handle-with-care"].pick({ f: { mElevated: false, accrualTC: 0.03 } }) === null);
ok("hwc ordinary issuance withheld", L["handle-with-care"].pick({ cap: { shareChange: 0.2 } }) === null);
ok("hwc egregious dilution lands", !!L["handle-with-care"].pick({ cap: { shareChange: 1.2 } }));
{
  const m = L["handle-with-care"].pick({ integrity: { materialWeakness: "x", restatement: "y" }, f: { mElevated: true, accrualTC: 0.06 } });
  ok("hwc severity stacks (weight high)", m && m.sort >= 8);
}

// ---- Part B: real-universe invariants ----
const cos = [...(fundamentals.companies || []), ...(adr.companies || [])];
const { byLens, confluence, byTicker } = computeLenses(cos, language.companies);
const positive = new Set(LENSES.filter((l) => l.positive).map((l) => l.key));

for (const lens of LENSES) {
  const m = byLens[lens.key];
  ok(`${lens.key} non-empty`, m.length > 0);
  ok(`${lens.key} every member has a figure`, m.every((r) => typeof r.figure === "string" && r.figure.length > 0));
  ok(`${lens.key} sorted desc`, m.every((r, i) => i === 0 || m[i - 1].sort >= r.sort));
  ok(`${lens.key} no duplicate tickers`, new Set(m.map((r) => r.ticker)).size === m.length);
}
// Population bands — wide enough to survive a data refresh, tight enough to catch a broken predicate.
const within = (k, lo, hi) => ok(`${k} population ${lo}–${hi} (got ${byLens[k].length})`, byLens[k].length >= lo && byLens[k].length <= hi);
within("compounders", 80, 450);
within("durable", 100, 450);
within("fortress", 250, 900);
within("defensive", 50, 350);
within("net-nets", 300, 1200);
within("owner-minded", 60, 500);
within("handle-with-care", 150, 900);

// Net-net cushions can never exceed 100% of assets.
ok("net-net cushions <= 100%", byLens["net-nets"].every((r) => { const m = r.figure.match(/cushion (\d+)% of assets/); return m && +m[1] <= 100; }));

// Confluence integrity: every member clears >=2 distinct POSITIVE lenses, and handle-with-care never counts.
ok("confluence >= 2 positive", confluence.every((r) => r.lenses.length >= 2 && r.lenses.every((k) => positive.has(k))));
ok("confluence handle-with-care excluded from count", confluence.every((r) => !r.lenses.includes("handle-with-care")));
ok("confluence sorted desc", confluence.every((r, i) => i === 0 || confluence[i - 1].sort >= r.sort));
ok("confluence caution flag matches index", confluence.every((r) => r.caution === (byTicker[r.ticker] || []).includes("handle-with-care")));
ok("confluence non-empty", confluence.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
