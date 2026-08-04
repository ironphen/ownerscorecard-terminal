# Section recovery survey — the 27 broken filers, diagnosed

*2026-08-04. Ruling record. Census: 27 filers with ≥2 dead/thin sections (biz<300w, mdna<500w,
risk<300w — two or more true), 170 with exactly one. The 27 include McDonald's (biz 8w, mdna 13w),
Intel (biz 14w, mdna 1w), BP, BHP, Vodafone, Unilever, ASML, Stellantis, América Móvil, Petrobras,
Barclays, HDFC Bank, Honeywell. Every filer was probed with SECTION_DEBUG tracing and its filing
folder inspected; every claim below is quoted from a real trace. Full per-ticker evidence:
scratchpad/diagnoses.json (session 6d6f1b58) and the wf_13ef90a0 journal.*

**The one-sentence story: almost nothing here is a wrapper document. The guards we built to kill
TOC rows and running headers are killing real headings, and the cross-reference index that
US-style integrated reports carry in their back matter is shipping as the "section" instead.**
The wrapper hypothesis (HON, the 20-F cohort) died on evidence: Honeywell's 5.1MB primary doc has
full body sections behind bare-caps headings; its only item-numbered headings are a tail index,
correctly killed — the REAL headings die to a case-insensitivity bug (below).

## BUILD 1 — guard corrections — SHIPPED 8da44d6 (2026-08-04)

Landed as pageRefAfter (subsection-marker + "Page N" + footer-vs-TOC discrimination) plus the
"Table of Contents" banner stripped in extractSections BEFORE anchoring. Recovered on the real
pipeline: INTC mdna 1→7,698, AMX mdna 47→24,416 + risk 9→33,510, BHP mdna 49→20,099, PBR risk
1→19,941, DBD risk 1→8,460; HON re-entered the pool. TWO LESSONS BOUGHT WITH MEASUREMENT:
(1) the 1b guard-relocation below was implemented and REVERTED — a uniform code-side prose test
over-kills starts the per-alternation lookbehind never guarded (BABA biz 46,678→3,824) and skips
legitimate ENDS (JPM mdna −14,000 words); the banner strip solves the caps problem without
touching guard semantics. (2) Probe-based measurement lies for ADRs: probes read only the primary
document and miss the sibling-document rescue — measure through fetchFilings itself
(ONLY_TICKERS), and detect form with /20-?f/i (AMX's doc is "_20f.htm", hyphenless).

## BUILD 1 (original plan, kept for the record)

1a. PAGE_AFTER kills a real heading when a SUBSECTION NUMBER follows it. BHP: "5. Financial
review **5.1** Group overview…" — "5.1" reads as a page number (both schemas die identically:
"11. Risk factors" died to "11.1 Risk factors" following it). PBR: "Risk Factors **1)** Risks
related to our company…" — the enumerator reads as a page number. Fix: a digit followed by
`)` or `.digit` is a subsection marker, not a page number. Also count "Page \d+" (MCD's index
style: "Item 1 Business **Page 3**") as a page reference so US cross-reference-index rows die.
AMX variant: the glued running header "RISK FACTORS **29 Table of Contents** RISKS RELATING TO…"
— strip a leading "<digits> Table of Contents" from the after-context and re-test; a real TOC row
still dies because another title-and-page row follows, not prose.

1b. HEAD_BEFORE's lowercase-prose lookbehind is compiled under /i, so ALL-CAPS running heads
("TABLE OF CONTENTS", per-page banners) count as "a lowercase word precedes" and SILENTLY
suppress the real heading — no trace line, nothing. This is why Honeywell's bare-caps body
headings never anchor, why Intel's real "Management's Discussion and Analysis" at @97473 loses to
a 472-word index stub, and (with breadcrumbs) why ASML's risk anchor dies everywhere. Fix:
`(?-i:…)` around the lookbehind (Node 22 supports modifier groups), so only genuinely lowercase
prose suppresses.

Unlocks (fully or partly): BHP, PBR, AMX, HON, INTC, ASML, RACE, DBD, PSO, MCD.

## BUILD 2 — validators: an index row is not a section; a half-document is not a Business

2a. Primary business/mdna captures currently have NO content validator (risk got notOverrun on
2026-08-04). So Vodafone ships 136 words of "Form 20-F cross reference guide" rows AS its
business, BCS/PUK/IHG/CCEP/NGG likewise, and the stub gate then honestly zeroes what was never a
section. Fix: run the headIsProse digit-density test (it already exists for the fallbacks) on
primary business and mdna winners — page-range rows are digit-dense by construction and die.

2b. business needs the notOverrun document-share validator too: Stellantis ships an 88,448-word
capture of its GOVERNANCE section (seeded mid-sentence by the unguarded `business overview`
alternation: "auto OEM business overview with a focus on…") because business's only validator is
!smellsLikeRisk; HDFC ships a 254,383-word whole-document runaway (stored biz 235,192w). Same
mechanism the risk sections died of, same fix, same fall-to-next-candidate behavior.

## BUILD 3 — the UK/integrated 20-F vocabulary

The UK strategic-report style (BP, UL, VOD, RIO, NGG, HLN, PSO, IHG, PUK) carries item headings
ONLY in a back cross-reference sheet; the body uses its own vocabulary. Starts to add: decimal
numbering ("5. Financial review", "11.1 Risk factors" — live once Build 1a lands), "Our
Principal Risks", "At a glance" / "our business model" (guarded), PBR's customs ("About us",
"Consolidated Financial Performance"). Ends to add to the risk/mdna end sets: "How we manage
principal risks and uncertainties" (BP @332733), "viability statement", "governance report",
"corporate governance", "group financial review" — without these, UL's 14 correctly-seeded risk
starts ALL overrun 650k+ chars to the back sheet and fail notOverrun, leaving 0w. Also: extend
the FALLBACK_10K bare-title ladder + businessFallback to 20-F/40-F forms (HDB's mdna is a 36-word
pointer stub the 10-K-gated fallback never rescues).

## BUILD 4 — text normalization (three small, one classifier)

4a. Generalize the htmlToText glue rule: SIMO's headings are small-caps set as
`O<small>PERATING</small>` — a BARE opening inline tag between word characters, which the
(closing)+(opening)+ glue pattern never joins; add `small` to the inline set and join any
whitespace-free inline-tag run between word characters.
4b. Strip per-page running heads/breadcrumbs before anchoring: RIO's real "Risk factors" heading
is glued to "2025 91 riotinto.com Strategic report | Our approach…" on every page; ASML's
breadcrumb "At a glance Q&A with the CEO Our business…" precedes every heading. Detect the
document's own repeated running-head string and remove it (HRTG shares the family).
4c. BLDP (40-F): fortyFSections' MD&A/AIF tie-break disqualifies the true MD&A exhibit because a
possessive AIF citation ("our most recent Annual Information Form will materialize") precedes the
exhibit's own title; anchor aifAt on the dated-title form ("ANNUAL INFORMATION FORM For the year
ended") instead.
4d. MSB, HLN, QGEN: per-filer heading-vocabulary additions recorded in diagnoses.json.

## Ship ceremony (per build, the 2026-08-04 protocol)

Fix → 30-control sectionDiff (the LNC/PGR/BAC/WMT set + this build's targets; no control shrinks
>30% unless it is a corrected over-capture verified by trace) → heroTest + languageGatesTest +
full suite by npm's OWN exit code → targeted re-extraction of the build's filers (runChunks.sh,
rename-retry) → incremental judgment audit of any lede whose text changed (audit-ledes-incremental
workflow; args as OBJECT, verify agentCount > 0) → registry append → build + verifyStatic +
canaries on built HTML → commit → verifyLive. After Build 4: re-census the 170 one-thin filers —
many should heal as side effects; what remains defines whether a Build 5 exists.
