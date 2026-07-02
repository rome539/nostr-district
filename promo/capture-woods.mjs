// Capture ND woods promo: hub edge → woods walk → dock fishing → cabin interior.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = 'http://localhost:3001';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new globalThis.URL('./woods-raw.webm', import.meta.url).pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--window-size=1000,640', '--mute-audio', '--hide-crash-restore-bubble'],
  defaultViewport: { width: 900, height: 560 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));

await page.evaluateOnNewDocument(() => {
  localStorage.setItem('nd_tutorial_done', '1');
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });

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
await new Promise(r => setTimeout(r, 5000));

const b64 = await page.evaluate(async () => {
  const game = window.__nd_game;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const scene = (k) => game.scene.getScene(k);
  const active = (k) => game.scene.isActive(k);
  const walkTo = (k, x) => { const sc = scene(k); if (sc && active(k)) { sc.targetX = x; sc.isMoving = true; } };

  const canvas = game.canvas;
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { rec.onstop = res; });
  rec.start(500);

  // Beat 1 — hub: brief establish, then walk left off the map into the woods
  await sleep(1200);
  walkTo('HubScene', 20);
  await new Promise((res) => {
    const iv = setInterval(() => { if (active('WoodsScene')) { clearInterval(iv); res(); } }, 200);
    setTimeout(() => { clearInterval(iv); res(); }, 12000); // safety
  });
  console.log?.('woods');
  await sleep(1500); // fade-in + establish (spawn x=1400)

  // Beat 2 — walk left past the cabin & campfire clearing
  walkTo('WoodsScene', 905);
  await sleep(4600);
  await sleep(900); // beat at the clearing

  // Beat 3 — on to the dock
  walkTo('WoodsScene', 390);
  await sleep(4800);

  // Beat 4 — cast a line; if something bites during the hold, reel it in
  const woods = scene('WoodsScene');
  try { woods.handleFishingPress(); } catch {}
  let reeled = false;
  for (let t = 0; t < 8000; t += 400) {
    await sleep(400);
    try {
      if (!reeled && woods.fishingState === 'bite') {
        woods.handleFishingPress(); // reel in — catch toast!
        reeled = true;
        await sleep(2600); // show off the catch
        break;
      }
    } catch {}
  }
  if (!reeled) { try { woods.handleFishingPress(); } catch {} } // cancel the cast

  // Beat 5 — into the cabin for the cozy finale
  try { woods.enterCabin(); } catch (e) { console.log?.('cabin fail'); }
  await new Promise((res) => {
    const iv = setInterval(() => { if (active('CabinScene')) { clearInterval(iv); res(); } }, 200);
    setTimeout(() => { clearInterval(iv); res(); }, 8000);
  });
  await sleep(6000);

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
