/**
 * loginHolidayFX.ts — All date-gated visual effects for the login screen canvas.
 * LoginScreen.ts just calls tick() each frame. Add new holidays here only.
 */
import { FireworksEngine, drawFireworksCanvas, isJuly4thPeriod, FW_SHAPE_MIX } from '../utils/fireworks';
import { BatEngine, newBatEngine, drawBatsCanvas, isHalloweenPeriod } from '../utils/bats';
import { HeartsEngine, newHeartsEngine, drawHeartsCanvas, isValentinePeriod } from '../utils/valentineFX';

export class LoginHolidayFX {
  private fireworks: FireworksEngine | null = null;
  private bats: BatEngine | null = null;
  private hearts: HeartsEngine | null = null;
  private W = 0;
  private H = 0;

  init(W: number, H: number): void {
    this.W = W; this.H = H;
    this.fireworks = isJuly4thPeriod() ? new FireworksEngine(W, H, { shapes: FW_SHAPE_MIX }) : null;
    if (isHalloweenPeriod()) {
      this.bats = newBatEngine(W, { yMin: 30, yMax: H * 0.6, count: 7, speedMin: 0.5, speedMax: 1.2 });
    }
    this.hearts = isValentinePeriod() ? newHeartsEngine(W, H, { yMin: 20, yMax: H, count: 10, speedMin: 0.3, speedMax: 0.7 }) : null;
  }

  resize(W: number, H: number): void {
    this.init(W, H);
  }

  tick(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.fireworks) { this.fireworks.tick(time, 16); drawFireworksCanvas(ctx, this.fireworks); }

    if (isHalloweenPeriod()) {
      this.drawSpookyMoon(ctx, time);
      if (this.bats) { this.bats.tick(time, 16); drawBatsCanvas(ctx, this.bats, time); }
    }

    if (isValentinePeriod()) {
      this.drawHeartMoon(ctx, time);
      if (this.hearts) { this.hearts.tick(time, 16); drawHeartsCanvas(ctx, this.hearts); }
    }
  }

  private drawHeartMoon(ctx: CanvasRenderingContext2D, time: number): void {
    const cx = this.W * 0.78;
    const cy = this.H * 0.18;
    const r  = 34;
    const pulse = 0.10 + Math.sin(time * 0.001) * 0.04;
    // outer glow
    const grd = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.6);
    grd.addColorStop(0, `rgba(255,93,143,${pulse})`);
    grd.addColorStop(1, 'rgba(255,93,143,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2); ctx.fill();
    // heart body — fill the point and each lobe SEPARATELY so overlapping
    // subpaths can't cancel under the nonzero winding rule (which would punch a
    // transparent band through the middle).
    // One smooth, symmetric heart curve (4 mirrored béziers). The right half is
    // the exact mirror of the left, so the bottom point sits dead-centre.
    const s = r;
    ctx.fillStyle = '#e23d6a';
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.85);
    ctx.bezierCurveTo(cx - s * 1.0, cy + s * 0.1,  cx - s * 1.0, cy - s * 0.6,  cx - s * 0.5, cy - s * 0.6);
    ctx.bezierCurveTo(cx - s * 0.2, cy - s * 0.6,  cx,           cy - s * 0.3,  cx,           cy - s * 0.1);
    ctx.bezierCurveTo(cx,           cy - s * 0.3,  cx + s * 0.2, cy - s * 0.6,  cx + s * 0.5, cy - s * 0.6);
    ctx.bezierCurveTo(cx + s * 1.0, cy - s * 0.6,  cx + s * 1.0, cy + s * 0.1,  cx,           cy + s * 0.85);
    ctx.closePath(); ctx.fill();
    // glossy highlight
    ctx.fillStyle = '#ff90b3';
    ctx.beginPath(); ctx.arc(cx - s * 0.42, cy - s * 0.34, s * 0.2, 0, Math.PI * 2); ctx.fill();
  }

  private drawSpookyMoon(ctx: CanvasRenderingContext2D, time: number): void {
    const mx = this.W * 0.78;
    const my = this.H * 0.18;
    const r  = 28;
    const pulse = 0.08 + Math.sin(time * 0.0008) * 0.03;
    // outer glow
    const grd = ctx.createRadialGradient(mx, my, r * 0.6, mx, my, r * 2.2);
    grd.addColorStop(0, `rgba(255,130,0,${pulse})`);
    grd.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(mx, my, r * 2.2, 0, Math.PI * 2); ctx.fill();
    // moon face
    ctx.fillStyle = '#e87010';
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c85800';
    ctx.beginPath(); ctx.arc(mx + r * 0.25, my - r * 0.15, r * 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e87010';
    ctx.beginPath(); ctx.arc(mx + r * 0.15, my - r * 0.22, r * 0.55, 0, Math.PI * 2); ctx.fill();
  }
}
