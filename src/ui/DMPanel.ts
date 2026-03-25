/**
 * DM Panel — slide-out UI for NIP-17 encrypted direct messages
 *
 * Renders as an HTML overlay on top of the Phaser game.
 * - Click a player in HubScene → opens DM panel with that player
 * - Shows conversation list on left, messages on right
 * - Styled to match Nostr District neon cyberpunk aesthetic
 */

import { P } from '../config/game.config';
import { sendDirectMessage, onDMReceived, canUseDMs, DMMessage } from '../nostr/dmService';
import { fetchProfile } from '../nostr/nostrService';
import { shouldFilter } from '../nostr/moderationService';

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

  constructor(myPubkey: string | null) {
    this.myPubkey = myPubkey;
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
      lastMessage: msg.content.slice(0, 50),
      lastTime: msg.createdAt,
      unread: (this.activePubkey === convPubkey) ? 0 : (existing?.unread || 0) + (msg.isOwn ? 0 : 1),
    });

    if (!existing?.name || existing.name.includes('...')) {
      this.fetchAndSetName(convPubkey);
    }

    if (this.isOpen) {
      if (this.activePubkey === convPubkey) {
        this.renderMessages();
      }
      this.renderConversationList();
    }
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
      if (e.key === 'Enter') {
        this.sendMessage();
      }
      if (e.key === 'Escape') {
        this.close();
      }
    });

    this.inputEl.addEventListener('focus', () => {
      this.inputEl!.style.borderColor = `${P.teal}88`;
    });
    this.inputEl.addEventListener('blur', () => {
      this.inputEl!.style.borderColor = `${P.dpurp}66`;
    });
  }

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════

  private renderConversationList(): void {
    if (!this.convListEl) return;

    const sorted = Array.from(this.conversations.values())
      .sort((a, b) => b.lastTime - a.lastTime);

    if (sorted.length === 0) {
      this.convListEl.innerHTML = `
        <div class="dm-empty">No conversations yet.<br/>Click a player to start a DM.</div>
      `;
      return;
    }

    this.convListEl.innerHTML = sorted.map(conv => `
      <div class="dm-conv-item ${conv.pubkey === this.activePubkey ? 'active' : ''}" data-pubkey="${conv.pubkey}">
        <div class="dm-conv-name">${this.escapeHtml(conv.name)}</div>
        <div class="dm-conv-preview">${this.escapeHtml(conv.lastMessage)}</div>
        ${conv.unread > 0 ? `<span class="dm-unread">${conv.unread}</span>` : ''}
      </div>
    `).join('');

    this.convListEl.querySelectorAll('.dm-conv-item').forEach(el => {
      el.addEventListener('click', () => {
        const pk = (el as HTMLElement).dataset.pubkey;
        if (pk) this.openConversation(pk);
      });
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

      return `
        <div class="dm-msg ${msg.isOwn ? 'dm-msg-own' : 'dm-msg-other'}">
          <div class="dm-msg-content">${this.escapeHtml(msg.content)}</div>
          <div class="dm-msg-time">${timeStr}</div>
        </div>
      `;
    }).join('');

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private openConversation(pubkey: string): void {
    this.activePubkey = pubkey;

    // Clear unread
    const conv = this.conversations.get(pubkey);
    if (conv) conv.unread = 0;

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
        position: fixed;
        top: 0;
        right: -400px;
        width: 390px;
        height: 100vh;
        background: linear-gradient(180deg, ${P.bg} 0%, #0e0828 100%);
        border-left: 1px solid ${P.dpurp}55;
        z-index: 2000;
        font-family: 'Courier New', monospace;
        display: flex;
        flex-direction: column;
        transition: right 0.25s ease;
        box-shadow: -4px 0 20px rgba(0,0,0,0.5);
      }
      .dm-panel.dm-open {
        right: 0;
      }
      .dm-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 18px;
        border-bottom: 1px solid ${P.dpurp}44;
        background: rgba(10,0,20,0.5);
      }
      .dm-title {
        color: ${P.teal};
        font-size: 15px;
        font-weight: bold;
        letter-spacing: 0.5px;
      }
      .dm-close {
        background: none;
        border: none;
        color: ${P.lpurp};
        font-size: 18px;
        cursor: pointer;
        padding: 4px 8px;
        transition: color 0.15s;
      }
      .dm-close:hover { color: ${P.pink}; }
      .dm-body {
        flex: 1;
        display: flex;
        overflow: hidden;
      }
      .dm-conv-list {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: ${P.lpurp}44 transparent;
      }
      .dm-conv-item {
        padding: 12px 16px;
        border-bottom: 1px solid ${P.dpurp}22;
        cursor: pointer;
        transition: background 0.15s;
        position: relative;
      }
      .dm-conv-item:hover { background: rgba(74,45,142,0.15); }
      .dm-conv-item.active { background: rgba(93,202,165,0.1); border-left: 2px solid ${P.teal}; }
      .dm-conv-name {
        color: ${P.lcream};
        font-size: 13px;
        font-weight: bold;
        margin-bottom: 3px;
      }
      .dm-conv-preview {
        color: ${P.lpurp};
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dm-unread {
        position: absolute;
        top: 12px;
        right: 14px;
        background: ${P.pink};
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 8px;
        min-width: 16px;
        text-align: center;
      }
      .dm-chat {
        flex: 1;
        display: none;
        flex-direction: column;
      }
      .dm-chat-header {
        padding: 10px 14px;
        border-bottom: 1px solid ${P.dpurp}33;
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(10,0,20,0.3);
      }
      .dm-back {
        background: none;
        border: none;
        color: ${P.teal};
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
      }
      .dm-back:hover { color: ${P.lcream}; }
      .dm-chat-name {
        color: ${P.lcream};
        font-size: 14px;
        font-weight: bold;
      }
      .dm-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px 14px;
        scrollbar-width: thin;
        scrollbar-color: ${P.lpurp}44 transparent;
      }
      .dm-msg {
        margin-bottom: 10px;
        max-width: 85%;
      }
      .dm-msg-own {
        margin-left: auto;
        text-align: right;
      }
      .dm-msg-other {
        margin-right: auto;
      }
      .dm-msg-content {
        display: inline-block;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.4;
        word-break: break-word;
      }
      .dm-msg-own .dm-msg-content {
        background: ${P.teal}22;
        color: ${P.lteal};
        border: 1px solid ${P.teal}33;
        border-radius: 8px 8px 2px 8px;
      }
      .dm-msg-other .dm-msg-content {
        background: ${P.dpurp}22;
        color: ${P.lcream};
        border: 1px solid ${P.dpurp}33;
        border-radius: 8px 8px 8px 2px;
      }
      .dm-msg-time {
        font-size: 10px;
        color: ${P.lpurp};
        margin-top: 3px;
      }
      .dm-msg-own .dm-msg-time {
        text-align: right;
      }
      .dm-msg-error {
        text-align: center;
        color: ${P.red};
        font-size: 12px;
        padding: 4px;
        opacity: 0.7;
      }
      .dm-input-row {
        padding: 10px 14px;
        border-top: 1px solid ${P.dpurp}33;
        background: rgba(10,0,20,0.4);
      }
      .dm-input {
        width: 100%;
        background: rgba(10,0,20,0.8);
        border: 1px solid ${P.dpurp}66;
        border-radius: 6px;
        color: ${P.lcream};
        font-family: 'Courier New', monospace;
        font-size: 13px;
        padding: 10px 12px;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.2s;
      }
      .dm-input:focus {
        border-color: ${P.teal}88;
        box-shadow: 0 0 6px ${P.teal}15;
      }
      .dm-input::placeholder { color: ${P.lpurp}88; }
      .dm-empty {
        color: ${P.lpurp};
        font-size: 13px;
        text-align: center;
        padding: 30px 20px;
        line-height: 1.5;
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