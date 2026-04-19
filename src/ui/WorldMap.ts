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
      // wm-boat and wm-door are placeholders — no thumbnails yet
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
    // viewBox 470×218 — nodes 80×46, padded for corner brackets
    // Col 1 (boat):            x=30,  cx=70
    // Col 2 (cabin/woods):     x=140, cx=180
    // Col 3 (rooms/hub/alley): x=250, cx=290
    // Col 4 (east/door ?):     x=360, cx=400
    // Rows: y=20 (cabin/rooms), 86 (boat/woods/hub/east), 152 (alley/door)
    const node = (id: string, label: string, icon: string, x: number, y: number, iconStyle = '', soon = false) => `
      <g class="wm-node${soon ? ' wm-node-soon' : ''}" id="${id}">
        <rect x="${x}" y="${y}" width="80" height="46" rx="5" class="wm-node-bg"/>
        <image class="wm-thumb-img" x="${x}" y="${y}" width="80" height="46"
               clip-path="url(#wm-clip-${id.replace('wm-','')})" preserveAspectRatio="xMidYMid slice" href=""/>
        <rect x="${x}" y="${y}" width="80" height="46" rx="5" class="wm-thumb-overlay" fill="url(#wm-thumb-fade)"/>
        <rect x="${x}" y="${y + 31}" width="80" height="15" class="wm-label-bar"/>
        <text x="${x + 40}" y="${y + 20}" text-anchor="middle" class="wm-icon" ${iconStyle}>${icon}</text>
        <text x="${x + 40}" y="${y + 42}" text-anchor="middle" class="wm-label">${label}</text>
        <!-- corner brackets -->
        <path d="M${x - 1} ${y + 5} L${x - 1} ${y - 1} L${x + 5} ${y - 1}" class="wm-bracket"/>
        <path d="M${x + 75} ${y - 1} L${x + 81} ${y - 1} L${x + 81} ${y + 5}" class="wm-bracket"/>
        <path d="M${x - 1} ${y + 41} L${x - 1} ${y + 47} L${x + 5} ${y + 47}" class="wm-bracket"/>
        <path d="M${x + 75} ${y + 47} L${x + 81} ${y + 47} L${x + 81} ${y + 41}" class="wm-bracket"/>
        <!-- active pulse ring -->
        <rect x="${x - 2}" y="${y - 2}" width="84" height="50" rx="6" class="wm-pulse"/>
      </g>`;

    return `
    <svg class="wm-svg" viewBox="0 0 470 218" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
        <clipPath id="wm-clip-cabin"><rect x="140" y="20"  width="80" height="46" rx="5"/></clipPath>
        <clipPath id="wm-clip-rooms"><rect x="250" y="20"  width="80" height="46" rx="5"/></clipPath>
        <clipPath id="wm-clip-boat"> <rect x="30"  y="86"  width="80" height="46" rx="5"/></clipPath>
        <clipPath id="wm-clip-woods"><rect x="140" y="86"  width="80" height="46" rx="5"/></clipPath>
        <clipPath id="wm-clip-hub">  <rect x="250" y="86"  width="80" height="46" rx="5"/></clipPath>
        <clipPath id="wm-clip-alley"><rect x="250" y="152" width="80" height="46" rx="5"/></clipPath>
        <clipPath id="wm-clip-door"> <rect x="360" y="152" width="80" height="46" rx="5"/></clipPath>
        <clipPath id="wm-clip-east"> <rect x="360" y="86"  width="80" height="46" rx="5"/></clipPath>
      </defs>

      <!-- Connection lines + flowing data dashes -->
      <g class="wm-lines">
        <!-- Cabin → Woods (vertical) -->
        <line x1="180" y1="66"  x2="180" y2="86"  stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="180" y1="66"  x2="180" y2="86"  class="wm-line-flow"/>
        <!-- Rooms → Hub (vertical) -->
        <line x1="290" y1="66"  x2="290" y2="86"  stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="290" y1="66"  x2="290" y2="86"  class="wm-line-flow"/>
        <!-- Boat → Woods (horizontal) -->
        <line x1="110" y1="109" x2="140" y2="109" stroke="url(#wm-hline-grad)" stroke-width="1.5" filter="url(#wm-glow)" opacity="0.6"/>
        <line x1="110" y1="109" x2="140" y2="109" class="wm-line-flow wm-line-soon"/>
        <!-- Woods → Hub (horizontal) -->
        <line x1="220" y1="109" x2="250" y2="109" stroke="url(#wm-hline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="220" y1="109" x2="250" y2="109" class="wm-line-flow"/>
        <!-- Hub → Alley (vertical) -->
        <line x1="290" y1="132" x2="290" y2="152" stroke="url(#wm-vline-grad)" stroke-width="1.5" filter="url(#wm-glow)"/>
        <line x1="290" y1="132" x2="290" y2="152" class="wm-line-flow"/>
        <!-- Alley → Door (horizontal) -->
        <line x1="330" y1="175" x2="360" y2="175" stroke="url(#wm-hline-grad)" stroke-width="1.5" filter="url(#wm-glow)" opacity="0.6"/>
        <line x1="330" y1="175" x2="360" y2="175" class="wm-line-flow wm-line-soon"/>
        <!-- Hub → East (horizontal) -->
        <line x1="330" y1="109" x2="360" y2="109" stroke="url(#wm-hline-grad)" stroke-width="1.5" filter="url(#wm-glow)" opacity="0.6"/>
        <line x1="330" y1="109" x2="360" y2="109" class="wm-line-flow wm-line-soon"/>
        <!-- Junction dots -->
        <circle cx="180" cy="76"  r="1.4" class="wm-junction"/>
        <circle cx="290" cy="76"  r="1.4" class="wm-junction"/>
        <circle cx="125" cy="109" r="1.4" class="wm-junction wm-junction-soon"/>
        <circle cx="235" cy="109" r="1.4" class="wm-junction"/>
        <circle cx="345" cy="109" r="1.4" class="wm-junction wm-junction-soon"/>
        <circle cx="290" cy="142" r="1.4" class="wm-junction"/>
        <circle cx="345" cy="175" r="1.4" class="wm-junction wm-junction-soon"/>
      </g>

      ${node('wm-cabin', 'CABIN', '⌂', 140,  20)}
      ${node('wm-rooms', 'ROOMS', '▣', 250, 20,  'style="font-size:11px"')}
      ${node('wm-boat',  '???',   '?',  30,  86, '', true)}
      ${node('wm-woods', 'WOODS', '✦', 140,  86)}
      ${node('wm-hub',   'HUB',   '◈', 250,  86)}
      ${node('wm-east',  '???',   '?', 360,  86, '', true)}
      ${node('wm-alley', 'ALLEY', '▸', 250, 152)}
      ${node('wm-door',  '???',   '?', 360, 152, '', true)}
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
        width: min(740px, 94vw);
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
        font-size: 12px;
        fill: rgba(93,202,165,0.55);
        font-family: 'Courier New', monospace;
      }
      .wm-label {
        font-size: 6.5px;
        fill: rgba(255,255,255,0.55);
        font-family: 'Courier New', monospace;
        letter-spacing: 1.3px;
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
      .wm-junction-soon { opacity: 0.35; filter: none; }
      .wm-line-soon     { opacity: 0.3; }

      /* ───── Placeholder "coming soon" nodes ───── */
      .wm-node-soon .wm-node-bg {
        fill: #05050f;
        stroke: rgba(93,202,165,0.15);
        stroke-dasharray: 3 2;
      }
      .wm-node-soon .wm-bracket { stroke: rgba(93,202,165,0.18); }
      .wm-node-soon .wm-icon    {
        fill: rgba(93,202,165,0.35);
        font-size: 18px;
        font-weight: bold;
      }
      .wm-node-soon .wm-label   { fill: rgba(255,255,255,0.25); letter-spacing: 2.2px; }
    `;
    document.head.appendChild(s);
  }
}

/** Singleton — shared across all scenes so the map stays open during room changes */
export const worldMap = new WorldMap();
