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
    // viewBox 310×232 — nodes 100×56, padded for corner brackets
    // Left col:  x=30,  cx=80  (cabin, woods)
    // Right col: x=180, cx=230 (rooms, hub, alley)
    const node = (id: string, label: string, icon: string, x: number, y: number, iconStyle = '') => `
      <g class="wm-node" id="${id}">
        <rect x="${x}" y="${y}" width="100" height="56" rx="6" class="wm-node-bg"/>
        <image class="wm-thumb-img" x="${x}" y="${y}" width="100" height="56"
               clip-path="url(#wm-clip-${id.replace('wm-','')})" preserveAspectRatio="xMidYMid slice" href=""/>
        <rect x="${x}" y="${y}" width="100" height="56" rx="6" class="wm-thumb-overlay" fill="url(#wm-thumb-fade)"/>
        <rect x="${x}" y="${y + 38}" width="100" height="18" class="wm-label-bar"/>
        <text x="${x + 50}" y="${y + 22}" text-anchor="middle" class="wm-icon" ${iconStyle}>${icon}</text>
        <text x="${x + 50}" y="${y + 51}" text-anchor="middle" class="wm-label">${label}</text>
        <!-- corner brackets -->
        <path d="M${x - 1} ${y + 7} L${x - 1} ${y - 1} L${x + 7} ${y - 1}" class="wm-bracket"/>
        <path d="M${x + 93} ${y - 1} L${x + 101} ${y - 1} L${x + 101} ${y + 7}" class="wm-bracket"/>
        <path d="M${x - 1} ${y + 49} L${x - 1} ${y + 57} L${x + 7} ${y + 57}" class="wm-bracket"/>
        <path d="M${x + 93} ${y + 57} L${x + 101} ${y + 57} L${x + 101} ${y + 49}" class="wm-bracket"/>
        <!-- active pulse ring -->
        <rect x="${x - 2}" y="${y - 2}" width="104" height="60" rx="7" class="wm-pulse"/>
      </g>`;

    return `
    <svg class="wm-svg" viewBox="0 0 310 232" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <filter id="wm-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="wm-hline-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#5dcaa5" stop-opacity="0.20"/>
          <stop offset="50%"  stop-color="#5dcaa5" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#5dcaa5" stop-opacity="0.20"/>
        </linearGradient>
        <linearGradient id="wm-vline-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stop-color="#5dcaa5" stop-opacity="0.20"/>
          <stop offset="50%"  stop-color="#5dcaa5" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#5dcaa5" stop-opacity="0.20"/>
        </linearGradient>
        <linearGradient id="wm-thumb-fade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="30%"  stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.85"/>
        </linearGradient>
        <clipPath id="wm-clip-cabin"><rect x="30"  y="20"  width="100" height="56" rx="6"/></clipPath>
        <clipPath id="wm-clip-rooms"><rect x="180" y="20"  width="100" height="56" rx="6"/></clipPath>
        <clipPath id="wm-clip-woods"><rect x="30"  y="88"  width="100" height="56" rx="6"/></clipPath>
        <clipPath id="wm-clip-hub">  <rect x="180" y="88"  width="100" height="56" rx="6"/></clipPath>
        <clipPath id="wm-clip-alley"><rect x="180" y="156" width="100" height="56" rx="6"/></clipPath>
      </defs>

      <!-- Connection lines + flowing data dashes -->
      <g class="wm-lines">
        <!-- Cabin → Woods (vertical) -->
        <line x1="80"  y1="76"  x2="80"  y2="88"  stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="80"  y1="76"  x2="80"  y2="88"  class="wm-line-flow"/>
        <!-- Rooms → Hub (vertical) -->
        <line x1="230" y1="76"  x2="230" y2="88"  stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="230" y1="76"  x2="230" y2="88"  class="wm-line-flow"/>
        <!-- Woods → Hub (horizontal) -->
        <line x1="130" y1="116" x2="180" y2="116" stroke="url(#wm-hline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="130" y1="116" x2="180" y2="116" class="wm-line-flow"/>
        <!-- Hub → Alley (vertical) -->
        <line x1="230" y1="144" x2="230" y2="156" stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="230" y1="144" x2="230" y2="156" class="wm-line-flow"/>
        <!-- Junction dots -->
        <circle cx="80"  cy="82"  r="1.6" class="wm-junction"/>
        <circle cx="230" cy="82"  r="1.6" class="wm-junction"/>
        <circle cx="155" cy="116" r="1.6" class="wm-junction"/>
        <circle cx="230" cy="150" r="1.6" class="wm-junction"/>
      </g>

      ${node('wm-cabin', 'CABIN', '⌂',  30,  20)}
      ${node('wm-rooms', 'ROOMS', '▣', 180, 20,  'style="font-size:12px"')}
      ${node('wm-woods', 'WOODS', '✦',  30,  88)}
      ${node('wm-hub',   'HUB',   '◈', 180,  88)}
      ${node('wm-alley', 'ALLEY', '▸', 180, 156)}
    </svg>`;
  }

  private build(): void {
    this.injectStyles();
    this.el = document.createElement('div');
    this.el.id = 'wm-root';
    this.el.innerHTML = `
      <div class="wm-frame">
        <div class="wm-frame-corner wm-fc-tl"></div>
        <div class="wm-frame-corner wm-fc-tr"></div>
        <div class="wm-frame-corner wm-fc-bl"></div>
        <div class="wm-frame-corner wm-fc-br"></div>
        <div class="wm-header">
          <span class="wm-header-dot"></span>
          <span class="wm-header-title">DISTRICT MAP</span>
          <span class="wm-header-meta">v1.0</span>
        </div>
        <div class="wm-svg-wrap">
          ${this.buildSVG()}
          <div class="wm-scanlines"></div>
        </div>
        <div class="wm-footer">
          <span class="wm-footer-status">◉ LIVE</span>
          <span class="wm-footer-hint">ESC / TAB to close</span>
        </div>
      </div>`;

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
      /* Full-screen dim */
      #wm-root {
        display:none;
        position:fixed; inset:0; z-index:4000;
        background:radial-gradient(ellipse at center, rgba(0,0,0,0.55), rgba(0,0,0,0.78));
        align-items:center; justify-content:center;
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        animation: wm-fade-in 180ms ease-out;
      }
      @keyframes wm-fade-in { from { opacity: 0; } to { opacity: 1; } }

      /* Frame container */
      .wm-frame {
        position: relative;
        width: min(720px, 92vw);
        padding: 12px 16px 10px;
        background: linear-gradient(180deg,
          rgba(8,12,18,0.92) 0%,
          rgba(5,7,12,0.95) 100%);
        border: 1px solid rgba(93,202,165,0.28);
        border-radius: 4px;
        box-shadow:
          0 0 0 1px rgba(0,0,0,0.4) inset,
          0 0 40px rgba(93,202,165,0.12),
          0 20px 60px rgba(0,0,0,0.6);
        animation: wm-pop-in 220ms cubic-bezier(.2,.9,.3,1.1);
      }
      @keyframes wm-pop-in {
        from { transform: scale(0.96); opacity: 0; }
        to   { transform: scale(1); opacity: 1; }
      }

      /* Cyberpunk corner brackets on the frame */
      .wm-frame-corner {
        position: absolute; width: 14px; height: 14px;
        border: 1.5px solid #5dcaa5;
        pointer-events: none;
      }
      .wm-fc-tl { top: -1px; left: -1px;     border-right: none; border-bottom: none; }
      .wm-fc-tr { top: -1px; right: -1px;    border-left: none;  border-bottom: none; }
      .wm-fc-bl { bottom: -1px; left: -1px;  border-right: none; border-top: none;    }
      .wm-fc-br { bottom: -1px; right: -1px; border-left: none;  border-top: none;    }

      /* Header */
      .wm-header {
        display: flex; align-items: center; gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px dashed rgba(93,202,165,0.18);
        margin-bottom: 10px;
        font-family: 'Courier New', monospace;
      }
      .wm-header-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #5dcaa5;
        box-shadow: 0 0 6px #5dcaa5, 0 0 12px rgba(93,202,165,0.5);
        animation: wm-blink 1.6s ease-in-out infinite;
      }
      @keyframes wm-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      .wm-header-title {
        font-size: 11px; letter-spacing: 0.22em;
        color: #5dcaa5;
        text-shadow: 0 0 8px rgba(93,202,165,0.4);
      }
      .wm-header-meta {
        margin-left: auto;
        font-size: 9px; letter-spacing: 0.15em;
        color: rgba(255,255,255,0.28);
      }

      /* SVG */
      .wm-svg-wrap { position: relative; }
      .wm-svg { width: 100%; height: auto; display: block; }

      /* Subtle scanlines over the whole map */
      .wm-scanlines {
        position: absolute; inset: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          to bottom,
          rgba(255,255,255,0.012) 0px,
          rgba(255,255,255,0.012) 1px,
          transparent 1px,
          transparent 3px);
        mix-blend-mode: overlay;
        opacity: 0.6;
      }

      /* Footer */
      .wm-footer {
        display: flex; align-items: center; justify-content: space-between;
        padding-top: 8px; margin-top: 6px;
        border-top: 1px dashed rgba(93,202,165,0.18);
        font-family: 'Courier New', monospace;
        font-size: 9px; letter-spacing: 0.15em;
      }
      .wm-footer-status { color: #5dcaa5; opacity: 0.85; }
      .wm-footer-hint   { color: rgba(255,255,255,0.32); }

      /* ───── Nodes ───── */
      .wm-node-bg {
        fill: #05050f;
        stroke: rgba(93,202,165,0.22);
        stroke-width: 1;
      }
      .wm-bracket {
        fill: none;
        stroke: rgba(93,202,165,0.35);
        stroke-width: 1.2;
      }
      .wm-label-bar {
        fill: rgba(0,0,0,0.55);
        opacity: 0;
      }
      .wm-node.wm-has-thumb .wm-label-bar { opacity: 1; }

      .wm-icon {
        font-size: 14px;
        fill: rgba(93,202,165,0.55);
        font-family: 'Courier New', monospace;
      }
      .wm-label {
        font-size: 7px;
        fill: rgba(255,255,255,0.55);
        font-family: 'Courier New', monospace;
        letter-spacing: 1.5px;
        font-weight: bold;
      }

      /* Thumbnails */
      .wm-thumb-img     { display: none; }
      .wm-thumb-overlay { display: none; pointer-events: none; }
      .wm-node.wm-has-thumb .wm-thumb-img     { display: block; }
      .wm-node.wm-has-thumb .wm-thumb-overlay { display: block; }
      .wm-node.wm-has-thumb .wm-icon          { display: none; }

      /* Active pulse ring (hidden by default) */
      .wm-pulse {
        fill: none;
        stroke: #5dcaa5;
        stroke-width: 1.2;
        opacity: 0;
        pointer-events: none;
      }
      .wm-node.wm-active .wm-pulse {
        opacity: 1;
        animation: wm-pulse-anim 1.8s ease-out infinite;
        transform-origin: center;
      }
      @keyframes wm-pulse-anim {
        0%   { opacity: 0.7; stroke-width: 1.2; }
        70%  { opacity: 0;   stroke-width: 2.5; }
        100% { opacity: 0; }
      }

      /* Active zone */
      .wm-node.wm-active .wm-node-bg {
        stroke: #5dcaa5;
        stroke-width: 1.8;
        filter: drop-shadow(0 0 10px rgba(93,202,165,0.55))
                drop-shadow(0 0 4px rgba(93,202,165,0.4));
      }
      .wm-node.wm-active .wm-bracket { stroke: #5dcaa5; }
      .wm-node.wm-active .wm-icon    { fill: #5dcaa5; }
      .wm-node.wm-active .wm-label   { fill: #5dcaa5; opacity: 0.95; }

      /* ───── Connection lines ───── */
      .wm-line-flow {
        stroke: #5dcaa5;
        stroke-width: 1;
        stroke-dasharray: 2 6;
        opacity: 0.55;
        animation: wm-flow 1.6s linear infinite;
      }
      @keyframes wm-flow {
        from { stroke-dashoffset: 0; }
        to   { stroke-dashoffset: -16; }
      }
      .wm-junction {
        fill: #5dcaa5;
        opacity: 0.7;
        filter: drop-shadow(0 0 3px rgba(93,202,165,0.7));
      }
    `;
    document.head.appendChild(s);
  }
}

/** Singleton — shared across all scenes so the map stays open during room changes */
export const worldMap = new WorldMap();
