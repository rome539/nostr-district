/**
 * BookcaseModal.ts
 * Visitors browse and leave quotes in a room's bookcase.
 * One quote per person per room — replaceable on Nostr.
 */
import { fetchRoomQuotes, publishRoomQuote, deleteRoomQuote, resolveQuoteNames, RoomQuote } from '../nostr/roomQuoteService';
import { authStore } from '../stores/authStore';
import { ProfileModal } from './ProfileModal';

const MAX_CHARS = 280;

let overlay: HTMLElement | null = null;

export const BookcaseModal = {
  show(roomOwnerPubkey: string): void {
    if (overlay) return;

    const { isLoggedIn, isGuest, pubkey: myPubkey } = authStore.getState();
    const canWrite = isLoggedIn && !isGuest;

    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:9000;
      background:rgba(8,4,2,0.96);
      display:flex; align-items:center; justify-content:center;
      font-family:"Courier New",monospace;
      animation:bcFade 0.3s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes bcFade { from{opacity:0} to{opacity:1} }
      .bc-quote:hover { background:rgba(120,70,20,0.1) !important; }
    `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.style.cssText = `
      width:460px; max-width:94vw;
      background:linear-gradient(160deg,#1a0e04 0%,#120a02 60%,#0e0800 100%);
      border:1px solid #6b3a1f55; border-radius:12px;
      padding:26px 22px 20px; position:relative;
      box-shadow:0 18px 48px rgba(0,0,0,0.6);
      display:flex; flex-direction:column; gap:0;
    `;

    // ── Title ──────────────────────────────────────────────────────────────────
    const title = document.createElement('div');
    title.textContent = '✦ THE BOOKCASE ✦';
    title.style.cssText = 'color:#d4a853;font-size:10px;letter-spacing:3px;text-align:center;margin-bottom:4px;opacity:0.9;';
    box.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent = 'visitors leave their mark here';
    sub.style.cssText = 'color:#7a4a20;font-size:8px;letter-spacing:1px;text-align:center;margin-bottom:16px;';
    box.appendChild(sub);

    // ── Quotes list ────────────────────────────────────────────────────────────
    const listWrap = document.createElement('div');
    listWrap.style.cssText = `
      max-height:260px; overflow-y:auto; margin-bottom:14px;
      scrollbar-width:thin; scrollbar-color:#5533aa33 transparent;
    `;

    const loading = document.createElement('div');
    loading.textContent = 'opening the pages...';
    loading.style.cssText = 'color:#7a4a2088;font-size:9px;text-align:center;padding:24px 0;letter-spacing:1px;';
    listWrap.appendChild(loading);
    box.appendChild(listWrap);

    // ── Divider ────────────────────────────────────────────────────────────────
    const hr = document.createElement('div');
    hr.style.cssText = 'border-top:1px solid #6b3a1f33;margin-bottom:14px;';
    box.appendChild(hr);

    // ── Write area (logged-in non-guest only) ──────────────────────────────────
    let textarea: HTMLTextAreaElement | null = null;
    let submitBtn: HTMLButtonElement | null = null;
    let charCount: HTMLDivElement | null = null;

    if (canWrite) {
      const writeLabel = document.createElement('div');
      writeLabel.textContent = 'leave your quote';
      writeLabel.style.cssText = 'color:#8a5a28;font-size:8px;letter-spacing:1px;margin-bottom:6px;';
      box.appendChild(writeLabel);

      textarea = document.createElement('textarea');
      textarea.placeholder = '"A quote, saying, or words you carry with you..."';
      textarea.maxLength = MAX_CHARS;
      textarea.rows = 3;
      textarea.style.cssText = `
        width:100%; box-sizing:border-box;
        background:#0e0800; border:1px solid #6b3a1f55; border-radius:6px;
        color:#e8d5b0; font-family:"Courier New",monospace; font-size:10px;
        padding:8px 10px; resize:none; outline:none; line-height:1.5;
        margin-bottom:6px;
      `;
      textarea.addEventListener('focus', () => { textarea!.style.borderColor = '#c07830'; });
      textarea.addEventListener('blur',  () => { textarea!.style.borderColor = '#6b3a1f55'; });
      // Block hotkeys from reaching Phaser while typing, but let ESC close the modal
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { BookcaseModal.destroy(); return; }
        e.stopPropagation();
      });
      box.appendChild(textarea);

      const writeRow = document.createElement('div');
      writeRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';

      charCount = document.createElement('div');
      charCount.textContent = `0 / ${MAX_CHARS}`;
      charCount.style.cssText = 'color:#7a4a2088;font-size:8px;letter-spacing:1px;';
      textarea.addEventListener('input', () => {
        const n = textarea!.value.length;
        charCount!.textContent = `${n} / ${MAX_CHARS}`;
        charCount!.style.color = n > MAX_CHARS * 0.9 ? '#ee8080' : '#7a4a2088';
      });

      submitBtn = document.createElement('button');
      submitBtn.textContent = '✦ Submit quote';
      submitBtn.style.cssText = `
        background:transparent; border:1px solid #6b3a1f88; border-radius:6px;
        color:#c07830; font-family:"Courier New",monospace; font-size:9px;
        letter-spacing:1px; cursor:pointer; padding:5px 12px;
        transition:border-color 0.2s, color 0.2s;
      `;
      submitBtn.onmouseenter = () => { submitBtn!.style.borderColor = '#c07830'; submitBtn!.style.color = '#d4a853'; };
      submitBtn.onmouseleave = () => { submitBtn!.style.borderColor = '#6b3a1f88'; submitBtn!.style.color = '#c07830'; };
      submitBtn.onclick = async () => {
        const text = textarea!.value.trim();
        if (!text) return;
        submitBtn!.disabled = true;
        submitBtn!.textContent = '...';
        const ok = await publishRoomQuote(roomOwnerPubkey, text);
        if (ok) {
          submitBtn!.textContent = '✓ saved!';
          submitBtn!.style.color = '#80ee80';
          // Refresh list to show updated quote
          setTimeout(() => loadQuotes(), 800);
        } else {
          submitBtn!.textContent = '✗ failed';
          submitBtn!.style.color = '#ee8080';
          setTimeout(() => {
            submitBtn!.disabled = false;
            submitBtn!.textContent = '✦ Submit quote';
            submitBtn!.style.color = '#a080ee';
          }, 2000);
        }
      };

      writeRow.appendChild(charCount);
      writeRow.appendChild(submitBtn);
      box.appendChild(writeRow);
    }

    // ── Close ─────────────────────────────────────────────────────────────────
    const hint = document.createElement('div');
    hint.textContent = '[ESC] or click to close';
    hint.style.cssText = 'color:#8a6040;font-size:9px;letter-spacing:1px;cursor:pointer;text-align:center;margin-top:4px;';
    hint.onclick = () => BookcaseModal.destroy();
    box.appendChild(hint);

    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) BookcaseModal.destroy(); });
    document.body.appendChild(overlay);

    // Auto-focus textarea so typing goes to input, not Phaser hotkeys
    if (textarea) setTimeout(() => textarea?.focus(), 80);

    // ── Load quotes ───────────────────────────────────────────────────────────
    let currentLimit = 50;

    const appendLoadMore = () => {
      const b = document.createElement('button');
      b.textContent = '↓ load more';
      b.style.cssText = `display:block;width:100%;background:transparent;border:1px solid #6b3a1f44;border-radius:6px;color:#8a5a28;font-family:"Courier New",monospace;font-size:8px;letter-spacing:1px;cursor:pointer;padding:6px;margin-top:4px;transition:border-color 0.2s,color 0.2s;`;
      b.onmouseenter = () => { b.style.borderColor = '#c07830'; b.style.color = '#c07830'; };
      b.onmouseleave = () => { b.style.borderColor = '#6b3a1f44'; b.style.color = '#8a5a28'; };
      b.onclick = () => { currentLimit += 50; loadQuotes(currentLimit); };
      listWrap.appendChild(b);
    };

    const loadQuotes = async (limit = currentLimit) => {
      listWrap.innerHTML = '';
      const loadingEl = document.createElement('div');
      loadingEl.textContent = 'opening the pages...';
      loadingEl.style.cssText = 'color:#7a4a2088;font-size:9px;text-align:center;padding:24px 0;letter-spacing:1px;';
      listWrap.appendChild(loadingEl);

      const quotes = await fetchRoomQuotes(roomOwnerPubkey, limit);

      listWrap.innerHTML = '';

      if (quotes.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'the shelves are bare. be the first to leave a quote.';
        empty.style.cssText = 'color:#7a4a2088;font-size:9px;text-align:center;padding:24px 0;letter-spacing:1px;font-style:italic;';
        listWrap.appendChild(empty);
      } else {
        renderQuotes(quotes);
        // Pre-fill textarea with own existing quote
        if (textarea) {
          const mine = quotes.find(q => q.pubkey === myPubkey);
          if (mine) textarea.value = mine.text;
          textarea.dispatchEvent(new Event('input'));
        }
        // Show "load more" if we may have hit the limit
        if (quotes.length >= limit) appendLoadMore();
        // Resolve names in background and re-render
        resolveQuoteNames(quotes).then(named => {
          if (!overlay) return;
          listWrap.innerHTML = '';
          renderQuotes(named);
          if (named.length >= limit) appendLoadMore();
        });
      }
    };

    const renderQuotes = (quotes: RoomQuote[]) => {
      quotes.forEach(q => {
        const isMe = q.pubkey === myPubkey;
        const row = document.createElement('div');
        row.className = 'bc-quote';
        row.style.cssText = `
          padding:10px 12px; border-radius:6px; margin-bottom:6px;
          border-left:2px solid ${isMe ? '#c07830' : '#6b3a1f44'};
          background:${isMe ? 'rgba(120,70,20,0.1)' : 'transparent'};
          transition:background 0.15s; position:relative;
        `;

        const qText = document.createElement('div');
        qText.style.cssText = 'color:#e8d5b0;font-size:10px;line-height:1.6;margin-bottom:4px;font-style:italic;';
        qText.innerHTML = `<span style="color:#7a5a3a">"</span>${q.text.replace(/</g,'&lt;')}<span style="color:#7a5a3a">"</span>`;
        row.appendChild(qText);

        const metaRow = document.createElement('div');
        metaRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

        const shortPub = q.pubkey.slice(0, 8) + '…';
        const displayName = q.name || shortPub;

        const qMeta = document.createElement('span');
        qMeta.style.cssText = `color:#7a5030;font-size:8px;letter-spacing:0.5px;${!isMe ? 'cursor:pointer;' : ''}`;
        qMeta.textContent = isMe ? `— you${q.name ? ` (${q.name})` : ''}` : `— ${displayName}`;
        if (!isMe) {
          qMeta.title = 'view profile';
          qMeta.onmouseenter = () => { qMeta.style.color = '#c07830'; qMeta.style.textDecoration = 'underline'; };
          qMeta.onmouseleave = () => { qMeta.style.color = '#7a5030'; qMeta.style.textDecoration = 'none'; };
          qMeta.onclick = () => ProfileModal.show(q.pubkey, displayName);
        }
        metaRow.appendChild(qMeta);

        // Delete button for own quote
        if (isMe && canWrite) {
          const delBtn = document.createElement('button');
          delBtn.textContent = '✕ delete';
          delBtn.style.cssText = `
            background:transparent; border:1px solid #8a3020aa; border-radius:4px;
            color:#cc4422; font-family:"Courier New",monospace;
            font-size:8px; letter-spacing:0.5px; cursor:pointer; padding:2px 8px;
            transition:all 0.15s;
          `;
          delBtn.onmouseenter = () => { delBtn.style.color = '#ff6644'; delBtn.style.borderColor = '#ff6644'; delBtn.style.background = 'rgba(200,60,20,0.12)'; };
          delBtn.onmouseleave = () => { delBtn.style.color = '#cc4422'; delBtn.style.borderColor = '#8a3020aa'; delBtn.style.background = 'transparent'; };
          delBtn.onclick = async () => {
            delBtn.disabled = true;
            delBtn.textContent = '...';
            const ok = await deleteRoomQuote(roomOwnerPubkey, q.eventId);
            if (ok) {
              if (textarea) { textarea.value = ''; textarea.dispatchEvent(new Event('input')); }
              setTimeout(() => loadQuotes(), 600);
            } else {
              delBtn.textContent = '✕';
              delBtn.disabled = false;
            }
          };
          metaRow.appendChild(delBtn);
        }

        row.appendChild(metaRow);
        listWrap.appendChild(row);
      });
    };

    loadQuotes();
  },

  destroy(): void {
    if (!overlay) return;
    overlay.style.transition = 'opacity 0.25s';
    overlay.style.opacity = '0';
    setTimeout(() => { overlay?.remove(); overlay = null; }, 250);
  },

  isOpen(): boolean { return overlay !== null; },
};
