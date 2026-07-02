// Post-build tripwires for the hybrid (static + on-demand) build — docs/phase-2-plan.md §1.
// Runs as part of `npm run build`, so every deploy (Cloudflare Pages included) is guarded:
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
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const HTML_FLOOR = 3000; // ~3,500 pages today; anything below this means the corpus flipped
const WORKER_CEILING_BYTES = 5 * 1024 * 1024; // any big-JSON leak lands 20MB+ past this

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

if (htmlCount < HTML_FLOOR) {
  console.error(
    `verifyStatic: FAIL — only ${htmlCount} HTML files in ${DIST}/ (floor ${HTML_FLOOR}).\n` +
    `The static corpus collapsed: check for \`output: 'server'\` or a stray ` +
    `\`prerender = false\` reaching shared pages.`
  );
  process.exit(1);
}

// The adapter emits the worker as dist/_worker.js — a single file or a directory, by version.
let workerBytes = 0;
for (const w of ["_worker.js"]) {
  const p = join(DIST, w);
  if (!existsSync(p)) continue;
  const s = statSync(p);
  if (s.isDirectory()) walk(p, (_, size) => { workerBytes += size; });
  else workerBytes += s.size;
}

if (workerBytes > WORKER_CEILING_BYTES) {
  console.error(
    `verifyStatic: FAIL — worker bundle is ${(workerBytes / 1048576).toFixed(1)}MB ` +
    `(ceiling ${(WORKER_CEILING_BYTES / 1048576).toFixed(0)}MB).\n` +
    `An on-demand route (or its transitive imports) is pulling in src/data/*.json. ` +
    `SSR routes read only Supabase.`
  );
  process.exit(1);
}

console.log(
  `verifyStatic: OK — ${htmlCount} static HTML pages` +
  (workerBytes ? `, worker bundle ${(workerBytes / 1048576).toFixed(2)}MB` : ", no worker emitted") + "."
);
