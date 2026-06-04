const KEY = 'nd_seen_players';
const MAX = 500;

export function addSeenPubkey(pubkey: string): void {
  try {
    const raw = localStorage.getItem(KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(pubkey)) {
      list.push(pubkey);
      if (list.length > MAX) list.splice(0, list.length - MAX);
      localStorage.setItem(KEY, JSON.stringify(list));
    }
  } catch {}
}

export function getSeenPubkeys(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
