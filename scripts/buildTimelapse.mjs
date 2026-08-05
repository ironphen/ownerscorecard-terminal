// Inlines the data and the site's own fonts into a single self-contained page.
// Nothing is fetched at view time, so the same file plays in a browser, in an
// artifact, and inside the headless renderer that turns it into a video.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FONTS = [
  { file: 'public/fonts/fraunces.woff2', family: 'Fraunces', style: 'normal', weight: '500 700' },
  { file: 'public/fonts/inter.woff2', family: 'Inter', style: 'normal', weight: '400 700' },
];

async function fontFaces() {
  const out = [];
  for (const f of FONTS) {
    const b64 = (await readFile(resolve(root, f.file))).toString('base64');
    out.push(
      `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};` +
      `font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`
    );
  }
  return out.join('\n');
}

export async function buildTimelapse(outPath) {
  const tpl = await readFile(resolve(root, 'scripts/sp500Timelapse/template.html'), 'utf8');
  const data = await readFile(resolve(root, 'src/data/sp500-composition.json'), 'utf8');

  const html = tpl
    .replace('/*__FONTS__*/', await fontFaces())
    // JSON.parse of a string literal beats inlining raw JSON: no risk of a
    // stray `</script>` in the data closing the tag early.
    .replace('/*__DATA__*/', JSON.stringify(JSON.parse(data)));

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html);
  return html;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(root, process.argv[2] || 'build/sp500-timelapse.html');
  const html = await buildTimelapse(out);
  console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
