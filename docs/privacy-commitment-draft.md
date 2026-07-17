# The Notebook Commitment — the approved record copy

**Status: APPROVED by the founder 2026-07-16 ("privacy commitment looks good on my end")
and PUBLISHED same day at /notebook-commitment** (src/pages/notebook-commitment.astro),
linked from the account page's notebook section, the notes strip, and the capture strip.
The published page is the canonical text (em-dashes converted to the page-prose register);
this file remains as the decision record. Per design doc D5.

The doctrine it must satisfy (§3.3): state the promise at its true strength — name what is
stored, who can technically reach it, what we commit never to do, and the standing proof.
Overclaiming ("we cannot read it") would be the one lie that poisons a trust-first
publication.

---

## The Notebook Commitment

*First published [date]. Amended only in writing, here, with the date of the change.*

Your notebook is your own record: dated notes and dated appraisal snapshots, written by you,
on the companies you study. This page states plainly what happens to it.

**What is stored.** The text of your notes; and for each snapshot, the price you typed, the
dial settings you chose, the sentences the page showed you for them, the day's bond yield,
and the filing vintage the record ran through. Nothing else. Nothing is captured
automatically; every entry is your own act.

**Who can technically reach it.** Your rows are locked to your account at the database
itself, not merely in the application. But we will not pretend to more than that: the
database administrator role can reach any row — as it can at every hosted service you have
ever used — and the platform's backups retain data for their retention window. A promise of
absolute technical impossibility would be false, so we do not make it.

**What we commit never to do.** We will never read a notebook. We will never query,
aggregate, count, rank, or mine notebooks — not even anonymized ("most-noted companies" will
never exist here). We will never use a notebook to train anything, sell anything, or decide
anything. There is no analytics code on the notebook, and no code path in the product that
reads notebooks across users.

**The standing proof.** This publication's code is public. Anyone may verify that the
notebook's tables deny access at the database except to their owner, that snapshots cannot
be edited even by their owner, and that no aggregation path exists. The commitment is not a
policy we ask you to trust; it is an architecture you can read.

**Your record leaves with you.** The export — every note and snapshot, dated, in a plain
file you can read in any editor decades from now — is free, complete, and will never sit
behind a payment. Delete means delete.

If this commitment ever changes, the change will be written here, dated, before it takes
effect.

---

**Implementation notes (not part of the published text):** the enforcement already shipped —
RLS owner-scoping on every verb (20260716_notebook.sql), no snapshot UPDATE policy,
`scripts/notebookTest.mjs` failing the build on any service-role reference in notebook code,
`Cache-Control: private, no-store` on every notebook response, and route logs carrying
pathname + error only. The account page's interim microcopy (ratified §3.6 language) stands
until this page ships.
