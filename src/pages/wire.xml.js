// /wire.xml — the Filing Wire as an Atom 1.0 feed. The wire is the only content on the site that
// changes every weekday, and until now it reached only email subscribers and the HTML page; the
// notes RSS carries the slowest-moving content instead. This makes the day's filings
// machine-subscribable for feed readers, aggregators, and the agent pipelines that ingest
// recurring sources feed-first — every entry deep-links into a /c record page, so the feed is
// also a standing crawl-path into the catalog.
//
// Honest by construction: each entry's id is the SEC accession number (a stable, un-fakeable GUID
// that never re-notifies a reader on rebuild), and every date is the filing's own date, never the
// build clock. The feed is built by src/lib/wireFeed.mjs (a pure function the offline test also
// uses) and regenerated on every build from the same wire.json the daily wire.yml workflow commits,
// so it runs unattended forever.
//
// Scope note: filings only. A 10-K/10-Q entry IS the "this record was refreshed" signal, since a
// periodic filing is exactly what triggers the fundamentals re-fetch; a separate synthetic
// "records updated" stream would duplicate that without a stable per-event id.
import wire from "../data/wire.json";
import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";
import { buildWireFeed } from "../lib/wireFeed.mjs";

export async function GET() {
  const known = new Set(
    [...(fundamentals.companies || []), ...(adrData.companies || [])].map((c) =>
      String(c.ticker || "").toUpperCase()
    )
  );
  return new Response(buildWireFeed(wire, known), {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      // The wire refreshes daily; an hour at the edge keeps it a day-fresh surface.
      "cache-control": "public, max-age=3600",
    },
  });
}
