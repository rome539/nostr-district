// Render REAL avatars with the game's own AvatarRenderer (served by Vite) and
// save them as data URLs for the customization promo. Pixel-perfect: this IS
// what these outfits look like in-game (room-scale sprite).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:3001';

// hand-picked outfits from the REAL AvatarConfig unions (avatarStore.ts)
const P = { pink:'#ff71ce', teal:'#5dcaa5', amber:'#f0b040', purp:'#7b68ee', cream:'#fff5e6', red:'#e84040', navy:'#1a1040', ice:'#a8d8ff' };
const BASE = {
  body:'default', skinColor:'#2a1858', hair:'short', hairColor:'#1a1040',
  top:'tshirt', topColor:'#7b68ee', bottom:'pants', bottomColor:'#1a1040',
  hat:'none', hatColor:'#e87aab', accessory:'none', accessoryColor:'#5dcaa5',
  eyes:'default', eyeColor:'#ffffff', nameColor:'', chatColor:'', rodSkin:'', nameAnim:'', aura:'',
};
const OUTFITS = [
  { hair:'short',     top:'tshirt',       bottom:'pants',        hat:'none',      accessory:'none',        eyes:'default', topColor:P.purp,  hairColor:'#1a1040' },
  { hair:'mohawk',    top:'jacket',       bottom:'cargopants',   hat:'none',      accessory:'sunglasses',  eyes:'default', topColor:'#222233', hairColor:P.pink },
  { hair:'afro',      top:'flannel',      bottom:'jeans',        hat:'none',      accessory:'headphones',  eyes:'happy',   topColor:P.red,   hairColor:'#2a1808' },
  { hair:'long',      top:'trenchcoat',   bottom:'trousers',     hat:'fedora',    accessory:'none',        eyes:'slit',    topColor:'#3a3048', hairColor:'#602020' },
  { hair:'bun',       top:'hoodie',       bottom:'shorts',       hat:'catears',   accessory:'none',        eyes:'wink',    topColor:P.teal,  hairColor:'#e0c060' },
  { hair:'none',      top:'robe',         bottom:'trousers',     hat:'wizard',    accessory:'none',        eyes:'glow',    topColor:'#2a2060', hairColor:'#888' },
  { hair:'horseshoe', top:'vest',         bottom:'cargopants',   hat:'cowboy',    accessory:'bandana',     eyes:'default', topColor:'#6a4a2a', hairColor:'#555' },
  { hair:'swept',     top:'knightchest',  bottom:'knightpants',  hat:'crown',     accessory:'cape',        eyes:'default', topColor:'#8a8a9a', hairColor:'#c0a030' },
  { hair:'pigtails',  top:'croptop',      bottom:'miniskirt',    hat:'none',      accessory:'earrings',    eyes:'heart',   topColor:P.pink,  hairColor:'#40c0a0' },
  { hair:'grease',    top:'turtleneck',   bottom:'trousers',     hat:'tophat',    accessory:'monocle',     eyes:'default', topColor:'#181828', hairColor:'#101018' },
  { hair:'spiky',     top:'ostrichshirt', bottom:'baggyjeans',   hat:'ostrichhat',accessory:'none',        eyes:'star',    topColor:P.purp,  hairColor:'#3050c0' },
  { hair:'buzz',      top:'pizzashirt',   bottom:'shorts',       hat:'pizzahat',  accessory:'none',        eyes:'happy',   topColor:'#d04030', hairColor:'#303030' },
  { hair:'mullet',    top:'bomber',       bottom:'splitlinepants',hat:'none',     accessory:'onimask',     eyes:'blaze',   topColor:'#304030', hairColor:'#101010' },
  { hair:'braid',     top:'skindress',    bottom:'pants',        hat:'halo',      accessory:'wings',       eyes:'cosmic',  topColor:P.cream, hairColor:'#f0e0b0' },
];
// color sweep: outfit #2 (mohawk/jacket) with 8 top colors
const SWEEP_COLORS = ['#ff71ce','#e84040','#f0b040','#5dcaa5','#70b0ff','#7b68ee','#fff5e6','#222233'];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false,
  args: ['--window-size=800,500', '--mute-audio'],
  defaultViewport: { width: 760, height: 440 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#login-create', { timeout: 30000 }).catch(() => {});

const data = await page.evaluate(async ({ BASE, OUTFITS, SWEEP_COLORS }) => {
  const m = await import('/src/entities/AvatarRenderer.ts');
  await m.itemImagesReady;
  await new Promise(r => setTimeout(r, 500)); // let any straggler PNGs decode
  const render = (cfg) => m.renderRoomSprite({ ...BASE, ...cfg }, 0).toDataURL();
  return {
    outfits: OUTFITS.map(o => render(o)),
    sweep: SWEEP_COLORS.map(c => render({ ...OUTFITS[1], topColor: c })),
  };
}, { BASE, OUTFITS, SWEEP_COLORS });

let out = `window.AVATARS = ${JSON.stringify(data.outfits)};\nwindow.SWEEP = ${JSON.stringify(data.sweep)};\n`;
fs.writeFileSync(new globalThis.URL('./avatardata.js', import.meta.url), out);
console.log('avatardata.js', (out.length/1024).toFixed(0), 'KB —', data.outfits.length, 'outfits +', data.sweep.length, 'sweep');
await browser.close();
