/**
 * ChatUI.ts — Chat input, log, and speech bubbles
 * Shared between HubScene and RoomScene
 */

import Phaser from 'phaser';
import { P } from '../config/game.config';
import { sendChat } from '../nostr/presenceService';

function escapeHtml(text: string): string {
  const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}

export class ChatUI {
  private container!: HTMLDivElement;
  private log!: HTMLDivElement;
  private input!: HTMLInputElement;
  private onCommand: ((text: string) => void) | null = null;

  /** Create and attach the chat UI */
  create(placeholder: string, accentColor: string, onCommand: (text: string) => void): HTMLInputElement {
    this.onCommand = onCommand;

    this.container = document.createElement('div');
    this.container.style.cssText = `position:fixed;bottom:12px;left:50%;transform:translateX(-50%);width:520px;max-width:92vw;z-index:1000;font-family:'Courier New',monospace;`;

    this.log = document.createElement('div');
    this.log.style.cssText = `max-height:160px;overflow-y:auto;padding:10px 12px;margin-bottom:6px;background:linear-gradient(180deg,rgba(10,0,20,0.82) 0%,rgba(10,0,20,0.9) 100%);border:1px solid ${accentColor}33;border-radius:8px;font-size:13px;display:block;opacity:0;pointer-events:none;transition:opacity 0.5s ease;scrollbar-width:thin;scrollbar-color:${accentColor}44 transparent;`;
    this.container.appendChild(this.log);

    const inputRow = document.createElement('div');
    inputRow.style.cssText = `display:flex;gap:6px;`;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = placeholder;
    this.input.maxLength = 200;
    this.input.style.cssText = `flex:1;background:rgba(10,0,20,0.88);border:1px solid ${accentColor}55;border-radius:6px;color:#fff5e6;font-family:'Courier New',monospace;font-size:13px;padding:10px 14px;outline:none;transition:border-color 0.2s ease,box-shadow 0.2s ease;`;

    this.input.addEventListener('focus', () => {
      this.input.style.borderColor = `${accentColor}88`;
      this.input.style.boxShadow = `0 0 10px ${accentColor}20`;
      this.log.style.opacity = '1'; this.log.style.pointerEvents = 'auto';
    });
    this.input.addEventListener('blur', () => {
      this.input.style.borderColor = `${accentColor}55`;
      this.input.style.boxShadow = 'none';
      setTimeout(() => { this.log.style.opacity = '0'; this.log.style.pointerEvents = 'none'; }, 8000);
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (!text) { this.input.blur(); return; }
        if (text.startsWith('/')) { this.input.value = ''; this.onCommand?.(text); this.input.blur(); return; }
        sendChat(text); this.input.value = ''; this.input.blur();
      }
      if (e.key === 'Escape') this.input.blur();
    });

    inputRow.appendChild(this.input);
    this.container.appendChild(inputRow);
    document.body.appendChild(this.container);

    return this.input;
  }

  /** Add a message to the chat log */
  addMessage(name: string, text: string, color: string): void {
    const msg = document.createElement('div');
    msg.style.cssText = `margin-bottom:5px;line-height:1.4;padding:2px 0;`;
    msg.innerHTML = `<span style="color:${color};font-weight:bold;">${escapeHtml(name)}:</span> <span style="color:#f5e8d0;opacity:0.85;">${escapeHtml(text)}</span>`;
    this.log.appendChild(msg);
    this.log.scrollTop = this.log.scrollHeight;
    while (this.log.children.length > 50) this.log.removeChild(this.log.firstChild!);
    this.log.style.opacity = '1'; this.log.style.pointerEvents = 'auto';
    setTimeout(() => { if (document.activeElement !== this.input) this.log.style.opacity = '0'; this.log.style.pointerEvents = 'none'; }, 12000);
  }

  /** Show log temporarily (e.g. after a command) */
  flashLog(duration = 12000): void {
    this.log.style.opacity = '1'; this.log.style.pointerEvents = 'auto';
    setTimeout(() => { if (document.activeElement !== this.input) this.log.style.opacity = '0'; this.log.style.pointerEvents = 'none'; }, duration);
  }

  getInput(): HTMLInputElement { return this.input; }

  destroy(): void {
    if (this.container) this.container.remove();
  }

  /** Create a speech bubble above a position in a Phaser scene */
  static showBubble(scene: Phaser.Scene, bx: number, by: number, text: string, tint: string, lifetime = 4000): void {
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