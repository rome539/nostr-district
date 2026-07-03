// Screenshot cover.html → itch-cover.png (630×500) + itch-cover@2x.png (1260×1000).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = new URL('./cover.html', import.meta.url).href;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=680,560', '--mute-audio', '--hide-crash-restore-bubble'],
  defaultViewport: { width: 640, height: 520 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(HTML, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 800)); // font warm-up

const { native, x2 } = await page.evaluate(() => window.__shot());
for (const [name, b64] of [['itch-cover.png', native], ['itch-cover@2x.png', x2]]) {
  const out = new URL(`./${name}`, import.meta.url).pathname;
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('saved', out, fs.statSync(out).size, 'bytes');
}
await browser.close();
