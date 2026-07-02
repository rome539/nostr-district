// Capture ND promo footage: guest login, scripted tour, canvas MediaRecorder → webm.
// The recording taps the Phaser canvas directly (captureStream), so we get the
// game's exact pixels at 60fps with no window chrome.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = 'http://localhost:3001';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new globalThis.URL('./promo-raw.webm', import.meta.url).pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--window-size=1000,640', '--mute-audio', '--hide-crash-restore-bubble'],
  defaultViewport: { width: 900, height: 560 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));

// Pre-seed "tutorial done" BEFORE the app boots so the first-time tutorial
// overlay never appears in the footage.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('nd_tutorial_done', '1');
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// Guest login (fresh profile → login screen shows)
const login = await page.waitForSelector('#login-create', { timeout: 30000 }).catch(() => null);
if (login) {
  for (let i = 0; i < 5; i++) {
    await page.click('#login-create').catch(() => {});
    const ok = await page.waitForSelector('#create-guest', { visible: true, timeout: 5000 }).catch(() => null);
    if (ok) break;
    if (i === 4) throw new Error('create-guest never became visible');
  }
  await page.click('#create-guest');
}
await page.waitForFunction(() => window.__nd_game?.scene?.isActive('HubScene'), { timeout: 40000, polling: 500 });
console.log('in hub');
await new Promise(r => setTimeout(r, 5000)); // let presence/textures settle

// ── The tour, driven from inside the page ──
const b64 = await page.evaluate(async () => {
  const game = window.__nd_game;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const hub = () => game.scene.getScene('HubScene');

  const canvas = game.canvas;
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { rec.onstop = res; });
  rec.start(500);

  const walkTo = (x) => { const sc = hub(); if (sc?.scene?.isActive()) { sc.targetX = x; sc.isMoving = true; } };

  // Beat 1 — plaza establish (3s), then stroll right down the neon strip
  await sleep(3000);
  walkTo(900);
  await sleep(4500);

  // Beat 2 — hearts emote in front of the strip (3.5s)
  try { hub().handleEmoteCommand('hearts'); } catch {}
  await sleep(3500);
  try { hub().handleEmoteCommand('hearts'); } catch {} // toggle off

  // Beat 3 — keep walking to the market end of the strip
  walkTo(1215);
  await sleep(4500);

  // Beat 4 — back to the lounge door and enter (scene-change flash is cinematic)
  walkTo(980);
  await sleep(3500);
  const sc = hub();
  try { sc.enterRoom('lounge', 'LOUNGE', '#ff71ce'); } catch (e) { console.log('enter fail', e); }
  await sleep(2200); // flash + load

  // Beat 5 — inside the lounge (7s)
  await sleep(7000);

  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = await blob.arrayBuffer();
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
});

fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log('saved', OUT, fs.statSync(OUT).size, 'bytes');
await browser.close();
