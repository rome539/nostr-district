/**
 * CrewPanel.ts — Crews slide-out panel
 *
 * Press G to open. Two tabs:
 *   My Crew    — your crew details: chat / announcements / members
 *   Find a Crew — browse all public crews, join/leave
 *
 * Crew chat piggybacks on the presence WebSocket using room "crew:<id>".
 * Styled identically to DMPanel.
 */

import {
  Crew, CrewMember, CrewAnnouncement, CrewChatMessage,
  createCrew, fetchAllCrews, fetchMyCrews, fetchCrew, fetchCrewMembers,
  fetchCrewAnnouncements, postCrewAnnouncement, deleteCrewAnnouncement,
  joinCrew, leaveCrew, deleteCrew, isCrewMember, isCrewAdmin, isCrewOfficer, updateCrewMember, updateCrewDefinition, kickCrewMember, unKickCrewMember, isKickedLocally, clearMembership, sendJoinRequest,
  subscribeCrewChat, sendCrewChat,
  resolveNames, getCachedName,
} from '../nostr/crewService';
import { authStore } from '../stores/authStore';
import { requestOnlinePlayers, setOnlinePlayersHandler } from '../nostr/presenceService';
import { sendDirectMessage } from '../nostr/dmService';
import { SoundEngine } from '../audio/SoundEngine';
import { nip19 } from 'nostr-tools';
import { fetchProfile } from '../nostr/nostrService';
import { ProfileModal } from './ProfileModal';
import { GifPicker, isGifUrl, gifSrcAttr } from './GifPicker';
import { renderEmojis } from '../nostr/emojiService';
import { isPlainUrl, renderLinkWithPreview } from './LinkPreview';

// ── Helpers ───────────────────────────────────────────────────────────────────

import { safeUrl } from '../utils/sanitize';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return 'now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export class CrewPanel {
  private container: HTMLDivElement | null = null;
  private isOpen = false;

  private activeTab: 'mine' | 'find' = 'mine';
  private activeCrew: Crew | null = null;
  private activeCrewTab: 'chat' | 'announcements' | 'members' = 'chat';

  // Chat state
  private chatMessages: CrewChatMessage[] = [];
  private chatUnsub: (() => void) | null = null;
  private gifPicker: GifPicker | null = null;

  // Discover
  private allCrews: Crew[] = [];
  private discoverLoading = false;
  private findRefreshInterval: ReturnType<typeof setInterval> | null = null;

  // DOM refs
  private bodyEl: HTMLDivElement | null = null;

  // Unread
  private unreadCount = 0;

  constructor() {
    this.injectStyles();
    window.addEventListener('nd-panel-open', (e: Event) => {
      if ((e as CustomEvent).detail !== 'crew' && this.isOpen) this.close();
    });
  }

  // ══════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════

  open(): void {
    if (!this.container) this.buildDOM();
    window.dispatchEvent(new CustomEvent('nd-panel-open', { detail: 'crew' }));
    this.container!.classList.add('cp-open');
    this.isOpen = true;
    this.allCrews = []; // clear stale cache so lists always re-fetch on open
    this.render();
  }

  close(): void {
    if (this.inputEl && document.activeElement === this.inputEl) this.inputEl.blur();
    this.stopChatSub();
    this.stopFindRefresh();
    this.container?.classList.remove('cp-open');
    this.isOpen = false;
  }

  focusInput(): void {
    this.inputEl?.focus();
  }

  toggle(): void {
    if (this.isOpen) {
      const modal = document.querySelector('.cp-modal-overlay') as HTMLElement | null;
      if (modal) { modal.remove(); return; }
      this.close();
    } else {
      this.open();
    }
  }
  isVisible(): boolean { return this.isOpen; }

  pressEsc(): void {
    if (this.gifPicker?.isOpen()) { this.gifPicker.close(); return; }
    const modal = document.querySelector('.cp-modal-overlay') as HTMLElement | null;
    if (modal) { modal.remove(); return; }
    if (this.inputEl && document.activeElement === this.inputEl) { this.inputEl.blur(); return; }
    if (this.activeCrew) { this.stopChatSub(); this.backToList(); return; }
    this.close();
  }

  destroy(): void {
    this.stopChatSub();
    this.container?.remove();
    this.container = null;
  }

  private stopChatSub(): void {
    this.chatUnsub?.();
    this.chatUnsub = null;
  }

  private stopFindRefresh(): void {
    if (this.findRefreshInterval) { clearInterval(this.findRefreshInterval); this.findRefreshInterval = null; }
  }

  // ══════════════════════════════════════════
  // DOM BUILD
  // ══════════════════════════════════════════

  private inputEl: HTMLInputElement | null = null;

  private buildDOM(): void {
    this.container = document.createElement('div');
    this.container.className = 'cp-panel';
    this.container.innerHTML = `
      <div class="cp-header">
        <div class="cp-tabs">
          <button class="cp-tab cp-tab-mine active" data-tab="mine">Crews</button>
          <button class="cp-tab cp-tab-find" data-tab="find">Find a Crew</button>
        </div>
        <button class="cp-create-btn" title="Create crew">＋</button>
        <button class="cp-close-btn" title="Close">✕</button>
      </div>
      <div class="cp-body"></div>
    `;
    document.body.appendChild(this.container);

    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.pressEsc(); }
    });

    this.bodyEl = this.container.querySelector('.cp-body');

    this.container.querySelector('.cp-close-btn')!.addEventListener('click', () => this.close());
    this.container.querySelector('.cp-create-btn')!.addEventListener('click', () => this.showCreateModal());
    this.container.querySelectorAll('.cp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab as 'mine' | 'find';
        this.switchTab(tab);
      });
    });
  }

  // ══════════════════════════════════════════
  // ROUTING
  // ══════════════════════════════════════════

  private render(): void {
    if (this.activeCrew) {
      this.renderCrewDetail();
    } else if (this.activeTab === 'mine') {
      this.renderMyCrew();
    } else {
      this.renderFindCrew();
    }
  }

  private switchTab(tab: 'mine' | 'find'): void {
    if (tab !== 'find') this.stopFindRefresh();
    this.activeTab = tab;
    this.activeCrew = null;
    this.container?.querySelectorAll('.cp-tab').forEach(b => b.classList.remove('active'));
    this.container?.querySelector(`.cp-tab-${tab}`)?.classList.add('active');
    this.render();
  }

  private openCrew(crew: Crew): void {
    this.stopChatSub();
    this.activeCrew = crew;
    this.activeCrewTab = 'chat';
    this.chatMessages = [];
    this.unreadCount = 0;
    this.render();
  }

  private backToList(): void {
    this.stopChatSub();
    this.activeCrew = null;
    this.render();
  }

  // ══════════════════════════════════════════
  // MY CREW VIEW
  // ══════════════════════════════════════════

  private renderMyCrew(): void {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = '<div class="cp-body-scroll"><div class="cp-loading">Loading your crews…</div></div>';

    fetchMyCrews().then(crews => {
      if (!this.bodyEl || this.activeCrew || this.activeTab !== 'mine') return;
      if (crews.length === 0) {
        this.bodyEl.innerHTML = `
          <div class="cp-body-scroll"><div class="cp-empty">
            <div style="color:var(--nd-text);font-weight:bold;margin-bottom:6px">No crew yet</div>
            <div style="color:var(--nd-subtext);font-size:12px">Find a crew to join,<br>or create your own.</div>
          </div></div>
        `;
        return;
      }
      const scroll = document.createElement('div');
      scroll.className = 'cp-body-scroll';
      crews.forEach(crew => scroll.appendChild(this.buildCrewCard(crew, true)));
      this.bodyEl.innerHTML = '';
      this.bodyEl.appendChild(scroll);
    }).catch(() => {
      if (this.bodyEl) this.bodyEl.innerHTML = `<div class="cp-body-scroll"><div class="cp-empty"><div style="color:var(--nd-subtext);font-size:12px">Couldn't load crews.</div></div></div>`;
    });
  }

  // ══════════════════════════════════════════
  // FIND A CREW VIEW
  // ══════════════════════════════════════════

  private renderFindCrew(): void {
    if (!this.bodyEl) return;

    if (this.allCrews.length > 0) {
      this.renderCrewList();
    } else {
      this.bodyEl.innerHTML = '<div class="cp-body-scroll"><div class="cp-loading">Searching for crews…</div></div>';
    }

    this.discoverLoading = true;
    fetchAllCrews().then(crews => {
      this.discoverLoading = false;
      this.allCrews = crews;
      if (this.activeTab === 'find' && !this.activeCrew) this.renderCrewList();
    }).catch(() => {
      this.discoverLoading = false;
      if (!this.allCrews.length && this.bodyEl) {
        this.bodyEl.innerHTML = '<div class="cp-empty">Could not load crews.</div>';
      }
    });

    // Auto-refresh every 30s so deleted/new crews appear without manual close+reopen
    if (this.findRefreshInterval) clearInterval(this.findRefreshInterval);
    this.findRefreshInterval = setInterval(() => {
      if (this.activeTab !== 'find' || this.activeCrew || this.discoverLoading) return;
      fetchAllCrews().then(crews => {
        this.allCrews = crews;
        if (this.activeTab === 'find' && !this.activeCrew) this.renderCrewList();
      }).catch(() => {});
    }, 30_000);
  }

  private renderCrewList(): void {
    if (!this.bodyEl) return;
    if (this.allCrews.length === 0) {
      this.bodyEl.innerHTML = '<div class="cp-body-scroll"><div class="cp-empty">No crews found yet.<br>Be the first to create one!</div></div>';
      return;
    }
    const scroll = document.createElement('div');
    scroll.className = 'cp-body-scroll';
    this.allCrews.forEach(crew => scroll.appendChild(this.buildCrewCard(crew, false)));
    this.bodyEl.innerHTML = '';
    this.bodyEl.appendChild(scroll);
  }

  // ── Crew card (shared) ─────────────────────────────────────────────────────

  private buildCrewCard(crew: Crew, isMine: boolean): HTMLElement {
    const joined = isCrewMember(crew.id);
    const myPubkey = authStore.getState().pubkey;
    const isFounder = crew.founderPubkey === myPubkey;
    const card = document.createElement('div');
    card.className = 'cp-crew-card';
    card.innerHTML = `
      <div class="cp-crew-emblem" style="${crew.emblem.startsWith('http') ? 'background:transparent;border-color:color-mix(in srgb,var(--nd-text) 15%,transparent);padding:0;overflow:hidden' : `background:${esc(crew.color)}22;border-color:${esc(crew.color)}55;color:${esc(crew.color)}`}">${crew.emblem.startsWith('http') ? `<img src="${esc(crew.emblem)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;display:block" />` : renderEmojis(esc(crew.emblem), crew.emblemEmojis)}</div>
      <div class="cp-crew-body">
        <div class="cp-crew-name">${esc(crew.name)}</div>
        <div class="cp-crew-about">${esc(crew.about || (crew.isOpen ? 'Open crew' : 'Closed crew'))}</div>
      </div>
      <div class="cp-crew-meta">
        ${isKickedLocally(crew.id) ? `<span class="cp-badge-kicked">Kicked</span>` : joined ? `<span class="cp-badge-joined">Joined</span>` : crew.isOpen ? `<span class="cp-badge-open">Open</span>` : `<span class="cp-badge-closed">Closed</span>`}
      </div>
    `;
    card.addEventListener('click', () => this.openCrew(crew));
    return card;
  }

  // ══════════════════════════════════════════
  // CREW DETAIL VIEW
  // ══════════════════════════════════════════

  private renderCrewDetail(): void {
    if (!this.bodyEl || !this.activeCrew) return;
    const crew = this.activeCrew;
    const joined = isCrewMember(crew.id);
    const state = authStore.getState();
    const isFounder = crew.founderPubkey === state.pubkey;
    const isKicked = isKickedLocally(crew.id) || (!isFounder && (crew.kickedPubkeys ?? []).includes(state.pubkey ?? ''));
    const isAdmin   = !isKicked && joined && (state.pubkey ? isCrewAdmin(crew.id, state.pubkey) : false);
    const isOfficer = !isKicked && joined && !isAdmin && !isFounder && (state.pubkey ? isCrewOfficer(crew.id, state.pubkey) : false);
    const canInvite = isFounder || isAdmin;
    // Closed + not member → show Request to Join instead of Join
    const showRequestBtn = !crew.isOpen && !joined && !isFounder && !isKicked;
    const showJoinBtn = crew.isOpen && !joined && !isFounder && !isKicked;

    this.bodyEl.innerHTML = `
      <div class="cp-detail-header" style="border-bottom:2px solid ${esc(crew.color)}44">
        <button class="cp-back-btn">← Back</button>
        <div class="cp-detail-emblem" style="color:${esc(crew.color)}">${crew.emblem.startsWith('http') ? `<img src="${esc(crew.emblem)}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;vertical-align:middle;display:inline-block" />` : renderEmojis(esc(crew.emblem), crew.emblemEmojis)}</div>
        <div class="cp-detail-title">
          <div class="cp-detail-name">${esc(crew.name)}</div>
          <div class="cp-detail-sub">${esc(crew.about)}</div>
        </div>
        ${isKicked
          ? `<span class="cp-badge-kicked" style="flex-shrink:0;padding:4px 10px;font-size:12px">Kicked</span>`
          : showRequestBtn
            ? `<button class="cp-join-action cp-request-join">Request</button>`
            : showJoinBtn
              ? `<button class="cp-join-action cp-join">Join</button>`
              : joined && !isFounder
                ? `<button class="cp-join-action cp-leave" style="border-color:${esc(crew.color)}55;color:${esc(crew.color)}">Leave</button>`
                : ''}
        ${canInvite ? `<button class="cp-manage-btn" title="Manage crew">Manage</button>` : ''}
      </div>
      <div class="cp-detail-tabs">
        <button class="cp-dtab ${this.activeCrewTab === 'chat' ? 'active' : ''}" data-dtab="chat">Chat</button>
        <button class="cp-dtab ${this.activeCrewTab === 'announcements' ? 'active' : ''}" data-dtab="announcements">Posts</button>
        <button class="cp-dtab ${this.activeCrewTab === 'members' ? 'active' : ''}" data-dtab="members">Members</button>
      </div>
      <div class="cp-detail-body"></div>
    `;

    // Back
    this.bodyEl.querySelector('.cp-back-btn')!.addEventListener('click', () => this.backToList());

    // Join / Leave / Request to Join
    const joinBtn = this.bodyEl.querySelector('.cp-join-action') as HTMLButtonElement | null;
    joinBtn?.addEventListener('click', async () => {
      const state2 = authStore.getState();
      if (!state2.pubkey || state2.loginMethod === 'guest') { alert('Please log in.'); return; }
      joinBtn.disabled = true;
      if (joinBtn.classList.contains('cp-request-join')) {
        try {
          await sendJoinRequest(crew.id);
          joinBtn.textContent = 'Requested';
          joinBtn.style.opacity = '0.6';
        } catch { joinBtn.disabled = false; }
      } else if (joined) {
        await leaveCrew(crew.id).catch(() => {});
        joinBtn.disabled = false;
        this.renderCrewDetail();
      } else {
        await joinCrew(crew.id).catch(() => {});
        joinBtn.disabled = false;
        this.renderCrewDetail();
      }
    });

    // Manage (founder + admins)
    if (canInvite) {
      this.bodyEl.querySelector('.cp-manage-btn')!.addEventListener('click', () => {
        this.showManageModal(crew);
      });
    }

    // Detail tabs
    this.bodyEl.querySelectorAll('.cp-dtab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeCrewTab = (btn as HTMLElement).dataset.dtab as any;
        this.bodyEl?.querySelectorAll('.cp-dtab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderDetailBody();
      });
    });

    // Kick detection is handled inside subscribeCrewChat via the onKick callback above —
    // the chat relay is already connected so kicks are detected the moment the system
    // message "was removed from the crew" arrives, with no extra subscription needed.

    this.renderDetailBody();
  }

  private renderDetailBody(): void {
    const el = this.bodyEl?.querySelector('.cp-detail-body') as HTMLElement;
    if (!el || !this.activeCrew) return;
    el.innerHTML = '';
    this.stopChatSub();

    if (isKickedLocally(this.activeCrew.id)) {
      el.innerHTML = '<div class="cp-not-member" style="padding:32px;text-align:center">You have been removed from this crew.</div>';
      return;
    }
    if (!isCrewMember(this.activeCrew.id)) {
      el.innerHTML = '<div class="cp-not-member" style="padding:32px;text-align:center">Join this crew to see chat, posts, and members.</div>';
      return;
    }

    if (this.activeCrewTab === 'chat') this.renderChat(el);
    else if (this.activeCrewTab === 'announcements') this.renderAnnouncements(el);
    else this.renderMembers(el);
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  private chatMsgEl: HTMLDivElement | null = null;
  private shownMsgIds = new Set<string>();

  private renderChat(el: HTMLElement): void {
    const crew = this.activeCrew!;
    const joined = isCrewMember(crew.id);
    const { pubkey: myPubkey } = authStore.getState();
    const isFounder = crew.founderPubkey === myPubkey;

    el.innerHTML = `
      <div class="cp-messages"><div class="cp-loading">Loading chat…</div></div>
      ${joined ? `
        <div class="cp-input-row">
          <input class="cp-input" type="text" placeholder="Message crew…" maxlength="300" />
          <button class="cp-gif-btn">GIF</button>
        </div>
      ` : `<div class="cp-not-member">Join the crew to chat.</div>`}
    `;

    this.chatMsgEl = el.querySelector('.cp-messages');
    this.shownMsgIds.clear();

    // Render buffered messages from this session
    this.chatMessages.forEach(m => this.appendChatMessage(m, myPubkey));
    if (this.chatMessages.length) {
      this.chatMsgEl!.querySelector('.cp-loading')?.remove();
      this.scrollChat();
    }

    if (!joined) return;

    // Live Nostr subscription — history + new messages
    // onKick is passed so the chat relay (already connected) detects kicks in real-time
    const onKick = !isFounder ? () => {
      this.stopChatSub();
      this.activeCrew = null;
      this.allCrews = this.allCrews.filter(c => c.id !== crew.id);
      // Publish active:false so this crew disappears from My Crews on any device
      clearMembership(crew.id).catch(() => {});
      this.render();
      if (this.bodyEl) {
        const note = document.createElement('div');
        note.style.cssText = 'position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:#e85454;color:#fff;padding:8px 16px;border-radius:6px;font-size:12px;z-index:10;pointer-events:none';
        note.textContent = `You were removed from ${crew.name}`;
        this.bodyEl.style.position = 'relative';
        this.bodyEl.appendChild(note);
        setTimeout(() => note.remove(), 3000);
      }
    } : undefined;
    subscribeCrewChat(crew.id, (msg) => {
      if (this.shownMsgIds.has(msg.id)) return;
      // Dedup optimistic sends: if we already showed this pubkey+content within 30s, skip
      const isDupe = this.chatMessages.some(m =>
        m.pubkey === msg.pubkey && m.content === msg.content && Math.abs(m.createdAt - msg.createdAt) < 30
      );
      if (isDupe) { this.shownMsgIds.add(msg.id); return; }
      this.shownMsgIds.add(msg.id);
      this.chatMessages.push(msg);
      if (this.chatMessages.length > 200) this.chatMessages.splice(0, 1);
      if (this.chatMsgEl) {
        this.chatMsgEl.querySelector('.cp-loading')?.remove();
        this.appendChatMessage(msg, myPubkey);
        // Real-time: if a "joined" system message arrives, remove request cards older than it
        if (msg.isSystem && msg.systemSubjectPubkey && msg.content?.includes('joined the crew')) {
          this.chatMsgEl.querySelectorAll(`[data-joinreq="${CSS.escape(msg.systemSubjectPubkey)}"]`).forEach(card => {
            const reqTs = parseInt((card as HTMLElement).dataset.ts || '0');
            if (msg.createdAt > reqTs) card.remove();
          });
        }
        this.scrollChat();
      }
    }, onKick).then(unsub => {
      this.chatUnsub = unsub;
      this.chatMsgEl?.querySelector('.cp-loading')?.remove();
      // After history loads, remove request cards where a "joined" message arrived after the request
      // Build latest-join timestamp map per pubkey
      const joinedAtMap = new Map<string, number>();
      this.chatMessages
        .filter(m => m.isSystem && m.systemSubjectPubkey && m.content?.includes('joined the crew'))
        .forEach(m => {
          const prev = joinedAtMap.get(m.systemSubjectPubkey!);
          if (!prev || m.createdAt > prev) joinedAtMap.set(m.systemSubjectPubkey!, m.createdAt);
        });
      this.chatMsgEl?.querySelectorAll('[data-joinreq]').forEach(card => {
        const el = card as HTMLElement;
        const pk = el.dataset.joinreq!;
        const reqTs = parseInt(el.dataset.ts || '0');
        const joinTs = joinedAtMap.get(pk);
        if (joinTs && joinTs > reqTs) card.remove();
      });
    });

    this.inputEl = el.querySelector('.cp-input');
    this.inputEl!.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.doSendChat(); }
      if (e.key === 'Escape') { e.preventDefault(); this.pressEsc(); }
    });

    const gifBtn = el.querySelector('.cp-gif-btn') as HTMLButtonElement;
    gifBtn?.addEventListener('click', () => {
      if (this.gifPicker?.isOpen()) { this.gifPicker.close(); return; }
      this.gifPicker = new GifPicker((url) => {
        sendCrewChat(this.activeCrew!.id, url).catch(() => {});
        const optimistic: CrewChatMessage = { id: 'opt_' + Math.random().toString(36).slice(2), pubkey: myPubkey!, content: url, createdAt: Math.floor(Date.now() / 1000) };
        this.chatMessages.push(optimistic);
        this.appendChatMessage(optimistic, myPubkey);
        this.scrollChat();
      });
      this.gifPicker.open(gifBtn);
    });
  }

  private resolvedNames = new Map<string, string>();

  private getDisplayName(pubkey: string, myPubkey: string | null): string {
    if (pubkey === myPubkey) {
      return authStore.getState().displayName || this.shortNpub(pubkey);
    }
    if (this.resolvedNames.has(pubkey)) return this.resolvedNames.get(pubkey)!;
    // Kick off background resolution
    fetchProfile(pubkey).then(p => {
      const name = p?.display_name || p?.name;
      if (name) {
        this.resolvedNames.set(pubkey, name);
        // Update any rendered name elements for this pubkey
        this.chatMsgEl?.querySelectorAll(`[data-pk="${pubkey}"]`).forEach(el => { el.textContent = name; });
      }
    }).catch(() => {});
    return this.shortNpub(pubkey);
  }

  private shortNpub(pubkey: string): string {
    try { const npub = nip19.npubEncode(pubkey); return npub.slice(0, 12) + '…'; } catch { return pubkey.slice(0, 8) + '…'; }
  }

  private appendChatMessage(msg: CrewChatMessage, myPubkey: string | null): void {
    if (!this.chatMsgEl) return;
    this.shownMsgIds.add(msg.id);
    const el = document.createElement('div');

    if (msg.isSystem) {
      el.className = 'cp-msg-system';
      el.textContent = msg.content;
      this.chatMsgEl.appendChild(el);
      return;
    }

    if (msg.isJoinRequest) {
      const crew = this.activeCrew!;
      const { pubkey: myPubkey } = authStore.getState();
      // Skip if this person joined AFTER this specific request (relay-based, works for all viewers)
      const hasJoinedAfter = this.chatMessages.some(m =>
        m.isSystem && m.systemSubjectPubkey === msg.pubkey &&
        m.content?.includes('joined the crew') && m.createdAt > msg.createdAt
      );
      if (hasJoinedAfter) return;
      // Replace any earlier card from the same person with the newest request
      const existing = this.chatMsgEl.querySelector(`[data-joinreq="${CSS.escape(msg.pubkey)}"]`);
      existing?.remove();
      const canAccept = myPubkey && (crew.founderPubkey === myPubkey || isCrewAdmin(crew.id, myPubkey) || isCrewOfficer(crew.id, myPubkey));
      const name = this.getDisplayName(msg.pubkey, myPubkey);
      el.className = 'cp-msg-joinreq';
      el.dataset.joinreq = msg.pubkey;
      el.dataset.ts = String(msg.createdAt);
      if (msg.requestToken) el.dataset.token = msg.requestToken;
      el.innerHTML = `
        <span class="cp-msg-joinreq-text"><b>${esc(name)}</b> wants to join the crew</span>
        ${canAccept ? `<button class="cp-msg-accept-btn" data-pk="${esc(msg.pubkey)}">Accept</button>` : ''}
      `;
      if (canAccept) {
        el.querySelector('.cp-msg-accept-btn')!.addEventListener('click', async (e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.disabled = true; btn.textContent = 'Sending…';
          try {
            const currentCrew = await (await import('../nostr/crewService')).fetchCrew(crew.id) ?? crew;
            const wasKicked = (currentCrew.kickedPubkeys ?? []).includes(msg.pubkey);
            if (wasKicked) await unKickCrewMember(crew.id, msg.pubkey);
            const inviteToken = Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2,'0')).join('');
            await sendDirectMessage(msg.pubkey, `nd-invite:${crew.id}:${crew.name}:${inviteToken}`);
            btn.textContent = 'Invited ✓';
            setTimeout(() => el.remove(), 1500);
          } catch { btn.textContent = 'Failed'; btn.disabled = false; }
        });
      }
      this.chatMsgEl.appendChild(el);
      return;
    }

    const isOwn = msg.pubkey === myPubkey;
    const name = this.getDisplayName(msg.pubkey, myPubkey);
    const t = msg.content.trim();
    const isGif = isGifUrl(t);
    const isLink = !isGif && isPlainUrl(t);

    el.className = 'cp-msg ' + (isOwn ? 'cp-msg-own' : 'cp-msg-other');
    el.innerHTML = `
      <div class="cp-msg-name" data-pk="${esc(msg.pubkey)}">${esc(name)}</div>
      ${isGif
        ? `<img src="${gifSrcAttr(t)}" style="max-width:200px;max-height:160px;border-radius:6px;display:block;cursor:pointer;${isOwn ? 'margin-left:auto;' : ''}" loading="lazy" onerror="this.style.display='none'" onclick="window.open(this.src,'_blank')">`
        : `<div class="cp-msg-bubble"></div>`}
      <div class="cp-msg-time">${timeAgo(msg.createdAt)}</div>
    `;

    if (!isGif) {
      const bubble = el.querySelector('.cp-msg-bubble')!;
      if (isLink) {
        bubble.appendChild(renderLinkWithPreview(t, isOwn));
      } else {
        bubble.innerHTML = renderEmojis(esc(msg.content), msg.emojis);
      }
    }

    this.chatMsgEl.appendChild(el);
  }

  private grayOutJoinRequest(el: HTMLElement): void {
    el.style.opacity = '0.4';
    el.style.pointerEvents = 'none';
    const btn = el.querySelector('.cp-msg-accept-btn') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Joined'; }
  }

  private scrollChat(): void {
    if (this.chatMsgEl) this.chatMsgEl.scrollTop = this.chatMsgEl.scrollHeight;
  }

  private doSendChat(): void {
    if (!this.inputEl || !this.activeCrew) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    const { pubkey: myPubkey } = authStore.getState();
    // Optimistic: show immediately with a temp ID
    const tempId = 'opt_' + Math.random().toString(36).slice(2);
    const optimistic: CrewChatMessage = { id: tempId, pubkey: myPubkey!, content: text, createdAt: Math.floor(Date.now() / 1000) };
    this.chatMessages.push(optimistic);
    this.appendChatMessage(optimistic, myPubkey);
    this.scrollChat();
    // Publish — when relay echoes back, dedupe by matching pubkey+content within 10s
    sendCrewChat(this.activeCrew.id, text).catch(e => console.warn('[Crews] send failed:', e));
  }

  // ── Announcements ──────────────────────────────────────────────────────────

  private renderPostContent(content: string): string {
    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?[^\s]*)?$/i;
    const IMAGE_HOSTS = /^https?:\/\/(i\.nostr\.build|nostr\.build|void\.cat|image\.nostr\.build|cdn\.satellite\.earth|files\.fm|media\.tenor\.com|i\.imgur\.com|imgur\.com\/[a-zA-Z0-9]+\.(jpg|jpeg|png|gif|webp)|nostrcheck\.me|imgprxy\.de)/i;
    const lines = content.split('\n');
    return lines.map(line => {
      const trimmed = line.trim();
      try {
        const url = new URL(trimmed);
        if (IMAGE_EXT.test(url.pathname) || IMAGE_HOSTS.test(trimmed)) {
          const safe = trimmed.replace(/"/g, '%22');
          return `<img src="${safe}" class="cp-post-img" alt="" loading="lazy" onerror="this.style.display='none'" />`;
        }
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          return `<a href="${trimmed.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer" class="cp-post-link">${esc(trimmed)}</a>`;
        }
      } catch { /* not a URL */ }
      return esc(line);
    }).join('<br>');
  }

  private renderAnnouncements(el: HTMLElement): void {
    if (!this.activeCrew) return;
    const crew = this.activeCrew;
    const state = authStore.getState();
    const isFounder = crew.founderPubkey === state.pubkey;
    const canPost = isFounder || isCrewAdmin(crew.id, state.pubkey ?? '');

    el.innerHTML = '<div class="cp-loading">Loading posts…</div>';

    fetchCrewAnnouncements(crew.id, crew.founderPubkey).then(posts => {
      if (!this.activeCrew || this.activeCrew.id !== crew.id || this.activeCrewTab !== 'announcements') return;
      el.innerHTML = '';

      if (canPost) {
        const composer = document.createElement('div');
        composer.className = 'cp-composer';
        composer.innerHTML = `
          <textarea class="cp-composer-input" placeholder="Write an announcement… (paste image to attach)" rows="3" maxlength="2000"></textarea>
          <div class="cp-composer-actions">
            <button class="cp-composer-btn">Post</button>
          </div>
          <div class="cp-composer-status"></div>
        `;
        const ta = composer.querySelector('.cp-composer-input') as HTMLTextAreaElement;
        const status = composer.querySelector('.cp-composer-status') as HTMLElement;
        ta.addEventListener('keydown', e => e.stopPropagation());

        // Upload a blob to nostr.build and append the URL to the textarea
        const uploadBlob = async (blob: Blob) => {
          status.textContent = 'Uploading image…';
          const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
          const form = new FormData();
          form.append('fileToUpload', new File([blob], `paste.${ext}`, { type: blob.type }));
          const res = await fetch('https://nostr.build/api/v2/upload/files', { method: 'POST', body: form });
          const json = await res.json();
          const url: string = json?.data?.[0]?.url ?? '';
          if (!url) throw new Error('No URL in response');
          ta.value = ta.value ? `${ta.value}\n${url}` : url;
          status.textContent = '';
        };

        const IMAGE_URL_RE = /^https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|avif|svg)(\?\S*)?$/i;

        const appendImageUrl = (url: string) => {
          ta.value = ta.value ? `${ta.value}\n${url}` : url;
        };

        // Clipboard paste — handles binary data, copied web images, and Universal Clipboard
        ta.addEventListener('paste', async (e) => {
          const items = Array.from(e.clipboardData?.items ?? []);

          // 1. Binary image file (screenshot, Universal Clipboard direct paste)
          const fileItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
          if (fileItem) {
            e.preventDefault();
            const file = fileItem.getAsFile();
            if (!file) return;
            try { await uploadBlob(file); }
            catch { status.textContent = 'Upload failed. Paste a URL manually.'; setTimeout(() => { status.textContent = ''; }, 3000); }
            return;
          }

          // 2. HTML clipboard (copy image from webpage — Google Images, etc.)
          const html = e.clipboardData?.getData('text/html') ?? '';
          if (html) {
            const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
            const src = match?.[1];
            if (src && src.startsWith('http') && !src.startsWith('data:')) {
              e.preventDefault();
              appendImageUrl(src);
              return;
            }
          }

          // 3. Plain text that is an image URL
          const text = e.clipboardData?.getData('text/plain').trim() ?? '';
          if (IMAGE_URL_RE.test(text)) {
            e.preventDefault();
            appendImageUrl(text);
            return;
          }

          // 4. Fallback: Clipboard API — Universal Clipboard from iPhone/iPad
          if (!fileItem) {
            try {
              const clipItems = await navigator.clipboard.read();
              for (const clipItem of clipItems) {
                const imageType = clipItem.types.find(t => t.startsWith('image/'));
                if (imageType) {
                  e.preventDefault();
                  const blob = await clipItem.getType(imageType);
                  try { await uploadBlob(blob); }
                  catch { status.textContent = 'Upload failed. Paste a URL manually.'; setTimeout(() => { status.textContent = ''; }, 3000); }
                  return;
                }
              }
            } catch { /* permission denied — let default paste run */ }
          }
        });

        composer.querySelector('.cp-composer-btn')!.addEventListener('click', async () => {
          const content = ta.value.trim();
          if (!content) return;
          const btn = composer.querySelector('.cp-composer-btn') as HTMLButtonElement;
          btn.disabled = true; btn.textContent = 'Posting…';
          try {
            await postCrewAnnouncement(crew.id, content);
            ta.value = '';
            status.textContent = 'Posted!';
            setTimeout(() => { status.textContent = ''; btn.textContent = 'Post'; btn.disabled = false; }, 1500);
            this.renderAnnouncements(el);
          } catch {
            status.textContent = 'Failed to post.';
            btn.textContent = 'Post'; btn.disabled = false;
          }
        });
        el.appendChild(composer);
      }

      if (posts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cp-empty';
        empty.textContent = canPost ? 'No posts yet. Write the first one!' : 'No announcements yet.';
        el.appendChild(empty);
        return;
      }

      resolveNames(posts.map(p => p.pubkey)).then(() => {
        posts.forEach(post => {
          const canDelete = post.pubkey === state.pubkey || canPost;
          // Separate text lines from image URLs for preview truncation
          const IMAGE_LINE = /^https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|avif|svg)(\?\S*)?$/i;
          const textOnly = post.content.split('\n').filter(l => !IMAGE_LINE.test(l.trim())).join('\n');
          const hasImages = post.content.split('\n').some(l => IMAGE_LINE.test(l.trim()));
          const isLong = textOnly.length > 180;
          const previewText = isLong ? textOnly.slice(0, 180).trimEnd() + '…' : textOnly;
          const previewContent = hasImages
            ? (previewText ? previewText + '\n' : '') + post.content.split('\n').filter(l => IMAGE_LINE.test(l.trim())).join('\n')
            : previewText;

          const card = document.createElement('div');
          card.className = 'cp-post-card';
          card.style.cursor = isLong ? 'pointer' : 'default';
          card.innerHTML = `
            <div class="cp-post-meta">
              <span>${esc(getCachedName(post.pubkey))} · ${timeAgo(post.createdAt)}</span>
              ${canDelete ? `<button class="cp-post-del" title="Delete post" data-id="${esc(post.id)}">✕</button>` : ''}
            </div>
            <div class="cp-post-content">${this.renderPostContent(previewContent)}</div>
            ${isLong ? `<div class="cp-post-readmore">Read more</div>` : ''}
          `;

          if (isLong) {
            card.addEventListener('click', (e) => {
              if ((e.target as HTMLElement).closest('.cp-post-del')) return;
              this.showPostExpanded(post.content, getCachedName(post.pubkey), post.createdAt);
            });
          }

          if (canDelete) {
            card.querySelector('.cp-post-del')!.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (!confirm('Delete this post?')) return;
              try {
                await deleteCrewAnnouncement(post.id);
                card.remove();
              } catch {
                alert('Failed to delete post.');
              }
            });
          }

          el.appendChild(card);
        });
      });
    }).catch(() => {
      el.innerHTML = '<div class="cp-empty">Could not load posts.</div>';
    });
  }

  private showManageModal(crew: Crew): void {
    const { pubkey: myPubkey } = authStore.getState();
    const isFounder = crew.founderPubkey === myPubkey;
    const isAdmin = myPubkey ? isCrewAdmin(crew.id, myPubkey) : false;
    const canInvite = isFounder || isAdmin;

    const overlay = document.createElement('div');
    overlay.className = 'cp-modal-overlay';
    overlay.innerHTML = `
      <div class="cp-modal cp-manage-modal">
        <div class="cp-modal-title">Manage Crew</div>

        <div class="cp-manage-members-label">Members</div>
        <div class="cp-manage-member-list cp-loading" style="padding:12px 0">Loading members…</div>

        <div class="cp-manage-invite-section">
          <div class="cp-manage-members-label" style="margin-top:14px">Invite by npub</div>
          <div class="cp-manage-invite-row">
            <input class="cp-manage-invite-input" type="text" placeholder="npub1… or hex pubkey" maxlength="120" />
            <button class="cp-manage-invite-btn">Send Invite</button>
          </div>
          <div class="cp-manage-invite-status"></div>
        </div>

        ${isFounder ? `
        <div class="cp-manage-edit-section">
          <button class="cp-manage-edit-toggle">Edit Crew ▸</button>
          <div class="cp-manage-edit-body" style="display:none">
          <div class="cp-manage-edit-fields">
            <input class="cp-manage-edit-input" id="cme-name" type="text" maxlength="40" placeholder="Crew name" value="${esc(crew.name)}" />
            <input class="cp-manage-edit-input" id="cme-about" type="text" maxlength="120" placeholder="About" value="${esc(crew.about ?? '')}" />
            <label class="cp-modal-label cp-toggle-label" style="flex-direction:row;align-items:center;gap:10px;cursor:pointer;margin-top:2px">
              <span class="cp-toggle"><input type="checkbox" id="cme-open" ${crew.isOpen ? 'checked' : ''} /><span class="cp-toggle-track"></span></span>
              <span style="font-size:12px;color:var(--nd-subtext)">Open crew (anyone can join)</span>
            </label>
          </div>
          <div class="cp-manage-edit-emblem-row">
            <div class="cp-modal-emblem-preview" id="cme-preview" style="${crew.emblem.startsWith('http') ? 'background:transparent;border-color:color-mix(in srgb,var(--nd-text) 15%,transparent);overflow:hidden;padding:0' : `background:${esc(crew.color)}22;border-color:${esc(crew.color)}55;color:${esc(crew.color)}`}">${crew.emblem.startsWith('http') ? `<img src="${esc(crew.emblem)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;display:block" />` : renderEmojis(esc(crew.emblem), crew.emblemEmojis)}</div>
            <div class="cp-manage-members-label" style="margin:0;font-size:10px">Emblem</div>
          </div>
          <div class="cp-emoji-grid" id="cme-emojis">
            ${['⚡','🔥','💀','🌙','🐉','🦊','🌊','🎯','💎','🛸','🎮','🗡','🏴'].map(e => `<button class="cp-emoji-btn${e === crew.emblem ? ' active' : ''}" data-emoji="${e}">${e}</button>`).join('')}
          </div>
          <div class="cp-emblem-custom-row" style="margin-top:6px">
            <input class="cp-modal-input" id="cme-custom-emblem" type="text" maxlength="300" placeholder="Custom emoji or https://…" value="${crew.emblem.startsWith('http') || !['⚡','🔥','💀','🌙','🐉','🦊','🌊','🎯','💎','🛸','🎮','🗡','🏴'].includes(crew.emblem) ? esc(crew.emblem) : ''}" />
          </div>
          <div class="cp-manage-members-label" style="margin-top:10px;font-size:10px">Color</div>
          <div class="cp-color-grid" id="cme-colors">
            ${['#5dcaa5','#e87aab','#f0b040','#7b68ee','#00e5ff','#aaff44','#ff7020','#e85454','#c8b8e8','#ffffff'].map(c => `<button class="cp-color-btn${c === crew.color ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
          </div>
          <button class="cp-manage-edit-save">Save Changes</button>
          <div class="cp-manage-edit-status"></div>
          </div>
        </div>
        <div class="cp-manage-danger">
          <div class="cp-manage-danger-label">Danger Zone</div>
          <button class="cp-manage-delete-btn">Delete Crew</button>
        </div>` : ''}
      </div>
    `;
    const closeManage = () => overlay.remove();
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { closeManage(); } e.stopPropagation(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) closeManage(); });

    // Invite
    const inviteInput = overlay.querySelector('.cp-manage-invite-input') as HTMLInputElement;
    const inviteBtn = overlay.querySelector('.cp-manage-invite-btn') as HTMLButtonElement;
    const inviteStatus = overlay.querySelector('.cp-manage-invite-status') as HTMLElement;
    inviteInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inviteBtn.click(); });
    inviteBtn.addEventListener('click', async () => {
      const raw = inviteInput.value.trim();
      if (!raw) return;
      inviteBtn.disabled = true; inviteStatus.textContent = 'Sending…';
      try {
        let targetPubkey = raw;
        if (raw.startsWith('npub1')) {
          const { nip19 } = await import('nostr-tools');
          const decoded = nip19.decode(raw);
          if (decoded.type !== 'npub') throw new Error('Invalid npub');
          targetPubkey = decoded.data as string;
        }
        // If this person was previously kicked, remove them from the kicked list first
        const currentCrew = (await import('../nostr/crewService').then(m => m.fetchCrew(crew.id))) ?? crew;
        const wasKicked = (currentCrew.kickedPubkeys ?? []).includes(targetPubkey);
        if (wasKicked) {
          await unKickCrewMember(crew.id, targetPubkey);
        }
        const token = Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2,'0')).join('');
        const msg = `nd-invite:${crew.id}:${crew.name}:${token}`;
        await sendDirectMessage(targetPubkey, msg);
        inviteInput.value = '';
        inviteStatus.style.color = 'var(--nd-accent)';
        inviteStatus.textContent = 'Invite sent!';
        if (wasKicked) renderMemberList();
        setTimeout(() => { inviteStatus.textContent = ''; inviteBtn.disabled = false; }, 2000);
      } catch (e: any) {
        inviteStatus.style.color = '#e85454';
        inviteStatus.textContent = e?.message ?? 'Failed to send invite.';
        inviteBtn.disabled = false;
      }
    });

    // Delete (founder only)
    if (isFounder) {
      overlay.querySelector('.cp-manage-delete-btn')!.addEventListener('click', async () => {
        if (!confirm(`Delete "${crew.name}"? All members will be notified and the crew will be permanently gone. This cannot be undone.`)) return;
        const btn = overlay.querySelector('.cp-manage-delete-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        // Start deleteCrew first — local cleanup runs synchronously before its first await,
        // so by the time backToList → fetchMyCrews runs, localStorage is already clean.
        this.allCrews = this.allCrews.filter(c => c.id !== crew.id);
        deleteCrew(crew.id).catch(e => console.warn('[Crews] deleteCrew relay error:', e));
        closeManage();
        this.backToList();
      });
    }

    // Edit crew section (founder only)
    if (isFounder) {
      const editToggle = overlay.querySelector('.cp-manage-edit-toggle') as HTMLButtonElement;
      const editBody = overlay.querySelector('.cp-manage-edit-body') as HTMLElement;
      editToggle.addEventListener('click', () => {
        const open = editBody.style.display !== 'none';
        editBody.style.display = open ? 'none' : 'block';
        editToggle.textContent = open ? 'Edit Crew ▸' : 'Edit Crew ▾';
      });

      const PRESET_EMOJIS = ['⚡','🔥','💀','🌙','🐉','🦊','🌊','🎯','💎','🛸','🎮','🗡','🏴'];
      let editEmblem = crew.emblem;
      let editColor = crew.color;
      const editPreview = overlay.querySelector('#cme-preview') as HTMLElement;

      const refreshEditPreview = () => {
        if (editEmblem.startsWith('http')) {
          editPreview.style.cssText = 'background:transparent;border-color:color-mix(in srgb,var(--nd-text) 15%,transparent);overflow:hidden;padding:0;';
          editPreview.innerHTML = `<img src="${safeUrl(editEmblem)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;display:block" onerror="this.parentElement.textContent='?'" />`;
        } else {
          editPreview.style.cssText = `background:${editColor}22;border-color:${editColor}55;color:${editColor};`;
          editPreview.innerHTML = renderEmojis(esc(editEmblem));
        }
      };

      overlay.querySelectorAll('#cme-emojis .cp-emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          editEmblem = (btn as HTMLElement).dataset.emoji!;
          overlay.querySelectorAll('#cme-emojis .cp-emoji-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          (overlay.querySelector('#cme-custom-emblem') as HTMLInputElement).value = '';
          refreshEditPreview();
        });
      });

      const editEmblemInput = overlay.querySelector('#cme-custom-emblem') as HTMLInputElement;
      const editStatus = overlay.querySelector('.cp-manage-edit-status') as HTMLElement;

      editEmblemInput.addEventListener('input', () => {
        const v = editEmblemInput.value.trim();
        if (!v) { editStatus.textContent = ''; return; }
        const isUrl = v.startsWith('http://') || v.startsWith('https://');
        const isShortEmoji = !isUrl && v.length <= 10;
        if (!isUrl && !isShortEmoji) {
          editStatus.style.color = '#e85454';
          editStatus.textContent = 'Emblem must be a single emoji or an image URL (https://…)';
          return;
        }
        editStatus.textContent = '';
        editEmblem = v;
        overlay.querySelectorAll('#cme-emojis .cp-emoji-btn').forEach(b => b.classList.remove('active'));
        refreshEditPreview();
      });

      overlay.querySelectorAll('#cme-colors .cp-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          editColor = (btn as HTMLElement).dataset.color!;
          overlay.querySelectorAll('#cme-colors .cp-color-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          refreshEditPreview();
        });
      });

      const editSaveBtn = overlay.querySelector('.cp-manage-edit-save') as HTMLButtonElement;
      editSaveBtn.addEventListener('click', async () => {
        const name = (overlay.querySelector('#cme-name') as HTMLInputElement).value.trim();
        const about = (overlay.querySelector('#cme-about') as HTMLInputElement).value.trim();
        const isOpenChecked = (overlay.querySelector('#cme-open') as HTMLInputElement).checked;
        if (!name) { editStatus.style.color = '#e85454'; editStatus.textContent = 'Name required.'; return; }
        editSaveBtn.disabled = true; editSaveBtn.textContent = 'Saving…';
        try {
          await updateCrewDefinition(crew.id, { name, about, emblem: editEmblem, color: editColor, isOpen: isOpenChecked });
          // Patch local crew reference so the panel header re-renders correctly
          crew.name = name; crew.about = about; crew.emblem = editEmblem; crew.color = editColor; crew.isOpen = isOpenChecked;
          editStatus.style.color = 'var(--nd-accent)'; editStatus.textContent = 'Saved!';
          editSaveBtn.textContent = 'Save Changes';
          editSaveBtn.disabled = false;
          setTimeout(() => { editStatus.textContent = ''; }, 2000);
          this.render(); // refresh header in chat view
        } catch (e: any) {
          editStatus.style.color = '#e85454'; editStatus.textContent = e?.message ?? 'Failed.';
          editSaveBtn.textContent = 'Save Changes'; editSaveBtn.disabled = false;
        }
      });
    }

    // Load members
    const listEl = overlay.querySelector('.cp-manage-member-list') as HTMLElement;

    const renderMemberList = () => {
      listEl.innerHTML = '<span style="padding:12px 0;color:var(--nd-subtext);font-size:12px">Loading members…</span>';
      fetchCrewMembers(crew.id).then(members => {
        resolveNames(members.map(m => m.pubkey)).then(() => {
          listEl.innerHTML = '';
          listEl.classList.remove('cp-loading');
          members.sort((a, b) => a.role === 'founder' ? -1 : b.role === 'founder' ? 1 : 0);
          members.forEach(member => {
            const row = document.createElement('div');
            row.className = 'cp-manage-member-row';
            if (member.role === 'founder') {
              const founderCurrentTitle = crew.founderTitle ?? '';
              row.innerHTML = `
                <span class="cp-manage-mname">${esc(getCachedName(member.pubkey))}</span>
                <div class="cp-manage-mcontrols">
                  ${isFounder ? `
                    <input class="cp-manage-title-input cp-founder-title-input" type="text" maxlength="24" placeholder="Founder" value="${esc(founderCurrentTitle)}" style="width:110px" />
                    <button class="cp-manage-save-btn cp-founder-title-save">Save</button>
                  ` : `<span class="cp-manage-mrole" style="color:var(--nd-accent)">${esc(crew.founderTitle || 'Founder')}</span>`}
                </div>`;
              if (isFounder) {
                const ftSave = row.querySelector('.cp-founder-title-save') as HTMLButtonElement;
                ftSave.addEventListener('click', async () => {
                  const val = (row.querySelector('.cp-founder-title-input') as HTMLInputElement).value.trim();
                  ftSave.disabled = true; ftSave.textContent = '…';
                  try {
                    await updateCrewDefinition(crew.id, { founderTitle: val || undefined });
                    ftSave.textContent = 'Saved';
                    setTimeout(() => { ftSave.textContent = 'Save'; ftSave.disabled = false; }, 1200);
                  } catch { ftSave.textContent = 'Save'; ftSave.disabled = false; }
                });
              }
              listEl.appendChild(row);
              return;
            }
            const currentTitle = member.title ?? '';
            row.innerHTML = `
              <span class="cp-manage-mname">${esc(getCachedName(member.pubkey))}</span>
              <div class="cp-manage-mcontrols">
                ${isFounder ? `
                <select class="cp-manage-role-sel">
                  <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
                  <option value="officer" ${member.role === 'officer' ? 'selected' : ''}>Officer</option>
                  <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
                </select>
                <input class="cp-manage-title-input" type="text" maxlength="24" placeholder="Custom title…" value="${esc(currentTitle)}" />
                <button class="cp-manage-save-btn">Save</button>` : isAdmin && member.role !== 'admin' ? `
                <select class="cp-manage-role-sel">
                  <option value="officer" ${member.role === 'officer' ? 'selected' : ''}>Officer</option>
                  <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
                </select>
                <button class="cp-manage-save-btn">Save</button>` : `<span class="cp-manage-mrole">${esc(currentTitle || (member.role === 'admin' ? 'Admin' : member.role === 'officer' ? 'Officer' : 'Member'))}</span>`}
                ${member.pubkey !== myPubkey && (isFounder ? true : (isAdmin && (member.role === 'member' || member.role === 'officer'))) ? `<button class="cp-manage-kick-btn" title="Kick member">Kick</button>` : ''}
              </div>
            `;

            if (isFounder || (isAdmin && member.role !== 'admin')) {
              const saveBtn = row.querySelector('.cp-manage-save-btn') as HTMLButtonElement;
              saveBtn.addEventListener('click', async () => {
                const sel = row.querySelector('.cp-manage-role-sel') as HTMLSelectElement;
                const ti = row.querySelector('.cp-manage-title-input') as HTMLInputElement;
                saveBtn.disabled = true; saveBtn.textContent = '…';
                try {
                  await updateCrewMember(crew.id, member.pubkey, sel.value as 'admin' | 'officer' | 'member', ti?.value);
                  saveBtn.textContent = 'Saved';
                  setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }, 1200);
                } catch { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }
              });
            }

            const kickBtn = row.querySelector('.cp-manage-kick-btn') as HTMLButtonElement;
            kickBtn.addEventListener('click', async () => {
              if (!confirm(`Kick ${getCachedName(member.pubkey)} from the crew?`)) return;
              kickBtn.disabled = true;
              try {
                await kickCrewMember(crew.id, member.pubkey);
                row.remove();
              } catch { kickBtn.disabled = false; alert('Failed to kick member.'); }
            });

            listEl.appendChild(row);
          });
          if (!members.length) listEl.innerHTML = '<div style="color:var(--nd-subtext);font-size:12px;padding:8px 0">No members found.</div>';

          // Show kicked members at the bottom (founder only — only founder can unkick)
          if (isFounder) {
            const kickedPubkeys = crew.kickedPubkeys ?? [];
            if (kickedPubkeys.length) {
              resolveNames(kickedPubkeys).then(() => {
                const sep = document.createElement('div');
                sep.style.cssText = 'font-size:10px;font-weight:bold;letter-spacing:.08em;color:color-mix(in srgb,#e85454 60%,transparent);text-transform:uppercase;margin:14px 0 6px';
                sep.textContent = 'Kicked';
                listEl.appendChild(sep);
                kickedPubkeys.forEach(pk => {
                  const krow = document.createElement('div');
                  krow.className = 'cp-manage-member-row';
                  krow.style.opacity = '0.7';
                  krow.innerHTML = `
                    <span class="cp-manage-mname">${esc(getCachedName(pk))}</span>
                    <div class="cp-manage-mcontrols">
                      <button class="cp-manage-save-btn" style="border-color:color-mix(in srgb,#4cff91 40%,transparent);color:#4cff91;background:color-mix(in srgb,#4cff91 10%,transparent)">Unkick</button>
                    </div>
                  `;
                  krow.querySelector('button')!.addEventListener('click', async (e) => {
                    const btn = e.currentTarget as HTMLButtonElement;
                    btn.disabled = true; btn.textContent = '…';
                    try {
                      await unKickCrewMember(crew.id, pk);
                      krow.remove();
                      if (!listEl.querySelector('[style*="Kicked"]') && !listEl.querySelector('.cp-manage-member-row[style*="0.7"]')) sep.remove();
                    } catch { btn.disabled = false; btn.textContent = 'Unkick'; }
                  });
                  listEl.appendChild(krow);
                });
              });
            }
          }
        });
      }).catch(() => { listEl.innerHTML = '<div style="color:var(--nd-subtext);font-size:12px">Could not load members.</div>'; });
    };

    renderMemberList();
  }

  private showPostExpanded(content: string, authorName: string, createdAt: number): void {
    const overlay = document.createElement('div');
    overlay.className = 'cp-modal-overlay';
    overlay.innerHTML = `
      <div class="cp-modal cp-post-modal">
        <div class="cp-post-modal-meta">${esc(authorName)} · ${timeAgo(createdAt)}</div>
        <div class="cp-post-modal-content">${this.renderPostContent(content)}</div>
        <div class="cp-modal-actions" style="margin-top:16px">
          <button class="cp-modal-cancel">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.cp-modal-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); e.stopPropagation(); });
  }

  // ── Members ────────────────────────────────────────────────────────────────

  private renderMembers(el: HTMLElement): void {
    if (!this.activeCrew) return;
    const crew = this.activeCrew;
    el.innerHTML = '<div class="cp-loading">Loading members…</div>';

    let onlinePubkeys = new Set<string>();

    const buildList = (members: import('../nostr/crewService').CrewMember[]) => {
      if (!this.activeCrew || this.activeCrew.id !== crew.id || this.activeCrewTab !== 'members') return;
      el.innerHTML = '';
      if (members.length === 0) { el.innerHTML = '<div class="cp-empty">No members found.</div>'; return; }

      resolveNames(members.map(m => m.pubkey)).then(() => {
        members.sort((a, b) => {
          if (a.role === 'founder') return -1;
          if (b.role === 'founder') return 1;
          const aOn = onlinePubkeys.has(a.pubkey) ? 0 : 1;
          const bOn = onlinePubkeys.has(b.pubkey) ? 0 : 1;
          return aOn - bOn;
        });
        el.innerHTML = '';
        members.forEach(member => {
          const name = getCachedName(member.pubkey);
          const isOnline = onlinePubkeys.has(member.pubkey);
          const roleLabel = member.role === 'founder' ? (crew.founderTitle || 'Founder') : member.role === 'admin' ? (member.title ?? 'Admin') : member.role === 'officer' ? (member.title ?? 'Officer') : (member.title ?? 'Member');
          const row = document.createElement('div');
          row.className = 'cp-member-row';
          row.innerHTML = `
            <div style="position:relative;flex-shrink:0">
              <div class="cp-member-avatar" data-pk="${esc(member.pubkey)}" style="background:${esc(crew.color)}22;color:${esc(crew.color)}">${esc(name[0].toUpperCase())}</div>
              <span class="cp-member-dot ${isOnline ? 'cp-dot-on' : 'cp-dot-off'}"></span>
            </div>
            <div class="cp-member-info">
              <div class="cp-member-name cp-member-name-link" data-pk="${esc(member.pubkey)}">${esc(name)}</div>
              <div class="cp-member-role">${esc(roleLabel)}</div>
            </div>
          `;
          row.querySelector('.cp-member-name-link')!.addEventListener('click', () => ProfileModal.show(member.pubkey, name));
          const avatarEl = row.querySelector('.cp-member-avatar') as HTMLElement;
          fetchProfile(member.pubkey).then(p => {
            if (p?.picture) avatarEl.innerHTML = `<img src="${esc(p.picture)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${esc(name[0].toUpperCase())}'" loading="lazy">`;
          }).catch(() => {});
          el.appendChild(row);
        });
      });
    };

    fetchCrewMembers(crew.id).then(members => {
      if (!this.activeCrew || this.activeCrew.id !== crew.id) return;

      // Always treat the logged-in user as online — presence server won't echo you back to yourself
      const myPubkey = authStore.getState().pubkey;
      if (myPubkey) onlinePubkeys.add(myPubkey);

      // Request online players — handler fires when presence server responds
      setOnlinePlayersHandler((players) => {
        onlinePubkeys = new Set(players.map((p: any) => p.pubkey));
        if (myPubkey) onlinePubkeys.add(myPubkey); // keep self marked online
        setOnlinePlayersHandler(null); // one-shot
        buildList(members);
      });
      requestOnlinePlayers();

      // Also render immediately with whatever we have (offline dots until response)
      buildList(members);
    }).catch(() => {
      el.innerHTML = '<div class="cp-empty">Could not load members.</div>';
    });
  }

  // ══════════════════════════════════════════
  // CREATE MODAL
  // ══════════════════════════════════════════

  private showCreateModal(): void {
    const state = authStore.getState();
    if (!state.pubkey || state.loginMethod === 'guest') { alert('Please log in to create a crew.'); return; }

    const EMOJIS = ['⚡','🔥','💀','🌙','🐉','🦊','🌊','🎯','💎','🛸','🎮','🗡','🏴'];
    const COLORS = ['#5dcaa5','#e87aab','#f0b040','#7b68ee','#00e5ff','#aaff44','#ff7020','#e85454','#c8b8e8','#ffffff'];

    let selEmoji = '⚡';
    let selColor = '#5dcaa5';

    const modal = document.createElement('div');
    modal.className = 'cp-modal-overlay';
    modal.innerHTML = `
      <div class="cp-modal">
        <div class="cp-modal-title">Create a Crew</div>

        <div class="cp-modal-preview">
          <div class="cp-modal-emblem-preview" id="cpm-preview" style="background:${selColor}22;border-color:${selColor}55;color:${selColor}">${renderEmojis(esc(selEmoji))}</div>
          <input class="cp-modal-input" id="cpm-name" type="text" maxlength="40" placeholder="Crew name" />
        </div>

        <label class="cp-modal-label">About</label>
        <input class="cp-modal-input" id="cpm-about" type="text" maxlength="120" placeholder="Short description" />

        <label class="cp-modal-label">Emblem</label>
        <div class="cp-emoji-grid" id="cpm-emojis">
          ${EMOJIS.map(e => `<button class="cp-emoji-btn${e === selEmoji ? ' active' : ''}" data-emoji="${e}">${e}</button>`).join('')}
        </div>
        <div class="cp-emblem-custom-row">
          <input class="cp-modal-input" id="cpm-custom-emblem" type="text" maxlength="300" placeholder="Custom emoji or https://…" />
        </div>

        <label class="cp-modal-label">Color</label>
        <div class="cp-color-grid" id="cpm-colors">
          ${COLORS.map(c => `<button class="cp-color-btn${c === selColor ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        </div>

        <label class="cp-modal-label cp-toggle-label" style="flex-direction:row;align-items:center;gap:10px;cursor:pointer">
          <span class="cp-toggle"><input type="checkbox" id="cpm-open" checked /><span class="cp-toggle-track"></span></span>
          Open crew (anyone can join)
        </label>

        <div class="cp-modal-actions">
          <button class="cp-modal-cancel">Cancel</button>
          <button class="cp-modal-submit">Create Crew</button>
        </div>
        <div class="cp-modal-status"></div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') modal.remove(); e.stopPropagation(); });
    modal.addEventListener('keyup', e => e.stopPropagation());
    setTimeout(() => (modal.querySelector('#cpm-name') as HTMLInputElement)?.focus(), 50);

    const preview = modal.querySelector('#cpm-preview') as HTMLElement;
    const isImgUrl = (s: string) => s.startsWith('http');
    const updatePreview = () => {
      if (isImgUrl(selEmoji)) {
        preview.style.cssText = `background:transparent;border-color:color-mix(in srgb,var(--nd-text) 20%,transparent);overflow:hidden;padding:0;`;
        preview.innerHTML = `<img src="${safeUrl(selEmoji)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;display:block" onerror="this.parentElement.textContent='?'" />`;
      } else {
        preview.style.cssText = `background:${selColor}22;border-color:${selColor}55;color:${selColor};`;
        preview.innerHTML = renderEmojis(esc(selEmoji));
      }
    };

    modal.querySelectorAll('.cp-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selEmoji = (btn as HTMLElement).dataset.emoji!;
        modal.querySelectorAll('.cp-emoji-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        (modal.querySelector('#cpm-custom-emblem') as HTMLInputElement).value = '';
        updatePreview();
      });
    });

    const customEmblemInput = modal.querySelector('#cpm-custom-emblem') as HTMLInputElement;
    const emblemStatus = modal.querySelector('.cp-modal-status') as HTMLElement;

    customEmblemInput.addEventListener('input', () => {
      const val = customEmblemInput.value.trim();
      if (!val) { emblemStatus.textContent = ''; return; }
      const isUrl = val.startsWith('http://') || val.startsWith('https://');
      const isShortEmoji = !isUrl && val.length <= 10;
      if (!isUrl && !isShortEmoji) {
        emblemStatus.textContent = 'Emblem must be a single emoji or an image URL (https://…)';
        return;
      }
      emblemStatus.textContent = '';
      selEmoji = val;
      modal.querySelectorAll('.cp-emoji-btn').forEach(b => b.classList.remove('active'));
      updatePreview();
    });

    modal.querySelectorAll('.cp-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selColor = (btn as HTMLElement).dataset.color!;
        modal.querySelectorAll('.cp-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updatePreview();
      });
    });

    modal.querySelector('.cp-modal-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    modal.querySelector('.cp-modal-submit')!.addEventListener('click', async () => {
      const name  = (modal.querySelector('#cpm-name') as HTMLInputElement).value.trim();
      const about = (modal.querySelector('#cpm-about') as HTMLInputElement).value.trim();
      const isOpen = (modal.querySelector('#cpm-open') as HTMLInputElement).checked;
      const statusEl = modal.querySelector('.cp-modal-status') as HTMLElement;
      if (!name) { statusEl.textContent = 'Crew name required.'; return; }

      const btn = modal.querySelector('.cp-modal-submit') as HTMLButtonElement;
      btn.disabled = true; btn.textContent = 'Creating…';

      try {
        const id = await createCrew(name, about, selEmoji, selColor, isOpen);
        modal.remove();
        const crew = await fetchCrew(id);
        this.allCrews = []; // reset discover cache
        this.switchTab('mine');
        if (crew) this.openCrew(crew);
      } catch (err: any) {
        statusEl.textContent = err?.message ?? 'Failed to create crew.';
        btn.disabled = false; btn.textContent = 'Create Crew';
      }
    });
  }

  // ══════════════════════════════════════════
  // STYLES
  // ══════════════════════════════════════════

  private injectStyles(): void {
    if (document.getElementById('cp-styles')) return;
    const s = document.createElement('style');
    s.id = 'cp-styles';
    s.textContent = `
      .cp-panel {
        position: fixed; top: 0; right: -100vw; width: min(390px, 100vw); height: 100dvh;
        background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
        border-left: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        z-index: 2100; font-family: 'Courier New', monospace;
        display: flex; flex-direction: column;
        transition: right 0.25s ease; box-shadow: -4px 0 20px rgba(0,0,0,0.5);
      }
      .cp-panel.cp-open { right: 0 !important; }

      /* Header */
      .cp-header {
        display: flex; align-items: center; gap: 6px; padding: 14px 18px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        background: color-mix(in srgb, black 52%, var(--nd-bg));
        flex-shrink: 0;
      }
      .cp-tabs { display: flex; gap: 4px; flex: 1; }
      .cp-tab {
        background: transparent;
        border: 1px solid color-mix(in srgb,var(--nd-text) 18%,transparent);
        border-radius: 4px; color: var(--nd-subtext);
        cursor: pointer; padding: 4px 10px; font-size: 12px;
        font-family: inherit; transition: all 0.15s;
        -webkit-tap-highlight-color: transparent; outline: none;
      }
      .cp-tab.active, .cp-tab:hover, .cp-tab:active {
        background: color-mix(in srgb,var(--nd-accent) 15%,transparent);
        border-color: color-mix(in srgb,var(--nd-accent) 55%,transparent);
        color: var(--nd-accent);
      }
      .cp-create-btn, .cp-close-btn {
        background: none; border: none; color: var(--nd-subtext);
        font-size: 18px; cursor: pointer; padding: 4px 8px; transition: color 0.15s;
        font-family: inherit; -webkit-tap-highlight-color: transparent;
        outline: none;
      }
      .cp-create-btn:hover, .cp-create-btn:active { color: var(--nd-accent); }
      .cp-close-btn:hover, .cp-close-btn:active { color: var(--nd-text); }

      /* Body */
      .cp-body {
        flex: 1; overflow: hidden; display: flex; flex-direction: column;
        min-height: 0;
      }
      /* Scrollable list views (browse, manage) — don't apply to chat which handles its own scroll */
      .cp-body-scroll {
        flex: 1; overflow-y: auto; display: flex; flex-direction: column;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb,var(--nd-text) 18%,transparent) transparent;
      }

      /* Crew cards */
      .cp-crew-card {
        display: flex; align-items: center; gap: 12px;
        padding: 14px 18px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 7%,transparent);
        cursor: pointer; transition: background 0.15s; flex-shrink: 0;
      }
      .cp-crew-card:hover { background: color-mix(in srgb,var(--nd-text) 6%,transparent); }
      .cp-crew-emblem {
        width: 40px; height: 40px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        border: 1px solid; border-radius: 10px; font-size: 20px;
      }
      .cp-crew-body { flex: 1; min-width: 0; }
      .cp-crew-name { color: var(--nd-text); font-size: 13px; font-weight: bold; margin-bottom: 3px; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
      .cp-crew-about { color: var(--nd-subtext); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cp-crew-meta { flex-shrink: 0; }
      .cp-badge-joined {
        background: color-mix(in srgb,var(--nd-accent) 20%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 45%,transparent);
        color: var(--nd-accent); border-radius: 4px; padding: 2px 8px; font-size: 11px;
      }
      .cp-badge-open {
        background: color-mix(in srgb,var(--nd-text) 8%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-text) 18%,transparent);
        color: var(--nd-subtext); border-radius: 4px; padding: 2px 8px; font-size: 11px;
      }
      .cp-badge-closed {
        background: color-mix(in srgb,#f0a040 12%,transparent);
        border: 1px solid color-mix(in srgb,#f0a040 45%,transparent);
        color: #f0a040; border-radius: 4px; padding: 2px 8px; font-size: 11px;
      }
      .cp-badge-kicked {
        background: color-mix(in srgb,#e85454 12%,transparent);
        border: 1px solid color-mix(in srgb,#e85454 40%,transparent);
        color: #e85454; border-radius: 4px; padding: 2px 8px; font-size: 11px;
      }

      /* Detail header */
      .cp-detail-header {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 18px; flex-shrink: 0;
        background: color-mix(in srgb, black 35%, var(--nd-bg));
      }
      .cp-back-btn {
        background: none; border: none; color: var(--nd-accent);
        font-size: 13px; cursor: pointer; padding: 0; font-family: inherit; flex-shrink: 0;
      }
      .cp-back-btn:hover { color: var(--nd-text); }
      .cp-detail-emblem { font-size: 26px; flex-shrink: 0; }
      .cp-detail-title { flex: 1; min-width: 0; }
      .cp-detail-name { color: var(--nd-text); font-size: 14px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
      .cp-detail-sub { color: var(--nd-subtext); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cp-join-action {
        flex-shrink: 0; padding: 5px 12px; border-radius: 4px; font-family: inherit; font-size: 12px; cursor: pointer; transition: all 0.15s;
        background: color-mix(in srgb,var(--nd-accent) 15%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
        color: var(--nd-accent);
      }
      .cp-join-action.cp-leave { background: color-mix(in srgb,#e87aab 10%,transparent); border-color: color-mix(in srgb,#e87aab 35%,transparent); color:#e87aab; }
      .cp-join-action:disabled { opacity: 0.5; cursor: not-allowed; }
      .cp-manage-btn {
        flex-shrink: 0; background: none; cursor: pointer; font-family: inherit;
        font-size: 11px; padding: 4px 10px; border-radius: 4px; transition: all 0.15s;
        border: 1px solid color-mix(in srgb,var(--nd-accent) 35%,transparent);
        color: color-mix(in srgb,var(--nd-accent) 70%,transparent);
      }
      .cp-manage-btn:hover { border-color: var(--nd-accent); color: var(--nd-accent); }

      /* Manage modal */
      .cp-manage-modal {
        width: min(420px,94vw) !important; max-height: 80vh; overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb,var(--nd-text) 18%,transparent) transparent;
      }
      .cp-manage-modal::-webkit-scrollbar { width: 4px; }
      .cp-manage-modal::-webkit-scrollbar-track { background: transparent; }
      .cp-manage-modal::-webkit-scrollbar-thumb { background: color-mix(in srgb,var(--nd-text) 18%,transparent); border-radius: 2px; }
      .cp-manage-modal::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb,var(--nd-text) 35%,transparent); }
      .cp-manage-members-label { font-size: 10px; font-weight: bold; letter-spacing: 0.08em; color: var(--nd-subtext); text-transform: uppercase; margin: 4px 0 8px; }
      .cp-manage-member-list {
        display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;
        max-height: 280px; overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb,var(--nd-text) 18%,transparent) transparent;
      }
      .cp-manage-member-list::-webkit-scrollbar { width: 4px; }
      .cp-manage-member-list::-webkit-scrollbar-track { background: transparent; }
      .cp-manage-member-list::-webkit-scrollbar-thumb { background: color-mix(in srgb,var(--nd-text) 18%,transparent); border-radius: 2px; }
      .cp-manage-member-list::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb,var(--nd-text) 35%,transparent); }
      .cp-manage-member-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 7%,transparent); }
      .cp-manage-mname { flex: 1; min-width: 80px; font-size: 13px; color: var(--nd-text); font-weight: bold; }
      .cp-manage-mrole { font-size: 11px; }
      .cp-manage-mcontrols { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .cp-manage-role-sel {
        background: var(--nd-navy); color: var(--nd-text); border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 4px; font-family: inherit; font-size: 11px; padding: 3px 6px; cursor: pointer;
      }
      .cp-manage-title-input {
        background: color-mix(in srgb,var(--nd-text) 5%,transparent); color: var(--nd-text);
        border: 1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);
        border-radius: 4px; font-family: inherit; font-size: 11px; padding: 3px 6px; width: 110px;
      }
      .cp-manage-save-btn {
        background: color-mix(in srgb,var(--nd-accent) 15%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
        color: var(--nd-accent); border-radius: 4px; font-family: inherit; font-size: 11px;
        padding: 3px 8px; cursor: pointer; transition: all 0.15s;
      }
      .cp-manage-save-btn:hover { background: color-mix(in srgb,var(--nd-accent) 25%,transparent); }
      .cp-manage-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .cp-manage-edit-section { border-top: 1px solid color-mix(in srgb,var(--nd-text) 12%,transparent); padding-top: 10px; margin-top: 4px; }
      .cp-manage-edit-toggle {
        background: none; border: none; color: var(--nd-subtext); font-family: inherit;
        font-size: 11px; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase;
        cursor: pointer; padding: 0; width: 100%; text-align: left; transition: color 0.15s;
      }
      .cp-manage-edit-toggle:hover { color: var(--nd-text); }
      .cp-manage-edit-body { padding-top: 12px; }
      .cp-manage-edit-fields { display: flex; flex-direction: column; gap: 6px; }
      .cp-manage-edit-emblem-row { display: flex; align-items: center; gap: 10px; margin: 10px 0 6px; }
      .cp-manage-edit-input {
        background: color-mix(in srgb,black 55%,var(--nd-bg)); border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 6px; color: var(--nd-text); font-family: inherit; font-size: 13px;
        padding: 7px 10px; outline: none; width: 100%; box-sizing: border-box; transition: border-color 0.2s;
      }
      .cp-manage-edit-input:focus { border-color: color-mix(in srgb,var(--nd-accent) 65%,transparent); }
      .cp-manage-edit-save {
        margin-top: 10px; width: 100%; background: color-mix(in srgb,var(--nd-accent) 15%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent); color: var(--nd-accent);
        border-radius: 6px; font-family: inherit; font-size: 13px; padding: 7px 0; cursor: pointer; transition: all 0.15s;
      }
      .cp-manage-edit-save:hover { background: color-mix(in srgb,var(--nd-accent) 25%,transparent); }
      .cp-manage-edit-save:disabled { opacity: 0.5; cursor: not-allowed; }
      .cp-manage-edit-status { font-size: 11px; min-height: 16px; margin-top: 4px; }
      .cp-manage-danger { border-top: 1px solid color-mix(in srgb,#e85454 25%,transparent); padding-top: 14px; margin-top: 4px; }
      .cp-manage-danger-label { font-size: 10px; font-weight: bold; letter-spacing: 0.08em; color: color-mix(in srgb,#e85454 60%,transparent); text-transform: uppercase; margin-bottom: 8px; }
      .cp-manage-delete-btn {
        background: color-mix(in srgb,#e85454 10%,transparent); border: 1px solid color-mix(in srgb,#e85454 35%,transparent);
        color: #e85454; border-radius: 4px; font-family: inherit; font-size: 12px; padding: 6px 14px;
        cursor: pointer; transition: all 0.15s; width: 100%;
      }
      .cp-manage-delete-btn:hover { background: color-mix(in srgb,#e85454 20%,transparent); }
      .cp-manage-kick-btn {
        background: none; border: 1px solid color-mix(in srgb,#e85454 30%,transparent);
        color: color-mix(in srgb,#e85454 70%,transparent); border-radius: 4px; font-family: inherit;
        font-size: 11px; padding: 2px 7px; cursor: pointer; transition: all 0.15s;
      }
      .cp-manage-kick-btn:hover { border-color: #e85454; color: #e85454; }
      .cp-manage-kick-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .cp-manage-invite-row { display: flex; gap: 6px; align-items: center; }
      .cp-manage-invite-input {
        flex: 1; background: color-mix(in srgb,var(--nd-text) 5%,transparent); color: var(--nd-text);
        border: 1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);
        border-radius: 4px; font-family: inherit; font-size: 11px; padding: 4px 8px;
      }
      .cp-manage-invite-btn {
        background: color-mix(in srgb,var(--nd-accent) 15%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
        color: var(--nd-accent); border-radius: 4px; font-family: inherit; font-size: 11px;
        padding: 4px 10px; cursor: pointer; white-space: nowrap; transition: all 0.15s;
      }
      .cp-manage-invite-btn:hover { background: color-mix(in srgb,var(--nd-accent) 25%,transparent); }
      .cp-manage-invite-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .cp-manage-invite-status { font-size: 11px; margin-top: 4px; min-height: 16px; }

      /* Detail tabs */
      .cp-detail-tabs {
        display: flex; gap: 0; flex-shrink: 0;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        background: color-mix(in srgb, black 25%, var(--nd-bg));
      }
      .cp-dtab {
        flex: 1; padding: 9px 0; background: none; border: none;
        border-bottom: 2px solid transparent;
        color: var(--nd-subtext); font-family: inherit; font-size: 12px; cursor: pointer; transition: all 0.15s;
      }
      .cp-dtab.active { color: var(--nd-accent); border-bottom-color: var(--nd-accent); }
      .cp-dtab:hover:not(.active) { color: var(--nd-text); }

      /* Detail body */
      .cp-detail-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

      /* Chat */
      .cp-messages {
        flex: 1; overflow-y: auto; padding: 12px 14px;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb,var(--nd-text) 18%,transparent) transparent;
      }
      .cp-msg { margin-bottom: 10px; max-width: 85%; }
      .cp-msg-own { margin-left: auto; text-align: right; }
      .cp-msg-other { margin-right: auto; }
      .cp-msg-system {
        text-align: center; font-size: 11px; color: var(--nd-subtext);
        padding: 4px 0; margin: 2px 0; font-style: italic;
      }
      .cp-msg-joinreq {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        margin: 6px auto; padding: 7px 14px; border-radius: 8px; font-size: 12px;
        background: color-mix(in srgb, var(--nd-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 30%, transparent);
        max-width: 90%;
      }
      .cp-msg-joinreq-text { color: var(--nd-text); }
      .cp-msg-accept-btn {
        background: var(--nd-accent); color: var(--nd-bg); border: none;
        border-radius: 5px; padding: 3px 10px; font-size: 11px; font-family: inherit;
        font-weight: bold; cursor: pointer; white-space: nowrap;
      }
      .cp-msg-accept-btn:disabled { opacity: 0.6; cursor: default; }
      .cp-msg-name { font-size: 11px; font-weight: bold; margin-bottom: 3px; color: var(--nd-accent); }
      .cp-msg-own .cp-msg-name { color: #f0b040; }
      .cp-msg-bubble {
        display: inline-block; padding: 8px 12px; border-radius: 8px;
        font-size: 13px; line-height: 1.4; word-break: break-word;
      }
      .cp-msg-own .cp-msg-bubble {
        background: color-mix(in srgb,var(--nd-accent) 22%, color-mix(in srgb,black 55%,var(--nd-bg)));
        color: var(--nd-text); border: 1px solid color-mix(in srgb,var(--nd-accent) 55%,transparent);
        border-radius: 8px 8px 2px 8px; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      }
      .cp-msg-other .cp-msg-bubble {
        background: color-mix(in srgb,black 50%,var(--nd-bg));
        color: var(--nd-text); border: 1px solid color-mix(in srgb,var(--nd-text) 14%,transparent);
        border-radius: 8px 8px 8px 2px; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      }
      .cp-msg-time { font-size: 10px; color: var(--nd-subtext); margin-top: 3px; }
      .cp-msg-own .cp-msg-time { text-align: right; }

      /* Input */
      .cp-input-row {
        padding: 10px 14px;
        border-top: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        background: color-mix(in srgb,black 50%,var(--nd-bg));
        display: flex; gap: 6px; align-items: center; flex-shrink: 0;
      }
      .cp-input {
        flex: 1;
        background: color-mix(in srgb,black 55%,var(--nd-bg));
        border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 6px; color: var(--nd-text);
        font-family: 'Courier New', monospace; font-size: 13px;
        padding: 10px 12px; outline: none; transition: border-color 0.2s;
      }
      .cp-input:focus { border-color: color-mix(in srgb,var(--nd-accent) 65%,transparent); }
      .cp-input::placeholder { color: var(--nd-subtext); opacity: 0.55; }
      .cp-send-btn {
        flex-shrink: 0; padding: 8px 14px;
        background: color-mix(in srgb,var(--nd-accent) 20%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
        border-radius: 6px; color: var(--nd-accent);
        font-family: inherit; font-size: 12px; cursor: pointer; transition: all 0.15s;
      }
      .cp-send-btn:hover { background: color-mix(in srgb,var(--nd-accent) 35%,transparent); }
      .cp-gif-btn {
        flex-shrink: 0; padding: 8px 10px;
        background: none;
        border: 1px solid color-mix(in srgb,var(--nd-text) 22%,transparent);
        border-radius: 6px; color: var(--nd-subtext);
        font-family: inherit; font-size: 11px; cursor: pointer; transition: all 0.15s;
      }
      .cp-gif-btn:hover { color: var(--nd-accent); border-color: color-mix(in srgb,var(--nd-accent) 50%,transparent); }
      .cp-not-member {
        padding: 20px; text-align: center; color: var(--nd-subtext); font-size: 12px;
        border-top: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        flex-shrink: 0;
      }

      /* Announcements */
      .cp-composer {
        padding: 12px 14px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
        display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
      }
      .cp-composer-input {
        background: color-mix(in srgb,black 55%,var(--nd-bg));
        border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 6px; color: var(--nd-text);
        font-family: inherit; font-size: 13px; padding: 8px 10px; outline: none; resize: none;
        transition: border-color 0.2s;
      }
      .cp-composer-input:focus { border-color: color-mix(in srgb,var(--nd-accent) 65%,transparent); }
      .cp-composer-actions { display: flex; justify-content: space-between; align-items: center; }
      .cp-composer-img-btn {
        padding: 5px 10px; background: none;
        border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 4px; color: var(--nd-subtext); font-family: inherit; font-size: 11px; cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
      }
      .cp-composer-img-btn:hover { border-color: color-mix(in srgb,var(--nd-accent) 50%,transparent); color: var(--nd-accent); }
      .cp-composer-img-row {
        display: flex; gap: 6px; align-items: center;
      }
      .cp-composer-img-input {
        flex: 1; background: color-mix(in srgb,black 55%,var(--nd-bg));
        border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 4px; color: var(--nd-text); font-family: inherit; font-size: 12px;
        padding: 5px 8px; outline: none;
      }
      .cp-composer-img-input:focus { border-color: color-mix(in srgb,var(--nd-accent) 60%,transparent); }
      .cp-composer-img-clear {
        background: none; border: none; color: var(--nd-subtext); cursor: pointer; font-size: 13px; padding: 2px 4px;
      }
      .cp-composer-btn {
        padding: 6px 16px;
        background: color-mix(in srgb,var(--nd-accent) 20%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
        border-radius: 4px; color: var(--nd-accent); font-family: inherit; font-size: 12px; cursor: pointer;
      }
      .cp-composer-status { font-size: 11px; color: var(--nd-accent); }
      .cp-post-img {
        max-width: 100%; max-height: 320px; border-radius: 6px; display: block; margin-top: 6px;
        border: 1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
      }
      .cp-post-link { color: var(--nd-accent); text-decoration: underline; word-break: break-all; font-size: 12px; }
      .cp-post-card {
        padding: 12px 16px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 7%,transparent);
      }
      .cp-post-meta { font-size: 11px; color: var(--nd-subtext); margin-bottom: 5px; display: flex; align-items: center; justify-content: space-between; }
      .cp-post-del {
        background: none; border: none; padding: 0 2px; cursor: pointer;
        color: var(--nd-subtext); font-size: 11px; line-height: 1; opacity: 0.5;
        transition: opacity 0.15s, color 0.15s;
      }
      .cp-post-del:hover { opacity: 1; color: #e85454; }
      .cp-post-content { color: var(--nd-text); font-size: 13px; line-height: 1.5; word-break: break-word; }
      .cp-post-readmore { font-size: 11px; color: var(--nd-accent); margin-top: 4px; }
      .cp-post-card:has(.cp-post-readmore):hover .cp-post-readmore { text-decoration: underline; }
      .cp-post-modal { width: min(460px,92vw) !important; }
      .cp-post-modal-meta { font-size: 11px; color: var(--nd-subtext); margin-bottom: 12px; }
      .cp-post-modal-content { color: var(--nd-text); font-size: 14px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; max-height: 60vh; overflow-y: auto; }

      /* Members */
      .cp-member-row {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 16px;
        border-bottom: 1px solid color-mix(in srgb,var(--nd-text) 7%,transparent);
      }
      .cp-member-avatar {
        width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; font-weight: bold;
      }
      .cp-member-name { color: var(--nd-text); font-size: 13px; font-weight: bold; }
      .cp-member-name-link { display: inline-block; cursor: pointer; }
      .cp-member-name-link:hover { text-decoration: underline; color: var(--nd-accent); }
      .cp-member-role { color: var(--nd-subtext); font-size: 11px; margin-top: 2px; }
      .cp-member-dot {
        position: absolute; bottom: 1px; right: 1px;
        width: 9px; height: 9px; border-radius: 50%;
        border: 2px solid var(--nd-bg);
      }
      .cp-dot-on  { background: #4cff91; box-shadow: 0 0 5px #4cff9188; }
      .cp-dot-off { background: color-mix(in srgb,var(--nd-text) 25%,transparent); }

      /* Shared */
      .cp-empty, .cp-loading {
        color: var(--nd-subtext); font-size: 13px; text-align: center;
        padding: 40px 20px; line-height: 1.6;
      }

      /* Modal */
      .cp-modal-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.65);
        display: flex; align-items: center; justify-content: center; z-index: 3000;
      }
      .cp-modal {
        background: linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border: 1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
        border-radius: 12px; padding: 24px; width: min(340px,90vw);
        display: flex; flex-direction: column; gap: 12px;
        font-family: 'Courier New', monospace; color: var(--nd-text);
        box-shadow: 0 8px 32px rgba(0,0,0,0.7);
      }
      .cp-modal-title { font-size: 16px; font-weight: bold; color: var(--nd-accent); }
      .cp-modal-preview { display: flex; align-items: center; gap: 12px; }
      .cp-modal-emblem-preview {
        width: 48px; height: 48px; border-radius: 12px; border: 1px solid;
        display: flex; align-items: center; justify-content: center;
        font-size: 24px; flex-shrink: 0; transition: all 0.2s;
      }
      .cp-modal-label { font-size: 11px; color: var(--nd-subtext); display: flex; flex-direction: column; gap: 4px; }
      .cp-toggle { position: relative; display: inline-flex; flex-shrink: 0; width: 36px; height: 20px; }
      .cp-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
      .cp-toggle-track {
        position: absolute; inset: 0; border-radius: 20px;
        background: color-mix(in srgb,var(--nd-text) 15%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-text) 25%,transparent);
        transition: background 0.2s, border-color 0.2s; cursor: pointer;
      }
      .cp-toggle-track::after {
        content: ''; position: absolute; left: 3px; top: 50%; transform: translateY(-50%);
        width: 12px; height: 12px; border-radius: 50%;
        background: color-mix(in srgb,var(--nd-text) 50%,transparent);
        transition: left 0.2s, background 0.2s;
      }
      .cp-toggle input:checked + .cp-toggle-track {
        background: color-mix(in srgb,var(--nd-accent) 30%,transparent);
        border-color: color-mix(in srgb,var(--nd-accent) 60%,transparent);
      }
      .cp-toggle input:checked + .cp-toggle-track::after { left: 19px; background: var(--nd-accent); }
      .cp-modal-input {
        flex: 1; background: color-mix(in srgb,black 55%,var(--nd-bg));
        border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 6px; color: var(--nd-text); font-family: inherit; font-size: 13px;
        padding: 8px 10px; outline: none; transition: border-color 0.2s; width: 100%; box-sizing: border-box;
      }
      .cp-modal-input:focus { border-color: color-mix(in srgb,var(--nd-accent) 65%,transparent); }
      .cp-emoji-grid { display: flex; flex-wrap: wrap; gap: 6px; }
      .cp-emblem-custom-row { display: flex; margin-top: 6px; }
      .cp-emblem-custom-row .cp-modal-input { flex: 1; }
      .cp-emoji-btn {
        width: 34px; height: 34px; font-size: 18px; background: color-mix(in srgb,var(--nd-text) 8%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-text) 15%,transparent);
        border-radius: 6px; cursor: pointer; transition: all 0.15s;
      }
      .cp-emoji-btn.active, .cp-emoji-btn:hover { background: color-mix(in srgb,var(--nd-accent) 20%,transparent); border-color: color-mix(in srgb,var(--nd-accent) 50%,transparent); }
      .cp-color-grid { display: flex; flex-wrap: wrap; gap: 6px; }
      .cp-color-btn {
        width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
        border: 2px solid transparent; transition: all 0.15s;
      }
      .cp-color-btn.active, .cp-color-btn:hover { border-color: var(--nd-text); transform: scale(1.2); }
      .cp-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .cp-modal-cancel {
        background: none; border: 1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);
        border-radius: 4px; color: var(--nd-subtext); cursor: pointer; font-family: inherit; padding: 7px 16px; transition: all 0.15s;
        white-space: nowrap; flex-shrink: 0;
      }
      .cp-modal-cancel:hover { border-color: #e87aab; color: #e87aab; }
      .cp-modal-submit {
        background: color-mix(in srgb,var(--nd-accent) 20%,transparent);
        border: 1px solid color-mix(in srgb,var(--nd-accent) 40%,transparent);
        border-radius: 4px; color: var(--nd-accent); cursor: pointer; font-family: inherit; padding: 7px 16px; transition: all 0.15s;
        white-space: nowrap; flex-shrink: 0; min-width: 100px;
      }
      .cp-modal-submit:hover { background: color-mix(in srgb,var(--nd-accent) 35%,transparent); }
      .cp-modal-submit:disabled { opacity: 0.5; cursor: not-allowed; }
      .cp-modal-status { font-size: 11px; color: #e85454; min-height: 16px; }
      /* Prevent iOS Safari auto-zoom: inputs must be ≥16px on touch devices */
      @media (hover: none) and (pointer: coarse) {
        .cp-input { font-size: 16px; }
        .cp-composer-input { font-size: 16px; }
      }
    `;
    document.head.appendChild(s);
  }
}
