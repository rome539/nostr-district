// Record the promo11.html canvas animation (35s) to spark-raw.webm.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = new URL('./promo11.html', import.meta.url).href;
const OUT = new URL('./spark-raw.webm', import.meta.url).pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--window-size=1010,620', '--mute-audio', '--hide-crash-restore-bubble'],
  defaultViewport: { width: 970, height: 560 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(HTML, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 800)); // font warm-up

const b64 = await page.evaluate(() => window.__run(35));
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log('saved', OUT, fs.statSync(OUT).size, 'bytes');
await browser.close();
