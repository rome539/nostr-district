/**
 * signingLog.ts — Kind-classification helpers for the Activity Log modal.
 *
 * Originally maintained a localStorage ring buffer of every event the app
 * signed. That turned out to duplicate what's already on Nostr relays — the
 * canonical record — so the modal now fetches the user's events directly via
 * `fetchUserActivity()` and uses these helpers to label and group them.
 */

export type EventCategory = 'all' | 'profile' | 'social' | 'zap' | 'app' | 'message' | 'other';

export function categoryForKind(kind: number): EventCategory {
  if (kind === 0)    return 'profile';
  if (kind === 3 || kind === 10000 || kind === 10002) return 'social';
  if (kind === 4 || kind === 14 || kind === 44 || kind === 1059) return 'message';
  if (kind === 9734 || kind === 9735) return 'zap';
  if (kind === 30078) return 'app';
  if (kind === 1)    return 'message';
  return 'other';
}

export function labelForKind(kind: number): string {
  switch (kind) {
    case 0:     return 'Profile';
    case 1:     return 'Note';
    case 3:     return 'Contacts';
    case 4:     return 'DM (NIP-04)';
    case 5:     return 'Deletion';
    case 14:    return 'DM (NIP-17)';
    case 44:    return 'Sealed DM';
    case 1059:  return 'Gift-wrap';
    case 9734:  return 'Zap request';
    case 9735:  return 'Zap receipt';
    case 10000: return 'Mute list';
    case 10002: return 'Relay list';
    case 30078: return 'App data';
    case 16767: return 'Theme';
    default:    return `kind:${kind}`;
  }
}
