/**
 * PollBoard.ts — NIP-88 polls panel
 * Opens from the bulletin board in HubScene.
 * Three views: list, detail (vote/results), create.
 */

import { fetchPolls, fetchVotes, createPoll, castVote, Poll, PollResults } from '../nostr/pollService';
import { authStore } from '../stores/authStore';
import { fetchProfile } from '../nostr/nostrService';
import { ProfileModal } from './ProfileModal';

type View = 'list' | 'detail' | 'create';

const DURATIONS = [
  { label: '1 hour',  hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '1 week',  hours: 168 },
  { label: 'No expiry', hours: null },
];

export class PollBoard {
  private container: HTMLDivElement | null = null;
  private isOpen = false;
  private view: View = 'list';
  private polls: Poll[] = [];
  private selectedPoll: Poll | null = null;
  private resultsCache = new Map<string, PollResults>();
  private myPubkey: string | null = null;
  private votedLocal = new Map<string, string[]>(); // pollId → option ids (locally tracked)
  private authorNames = new Map<string, string>();  // pubkey → display name
  private authorPics  = new Map<string, string>();  // pubkey → picture url

  // create form
  private cQuestion = '';
  private cOptions = ['', ''];
  private cType: 'singlechoice' | 'multiplechoice' = 'singlechoice';
  private cDuration: number | null = 24;

  // detail voting state
  private selectedOptions = new Set<string>();
  private isVoting = false;
  private isLoadingResults = false;

  // list loading
  private isLoading = false;

  private cleanAuthorName(name: string): string {
    const cleaned = name
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
      .replace(/[\u200D\uFE0F]/g, '')
      .trim()
      .replace(/\s{2,}/g, ' ');
    return cleaned || name;
  }

  constructor() {
    this.myPubkey = authStore.getState().pubkey || null;
    this.loadVotedFromStorage();
    this.injectStyles();
  }

  open(): void {
    if (!this.container) this.buildDOM();
    this.container!.style.display = 'flex';
    this.isOpen = true;
    if (this.view === 'list') this.loadAndRender();
    else this.renderView();
  }

  close(): void {
    if (this.container) this.container.style.display = 'none';
    this.isOpen = false;
  }

  toggle(): void { this.isOpen ? this.close() : this.open(); }
  isVisible(): boolean { return this.isOpen; }

  destroy(): void {
    this.container?.remove();
    this.container = null;
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private buildDOM(): void {
    this.container = document.createElement('div');
    this.container.id = 'poll-board';
    document.body.appendChild(this.container);

    this.container.addEventListener('mousedown', (e) => {
      if (e.target === this.container) this.close();
    });
    this.container.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
  }

  private renderView(): void {
    if (!this.container) return;
    if (this.view === 'list')   this.container.innerHTML = this.renderList();
    if (this.view === 'detail') this.container.innerHTML = this.renderDetail();
    if (this.view === 'create') this.container.innerHTML = this.renderCreate();
    this.bindEvents();
  }

  // ── List view ───────────────────────────────────────────────────────────────

  private async loadAndRender(): Promise<void> {
    this.isLoading = true;
    this.renderView();
    try {
      this.polls = await fetchPolls(30);
    } catch (_) { this.polls = []; }
    this.isLoading = false;
    this.renderView();
    // Fetch author profiles in background, re-render as they arrive
    const uniquePubkeys = [...new Set(this.polls.map(p => p.pubkey))];
    for (const pk of uniquePubkeys) {
      if (this.authorNames.has(pk)) continue;
      fetchProfile(pk).then(profile => {
        if (!profile) return;
        const name = this.cleanAuthorName(profile.display_name || profile.name || pk.slice(0, 10) + '…');
        this.authorNames.set(pk, name);
        if (profile.picture) this.authorPics.set(pk, profile.picture);
        if (this.isOpen && this.view === 'list') this.renderView();
      }).catch(() => {});
    }
  }

  private renderList(): string {
    const canCreate = !!(this.myPubkey && authStore.getState().loginMethod !== 'guest');
    const now = Math.floor(Date.now() / 1000);

    const inner = this.isLoading
      ? `<div class="pb-loading">Fetching polls from relays…</div>`
      : this.polls.length === 0
        ? `<div class="pb-loading">No polls found yet.<br/>Be the first to create one!</div>`
        : this.polls.map(p => {
            const expired = p.endsAt && p.endsAt < now;
            const myVote = this.votedLocal.get(p.id);
            const timeLeft = p.endsAt ? this.formatTimeLeft(p.endsAt) : null;
            const results = this.resultsCache.get(p.id);
            const voteCount = results ? results.totalVoters : '–';
            const authorName = this.authorNames.get(p.pubkey) || p.pubkey.slice(0, 10) + '…';
            const authorPic  = this.authorPics.get(p.pubkey) || '';
            return `
              <div class="pb-poll-item ${expired ? 'pb-expired' : ''}" data-id="${p.id}">
                <div class="pb-poll-author" data-pubkey="${p.pubkey}">
                  ${authorPic ? `<img src="${this.esc(authorPic)}" class="pb-author-pic" onerror="this.style.display='none'">` : '<div class="pb-author-pic pb-author-pic-placeholder"></div>'}
                  <span class="pb-author-name">${this.esc(authorName)}</span>
                </div>
                <div class="pb-poll-q">${this.esc(p.content)}</div>
                <div class="pb-poll-meta">
                  <span class="pb-badge ${p.polltype === 'multiplechoice' ? 'pb-badge-multi' : 'pb-badge-single'}">${p.polltype === 'multiplechoice' ? 'multi' : 'single'}</span>
                  ${expired ? '<span class="pb-badge pb-badge-ended">ended</span>' : ''}
                  ${myVote ? '<span class="pb-badge pb-badge-voted">✓ voted</span>' : ''}
                  <span class="pb-meta-votes">${voteCount} votes</span>
                  ${timeLeft ? `<span class="pb-meta-time">${timeLeft}</span>` : ''}
                </div>
              </div>
            `;
          }).join('');

    return `
      <div class="pb-panel">
        <div class="pb-header">
          <span class="pb-title">POLLS BOARD</span>
          <div class="pb-header-actions">
            ${canCreate ? `<button class="pb-btn-create" id="pb-open-create">+ New Poll</button>` : ''}
            <button class="pb-close" id="pb-close">✕</button>
          </div>
        </div>
        <div class="pb-body">
          <div class="pb-list">${inner}</div>
        </div>
      </div>
    `;
  }

  // ── Detail view ─────────────────────────────────────────────────────────────

  private renderDetail(): string {
    const poll = this.selectedPoll!;
    const now = Math.floor(Date.now() / 1000);
    const expired = !!(poll.endsAt && poll.endsAt < now);
    const myVote = this.votedLocal.get(poll.id) ?? this.resultsCache.get(poll.id)?.myVote ?? null;
    const results = this.resultsCache.get(poll.id);
    const showResults = !!(myVote || expired);
    const canVote = !myVote && !expired && !!this.myPubkey && authStore.getState().loginMethod !== 'guest';
    const totalVotes = results?.totalVoters ?? 0;

    const optionsHtml = poll.options.map(opt => {
      const count = results?.totals.get(opt.id) ?? 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      const isMine = myVote?.includes(opt.id);
      const isSelected = this.selectedOptions.has(opt.id);

      if (showResults) {
        return `
          <div class="pb-opt-result ${isMine ? 'pb-opt-mine' : ''}">
            <div class="pb-opt-label">
              ${isMine ? '<span class="pb-opt-check">✓</span>' : ''}
              ${this.esc(opt.label)}
              <span class="pb-opt-pct">${pct}%</span>
            </div>
            <div class="pb-opt-bar-wrap">
              <div class="pb-opt-bar ${isMine ? 'pb-opt-bar-mine' : ''}" style="width:${pct}%"></div>
            </div>
            <div class="pb-opt-count">${count} vote${count !== 1 ? 's' : ''}</div>
          </div>
        `;
      }

      if (canVote) {
        const type = poll.polltype === 'multiplechoice' ? 'checkbox' : 'radio';
        return `
          <label class="pb-opt-vote ${isSelected ? 'pb-opt-selected' : ''}">
            <input type="${type}" name="poll-opt" value="${opt.id}" ${isSelected ? 'checked' : ''} class="pb-opt-input">
            <span class="pb-opt-text">${this.esc(opt.label)}</span>
          </label>
        `;
      }

      return `<div class="pb-opt-result"><div class="pb-opt-label">${this.esc(opt.label)}</div></div>`;
    }).join('');

    const loadingHtml = this.isLoadingResults && showResults
      ? `<div class="pb-loading">Loading results…</div>`
      : '';

    const voteBtn = canVote
      ? `<button class="pb-btn-vote" id="pb-cast-vote" ${this.isVoting ? 'disabled' : ''}>${this.isVoting ? 'Voting…' : 'Cast Vote'}</button>`
      : '';

    const timeLeft = poll.endsAt ? this.formatTimeLeft(poll.endsAt) : null;
    const authorName = this.authorNames.get(poll.pubkey) || poll.pubkey.slice(0, 10) + '…';
    const authorPic  = this.authorPics.get(poll.pubkey) || '';
    // Fetch author profile in background if not cached
    if (!this.authorNames.has(poll.pubkey)) {
      fetchProfile(poll.pubkey).then(profile => {
        if (!profile) return;
        this.authorNames.set(poll.pubkey, this.cleanAuthorName(profile.display_name || profile.name || poll.pubkey.slice(0, 10) + '…'));
        if (profile.picture) this.authorPics.set(poll.pubkey, profile.picture);
        if (this.isOpen && this.view === 'detail') this.renderView();
      }).catch(() => {});
    }

    return `
      <div class="pb-panel">
        <div class="pb-header">
          <button class="pb-back" id="pb-back">← Back</button>
          <span class="pb-title">POLL</span>
          <button class="pb-close" id="pb-close">✕</button>
        </div>
        <div class="pb-body pb-body-detail">
          <div class="pb-poll-author pb-detail-author" data-pubkey="${poll.pubkey}">
            ${authorPic ? `<img src="${this.esc(authorPic)}" class="pb-author-pic" onerror="this.style.display='none'">` : '<div class="pb-author-pic pb-author-pic-placeholder"></div>'}
            <span class="pb-author-name">${this.esc(authorName)}</span>
          </div>
          <div class="pb-detail-question">${this.esc(poll.content)}</div>
          <div class="pb-detail-meta">
            <span class="pb-badge ${poll.polltype === 'multiplechoice' ? 'pb-badge-multi' : 'pb-badge-single'}">${poll.polltype === 'multiplechoice' ? 'multiple choice' : 'single choice'}</span>
            ${expired ? '<span class="pb-badge pb-badge-ended">ended</span>' : ''}
            ${timeLeft && !expired ? `<span class="pb-meta-time">${timeLeft} left</span>` : ''}
            <span class="pb-meta-votes">${totalVotes} voter${totalVotes !== 1 ? 's' : ''}</span>
          </div>
          ${loadingHtml}
          <div class="pb-options">${optionsHtml}</div>
          ${!showResults && canVote ? `
            <div class="pb-vote-row">
              ${poll.polltype === 'multiplechoice' ? '<span class="pb-hint">Select all that apply</span>' : ''}
              ${voteBtn}
            </div>
          ` : ''}
          ${!canVote && !myVote && !expired ? `<div class="pb-hint-login">Log in with a key to vote.</div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Create view ─────────────────────────────────────────────────────────────

  private renderCreate(): string {
    const optInputs = this.cOptions.map((val, i) => `
      <div class="pb-create-opt-row">
        <input type="text" class="pb-create-opt-input" data-idx="${i}" placeholder="Option ${i + 1}" value="${this.esc(val)}" maxlength="80">
        ${this.cOptions.length > 2 ? `<button class="pb-opt-remove" data-idx="${i}">✕</button>` : ''}
      </div>
    `).join('');

    const durBtns = DURATIONS.map(d => `
      <button class="pb-dur-btn ${this.cDuration === d.hours ? 'pb-dur-active' : ''}" data-hours="${d.hours ?? 'null'}">${d.label}</button>
    `).join('');

    return `
      <div class="pb-panel">
        <div class="pb-header">
          <button class="pb-back" id="pb-back">← Back</button>
          <span class="pb-title">CREATE POLL</span>
          <button class="pb-close" id="pb-close">✕</button>
        </div>
        <div class="pb-body pb-body-create">
          <label class="pb-label">Question</label>
          <textarea id="pb-create-q" class="pb-create-q" placeholder="What do you want to ask?" maxlength="280">${this.esc(this.cQuestion)}</textarea>

          <label class="pb-label">Options</label>
          <div id="pb-opts-wrap">${optInputs}</div>
          ${this.cOptions.length < 5 ? `<button class="pb-add-opt" id="pb-add-opt">+ Add option</button>` : ''}

          <label class="pb-label">Type</label>
          <div class="pb-type-row">
            <button class="pb-type-btn ${this.cType === 'singlechoice' ? 'pb-type-active' : ''}" data-type="singlechoice">Single choice</button>
            <button class="pb-type-btn ${this.cType === 'multiplechoice' ? 'pb-type-active' : ''}" data-type="multiplechoice">Multiple choice</button>
          </div>

          <label class="pb-label">Duration</label>
          <div class="pb-dur-row">${durBtns}</div>

          <button class="pb-btn-post" id="pb-post-poll">Post Poll</button>
          <div id="pb-create-err" class="pb-create-err"></div>
        </div>
      </div>
    `;
  }

  // ── Event binding ────────────────────────────────────────────────────────────

  private bindEvents(): void {
    if (!this.container) return;

    this.container.querySelector('#pb-close')?.addEventListener('click', () => this.close());
    this.container.querySelector('#pb-back')?.addEventListener('click', () => {
      if (this.view === 'detail') { this.view = 'list'; this.selectedPoll = null; this.selectedOptions.clear(); this.renderView(); }
      if (this.view === 'create') { this.view = 'list'; this.renderView(); }
    });
    this.container.querySelector('#pb-open-create')?.addEventListener('click', () => {
      this.view = 'create'; this.renderView();
    });

    // Author name/pic → open profile modal
    this.container.querySelectorAll('.pb-poll-author').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const pk = (el as HTMLElement).dataset.pubkey!;
        const name = this.authorNames.get(pk) || pk.slice(0, 10) + '…';
        ProfileModal.show(pk, name);
      });
    });

    // List: click poll item → open detail
    this.container.querySelectorAll('.pb-poll-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.pb-poll-author')) return;
        const id = (el as HTMLElement).dataset.id;
        if (!id) return;
        const poll = this.polls.find(p => p.id === id);
        if (!poll) return;
        this.selectedPoll = poll;
        this.selectedOptions.clear();
        this.view = 'detail';
        this.renderView();
        this.loadResultsForDetail(poll);
      });
    });

    // Detail: vote inputs
    this.container.querySelectorAll('.pb-opt-input').forEach(el => {
      el.addEventListener('change', () => {
        const input = el as HTMLInputElement;
        if (this.selectedPoll?.polltype === 'singlechoice') {
          this.selectedOptions.clear();
          if (input.checked) this.selectedOptions.add(input.value);
        } else {
          if (input.checked) this.selectedOptions.add(input.value);
          else this.selectedOptions.delete(input.value);
        }
        // Update visual selection
        this.container?.querySelectorAll('.pb-opt-vote').forEach(label => {
          const inp = label.querySelector('input') as HTMLInputElement;
          label.classList.toggle('pb-opt-selected', inp?.checked ?? false);
        });
      });
    });

    // Detail: cast vote
    this.container.querySelector('#pb-cast-vote')?.addEventListener('click', async () => {
      if (!this.selectedPoll || this.selectedOptions.size === 0 || this.isVoting) return;
      this.isVoting = true;
      this.renderView();
      const ok = await castVote(this.selectedPoll, [...this.selectedOptions]);
      if (ok) {
        this.votedLocal.set(this.selectedPoll.id, [...this.selectedOptions]);
        this.saveVotedToStorage();
        await this.loadResultsForDetail(this.selectedPoll);
      }
      this.isVoting = false;
      this.selectedOptions.clear();
      this.renderView();
    });

    // Create: question
    this.container.querySelector('#pb-create-q')?.addEventListener('input', (e) => {
      this.cQuestion = (e.target as HTMLTextAreaElement).value;
    });

    // Create: option inputs
    this.container.querySelectorAll('.pb-create-opt-input').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.idx!);
        this.cOptions[idx] = (e.target as HTMLInputElement).value;
      });
    });

    // Create: add option
    this.container.querySelector('#pb-add-opt')?.addEventListener('click', () => {
      if (this.cOptions.length < 5) { this.cOptions.push(''); this.renderView(); }
    });

    // Create: remove option
    this.container.querySelectorAll('.pb-opt-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx!);
        this.cOptions.splice(idx, 1);
        this.renderView();
      });
    });

    // Create: type buttons
    this.container.querySelectorAll('.pb-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.cType = (btn as HTMLElement).dataset.type as Poll['polltype'];
        this.renderView();
      });
    });

    // Create: duration buttons
    this.container.querySelectorAll('.pb-dur-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = (btn as HTMLElement).dataset.hours!;
        this.cDuration = h === 'null' ? null : Number(h);
        this.renderView();
      });
    });

    // Create: post
    this.container.querySelector('#pb-post-poll')?.addEventListener('click', async () => {
      const errEl = this.container?.querySelector('#pb-create-err') as HTMLElement | null;
      const validOpts = this.cOptions.map(o => o.trim()).filter(Boolean);
      if (!this.cQuestion.trim()) { if (errEl) errEl.textContent = 'Question is required.'; return; }
      if (validOpts.length < 2) { if (errEl) errEl.textContent = 'At least 2 options required.'; return; }
      const btn = this.container?.querySelector('#pb-post-poll') as HTMLButtonElement | null;
      if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
      const poll = await createPoll(this.cQuestion, validOpts, this.cType, this.cDuration);
      if (poll) {
        this.polls.unshift(poll);
        this.cQuestion = ''; this.cOptions = ['', '']; this.cType = 'singlechoice'; this.cDuration = 24;
        this.view = 'list'; this.renderView();
      } else {
        if (errEl) errEl.textContent = 'Failed to publish. Check your signer.';
        if (btn) { btn.disabled = false; btn.textContent = 'Post Poll'; }
      }
    });
  }

  private async loadResultsForDetail(poll: Poll): Promise<void> {
    this.isLoadingResults = true;
    this.renderView();
    try {
      const results = await fetchVotes(poll, this.myPubkey);
      this.resultsCache.set(poll.id, results);
      // Merge in local vote if relay didn't return it yet
      if (!results.myVote && this.votedLocal.has(poll.id)) {
        results.myVote = this.votedLocal.get(poll.id)!;
      }
    } catch (_) {}
    this.isLoadingResults = false;
    this.renderView();
  }

  // ── Storage ─────────────────────────────────────────────────────────────────

  private votedKey(): string { return `nd_polls_voted_${this.myPubkey || 'guest'}`; }

  private loadVotedFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.votedKey());
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string[]>;
        Object.entries(obj).forEach(([k, v]) => this.votedLocal.set(k, v));
      }
    } catch (_) {}
  }

  private saveVotedToStorage(): void {
    try {
      const obj: Record<string, string[]> = {};
      this.votedLocal.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(this.votedKey(), JSON.stringify(obj));
    } catch (_) {}
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private formatTimeLeft(endsAt: number): string {
    const diff = endsAt - Math.floor(Date.now() / 1000);
    if (diff <= 0) return 'ended';
    if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
    return `${Math.floor(diff / 86400)}d left`;
  }

  private esc(s: string): string {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('poll-board-styles')) return;
    const style = document.createElement('style');
    style.id = 'poll-board-styles';
    style.textContent = `
      #poll-board {
        display: none; position: fixed; inset: 0; z-index: 3500;
        align-items: center; justify-content: center;
        background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
      }
      .pb-panel {
        background: linear-gradient(180deg, var(--nd-bg) 0%, var(--nd-navy) 100%);
        border: 1px solid color-mix(in srgb, var(--nd-text) 12%, transparent);
        border-radius: 10px; width: min(520px, 96vw); max-height: 82dvh;
        display: flex; flex-direction: column;
        box-shadow: 0 8px 40px rgba(0,0,0,0.75);
        font-family: 'Courier New', monospace;
      }
      .pb-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px;
        background: color-mix(in srgb, black 52%, var(--nd-bg));
        border-bottom: 1px solid color-mix(in srgb, var(--nd-text) 10%, transparent);
        border-radius: 10px 10px 0 0;
        flex-shrink: 0;
      }
      .pb-title {
        color: var(--nd-accent); font-size: 14px; font-weight: bold;
        letter-spacing: 1px; text-shadow: 0 1px 4px rgba(0,0,0,0.8);
      }
      .pb-header-actions { display: flex; align-items: center; gap: 8px; }
      .pb-close {
        background: none; border: none; color: var(--nd-subtext);
        font-size: 16px; cursor: pointer; padding: 4px 6px; transition: color 0.15s;
      }
      .pb-close:hover { color: var(--nd-text); }
      .pb-back {
        background: none; border: none; color: var(--nd-accent);
        font-size: 12px; cursor: pointer; padding: 4px 6px;
        font-family: 'Courier New', monospace;
      }
      .pb-back:hover { color: var(--nd-text); }
      .pb-btn-create {
        background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 45%, transparent);
        border-radius: 5px; color: var(--nd-accent);
        font-family: 'Courier New', monospace; font-size: 11px;
        padding: 5px 10px; cursor: pointer; transition: background 0.15s;
      }
      .pb-btn-create:hover { background: color-mix(in srgb, var(--nd-accent) 25%, transparent); }

      .pb-body {
        flex: 1; overflow-y: auto; padding: 0;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb, var(--nd-text) 18%, transparent) transparent;
      }
      .pb-body-detail, .pb-body-create { padding: 18px 22px; }
      .pb-list { display: flex; flex-direction: column; }
      .pb-loading {
        color: var(--nd-subtext); font-size: 13px; text-align: center;
        padding: 40px 20px; line-height: 1.6; text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }

      /* Author row */
      .pb-poll-author {
        display: flex; align-items: center; gap: 6px;
        margin-bottom: 7px; cursor: pointer;
        width: fit-content; max-width: 100%;
      }
      .pb-poll-author:hover .pb-author-name { color: var(--nd-accent); }
      .pb-author-pic {
        width: 18px; height: 18px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
        border: 1px solid color-mix(in srgb, var(--nd-text) 15%, transparent);
      }
      .pb-author-pic-placeholder {
        background: color-mix(in srgb, var(--nd-purp) 40%, transparent);
      }
      .pb-author-name {
        color: var(--nd-subtext); font-size: 11px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        transition: color 0.15s;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }
      .pb-detail-author {
        margin-bottom: 10px;
        padding: 7px 10px;
        background: color-mix(in srgb, black 35%, var(--nd-bg));
        border-radius: 6px;
        border: 1px solid color-mix(in srgb, var(--nd-text) 8%, transparent);
      }
      .pb-detail-author .pb-author-pic { width: 22px; height: 22px; }
      .pb-detail-author .pb-author-name { font-size: 12px; color: var(--nd-text); }

      /* List items */
      .pb-poll-item {
        padding: 14px 18px; cursor: pointer;
        border-bottom: 1px solid color-mix(in srgb, var(--nd-text) 7%, transparent);
        transition: background 0.15s;
      }
      .pb-poll-item:hover { background: color-mix(in srgb, var(--nd-text) 5%, transparent); }
      .pb-poll-item.pb-expired { opacity: 0.55; }
      .pb-poll-q {
        color: var(--nd-text); font-size: 13px; font-weight: bold;
        margin-bottom: 7px; line-height: 1.4;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }
      .pb-poll-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
      .pb-badge {
        font-size: 10px; padding: 2px 7px; border-radius: 10px; font-weight: bold;
      }
      .pb-badge-single { background: color-mix(in srgb, var(--nd-accent) 18%, transparent); color: var(--nd-accent); border: 1px solid color-mix(in srgb, var(--nd-accent) 35%, transparent); }
      .pb-badge-multi  { background: color-mix(in srgb, var(--nd-purp) 30%, transparent); color: var(--nd-subtext); border: 1px solid color-mix(in srgb, var(--nd-purp) 45%, transparent); }
      .pb-badge-ended  { background: rgba(80,40,40,0.4); color: #e85454; border: 1px solid rgba(232,84,84,0.3); }
      .pb-badge-voted  { background: color-mix(in srgb, var(--nd-accent) 12%, transparent); color: var(--nd-accent); border: 1px solid color-mix(in srgb, var(--nd-accent) 30%, transparent); }
      .pb-meta-votes { color: var(--nd-subtext); font-size: 11px; }
      .pb-meta-time  { color: var(--nd-subtext); font-size: 11px; opacity: 0.7; }

      /* Detail */
      .pb-detail-question {
        color: var(--nd-text); font-size: 15px; font-weight: bold;
        margin-bottom: 10px; line-height: 1.4;
        text-shadow: 0 1px 4px rgba(0,0,0,0.8);
      }
      .pb-detail-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
      .pb-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }

      /* Vote option buttons */
      .pb-opt-vote {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px; border-radius: 7px; cursor: pointer;
        background: color-mix(in srgb, black 45%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-text) 12%, transparent);
        color: var(--nd-text); font-size: 13px;
        transition: background 0.15s, border-color 0.15s;
      }
      .pb-opt-vote:hover { background: color-mix(in srgb, var(--nd-text) 8%, var(--nd-bg)); }
      .pb-opt-vote.pb-opt-selected {
        background: color-mix(in srgb, var(--nd-accent) 14%, var(--nd-bg));
        border-color: color-mix(in srgb, var(--nd-accent) 55%, transparent);
        color: var(--nd-text);
      }
      .pb-opt-input { accent-color: var(--nd-accent); width: 15px; height: 15px; flex-shrink: 0; }
      .pb-opt-text { flex: 1; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }

      /* Results bars */
      .pb-opt-result {
        padding: 8px 12px; border-radius: 7px;
        background: color-mix(in srgb, black 40%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-text) 8%, transparent);
      }
      .pb-opt-result.pb-opt-mine {
        border-color: color-mix(in srgb, var(--nd-accent) 45%, transparent);
      }
      .pb-opt-label {
        display: flex; align-items: center; gap: 6px;
        color: var(--nd-text); font-size: 13px; margin-bottom: 6px;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      }
      .pb-opt-check { color: var(--nd-accent); font-size: 12px; }
      .pb-opt-pct { margin-left: auto; color: var(--nd-subtext); font-size: 12px; font-weight: bold; }
      .pb-opt-bar-wrap {
        height: 6px; border-radius: 3px;
        background: color-mix(in srgb, var(--nd-text) 10%, transparent);
        overflow: hidden; margin-bottom: 4px;
      }
      .pb-opt-bar {
        height: 100%; border-radius: 3px;
        background: color-mix(in srgb, var(--nd-accent) 70%, var(--nd-purp));
        transition: width 0.4s ease;
      }
      .pb-opt-bar-mine { background: var(--nd-accent); }
      .pb-opt-count { color: var(--nd-subtext); font-size: 10px; }

      .pb-vote-row {
        display: flex; align-items: center; justify-content: flex-end; gap: 10px;
        margin-top: 4px;
      }
      .pb-hint { color: var(--nd-subtext); font-size: 11px; opacity: 0.7; flex: 1; }
      .pb-btn-vote {
        padding: 9px 20px; border-radius: 6px; cursor: pointer;
        background: color-mix(in srgb, var(--nd-accent) 18%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 55%, transparent);
        color: var(--nd-accent); font-family: 'Courier New', monospace;
        font-size: 13px; font-weight: bold; transition: background 0.15s;
      }
      .pb-btn-vote:hover:not(:disabled) { background: color-mix(in srgb, var(--nd-accent) 28%, transparent); }
      .pb-btn-vote:disabled { opacity: 0.5; cursor: default; }
      .pb-hint-login { color: var(--nd-subtext); font-size: 11px; text-align: center; padding: 10px 0; opacity: 0.6; }

      /* Create */
      .pb-label {
        display: block; color: var(--nd-subtext); font-size: 11px;
        text-transform: uppercase; letter-spacing: 0.5px; margin: 14px 0 6px;
      }
      .pb-create-q {
        width: 100%; box-sizing: border-box;
        background: color-mix(in srgb, black 55%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-text) 20%, transparent);
        border-radius: 6px; color: var(--nd-text);
        font-family: 'Courier New', monospace; font-size: 13px;
        padding: 10px 12px; resize: vertical; min-height: 70px; outline: none;
      }
      .pb-create-q:focus { border-color: color-mix(in srgb, var(--nd-accent) 60%, transparent); }
      .pb-create-opt-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
      .pb-create-opt-input {
        flex: 1; box-sizing: border-box;
        background: color-mix(in srgb, black 55%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-text) 18%, transparent);
        border-radius: 6px; color: var(--nd-text);
        font-family: 'Courier New', monospace; font-size: 13px;
        padding: 9px 12px; outline: none;
      }
      .pb-create-opt-input:focus { border-color: color-mix(in srgb, var(--nd-accent) 55%, transparent); }
      .pb-opt-remove {
        background: none; border: 1px solid color-mix(in srgb, var(--nd-text) 15%, transparent);
        border-radius: 5px; color: var(--nd-subtext); cursor: pointer;
        font-size: 12px; padding: 6px 9px; transition: color 0.15s;
      }
      .pb-opt-remove:hover { color: #e85454; border-color: #e8545455; }
      .pb-add-opt {
        background: none; border: 1px dashed color-mix(in srgb, var(--nd-text) 20%, transparent);
        border-radius: 6px; color: var(--nd-subtext);
        font-family: 'Courier New', monospace; font-size: 12px;
        padding: 7px 12px; cursor: pointer; width: 100%; margin-top: 2px;
        transition: color 0.15s, border-color 0.15s;
      }
      .pb-add-opt:hover { color: var(--nd-text); border-color: color-mix(in srgb, var(--nd-text) 35%, transparent); }
      .pb-type-row, .pb-dur-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .pb-type-btn, .pb-dur-btn {
        padding: 7px 12px; border-radius: 6px; cursor: pointer;
        background: color-mix(in srgb, black 45%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-text) 15%, transparent);
        color: var(--nd-subtext); font-family: 'Courier New', monospace; font-size: 12px;
        transition: background 0.15s, color 0.15s;
      }
      .pb-type-btn:hover, .pb-dur-btn:hover { color: var(--nd-text); }
      .pb-type-active, .pb-dur-active {
        background: color-mix(in srgb, var(--nd-accent) 15%, transparent) !important;
        border-color: color-mix(in srgb, var(--nd-accent) 50%, transparent) !important;
        color: var(--nd-accent) !important;
      }
      .pb-btn-post {
        display: block; width: 100%; margin-top: 20px; padding: 12px;
        background: color-mix(in srgb, var(--nd-accent) 16%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 50%, transparent);
        border-radius: 7px; color: var(--nd-accent);
        font-family: 'Courier New', monospace; font-size: 14px; font-weight: bold;
        cursor: pointer; transition: background 0.15s;
      }
      .pb-btn-post:hover:not(:disabled) { background: color-mix(in srgb, var(--nd-accent) 26%, transparent); }
      .pb-btn-post:disabled { opacity: 0.5; cursor: default; }
      .pb-create-err { color: #e85454; font-size: 12px; margin-top: 8px; text-align: center; min-height: 18px; }
    `;
    document.head.appendChild(style);
  }
}
