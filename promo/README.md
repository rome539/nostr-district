# ND Promo Kit

Everything used to make the promos (2026-07-02, 11 shipped). Fully local: no external
services, no stock assets, no copyright exposure — visuals are hand-coded canvas
or real game capture, music is synthesized WAVs.

Lives in the repo at `promo/`. Render output (mp4/webm/wav) is gitignored —
finished videos go to `~/Desktop/ND PROMO/`.

## One-time setup

```bash
cd promo
npm install          # puppeteer-core + ffmpeg-static (package.json included)
```

Chrome must be installed (`/Applications/Google Chrome.app`). For gameplay
capture, the ND dev stack must be running (vite on **localhost:3001**, presence
server on 3100 — keyless `npm run server` = in-memory sandbox, safe).

## The two pipelines

### A. Motion pieces (no gameplay) — promo3/4/5/6/7/8.html
Self-contained canvas animations. Every scene is a `draw(t)` function keyed off
seconds; `window.__run(duration)` records the canvas via
`captureStream(60)` + MediaRecorder and returns base64 webm.

```bash
node capture-motion.mjs                      # or any capture-*.mjs (edit the html/webm names inside)
node make-music-motion.mjs                   # writes the WAV
FF=$(node -e "process.stdout.write(require('ffmpeg-static'))")
"$FF" -y -i motion-fixed.webm -i motion-music.wav \
  -filter_complex "[0:v]scale=1920:1080:flags=neighbor[v];[1:a]atrim=0:DUR,volume=0.95[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -r 60 \
  -c:a aac -b:a 192k -movflags +faststart out.mp4
```
(Streamed webms report no duration — remux first: `"$FF" -i raw.webm -c copy fixed.webm`.)

Which file is which:
- `promo3.html` — brand motion piece (typewriter → skyline → neon signs)
- `promo4.html` — "pirate broadcast" maximalist (RGB slams, npub matrix rain, warp, ₿ carousel, ostrich, datamosh, CRT-off)
- `promo5.html` — July 4 event (real fireworks shell math incl. ₿/ostrich picture bursts)
- `promo6.html` — "The Legends" wanted posters (real fish sprites embedded as data URLs)
- `promo7.html` — "A city with seasons" (game's own heart/bat/lantern draw code, real date
  windows). v3 (34s): finale lists ALL 11 holidays from src/ui/holidayBanners.ts in a
  two-column calendar (real banner emoji + real windows, chronological), not just the four
  sky-FX seasons — rome asked for the whole list. Music retimed: montage booms → 11
  ascending pentatonic plinks synced to row reveals.
- `promo8.html` — "The Bazaar" (real ITEM_CATALOG names/emoji + canonical RARITY_COLOR)

### B. Gameplay capture — capture-promo.mjs / capture-woods.mjs
Drives the real game as a guest and records the Phaser canvas.
- **Pre-seeds `localStorage.nd_tutorial_done=1`** — without this the first-run tutorial ruins the shot.
- Login: `#login-create` → `#create-guest` (retry loop; the click can land before listeners attach).
- Drive scenes via the DEV-only `window.__nd_game`: `sc.targetX/isMoving` to walk,
  `sc.handleEmoteCommand('hearts')`, `sc.enterRoom('lounge',...)`, `sc.enterWoods()`,
  woods: `sc.handleFishingPress()` (poll `sc.fishingState==='bite'` to reel on camera).
- `assemble.sh` / `assemble-woods.sh` show the card/caption/drawtext treatment.

## House style
- Canvas 960×540, upscale 2× with `scale=1920:1080:flags=neighbor` (crisp pixels).
- Palette: pink #ff71ce · teal #5dcaa5 · amber #f0b040 · purple #7b68ee · cream #fff5e6 on #0a0014
  (woods variant: #08140c bg, amber text). Rarity: junk #888888 · common #a0c8a0 · rare #70b0ff · legendary #ffd700.
- Font: `/System/Library/Fonts/Supplemental/Courier New Bold.ttf` (ffmpeg drawtext) / `bold …px "Courier New"` (canvas).
- Always: scanlines (1px black rows every 3px @ 0.15) + radial vignette. Fade to black at the end.
- Flash safety: keep flashes ≤3/sec.
- Music generators all follow the same shape: layered synth (square/tri/sine + noise) on a
  beat grid, sections gated by `t`, events (booms/thunks/blips) as explicit timestamp arrays
  **synced to the visual timeline**, `Math.tanh` soft-clip, fade in/out, 16-bit stereo WAV.

## Hard-won gotchas
- Sprites into canvas pieces: embed as **data URLs** (see promo6 + the fishdata generator
  below) — file:// or cross-origin images taint the canvas and captureStream dies.
- ffmpeg `noise` grain destroys compression: alls=3 + crf 22, never alls=5 + crf 18 (60MB).
- Rocket travel time ≈ (launchY−targetY)/vy — schedule caption timestamps at BURST time, not launch.
- Long labels: auto-shrink font until `measureText ≤ cardWidth−14` (promo8 `card()`).
- Regenerate fish sprites embed:
  `node -e "...read public/assets/fish/*.png → fishdata.js"` (see promo6 header or the pipeline memory).

## Accuracy rules (rome's bar)
- Never mock up game UI or depict features abstractly if it doesn't look like the real thing —
  cut it or reduce it to a plain text caption (July 4 promo learned this).
- Use real assets, real names, real numbers from the code (server.ts LEGENDARY_FISH_META,
  ITEM_CATALOG, date windows in utils/*.ts). Stylistic frames (posters, cards) are fine.
- Copy that landed: "your keys · your city", "every citizen a keypair", "touch grass · keep
  your keys", "no lords · no feeds · your keys", "every item a signed nostr event".
- Feature word is HOME, not BUILD.

## Added later (same day)
- `promo9.html` + `gen-avatars.mjs` + `avatardata.js` — "MAKE YOURSELF" customization cut.
  gen-avatars renders REAL avatars via `import('/src/entities/AvatarRenderer.ts')` on the
  dev server (await `itemImagesReady`!) — pixel-perfect in-game sprites, no recreation.
  718,204,032 = product of the AvatarConfig union sizes (4×18×28×17×26×31×26).
- `promo10.html` + `furndata.js` — "MAKE IT HOME" room-decor cut. Real furniture PNGs
  from public/assets/furniture (embed via the same base64 one-liner pattern as fish).
  In-game, colorable PNG furniture gets Phaser setTint ONLY when a color is set
  (MyRoomSystem.ts) — promo replicates with canvas multiply+destination-in using the
  first FURNITURE_DATA swatch (couch/armchair #3d2860, beanbag #c44060); untinted
  white pieces are also an accurate state. Real counts: ~61 furniture · 11 floors ·
  5 walls · 11 posters.
- `promo11.html` + `breezdata.js` + `breez-logo.png` — Breez Spark wallet cut (35s).
  Street scene reuses the REAL avatars from avatardata.js (6 outfits, name tags) with
  zap bolts arcing between players; amounts are the real ZapModal presets (21/100/500/
  1000/5000). Spend beat: shop prices from marketStore.ts, bazaar items from
  ITEM_CATALOG w/ rarity colors. Verified: shop checkout AND bazaar buys route through
  sendSparkPayment — "one wallet pays for all of it" is accurate. Breez logo from
  github.com/breez.png, smooth-scaled (not pixel art). rome wants the player-to-player
  zap bolt IN GAME later (pinned in memory).
