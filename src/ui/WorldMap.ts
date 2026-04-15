/**
 * WorldMap.ts — Floating HUD map showing the actual world topology.
 * Toggle with Tab or /map.
 *
 *   [CABIN]
 *      |
 *   [WOODS] ─── [HUB] ─── [ALLEY]
 *                  |
 *               [ROOMS]
 */

import { getCurrentRoom, requestZoneCounts, setZoneCountsHandler, ZoneCounts } from '../nostr/presenceService';
import { getThumb } from '../stores/sceneThumbs';

export class WorldMap {
  private el: HTMLDivElement | null = null;
  private svgEl: SVGSVGElement | null = null;
  private open = false;
  private pollTimer: number | null = null;
  private activeTimer: number | null = null;

  toggle(): void { this.open ? this.close() : this.show(); }
  isOpen(): boolean { return this.open; }

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'flex';
    this.open = true;
    this.applyThumbs();
    this.refresh();
    this.pollTimer = window.setInterval(() => this.refresh(), 30_000);
    this.activeTimer = window.setInterval(() => this.refreshActive(), 1000);
  }

  close(): void {
    if (this.el) this.el.style.display = 'none';
    this.open = false;
    if (this.pollTimer !== null) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.activeTimer !== null) { clearInterval(this.activeTimer); this.activeTimer = null; }
    setZoneCountsHandler(null);
  }

  destroy(): void {
    this.close();
    this.el?.remove();
    this.el = null;
    this.svgEl = null;
  }

  private refresh(): void {
    setZoneCountsHandler(data => {
      if (this.open && this.el) this.render(data);
    });
    requestZoneCounts();
  }

  private applyThumbs(): void {
    if (!this.svgEl) return;
    const thumbZones: [string, string][] = [
      ['wm-cabin', 'cabin'],
      ['wm-woods', 'woods'],
      ['wm-hub',   'hub'],
      ['wm-alley', 'alley'],
      ['wm-rooms', 'rooms'],
    ];
    for (const [id, zone] of thumbZones) {
      const node = this.svgEl.querySelector(`#${id}`) as SVGGElement | null;
      if (!node) continue;
      const imgEl = node.querySelector('.wm-thumb-img') as SVGImageElement | null;
      const thumb = getThumb(zone);
      if (imgEl && thumb) {
        imgEl.setAttribute('href', thumb);
        node.classList.add('wm-has-thumb');
      }
    }
  }

  /** Call this immediately after a room change to update the active highlight. */
  refreshActive(): void { this.render({} as ZoneCounts); }

  private render(_data: ZoneCounts): void {
    if (!this.svgEl) return;
    const myRoom = getCurrentRoom();
    const isInRoom = myRoom.startsWith('myroom:');

    const zones: [string, boolean][] = [
      ['wm-cabin', myRoom === 'cabin'],
      ['wm-woods', myRoom === 'woods'],
      ['wm-hub',   myRoom === 'hub'],
      ['wm-alley', myRoom === 'alley'],
      ['wm-rooms', isInRoom],
    ];

    this.applyThumbs();

    for (const [id, active] of zones) {
      const node = this.svgEl.querySelector(`#${id}`) as SVGGElement | null;
      if (!node) continue;
      node.classList.toggle('wm-active', active);
    }
  }

  private buildSVG(): string {
    // viewBox 290×202 — nodes 100×52
    // Left col:  x=20,  cx=70  (cabin, woods)
    // Right col: x=170, cx=220 (rooms, hub, alley)
    // Gap between cols: 50px (right-edge of left=120, left-edge of right=170)
    return `
    <svg class="wm-svg" viewBox="0 0 290 202" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <filter id="wm-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="wm-hline-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#5dcaa5" stop-opacity="0.08"/>
          <stop offset="50%"  stop-color="#5dcaa5" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#5dcaa5" stop-opacity="0.08"/>
        </linearGradient>
        <linearGradient id="wm-vline-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stop-color="#5dcaa5" stop-opacity="0.08"/>
          <stop offset="50%"  stop-color="#5dcaa5" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#5dcaa5" stop-opacity="0.08"/>
        </linearGradient>
        <linearGradient id="wm-thumb-fade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="30%"  stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.80"/>
        </linearGradient>
        <clipPath id="wm-clip-cabin"><rect x="20"  y="10"  width="100" height="52" rx="6"/></clipPath>
        <clipPath id="wm-clip-rooms"><rect x="170" y="10"  width="100" height="52" rx="6"/></clipPath>
        <clipPath id="wm-clip-woods"><rect x="20"  y="74"  width="100" height="52" rx="6"/></clipPath>
        <clipPath id="wm-clip-hub">  <rect x="170" y="74"  width="100" height="52" rx="6"/></clipPath>
        <clipPath id="wm-clip-alley"><rect x="170" y="140" width="100" height="52" rx="6"/></clipPath>
      </defs>

      <!-- Cabin → Woods -->
      <line x1="70"  y1="62"  x2="70"  y2="74"
            stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
      <!-- Rooms → Hub -->
      <line x1="220" y1="62"  x2="220" y2="74"
            stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
      <!-- Woods → Hub -->
      <line x1="120" y1="100" x2="170" y2="100"
            stroke="url(#wm-hline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
      <!-- Hub → Alley -->
      <line x1="220" y1="126" x2="220" y2="140"
            stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>

      <!-- ── Cabin ── -->
      <g class="wm-node" id="wm-cabin">
        <rect x="20" y="10" width="100" height="52" rx="6" class="wm-node-bg"/>
        <image class="wm-thumb-img" x="20" y="10" width="100" height="52"
               clip-path="url(#wm-clip-cabin)" preserveAspectRatio="xMidYMid slice" href=""/>
        <rect x="20" y="10" width="100" height="52" rx="6" class="wm-thumb-overlay" fill="url(#wm-thumb-fade)"/>
        <text x="70" y="29" text-anchor="middle" class="wm-icon">⌂</text>
        <text x="70" y="51" text-anchor="middle" class="wm-label">CABIN</text>
      </g>

      <!-- ── Rooms ── -->
      <g class="wm-node" id="wm-rooms">
        <rect x="170" y="10" width="100" height="52" rx="6" class="wm-node-bg"/>
        <image class="wm-thumb-img" x="170" y="10" width="100" height="52"
               clip-path="url(#wm-clip-rooms)" preserveAspectRatio="xMidYMid slice" href=""/>
        <rect x="170" y="10" width="100" height="52" rx="6" class="wm-thumb-overlay" fill="url(#wm-thumb-fade)"/>
        <text x="220" y="29" text-anchor="middle" class="wm-icon" style="font-size:12px">▣</text>
        <text x="220" y="51" text-anchor="middle" class="wm-label">ROOMS</text>
      </g>

      <!-- ── Woods ── -->
      <g class="wm-node" id="wm-woods">
        <rect x="20" y="74" width="100" height="52" rx="6" class="wm-node-bg"/>
        <image class="wm-thumb-img" x="20" y="74" width="100" height="52"
               clip-path="url(#wm-clip-woods)" preserveAspectRatio="xMidYMid slice" href=""/>
        <rect x="20" y="74" width="100" height="52" rx="6" class="wm-thumb-overlay" fill="url(#wm-thumb-fade)"/>
        <text x="70" y="93" text-anchor="middle" class="wm-icon">✦</text>
        <text x="70" y="115" text-anchor="middle" class="wm-label">WOODS</text>
      </g>

      <!-- ── Hub ── -->
      <g class="wm-node" id="wm-hub">
        <rect x="170" y="74" width="100" height="52" rx="6" class="wm-node-bg"/>
        <image class="wm-thumb-img" x="170" y="74" width="100" height="52"
               clip-path="url(#wm-clip-hub)" preserveAspectRatio="xMidYMid slice" href=""/>
        <rect x="170" y="74" width="100" height="52" rx="6" class="wm-thumb-overlay" fill="url(#wm-thumb-fade)"/>
        <text x="220" y="93" text-anchor="middle" class="wm-icon">◈</text>
        <text x="220" y="115" text-anchor="middle" class="wm-label">HUB</text>
      </g>

      <!-- ── Alley ── -->
      <g class="wm-node" id="wm-alley">
        <rect x="170" y="140" width="100" height="52" rx="6" class="wm-node-bg"/>
        <image class="wm-thumb-img" x="170" y="140" width="100" height="52"
               clip-path="url(#wm-clip-alley)" preserveAspectRatio="xMidYMid slice" href=""/>
        <rect x="170" y="140" width="100" height="52" rx="6" class="wm-thumb-overlay" fill="url(#wm-thumb-fade)"/>
        <text x="220" y="159" text-anchor="middle" class="wm-icon">▸</text>
        <text x="220" y="181" text-anchor="middle" class="wm-label">ALLEY</text>
      </g>
    </svg>`;
  }

  private build(): void {
    this.injectStyles();
    this.el = document.createElement('div');
    this.el.id = 'wm-root';
    this.el.innerHTML = this.buildSVG();

    this.svgEl = this.el.querySelector('.wm-svg') as SVGSVGElement;
    this.el.addEventListener('mousedown', e => { if (e.target === this.el) this.close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.close(); } });
    document.body.appendChild(this.el);
  }

  private injectStyles(): void {
    if (document.getElementById('wm-styles')) return;
    const s = document.createElement('style');
    s.id = 'wm-styles';
    s.textContent = `
      /* Full-screen dim — scene boxes float over it, no panel box */
      #wm-root {
        display:none;
        position:fixed; inset:0; z-index:4000;
        background:rgba(0,0,0,0.38);
        align-items:center; justify-content:center;
      }

      /* SVG sits directly in the dim overlay, no wrapper box */
      #wm-root .wm-svg {
        width:min(800px, 92vw); height:auto;
        display:block;
      }

      /* SVG fills the panel with no extra padding */
      .wm-svg { width:100%; height:auto; display:block; }

      /* Zone nodes — default */
      .wm-node-bg {
        fill:#05050f;
        stroke:rgba(93,202,165,0.16);
        stroke-width:1;
      }
      .wm-icon {
        font-size:14px;
        fill:rgba(93,202,165,0.40);
        font-family:'Courier New',monospace;
      }
      .wm-label {
        font-size:7px;
        fill:rgba(255,255,255,0.30);
        font-family:'Courier New',monospace;
        letter-spacing:1px;
      }

      /* Thumbnails — hidden until captured */
      .wm-thumb-img     { display:none; }
      .wm-thumb-overlay { display:none; pointer-events:none; }
      .wm-node.wm-has-thumb .wm-thumb-img     { display:block; }
      .wm-node.wm-has-thumb .wm-thumb-overlay { display:block; }
      .wm-node.wm-has-thumb .wm-icon          { display:none; }

      /* Active zone (you are here) */
      .wm-node.wm-active .wm-node-bg {
        stroke:#5dcaa5;
        stroke-width:1.5;
        filter:drop-shadow(0 0 10px rgba(93,202,165,0.50))
               drop-shadow(0 0 4px rgba(93,202,165,0.30));
      }
      .wm-node.wm-active .wm-icon  { fill:#5dcaa5; }
      .wm-node.wm-active .wm-label { fill:rgba(93,202,165,0.85); }
    `;
    document.head.appendChild(s);
  }
}

/** Singleton — shared across all scenes so the map stays open during room changes */
export const worldMap = new WorldMap();
