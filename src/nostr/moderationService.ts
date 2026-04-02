/**
 * moderationService.ts — Client-side content moderation
 *
 * - Word/phrase filter: hides messages containing banned words
 * - Mute chat: toggle to hide all incoming messages
 * - Persisted in localStorage
 */

const DEFAULT_BANNED: string[] = [];

const STORAGE_KEY_WORDS = 'nostr_district_banned_words';
const STORAGE_KEY_MUTE = 'nostr_district_mute_chat';

// ── State ──

let customBannedWords: string[] = [];
let isMuted = false;

// Load from localStorage on module init
try {
  const stored = localStorage.getItem(STORAGE_KEY_WORDS);
  if (stored) customBannedWords = JSON.parse(stored);
} catch (_) {}

try {
  isMuted = localStorage.getItem(STORAGE_KEY_MUTE) === 'true';
} catch (_) {}

// ── Public API ──

/** Check if a message should be filtered. Returns true if the message should be hidden. */
export function shouldFilter(text: string): boolean {
  if (isMuted) return true;
  if (!text) return false;

  const lower = text.toLowerCase();
  const allBanned = [...DEFAULT_BANNED, ...customBannedWords];

  for (const word of allBanned) {
    if (word && lower.includes(word.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/** Check if chat is muted */
export function isChatMuted(): boolean {
  return isMuted;
}

/** Toggle mute on/off. Returns new mute state. */
export function toggleMute(): boolean {
  isMuted = !isMuted;
  try { localStorage.setItem(STORAGE_KEY_MUTE, String(isMuted)); } catch (_) {}
  return isMuted;
}

/** Set mute state directly */
export function setMuted(muted: boolean): void {
  isMuted = muted;
  try { localStorage.setItem(STORAGE_KEY_MUTE, String(isMuted)); } catch (_) {}
}

/** Get the custom banned words list */
export function getCustomBannedWords(): string[] {
  return [...customBannedWords];
}

/** Add a word/phrase to the filter */
export function addBannedWord(word: string): void {
  const trimmed = word.trim().toLowerCase();
  if (!trimmed) return;
  if (customBannedWords.includes(trimmed)) return;
  customBannedWords.push(trimmed);
  save();
}

/** Remove a word/phrase from the filter */
export function removeBannedWord(word: string): void {
  const trimmed = word.trim().toLowerCase();
  customBannedWords = customBannedWords.filter(w => w !== trimmed);
  save();
}

/** Clear all custom banned words (keeps defaults) */
export function clearCustomBannedWords(): void {
  customBannedWords = [];
  save();
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY_WORDS, JSON.stringify(customBannedWords)); } catch (_) {}
}