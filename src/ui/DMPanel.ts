/**
 * DM Panel — slide-out UI for NIP-17 encrypted direct messages
 *
 * Renders as an HTML overlay on top of the Phaser game.
 * - Click a player in HubScene → opens DM panel with that player
 * - Shows conversation list on left, messages on right
 * - Styled to match Nostr District neon cyberpunk aesthetic
 */

import { sendDirectMessage, onDMReceived, canUseDMs, DMMessage } from '../nostr/dmService';
import { SoundEngine } from '../audio/SoundEngine';
import { fetchProfile } from '../nostr/nostrService';
import { shouldFilter } from '../nostr/moderationService';
import { GifPicker, isGifUrl, gifSrcAttr } from './GifPicker';

interface Conversation {
  pubkey: string;
  name: string;
  lastMessage: string;
  lastTime: number;
  unread: number;
}

export class DMPanel {
  private container: HTMLDivElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private convListEl: HTMLDivElement | null = null;

  private conversations = new Map<string, Conversation>();
  private messages = new Map<string, DMMessage[]>(); // keyed by pubkey
  private activePubkey: string | null = null;
  private isOpen = false;
  private unsubscribe: (() => void) | null = null;
  private myPubkey: string | null = null;
  private totalUnread = 0;
  private gifPicker: GifPicker | null = null;
  private hiddenConvs = new Set<string>();
  private showHidden = false;

  private readKey(convPubkey: string): string {
    return `nd_dm_read_${this.myPubkey}_${convPubkey}`;
  }
  private getLastRead(convPubkey: string): number {
    return parseInt(localStorage.getItem(this.readKey(convPubkey)) || '0', 10);
  }
  private markRead(convPubkey: string): void {
    const msgs = this.messages.get(convPubkey);
    const ts = msgs?.length ? msgs[msgs.length - 1].createdAt : Math.floor(Date.now() / 1000);
    localStorage.setItem(this.readKey(convPubkey), String(ts));
  }

  private hiddenKey(): string { return `nd_dm_hidden_${this.myPubkey}`; }
  private loadHidden(): void {
    try {
      const stored = localStorage.getItem(this.hiddenKey());
      if (stored) (JSON.parse(stored) as string[]).forEach(k => this.hiddenConvs.add(k));
    } catch (_) {}
  }
  private saveHidden(): void {
    localStorage.setItem(this.hiddenKey(), JSON.stringify([...this.hiddenConvs]));
  }
  private hideConversation(pubkey: string): void {
    this.hiddenConvs.add(pubkey);
    this.saveHidden();
    if (this.activePubkey === pubkey) {
      this.activePubkey = null;
      const chatEl = this.container?.querySelector('.dm-chat') as HTMLElement;
      const listEl = this.container?.querySelector('.dm-conv-list') as HTMLElement;
      if (chatEl) chatEl.style.display = 'none';
      if (listEl) listEl.style.display = 'block';
    }
    this.renderConversationList();
  }
  private unhideConversation(pubkey: string): void {
    this.hiddenConvs.delete(pubkey);
    this.saveHidden();
    this.renderConversationList();
  }

  constructor(myPubkey: string | null) {
    this.myPubkey = myPubkey;
    this.loadHidden();
    this.injectStyles();

    // Listen for incoming DMs
    this.unsubscribe = onDMReceived((msg) => this.handleMessage(msg));
  }

  // ════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════

  /** Open the DM panel, optionally focused on a specific user */
  open(targetPubkey?: string): void {
    if (!canUseDMs()) {
      console.warn('[DM] DMs not available — must be logged in with a key');
      return;
    }

    if (!this.container) this.buildDOM();
    this.container!.classList.add('dm-open');
    this.isOpen = true;
    this.totalUnread = 0;
    this.updateBadge();

    if (targetPubkey) {
      this.openConversation(targetPubkey);
    } else if (this.activePubkey) {
      // Reopen to the conversation we were in before closing
      this.openConversation(this.activePubkey);
    } else {
      this.renderConversationList();
    }
  }

  /** Close the DM panel */
  close(): void {
    if (this.inputEl && document.activeElement === this.inputEl) {
      this.inputEl.blur();
    }
    if (this.container) {
      this.container.classList.remove('dm-open');
    }
    this.isOpen = false;
    // Keep activePubkey so reopening returns to the same conversation
  }

  toggle(targetPubkey?: string): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(targetPubkey);
    }
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  destroy(): void {
    if (this.unsubscribe) this.unsubscribe();
    if (this.container) this.container.remove();
    this.container = null;
  }

  // ════════════════════════════════════════════
  // MESSAGE HANDLING
  // ════════════════════════════════════════════

  private handleMessage(msg: DMMessage): void {
    const convPubkey = msg.conversationPubkey;

    // Filter incoming messages (always show your own)
    if (!msg.isOwn && shouldFilter(msg.content)) return;

    // Store message
    if (!this.messages.has(convPubkey)) {
      this.messages.set(convPubkey, []);
    }
    const list = this.messages.get(convPubkey)!;

    // Deduplicate
    if (list.some(m => m.id === msg.id)) return;
    if (msg.isOwn && list.some(m =>
      m.isOwn &&
      m.content === msg.content &&
      Math.abs(m.createdAt - msg.createdAt) < 10
    )) return;

    list.push(msg);
    list.sort((a, b) => a.createdAt - b.createdAt);

    if (list.length > 200) {
      this.messages.set(convPubkey, list.slice(-200));
    }

    // Update conversation entry
    const existing = this.conversations.get(convPubkey);
    this.conversations.set(convPubkey, {
      pubkey: convPubkey,
      name: msg.senderName || existing?.name || convPubkey.slice(0, 12) + '...',
      lastMessage: isGifUrl(msg.content.trim()) ? '[GIF]' : /^https?:\/\//i.test(msg.content.trim()) ? '[Link]' : msg.content.slice(0, 50),
      lastTime: msg.createdAt,
      unread: (this.activePubkey === convPubkey) ? 0 : (existing?.unread || 0) + (!msg.isOwn && msg.createdAt > this.getLastRead(convPubkey) ? 1 : 0),
    });

    if (!existing?.name || existing.name.includes('...')) {
      this.fetchAndSetName(convPubkey);
    }

    if (this.isOpen) {
      if (this.activePubkey === convPubkey) {
        this.renderMessages();
      }
      this.renderConversationList();
    } else if (!msg.isOwn && msg.createdAt > this.getLastRead(convPubkey)) {
      const senderName = this.conversations.get(convPubkey)?.name || msg.senderName || convPubkey.slice(0, 12) + '...';
      this.showToast(convPubkey, senderName, msg.content);
    }
    if (!msg.isOwn && msg.createdAt > this.getLastRead(convPubkey)) {
      SoundEngine.get().dmPing();
    }
  }

  private showToast(pubkey: string, senderName: string, content: string): void {
    this.totalUnread++;

    const existing = document.getElementById('dm-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'dm-toast';
    toast.style.cssText = `
      position: fixed; bottom: 80px; right: 20px; z-index: 4000;
      background: linear-gradient(135deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
      border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent); border-radius: 10px;
      padding: 12px 16px; font-family: 'Courier New', monospace;
      box-shadow: 0 4px 20px rgba(0,0,0,0.7), 0 0 12px color-mix(in srgb,var(--nd-accent) 13%,transparent);
      max-width: 280px; cursor: pointer;
      animation: dm-toast-in 0.2s ease;
    `;
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="color:var(--nd-accent);font-size:13px;">\u2709</span>
        <span style="color:var(--nd-accent);font-size:12px;font-weight:bold;">${senderName.slice(0, 24)}</span>
        <button id="dm-toast-close" style="margin-left:auto;background:none;border:none;color:var(--nd-subtext);font-size:14px;cursor:pointer;padding:0;line-height:1;">\u2715</button>
      </div>
      <div style="color:var(--nd-text);font-size:11px;opacity:0.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${content.slice(0, 60)}</div>
    `;

    if (!document.getElementById('dm-toast-style')) {
      const s = document.createElement('style');
      s.id = 'dm-toast-style';
      s.textContent = `@keyframes dm-toast-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`;
      document.head.appendChild(s);
    }

    document.body.appendChild(toast);

    const dismiss = () => { toast.remove(); this.updateBadge(); };
    const timer = setTimeout(dismiss, 5000);

    toast.addEventListener('click', () => {
      clearTimeout(timer);
      toast.remove();
      this.open(pubkey);
    });

    document.getElementById('dm-toast-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(timer);
      dismiss();
    });
  }

  private updateBadge(): void {
    const existing = document.getElementById('dm-badge');
    if (this.totalUnread <= 0) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.querySelector('.dm-badge-count')!.textContent = String(this.totalUnread);
      return;
    }
    const badge = document.createElement('div');
    badge.id = 'dm-badge';
    badge.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 3999;
      background: linear-gradient(135deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
      border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent); border-radius: 50px;
      padding: 8px 14px; font-family: 'Courier New', monospace;
      box-shadow: 0 2px 12px rgba(0,0,0,0.6), 0 0 8px color-mix(in srgb,var(--nd-accent) 13%,transparent);
      display: flex; align-items: center; gap: 7px;
      cursor: pointer; animation: dm-toast-in 0.2s ease;
    `;
    badge.innerHTML = `
      <span style="color:var(--nd-accent);font-size:14px;">\u2709</span>
      <span class="dm-badge-count" style="
        background:var(--nd-accent); color:var(--nd-bg); font-size:10px; font-weight:bold;
        border-radius:50%; width:16px; height:16px;
        display:flex; align-items:center; justify-content:center;
      ">${this.totalUnread}</span>
    `;
    badge.addEventListener('click', () => {
      badge.remove();
      this.open();
    });
    document.body.appendChild(badge);
  }

  private async fetchAndSetName(pubkey: string): Promise<void> {
    try {
      const profile = await fetchProfile(pubkey);
      if (profile) {
        const name = profile.display_name || profile.name || pubkey.slice(0, 12) + '...';
        const conv = this.conversations.get(pubkey);
        if (conv) {
          conv.name = name;
          if (this.isOpen) this.renderConversationList();
        }
      }
    } catch (_) {}
  }

  // ════════════════════════════════════════════
  // DOM CONSTRUCTION
  // ════════════════════════════════════════════

  private buildDOM(): void {
    this.container = document.createElement('div');
    this.container.className = 'dm-panel';
    this.container.innerHTML = `
      <div class="dm-header">
        <span class="dm-title">\u2709 Direct Messages</span>
        <button class="dm-close">\u2715</button>
      </div>
      <div class="dm-body">
        <div class="dm-conv-list"></div>
        <div class="dm-chat">
          <div class="dm-chat-header"></div>
          <div class="dm-messages"></div>
          <div class="dm-input-row">
            <input type="text" class="dm-input" placeholder="Type a message..." maxlength="500" />
            <button class="dm-gif-btn">GIF</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.container.querySelector('.dm-close')!.addEventListener('click', () => this.close());

    this.convListEl = this.container.querySelector('.dm-conv-list') as HTMLDivElement;
    this.messagesEl = this.container.querySelector('.dm-messages') as HTMLDivElement;
    this.inputEl = this.container.querySelector('.dm-input') as HTMLInputElement;

    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.sendMessage(); }
      if (e.key === 'Escape') { this.gifPicker?.close(); this.close(); }
    });

    const gifBtn = this.container.querySelector('.dm-gif-btn') as HTMLButtonElement;
    gifBtn?.addEventListener('click', () => {
      if (this.gifPicker?.isOpen()) { this.gifPicker.close(); return; }
      this.gifPicker = new GifPicker((url) => {
        if (this.activePubkey) sendDirectMessage(this.activePubkey, url).catch(() => {});
      });
      this.gifPicker.open(gifBtn);
    });

    this.inputEl.addEventListener('focus', () => {
      this.inputEl!.style.borderColor = `color-mix(in srgb,var(--nd-accent) 65%,transparent)`;
    });
    this.inputEl.addEventListener('blur', () => {
      this.inputEl!.style.borderColor = `color-mix(in srgb,var(--nd-text) 20%,transparent)`;
    });
  }

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════

  private renderConversationList(): void {
    if (!this.convListEl) return;

    const all = Array.from(this.conversations.values())
      .sort((a, b) => b.lastTime - a.lastTime);

    const visible = all.filter(c => !this.hiddenConvs.has(c.pubkey));
    const hidden  = all.filter(c =>  this.hiddenConvs.has(c.pubkey));

    if (all.length === 0) {
      this.convListEl.innerHTML = `<div class="dm-empty">No conversations yet.<br/>Click a player to start a DM.</div>`;
      return;
    }

    const renderItem = (conv: Conversation, isHidden: boolean) => `
      <div class="dm-conv-item ${conv.pubkey === this.activePubkey ? 'active' : ''} ${isHidden ? 'dm-conv-hidden' : ''}" data-pubkey="${conv.pubkey}">
        <div class="dm-conv-name">${this.escapeHtml(conv.name)}</div>
        <div class="dm-conv-preview">${this.escapeHtml(conv.lastMessage)}</div>
        ${conv.unread > 0 && !isHidden ? `<span class="dm-unread">${conv.unread}</span>` : ''}
        <button class="dm-hide-btn" data-pubkey="${conv.pubkey}" data-hidden="${isHidden}" title="${isHidden ? 'Unhide' : 'Hide'}">${isHidden ? '↩' : '✕'}</button>
      </div>
    `;

    const visibleHtml = visible.map(c => renderItem(c, false)).join('');
    const hiddenHtml  = this.showHidden ? hidden.map(c => renderItem(c, true)).join('') : '';
    const footerHtml  = hidden.length > 0 ? `
      <div class="dm-hidden-toggle" id="dm-hidden-toggle">
        ${this.showHidden ? '▲ Hide archived' : `▼ Archived (${hidden.length})`}
      </div>
    ` : '';

    this.convListEl.innerHTML = visibleHtml + footerHtml + hiddenHtml;

    this.convListEl.querySelectorAll('.dm-conv-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.dm-hide-btn')) return;
        const pk = (el as HTMLElement).dataset.pubkey;
        if (pk) this.openConversation(pk);
      });
    });

    this.convListEl.querySelectorAll('.dm-hide-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pk = (btn as HTMLElement).dataset.pubkey!;
        const isHidden = (btn as HTMLElement).dataset.hidden === 'true';
        if (isHidden) this.unhideConversation(pk);
        else this.hideConversation(pk);
      });
    });

    document.getElementById('dm-hidden-toggle')?.addEventListener('click', () => {
      this.showHidden = !this.showHidden;
      this.renderConversationList();
    });
  }

  private renderMessages(): void {
    if (!this.messagesEl || !this.activePubkey) return;

    const msgs = this.messages.get(this.activePubkey) || [];

    if (msgs.length === 0) {
      this.messagesEl.innerHTML = `<div class="dm-empty">No messages yet. Say hi!</div>`;
      return;
    }

    this.messagesEl.innerHTML = msgs.map(msg => {
      const time = new Date(msg.createdAt * 1000);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const t = msg.content.trim();
      const isGif = isGifUrl(t);
      const isLink = !isGif && /^https?:\/\/[^\s]+$/i.test(t);
      const contentHtml = isGif
        ? `<img src="${gifSrcAttr(t)}" style="max-width:200px;max-height:160px;border-radius:6px;display:block;cursor:pointer;" loading="lazy" onerror="this.style.display='none'" onclick="window.open(this.src,'_blank')">`
        : isLink
          ? `<a href="${t.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer" style="color:var(--nd-accent);opacity:0.8;font-size:12px;word-break:break-all;">${this.escapeHtml(t.length > 55 ? t.slice(0,52)+'…' : t)}</a>`
          : this.escapeHtml(msg.content);

      return `
        <div class="dm-msg ${msg.isOwn ? 'dm-msg-own' : 'dm-msg-other'}">
          <div class="dm-msg-content${isGif ? ' dm-msg-gif' : ''}">${contentHtml}</div>
          <div class="dm-msg-time">${timeStr}</div>
        </div>
      `;
    }).join('');

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private openConversation(pubkey: string): void {
    this.activePubkey = pubkey;

    // Clear unread and persist read state
    const conv = this.conversations.get(pubkey);
    if (conv) conv.unread = 0;
    this.markRead(pubkey);

    if (!this.conversations.has(pubkey)) {
      this.conversations.set(pubkey, {
        pubkey,
        name: pubkey.slice(0, 12) + '...',
        lastMessage: '',
        lastTime: Date.now() / 1000,
        unread: 0,
      });
      this.fetchAndSetName(pubkey);
    }

    const headerEl = this.container?.querySelector('.dm-chat-header');
    if (headerEl) {
      const name = this.conversations.get(pubkey)?.name || pubkey.slice(0, 12) + '...';
      headerEl.innerHTML = `
        <button class="dm-back">\u2190</button>
        <span class="dm-chat-name">${this.escapeHtml(name)}</span>
      `;
      headerEl.querySelector('.dm-back')?.addEventListener('click', () => {
        this.activePubkey = null;
        this.renderConversationList();
        (this.container?.querySelector('.dm-chat') as HTMLElement).style.display = 'none';
        (this.container?.querySelector('.dm-conv-list') as HTMLElement).style.display = 'block';
      });
    }

    const chatEl = this.container?.querySelector('.dm-chat') as HTMLElement;
    const listEl = this.container?.querySelector('.dm-conv-list') as HTMLElement;
    if (chatEl) chatEl.style.display = 'flex';
    if (listEl) listEl.style.display = 'none';

    this.renderMessages();
    this.renderConversationList();

    setTimeout(() => this.inputEl?.focus(), 100);
  }

  private async sendMessage(): Promise<void> {
    if (!this.inputEl || !this.activePubkey) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    const recipientPubkey = this.activePubkey;
    this.inputEl.value = '';

    sendDirectMessage(recipientPubkey, text).catch(e => {
      console.error('[DM] Send error:', e);
    });

    this.inputEl.focus();
  }

  // ════════════════════════════════════════════
  // STYLES
  // ════════════════════════════════════════════

  private injectStyles(): void {
    if (document.getElementById('dm-panel-styles')) return;

    const style = document.createElement('style');
    style.id = 'dm-panel-styles';
    style.textContent = `
      .dm-panel {
        position: fixed; top: 0; right: -400px; width: 390px; height: 100vh;
        background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
        border-left: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        z-index: 2000; font-family: 'Courier New', monospace;
        display: flex; flex-direction: column;
        transition: right 0.25s ease; box-shadow: -4px 0 20px rgba(0,0,0,0.5);
      }
      .dm-panel.dm-open { right: 0; }

      .dm-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 14px 18px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        background: color-mix(in srgb, black 52%, var(--nd-bg));
      }
      .dm-title {
        color: var(--nd-accent); font-size: 15px; font-weight: bold; letter-spacing: 0.5px;
        text-shadow: 0 1px 4px rgba(0,0,0,0.8);
      }
      .dm-close {
        background: none; border: none; color: var(--nd-subtext);
        font-size: 18px; cursor: pointer; padding: 4px 8px; transition: color 0.15s;
      }
      .dm-close:hover { color: var(--nd-text); }

      .dm-body { flex: 1; display: flex; overflow: hidden; }
      .dm-conv-list {
        flex: 1; overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb,var(--nd-text) 18%,transparent) transparent;
      }
      .dm-conv-item {
        padding: 12px 16px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 7%,transparent);
        cursor: pointer; transition: background 0.15s; position: relative;
      }
      .dm-conv-item:hover { background: color-mix(in srgb,var(--nd-text) 6%,transparent); }
      .dm-conv-item.active { background: color-mix(in srgb,var(--nd-accent) 14%,transparent); border-left: 2px solid var(--nd-accent); }
      .dm-conv-name {
        color: var(--nd-text); font-size: 13px; font-weight: bold; margin-bottom: 3px;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }
      .dm-conv-preview {
        color: var(--nd-subtext); font-size: 12px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }
      .dm-unread {
        position: absolute; top: 12px; right: 14px;
        background: var(--nd-accent); color: var(--nd-bg);
        font-size: 11px; font-weight: bold; padding: 2px 6px;
        border-radius: 8px; min-width: 16px; text-align: center;
      }
      .dm-hide-btn {
        position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
        background: color-mix(in srgb, black 55%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-text) 15%, transparent);
        border-radius: 4px; color: var(--nd-subtext);
        font-size: 11px; line-height: 1; padding: 3px 6px; cursor: pointer;
        opacity: 0; transition: opacity 0.15s, color 0.15s;
        font-family: 'Courier New', monospace;
      }
      .dm-conv-item:hover .dm-hide-btn { opacity: 1; }
      .dm-hide-btn:hover { color: var(--nd-text); border-color: color-mix(in srgb, var(--nd-text) 35%, transparent); }
      .dm-conv-item:has(.dm-unread) .dm-hide-btn { right: 46px; }
      .dm-conv-hidden { opacity: 0.45; }
      .dm-conv-hidden .dm-hide-btn { color: var(--nd-accent); }
      .dm-hidden-toggle {
        padding: 8px 16px; font-size: 11px;
        color: var(--nd-subtext); cursor: pointer;
        border-top: 1px solid color-mix(in srgb, var(--nd-text) 7%, transparent);
        border-bottom: 1px solid color-mix(in srgb, var(--nd-text) 7%, transparent);
        background: color-mix(in srgb, black 30%, var(--nd-bg));
        text-align: center; transition: color 0.15s;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }
      .dm-hidden-toggle:hover { color: var(--nd-text); }

      .dm-chat { flex: 1; display: none; flex-direction: column; }
      .dm-chat-header {
        padding: 10px 14px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        display: flex; align-items: center; gap: 10px;
        background: color-mix(in srgb, black 45%, var(--nd-bg));
      }
      .dm-back {
        background: none; border: none; color: var(--nd-accent);
        font-size: 16px; cursor: pointer; padding: 2px 6px;
      }
      .dm-back:hover { color: var(--nd-text); }
      .dm-chat-name {
        color: var(--nd-text); font-size: 14px; font-weight: bold;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }

      .dm-messages {
        flex: 1; overflow-y: auto; padding: 12px 14px;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb,var(--nd-text) 18%,transparent) transparent;
      }
      .dm-msg { margin-bottom: 10px; max-width: 85%; }
      .dm-msg-own { margin-left: auto; text-align: right; }
      .dm-msg-other { margin-right: auto; }
      .dm-msg-content {
        display: inline-block; padding: 8px 12px; border-radius: 8px;
        font-size: 13px; line-height: 1.4; word-break: break-word;
      }
      .dm-msg-own .dm-msg-content {
        background: color-mix(in srgb, var(--nd-accent) 22%, color-mix(in srgb, black 55%, var(--nd-bg)));
        color: var(--nd-text);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 55%, transparent);
        border-radius: 8px 8px 2px 8px;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      }
      .dm-msg-other .dm-msg-content {
        background: color-mix(in srgb, black 50%, var(--nd-bg));
        color: var(--nd-text);
        border: 1px solid color-mix(in srgb, var(--nd-text) 14%, transparent);
        border-radius: 8px 8px 8px 2px;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      }
      .dm-msg-time { font-size: 10px; color: var(--nd-subtext); margin-top: 3px; }
      .dm-msg-own .dm-msg-time { text-align: right; }
      .dm-msg-error { text-align: center; color: #e85454; font-size: 12px; padding: 4px; opacity: 0.7; }

      .dm-input-row {
        padding: 10px 14px;
        border-top: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        background: color-mix(in srgb, black 50%, var(--nd-bg));
        display: flex; gap: 6px; align-items: center;
      }
      .dm-input {
        flex: 1;
        background: color-mix(in srgb, black 55%, var(--nd-bg));
        border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 6px; color: var(--nd-text);
        font-family: 'Courier New', monospace; font-size: 13px;
        padding: 10px 12px; outline: none; box-sizing: border-box; transition: border-color 0.2s;
      }
      .dm-input:focus { border-color: color-mix(in srgb,var(--nd-accent) 65%,transparent); }
      .dm-input::placeholder { color: var(--nd-subtext); opacity: 0.55; }
      .dm-gif-btn {
        flex-shrink: 0; padding: 8px 10px;
        background: color-mix(in srgb, black 45%, var(--nd-bg));
        border: 1px solid color-mix(in srgb,var(--nd-text) 22%,transparent);
        border-radius: 6px; color: var(--nd-subtext);
        font-family: 'Courier New', monospace; font-size: 11px; font-weight: bold;
        cursor: pointer; transition: color 0.15s, border-color 0.15s;
      }
      .dm-gif-btn:hover { color: var(--nd-accent); border-color: color-mix(in srgb,var(--nd-accent) 50%,transparent); }
      .dm-msg-gif { background: none !important; border: none !important; padding: 0 !important; }
      .dm-empty {
        color: var(--nd-subtext); font-size: 13px; text-align: center;
        padding: 30px 20px; line-height: 1.5; text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }
    `;
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════
  // UTILITY
  // ════════════════════════════════════════════

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}