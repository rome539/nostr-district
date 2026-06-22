// Reads/writes the user's ONE encrypted key vault — a single visible file in
// their Google Drive ("My Drive"), shared across every app they sign into with
// the same Google account. Contents are an EncryptedBackup (ciphertext only — no
// npub/name/identity). Portability does NOT depend on the filename: a reader
// picks the file and validates it by *decryption*.
//
// The one rule everything follows: under the `drive.file` scope an app sees only
// files it CREATED or ones the user PICKED. So —
//   • the app that created the vault always sees it (lists/opens it directly);
//   • any other app sees it only after the user picks it once; it then remembers
//     the file id and reuses it forever (no second copy is ever made).
//
// Legacy: older ND accounts kept a hidden `appDataFolder` copy. `readLegacyAppData`
// reads it once so those users can be migrated onto the single vault.
//
// All requests are plain REST with the implicit-flow access token. No SDK.

import type { EncryptedBackup } from './backupCrypto';

// Name ND uses when IT creates the vault. A vault created by another app keeps
// its own name — we never match on it (we remember the file id and decrypt).
const VAULT_NAME = 'the-district-vault.json';
// Older ND builds stored the backup in the hidden app-data folder under this
// name. Read-only now, for one-time migration to the single vault.
const LEGACY_APPDATA_FILENAME = 'nostr-district-account.json';
// localStorage key holding the id of the vault this browser/app uses, so we can
// reopen it directly (and a picked foreign vault never needs re-picking).
const VAULT_ID_KEY = 'nd_vault_file_id';

const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function errText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message || JSON.stringify(body);
  } catch {
    return (await res.text().catch(() => '')) || '';
  }
}

// ── Remembered vault id ──────────────────────────────────────────────────────

export function getVaultId(): string | null {
  return localStorage.getItem(VAULT_ID_KEY);
}
export function setVaultId(id: string): void {
  localStorage.setItem(VAULT_ID_KEY, id);
}
export function clearVaultId(): void {
  localStorage.removeItem(VAULT_ID_KEY);
}

// ── The single vault (visible My Drive file) ─────────────────────────────────

/** Download a vault file's JSON content by id. */
export async function readVaultById(token: string, fileId: string): Promise<EncryptedBackup> {
  const res = await fetch(`${FILES_API}/${fileId}?alt=media`, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`Drive read failed (${res.status}): ${await errText(res)}`);
  return (await res.json()) as EncryptedBackup;
}

/**
 * Find the vault this app can already see. A `drive.file` listing returns ONLY
 * files this app created or the user picked — so it naturally includes a vault
 * recovered from another app (which has a different name). We therefore do NOT
 * match on filename; we pick: the remembered id if present, else ND's own vault
 * by name, else — if there's exactly one file the app can see — that one (the
 * recovered foreign vault). Returns `{ fileId, backup }` or null if this app
 * can't see any vault yet, or can't tell which of several it should open.
 */
export async function findVault(token: string): Promise<{ fileId: string; backup: EncryptedBackup } | null> {
  // Fast path: the remembered id (covers ND's own vault AND a picked foreign
  // one). A failed read here is NOT treated as "stale" — we fall through to the
  // listing rather than wiping the only pointer we have to a foreign vault.
  const remembered = getVaultId();
  if (remembered) {
    try {
      return { fileId: remembered, backup: await readVaultById(token, remembered) };
    } catch { /* fall through to a full listing */ }
  }

  // List everything this app can see (its own + anything the user picked).
  const res = await fetch(`${FILES_API}?spaces=drive&q=${encodeURIComponent('trashed=false')}&fields=files(id,name)&pageSize=50`, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`Drive list failed (${res.status}): ${await errText(res)}`);
  const files: { id: string; name: string }[] = (await res.json()).files || [];
  if (files.length === 0) {
    // Nothing visible. If the remembered id no longer resolves AND there's truly
    // nothing here, it's a different/empty account — forget the stale pointer.
    if (remembered) clearVaultId();
    return null;
  }
  const chosen =
    (remembered && files.find((f) => f.id === remembered)) ||
    files.find((f) => f.name === VAULT_NAME) ||
    (files.length === 1 ? files[0] : null);
  if (!chosen) return null; // several files, none recognizable → let the user pick

  const backup = await readVaultById(token, chosen.id);
  setVaultId(chosen.id);
  return { fileId: chosen.id, backup };
}

/**
 * Write the single vault: PATCH the existing file when `fileId` is given,
 * otherwise CREATE it in My Drive. Returns the vault's file id (and remembers
 * it). There is never more than one vault — callers pass the known id to update
 * in place (password change, Face ID wrap, key rotation, reset).
 */
export async function writeVault(token: string, backup: EncryptedBackup, fileId?: string | null): Promise<string> {
  const body = JSON.stringify(backup);

  if (fileId) {
    const res = await fetch(`${UPLOAD_API}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Drive update failed (${res.status}): ${await errText(res)}`);
    setVaultId(fileId);
    return fileId;
  }

  // Create in My Drive root (no `parents` → root). drive.file lets the app
  // create new files; the created file is visible to the user and pickable.
  const boundary = 'ndv_' + Math.random().toString(36).slice(2);
  const metadata = { name: VAULT_NAME };
  const multipart =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    body + '\r\n' +
    `--${boundary}--`;

  const res = await fetch(`${UPLOAD_API}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive create failed (${res.status}): ${await errText(res)}`);
  const { id } = await res.json();
  setVaultId(id);
  return id as string;
}

// ── Legacy migration (hidden app-data folder → single vault) ─────────────────

/**
 * Read an older ND account's hidden `appDataFolder` backup, or null if none.
 * Used once on login to migrate pre-vault accounts onto the single visible
 * vault. Requires the `drive.appdata` scope (still requested at login).
 */
export async function readLegacyAppData(token: string): Promise<EncryptedBackup | null> {
  const url = `${FILES_API}?spaces=appDataFolder&fields=files(id,name)&pageSize=10`;
  const res = await fetch(url, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`Drive list failed (${res.status}): ${await errText(res)}`);
  const data = await res.json();
  const file = (data.files || []).find((f: any) => f.name === LEGACY_APPDATA_FILENAME) || (data.files || [])[0];
  if (!file) return null;
  const r = await fetch(`${FILES_API}/${file.id}?alt=media`, { headers: authHeader(token) });
  if (!r.ok) throw new Error(`Drive read failed (${r.status}): ${await errText(r)}`);
  return (await r.json()) as EncryptedBackup;
}
