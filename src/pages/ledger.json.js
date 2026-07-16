// The Ledger, machine-readable: every dated conclusion this publication has reached, verbatim,
// oldest first — the same complete-denominator, never-edited, never-self-graded record /ledger
// renders, emitted as JSON so anyone can audit it programmatically: a reader, a journalist, a
// skeptic, or the AI assistant a reader asks. The record is only worth what a stranger can check.
// Same conventions as the page: entries appear automatically when a note concludes, none are ever
// removed, and no grades appear because the publication does not issue them.
import { getCollection } from "astro:content";

export async function GET() {
  const entries = (
    await getCollection("articles", ({ data }) => (import.meta.env.PROD ? !data.draft : true) && !!data.conclusion)
  ).sort((a, b) => a.data.date.valueOf() - b.data.date.valueOf());

  const body = {
    what: "The Owner Scorecard Ledger: every dated conclusion the publication has reached, quoted verbatim from the note that reached it. Entries are never edited, never removed, and never graded by the publication itself; the reader holds the record to what followed.",
    publisher: "Owner Scorecard (ownerscorecard.com), founded by Ryan Reinsant",
    conventions: [
      "complete denominator: every concluding research note appears here automatically; none stay off the list",
      "an entry is never edited or removed after publication",
      "the publication never grades its own entries: no returns, no scorecard, no commentary on how an entry aged",
      "a conclusion is a reading of price against value on its date; it is not a recommendation, a target, or a position",
    ],
    entries: entries.map((e, i) => ({
      no: i + 1,
      date: e.data.date.toISOString().slice(0, 10),
      title: e.data.title,
      conclusion: e.data.conclusion,
      url: `https://ownerscorecard.com/notes/${e.id}`,
    })),
  };

  return new Response(JSON.stringify(body, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Readable from anywhere, including a reader's own tools and assistants — the point.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
