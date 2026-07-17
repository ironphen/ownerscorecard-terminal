import { buildCompareCard } from "../../lib/compareCard.mjs";
import { allCompareEntries } from "../../lib/compareKey.mjs";

// One slim card per company at /compare/<key>.json, generated at build time (the same way the
// search index is). The head-to-head compare page fetches only the two-to-four a reader picked, so
// the whole universe is on disk but almost none of it is ever downloaded. No price, no state, no
// fetch at runtime — every figure is recomputed from the record we already hold.
//
// The path is the compare KEY, not the bare ticker: the dozen cross-pool homonyms (Airbus AIR vs
// AAR, BAE BA vs Boeing...) each get their own card (AIR.EU beside AIR) instead of the EU company
// being silently dropped onto the US one's URL. See lib/compareKey.mjs.
export function getStaticPaths() {
  const seen = new Set();
  const paths = [];
  for (const { company, pool, key } of allCompareEntries()) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    paths.push({ params: { ticker: key }, props: { company, pool } });
  }
  return paths;
}

export function GET({ props }) {
  const { company, pool } = props;
  const card = buildCompareCard(company, null, pool);
  return new Response(JSON.stringify(card), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
