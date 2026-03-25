// Type declarations for nostr-auth-security-kit.js

export function escapeHtml(unsafe: string): string;
export function sanitizeUrl(url: string): string;
export function capLength(text: string, maxLen: number, ellipsis?: boolean): string;
export function sanitizeDisplayName(name: string): string;
export function sanitizeBio(about: string, previewLen?: number): { preview: string; full: string };
export function sanitizeNip05(nip05: string): string;
export function detectSpam(profile: any, notes: any[]): number;
export function detectNSFW(profile: any, notes: any[]): boolean;
export function detectDeletedAccount(profile: any, notes: any[], follows: any[]): boolean;
export function createSecureKeyStore(NostrTools: any): Readonly<{
  set(key: Uint8Array): void;
  has(): boolean;
  clear(): void;
  signEvent(event: any): any;
}>;
export function createInactivityMonitor(options: {
  timeoutMs?: number;
  onTimeout: () => void;
}): { destroy(): void; reset(): void };
export function createNostrAuth(options: any): any;