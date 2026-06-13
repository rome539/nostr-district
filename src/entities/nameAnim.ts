/**
 * nameAnim.ts — single source of truth for the per-character name-tag animations.
 *
 * Most name-tag anims (bob/pulse/zoom/jitter/swing/glow) transform the whole pill and
 * live inline in BaseScene + MarketPreview. The anims here are different: they manipulate
 * each *character* independently (its glyph, color, offset, scale, alpha, glow), so they
 * need the per-char Text rendering path (BaseScene's wave-char set / the preview's per-char
 * canvas loop). `charAnimStates()` computes one NameCharState per character for a given time;
 * every consumer renders from that, so a new char-anim is defined in ONE place.
 *
 * Determinism: states are a pure function of (type, name, time). No per-instance random
 * state, so the local player, remote players, and the shop preview all animate identically.
 * The "random" looks (glitch/decode) use a hash of (charIndex, timeBucket) so they're stable
 * within a frame and reproducible across surfaces.
 */

export interface NameCharState {
  glyph: string;       // character to draw (may be scrambled/corrupted)
  color: string;       // CSS color
  dx: number;          // x offset (px)
  dy: number;          // y offset (px)
  sx: number;          // x scale (around the char's own center)
  sy: number;          // y scale — split-flap squashes this for the flip
  alpha: number;       // 0..1
  glow: number;        // shadow blur in px (0 = none)
  glowColor?: string;  // defaults to color
}

/** Name anims that render character-by-character (vs. transforming the whole pill). */
export const CHAR_ANIMS: ReadonlySet<string> = new Set([
  'wave', 'glitch', 'decode', 'splitflap', 'shimmer',
  'typewriter', 'hologram', 'neonflicker', 'ember',
]);

const GLITCH_GLYPHS = '█▓▒░#@%&$/\\|<>=+*~';
const FLAPS         = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SCRAMBLE      = '!<>-_\\/[]{}—=+*^?#0123456789ABCDEF';

/** Deterministic 0..1 hash — used for the glitch/decode scramble so it's frame-stable. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function pick(set: string, n: number): string {
  return set[Math.floor(hash(n) * set.length)] ?? set[0];
}

/** One state per character of `name`, for animation `type` at time `t` (ms), in `color`. */
export function charAnimStates(type: string, name: string, t: number, color: string): NameCharState[] {
  const chars = Array.from(name);
  const len = chars.length;

  return chars.map((ch, i): NameCharState => {
    const s: NameCharState = { glyph: ch, color, dx: 0, dy: 0, sx: 1, sy: 1, alpha: 1, glow: 0 };

    switch (type) {
      case 'wave': {
        s.dy = Math.sin(t / 280 + i * 0.7) * 4;
        return s;
      }

      case 'glitch': {
        // ~18% of chars corrupt each ~70ms frame: glitch glyph + horizontal slice +
        // a cyan/magenta chromatic tint & glow. The rest stay clean.
        const bkt = Math.floor(t / 70);
        const r = hash(i * 17.3 + bkt);
        if (r < 0.18) {
          s.glyph = pick(GLITCH_GLYPHS, i * 3.7 + bkt * 1.7);
          s.dx = (hash(i * 5.1 + bkt * 2.3) - 0.5) * 4;
          const chroma = hash(i * 9.7 + bkt) < 0.5 ? '#00ffff' : '#ff00ff';
          s.color = chroma; s.glow = 4; s.glowColor = chroma;
        }
        return s;
      }

      case 'decode': {
        // Letters churn through random symbols, then lock left→right into the real name
        // with a brief white flash, hold, then re-scramble on loop. (Matrix decrypt.)
        const P = 2400;
        const p = (t % P) / P;
        const revealDur = 0.6;
        const lockP = ((i + 1) / len) * revealDur;
        if (p >= lockP) {
          const since = p - lockP;
          if (since < 0.05) { s.sx = s.sy = 1.25; s.glow = 5; s.glowColor = '#ffffff'; }
        } else {
          s.glyph = pick(SCRAMBLE, i * 7.1 + Math.floor(t / 45));
          s.alpha = 0.6;
        }
        return s;
      }

      case 'splitflap': {
        // Airport departure board: each char rolls *sequentially* through the alphabet
        // (with a vertical card-fold on every flip) and lands when it reaches its target
        // letter — so positions settle in a scattered order by letter-distance, not a
        // left→right wipe. That ordering + the fold is what sets it apart from Decode.
        const N = FLAPS.length;
        const stepMs = 55;
        const target = ch.toUpperCase();
        const tIdx = FLAPS.indexOf(target);
        const start = Math.floor(hash(i * 9.1) * N);
        const distance = tIdx < 0 ? 0 : (tIdx - start + N) % N;
        const flapDur = distance * stepMs;
        const P = N * stepMs + 1500; // common cycle so chars re-sync each loop
        const cyc = t % P;
        if (tIdx < 0 || cyc >= flapDur) {
          const since = cyc - flapDur;
          if (since >= 0 && since < 90) s.sy = 0.5 + (since / 90) * 0.5; // settle bounce
        } else {
          const stepF = cyc / stepMs;
          s.glyph = FLAPS[(start + Math.floor(stepF)) % N];
          const fold = Math.abs(Math.cos((stepF % 1) * Math.PI)); // 1→0→1 card fold
          s.sy = 0.18 + fold * 0.82;
          s.dy = (1 - s.sy) * 2;
        }
        return s;
      }

      case 'shimmer': {
        // A bright glint sweeps left→right across the letters (light catching metal/foil).
        const P = 1500;
        const pos = ((t % P) / P) * (len + 3) - 1.5;
        const k = Math.max(0, 1 - Math.abs(i - pos) / 1.6);
        s.glow = k * 6; s.glowColor = '#ffffff';
        s.sx = s.sy = 1 + k * 0.16;
        s.dy = -k * 1.5;
        if (k > 0.55) s.color = '#ffffff';
        return s;
      }

      case 'typewriter': {
        // Types out letter-by-letter with a blinking block caret at the frontier, holds
        // the full name, then backspaces and loops.
        const perChar = 130, holdFull = 1400, eraseRate = 70, holdEmpty = 350;
        const typeDur = len * perChar;
        const eraseDur = len * eraseRate;
        const P = typeDur + holdFull + eraseDur + holdEmpty;
        const cyc = t % P;
        let cursor: number;
        if (cyc < typeDur) cursor = Math.floor(cyc / perChar);
        else if (cyc < typeDur + holdFull) cursor = len;
        else if (cyc < typeDur + holdFull + eraseDur) cursor = len - Math.floor((cyc - typeDur - holdFull) / eraseRate);
        else cursor = 0;
        const caretOn = Math.floor(t / 350) % 2 === 0;
        if (i < cursor) { s.glyph = ch; }
        else if (i === cursor && caretOn) { s.glyph = '▋'; }
        else { s.glyph = ' '; s.alpha = 0; }
        return s;
      }

      case 'hologram': {
        // A projection in your own color: a scanline sweeps across with a soft glow and an
        // occasional projection roll/jitter. The clean sci-fi cousin to Glitch.
        const P = 1300;
        const pos = ((t % P) / P) * (len + 2) - 1;
        const k = Math.max(0, 1 - Math.abs(i - pos) / 1.8);
        s.glowColor = color;
        s.alpha = 0.72 + k * 0.28;
        s.glow = 2.5 + k * 3.5;
        const rc = t % 2400; // projection roll every ~2.4s
        if (rc < 160) {
          s.dy = (hash(i * 3.1 + Math.floor(t / 40)) - 0.5) * 4;
          s.dx = (hash(i * 7.7 + Math.floor(t / 40)) - 0.5) * 2;
          s.alpha *= 0.5;
        }
        return s;
      }

      case 'neonflicker': {
        // A failing neon sign: each letter is a lit tube (colored glow) that independently
        // buzzes and drops out on a staggered schedule, then recovers.
        s.glow = 5; s.glowColor = color;
        const P = 3200;
        const fc = (t + hash(i * 4.7) * P) % P;
        if (fc < 420) {
          if (hash(i * 2.3 + Math.floor(t / 55)) < 0.5) { s.alpha = 0.12; s.glow = 0; }
          else { s.alpha = 0.6; s.glow = 2; }
        }
        return s;
      }

      case 'ember': {
        // Smoldering heat in your own color: a heat-haze vertical wobble + a strong
        // brightness/glow flicker, hottest in the middle. Intensity-driven (no hue override).
        const mid = (len - 1) / 2;
        const heat = mid === 0 ? 1 : 1 - Math.abs(i - mid) / mid;
        // Two octaves of flicker so each letter pulses lively, not in lockstep.
        const flick = hash(i * 5.3 + Math.floor(t / 70)) * 0.6 + hash(i * 2.1 + Math.floor(t / 130)) * 0.4;
        s.glowColor = color;
        s.glow = 1 + heat * 3 + flick * 6;          // glow visibly throbs
        s.alpha = 0.4 + heat * 0.2 + flick * 0.4;   // ~0.4 → 1.0 ember pulse
        s.dy = Math.sin(t / 120 + i * 1.3) * 1.2 - heat * 0.6;
        s.sy = 1 + flick * 0.08;
        return s;
      }
    }
    return s;
  });
}
