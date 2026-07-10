// Per-company link previews — docs/marketing-plan.md build-list item 2. Every /c/TICKER link
// shared anywhere becomes the product's face: the ticker, the name, and the record at a glance.
//
// What gets a card: the top OG_SUBSET companies by latest-fiscal-year revenue, converted to USD
// at the daily reference rate (rates.json), across the US and ADR pools together — the names
// people actually share. Every listed ticker of a qualifying company keeps its own card (GOOG and
// GOOGL are different pages, so they are different cards). Everything else falls back to
// /og-default.png, wired in src/pages/c/[ticker].astro off src/data/ogImages.json (the tiny
// ticker manifest this script rewrites — that file is committed; the PNGs are not).
//
// What the card shows — the doctrine is the site's: present, never pronounce. Ticker, company
// name, the masthead, and ONE honest graphic: the ten-year owner-earnings sparkline (the same
// series the Manual's Entry Block draws, lib/entryBlock.mjs), or the revenue row for a bank,
// insurer or REIT where owner earnings is a category error, or no graphic at all when the record
// is too short. The line draws in the site's neutral accent — never a verdict green or red — and
// no dollar figure is printed, so a card cannot go embarrassingly stale; only the sparkline's
// shape and its FY range appear.
//
// Platform reality (scripts/verifyStatic.mjs): this script is BUILD-TIME ONLY. It runs before
// `astro build`, reads the big data JSONs with plain fs, and writes PNGs into public/og/ (which
// is gitignored — ~400 PNGs would be dead weight in the repo). Nothing here is imported by any
// page or layout, so the worker bundle never sees satori, resvg, or the data pools.
//
// Idempotency: public/og/manifest.json maps ticker -> input hash (name + series + design
// version). A card redraws only when its inputs change or its PNG is missing, so the daily data
// build redraws the handful of names whose fiscal year rolled, not all 400.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ownerEarningsAbs } from "../src/lib/fundamentals.mjs";
import { classify } from "../src/lib/archetype.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const J = (p) => JSON.parse(readFileSync(here(p), "utf8"));

// Bump when the card's design changes: every hash misses and the whole set redraws once.
const DESIGN_VERSION = 1;
const OG_SUBSET = 400;
const OUT_DIR = here("../public/og");
const MANIFEST = here("../public/og/manifest.json");
const TICKER_LIST = here("../src/data/ogImages.json");

// ---- the subset: top N by latest-FY revenue in USD, US + ADR pools ----

function pickSubset(usCompanies, adrCompanies, rates) {
  const fx = (cur) => (cur === "USD" || !cur ? 1 : rates.fx?.[cur] ?? null);
  const rows = [];
  for (const c of [...usCompanies, ...adrCompanies]) {
    const rate = fx(c.currency || "USD");
    if (rate == null) continue; // no reference rate: cannot rank honestly, so it stays default
    const hist = (c.history || []).filter((h) => h?.lines?.revenue != null);
    const latestRev = hist.length ? hist[hist.length - 1].lines.revenue : c?.lines?.revenue;
    if (latestRev == null) continue;
    rows.push({ usd: latestRev * rate, c });
  }
  rows.sort((a, b) => b.usd - a.usd);
  return rows.slice(0, OG_SUBSET).map((r) => r.c);
}

// ---- the one honest graphic: owner earnings, or revenue where OE is a category error ----

function seriesFor(company) {
  let cls = null;
  try { cls = classify(company); } catch { /* unclassifiable: treat as operating company */ }
  const isFin = !!cls && ["financial", "reit"].includes(cls.sector?.key);
  if (!isFin) {
    const figs = (company.history || [])
      .map((h) => ({ fy: h.fy, v: ownerEarningsAbs(h.lines, company) }))
      .filter((f) => f.v != null && f.fy != null);
    if (figs.length >= 4) return { kind: "Owner earnings", figs };
  }
  const revs = (company.history || [])
    .map((h) => ({ fy: h.fy, v: h?.lines?.revenue }))
    .filter((f) => f.v != null && f.fy != null);
  if (revs.length >= 4) return { kind: "Revenue", figs: revs };
  return null; // record too short for an honest line: the card carries no graphic
}

// ---- drawing ----

// The site's dark palette (BaseLayout :root[data-theme="dark"]) — the card is the page's face.
const C = {
  paper: "#15161a",
  ink: "#ecebe4",
  inkSoft: "#cfcec6",
  muted: "#8c8b84",
  rule: "#2c2e34",
  ruleStrong: "#474851",
  accent: "#8aabe0", // the sparkline's only color: neutral accent, never a verdict green/red
};

const W = 1200, H = 630, PAD = 64;

// The sparkline as an inline-SVG background image: satori lays out text; resvg rasterizes the
// embedded vector. A faint dotted zero line appears only when the series actually crosses zero,
// so a loss year reads as what it is without any color judgment.
function sparklineDataUri(values, w, h) {
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const inset = 6; // keep the stroke and end dot inside the box
  const x = (i) => inset + (i * (w - 2 * inset)) / (values.length - 1);
  const y = (v) => inset + (1 - (v - min) / span) * (h - 2 * inset);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zero =
    min < 0 && max > 0
      ? `<line x1="${inset}" y1="${y(0).toFixed(1)}" x2="${w - inset}" y2="${y(0).toFixed(1)}" stroke="${C.ruleStrong}" stroke-width="1.5" stroke-dasharray="2 7"/>`
      : "";
  const endX = x(values.length - 1).toFixed(1), endY = y(values[values.length - 1]).toFixed(1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    zero +
    `<polyline points="${pts}" fill="none" stroke="${C.accent}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${endX}" cy="${endY}" r="7" fill="${C.accent}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Satori rejects a multi-child div without explicit display:flex — and it counts an empty
// children ARRAY as "multiple", so a childless element must pass undefined, not [].
const h = (type, style, children) => ({
  type,
  props: { style, children: Array.isArray(children) && children.length === 0 ? undefined : children },
});
const txt = (style, s) => ({ type: "div", props: { style, children: s } });

function cardElement({ ticker, name, series }) {
  const label = series
    ? `${series.kind}, FY${series.figs[0].fy}–FY${series.figs[series.figs.length - 1].fy}`
    : null;
  const children = [
    // Masthead: the site's double rule around the brand line.
    h("div", { display: "flex", flexDirection: "column", width: "100%" }, [
      h("div", { borderTop: `3px solid ${C.ruleStrong}`, width: "100%" }, []),
      txt(
        { fontFamily: "Fraunces", fontSize: 36, fontWeight: 600, color: C.ink, padding: "16px 0", letterSpacing: "-0.02em" },
        "Owner Scorecard"
      ),
      h("div", { borderTop: `1px solid ${C.rule}`, width: "100%" }, []),
    ]),
    // Identity: the ticker large, the registered name under it.
    h("div", { display: "flex", flexDirection: "column", marginTop: 8 }, [
      txt(
        { fontFamily: "Fraunces", fontSize: 116, fontWeight: 600, color: C.ink, letterSpacing: "-0.01em", lineHeight: 1.05 },
        ticker
      ),
      txt(
        { fontFamily: "Inter", fontSize: 34, fontWeight: 500, color: C.inkSoft, lineHeight: 1.25, maxWidth: W - 2 * PAD, lineClamp: 2, marginTop: 2 },
        name || ""
      ),
    ]),
  ];
  if (series) {
    children.push(
      h("div", { display: "flex", flexDirection: "column", marginTop: 10 }, [
        txt(
          { fontFamily: "Inter", fontSize: 19, fontWeight: 500, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 },
          label
        ),
        h(
          "div",
          {
            width: W - 2 * PAD,
            height: 130,
            backgroundImage: `url("${sparklineDataUri(series.figs.map((f) => f.v), W - 2 * PAD, 130)}")`,
            backgroundSize: `${W - 2 * PAD}px 130px`,
          },
          []
        ),
      ])
    );
  }
  children.push(
    h("div", { display: "flex", borderTop: `1px solid ${C.rule}`, paddingTop: 16, width: "100%", justifyContent: "space-between" }, [
      txt({ fontFamily: "Inter", fontSize: 22, fontWeight: 500, color: C.muted }, "The owner’s record, from the filings"),
      txt({ fontFamily: "Inter", fontSize: 22, fontWeight: 500, color: C.muted }, "ownerscorecard.com"),
    ])
  );
  return h(
    "div",
    {
      width: W,
      height: H,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      backgroundColor: C.paper,
      padding: `${PAD - 24}px ${PAD}px ${PAD - 16}px`,
    },
    children
  );
}

// ---- main ----

async function main() {
  const t0 = Date.now();
  const us = J("../src/data/fundamentals.json");
  const adr = J("../src/data/fundamentals.adr.json");
  const rates = J("../src/data/rates.json");

  const subset = pickSubset(us.companies || [], adr.companies || [], rates);

  // The site's own faces (OFL-licensed, like the woff2s in public/fonts), as static-instance
  // TTFs because satori reads TTF/OTF/WOFF only — committed so CI never fetches a font.
  const fonts = [
    { name: "Fraunces", data: readFileSync(here("./assets/fraunces-600.ttf")), weight: 600, style: "normal" },
    { name: "Inter", data: readFileSync(here("./assets/inter-500.ttf")), weight: 500, style: "normal" },
  ];

  mkdirSync(OUT_DIR, { recursive: true });
  let old = {};
  try { old = JSON.parse(readFileSync(MANIFEST, "utf8")).entries || {}; } catch { /* first run */ }

  const entries = {};
  const failures = [];
  let drawn = 0, kept = 0;

  for (const c of subset) {
    const ticker = String(c.ticker).toUpperCase();
    const series = seriesFor(c);
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          v: DESIGN_VERSION,
          ticker,
          name: c.name || "",
          kind: series?.kind || null,
          figs: series ? series.figs.map((f) => [f.fy, f.v]) : null,
        })
      )
      .digest("hex")
      .slice(0, 16);
    const out = `${OUT_DIR}/${ticker}.png`;
    if (old[ticker] === hash && existsSync(out)) {
      entries[ticker] = hash;
      kept++;
      continue;
    }
    try {
      const svg = await satori(cardElement({ ticker, name: c.name, series }), { width: W, height: H, fonts });
      const png = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
      writeFileSync(out, png);
      entries[ticker] = hash;
      drawn++;
    } catch (e) {
      failures.push(`${ticker}: ${e.message}`);
    }
  }

  // Stale cards (a name that fell out of the subset) are deleted, not left to serve forever.
  const live = new Set(Object.keys(entries).map((t) => `${t}.png`));
  let pruned = 0;
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith(".png") && !live.has(f)) { unlinkSync(`${OUT_DIR}/${f}`); pruned++; }
  }

  writeFileSync(MANIFEST, JSON.stringify({ designVersion: DESIGN_VERSION, entries }, null, 0) + "\n");
  // The page-side manifest: just the tickers, sorted — src/pages/c/[ticker].astro imports this
  // (a few KB; committed) to point og:image at the card that will exist in the same build.
  writeFileSync(TICKER_LIST, JSON.stringify({ tickers: Object.keys(entries).sort() }, null, 0) + "\n");

  let total = 0, largest = 0, largestName = "";
  for (const f of readdirSync(OUT_DIR)) {
    if (!f.endsWith(".png")) continue;
    const n = readFileSync(`${OUT_DIR}/${f}`).length;
    total += n;
    if (n > largest) { largest = n; largestName = f; }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `og images: ${Object.keys(entries).length} cards (${drawn} drawn, ${kept} unchanged, ${pruned} pruned) ` +
    `in ${secs}s — ${(total / 1048576).toFixed(1)}MB total, largest ${largestName} ${(largest / 1024).toFixed(0)}KB.`
  );
  if (failures.length) {
    console.error(`og images: ${failures.length} card(s) failed (their pages fall back to og-default):\n  ` + failures.join("\n  "));
    // A few bad rows degrade gracefully; a systemic failure should stop the deploy.
    if (failures.length > subset.length * 0.05) {
      console.error("og images: FAIL — more than 5% of the subset failed to render.");
      process.exit(1);
    }
  }
}

await main();
