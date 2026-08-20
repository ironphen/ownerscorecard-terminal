#!/usr/bin/env node
// pingIndexNow.mjs — tell the IndexNow engines (Bing, Yandex, Naver, Seznam, Yep — one POST fans
// out to all) which URLs just changed, so the day's fresh pages are crawled in minutes instead of
// on the next passive recrawl. This is the machine-to-machine channel the marketing doctrine
// explicitly blesses: no voice, no identity, no content — a protocol ping. Google does not consume
// IndexNow; Googlebot is served by the honest per-page sitemap lastmod already in place.
//
// Runs as the final step of the daily data workflows, AFTER the git push, and is fail-soft by
// construction: any error logs and exits 0, so a ping hiccup never reds a data commit.
//
// The key is public by design (IndexNow verifies ownership by fetching https://{host}/{key}.txt),
// so it lives in the repo, both here and as public/{key}.txt.
//
// Usage:
//   node scripts/pingIndexNow.mjs [--wait-url=URL --wait-text=STR] URL [URL ...]
// URLs may be absolute or site-relative (/wire, /c/ADBE). --wait-url polls that URL until its body
// contains --wait-text (a fresh-deploy check: e.g. today's date in /wire-lite.json) before
// submitting, so the engines never crawl a pre-deploy page. Bare hostnames are never submitted.

// Pinned fetch, not the global: newer node builds bundle an undici (6.26+) whose socket teardown
// asserts the process to death mid-parse (nodejs/undici#5360). See fetchWire.mjs for the full story.
import { fetch } from "undici";

const KEY = "e7cd0f0ed2ac86316a7ebe33de3fde94";
const HOST = "ownerscorecard.com";
const ORIGIN = `https://${HOST}`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

const done = (msg) => { if (msg) console.log(`pingIndexNow: ${msg}`); process.exit(0); };

async function poll(url, text, { tries = 10, gapMs = 30000 } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30_000) });
      const body = await res.text();
      if (res.ok && (!text || body.includes(text))) { console.log(`pingIndexNow: deploy live (${url} contains "${text}") on attempt ${i}`); return true; }
      console.log(`pingIndexNow: not live yet (attempt ${i}/${tries})`);
    } catch (e) {
      console.log(`pingIndexNow: poll error attempt ${i}: ${e.message}`);
    }
    if (i < tries) await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  let waitUrl = null, waitText = null;
  const raw = [];
  for (const a of args) {
    if (a.startsWith("--wait-url=")) waitUrl = a.slice("--wait-url=".length);
    else if (a.startsWith("--wait-text=")) waitText = a.slice("--wait-text=".length);
    else raw.push(a);
  }

  // Absolutize, keep only this host, dedup, cap at the protocol's 10,000-per-request ceiling.
  const seen = new Set();
  const urls = [];
  for (const r of raw) {
    const trimmed = String(r || "").trim();
    if (!trimmed) continue;
    const abs = trimmed.startsWith("http") ? trimmed : `${ORIGIN}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
    let u;
    try { u = new URL(abs); } catch { continue; }
    if (u.host !== HOST) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    urls.push(u.href);
    if (urls.length >= 10000) break;
  }

  if (!urls.length) done("no valid URLs to submit; nothing to do");

  if (waitUrl) {
    const live = await poll(waitUrl, waitText);
    if (!live) done("deploy not confirmed live within the poll window; skipping submission (the sitemap lastmod still covers discovery)");
  }

  const payload = { host: HOST, key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList: urls };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    // 200 and 202 are both success; 4xx means a key/format problem worth seeing in the log.
    console.log(`pingIndexNow: submitted ${urls.length} URL(s) → HTTP ${res.status} ${res.statusText}`);
    if (res.status >= 400) console.log(`pingIndexNow: response body: ${(await res.text()).slice(0, 500)}`);
    else await res.body?.cancel().catch(() => {}); // discharge the unread success body
  } catch (e) {
    console.log(`pingIndexNow: submission failed (non-fatal): ${e.message}`);
  }
  process.exit(0);
}

main().catch((e) => done(`unexpected error (non-fatal): ${e.message}`));
