/**
 * ChatUI.ts — Chat input, log, and speech bubbles
 * Shared between HubScene and RoomScene
 */

import Phaser from 'phaser';
import { sendChat } from '../nostr/presenceService';
import { GifPicker, isGifUrl, gifSrcAttr } from './GifPicker';

function escapeHtml(text: string): string {
  const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}

function renderContent(text: string): string {
  const t = text.trim();
  if (isGifUrl(t)) {
    const src = gifSrcAttr(t);
    return `<br><img src="${src}" style="max-width:200px;max-height:160px;border-radius:6px;margin-top:4px;display:block;cursor:pointer;" loading="lazy" onerror="this.style.display='none'" onclick="window.open('${src}','_blank')">`;
  }
  if (/^https?:\/\/[^\s]+$/i.test(t)) {
    const href = t.replace(/"/g, '%22');
    const label = escapeHtml(t.length > 55 ? t.slice(0, 52) + '…' : t);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:var(--nd-accent);opacity:0.8;font-size:12px;word-break:break-all;">${label}</a>`;
  }
  return `<span style="color:#f5e8d0;opacity:0.85;">${escapeHtml(text)}</span>`;
}

export class ChatUI {
  private container!: HTMLDivElement;
  private log!: HTMLDivElement;
  private input!: HTMLInputElement;
  private onCommand: ((text: string) => void) | null = null;
  private onNameClick: ((pubkey: string, name: string) => void) | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private commandMode = false;
  private gifPicker: GifPicker | null = null;

  /** Create and attach the chat UI */
  create(placeholder: string, accentColor: string, onCommand: (text: string) => void): HTMLInputElement {
    this.onCommand = onCommand;

    this.container = document.createElement('div');
    this.container.style.cssText = `position:fixed;bottom:max(12px,env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);width:520px;max-width:92vw;z-index:1000;font-family:'Courier New',monospace;`;

    this.log = document.createElement('div');
    this.log.style.cssText = `max-height:160px;overflow-y:auto;padding:10px 12px;margin-bottom:6px;background:linear-gradient(180deg,color-mix(in srgb,var(--nd-bg) 82%,transparent) 0%,color-mix(in srgb,var(--nd-bg) 90%,transparent) 100%);border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);border-radius:8px;font-size:13px;display:block;opacity:0;pointer-events:none;transition:opacity 0.5s ease;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--nd-accent) 44%,transparent) transparent;`;
    this.container.appendChild(this.log);

    const inputRow = document.createElement('div');
    inputRow.style.cssText = `display:flex;gap:6px;`;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = placeholder;
    this.input.maxLength = 200;
    this.input.style.cssText = `flex:1;background:color-mix(in srgb,black 55%,var(--nd-bg));border:1px solid color-mix(in srgb,var(--nd-text) 22%,transparent);border-radius:6px;color:var(--nd-text);font-family:'Courier New',monospace;font-size:13px;padding:10px 14px;outline:none;transition:border-color 0.2s ease,box-shadow 0.2s ease;`;

    this.input.addEventListener('focus', () => {
      this.input.style.borderColor = `color-mix(in srgb,var(--nd-accent) 75%,transparent)`;
      this.input.style.boxShadow = `0 0 10px color-mix(in srgb,var(--nd-accent) 18%,transparent)`;
      this.showLog();
    });
    this.input.addEventListener('blur', () => {
      this.input.style.borderColor = `color-mix(in srgb,var(--nd-text) 22%,transparent)`;
      this.input.style.boxShadow = 'none';
      this.scheduleHide(this.commandMode ? 25000 : 8000);
      this.commandMode = false;
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
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
      if (e.key === 'Escape') { this.gifPicker?.close(); this.input.blur(); }
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

    inputRow.appendChild(this.input);
    inputRow.appendChild(gifBtn);
    this.container.appendChild(inputRow);
    document.body.appendChild(this.container);

    return this.input;
  }

  /** Add a message to the chat log */
  addMessage(name: string, text: string, color: string, pubkey?: string): void {
    const msg = document.createElement('div');
    msg.style.cssText = `margin-bottom:5px;line-height:1.4;padding:2px 0;`;
    const nameHtml = (pubkey && this.onNameClick)
      ? `<span style="color:${color};font-weight:bold;cursor:pointer;" data-pk="${pubkey}">${escapeHtml(name)}</span>`
      : `<span style="color:${color};font-weight:bold;">${escapeHtml(name)}</span>`;
    msg.innerHTML = `${nameHtml}: ${renderContent(text)}`;
    if (pubkey && this.onNameClick) {
      msg.querySelector('span')!.addEventListener('click', () => this.onNameClick!(pubkey, name));
    }
    this.log.appendChild(msg);
    this.log.scrollTop = this.log.scrollHeight;
    while (this.log.children.length > 50) this.log.removeChild(this.log.firstChild!);
    this.showLog();
    this.scheduleHide(12000);
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
      }
      this.hideTimer = null;
    }, delay);
  }

  setNameClickHandler(fn: (pubkey: string, name: string) => void): void { this.onNameClick = fn; }

  getInput(): HTMLInputElement { return this.input; }

  isFocused(): boolean {
    return document.activeElement === this.input;
  }

  destroy(): void {
    this.gifPicker?.close();
    if (this.container) this.container.remove();
  }

  /** Create a speech bubble above a position in a Phaser scene */
  static showBubble(scene: Phaser.Scene, bx: number, by: number, text: string, tint: string, lifetime = 4000): void {
    if (isGifUrl(text.trim())) {
      // World coords fixed at moment of posting — bubble stays in place as player walks away
      const worldX = bx;
      const worldY = by - 16;
      const wrap = document.createElement('div');
      wrap.style.cssText = `position:fixed;z-index:200;pointer-events:none;opacity:0;transition:opacity 0.2s ease;transform:translateX(-50%) translateY(-100%);`;
      const img = document.createElement('img');
      img.src = gifSrcAttr(text.trim());
      img.style.cssText = `max-width:120px;max-height:80px;border-radius:6px;display:block;border:2px solid ${tint}88;box-shadow:0 2px 12px rgba(0,0,0,0.7);`;
      img.onerror = () => { cleanup(); wrap.remove(); };
      wrap.appendChild(img);
      document.body.appendChild(wrap);

      const updatePos = () => {
        const cam = scene.cameras.main;
        const canvas = scene.sys.game.canvas;
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        wrap.style.left = `${rect.left + (worldX - cam.scrollX) * cam.zoom * scaleX}px`;
        wrap.style.top  = `${rect.top  + (worldY - cam.scrollY) * cam.zoom * scaleY}px`;
      };

      const cleanup = () => {
        scene.events.off('prerender', updatePos);
        scene.events.off('shutdown', cleanup);
      };

      scene.events.on('prerender', updatePos);
      scene.events.once('shutdown', cleanup);
      updatePos();
      requestAnimationFrame(() => { wrap.style.opacity = '1'; });
      setTimeout(() => {
        wrap.style.opacity = '0';
        setTimeout(() => { cleanup(); wrap.remove(); }, 400);
      }, lifetime - 400);
      return;
    }
    const displayText = text.length > 40 ? text.slice(0, 40) + '...' : text;
    const bubbleText = scene.add.text(bx, by - 10, displayText, {
      fontFamily: '"Courier New", monospace', fontSize: '12px', color: tint, align: 'center',
      backgroundColor: '#0a0014cc', padding: { x: 6, y: 4 },
    });
    bubbleText.setOrigin(0.5); bubbleText.setDepth(91);
    bubbleText.setAlpha(0);
    scene.tweens.add({ targets: bubbleText, alpha: 1, y: by - 16, duration: 200, ease: 'Quad.easeOut' });
    scene.time.delayedCall(lifetime - 400, () => {
      scene.tweens.add({
        targets: bubbleText, alpha: 0, y: `-=10`, duration: 400, ease: 'Quad.easeIn',
        onComplete: () => { bubbleText.destroy(); },
      });
    });
  }
}
