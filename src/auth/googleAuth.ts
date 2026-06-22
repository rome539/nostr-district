// Google sign-in for the "Continue with Google" account flow.
//
// Uses Google Identity Services (GIS) token model in a POPUP — Google's own
// account chooser + consent, in place, no full-page redirect.
//
// IMPORTANT: this requires COOP to be `same-origin-allow-popups` (see
// vite.config.ts and public/_headers). Under COOP `same-origin` the popup's
// window.opener is nulled and GIS can never hand the token back (it fails as
// `popup_closed`). `same-origin-allow-popups` keeps the opener link alive — but
// it also turns OFF cross-origin isolation (no SharedArrayBuffer).
//
// Scope is MINIMAL — only drive.appdata — so we never learn the user's name,
// email, or Google id; we just read/write our one blob in their app-data folder.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
// Login requests BOTH scopes in one popup: drive.appdata (the hidden backup) and
// drive.file (the visible, cross-app portable copy written at account creation).
// Both are non-sensitive, per-app/per-file scopes — Google still never learns the
// user's name, email, or other files.
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleAuthResult {
  /** Short-lived OAuth access token scoped to drive.appdata only. */
  accessToken: string;
}

/** True when the build was given a Google OAuth client ID. */
export function isGoogleConfigured(): boolean {
  return !!(import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined);
}

function clientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!id) {
    // Developer-facing: the #1 prod gotcha — VITE_ vars are inlined at build
    // time, so this must be set in the build environment, not just local .env.
    console.error('[google] VITE_GOOGLE_CLIENT_ID is not set in this build — Google sign-in cannot work. Set it in the production build environment.');
    throw new Error('Google sign-in is temporarily unavailable — please use another login method.');
  }
  return id;
}

let gisLoading: Promise<void> | null = null;

/** Inject the GIS script once and resolve when `window.google` is ready. */
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google sign-in'));
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Warm up GIS so the popup opens within the click gesture (not after an await). */
export function preloadGoogleAuth(): void {
  loadGis().catch(() => { /* surfaced on the real attempt */ });
}

/**
 * Open Google's consent popup and resolve with a Drive-scoped access token.
 * Rejects if the user cancels, the popup is blocked, or consent fails.
 */
export async function requestGoogleAuth(): Promise<GoogleAuthResult> {
  return {
    accessToken: await requestTokenForScope(
      SCOPES, 'drive.appdata', 'Drive access is required to save your account',
    ),
  };
}

/**
 * Request a `drive.file`-scoped token, used only to write the portable, cross-app
 * backup copy into the user's regular My Drive. Separate, incremental consent so
 * the broader scope is never requested unless the user opts into portability.
 */
export async function requestGoogleDriveFileAuth(): Promise<GoogleAuthResult> {
  return {
    // 'consent' is REQUIRED here: this is an incremental scope requested AFTER
    // login already granted drive.appdata. With prompt '' GIS sees the existing
    // session and silently skips the consent for the new drive.file scope — the
    // account chooser shows but selecting it returns nothing. Forcing 'consent'
    // makes Google actually ask for (and grant) the new scope.
    accessToken: await requestTokenForScope(
      DRIVE_FILE_SCOPE, 'drive.file', 'Drive access is required to make your account portable', 'consent',
    ),
  };
}

/** Open Google's consent popup for one scope and resolve with the access token. */
async function requestTokenForScope(scope: string, scopeCheck: string, scopeErr: string, prompt = ''): Promise<string> {
  const id = clientId();
  await loadGis();
  const google = (window as any).google;

  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope,
      callback: (resp: any) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        if (resp.scope && !resp.scope.includes(scopeCheck)) { reject(new Error(scopeErr)); return; }
        if (!resp.access_token) { reject(new Error('Google returned no access token')); return; }
        resolve(resp.access_token as string);
      },
      error_callback: (err: any) => {
        const type = err?.type || 'unknown';
        if (type === 'popup_closed') reject(new Error('Sign-in cancelled'));
        else if (type === 'popup_failed_to_open') reject(new Error('Popup blocked — allow popups for this site'));
        else reject(new Error(err?.message || 'Google sign-in failed'));
      },
    });
    client.requestAccessToken({ prompt });
  });
}
