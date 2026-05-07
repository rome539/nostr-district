export type BlinkingLED = { x: number; y: number; color: string; phase: number };
export type CandleFlame = { x: number; y: number; phase: number };
export type FireplaceFlame = { x: number; y: number; w: number };
export type VoidStar = { x: number; y: number; color: string; phase: number; size: number };

export type FillRect = (ax: number, ay: number, aw: number, ah: number, col: string) => void;

export function makeR(x: CanvasRenderingContext2D): FillRect {
  return (ax, ay, aw, ah, col) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); };
}

export function lighten(hex: string, amt = 20): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const rv = clamp(((n >> 16) & 0xff) + amt);
  const gv = clamp(((n >> 8) & 0xff) + amt);
  const bv = clamp((n & 0xff) + amt);
  return '#' + [rv, gv, bv].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function darken(hex: string, amt = 20): string {
  return lighten(hex, -amt);
}
