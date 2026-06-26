import fundamentals from "../../data/fundamentals.json";
import adrData from "../../data/fundamentals.adr.json";
import jpData from "../../data/fundamentals.jp.json";
import language from "../../data/language.json";
import { buildCompareCard } from "../../lib/compareCard.mjs";

// One slim card per company at /compare/<ticker>.json, generated at build time (the same way the
// search index is). The head-to-head compare page fetches only the two-to-four a reader picked, so
// the whole universe is on disk but almost none of it is ever downloaded. No price, no state, no
// fetch at runtime — every figure is recomputed from the record we already hold.
export function getStaticPaths() {
  const all = [
    ...(fundamentals.companies || []),
    ...(adrData.companies || []),
    ...(jpData.companies || []),
  ];
  const seen = new Set();
  const paths = [];
  for (const c of all) {
    const ticker = String(c.ticker || "").toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    paths.push({ params: { ticker }, props: { company: c } });
  }
  return paths;
}

export function GET({ props }) {
  const { company } = props;
  const ticker = String(company.ticker || "").toUpperCase();
  const lang = language?.companies?.[ticker] || null;
  const card = buildCompareCard(company, lang);
  return new Response(JSON.stringify(card), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
