// Post-build tripwires for the hybrid (static + on-demand) build — docs/phase-2-plan.md §1.
// Runs as part of `npm run build`, so every deploy (Cloudflare Workers Builds included) is guarded:
//
//   1. The static corpus must not silently shrink. With the Cloudflare adapter present, a stray
//      `export const prerender = false` on a shared layout — or an accidental `output: 'server'` —
//      would flip thousands of pages from prerendered HTML to on-demand rendering without any
//      other symptom. We count the HTML files actually emitted and fail loudly below a floor.
//
//   2. The worker bundle must stay lean. On-demand routes read ONLY Supabase — never the build-time
//      data files (fundamentals.json ~24MB, language.json ~20MB, ...). One transitive import of
//      those into an SSR route inflates the worker past Cloudflare's size limits and breaks the
//      deploy in the worst possible place. We fail on bundle size, the cheapest reliable proxy.
//
// Thresholds are deliberately blunt: the failure modes they catch are order-of-magnitude events
// (3,500 pages -> a handful; a few hundred KB -> tens of MB), not edge cases.
//
//   3. The content itself must be honest (docs/correctness-campaign.md, N4 — the L3 oracle's first
//      cut). Three checks read every emitted HTML file:
//      - MOJIBAKE: a double-encoded byte sequence ("â€™", "Ã©", U+FFFD) anywhere is a hard fail —
//        the tell of a hand-draft pasted without the Word-decode, or a template mis-encoding.
//      - ABSURD FIGURES: a dollar magnitude of $10T+ rendered on a company page OUTSIDE prose is a
//        hard fail. No computed figure legitimately reaches it (the largest filers run low
//        single-digit trillions), and it is the last line of defense for the stale-derived class
//        (the AXS $1.3T debt wall shipped exactly this way). Paragraphs are exempt because they
//        carry the company's own verbatim words, where huge figures are real and correct — BNY
//        custodies $59T, Clearwater platforms $10T, and a filer may quote a $24T world-trade
//        statistic. Our computed figures render in tables, walls and spans, never in <p>. Dollar
//        amounts only: yen figures in trillions are ordinary and correct.
//      - IDENTITY: a company page must actually carry its own ticker; a page that lost it rendered
//        from the wrong (or an empty) record.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";

const DIST = "dist";
const HTML_FLOOR = 3000; // ~3,500 pages today; anything below this means the corpus flipped
const WORKER_CEILING_BYTES = 5 * 1024 * 1024; // any big-JSON leak lands 20MB+ past this
// Cloudflare Workers static-assets ceiling: 20,000 files per deployment on the free plan (100,000
// on Workers Paid). Each covered company costs ~3 files (page + two JSON twins), so a large
// international expansion could sail past this and break the deploy with a cryptic Cloudflare error.
// Warn with runway, then fail loudly BEFORE Cloudflare does so the cause is unmistakable.
const ASSET_CEILING = 20000;
const ASSET_WARN = 18000;

const walk = (dir, onFile) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, onFile);
    else onFile(p, s.size);
  }
};

if (!existsSync(DIST)) {
  console.error(`verifyStatic: ${DIST}/ not found — run after \`astro build\`.`);
  process.exit(1);
}

let htmlCount = 0;
walk(DIST, (p) => { if (p.endsWith(".html")) htmlCount++; });

// The static-asset count is what Cloudflare enforces: every file served from dist/client/.
let assetCount = 0;
const clientDir = join(DIST, "client");
if (existsSync(clientDir)) walk(clientDir, () => { assetCount++; });

if (assetCount >= ASSET_CEILING) {
  console.error(
    `verifyStatic: FAIL — ${assetCount.toLocaleString()} static assets in ${clientDir}/ ` +
    `(Cloudflare free-tier ceiling ${ASSET_CEILING.toLocaleString()}).\n` +
    `The deploy would be rejected. Cover fewer names, drop a JSON twin per company, or move to ` +
    `Workers Paid (raises the ceiling to 100,000).`
  );
  process.exit(1);
}

if (htmlCount < HTML_FLOOR) {
  console.error(
    `verifyStatic: FAIL — only ${htmlCount} HTML files in ${DIST}/ (floor ${HTML_FLOOR}).\n` +
    `The static corpus collapsed: check for \`output: 'server'\` or a stray ` +
    `\`prerender = false\` reaching shared pages.`
  );
  process.exit(1);
}

// Adapter v13 (the Astro 6 line) emits a Workers-format build: static assets under dist/client/,
// server (worker) code under dist/server/ — which stays empty until a route declares
// `export const prerender = false`. The ceiling watches that directory.
let workerBytes = 0;
const serverDir = join(DIST, "server");
if (existsSync(serverDir)) walk(serverDir, (_, size) => { workerBytes += size; });

if (workerBytes > WORKER_CEILING_BYTES) {
  console.error(
    `verifyStatic: FAIL — worker bundle is ${(workerBytes / 1048576).toFixed(1)}MB ` +
    `(ceiling ${(WORKER_CEILING_BYTES / 1048576).toFixed(0)}MB).\n` +
    `An on-demand route (or its transitive imports) is pulling in src/data/*.json. ` +
    `SSR routes read only Supabase.`
  );
  process.exit(1);
}

// ---- content tripwires (the L3 layer's first cut) ----
// One pass over every emitted HTML file. ~4,300 files read once; a few seconds inside a 3-minute
// build. Failures collect and report together so one run shows the full extent, not the first hit.
// These fire at deploy time, the LAST line of defense; the same mojibake tells are also scanned in
// the committed data by audit:integrity, which runs in every data workflow BEFORE the commit — a
// data-borne artifact must turn the responsible workflow red, not freeze deploys days later.
const MOJIBAKE = ["�", "â€", "â‚¬", "Ã©", "Ã¨", "Ã¤", "Ã¶", "Ã¼", "Ã±", "Ã¸", "Ã¥", "Â£", "Â¥", "Â«", "Â»"];
// Ten-trillion-plus in the compact forms the templates use ("$12.3T", "€ 10T") or spelled out.
// Honest limits, stated plainly: this catches the ≥10T band only — the historic AXS wall printed
// $1.3T, and the 1–10T band cannot be policed page-wide because $3–4T market caps are real; that
// band is auditBelievability B7's job at the DATA level, where the wall ties to balance-sheet
// debt. Dollar, euro and sterling only (¥10T is an ordinary yen figure), and the symbol must not
// follow a letter: NT$/HK$-scale currencies reach 10T legitimately. Company pages only: Notes
// prose may discuss trillion-dollar aggregates.
const ABSURD_MONEY = /(?<![A-Za-z])[$€£]\s?(\d{2,}(?:[.,]\d+)?)\s?(?:T\b|\s?trillion)/i;
// Verbatim company language legitimately names huge figures (BNY custodies $59T; Clearwater
// platforms $10T; a filer may quote a $24T world-trade statistic). It renders in KNOWN prose
// containers — the lede, the "in brief" block, MD&A quotes — so exactly those are exempt, by
// class, not every <p>: computed figures do appear in other paragraphs (coverage intros), and a
// blanket <p> exemption would hide the very class this exists to catch.
const VERBATIM_BLOCKS = [
  /<p class="lede"[^]*?<\/p>/gi,
  /<div class="leadMore"[^]*?<\/div>/gi,
  /<p class="recentQuote"[^]*?<\/p>/gi,
  /<p class="bQ"[^]*?<\/p>/gi,
];
const isCompanyPage = (p) => {
  const parts = p.split(sep);
  const i = parts.indexOf("client");
  const seg = i >= 0 ? parts[i + 1] : null;
  return (seg === "c" || seg === "eu" || seg === "jp") && parts[i + 2] && p.endsWith("index.html");
};
const tickerOf = (p) => { const parts = p.split(sep); return parts[parts.length - 2]; };

const contentFails = [];
walk(DIST, (p) => {
  if (!p.endsWith(".html")) return;
  const html = readFileSync(p, "utf8");
  // The hollow-page tripwire: a per-page render error under the Cloudflare adapter can emit a
  // ZERO-BYTE html file while the build still exits green (it did, 2026-07-21 — /docs/data went
  // empty on a "No such module node:fs" render error and nothing failed). A page of negligible
  // size is a silent outage, not a page.
  if (html.length < 500) { contentFails.push(`${p}: built page is ${html.length} bytes — a hollow render (a per-page error the build swallowed)`); return; }
  for (const m of MOJIBAKE) {
    if (html.includes(m)) { contentFails.push(`${p}: mojibake ${JSON.stringify(m)} — a double-encoded paste or template mis-encoding`); break; }
  }
  if (isCompanyPage(p)) {
    // The self-pruning-bar tripwire (2026-07-31): the section bar's inline script removes any
    // tab whose target section is absent — and when the bar moved to the top of the page in a
    // component, the script ran BEFORE the sections were parsed and pruned every tab at runtime
    // while the static HTML still grepped clean. Static analysis can't run the script, but it
    // can hold the invariant that makes it safe: a page carrying the bar must defer the prune
    // past DOM parse.
    if (html.includes('class="cbar"') || html.includes('class="cbar ')) {
      const scriptStart = html.indexOf('querySelector(".cbar")');
      const scriptZone = scriptStart >= 0 ? html.slice(Math.max(0, scriptStart - 2000), scriptStart + 4000) : "";
      if (scriptStart >= 0 && !scriptZone.includes("DOMContentLoaded"))
        contentFails.push(`${p}: the section bar's script is not deferred past DOM parse — its self-pruning removes every tab at runtime`);
    }
    let computed = html;
    for (const re of VERBATIM_BLOCKS) computed = computed.replace(re, "");
    const abs = computed.match(ABSURD_MONEY);
    if (abs && parseFloat(abs[1].replace(",", ".")) >= 10) contentFails.push(`${p}: renders ${abs[0].trim()} outside verbatim prose — no computed figure reaches ten trillion; a stale or mis-scaled derived value`);
    // Identity, honestly scoped: the <head> always carries the ticker via the route-derived
    // canonical URL, so only the BODY counts — this catches an empty or garbled render, not a
    // wrong-record render (route-derived chips appear either way; wrong-record is the data
    // audits' job). Word-boundary so one-letter tickers (F, T) can't match inside a word.
    const ticker = tickerOf(p);
    const body = html.slice(html.indexOf("</head>"));
    if (ticker && !new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body)) {
      contentFails.push(`${p}: page body does not contain its own ticker "${ticker}" — an empty or garbled render`);
    }
  }
});

if (contentFails.length) {
  console.error(`verifyStatic: FAIL — ${contentFails.length} content tripwire(s):`);
  for (const f of contentFails.slice(0, 20)) console.error(`  ${f}`);
  if (contentFails.length > 20) console.error(`  … ${contentFails.length - 20} more`);
  process.exit(1);
}

const assetNote =
  assetCount >= ASSET_WARN
    ? ` ⚠ ${assetCount.toLocaleString()}/${ASSET_CEILING.toLocaleString()} static assets — nearing the Cloudflare free-tier ceiling`
    : ` (${assetCount.toLocaleString()}/${ASSET_CEILING.toLocaleString()} static assets)`;

console.log(
  `verifyStatic: OK — ${htmlCount} static HTML pages` +
  (workerBytes ? `, worker bundle ${(workerBytes / 1048576).toFixed(2)}MB` : ", no worker emitted") +
  assetNote + "."
);
