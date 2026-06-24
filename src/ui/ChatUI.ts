/**
 * ChatUI.ts — Chat input, log, and speech bubbles
 * Shared between HubScene and RoomScene
 */

import Phaser from 'phaser';
import { sendChat } from '../nostr/presenceService';
import { NAME_FONT } from '../config/game.config';
import { GifPicker, isGifUrl, gifSrcAttr } from './GifPicker';
import { renderEmojis } from '../nostr/emojiService';
import { attachEmojiAutocomplete } from './emojiAutocomplete';
import { maybeTranslate } from '../i18n/translator';
import { OSTRICH_SENTINEL_L, OSTRICH_SENTINEL_R, ostrichImgHtml } from '../utils/ostrichGlyph';

const NEON_COLORS = new Set(['#39ff14', '#ff2d78', '#ffaa00']);

const SLASH_COMMANDS: { cmd: string; hint: string }[] = [
  { cmd: 'dm',       hint: '<name|npub>' },
  { cmd: 'zap',      hint: '<name|npub>' },
  { cmd: 'visit',    hint: '<name|npub>' },
  { cmd: 'crew',     hint: '' },
  { cmd: 'follows',  hint: '' },
  { cmd: 'tp',       hint: '<hub|woods|cabin|relay|myroom|market>' },
  { cmd: 'who',      hint: '' },
  { cmd: 'map',      hint: '' },
  { cmd: 'polls',    hint: '' },
  { cmd: 'shop',      hint: '' },
  { cmd: 'wallet',    hint: '' },
  { cmd: 'bazaar',    hint: '' },
  { cmd: 'bag',       hint: '' },
  { cmd: 'inventory', hint: '' },
  { cmd: 'mute',     hint: '' },
  { cmd: 'mutelist', hint: '' },
  { cmd: 'filter',   hint: '<word>' },
  { cmd: 'unfilter', hint: '<word>' },
  { cmd: 'terminal', hint: '' },
  { cmd: 'tutorial', hint: '' },
  { cmd: 'help',     hint: '' },
  { cmd: 'flip',     hint: '' },
  { cmd: '8ball',    hint: '<question>' },
  { cmd: 'slots',    hint: '' },
  { cmd: 'ship',     hint: '<name1> <name2>' },
  { cmd: 'rps',      hint: '<rock|paper|scissors>' },
  { cmd: 'smoke',    hint: '' },
  { cmd: 'coffee',   hint: '' },
  { cmd: 'music',    hint: '' },
  { cmd: 'zzz',      hint: '' },
  { cmd: 'think',    hint: '' },
  { cmd: 'hearts',   hint: '' },
  { cmd: 'angry',    hint: '' },
  { cmd: 'fire',     hint: '' },
  { cmd: 'sparkle',  hint: '' },
  { cmd: 'confetti', hint: '' },
  { cmd: 'rain',     hint: '' },
  { cmd: 'ghost',    hint: '' },
  { cmd: 'status',   hint: '' },
];

function escapeHtml(text: string): string {
  const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}

function renderContent(text: string, emojis?: { code: string; url: string }[]): string {
  const t = text.trim();
  if (isGifUrl(t)) {
    const src = gifSrcAttr(t);
    return `<br><img src="${src}" style="max-width:200px;max-height:160px;border-radius:6px;margin-top:4px;display:block;cursor:pointer;" loading="lazy" onerror="this.style.display='none'" onclick="window.open('${src}','_blank')">`;
  }
  if (/^https?:\/\/[^\s]+$/i.test(t)) {
    // Escape both quote types in the URL to prevent attribute escape, matching
    // gifSrcAttr's approach. Defense-in-depth — only `"` could actually break
    // out of href="..." but the extra escapes are cheap.
    const href = t.replace(/"/g, '%22').replace(/'/g, '%27');
    const label = escapeHtml(t.length > 55 ? t.slice(0, 52) + '…' : t);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:var(--nd-accent);opacity:0.8;font-size:12px;word-break:break-all;">${label}</a>`;
  }
  return `<span style="color:#f5e8d0;opacity:0.85;">${renderEmojis(escapeHtml(text), emojis)}</span>`;
}

export class ChatUI {
  private container!: HTMLDivElement;
  private log!: HTMLDivElement;
  private input!: HTMLInputElement;
  private inputRow!: HTMLDivElement;
  private onCommand: ((text: string) => void) | null = null;
  private onNameClick: ((pubkey: string, name: string) => void) | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private commandMode = false;
  private _inputFocused = false;
  private gifPicker: GifPicker | null = null;
  private suggestBox!: HTMLDivElement;
  private suggestIdx = 0;

  /** Create and attach the chat UI */
  create(placeholder: string, accentColor: string, onCommand: (text: string) => void): HTMLInputElement {
    this.onCommand = onCommand;

    this.container = document.createElement('div');
    this.container.style.cssText = `position:fixed;bottom:8px;left:50%;transform:translateX(-50%);width:520px;max-width:92vw;z-index:1000;font-family:'Courier New',monospace;pointer-events:none;user-select:none;-webkit-user-select:none;`;

    this.log = document.createElement('div');
    this.log.className = 'nd-chat-log';
    this.log.style.cssText = `max-height:min(160px,30dvh);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:10px 12px;margin-bottom:6px;background:linear-gradient(180deg,color-mix(in srgb,var(--nd-bg) 82%,transparent) 0%,color-mix(in srgb,var(--nd-bg) 90%,transparent) 100%);border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);border-radius:8px;font-size:13px;display:block;opacity:0;pointer-events:none;user-select:text;-webkit-user-select:text;transition:opacity 0.5s ease;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--nd-accent) 44%,transparent) transparent;touch-action:pan-y;`;
    // Prevent touch/click on the log from propagating to the game canvas
    this.log.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.log.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    this.log.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.container.appendChild(this.log);

    this.suggestBox = document.createElement('div');
    this.suggestBox.style.cssText = `display:none;margin-bottom:4px;background:color-mix(in srgb,var(--nd-bg) 97%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 30%,transparent);border-radius:6px;overflow:hidden;font-family:'Courier New',monospace;font-size:12px;pointer-events:auto;`;
    this.container.appendChild(this.suggestBox);

    this.inputRow = document.createElement('div');
    this.inputRow.style.cssText = `display:flex;gap:6px;pointer-events:auto;`;
    const inputRow = this.inputRow;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = placeholder;
    this.input.maxLength = 200;
    // font-size ≥ 16px on touch devices prevents iOS Safari from auto-zooming the page on focus
    const inputFontSize = ('ontouchstart' in window) ? '16px' : '13px';
    this.input.style.cssText = `flex:1;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 22%,transparent);border-radius:6px;color:var(--nd-text);font-family:'Courier New',monospace;font-size:${inputFontSize};padding:10px 14px;outline:none;transition:border-color 0.2s ease,box-shadow 0.2s ease;`;

    this.input.addEventListener('focus', () => {
      this._inputFocused = true;
      this.input.style.borderColor = `color-mix(in srgb,var(--nd-accent) 75%,transparent)`;
      this.input.style.boxShadow = `0 0 10px color-mix(in srgb,var(--nd-accent) 18%,transparent)`;
      this.log.classList.add('nd-chat-focused');
      this.showLog();
    });
    this.input.addEventListener('blur', () => {
      this._inputFocused = false;
      this.input.style.borderColor = `color-mix(in srgb,var(--nd-text) 22%,transparent)`;
      this.input.style.boxShadow = 'none';
      this.scheduleHide(this.commandMode ? 25000 : 8000);
      this.commandMode = false;
      // Delay hide so mousedown on a suggestion fires before blur removes it
      setTimeout(() => { this.suggestBox.style.display = 'none'; }, 120);
    });
    this.input.addEventListener('input', () => {
      this.suggestIdx = 0;
      this.renderSuggestions();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
      const suggestVisible = this.suggestBox.style.display !== 'none';
      if (suggestVisible && (e.key === 'Tab' || e.key === 'ArrowRight')) {
        e.preventDefault();
        this.applySuggestion();
        return;
      }
      if (suggestVisible && e.key === 'ArrowDown') {
        e.preventDefault();
        const count = this.suggestBox.children.length;
        this.suggestIdx = Math.min(this.suggestIdx + 1, count - 1);
        this.renderSuggestions();
        return;
      }
      if (suggestVisible && e.key === 'ArrowUp') {
        e.preventDefault();
        this.suggestIdx = Math.max(this.suggestIdx - 1, 0);
        this.renderSuggestions();
        return;
      }
      if (e.key === 'Enter') {
        if (suggestVisible) { this.applySuggestion(); return; }
        const text = this.input.value.trim();
        if (!text) { this.input.blur(); return; }
        if (text.startsWith('/')) {
          this.input.value = '';
          this.commandMode = true;
          this.onCommand?.(text);
          this.input.blur();
          return;
        }
        sendChat(text); this.input.value = ''; this.input.blur();
      }
      if (e.key === 'Escape') { this.gifPicker?.close(); this.suggestBox.style.display = 'none'; this.input.blur(); }
    });

    // GIF button
    const gifBtn = document.createElement('button');
    gifBtn.textContent = 'GIF';
    gifBtn.style.cssText = `background:color-mix(in srgb,black 45%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 25%,transparent);border-radius:6px;color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:11px;font-weight:bold;padding:0 10px;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:color 0.15s,border-color 0.15s;`;
    gifBtn.addEventListener('mouseenter', () => { gifBtn.style.color = 'var(--nd-accent)'; gifBtn.style.borderColor = `color-mix(in srgb,var(--nd-accent) 55%,transparent)`; });
    gifBtn.addEventListener('mouseleave', () => { gifBtn.style.color = 'var(--nd-subtext)'; gifBtn.style.borderColor = `color-mix(in srgb,var(--nd-text) 25%,transparent)`; });
    gifBtn.addEventListener('click', () => {
      if (this.gifPicker?.isOpen()) {
        this.gifPicker.close();
        return;
      }
      this.gifPicker = new GifPicker((url) => {
        sendChat(url);
        this.showLog();
        this.scheduleHide(12000);
      });
      this.gifPicker.open(gifBtn);
      this.showLog();
    });

    attachEmojiAutocomplete(this.input);
    inputRow.appendChild(this.input);
    inputRow.appendChild(gifBtn);
    this.container.appendChild(inputRow);
    document.body.appendChild(this.container);

    // On mobile, float the chat container above the software keyboard
    if ('ontouchstart' in window && window.visualViewport) {
      const vv = window.visualViewport;
      const reposition = () => {
        // offsetTop accounts for any top-scroll offset; combined with height gives keyboard clearance
        const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        this.container.style.bottom = `${8 + keyboardHeight}px`;
      };
      vv.addEventListener('resize', reposition);
      vv.addEventListener('scroll', reposition);
    }

    return this.input;
  }

  /** Add a message to the chat log */
  addMessage(name: string, text: string, color: string, pubkey?: string, emojis?: { code: string; url: string }[], isMe = false): void {
    const msg = document.createElement('div');
    msg.style.cssText = `margin-bottom:5px;line-height:1.4;padding:2px 0;`;
    // Single tight glow — the old double-layer (6px + 12px) washed names into
    // unreadable blobs at chat font size.
    const neonGlow = NEON_COLORS.has(color) ? `;text-shadow:0 0 3px ${color}99` : '';
    // 🦤 Nostrich: swap the sentinel chars (inserted after escapeHtml, so the <img>
    // markup survives) for the purple-ostrich images flanking the name.
    const nameInner = escapeHtml(name)
      .split(OSTRICH_SENTINEL_L).join(ostrichImgHtml(false))
      .split(OSTRICH_SENTINEL_R).join(ostrichImgHtml(true));
    const nameHtml = (pubkey && this.onNameClick)
      ? `<span style="color:${color};font-weight:bold;cursor:pointer;${neonGlow}" data-pk="${pubkey}">${nameInner}</span>`
      : `<span style="color:${color};font-weight:bold;${neonGlow}">${nameInner}</span>`;
    msg.innerHTML = `${nameHtml}: <span class="cu-msg-body" style="cursor:pointer;" title="Click to toggle original language">${renderContent(text, emojis)}</span>`;
    if (pubkey && this.onNameClick) {
      msg.querySelector('span')!.addEventListener('click', () => this.onNameClick!(pubkey, name));
    }
    const body = msg.querySelector('.cu-msg-body') as HTMLElement;
    body.dataset.original = text;
    body.dataset.showing = 'translated';
    let downX = 0, downY = 0;
    body.addEventListener('mousedown', (e) => { downX = e.clientX; downY = e.clientY; });
    body.addEventListener('click', (e) => {
      // Treat as drag (selection) only if pointer moved >4px between down and up
      const dx = Math.abs(e.clientX - downX), dy = Math.abs(e.clientY - downY);
      if (dx > 4 || dy > 4) return;
      e.stopPropagation();
      const showingOriginal = body.dataset.showing === 'original';
      if (showingOriginal) {
        const t = body.dataset.translated;
        body.innerHTML = renderContent(t || text, emojis);
        body.style.fontStyle = body.dataset.translated ? 'italic' : 'normal';
        body.removeAttribute('translate');
        body.dataset.showing = 'translated';
      } else {
        body.innerHTML = renderContent(body.dataset.original!, emojis);
        body.style.fontStyle = 'normal';
        body.setAttribute('translate', 'no');
        body.dataset.showing = 'original';
      }
    });
    this.log.appendChild(msg);
    this.log.scrollTop = this.log.scrollHeight;
    while (this.log.children.length > 50) this.log.removeChild(this.log.firstChild!);
    this.showLog();
    this.scheduleHide(12000);

    // Opportunistic translation — same path as the floating bubble. Skip when
    // the message is from the local user: they typed it, they know what they
    // meant, and auto-translating their own text (e.g. "OG" → some foreign
    // word) makes it look like the chat is censoring or mangling them.
    if (isMe) return;
    maybeTranslate(text).then((res) => {
      if (!res || !msg.isConnected) return;
      body.dataset.translated = res.translated;
      if (body.dataset.showing === 'translated') {
        body.innerHTML = renderContent(res.translated, emojis);
        body.style.fontStyle = 'italic';
      }
    }).catch(() => { /* never throws */ });
  }

  /** Add an RPS challenge row with inline accept buttons */
  addRpsChallenge(challengerName: string, onAccept: (choice: 'rock' | 'paper' | 'scissors') => void): void {
    const msg = document.createElement('div');
    msg.style.cssText = `margin-bottom:5px;line-height:1.4;padding:2px 0;`;
    msg.innerHTML = `
      <span style="color:var(--nd-subtext);font-size:12px;">
        ⚔️ <strong style="color:var(--nd-text);">${escapeHtml(challengerName)}</strong> challenges to RPS —
        <button class="rps-inline" data-c="rock">🪨</button>
        <button class="rps-inline" data-c="paper">📄</button>
        <button class="rps-inline" data-c="scissors">✂️</button>
        <span class="rps-done" style="display:none;opacity:0.45;font-size:11px;">sent</span>
      </span>`;
    const btns = msg.querySelectorAll<HTMLButtonElement>('.rps-inline');
    const done = msg.querySelector<HTMLSpanElement>('.rps-done')!;
    btns.forEach(btn => {
      btn.style.cssText = `background:none;border:1px solid color-mix(in srgb,var(--nd-accent) 30%,transparent);border-radius:3px;padding:1px 5px;cursor:pointer;font-size:12px;margin:0 1px;color:var(--nd-text);`;
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--nd-accent)'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 30%,transparent)'; });
      btn.addEventListener('click', () => {
        onAccept(btn.dataset.c as 'rock' | 'paper' | 'scissors');
        btns.forEach(b => b.remove());
        done.style.display = 'inline';
      });
    });
    this.log.appendChild(msg);
    this.log.scrollTop = this.log.scrollHeight;
    while (this.log.children.length > 50) this.log.removeChild(this.log.firstChild!);
    this.showLog();
    this.scheduleHide(20000);
  }

  /** Show log temporarily (e.g. after a command) */
  flashLog(duration = 12000): void {
    this.showLog();
    this.scheduleHide(duration);
  }

  private showLog(): void {
    this.log.style.opacity = '1';
    this.log.style.pointerEvents = 'auto';
  }

  private scheduleHide(delay: number): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (document.activeElement !== this.input) {
        this.log.style.opacity = '0';
        this.log.style.pointerEvents = 'none';
        this.log.classList.remove('nd-chat-focused');
      }
      this.hideTimer = null;
    }, delay);
  }

  setDMButton(callback: () => void): void {
    if (this.inputRow?.querySelector('.nd-dm-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'nd-dm-btn';
    btn.textContent = '✉';
    btn.title = 'Messages';
    btn.style.cssText = `background:color-mix(in srgb,black 45%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 25%,transparent);border-radius:6px;color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:14px;padding:0 10px;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:color 0.15s,border-color 0.15s;`;
    btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--nd-accent)'; btn.style.borderColor = `color-mix(in srgb,var(--nd-accent) 55%,transparent)`; });
    btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--nd-subtext)'; btn.style.borderColor = `color-mix(in srgb,var(--nd-text) 25%,transparent)`; });
    btn.addEventListener('click', callback);
    const gifBtn = this.inputRow.querySelector('button');
    if (gifBtn) this.inputRow.insertBefore(btn, gifBtn);
    else this.inputRow.appendChild(btn);
  }

  setNameClickHandler(fn: (pubkey: string, name: string) => void): void { this.onNameClick = fn; }

  getInput(): HTMLInputElement { return this.input; }

  private renderSuggestions(): void {
    const val = this.input.value;
    if (!val.startsWith('/') || val.includes(' ')) { this.suggestBox.style.display = 'none'; return; }
    const typed = val.slice(1).toLowerCase();
    const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(typed) && c.cmd !== typed).slice(0, 7);
    if (!matches.length) { this.suggestBox.style.display = 'none'; return; }
    this.suggestIdx = Math.min(this.suggestIdx, matches.length - 1);
    this.suggestBox.innerHTML = '';
    matches.forEach((m, i) => {
      const row = document.createElement('div');
      const sel = i === this.suggestIdx;
      row.style.cssText = `display:flex;gap:10px;align-items:center;padding:5px 11px;cursor:pointer;background:${sel ? 'color-mix(in srgb,var(--nd-accent) 10%,transparent)' : 'transparent'};border-left:2px solid ${sel ? 'var(--nd-accent)' : 'transparent'};`;
      const cmd = document.createElement('span');
      cmd.style.cssText = `font-weight:bold;`;
      cmd.innerHTML = `<span style="color:var(--nd-accent);">/${typed}</span><span style="color:var(--nd-text);opacity:${sel ? '1' : '0.65'};">${escapeHtml(m.cmd.slice(typed.length))}</span>`;
      row.appendChild(cmd);
      if (m.hint) {
        const hint = document.createElement('span');
        hint.style.cssText = `opacity:0.35;font-size:11px;color:var(--nd-subtext);`;
        hint.textContent = m.hint;
        row.appendChild(hint);
      }
      const select = (e: Event) => { e.preventDefault(); this.suggestIdx = i; this.applySuggestion(); };
      row.addEventListener('mousedown', select);
      row.addEventListener('touchstart', select, { passive: false });
      row.addEventListener('mouseenter', () => { this.suggestIdx = i; this.renderSuggestions(); });
      this.suggestBox.appendChild(row);
    });
    this.suggestBox.style.display = 'block';
  }

  private applySuggestion(): void {
    const val = this.input.value;
    if (!val.startsWith('/') || val.includes(' ')) return;
    const typed = val.slice(1).toLowerCase();
    const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(typed) && c.cmd !== typed);
    const m = matches[this.suggestIdx] ?? matches[0];
    if (!m) return;
    this.input.value = `/${m.cmd}${m.hint ? ' ' : ''}`;
    this.suggestBox.style.display = 'none';
    this.suggestIdx = 0;
    this.input.focus();
  }

  isFocused(): boolean {
    return document.activeElement === this.input;
  }

  destroy(): void {
    this.gifPicker?.close();
    if (this.container) this.container.remove();
  }

  /** Create a speech bubble above a position in a Phaser scene */
  static showBubble(scene: Phaser.Scene, bx: number, by: number, text: string, tint: string, lifetime = 4000, emojis?: { code: string; url: string }[], isMe = false): void {
    if (isGifUrl(text.trim())) {
      lifetime = 10000;
      // World coords fixed at moment of posting — bubble stays in place as player walks away
      const worldX = bx;
      const worldY = by - 16;
      const wrap = document.createElement('div');
      wrap.style.cssText = `position:fixed;z-index:200;pointer-events:none;opacity:0;transition:opacity 0.2s ease;transform:translate(-50%,-100%);will-change:left,top;`;
      const img = document.createElement('img');
      img.src = gifSrcAttr(text.trim());
      img.style.cssText = `max-width:120px;max-height:80px;border-radius:6px;display:block;border:2px solid ${tint}88;box-shadow:0 2px 12px rgba(0,0,0,0.7);`;
      img.onerror = () => { alive = false; wrap.remove(); };
      wrap.appendChild(img);
      document.body.appendChild(wrap);

      let alive = true;
      let rafId = 0;
      const updatePos = () => {
        if (!alive) return;
        const cam = scene.cameras.main;
        const canvas = scene.sys.game.canvas;
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        const sx = (worldX - cam.worldView.x) * cam.zoom + cam.x;
        const sy = (worldY - cam.worldView.y) * cam.zoom + cam.y;
        wrap.style.left = `${rect.left + sx * scaleX}px`;
        wrap.style.top  = `${rect.top  + sy * scaleY}px`;
        rafId = requestAnimationFrame(updatePos);
      };

      const cleanup = () => {
        alive = false;
        cancelAnimationFrame(rafId);
        scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      };

      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      updatePos();
      requestAnimationFrame(() => { wrap.style.opacity = '1'; });
      setTimeout(() => {
        wrap.style.opacity = '0';
        setTimeout(() => { cleanup(); wrap.remove(); }, 400);
      }, lifetime - 400);
      return;
    }
    // Use a DOM bubble if the message contains custom emojis (renderEmojis will swap :code: → <img>)
    const truncated = text.length > 80 ? text.slice(0, 80) + '…' : text;
    const rendered  = renderEmojis(escapeHtml(truncated), emojis);
    const hasEmoji  = rendered.includes('<img');

    if (hasEmoji) {
      const worldX = bx;
      const worldY = by - 16;
      const wrap = document.createElement('div');
      wrap.style.cssText = `
        position:fixed;z-index:200;pointer-events:none;opacity:0;
        transition:opacity 0.2s ease;transform:translate(-50%,-100%);will-change:left,top;
        background:#0a0014cc;border-radius:6px;padding:4px 8px;
        font-family:'Courier New',monospace;font-size:12px;color:${tint};
        max-width:200px;text-align:center;line-height:1.5;
        border:1px solid ${tint}33;
        ${NEON_COLORS.has(tint) ? `text-shadow:0 0 3px ${tint}99;` : ''}
      `;
      wrap.innerHTML = rendered;
      document.body.appendChild(wrap);

      let alive = true;
      let rafId = 0;
      const updatePos = () => {
        if (!alive) return;
        const cam    = scene.cameras.main;
        const canvas = scene.sys.game.canvas;
        const rect   = canvas.getBoundingClientRect();
        const scaleX = rect.width  / canvas.width;
        const scaleY = rect.height / canvas.height;
        const sx = (worldX - cam.worldView.x) * cam.zoom + cam.x;
        const sy = (worldY - cam.worldView.y) * cam.zoom + cam.y;
        wrap.style.left = `${rect.left + sx * scaleX}px`;
        wrap.style.top  = `${rect.top  + sy * scaleY}px`;
        rafId = requestAnimationFrame(updatePos);
      };

      const cleanup = () => {
        alive = false;
        cancelAnimationFrame(rafId);
        scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      };

      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      updatePos();
      requestAnimationFrame(() => { wrap.style.opacity = '1'; });
      setTimeout(() => {
        wrap.style.opacity = '0';
        setTimeout(() => { cleanup(); wrap.remove(); }, 400);
      }, lifetime - 400);
      return;
    }

    const displayText = truncated;
    const fontSize = (scene as unknown as { getBubbleFontSize?: () => string }).getBubbleFontSize?.() ?? '12px';
    const bubbleText = scene.add.text(bx, by - 10, displayText, {
      fontFamily: NAME_FONT, fontSize, color: tint, align: 'center',
      backgroundColor: '#0a0014cc', padding: { x: 6, y: 4 },
      wordWrap: { width: 220, useAdvancedWrap: true },
      ...(NEON_COLORS.has(tint) ? { shadow: { offsetX: 0, offsetY: 0, color: tint, blur: 4, fill: true } } : {}),
    });
    // Bottom-anchor the bubble so long (multi-line) messages grow UPWARD above the
    // head instead of expanding down over the player's face. We pin the bottom edge
    // where a single-line bubble's bottom would sit, so short bubbles are unchanged
    // and tall ones extend toward the ceiling.
    bubbleText.setOrigin(0.5, 1); bubbleText.setDepth(9999);
    const lineCount = Math.max(1, bubbleText.getWrappedText(displayText).length);
    const oneLineH = (bubbleText.height - 8) / lineCount + 8; // single-line height (pad y = 4 per side)
    const bottomY = (by - 16) + oneLineH / 2;
    bubbleText.y = bottomY + 6;
    bubbleText.setAlpha(0);
    scene.tweens.add({ targets: bubbleText, alpha: 1, y: bottomY, duration: 200, ease: 'Quad.easeOut' });
    scene.time.delayedCall(lifetime - 400, () => {
      scene.tweens.add({
        targets: bubbleText, alpha: 0, y: `-=10`, duration: 400, ease: 'Quad.easeIn',
        onComplete: () => { bubbleText.destroy(); },
      });
    });

    // Opportunistic on-device translation. Renders the original immediately
    // (above), then swaps the text + italicizes it once Chrome's Translator
    // API returns. Skip for the local user — they typed it, no need to
    // auto-translate their own bubble (and "OG"-style short tokens can get
    // mistranslated into something unintended).
    if (!isMe) {
      maybeTranslate(truncated).then((res) => {
        if (!res || !bubbleText.active) return;
        const trCapped = res.translated.length > 80 ? res.translated.slice(0, 80) + '…' : res.translated;
        bubbleText.setText(trCapped);
        bubbleText.setFontStyle('italic');
      }).catch(() => { /* never throws, but belt-and-braces */ });
    }
  }
}
