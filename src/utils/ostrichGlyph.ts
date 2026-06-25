// The 🦤 Nostrich name color (Nostr's Birthday reward) brackets the name with a
// purple ostrich — the image counterpart to the ₿ Bullion text wrap. Since there's
// no ostrich glyph in any font, we render the sprite ourselves: a Phaser texture for
// the in-world name tag, a data-URI <img> for HTML chat, and a canvas draw for the
// shop preview. The silhouette is the same bitmap traced for the firework shape.
import Phaser from 'phaser';

export const OSTRICH_ROWS = [
  '..#......',
  '.###.....',
  '####.....',
  '..#..#.#.',
  '..#.###..',
  '.#######.',
  '.########',
  '..######.',
  '...###...',
  '...#.#...',
  '...#.#...',
  '..####...',
];
const COLS = Math.max(...OSTRICH_ROWS.map(r => r.length)); // 9
const ROWS = OSTRICH_ROWS.length;                          // 12

export const OSTRICH_ASPECT = COLS / ROWS;
export const NOSTRICH_PURPLE = 0x9a6eff;
const PURPLE_CSS = '#9a6eff';

// Chat sentinels: BaseScene wraps the chat name with these private-use chars (which
// survive escapeHtml); ChatUI swaps them for the <img> tags. L = leading, R = trailing.
export const OSTRICH_SENTINEL_L = '';
export const OSTRICH_SENTINEL_R = '';

const TEX_KEY = 'nostrich_glyph';

/** White silhouette texture (tinted purple at use). Generated once per texture-manager. */
export function ensureOstrichTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  OSTRICH_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect(x, y, 1, 1);
  });
  g.generateTexture(TEX_KEY, COLS, ROWS);
  g.destroy();
}

// Cached purple data-URIs for HTML chat (leading + mirrored trailing).
let _urlL = '', _urlR = '';
function buildUrl(flip: boolean): string {
  const cell = 3;
  const c = document.createElement('canvas');
  c.width = COLS * cell; c.height = ROWS * cell;
  const ctx = c.getContext('2d')!;
  if (flip) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.fillStyle = PURPLE_CSS;
  OSTRICH_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(x * cell, y * cell, cell, cell);
  });
  return c.toDataURL();
}

/** <img> HTML for a chat-name ostrich. flip=true mirrors it for the trailing side. */
export function ostrichImgHtml(flip: boolean): string {
  const url = flip ? (_urlR ||= buildUrl(true)) : (_urlL ||= buildUrl(false));
  return `<img src="${url}" alt="" style="height:0.95em;width:auto;vertical-align:-0.12em;margin:0 2px;image-rendering:pixelated;">`;
}

/** Draw the purple ostrich onto a 2D canvas, fit to height h, top-left (x,y).
 *  Cell + position snap to whole pixels so the thin 1px features stay crisp (matching
 *  the in-world integer scale) instead of antialiasing into a fuzzy/clipped blob.
 *  `color` overrides the purple — pass nostrichShimmerCss(time) to match the in-world glint. */
export function drawOstrich(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, flip = false, color = PURPLE_CSS): void {
  const cell = Math.max(1, Math.round(h / ROWS));
  const ox = Math.round(x), oy = Math.round(y);
  ctx.save();
  ctx.fillStyle = color;
  if (flip) { ctx.translate(ox + COLS * cell, oy); ctx.scale(-1, 1); } else { ctx.translate(ox, oy); }
  OSTRICH_ROWS.forEach((row, ry) => {
    for (let cx = 0; cx < row.length; cx++) if (row[cx] === '#') ctx.fillRect(cx * cell, ry * cell, cell, cell);
  });
  ctx.restore();
}

/** Width the ostrich actually occupies at the given height (for layout symmetry). */
export function ostrichDrawWidth(h: number): number {
  return COLS * Math.max(1, Math.round(h / ROWS));
}

// Shimmer: a brief white-hot glint raking across the purple, like ₿ Bullion's coin
// flash. Lerps the tint purple → near-white lavender on the glint.
function shimmerTint(time: number): number {
  const gl = time % 3600; // a quick ~450ms flash, then a long quiet gap (rare, not slow)
  const glint = gl < 450 ? Math.pow(Math.sin((gl / 450) * Math.PI), 2) : 0;
  const a = [0x9a, 0x6e, 0xff], b = [0xf2, 0xe8, 0xff];
  const r = Math.round(a[0] + (b[0] - a[0]) * glint);
  const g = Math.round(a[1] + (b[1] - a[1]) * glint);
  const bl = Math.round(a[2] + (b[2] - a[2]) * glint);
  return (r << 16) | (g << 8) | bl;
}

/** Same shimmer as the in-world glyph, as a CSS hex string for canvas previews. */
export function nostrichShimmerCss(time: number): string {
  return '#' + shimmerTint(time).toString(16).padStart(6, '0');
}

/** A pair of shimmering purple ostriches flanking an in-world name tag, on a black
 *  pill backing that extends the name's own pill so the ostriches sit on it too. */
export class NameOstrichPair {
  private l?: Phaser.GameObjects.Image;
  private r?: Phaser.GameObjects.Image;
  private bg?: Phaser.GameObjects.Graphics;
  private layoutKey = ''; // last name geometry — skip the rebuild when unchanged
  constructor(private scene: Phaser.Scene) { ensureOstrichTexture(scene); }

  update(name: Phaser.GameObjects.Text, depth: number, time: number): void {
    if (!this.l) {
      this.bg = this.scene.add.graphics();
      this.l = this.scene.add.image(0, 0, TEX_KEY).setOrigin(0.5);
      this.r = this.scene.add.image(0, 0, TEX_KEY).setOrigin(0.5).setFlipX(true);
    }
    // Shimmer is the only per-frame change — cheap setTint on two images.
    const tint = shimmerTint(time);
    this.l.setTint(tint).setVisible(true);
    this.r!.setTint(tint).setVisible(true);
    this.bg!.setVisible(true);

    // Reposition + rebuild the backing geometry only when the name actually moved or
    // resized — an idle player triggers no per-frame Graphics churn.
    const b = name.getBounds();
    const key = `${b.x | 0}|${b.y | 0}|${b.width | 0}|${b.height | 0}|${depth}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;

    // INTEGER scale only: these textures are pixelArt/NEAREST, so a fractional scale
    // (the room/alley name fonts are bigger than the hub's) samples unevenly and drops
    // the thin 1px features — the "clipping". Rounding keeps it crisp 1:1 and makes
    // every scene match the hub (which already lands on ~1.0).
    const scale = Math.max(1, Math.floor((b.height * 0.8) / ROWS));
    const half = (COLS * scale) / 2;
    const gap = 2 + half;
    this.l.setScale(scale).setDepth(depth).setPosition(b.x - gap, b.centerY);
    this.r!.setScale(scale).setDepth(depth).setPosition(b.right + gap, b.centerY);
    // Black pill backing spanning both ostriches (and bridging the name's own pill so
    // it reads as one continuous bar). Sits just behind the name + ostriches.
    const left = b.x - gap - half - 2;
    const right = b.right + gap + half + 2;
    this.bg!.clear();
    this.bg!.fillStyle(0x0a0014, 0.93);
    this.bg!.fillRoundedRect(left, b.y, right - left, b.height, 4);
    this.bg!.setDepth(depth - 0.5);
  }

  hide(): void { this.l?.setVisible(false); this.r?.setVisible(false); this.bg?.setVisible(false); }
  destroy(): void { this.l?.destroy(); this.r?.destroy(); this.bg?.destroy(); this.l = this.r = undefined; this.bg = undefined; }
}
