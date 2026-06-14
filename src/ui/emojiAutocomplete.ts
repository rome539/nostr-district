/**
 * emojiAutocomplete.ts — `:shortcode` autocomplete for any text input/textarea.
 *
 * Attach to a field and, when the user types `:` + a query at a word boundary,
 * a dropdown of their saved NIP-30 custom emojis appears (see emojiService).
 * Selecting one replaces the `:query` token with `:shortcode: ` so it renders as
 * an inline image on send. No-op for users with no custom emojis.
 *
 * Used by: main chat, DM, crew chat, zap comment, bazaar note, poll create.
 */
import { getEmojiSuggestions, hasCustomEmojis } from '../nostr/emojiService';

type Field = HTMLInputElement | HTMLTextAreaElement;
interface Suggestion { code: string; url: string }

const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Theme the dropdown's scrollbar. Inline styles can't reach the ::-webkit-scrollbar
// pseudo-elements (Chrome/Safari), so inject a scoped stylesheet once; the standard
// scrollbar-color/width (Firefox + Chrome 121+) is set inline on the box itself.
const AC_CLASS = 'nd-emoji-ac';
function ensureScrollbarStyle(): void {
  if (document.getElementById('nd-emoji-ac-style')) return;
  const el = document.createElement('style');
  el.id = 'nd-emoji-ac-style';
  el.textContent = `
    .${AC_CLASS}::-webkit-scrollbar { width: 8px; }
    .${AC_CLASS}::-webkit-scrollbar-track { background: transparent; }
    .${AC_CLASS}::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--nd-accent) 45%, #2a2a4a);
      border-radius: 8px; border: 2px solid transparent; background-clip: padding-box;
    }
    .${AC_CLASS}::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--nd-accent) 70%, #2a2a4a); background-clip: padding-box;
    }`;
  document.head.appendChild(el);
}

// Matches a `:query` token ending at the caret, only when the colon starts at the
// beginning or follows whitespace — so URLs like http://… never trigger it.
const TOKEN_RE = /(^|\s):([a-zA-Z0-9_-]*)$/;
const MAX_ROWS = 8;

/** Attach emoji autocomplete to a field. Returns a detach function. */
export function attachEmojiAutocomplete(field: Field): () => void {
  let box: HTMLDivElement | null = null;
  let items: Suggestion[] = [];
  let sel = 0;
  let tokenStart = -1; // index of the `:` being completed

  const isOpen = () => box !== null;

  const close = (): void => {
    if (box) { box.remove(); box = null; }
    items = []; sel = 0; tokenStart = -1;
  };

  const currentToken = (): { start: number; query: string } | null => {
    const caret = field.selectionStart;
    if (caret == null || caret !== field.selectionEnd) return null; // ignore selections
    const before = field.value.slice(0, caret);
    const m = TOKEN_RE.exec(before);
    if (!m) return null;
    const query = m[2];
    return { start: caret - query.length - 1, query }; // -1 for the colon
  };

  const accept = (s: Suggestion): void => {
    const caret = field.selectionStart ?? field.value.length;
    const start = tokenStart;
    if (start < 0) { close(); return; }
    const insert = `:${s.code}: `;
    field.setRangeText(insert, start, caret, 'end');
    close();
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true })); // drafts/previews update
  };

  const render = (): void => {
    if (!box) return;
    box.innerHTML = '';
    items.forEach((s, i) => {
      const row = document.createElement('div');
      row.style.cssText = [
        `display:flex;align-items:center;gap:9px;cursor:pointer;padding:${IS_TOUCH ? '10px 12px' : '5px 9px'}`,
        "font-family:'Courier New',monospace;font-size:13px;white-space:nowrap",
        `color:${i === sel ? '#fff' : '#c0c0e0'}`,
        `background:${i === sel ? 'color-mix(in srgb,var(--nd-accent) 30%,transparent)' : 'transparent'}`,
      ].join(';');
      const img = document.createElement('img');
      img.src = s.url; img.alt = s.code; img.loading = 'lazy';
      img.style.cssText = `height:${IS_TOUCH ? 24 : 20}px;width:${IS_TOUCH ? 24 : 20}px;object-fit:contain;flex:none`;
      const label = document.createElement('span');
      label.textContent = `:${s.code}:`;
      label.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
      row.append(img, label);
      // Tap-vs-scroll: accept only on a pointerup that didn't drag (so a finger can
      // scroll the list without selecting). No preventDefault on pointerdown → native
      // momentum scroll works; rows aren't focusable so the field never blurs.
      let downY = 0, moved = false;
      row.addEventListener('pointerdown', (e) => { downY = e.clientY; moved = false; });
      row.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientY - downY) > 8) moved = true;
        if (e.pointerType === 'mouse' && sel !== i) { sel = i; render(); } // hover (desktop only)
      });
      row.addEventListener('pointerup', (e) => { if (!moved) { e.preventDefault(); accept(s); } });
      box!.appendChild(row);
    });
    position();
  };

  const position = (): void => {
    if (!box) return;
    const r = field.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewTop  = vv ? vv.offsetTop : 0;
    const viewLeft = vv ? vv.offsetLeft : 0;
    const viewH    = vv ? vv.height : window.innerHeight;
    const viewW    = vv ? vv.width  : window.innerWidth;
    const viewBottom = viewTop + viewH;
    // Cap height to whichever side we open toward, so the box never runs under the
    // on-screen keyboard (visualViewport shrinks when it's up) or off-screen.
    const spaceBelow = viewBottom - r.bottom - 8;
    const spaceAbove = r.top - viewTop - 8;
    const placeAbove = spaceBelow < 140 && spaceAbove > spaceBelow;
    box.style.maxHeight = `${Math.round(Math.min(240, Math.max(96, placeAbove ? spaceAbove : spaceBelow)))}px`;
    const h = box.offsetHeight || 0;
    const top = placeAbove ? r.top - h - 4 : r.bottom + 4;
    const left = Math.max(viewLeft + 6, Math.min(r.left, viewLeft + viewW - box.offsetWidth - 6));
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    box.style.minWidth = `${Math.round(Math.min(r.width, 200))}px`;
  };

  const update = (): void => {
    if (!hasCustomEmojis()) { close(); return; }
    const tok = currentToken();
    if (!tok) { close(); return; }
    const next = getEmojiSuggestions(tok.query, MAX_ROWS);
    if (!next.length) { close(); return; }
    tokenStart = tok.start;
    items = next;
    sel = Math.min(sel, items.length - 1);
    if (!box) {
      ensureScrollbarStyle();
      box = document.createElement('div');
      box.className = AC_CLASS;
      box.style.cssText = [
        'position:fixed;z-index:2147483000;max-width:min(280px,92vw);overflow-y:auto',
        '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y',
        'scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--nd-accent) 50%,#2a2a4a) transparent',
        'background:#0c0c1c;border:1px solid color-mix(in srgb,var(--nd-accent) 45%,#2a2a4a)',
        'border-radius:7px;box-shadow:0 6px 24px rgba(0,0,0,0.55);padding:3px',
      ].join(';');
      document.body.appendChild(box);
      sel = 0;
    }
    render();
  };

  const onKeydown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (!isOpen()) return;
    switch (e.key) {
      case 'ArrowDown': sel = (sel + 1) % items.length; render(); break;
      case 'ArrowUp':   sel = (sel - 1 + items.length) % items.length; render(); break;
      case 'Enter':
      case 'Tab':       accept(items[sel]); break;
      case 'Escape':    close(); break;
      default: return; // let everything else through (typing recomputes via input)
    }
    // Intercept BEFORE the field's own send/submit handlers (capture phase).
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onDocPointer = (e: Event): void => {
    if (!box) return;
    const t = e.target as Node;
    if (t !== field && !box.contains(t)) close();
  };

  // Capture phase: our keydown must win over the field's Enter-to-send listeners.
  field.addEventListener('keydown', onKeydown, true);
  field.addEventListener('input', update);
  field.addEventListener('blur', () => setTimeout(close, 120));
  window.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
  // Reposition when the on-screen keyboard opens/closes (visualViewport changes).
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  document.addEventListener('pointerdown', onDocPointer, true);

  return () => {
    close();
    field.removeEventListener('keydown', onKeydown, true);
    field.removeEventListener('input', update);
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('resize', position);
    window.visualViewport?.removeEventListener('resize', position);
    window.visualViewport?.removeEventListener('scroll', position);
    document.removeEventListener('pointerdown', onDocPointer, true);
  };
}
