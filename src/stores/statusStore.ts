/**
 * statusStore.ts — Player status message
 * In-memory only — persisted via kind:30078 on demand.
 */

let currentStatus = '';

export function getStatus(): string { return currentStatus; }

export function setStatus(s: string): void { currentStatus = s; }
