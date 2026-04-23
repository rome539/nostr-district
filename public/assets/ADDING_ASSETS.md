# Adding New Pixel Art Assets

## Folder structure
```
public/assets/
  process.py          ← run this once to process all pending originals
  hats/
  accessories/
  tops/
  bottoms/
  ADDING_ASSETS.md
```

---

## Workflow overview (same for every slot)

1. Generate art with DALL-E using the prompt template for your slot
2. Save the raw PNG as `<name>_orig.png` in the correct folder
3. Run `python3 public/assets/process.py` — processes every `*_orig.png` automatically
4. Add one entry to `ITEM_DEFS` in `AvatarRenderer.ts` + one `loadItemImg` call
5. Add the new value to the union type and `AVATAR_OPTIONS` array in `avatarStore.ts`

---

## Step 1 — Create the art

Assets are drawn in **Aseprite** and exported as PNG with a transparent background. ChatGPT can be used to generate a rough reference that you then refine in Aseprite.

### ChatGPT prompt templates

**Hats** (things worn on or above the head):
> "Pixel art **[describe shape and structure]**, white and light grey pixel art with interior shading, transparent background, no gradients no anti-aliasing, hard pixel edges, bold thick outlines, no fine detail, 64x64 pixels"

**Accessories** (face / neck / body items — glasses, scarves, chains, masks):
> "Pixel art **[item]**, front-facing view, white and light grey pixel art with interior shading, transparent background, no gradients no anti-aliasing, hard pixel edges, bold thick outlines, no fine detail, 64x64 pixels, item only no character"

**Tops** (shirts, jackets, coats — front-facing, no character):
> "Pixel art **[garment]**, front view flat lay, white and light grey pixel art with interior shading and fold details, transparent background, no gradients no anti-aliasing, hard pixel edges, bold thick outlines, no fine detail, 64x64 pixels, clothing only no character"

**Bottoms** (pants, skirts, shorts — front-facing, no character):
> "Pixel art **[garment]**, front view flat lay, white and light grey pixel art with interior shading, transparent background, no gradients no anti-aliasing, hard pixel edges, bold thick outlines, no fine detail, 64x64 pixels, clothing only no character"

Attach `avatar-room-reference.png` (on Desktop) so the AI can see character proportions. Use the output as a starting point and refine in Aseprite.

---

## Step 2 — Save the PNG

Drop the **original** into the correct folder with an `_orig` suffix:

| Slot | Folder |
|------|--------|
| hat | `public/assets/hats/yourhat_orig.png` |
| accessory | `public/assets/accessories/youracc_orig.png` |
| top | `public/assets/tops/yourtop_orig.png` |
| bottom | `public/assets/bottoms/yourbottom_orig.png` |

Use simple lowercase names, no spaces. **Never save without `_orig`** — the processor overwrites the output file.

---

## Step 3 — Run the processor

```bash
python3 public/assets/process.py
```

Processes **all** `*_orig.png` files across all four folders. Prints the cropped dimensions — note the output size, you'll need the aspect ratio to dial in positioning.

---

## Step 4 — Wire up the renderer (`AvatarRenderer.ts`)

### 4a. Register the image
Add a `loadItemImg` call to the `itemImagesReady` array (around line 50):

```ts
export const itemImagesReady = Promise.all([
  loadItemImg('halo',       'assets/hats/halo.png'),
  // ...existing items...
  loadItemImg('youritem',   'assets/<slot>/youritem.png'),  // ← add here
]);
```

### 4b. Add to ITEM_DEFS
Add one entry to `ITEM_DEFS` (around line 30):

```ts
const ITEM_DEFS: Record<string, ItemDef> = {
  // Hats
  halo:     { anchor: 'headTop',  widthRatio: 1.0,  roomWidthRatio: 1.28, above: true,  yGap: 2 },
  catears:  { anchor: 'headTop',  widthRatio: 1.0,  above: true,  yGap: -5 },
  // Accessories
  youracc:  { anchor: 'eyeLine',  widthRatio: 0.9,  above: false, yGap: 0 },
  // Tops
  yourtop:  { anchor: 'shoulder', widthRatio: 1.0,  above: false, yGap: 0 },
  // Bottoms
  yourbot:  { anchor: 'waist',    widthRatio: 1.0,  above: false, yGap: 0 },
};
```

**All fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `anchor` | ✓ | Body reference point (see table below) |
| `widthRatio` | ✓ | Width as fraction of reference width (hub scale) |
| `roomWidthRatio` | — | Override `widthRatio` for room scale only. Use when hub and room need different proportions. |
| `above` | ✓ | `true` = image above anchor (hats). `false` = image below anchor (accessories/tops/bottoms) |
| `yGap` | ✓ | Room-scale px gap between image edge and anchor. Negative = overlaps anchor. |
| `roomYGap` | — | Override `yGap` for room scale only |
| `flipH` | — | Mirror the image horizontally |
| `xOffset` | — | Room-scale px horizontal nudge (scaled proportionally for hub) |
| `tintDark` | — | Tint near-black pixels instead of multiply blend (use for dark-outlined art) |
| `hubSrc` | — | Path to a separate hub-optimised image (e.g. `'assets/hats/headphones_hub.png'`). Use when the room image doesn't scale down cleanly to 8px. |

**Anchor reference** — all coordinates are room-scale pixels (oY = head top = 10):

| Anchor | Room Y | What it points to |
|--------|--------|-------------------|
| `headTop` | oY | top of head |
| `eyeLine` | oY + 5 | eye level |
| `mouthLine` | oY + 7 | mouth level |
| `neckLine` | oY + 11 | base of neck |
| `shoulder` | oY + 14 | shoulder line |
| `waist` | oY + 28 | waist line |

**above: true** → image sits above the anchor (use for hats). `yGap` = room-scale px between image bottom and anchor. 0 = bottom of image at anchor.

**above: false** → image starts at/below the anchor (use for accessories, tops, bottoms). `yGap` = room-scale px from anchor down to image top. 0 = top of image at anchor.

`widthRatio` is relative to head width (14px room) for head/face anchors, body width (16px room) for shoulder/waist anchors.

### 4c. Transparent hats (hair shows through)
Hats that float above or beside the head without covering it — `halo`, `catears`, `horns`, `hornsspiral` — are listed in `hatAllowsFullHair` in `AvatarRenderer.ts`. When a hat is in this list, full hair always renders underneath it regardless of hair style.

If you add a new hat that shouldn't hide hair, add its name to the `hatAllowsFullHair` array in both `renderHubSprite` and `renderRoomSprite`:

```ts
const hatAllowsFullHair = ['halo', 'catears', 'horns', 'hornsspiral', 'yournewhat'].includes(a.hat);
```

### 4d. Manual switch case (only for truly unusual placement)
`drawImgItemAuto` handles placement for all `ITEM_DEFS` entries automatically via the `default` case in each draw function. You only need a manual switch case if the item requires pixel-specific logic that can't be expressed as anchor + ratio (very rare).

---

## Step 5 — Add to the store (`avatarStore.ts`)

Two lines (line ~15 for the type, line ~82 for the options array):

```ts
// Union type
hat: '...' | 'newsboy' | 'yourhat';

// AVATAR_OPTIONS
hat: [..., 'newsboy', 'yourhat'] as const,
```

The wardrobe UI picks up new options automatically from `AVATAR_OPTIONS`.

---

## Sizing reference

Use these starting `widthRatio` values and adjust:

| Item type | widthRatio | anchor |
|-----------|-----------|--------|
| Wide hat / halo | 1.0–1.2 | headTop |
| Tall hat / ears | 0.7–0.9 | headTop |
| Glasses / mask | 0.9–1.0 | eyeLine |
| Scarf / bandana | 1.0 | mouthLine / neckLine |
| T-shirt / jacket | 1.0 | shoulder |
| Pants / skirt | 0.9–1.0 | waist |

---

## Coordinate reference

### Room sprite (24×60, `oY = 10`)
```
y=0    ← canvas top / tall hat limit
y=oY   ← head top (y=10)
y=15   ← eyes (eyeLine)
y=17   ← mouth (mouthLine)
y=21   ← neck base (neckLine)
y=24   ← shoulders (shoulder)
y=38   ← waist
y=44   ← legs start
y=54   ← feet
y=60   ← canvas bottom
```
Canvas is 24px wide. Head is x=5–18. Body/shoulders span x=4–19.

### Hub sprite (20×40, `s=2`, `cx=10`, `headY=4`)
```
hatY = headY + s + 2 = 8   ← headTop anchor
eyeLine  = headY + 3*s = 10
shoulder = headY + 7*s = 18
waist    = headY + 14*s = 32
```
Head: cx±4px = x=6–14. Body: x=5–15.

---

## Notes
- The color picker tints image items via multiply blend — white art takes the chosen color, grey shading is preserved
- The wardrobe picker picks up new options automatically from `AVATAR_OPTIONS`
- All image paths must be relative (no leading `/`) — vite uses `base: './'`
- `process.py` auto-discovers all `*_orig.png` — never edit it
