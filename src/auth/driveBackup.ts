// Reads/writes the encrypted account backup in the user's Google Drive
// app-data folder (the hidden, per-app `appDataFolder` space granted by the
// drive.appdata scope). We keep exactly one file. Its contents are an
// EncryptedBackup — ciphertext only, no npub/name/identity.
//
// All requests are plain REST with the implicit-flow access token. No SDK.

import type { EncryptedBackup } from './backupCrypto';

const FILENAME = 'nostr-district-account.json';
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

/** Find our backup file's id in appDataFolder, or null if none exists yet. */
async function findFileId(token: string): Promise<string | null> {
  const url = `${FILES_API}?spaces=appDataFolder&fields=files(id,name)&pageSize=10`;
  const res = await fetch(url, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`Drive list failed (${res.status}): ${await errText(res)}`);
  const data = await res.json();
  const file = (data.files || []).find((f: any) => f.name === FILENAME) || (data.files || [])[0];
  return file ? file.id : null;
}

/** Returns the stored backup, or null if the user has none yet. */
export async function readBackup(token: string): Promise<EncryptedBackup | null> {
  const id = await findFileId(token);
  if (!id) return null;
  const res = await fetch(`${FILES_API}/${id}?alt=media`, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`Drive read failed (${res.status}): ${await errText(res)}`);
  return (await res.json()) as EncryptedBackup;
}

/** Create or overwrite the backup file with the given blob. */
export async function writeBackup(token: string, backup: EncryptedBackup): Promise<void> {
  const existingId = await findFileId(token);
  const body = JSON.stringify(backup);

  if (existingId) {
    // Update content of the existing file (media upload).
    const res = await fetch(`${UPLOAD_API}/${existingId}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Drive update failed (${res.status}): ${await errText(res)}`);
    return;
  }

  // Create a new file in appDataFolder (multipart: metadata + content).
  const boundary = 'ndb_' + Math.random().toString(36).slice(2);
  const metadata = { name: FILENAME, parents: ['appDataFolder'] };
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
}
