/**
 * PollBoard.ts — NIP-88 polls panel
 * Opens from the bulletin board in HubScene.
 * Three views: list, detail (vote/results), create.
 */

import { fetchPolls, fetchVotes, createPoll, castVote, Poll, PollResults } from '../nostr/pollService';
import { authStore } from '../stores/authStore';
import { fetchProfile, queryEvents } from '../nostr/nostrService';
import { ProfileModal } from './ProfileModal';
import { t as ti18n } from '../i18n/i18n';
import { pickAndUploadPlainImage, attachPlainImagePaste } from './imageUpload';
import { nip19 } from 'nostr-tools';

// Matches a bech32 nostr entity, with or without the `nostr:` URI prefix.
const NOSTR_ENTITY_RE = /(?:nostr:)?(n(?:pub|profile|event|ote|addr)1[023456789acdefghjklmnpqrstuvwxyz]{20,})/gi;

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
  private embedCache  = new Map<string, any>();      // event id → fetched note (null = not found)

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

  // scroll memory
  private listScrollTop = 0;

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

    this.container.addEventListener('pointerdown', (e) => {
      const panel = this.container?.querySelector('.pb-panel');
      if (!panel || panel.contains(e.target as Node)) return;
      this.close();
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
    if (this.view === 'detail') this.hydrateRichContent();
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
    // Fetch author profiles in background. Update only the matching author rows in
    // place as they arrive — a full renderView() would reset the list's scrollTop and
    // bounce the user back to the top mid-scroll.
    const uniquePubkeys = [...new Set(this.polls.map(p => p.pubkey))];
    for (const pk of uniquePubkeys) {
      if (this.authorNames.has(pk)) continue;
      fetchProfile(pk).then(profile => {
        if (!profile) return;
        const name = this.cleanAuthorName(profile.display_name || profile.name || pk.slice(0, 10) + '…');
        this.authorNames.set(pk, name);
        if (profile.picture) this.authorPics.set(pk, profile.picture);
        if (this.isOpen && this.view === 'list') this.updateListAuthor(pk);
      }).catch(() => {});
    }
  }

  /** Update every list row authored by `pk` in place (profile arrived). */
  private updateListAuthor(pk: string): void {
    if (!this.container) return;
    const name = this.authorNames.get(pk) || pk.slice(0, 10) + '…';
    const pic  = this.authorPics.get(pk) || '';
    this.container.querySelectorAll(`.pb-poll-author[data-pubkey="${pk}"]`).forEach(row => {
      row.innerHTML = `
        ${pic ? `<img src="${this.esc(pic)}" class="pb-author-pic" onerror="this.style.display='none'">` : '<div class="pb-author-pic pb-author-pic-placeholder"></div>'}
        <span class="pb-author-name">${this.esc(name)}</span>
      `;
    });
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
                <div class="pb-poll-q">${this.esc(this.previewText(p.content) || '[image]')}</div>
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
          <span class="pb-title">${ti18n('polls.title')}</span>
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

  /** Computed detail-view state, shared by the full render and the in-place refresh. */
  private detailState() {
    const poll = this.selectedPoll!;
    const now = Math.floor(Date.now() / 1000);
    const expired = !!(poll.endsAt && poll.endsAt < now);
    const myVote = this.votedLocal.get(poll.id) ?? this.resultsCache.get(poll.id)?.myVote ?? null;
    const results = this.resultsCache.get(poll.id);
    const showResults = !!(myVote || expired);
    const canVote = !myVote && !expired && !!this.myPubkey && authStore.getState().loginMethod !== 'guest';
    const totalVotes = results?.totalVoters ?? 0;
    return { poll, now, expired, myVote, results, showResults, canVote, totalVotes };
  }

  // ── Dynamic sub-sections (regenerated on results/vote changes without touching
  //    the static question + media, so the poll image never reloads / flickers) ──

  private buildOptionsHtml(s: ReturnType<PollBoard['detailState']>): string {
    const { poll, results, showResults, canVote, totalVotes, myVote } = s;
    return poll.options.map(opt => {
      const count = results?.totals.get(opt.id) ?? 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      const isMine = myVote?.includes(opt.id);
      const isSelected = this.selectedOptions.has(opt.id);

      // An option label can itself be an image URL (e.g. "vote on the logo" polls).
      const media = this.splitMedia(opt.label);
      const labelText = media.text ? this.esc(media.text) : '';
      const optImgs = this.optionImagesHtml(media.images);

      if (showResults) {
        return `
          <div class="pb-opt-result ${isMine ? 'pb-opt-mine' : ''}">
            <div class="pb-opt-label">
              ${isMine ? '<span class="pb-opt-check">✓</span>' : ''}
              <span class="pb-opt-label-text">${labelText}</span>
              <span class="pb-opt-pct">${pct}%</span>
            </div>
            ${optImgs}
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
            <span class="pb-opt-content">
              ${labelText ? `<span class="pb-opt-text">${labelText}</span>` : ''}
              ${optImgs}
            </span>
          </label>
        `;
      }

      return `<div class="pb-opt-result"><div class="pb-opt-label"><span class="pb-opt-label-text">${labelText}</span></div>${optImgs}</div>`;
    }).join('');
  }

  /** Thumbnails for image-URL option labels. Plain <img> (no anchor) so a click still
   *  selects the option rather than navigating away. */
  private optionImagesHtml(images: string[]): string {
    if (!images.length) return '';
    return `<span class="pb-opt-media">${images.map(u =>
      `<img src="${this.esc(u)}" class="pb-opt-img" loading="lazy" onerror="this.style.display='none'">`,
    ).join('')}</span>`;
  }

  /** Thumbnail <img>s for any image URLs in a create-form field (inner HTML of the
   *  preview container, which is always rendered so it can be updated live on input). */
  private previewThumbs(text: string): string {
    return this.splitMedia(text).images.map(u =>
      `<img src="${this.esc(u)}" class="pb-create-thumb" onerror="this.style.display='none'">`,
    ).join('');
  }

  /** Append an uploaded image URL to the question, then re-render so the preview
   *  thumbnail shows. State (cQuestion/cOptions) is preserved across the re-render. */
  private appendQuestionImageUrl(url: string): void {
    const cur = this.cQuestion.trimEnd();
    this.cQuestion = cur ? `${cur}\n${url}` : url;
    if (this.view === 'create') this.renderView();
  }

  private appendOptionImageUrl(idx: number, url: string): void {
    const cur = (this.cOptions[idx] || '').trim();
    this.cOptions[idx] = cur ? `${cur} ${url}` : url;
    if (this.view === 'create') this.renderView();
  }

  /** Upload an image (file picker) and append its URL to the question. */
  private attachImageToQuestion(): void {
    const btn = this.container?.querySelector('#pb-attach-q') as HTMLButtonElement | null;
    pickAndUploadPlainImage({
      onUrl: (url) => this.appendQuestionImageUrl(url),
      onStatus: (m) => {
        if (!btn) return;
        if (m === 'Uploading…') { btn.disabled = true; btn.textContent = 'Uploading…'; }
        else { btn.disabled = false; btn.textContent = 'Add image'; if (m) this.showCreateError(m); }
      },
    });
  }

  /** Upload an image (file picker) and append it to option `idx`. */
  private attachImageToOption(idx: number, btn: HTMLButtonElement | null): void {
    pickAndUploadPlainImage({
      onUrl: (url) => this.appendOptionImageUrl(idx, url),
      onStatus: (m) => {
        if (!btn) return;
        if (m === 'Uploading…') { btn.disabled = true; btn.textContent = '…'; }
        else { btn.disabled = false; btn.textContent = 'Image'; if (m) this.showCreateError(m); }
      },
    });
  }

  private showCreateError(msg: string): void {
    const el = this.container?.querySelector('#pb-create-err') as HTMLElement | null;
    if (el) el.textContent = msg;
  }

  private buildMetaHtml(s: ReturnType<PollBoard['detailState']>): string {
    const { poll, expired, totalVotes } = s;
    const timeLeft = poll.endsAt ? this.formatTimeLeft(poll.endsAt) : null;
    return `
      <span class="pb-badge ${poll.polltype === 'multiplechoice' ? 'pb-badge-multi' : 'pb-badge-single'}">${poll.polltype === 'multiplechoice' ? 'multiple choice' : 'single choice'}</span>
      ${expired ? '<span class="pb-badge pb-badge-ended">ended</span>' : ''}
      ${timeLeft && !expired ? `<span class="pb-meta-time">${timeLeft} left</span>` : ''}
      <span class="pb-meta-votes">${totalVotes} voter${totalVotes !== 1 ? 's' : ''}</span>
    `;
  }

  private buildVoteRowHtml(s: ReturnType<PollBoard['detailState']>): string {
    const { poll, expired, showResults, canVote, myVote } = s;
    const voteBtn = canVote
      ? `<button class="pb-btn-vote" id="pb-cast-vote" ${this.isVoting ? 'disabled' : ''}>${this.isVoting ? 'Voting…' : 'Cast Vote'}</button>`
      : '';
    if (!showResults && canVote) {
      return `
        <div class="pb-vote-row">
          ${poll.polltype === 'multiplechoice' ? '<span class="pb-hint">Select all that apply</span>' : ''}
          ${voteBtn}
        </div>
      `;
    }
    if (!canVote && !myVote && !expired) return `<div class="pb-hint-login">${ti18n('polls.login_to_vote')}</div>`;
    return '';
  }

  private renderDetail(): string {
    const s = this.detailState();
    const { poll } = s;
    const loadingHtml = this.isLoadingResults && s.showResults ? `<div class="pb-loading">Loading results…</div>` : '';
    const authorName = this.authorNames.get(poll.pubkey) || poll.pubkey.slice(0, 10) + '…';
    const authorPic  = this.authorPics.get(poll.pubkey) || '';
    // Fetch author profile in background if not cached — updates only the author row
    // (a full re-render would reload the poll image).
    if (!this.authorNames.has(poll.pubkey)) {
      fetchProfile(poll.pubkey).then(profile => {
        if (!profile) return;
        this.authorNames.set(poll.pubkey, this.cleanAuthorName(profile.display_name || profile.name || poll.pubkey.slice(0, 10) + '…'));
        if (profile.picture) this.authorPics.set(poll.pubkey, profile.picture);
        if (this.isOpen && this.view === 'detail') this.updateDetailAuthor();
      }).catch(() => {});
    }

    const media = this.splitMedia(poll.content);

    return `
      <div class="pb-panel">
        <div class="pb-header">
          <button class="pb-back" id="pb-back">${ti18n('polls.back')}</button>
          <span class="pb-title">${ti18n('polls.detail_title')}</span>
          <button class="pb-close" id="pb-close">✕</button>
        </div>
        <div class="pb-body pb-body-detail">
          <div class="pb-poll-author pb-detail-author" data-pubkey="${poll.pubkey}">
            ${authorPic ? `<img src="${this.esc(authorPic)}" class="pb-author-pic" onerror="this.style.display='none'">` : '<div class="pb-author-pic pb-author-pic-placeholder"></div>'}
            <span class="pb-author-name">${this.esc(authorName)}</span>
          </div>
          ${media.text ? `<div class="pb-detail-question">${this.renderRichText(media.text)}</div>` : ''}
          ${this.mediaHtml(media.images)}
          <div class="pb-detail-meta">${this.buildMetaHtml(s)}</div>
          <div class="pb-detail-loading">${loadingHtml}</div>
          <div class="pb-options">${this.buildOptionsHtml(s)}</div>
          <div class="pb-detail-voterow">${this.buildVoteRowHtml(s)}</div>
        </div>
      </div>
    `;
  }

  /** Update only the author row in place (profile arrived) — leaves the image intact. */
  private updateDetailAuthor(): void {
    if (!this.container || this.view !== 'detail' || !this.selectedPoll) return;
    const row = this.container.querySelector('.pb-detail-author');
    if (!row) return;
    const poll = this.selectedPoll;
    const name = this.authorNames.get(poll.pubkey) || poll.pubkey.slice(0, 10) + '…';
    const pic  = this.authorPics.get(poll.pubkey) || '';
    row.innerHTML = `
      ${pic ? `<img src="${this.esc(pic)}" class="pb-author-pic" onerror="this.style.display='none'">` : '<div class="pb-author-pic pb-author-pic-placeholder"></div>'}
      <span class="pb-author-name">${this.esc(name)}</span>
    `;
  }

  /** Update the vote/results regions in place (loading toggled, votes cast) without
   *  rebuilding the whole detail view — the poll image keeps its loaded node. */
  private refreshDetail(): void {
    if (!this.container || this.view !== 'detail' || !this.selectedPoll) return;
    const s = this.detailState();
    const loadingEl = this.container.querySelector('.pb-detail-loading');
    const metaEl    = this.container.querySelector('.pb-detail-meta');
    const optsEl    = this.container.querySelector('.pb-options');
    const voteRowEl = this.container.querySelector('.pb-detail-voterow');
    if (loadingEl) loadingEl.innerHTML = this.isLoadingResults && s.showResults ? `<div class="pb-loading">Loading results…</div>` : '';
    if (metaEl)    metaEl.innerHTML = this.buildMetaHtml(s);
    if (optsEl)    optsEl.innerHTML = this.buildOptionsHtml(s);
    if (voteRowEl) voteRowEl.innerHTML = this.buildVoteRowHtml(s);
    this.bindDetailDynamic();
  }

  // ── Create view ─────────────────────────────────────────────────────────────

  private renderCreate(): string {
    const optInputs = this.cOptions.map((val, i) => `
      <div class="pb-create-opt-row">
        <input type="text" class="pb-create-opt-input" data-idx="${i}" placeholder="Option ${i + 1}" value="${this.esc(val)}" maxlength="600">
        <button class="pb-attach-opt" data-idx="${i}" type="button" title="Add image">Image</button>
        ${this.cOptions.length > 2 ? `<button class="pb-opt-remove" data-idx="${i}">✕</button>` : ''}
      </div>
      <div class="pb-create-preview" data-preview-idx="${i}">${this.previewThumbs(val)}</div>
    `).join('');

    const durBtns = DURATIONS.map(d => `
      <button class="pb-dur-btn ${this.cDuration === d.hours ? 'pb-dur-active' : ''}" data-hours="${d.hours ?? 'null'}">${d.label}</button>
    `).join('');

    return `
      <div class="pb-panel">
        <div class="pb-header">
          <button class="pb-back" id="pb-back">${ti18n('polls.back')}</button>
          <span class="pb-title">${ti18n('polls.create_title')}</span>
          <button class="pb-close" id="pb-close">✕</button>
        </div>
        <div class="pb-body pb-body-create">
          <label class="pb-label">${ti18n('polls.question')}</label>
          <textarea id="pb-create-q" class="pb-create-q" placeholder="${ti18n('polls.question_placeholder')}" maxlength="1000">${this.esc(this.cQuestion)}</textarea>
          <div class="pb-create-attach-row">
            <button class="pb-attach-btn" id="pb-attach-q" type="button">Add image</button>
          </div>
          <div class="pb-create-preview" id="pb-q-preview">${this.previewThumbs(this.cQuestion)}</div>

          <label class="pb-label">${ti18n('polls.options')}</label>
          <div id="pb-opts-wrap">${optInputs}</div>
          ${this.cOptions.length < 5 ? `<button class="pb-add-opt" id="pb-add-opt">${ti18n('polls.add_option')}</button>` : ''}

          <label class="pb-label">${ti18n('polls.type')}</label>
          <div class="pb-type-row">
            <button class="pb-type-btn ${this.cType === 'singlechoice' ? 'pb-type-active' : ''}" data-type="singlechoice">${ti18n('polls.type_single')}</button>
            <button class="pb-type-btn ${this.cType === 'multiplechoice' ? 'pb-type-active' : ''}" data-type="multiplechoice">${ti18n('polls.type_multi')}</button>
          </div>

          <label class="pb-label">${ti18n('polls.duration')}</label>
          <div class="pb-dur-row">${durBtns}</div>

          <button class="pb-btn-post" id="pb-post-poll">${ti18n('polls.post_btn')}</button>
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
      if (this.view === 'detail') {
        this.view = 'list'; this.selectedPoll = null; this.selectedOptions.clear();
        this.renderView();
        // Restore list scroll position
        const body = this.container?.querySelector('.pb-body') as HTMLElement | null;
        if (body) body.scrollTop = this.listScrollTop;
      }
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
        // Save list scroll position before leaving
        const body = this.container?.querySelector('.pb-body') as HTMLElement | null;
        if (body) this.listScrollTop = body.scrollTop;
        this.selectedPoll = poll;
        this.selectedOptions.clear();
        this.view = 'detail';
        this.renderView();
        this.loadResultsForDetail(poll);
      });
    });

    // Detail: vote inputs + cast vote (also re-bound after an in-place refresh)
    this.bindDetailDynamic();

    // Create: question (typing + paste-to-upload)
    const qEl = this.container.querySelector('#pb-create-q');
    if (qEl) {
      qEl.addEventListener('input', (e) => {
        this.cQuestion = (e.target as HTMLTextAreaElement).value;
        const prev = this.container?.querySelector('#pb-q-preview');
        if (prev) prev.innerHTML = this.previewThumbs(this.cQuestion); // keep preview in sync as you edit
      });
      attachPlainImagePaste(qEl as HTMLElement, {
        onUrl: (url) => this.appendQuestionImageUrl(url),
        onStatus: (m) => { if (m) this.showCreateError(m === 'Uploading…' ? 'Uploading image…' : m); },
      });
    }

    // Create: option inputs (typing + paste-to-upload)
    this.container.querySelectorAll('.pb-create-opt-input').forEach(el => {
      const idx = parseInt((el as HTMLElement).dataset.idx!);
      el.addEventListener('input', (e) => {
        this.cOptions[idx] = (e.target as HTMLInputElement).value;
        const prev = this.container?.querySelector(`.pb-create-preview[data-preview-idx="${idx}"]`);
        if (prev) prev.innerHTML = this.previewThumbs(this.cOptions[idx]);
      });
      attachPlainImagePaste(el as HTMLElement, {
        onUrl: (url) => this.appendOptionImageUrl(idx, url),
        onStatus: (m) => { if (m) this.showCreateError(m === 'Uploading…' ? 'Uploading image…' : m); },
      });
    });

    // Create: attach image to the question
    this.container.querySelector('#pb-attach-q')?.addEventListener('click', () => this.attachImageToQuestion());

    // Create: attach image to an option
    this.container.querySelectorAll('.pb-attach-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx!);
        this.attachImageToOption(idx, btn as HTMLButtonElement);
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

  /** Bind the vote inputs + cast-vote button. Safe to call after a full render or an
   *  in-place refreshDetail() — it only touches the (freshly recreated) option/vote nodes. */
  private bindDetailDynamic(): void {
    if (!this.container) return;

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

    this.container.querySelector('#pb-cast-vote')?.addEventListener('click', async () => {
      if (!this.selectedPoll || this.selectedOptions.size === 0 || this.isVoting) return;
      this.isVoting = true;
      this.refreshDetail();
      const ok = await castVote(this.selectedPoll, [...this.selectedOptions]);
      if (ok) {
        this.votedLocal.set(this.selectedPoll.id, [...this.selectedOptions]);
        this.saveVotedToStorage();
        await this.loadResultsForDetail(this.selectedPoll);
      }
      this.isVoting = false;
      this.selectedOptions.clear();
      this.refreshDetail();
    });
  }

  private async loadResultsForDetail(poll: Poll): Promise<void> {
    this.isLoadingResults = true;
    this.refreshDetail();
    try {
      const results = await fetchVotes(poll, this.myPubkey);
      this.resultsCache.set(poll.id, results);
      // Merge in local vote if relay didn't return it yet
      if (!results.myVote && this.votedLocal.has(poll.id)) {
        results.myVote = this.votedLocal.get(poll.id)!;
      }
    } catch (_) {}
    this.isLoadingResults = false;
    this.refreshDetail();
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

  // Pull image URLs out of the poll text so they render as photos instead of raw
  // links. Matches image-extension URLs and Blossom/hash-style URLs (host + 64-hex
  // sha256); anything that turns out not to be an image is hidden via onerror.
  private splitMedia(content: string): { text: string; images: string[] } {
    const images: string[] = [];
    const isImg = (u: string) =>
      /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?\S*)?$/i.test(u) ||
      /^https?:\/\/[^\s/]+\/[0-9a-f]{64}(\.\w+)?$/i.test(u);
    const text = content
      .replace(/https?:\/\/\S+/gi, (raw) => {
        const url = raw.replace(/[)\].,;!?]+$/, '');
        if (isImg(url)) { images.push(url); return ''; }
        return raw;
      })
      .replace(/[^\S\n]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text, images };
  }

  private mediaHtml(images: string[]): string {
    if (!images.length) return '';
    return `<div class="pb-media">${images.map(u =>
      `<a href="${this.esc(u)}" target="_blank" rel="noopener"><img src="${this.esc(u)}" class="pb-media-img" loading="lazy" onerror="this.parentElement.style.display='none'"></a>`,
    ).join('')}</div>`;
  }

  // ── nostr: entities (npub mentions + nevent/note embeds) ──────────────────────

  private shortNpub(pubkey: string): string {
    try { return '@' + nip19.npubEncode(pubkey).slice(5, 13) + '…'; } catch { return '@' + pubkey.slice(0, 8) + '…'; }
  }

  /** Compact, fetch-free text for the list preview: drop note/event refs, render
   *  mentions as @name (only if already cached, else a short npub). */
  private previewText(content: string): string {
    const base = this.splitMedia(content).text;
    return base.replace(NOSTR_ENTITY_RE, (m, tok) => {
      try {
        const dec = nip19.decode(String(tok).toLowerCase());
        if (dec.type === 'npub')     { const n = this.authorNames.get(dec.data as string); return n ? '@' + n : this.shortNpub(dec.data as string); }
        if (dec.type === 'nprofile') { const pk = (dec.data as any).pubkey; const n = this.authorNames.get(pk); return n ? '@' + n : this.shortNpub(pk); }
        return ''; // event / addr refs are dropped from the compact preview
      } catch { return m; }
    }).replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim();
  }

  /** Detail-view rich text: escape, then swap nostr: entities for @mention spans and
   *  embed placeholders (filled in by hydrateRichContent). Bech32 tokens survive HTML
   *  escaping untouched, so escaping the whole string first is safe. */
  private renderRichText(text: string): string {
    let html = this.esc(text);
    html = html.replace(NOSTR_ENTITY_RE, (m, tok) => {
      try {
        const dec = nip19.decode(String(tok).toLowerCase());
        if (dec.type === 'npub')     return this.mentionSpan(dec.data as string);
        if (dec.type === 'nprofile') return this.mentionSpan((dec.data as any).pubkey);
        if (dec.type === 'note')     return this.embedPlaceholder(dec.data as string, []);
        if (dec.type === 'nevent')   { const d = dec.data as any; return this.embedPlaceholder(d.id, d.relays || []); }
        if (dec.type === 'naddr')    return this.embedChip(String(tok).toLowerCase());
      } catch { /* leave token as-is */ }
      return m;
    });
    return html.replace(/\n/g, '<br>');
  }

  private mentionSpan(pubkey: string): string {
    const name = this.authorNames.get(pubkey);
    const label = name ? '@' + this.esc(name) : this.esc(this.shortNpub(pubkey));
    return `<span class="pb-mention" data-pubkey="${pubkey}">${label}</span>`;
  }

  private embedPlaceholder(eventId: string, relays: string[]): string {
    return `<div class="pb-embed" data-eid="${eventId}" data-relays="${this.esc(relays.join(','))}">`
      + `<div class="pb-embed-loading">Loading note…</div></div>`;
  }

  private embedChip(token: string): string {
    return `<a class="pb-embed-chip" href="https://njump.me/${this.esc(token)}" target="_blank" rel="noopener">📝 quoted note ↗</a>`;
  }

  /** After a detail render, resolve @mention names and fetch + fill note embeds. */
  private hydrateRichContent(): void {
    if (!this.container) return;

    // Mentions: click → profile modal; fetch name if not cached, then update label.
    this.container.querySelectorAll('.pb-mention').forEach(el => {
      const pk = (el as HTMLElement).dataset.pubkey;
      if (!pk) return;
      el.addEventListener('click', (e) => { e.stopPropagation(); ProfileModal.show(pk, this.authorNames.get(pk) || pk.slice(0, 10) + '…'); });
      if (!this.authorNames.has(pk)) {
        fetchProfile(pk).then(profile => {
          if (!profile) return;
          const name = this.cleanAuthorName(profile.display_name || profile.name || this.shortNpub(pk));
          this.authorNames.set(pk, name);
          if (profile.picture) this.authorPics.set(pk, profile.picture);
          this.container?.querySelectorAll(`.pb-mention[data-pubkey="${pk}"]`).forEach(s => { s.textContent = '@' + name; });
        }).catch(() => {});
      }
    });

    // Embeds: fetch the referenced note (cached), render an author + content card.
    this.container.querySelectorAll('.pb-embed').forEach(el => this.hydrateEmbed(el as HTMLElement));
  }

  private async hydrateEmbed(el: HTMLElement): Promise<void> {
    const eid = el.dataset.eid;
    if (!eid) return;
    const relays = (el.dataset.relays || '').split(',').filter(Boolean);

    let ev = this.embedCache.get(eid);
    if (ev === undefined) {
      try {
        const found = await queryEvents({ ids: [eid] }, relays.length ? relays.concat([
          'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub',
        ]) : undefined);
        ev = found[0] ?? null;
      } catch { ev = null; }
      this.embedCache.set(eid, ev);
    }

    // Element may have been replaced (view changed) — re-find live nodes by id.
    const live = this.container?.querySelectorAll(`.pb-embed[data-eid="${eid}"]`);
    if (!live || !live.length) return;

    let nevent = '';
    try { nevent = nip19.neventEncode({ id: eid, author: ev?.pubkey }); } catch { try { nevent = nip19.noteEncode(eid); } catch {} }
    const njump = nevent ? `https://njump.me/${nevent}` : `https://njump.me/${eid}`;

    if (!ev) {
      const html = `<a class="pb-embed-chip" href="${this.esc(njump)}" target="_blank" rel="noopener">📝 quoted note ↗</a>`;
      live.forEach(n => { (n as HTMLElement).innerHTML = html; });
      return;
    }

    const prof = await fetchProfile(ev.pubkey).catch(() => null);
    const name = this.esc(this.cleanAuthorName(prof?.display_name || prof?.name || this.shortNpub(ev.pubkey)));
    const pic  = prof?.picture ? this.esc(prof.picture) : '';
    const media = this.splitMedia(ev.content || '');
    let body = this.esc(media.text);
    // one level of mentions inside the embed; nested note refs become a small link
    body = body.replace(NOSTR_ENTITY_RE, (m, tok) => {
      try {
        const dec = nip19.decode(String(tok).toLowerCase());
        if (dec.type === 'npub')     return this.mentionSpan(dec.data as string);
        if (dec.type === 'nprofile') return this.mentionSpan((dec.data as any).pubkey);
        return '<span class="pb-embed-ref">📝 note</span>';
      } catch { return m; }
    });
    if (body.length > 280) body = body.slice(0, 280) + '…';
    body = body.replace(/\n/g, '<br>');

    const html = `
      <div class="pb-embed-author">
        ${pic ? `<img src="${pic}" class="pb-embed-pic" onerror="this.style.display='none'">` : '<div class="pb-embed-pic pb-author-pic-placeholder"></div>'}
        <span class="pb-embed-name">${name}</span>
      </div>
      ${body ? `<div class="pb-embed-body">${body}</div>` : ''}
      ${this.mediaHtml(media.images)}
      <a class="pb-embed-open" href="${this.esc(njump)}" target="_blank" rel="noopener">open note ↗</a>
    `;
    live.forEach(n => {
      const node = n as HTMLElement;
      node.innerHTML = html;
      node.classList.add('pb-embed-loaded');
      node.querySelectorAll('.pb-mention').forEach(s => {
        const pk = (s as HTMLElement).dataset.pubkey;
        if (pk) s.addEventListener('click', (e) => { e.stopPropagation(); ProfileModal.show(pk, this.authorNames.get(pk) || pk.slice(0, 10) + '…'); });
      });
    });
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
      .pb-media { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 12px; }
      .pb-media a { display: inline-flex; max-width: 100%; line-height: 0; }
      .pb-media-img {
        max-width: 100%; max-height: 260px; border-radius: 8px; object-fit: cover;
        cursor: zoom-in; border: 1px solid rgba(255,255,255,0.08); display: block;
      }

      /* nostr @mentions */
      .pb-mention {
        color: var(--nd-accent); cursor: pointer; font-weight: bold;
        text-decoration: none;
      }
      .pb-mention:hover { text-decoration: underline; }

      /* Embedded note cards */
      .pb-embed {
        display: block; margin: 8px 0; padding: 10px 12px;
        background: color-mix(in srgb, black 40%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-text) 12%, transparent);
        border-left: 3px solid color-mix(in srgb, var(--nd-accent) 55%, transparent);
        border-radius: 7px;
      }
      .pb-embed-loading { color: var(--nd-subtext); font-size: 12px; opacity: 0.7; }
      .pb-embed-author { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
      .pb-embed-pic {
        width: 18px; height: 18px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
        border: 1px solid color-mix(in srgb, var(--nd-text) 15%, transparent);
      }
      .pb-embed-name { color: var(--nd-text); font-size: 12px; font-weight: bold; }
      .pb-embed-body {
        color: var(--nd-subtext); font-size: 12px; line-height: 1.5;
        white-space: pre-wrap; word-break: break-word;
      }
      .pb-embed .pb-media { margin: 6px 0 2px; }
      .pb-embed .pb-media-img { max-height: 180px; }
      .pb-embed-ref { color: var(--nd-accent); font-weight: bold; }
      .pb-embed-open, .pb-embed-chip {
        display: inline-block; margin-top: 8px; color: var(--nd-accent);
        font-size: 11px; text-decoration: none; opacity: 0.85;
      }
      .pb-embed-open:hover, .pb-embed-chip:hover { text-decoration: underline; opacity: 1; }
      .pb-embed-chip {
        padding: 6px 10px; border-radius: 6px; margin-top: 0;
        background: color-mix(in srgb, black 40%, var(--nd-bg));
        border: 1px solid color-mix(in srgb, var(--nd-accent) 35%, transparent);
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

      /* Image-URL option labels */
      .pb-opt-content { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
      .pb-opt-label-text { min-width: 0; word-break: break-word; }
      .pb-opt-media { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0; }
      .pb-opt-img {
        max-width: 100%; max-height: 170px; border-radius: 6px; object-fit: cover;
        border: 1px solid rgba(255,255,255,0.08); display: block;
      }
      .pb-opt-result .pb-opt-media { margin: 0 0 8px; }

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

      /* Image attach (create form) */
      .pb-create-attach-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
      .pb-attach-btn {
        background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent) 38%, transparent);
        border-radius: 6px; color: var(--nd-accent);
        font-family: 'Courier New', monospace; font-size: 11px;
        padding: 6px 11px; cursor: pointer; transition: background 0.15s;
      }
      .pb-attach-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--nd-accent) 22%, transparent); }
      .pb-attach-btn:disabled { opacity: 0.6; cursor: default; }
      .pb-attach-opt {
        background: none; border: 1px solid color-mix(in srgb, var(--nd-text) 15%, transparent);
        border-radius: 5px; color: var(--nd-subtext); cursor: pointer;
        font-size: 12px; padding: 6px 9px; flex-shrink: 0; transition: border-color 0.15s;
      }
      .pb-attach-opt:hover:not(:disabled) { border-color: color-mix(in srgb, var(--nd-accent) 45%, transparent); }
      .pb-attach-opt:disabled { opacity: 0.6; cursor: default; }
      .pb-create-preview { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
      .pb-create-preview:empty { display: none; margin: 0; }
      .pb-create-thumb {
        max-width: 120px; max-height: 120px; border-radius: 6px; object-fit: cover;
        border: 1px solid color-mix(in srgb, var(--nd-text) 14%, transparent);
      }
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
