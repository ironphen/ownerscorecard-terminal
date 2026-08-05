// Turns the timelapse page into a video file.
//
// Frames are stepped by hand rather than screen-recorded: the page exposes
// window.__seek(ms), so frame N depends only on N and the render is identical
// every time it runs. Frames go to ffmpeg over a pipe as JPEG, out as VP8/WebM.
//
//   node scripts/renderTimelapse.mjs [outfile.webm] [--fps 30] [--scale 1]
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTimelapse } from './buildTimelapse.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? dflt : Number(argv[i + 1]);
};
const outFile = resolve(root, argv.find(a => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a)) || 'build/sp500-timelapse.webm');
const FPS = flag('fps', 30);
const SCALE = flag('scale', 1);          // 1 = 1920x1080, .5 = 960x540
const QUALITY = flag('quality', 92);

// Playwright's own chromium build ships with the container; a locally
// installed playwright may expect a different revision, so resolve the binary
// rather than trusting the default lookup.
function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p));
}
function ffmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p));
}

const pageFile = resolve(root, 'build/sp500-timelapse.html');
await buildTimelapse(pageFile);
await mkdir(dirname(outFile), { recursive: true });

const { chromium } = await import('playwright');
const exe = chromiumPath();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const W = Math.round(1920 * SCALE), H = Math.round(1080 * SCALE);
const page = await (await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
})).newPage();

await page.goto(pathToFileURL(pageFile).href, { waitUntil: 'load' });
await page.evaluate(s => {
  window.__renderMode();
  if (s !== 1) document.getElementById('stage').style.transform = `scale(${s})`;
  document.getElementById('stage').style.transformOrigin = 'top left';
}, SCALE);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const duration = await page.evaluate(() => window.__duration);
const total = Math.ceil(duration / 1000 * FPS);
console.log(`rendering ${total} frames @ ${FPS}fps (${(duration / 1000).toFixed(1)}s) at ${W}x${H}`);

const ff = ffmpegPath();
if (!ff) throw new Error('no ffmpeg binary found; set FFMPEG_PATH');
const proc = spawn(ff, [
  '-y',
  // image2pipe cannot sniff the codec off a bare pipe — say it outright, or
  // ffmpeg opens the stream as "none" and dies before the first frame lands.
  '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libvpx', '-b:v', '6M', '-crf', '10',
  '-auto-alt-ref', '0',
  '-pix_fmt', 'yuv420p', '-r', String(FPS),
  outFile,
], { stdio: ['pipe', 'ignore', 'pipe'] });

let ffErr = '';
proc.stderr.on('data', d => { ffErr += d.toString(); });
const done = new Promise((res, rej) => {
  proc.on('close', code => code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}\n${ffErr.slice(-2000)}`)));
  proc.on('error', rej);
});

// If ffmpeg dies mid-render the pipe breaks, and a raw EPIPE says nothing about
// why. Swallow it here and let the close handler report ffmpeg's own stderr.
let broken = false;
proc.stdin.on('error', () => { broken = true; });
const write = buf => new Promise((res, rej) => {
  if (broken) return res();
  if (proc.stdin.write(buf, err => err && res())) return res();
  proc.stdin.once('drain', res);
});

const stage = page.locator('#stage');
for (let i = 0; i < total; i++) {
  await page.evaluate(ms => window.__seek(ms), (i / FPS) * 1000);
  await write(await stage.screenshot({ type: 'jpeg', quality: QUALITY }));
  if (i % 60 === 0) process.stdout.write(`  ${i}/${total}\r`);
}
proc.stdin.end();
await done;
await browser.close();

const { size } = await import('node:fs').then(fs => fs.promises.stat(outFile));
console.log(`\nwrote ${outFile} (${(size / 1e6).toFixed(1)} MB)`);
