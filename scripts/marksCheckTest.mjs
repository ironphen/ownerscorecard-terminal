#!/usr/bin/env node
// marksCheckTest.mjs — case law for the held-to-maturity marks check (src/lib/financials.mjs,
// solvency-sight Build 3). This check shipped for weeks with no pin of its own, and the survey
// found three defects living in it unpinned: an unlabeled pre-tax percentage, a denominator that
// silently changed definition across banks, and a verdict word ("Severe if realized") for a
// conditional whose realized base rate inside the pool is zero by construction.
import { buildFinancialScorecard } from "../src/lib/financials.mjs";

let failed = 0;
const t = (name, ok, got) => { if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); } else console.log(`ok ${name}`); };
const marksOf = (company, opts) => buildFinancialScorecard(company, "bank", opts)
  .sections.flatMap((s) => s.checks).find((c) => c?.title === "Held-to-maturity marks") || null;
const bank = (lines, extra = {}) => ({ ticker: "TEST", fy: 2025, currency: "USD", lines: { deposits: 50e9, netIncome: 1e9, ...lines }, ...extra });

// The denominator ladder: what was subtracted is named, nothing is backfilled.
{
  const base = { htmAmortizedCost: 20e9, htmFairValue: 16e9, stockholdersEquity: 30e9 };
  const full = marksOf(bank({ ...base, goodwill: 5e9, intangibleAssets: 2e9, preferredEquity: 3e9 }));
  t("goodwill+intangibles+preferred tagged → tangible common equity, preferred netted",
    full.formula.includes("tangible common equity") && full.formula.includes("$20.0B"), full?.formula);
  const noPref = marksOf(bank({ ...base, goodwill: 5e9, intangibleAssets: 2e9 }));
  t("no preferred line → labeled 'preferred not deducted', never assumed zero preferred",
    noPref.formula.includes("tangible equity (preferred not deducted)"), noPref?.formula);
  const gwOnly = marksOf(bank({ ...base, goodwill: 5e9 }));
  t("goodwill only → 'equity less goodwill', intangibles absence stated",
    gwOnly.formula.includes("equity less goodwill (intangibles not separately tagged)"), gwOnly?.formula);
  const none = marksOf(bank(base));
  t("neither tagged → 'stated equity', the honest bare denominator",
    none.formula.includes("against stated equity"), none?.formula);
  t("the figure is labeled pre-tax with its fiscal year", none.formula.startsWith("Pre-tax, as filed for FY2025"), none?.formula);
}

// Tone discipline: the harshest verdict word never prints; the top band caps at warn.
{
  const severe = marksOf(bank({ htmAmortizedCost: 20e9, htmFairValue: 8e9, stockholdersEquity: 30e9 })); // 40% of stated
  t("a >30% mark caps at tone 'warn' — 'bad' died with the zero-base-rate verdict", severe.tone === "warn", severe?.tone);
  t("'Severe if realized' never prints", !severe.label.includes("Severe"), severe?.label);
  t("the top label stays conditional and measured", severe.label === "Large if ever realized", severe?.label);
}

// Sign and silence guardrails.
{
  const gain = marksOf(bank({ htmAmortizedCost: 20e9, htmFairValue: 21e9, stockholdersEquity: 30e9 }));
  t("fair value above cost renders as a gain, not a scary percent", gain.value === "No loss — fair value above cost", gain?.value);
  const bank7 = marksOf(bank({ htmAmortizedCost: 0, htmFairValue: 57.3e6, stockholdersEquity: 1e9 }));
  t("a zero cost basis stays silent (the Bank7 fabricated-reassurance fix holds)", bank7 === null, bank7);
  const noPair = marksOf(bank({ htmFairValue: 5e9, stockholdersEquity: 30e9 }));
  t("fair-only stays silent", noPair === null, noPair);
}

// The record leg: widest year and accretion, only when history carries the pair and the widest
// year is in the past.
{
  const c = bank({ htmAmortizedCost: 20e9, htmFairValue: 16e9, stockholdersEquity: 30e9 }, {
    history: [
      { fy: 2022, lines: { htmAmortizedCost: 22e9, htmFairValue: 14e9 } }, // gap 8B, the widest
      { fy: 2024, lines: { htmAmortizedCost: 21e9, htmFairValue: 16e9 } },
    ],
  });
  const m = marksOf(c);
  t("the record leg names the widest year and the accretion since",
    m.formula.includes("widest on record FY2022") && m.formula.includes("accreted back since"), m?.formula);
  const flat = marksOf(bank({ htmAmortizedCost: 20e9, htmFairValue: 16e9, stockholdersEquity: 30e9 }));
  t("no history, no record leg", !flat.formula.includes("widest on record"), flat?.formula);
}

// Preferred-series suppression: the caller's flag removes the check whole.
{
  const m = marksOf(bank({ htmAmortizedCost: 20e9, htmFairValue: 16e9, stockholdersEquity: 30e9 }), { marksSuppressed: true });
  t("a suppressed (secondary-listing) page carries no marks check", m === null, m);
}

// The AFS/AOCI companion sentence — the one exactly-true framing — lives in the note.
{
  const m = marksOf(bank({ htmAmortizedCost: 20e9, htmFairValue: 16e9, stockholdersEquity: 30e9 }));
  t("the note states that AFS marks are already in equity and this gap sits outside it",
    m.note.includes("available-for-sale") && m.note.includes("outside equity"), undefined);
  t("the note states pre-tax and why no after-tax is derived", m.note.includes("pre-tax"), undefined);
}

// THE FUNDING LEG ON THE SAME CARD (Build 4): four explicit states, fiscal-year-tied, and the
// rung-b discipline — every number is XBRL or a quotation, never arithmetic on welded prose.
{
  const marked = { htmAmortizedCost: 20e9, htmFairValue: 12e9, stockholdersEquity: 30e9, deposits: 50e9, noninterestBearingDeposits: 13e9 };
  const shown = marksOf(bank(marked), { weld: { fy: 2025, withheld: false, check: "pct", computedPct: "20.45", sentence: "…" } });
  t("a checked weld percentage joins the card", shown.note.includes("about 20.45% of deposits uninsured"), undefined);
  const verbatim = marksOf(bank(marked), { weld: { fy: 2025, withheld: false, sentence: "Uninsured deposits were…" } });
  t("a verbatim-only weld points at the owner's read", verbatim.note.includes("in its own words"), undefined);
  const netted = marksOf(bank(marked), { weld: { fy: 2025, withheld: true, reason: "netted basis" } });
  t("a netted-basis withhold says so AND carries the NIB share the record does hold",
    netted.note.includes("netted basis") && netted.note.includes("noninterest-bearing deposits are 26%"), undefined);
  const bare = marksOf(bank(marked));
  t("no weld at all → the NIB franchise leg stands alone", bare.note.includes("no stated uninsured figure") && bare.note.includes("26%"), undefined);
  const stale = marksOf(bank(marked), { weld: { fy: 2023, withheld: false, check: "pct", computedPct: "31" } });
  t("a stale-year weld never joins the card (fiscal-year tie)", !stale.note.includes("31%"), undefined);
  const withFact = marksOf(bank(marked), { poolFact: "Measured across every US bank: none carries both." });
  t("the pool fact joins only the warn-band cards", withFact.note.includes("none carries both"), undefined);
  const smallMark = marksOf(bank({ ...marked, htmFairValue: 19e9 }), { poolFact: "Measured across every US bank: none carries both." });
  t("a small mark carries no pool sentence", !smallMark.note.includes("none carries both"), undefined);
}

if (failed) { console.error(`\n❌ marksCheckTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ marksCheckTest passed.");
