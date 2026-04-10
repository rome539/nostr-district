/**
 * DM Panel — slide-out UI for NIP-17 encrypted direct messages
 *
 * Renders as an HTML overlay on top of the Phaser game.
 * - Click a player in HubScene → opens DM panel with that player
 * - Shows conversation list on left, messages on right
 * - Styled to match Nostr District neon cyberpunk aesthetic
 */

import { sendDirectMessage, onDMReceived, canUseDMs, isDMHistoryLoading, onDMHistoryLoading, DMMessage } from '../nostr/dmService';
import { hasUsedInviteToken, markInviteTokenUsed, clearKickedLocally, syncConsumedInviteTokens, areConsumedTokensSynced } from '../nostr/crewService';
import { SoundEngine } from '../audio/SoundEngine';
import { fetchProfile } from '../nostr/nostrService';
import { authStore } from '../stores/authStore';
import { GifPicker, isGifUrl, gifSrcAttr } from './GifPicker';
import { renderEmojis } from '../nostr/emojiService';
import { ProfileModal } from './ProfileModal';
import { nip19 } from 'nostr-tools';

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
  isOpen = false;
  private unsubscribe: (() => void) | null = null;
  private myPubkey: string | null = null;
  private totalUnread = 0;
  private gifPicker: GifPicker | null = null;
  private hiddenConvs = new Set<string>();
  private showHidden = false;
  private fetchedNames = new Set<string>();

  private static readonly MSG_PAGE = 30;
  private static readonly CONV_PAGE = 15;
  // Index into the sorted messages array where the current view starts
  private msgViewStart = new Map<string, number>();
  // How many conversations to show in the list
  private convLimit = DMPanel.CONV_PAGE;

  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubLoading: (() => void) | null = null;
  private historyLoading = false;

  private toNpub(pubkey: string): string {
    try { return nip19.npubEncode(pubkey).slice(0, 16) + '...'; } catch { return pubkey.slice(0, 12) + '...'; }
  }

  private lastPingAt = 0;
  private dmPing(): void {
    const now = Date.now();
    if (now - this.lastPingAt < 1500) return;
    this.lastPingAt = now;
    SoundEngine.get().dmPing();
  }

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

    // Close when another panel opens
    window.addEventListener('nd-panel-open', (e: Event) => {
      if ((e as CustomEvent).detail !== 'dm' && this.isOpen) this.close();
    });

    // Listen for incoming DMs
    this.unsubscribe = onDMReceived((msg) => this.handleMessage(msg));

    // Track history-load state so we can debounce renders during the initial burst
    this.historyLoading = isDMHistoryLoading();
    this.unsubLoading = onDMHistoryLoading((loading) => {
      this.historyLoading = loading;
      if (!loading) {
        // History just finished — do one full render if open
        if (this.isOpen) {
          if (this.activePubkey) this.renderMessages();
          this.renderConversationList();
        }
        // Show one summary notification for all unread messages accumulated during load
        if (!this.isOpen) {
          let totalUnread = 0;
          let latestMsg: { pubkey: string; name: string; content: string } | null = null;
          let latestTime = 0;
          this.conversations.forEach((conv, pubkey) => {
            const unread = conv.unread || 0;
            if (unread > 0) {
              totalUnread += unread;
              if (conv.lastTime > latestTime) {
                latestTime = conv.lastTime;
                latestMsg = { pubkey, name: conv.name, content: conv.lastMessage };
              }
            }
          });
          if (latestMsg && totalUnread > 0) {
            const { pubkey, name, content } = latestMsg as { pubkey: string; name: string; content: string };
            const label = totalUnread === 1 ? name : `${name} +${totalUnread - 1} more`;
            this.showToast(pubkey, label, content);
            this.dmPing();
          }
        }
      } else if (loading && this.isOpen) {
        this.renderConversationList(); // show the loading indicator
      }
    });
  }

  // ════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════

  /** Open the DM panel, optionally focused on a specific user */
  open(targetPubkey?: string): void {
    if (!canUseDMs()) {
      const loginMethod = authStore.getState().loginMethod;
      if (loginMethod === 'extension') {
        this.showExtensionUnsupported();
      }
      return;
    }

    if (!this.container) this.buildDOM();
    // Sync consumed invite tokens from relay so invite cards render correctly cross-device
    syncConsumedInviteTokens().then(() => { if (this.isOpen) this.renderMessages(); });
    // Close any other slide-out panels before opening
    window.dispatchEvent(new CustomEvent('nd-panel-open', { detail: 'dm' }));
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

  focusInput(): void {
    this.inputEl?.focus();
  }

  handleEsc(): void {
    if (this.gifPicker?.isOpen()) { this.gifPicker.close(); return; }
    if (this.inputEl && document.activeElement === this.inputEl) { this.inputEl.blur(); return; }
    if (this.activePubkey) {
      // Back to conversation list
      this.activePubkey = null;
      const chatEl = this.container?.querySelector('.dm-chat') as HTMLElement;
      const listEl = this.container?.querySelector('.dm-conv-list') as HTMLElement;
      if (chatEl) chatEl.style.display = 'none';
      if (listEl) listEl.style.display = '';
      this.renderConversationList();
      return;
    }
    this.close();
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

  private showExtensionUnsupported(): void {
    const existing = document.getElementById('dm-unsupported-notice');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'dm-unsupported-notice';
    panel.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 4000; width: min(360px, 90vw);
      background: var(--nd-bg); border: 1px solid color-mix(in srgb,var(--nd-dpurp) 50%,transparent);
      border-radius: 10px; padding: 24px 20px;
      font-family: 'Courier New', monospace;
      box-shadow: 0 8px 40px rgba(0,0,0,0.7);
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <span style="color:var(--nd-accent);font-size:14px;font-weight:bold;">✉ Direct Messages</span>
        <button id="dm-unsupported-close" style="background:none;border:none;color:var(--nd-subtext);font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
      </div>
      <div style="color:#f0b040;font-size:13px;margin-bottom:10px;">⚠ Your extension doesn't support NIP-44</div>
      <div style="color:var(--nd-subtext);font-size:12px;line-height:1.6;">
        NIP-17 encrypted DMs require NIP-44 encryption support in your signer.<br><br>
        <strong style="color:var(--nd-text);">Your extension may not support it.</strong><br><br>
        Try one of these instead:<br>
        <span style="color:var(--nd-accent);">• Alby</span> (browser extension)<br>
        <span style="color:var(--nd-accent);">• Amber / Primal / nsec.app</span> (NIP-46 bunker)<br>
        <span style="color:var(--nd-accent);">• Private key</span> (nsec login)
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById('dm-unsupported-close')!.addEventListener('click', () => panel.remove());
  }

  // Debounce renders during bulk history load — coalesces many rapid handleMessage
  // calls into a single render pass instead of re-rendering for every event.
  private showSendError(msg: string): void {
    const el = this.container?.querySelector('#dm-send-error') as HTMLElement | null;
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; el.textContent = ''; }, 5000);
  }

  private scheduleRender(): void {
    if (this.historyLoading) return; // suppress entirely during initial burst; onDMHistoryLoading fires one final render
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      if (!this.isOpen) return;
      if (this.activePubkey) this.renderMessages();
      this.renderConversationList();
    }, 40);
  }

  destroy(): void {
    if (this.unsubscribe) this.unsubscribe();
    if (this.unsubLoading) this.unsubLoading();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    if (this.container) this.container.remove();
    this.container = null;
  }

  // ════════════════════════════════════════════
  // MESSAGE HANDLING
  // ════════════════════════════════════════════

  private handleMessage(msg: DMMessage): void {
    const convPubkey = msg.conversationPubkey;

    // No content filtering in DMs — private conversations between two people

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
      name: msg.senderName || existing?.name || this.toNpub(convPubkey),
      lastMessage: isGifUrl(msg.content.trim()) ? '[GIF]' : /^https?:\/\//i.test(msg.content.trim()) ? '[Link]' : msg.content.slice(0, 50),
      lastTime: msg.createdAt,
      unread: (this.activePubkey === convPubkey) ? 0 : (existing?.unread || 0) + (!msg.isOwn && msg.createdAt > this.getLastRead(convPubkey) ? 1 : 0),
    });

    if (!existing?.name || existing.name.includes('...')) {
      this.fetchAndSetName(convPubkey);
    }

    if (this.isOpen) {
      if (this.activePubkey === convPubkey) {
        // Keep view pinned to the bottom as new messages arrive
        const updatedList = this.messages.get(convPubkey) || [];
        const currentStart = this.msgViewStart.get(convPubkey) ?? 0;
        const maxStart = Math.max(0, updatedList.length - DMPanel.MSG_PAGE);
        if (currentStart >= maxStart - 1) {
          this.msgViewStart.set(convPubkey, maxStart);
        }
      }
      this.scheduleRender();
    } else if (!msg.isOwn && msg.createdAt > this.getLastRead(convPubkey)) {
      // During history load, suppress per-message toasts/pings — one summary fires when load ends
      if (!this.historyLoading) {
        const senderName = this.conversations.get(convPubkey)?.name || msg.senderName || convPubkey.slice(0, 12) + '...';
        this.showToast(convPubkey, senderName, msg.content);
        this.dmPing();
      }
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
      max-width: min(280px, calc(100vw - 40px)); cursor: pointer;
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
      position: fixed; bottom: 20px; right: 20px; z-index: 1500;
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
        const name = profile.display_name || profile.name || this.toNpub(pubkey);
        const conv = this.conversations.get(pubkey);
        if (conv) {
          conv.name = name;
          if (this.isOpen) this.renderConversationList();
        }
      } else {
        // Allow retry next time if fetch returned nothing
        this.fetchedNames.delete(pubkey);
      }
    } catch (_) {
      this.fetchedNames.delete(pubkey);
    }
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
          <div id="dm-send-error" style="display:none;padding:6px 14px 0;font-family:'Courier New',monospace;font-size:11px;color:#e85454;"></div>
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
      if (e.key === 'Escape') { e.preventDefault(); this.handleEsc(); }
    });
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.handleEsc(); }
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

    // Eagerly resolve any names still showing as hex (once per pubkey)
    all.forEach(conv => {
      if ((!conv.name || conv.name.includes('...')) && !this.fetchedNames.has(conv.pubkey)) {
        this.fetchedNames.add(conv.pubkey);
        this.fetchAndSetName(conv.pubkey);
      }
    });

    const visible = all.filter(c => !this.hiddenConvs.has(c.pubkey));
    const hidden  = all.filter(c =>  this.hiddenConvs.has(c.pubkey));

    if (this.historyLoading) {
      this.convListEl.innerHTML = `<div class="dm-empty">Loading messages…</div>`;
      return;
    }

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

    const visiblePage = visible.slice(0, this.convLimit);
    const hasMore = visible.length > this.convLimit;
    const visibleHtml = visiblePage.map(c => renderItem(c, false)).join('');
    const showMoreHtml = hasMore ? `
      <div class="dm-show-more" id="dm-show-more">
        Show ${Math.min(DMPanel.CONV_PAGE, visible.length - this.convLimit)} more (${visible.length - this.convLimit} remaining)
      </div>
    ` : '';
    const hiddenHtml  = this.showHidden ? hidden.map(c => renderItem(c, true)).join('') : '';
    const footerHtml  = hidden.length > 0 ? `
      <div class="dm-hidden-toggle" id="dm-hidden-toggle">
        ${this.showHidden ? '▲ Hide archived' : `▼ Archived (${hidden.length})`}
      </div>
    ` : '';

    this.convListEl.innerHTML = visibleHtml + showMoreHtml + footerHtml + hiddenHtml;

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

    document.getElementById('dm-show-more')?.addEventListener('click', () => {
      this.convLimit += DMPanel.CONV_PAGE;
      this.renderConversationList();
    });

    document.getElementById('dm-hidden-toggle')?.addEventListener('click', () => {
      this.showHidden = !this.showHidden;
      this.renderConversationList();
    });
  }

  private renderMessages(preserveScroll = false): void {
    if (!this.messagesEl || !this.activePubkey) return;

    const msgs = this.messages.get(this.activePubkey) || [];

    if (msgs.length === 0) {
      this.messagesEl.innerHTML = `<div class="dm-empty">No messages yet. Say hi!</div>`;
      return;
    }

    // Default view start: last MSG_PAGE messages
    if (!this.msgViewStart.has(this.activePubkey)) {
      this.msgViewStart.set(this.activePubkey, Math.max(0, msgs.length - DMPanel.MSG_PAGE));
    }
    const viewStart = this.msgViewStart.get(this.activePubkey)!;
    const slice = msgs.slice(viewStart);
    const hasOlder = viewStart > 0;

    const loadOlderHtml = hasOlder ? `
      <div class="dm-load-older" id="dm-load-older">
        ↑ Load older messages (${viewStart} more)
      </div>
    ` : '';

    const msgsHtml = slice.map(msg => {
      const time = new Date(msg.createdAt * 1000);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const t = msg.content.trim();
      const isGif = isGifUrl(t);
      const isLink = !isGif && /^https?:\/\/[^\s]+$/i.test(t);
      const inviteMatch = !isGif && !isLink && t.match(/^nd-invite:([^:]+):([^:]+):([^:]+)$/);
      const contentHtml = isGif
        ? `<img src="${gifSrcAttr(t)}" style="max-width:200px;max-height:160px;border-radius:6px;display:block;cursor:pointer;" loading="lazy" onerror="this.style.display='none'" onclick="window.open(this.src,'_blank')">`
        : isLink
          ? `<a href="${t.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer" style="color:var(--nd-accent);opacity:0.8;font-size:12px;word-break:break-all;">${this.escapeHtml(t.length > 55 ? t.slice(0,52)+'…' : t)}</a>`
          : inviteMatch
            ? `<div class="dm-invite-card">
                <div class="dm-invite-label">Crew Invite</div>
                <div class="dm-invite-name">${this.escapeHtml(inviteMatch[2])}</div>
                ${msg.isOwn
                  ? '<div class="dm-invite-sent">Invite sent</div>'
                  : !areConsumedTokensSynced()
                    ? '<div class="dm-invite-sent dm-invite-checking">…</div>'
                    : hasUsedInviteToken(inviteMatch[3])
                      ? '<div class="dm-invite-sent">Invite used</div>'
                      : `<button class="dm-invite-btn" data-crew-id="${this.escapeHtml(inviteMatch[1])}" data-crew-name="${this.escapeHtml(inviteMatch[2])}" data-token="${this.escapeHtml(inviteMatch[3])}">Accept</button>`}
              </div>`
            : renderEmojis(this.escapeHtml(msg.content), msg.emojis);

      return `
        <div class="dm-msg ${msg.isOwn ? 'dm-msg-own' : 'dm-msg-other'}">
          <div class="dm-msg-content${isGif ? ' dm-msg-gif' : ''}${inviteMatch ? ' dm-msg-invite' : ''}">${contentHtml}</div>
          <div class="dm-msg-time">${timeStr}</div>
        </div>
      `;
    }).join('');

    // Preserve scroll position when loading older messages
    const prevScrollHeight = this.messagesEl.scrollHeight;
    const prevScrollTop = this.messagesEl.scrollTop;

    this.messagesEl.innerHTML = loadOlderHtml + msgsHtml;

    if (preserveScroll && hasOlder) {
      this.messagesEl.scrollTop = prevScrollTop + (this.messagesEl.scrollHeight - prevScrollHeight);
    } else {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    document.getElementById('dm-load-older')?.addEventListener('click', () => {
      const pk = this.activePubkey!;
      const current = this.msgViewStart.get(pk) ?? 0;
      this.msgViewStart.set(pk, Math.max(0, current - DMPanel.MSG_PAGE));
      this.renderMessages(true);
    });

    this.messagesEl.querySelectorAll('.dm-invite-btn').forEach(btn => {
      const crewId = (btn as HTMLElement).dataset.crewId!;
      const token = (btn as HTMLElement).dataset.token!;

      btn.addEventListener('click', async () => {
        (btn as HTMLButtonElement).disabled = true;
        (btn as HTMLElement).textContent = 'Joining…';
        try {
          const { joinCrew } = await import('../nostr/crewService');
          clearKickedLocally(crewId);
          await joinCrew(crewId);
          markInviteTokenUsed(token);
          this.renderMessages();
        } catch {
          (btn as HTMLButtonElement).disabled = false;
          (btn as HTMLElement).textContent = 'Accept';
        }
      });
    });
  }

  private openConversation(pubkey: string): void {
    this.activePubkey = pubkey;

    // Reset to bottom of message history when opening a conversation
    const msgs = this.messages.get(pubkey) || [];
    this.msgViewStart.set(pubkey, Math.max(0, msgs.length - DMPanel.MSG_PAGE));

    // Clear unread and persist read state
    const conv = this.conversations.get(pubkey);
    if (conv) conv.unread = 0;
    this.markRead(pubkey);

    if (!this.conversations.has(pubkey)) {
      this.conversations.set(pubkey, {
        pubkey,
        name: this.toNpub(pubkey),
        lastMessage: '',
        lastTime: Date.now() / 1000,
        unread: 0,
      });
      this.fetchAndSetName(pubkey);
    }

    const headerEl = this.container?.querySelector('.dm-chat-header');
    if (headerEl) {
      const name = this.conversations.get(pubkey)?.name || this.toNpub(pubkey);
      headerEl.innerHTML = `
        <button class="dm-back">\u2190</button>
        <span class="dm-chat-name">${this.escapeHtml(name)}</span>
        <button class="dm-view-profile" title="View profile" style="margin-left:auto;background:none;border:none;color:var(--nd-subtext);cursor:pointer;font-size:13px;padding:2px 6px;opacity:0.55;transition:opacity 0.15s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.55'">&#9432;</button>
      `;
      headerEl.querySelector('.dm-view-profile')?.addEventListener('click', () => {
        ProfileModal.show(pubkey, this.conversations.get(pubkey)?.name || this.toNpub(pubkey));
      });
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
  }

  private async sendMessage(): Promise<void> {
    if (!this.inputEl || !this.activePubkey) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';

    if (text.startsWith('/')) {
      const result = this.handleDMCommand(text);
      if (result) {
        sendDirectMessage(this.activePubkey, result).catch(() => {});
      }
      this.inputEl.focus();
      return;
    }

    sendDirectMessage(this.activePubkey, text).catch(e => {
      console.error('[DM] Send error:', e);
      this.showSendError(e?.message || 'Failed to send');
    });

    this.inputEl.focus();
  }

  private handleDMCommand(text: string): string | null {
    const space = text.indexOf(' ');
    const cmd = (space > -1 ? text.slice(1, space) : text.slice(1)).toLowerCase();
    const arg = space > -1 ? text.slice(space + 1).trim() : '';

    switch (cmd) {
      case 'flip': case 'coin': {
        const result = Math.random() < 0.5 ? '👑 HEADS' : '🦅 TAILS';
        return `🪙 flipped a coin: ${result}`;
      }
      case '8ball': {
        if (!arg) return '🎱 Usage: /8ball <question>';
        const responses = [
          'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.',
          'As I see it, yes.', 'Most likely.', 'Outlook good.', 'Signs point to yes.',
          'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
          'Cannot predict now.', 'Concentrate and ask again.',
          "Don't count on it.", 'My reply is no.', 'My sources say no.',
          'Outlook not so good.', 'Very doubtful.', 'Absolutely not.', 'The stars say no.',
        ];
        const answer = responses[Math.floor(Math.random() * responses.length)];
        return `🎱 ${arg} — ${answer}`;
      }
      case 'slots': {
        const reels = ['🍒','🍋','🍊','🍇','💎','🍀','⭐','🎰'];
        const r = () => reels[Math.floor(Math.random() * reels.length)];
        const [a, b, c] = [r(), r(), r()];
        const jackpot = a === b && b === c;
        const two = !jackpot && (a === b || b === c || a === c);
        const result = jackpot ? '🎉 JACKPOT!' : two ? '✨ Two of a kind!' : '💸 No match.';
        return `🎰 [ ${a} | ${b} | ${c} ] — ${result}`;
      }
      case 'ship': {
        const spaceIdx = arg.indexOf(' ');
        const n1 = spaceIdx > -1 ? arg.slice(0, spaceIdx).trim() : arg.trim();
        const n2 = spaceIdx > -1 ? arg.slice(spaceIdx + 1).trim() : '';
        if (!n1 || !n2) return '💘 Usage: /ship <name1> <name2>';
        const seed = [n1.toLowerCase(), n2.toLowerCase()].sort().join('|');
        let hash = 0; for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) & 0xfffffff;
        const pct = hash % 101;
        const label = pct >= 90 ? '💕 Soulmates!' : pct >= 70 ? '💖 Great match!' : pct >= 50 ? '💛 Good vibes.' : pct >= 30 ? '🤝 Could work.' : '😬 Rough road ahead.';
        return `💘 ${n1} + ${n2}: ${pct}% compatible — ${label}`;
      }
      default:
        return null;
    }
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
        position: fixed; top: 0; right: -100vw; width: min(390px, 100vw); height: 100dvh;
        background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
        border-left: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        z-index: 2000; font-family: 'Courier New', monospace;
        display: flex; flex-direction: column;
        transition: right 0.25s ease; box-shadow: -4px 0 20px rgba(0,0,0,0.5);
      }
      .dm-panel.dm-open { right: 0 !important; }

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
      .dm-load-older {
        padding: 8px 16px; font-size: 11px; text-align: center;
        color: var(--nd-subtext); cursor: pointer;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-dpurp) 20%,transparent);
        margin-bottom: 6px; transition: color 0.15s;
      }
      .dm-load-older:hover { color: var(--nd-accent); }
      .dm-show-more {
        padding: 8px 16px; font-size: 11px; text-align: center;
        color: var(--nd-subtext); cursor: pointer;
        border-top: 1px solid color-mix(in srgb,var(--nd-dpurp) 20%,transparent);
        margin-top: 4px; transition: color 0.15s;
      }
      .dm-show-more:hover { color: var(--nd-accent); }
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
      .dm-msg-invite { background: none !important; border: none !important; padding: 0 !important; }
      .dm-invite-card {
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
        background: color-mix(in srgb,var(--nd-accent) 6%,transparent);
        border-radius: 8px; padding: 10px 14px; min-width: 160px; text-align: left;
      }
      .dm-invite-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--nd-accent); margin-bottom: 4px; }
      .dm-invite-name { font-size: 14px; font-weight: bold; color: var(--nd-text); margin-bottom: 10px; }
      .dm-invite-btn {
        background: var(--nd-accent); color: var(--nd-bg); border: none; border-radius: 5px;
        font-family: inherit; font-size: 12px; font-weight: bold; padding: 5px 14px;
        cursor: pointer; transition: opacity 0.15s;
      }
      .dm-invite-btn:hover { opacity: 0.85; }
      .dm-invite-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .dm-invite-btn-joined { background: color-mix(in srgb,var(--nd-accent) 30%,transparent) !important; color: var(--nd-accent) !important; cursor: default !important; }
      .dm-invite-sent { font-size: 11px; color: var(--nd-subtext); }
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