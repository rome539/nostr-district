/**
 * ============================================================================
 * NOSTR AUTH & SECURITY KIT
 * ============================================================================
 * Extracted from a production Nostr app. Drop-in security utilities and
 * multi-method Nostr authentication (NIP-07 Extension, NIP-46 Bunker, nsec).
 *
 * Features:
 *   - SecureKeyStore: closure-based private key storage (no XSS leaks)
 *   - Inactivity auto-logout for nsec sessions (configurable timer)
 *   - Page unload / visibility-change key wiping
 *   - HTML escaping (anti-XSS for user-generated content)
 *   - URL sanitization (blocks javascript:, data:, vbscript:, file:)
 *   - Input length capping for display names, bios, NIP-05
 *   - Content Security Policy (CSP) meta tag template
 *   - Spam & NSFW detection heuristics
 *   - Three login methods: Extension (NIP-07), Bunker (NIP-46), nsec
 *   - Logout with full memory cleanup
 *
 * Dependencies:
 *   - nostr-tools (v2.7+): https://esm.sh/nostr-tools@2.7.2
 *   - nostr-tools/nip46 (v2.23+): https://esm.sh/nostr-tools@2.23.0/nip46
 *   - nostr-tools/pool (v2.23+): https://esm.sh/nostr-tools@2.23.0/pool
 *   - QRCode (optional, for bunker QR): https://cdn.jsdelivr.net/npm/qrcode@1.5.4
 *
 * Usage:
 *   1. Copy this file into your project
 *   2. Import/adapt the pieces you need
 *   3. See "INTEGRATION EXAMPLE" at bottom for a quick-start
 * ============================================================================
 */


// =============================================================================
// SECTION 1: CONTENT SECURITY POLICY (CSP) — paste into your <head>
// =============================================================================
/*
  Add this <meta> tag to your HTML <head>. Adjust domains as needed for your app.

  <meta http-equiv="Content-Security-Policy" content="
      default-src 'self';
      script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://esm.sh;
      style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
      font-src 'self' https://fonts.gstatic.com data:;
      img-src 'self' https: data: blob:;
      media-src 'self' https: data: blob:;
      connect-src 'self' https: wss:;
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      upgrade-insecure-requests;
  ">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="X-Content-Type-Options" content="nosniff">
*/


// =============================================================================
// SECTION 2: SANITIZATION UTILITIES
// =============================================================================

/**
 * Escapes HTML special characters to prevent XSS when injecting user content.
 * Use this on ALL user-supplied strings before inserting into innerHTML.
 *
 * @param {string} unsafe - Raw user string (name, bio, NIP-05, etc.)
 * @returns {string} Escaped string safe for innerHTML
 */
export function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Sanitizes a URL to block dangerous protocols.
 * Use on any URL sourced from relay data (profile pictures, links, etc.)
 * before setting as img.src, href, or any DOM attribute.
 *
 * @param {string} url - Raw URL from relay/user data
 * @returns {string} Sanitized URL or empty string if dangerous
 */
export function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim().toLowerCase();
    if (
        trimmed.startsWith('javascript:') ||
        trimmed.startsWith('data:') ||
        trimmed.startsWith('vbscript:') ||
        trimmed.startsWith('file:')
    ) {
        return '';
    }
    return url.trim();
}

/**
 * Caps string length for safe display. Prevents DOM bloat from
 * maliciously long profile fields.
 *
 * @param {string} text - Raw text
 * @param {number} maxLen - Maximum allowed length
 * @param {boolean} ellipsis - Whether to append "..." when truncated
 * @returns {string} Length-capped string
 */
export function capLength(text, maxLen, ellipsis = true) {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + (ellipsis ? '...' : '');
}

/**
 * Full sanitization pipeline for a display name.
 * Caps at 100 chars + HTML escapes.
 */
export function sanitizeDisplayName(name) {
    return escapeHtml(capLength(name, 100, false));
}

/**
 * Full sanitization pipeline for a bio/about field.
 * Caps at 500 chars for storage, 150 for inline preview. HTML escapes both.
 */
export function sanitizeBio(about, previewLen = 150) {
    const safe = capLength(about, 500, false);
    const preview = escapeHtml(capLength(safe, previewLen));
    const full = escapeHtml(safe);
    return { preview, full };
}

/**
 * Sanitize a NIP-05 identifier for display. Truncates long usernames.
 */
export function sanitizeNip05(nip05) {
    if (!nip05) return '';
    let display = escapeHtml(nip05);
    if (display.length > 30) {
        const atIndex = display.indexOf('@');
        if (atIndex > 0) {
            const username = display.substring(0, atIndex);
            const domain = display.substring(atIndex);
            if (username.length > 10) {
                display = username.substring(0, 10) + '...' + domain;
            }
        } else {
            display = display.substring(0, 28) + '...';
        }
    }
    return display;
}


// =============================================================================
// SECTION 3: SECURE KEY STORE (closure-based nsec protection)
// =============================================================================

/**
 * Creates a SecureKeyStore instance.
 *
 * The private key is held inside a closure with NO .get() method exposed.
 * XSS scripts cannot read the raw key — they can only trigger .signEvent(),
 * which returns a signed Nostr event (useless without the key itself).
 *
 * The key bytes are zeroed out on .clear() to prevent memory forensics.
 *
 * @param {object} NostrTools - The nostr-tools library (must have finalizeEvent)
 * @returns {Readonly<{set, has, clear, signEvent}>}
 */
export function createSecureKeyStore(NostrTools) {
    let _secretKey = null;

    return Object.freeze({
        /** Store a secret key (Uint8Array). */
        set(key) {
            _secretKey = key;
        },

        /** Returns true if a key is currently held. */
        has() {
            return _secretKey !== null;
        },

        /** Zeros out key bytes and nullifies the reference. */
        clear() {
            if (_secretKey) {
                for (let i = 0; i < _secretKey.length; i++) {
                    _secretKey[i] = 0;
                }
                _secretKey = null;
            }
        },

        /**
         * Sign an unsigned Nostr event using the stored key.
         * The raw key never leaves this closure.
         *
         * @param {object} event - Unsigned Nostr event object
         * @returns {object} Finalized (signed) Nostr event
         * @throws If no key is stored
         */
        signEvent(event) {
            if (!_secretKey) throw new Error('No key available');
            return NostrTools.finalizeEvent(event, _secretKey);
        }
    });
}


// =============================================================================
// SECTION 4: INACTIVITY AUTO-LOGOUT (for nsec sessions)
// =============================================================================

/**
 * Creates an inactivity monitor that auto-logs out nsec users.
 *
 * Tracks mouse, keyboard, scroll, and touch events. If no activity
 * for `timeoutMs`, calls the provided `onLogout` callback.
 * Also handles visibility-change (tab hidden) timeout checks.
 *
 * @param {object} options
 * @param {number}   options.timeoutMs       - Inactivity timeout in ms (default: 15 min)
 * @param {function} options.onLogout        - Called when auto-logout triggers
 * @param {function} options.isNsecSession   - Returns true if current session is nsec-based
 * @returns {{reset, destroy}}
 */
export function createInactivityMonitor({ timeoutMs = 15 * 60 * 1000, onLogout, isNsecSession }) {
    let timer = null;
    let lastActivity = Date.now();

    function reset() {
        lastActivity = Date.now();
        if (!isNsecSession()) return;

        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            console.log('Auto-logout: inactivity timeout');
            onLogout();
        }, timeoutMs);
    }

    // Track user activity
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    const handler = () => {
        if (isNsecSession()) reset();
    };
    events.forEach(evt => document.addEventListener(evt, handler, { passive: true }));

    // Handle tab visibility changes
    const visHandler = () => {
        if (!isNsecSession()) return;
        if (document.hidden) {
            // Timer keeps running while hidden
        } else {
            // Tab visible again — check elapsed time
            const elapsed = Date.now() - lastActivity;
            if (elapsed > timeoutMs) {
                console.log('Auto-logout: inactive while tab was hidden');
                onLogout();
            } else {
                reset();
            }
        }
    };
    document.addEventListener('visibilitychange', visHandler);

    // Clean up key material on page unload
    const unloadHandler = () => {
        if (timer) { clearTimeout(timer); timer = null; }
    };
    window.addEventListener('beforeunload', unloadHandler);

    return {
        reset,
        destroy() {
            if (timer) { clearTimeout(timer); timer = null; }
            events.forEach(evt => document.removeEventListener(evt, handler));
            document.removeEventListener('visibilitychange', visHandler);
            window.removeEventListener('beforeunload', unloadHandler);
        }
    };
}


// =============================================================================
// SECTION 5: SPAM & NSFW DETECTION
// =============================================================================

/**
 * Heuristic spam score for a Nostr profile. Higher = more likely spam.
 * Threshold of ~50 is a reasonable cutoff.
 *
 * @param {object} profile - { name, about, picture }
 * @param {Array}  notes   - Array of note events
 * @returns {number} Spam score (0–100+)
 */
export function detectSpam(profile, notes) {
    let score = 0;
    const name = (profile.name || '').toLowerCase().trim();
    const about = (profile.about || '').toLowerCase().trim();

    const spamPhrases = [
        'hello world', 'test test', 'testing 123', 'this is a test',
        'hello nostr', 'first post', 'new here'
    ];
    for (const phrase of spamPhrases) {
        if (about.includes(phrase) && about.length < 50) score += 30;
    }

    const deletedSignals = [
        'account deleted', 'account removed', 'goodbye',
        'leaving nostr', 'no longer active'
    ];
    for (const phrase of deletedSignals) {
        if (about.includes(phrase)) score += 40;
    }

    if (about.length === 0) score += 20;
    if (about.length > 0 && about.length < 10) score += 15;
    if (name.match(/^user\d+$/i)) score += 25;
    if (name.match(/^anon\d+$/i)) score += 20;
    if (name === 'anon' || name === '') score += 10;
    if (name === 'nobody' || name === 'deleted' || name === 'test') score += 35;
    if (!profile.picture) score += 10;
    if (notes && notes.length === 0) score += 20;
    if (notes && notes.length === 1) score += 10;

    if (notes && notes.length > 1) {
        const contents = notes.map(n => n.content.toLowerCase());
        const unique = new Set(contents);
        if (unique.size < notes.length / 2) score += 15;
    }

    return score;
}

/**
 * Detects NSFW content in a profile and its notes.
 *
 * @param {object} profile - { name, about }
 * @param {Array}  notes   - Array of note events
 * @returns {boolean}
 */
export function detectNSFW(profile, notes) {
    const nsfwKeywords = [
        'nsfw', 'xxx', '18+', 'porn', 'onlyfans', 'nude',
        'nudes', 'erotic', 'adult content', '🔞', 'hentai', 'camgirl', 'explicit'
    ];

    function check(text) {
        if (!text) return false;
        const lower = text.toLowerCase();
        return nsfwKeywords.some(kw => lower.includes(kw));
    }

    if (check(profile.about) || check(profile.name)) return true;

    if (notes && notes.length > 0) {
        for (const note of notes) {
            if (check(note.content)) return true;

            const tags = note.tags?.filter(t => t[0] === 't').map(t => t[1].toLowerCase()) || [];
            for (const tag of tags) {
                if (check(tag)) return true;
            }

            const warnings = note.tags?.filter(t => t[0] === 'content-warning') || [];
            if (warnings.length > 0) return true;
        }
    }

    return false;
}

/**
 * Detects likely deleted/deactivated accounts.
 */
export function detectDeletedAccount(profile, notes, follows) {
    if (!profile) return false;
    const name = (profile.name || '').toLowerCase();
    const about = (profile.about || '').toLowerCase();

    if (name === 'deleted' || name === '[deleted]' || name === 'deactivated') return true;

    if (name === 'nobody') {
        const hasNotes = notes && notes.length > 0;
        const hasFollows = follows && follows.length > 0;
        const hasAbout = about && about.length > 5;
        if (!hasNotes && !hasFollows && !hasAbout) return true;
    }

    if (about === 'deleted' || about === '[deleted]' || about === 'account deactivated') return true;

    return false;
}


// =============================================================================
// SECTION 6: NOSTR AUTH MANAGER (Extension, Bunker, nsec)
// =============================================================================

/**
 * Creates a full Nostr authentication manager supporting three login methods:
 *   1. NIP-07 browser extension (Alby, nos2x, etc.)
 *   2. NIP-46 Nostr Connect / Bunker (Amber, nsec.app, etc.)
 *   3. Direct nsec private key (stored in SecureKeyStore)
 *
 * @param {object} deps
 * @param {object}   deps.NostrTools       - Core nostr-tools import
 * @param {object}   deps.nip19            - NostrTools.nip19
 * @param {function} deps.fetchProfile     - async (pubkey) => profile object
 * @param {function} deps.fetchFollows     - async (pubkey) => string[] of pubkeys
 * @param {function} deps.onLoginSuccess   - Called after successful login with { pubkey, npub, profile, loginMethod, follows }
 * @param {function} deps.onLogout         - Called after logout
 * @param {object}   [deps.BunkerSigner]   - nip46.BunkerSigner (optional, for bunker login)
 * @param {function} [deps.parseBunkerInput] - nip46.parseBunkerInput (optional)
 * @param {object}   [deps.BunkerSimplePool] - pool.SimplePool from nip46-compatible version
 * @returns {object} Auth manager API
 */
export function createNostrAuth(deps) {
    const {
        NostrTools, nip19, fetchProfile, fetchFollows,
        onLoginSuccess, onLogout: onLogoutCallback,
        BunkerSigner, parseBunkerInput, BunkerSimplePool
    } = deps;

    const SecureKeyStore = createSecureKeyStore(NostrTools);
    let currentUser = null;
    let bunkerSigner = null;
    let bunkerConnectAbort = null;

    // Inactivity monitor (created on nsec login, destroyed on logout)
    let inactivityMonitor = null;

    // -------------------------------------------------------------------------
    // LOGIN METHOD 1: NIP-07 Browser Extension
    // -------------------------------------------------------------------------
    async function loginWithExtension() {
        if (typeof window.nostr === 'undefined') {
            throw new Error('No Nostr browser extension found. Install Alby, nos2x, or similar.');
        }

        const pubkey = await window.nostr.getPublicKey();
        const npub = nip19.npubEncode(pubkey);
        const profile = await fetchProfile(pubkey);
        const follows = await fetchFollows(pubkey);

        currentUser = { pubkey, npub, profile, loginMethod: 'extension' };
        onLoginSuccess({ ...currentUser, follows });
        return currentUser;
    }

    // -------------------------------------------------------------------------
    // LOGIN METHOD 2: nsec Private Key
    // -------------------------------------------------------------------------
    async function loginWithNsec(nsecString) {
        if (!nsecString) throw new Error('Please enter your nsec');
        if (!nsecString.startsWith('nsec1')) throw new Error('Invalid nsec format. Must start with nsec1');

        const { data: secretKey } = nip19.decode(nsecString);

        if (secretKey.length !== 32) throw new Error('Invalid secret key length');

        const pubkey = NostrTools.getPublicKey(secretKey);
        const npub = nip19.npubEncode(pubkey);

        // Store key securely — no .get() method, XSS cannot extract it
        SecureKeyStore.set(secretKey);

        const profile = await fetchProfile(pubkey);
        const follows = await fetchFollows(pubkey);

        currentUser = { pubkey, npub, profile, loginMethod: 'nsec' };

        // Start inactivity auto-logout
        inactivityMonitor = createInactivityMonitor({
            timeoutMs: 15 * 60 * 1000,
            onLogout: () => {
                logout();
                alert('You were logged out for security after 15 minutes of inactivity.');
            },
            isNsecSession: () => currentUser?.loginMethod === 'nsec'
        });
        inactivityMonitor.reset();

        onLoginSuccess({ ...currentUser, follows });
        return currentUser;
    }

    // -------------------------------------------------------------------------
    // LOGIN METHOD 3: NIP-46 Bunker (QR / nostrconnect:// flow)
    // -------------------------------------------------------------------------
    async function loginWithBunkerQR({ relays, appName = 'Nostr App', onStatus, onAuthUrl }) {
        if (!BunkerSigner) throw new Error('NIP-46 module not loaded');

        const localSecretKey = NostrTools.generateSecretKey();
        const localPubkey = NostrTools.getPublicKey(localSecretKey);

        // Generate random verification secret
        const secretBytes = new Uint8Array(16);
        crypto.getRandomValues(secretBytes);
        const secret = Array.from(secretBytes).map(b => b.toString(16).padStart(2, '0')).join('');

        const bunkerRelays = relays || ['wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol'];
        const relayParams = bunkerRelays.map(r => `relay=${encodeURIComponent(r)}`).join('&');
        const connectURI = `nostrconnect://${localPubkey}?${relayParams}&secret=${secret}&name=${encodeURIComponent(appName)}`;

        onStatus?.('waiting', 'Waiting for signer to connect...');

        const bunkerPool = new BunkerSimplePool();
        const signer = await BunkerSigner.fromURI(
            localSecretKey,
            connectURI,
            {
                pool: bunkerPool,
                onauth: (url) => {
                    onAuthUrl?.(url);
                    window.open(url, '_blank', 'width=600,height=700');
                }
            },
            300000 // 5 minute timeout
        );

        bunkerSigner = signer;
        const userPubkey = await signer.getPublicKey();
        const npub = nip19.npubEncode(userPubkey);

        // Save for reconnection
        const skHex = Array.from(localSecretKey).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('bunker_local_sk', skHex);
        localStorage.setItem('bunker_relays', JSON.stringify(bunkerRelays));
        localStorage.setItem('bunker_user_pubkey', userPubkey);

        const profile = await fetchProfile(userPubkey);
        const follows = await fetchFollows(userPubkey);

        currentUser = { pubkey: userPubkey, npub, profile, loginMethod: 'bunker' };
        onLoginSuccess({ ...currentUser, follows });

        return { currentUser, connectURI };
    }

    // -------------------------------------------------------------------------
    // LOGIN METHOD 3b: NIP-46 Bunker URL (bunker:// flow)
    // -------------------------------------------------------------------------
    async function loginWithBunkerURL(bunkerURL, { onStatus, onAuthUrl } = {}) {
        if (!BunkerSigner || !parseBunkerInput) throw new Error('NIP-46 module not loaded');
        if (!bunkerURL?.startsWith('bunker://')) throw new Error('URL must start with bunker://');

        const bunkerPointer = await parseBunkerInput(bunkerURL);
        if (!bunkerPointer) throw new Error('Invalid bunker URL format');
        if (!bunkerPointer.relays?.length) throw new Error('No relays specified in bunker URL');

        const localSecretKey = NostrTools.generateSecretKey();
        const bunkerPool = new BunkerSimplePool();

        let signer;
        if (typeof BunkerSigner.fromBunker === 'function') {
            signer = BunkerSigner.fromBunker(localSecretKey, bunkerPointer, {
                pool: bunkerPool,
                onauth: (url) => { onAuthUrl?.(url); window.open(url, '_blank', 'width=600,height=700'); }
            });
        } else {
            signer = new BunkerSigner(localSecretKey, bunkerPointer, {
                pool: bunkerPool,
                onauth: (url) => { onAuthUrl?.(url); window.open(url, '_blank', 'width=600,height=700'); }
            });
        }

        await signer.connect();
        bunkerSigner = signer;

        const userPubkey = await signer.getPublicKey();
        const npub = nip19.npubEncode(userPubkey);

        // Save for reconnection
        const skHex = Array.from(localSecretKey).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('bunker_local_sk', skHex);
        localStorage.setItem('bunker_relays', JSON.stringify(bunkerPointer.relays));
        localStorage.setItem('bunker_remote_signer_pubkey', bunkerPointer.pubkey);
        localStorage.setItem('bunker_user_pubkey', userPubkey);
        if (bunkerPointer.secret) localStorage.setItem('bunker_secret', bunkerPointer.secret);

        const profile = await fetchProfile(userPubkey);
        const follows = await fetchFollows(userPubkey);

        currentUser = { pubkey: userPubkey, npub, profile, loginMethod: 'bunker' };
        onLoginSuccess({ ...currentUser, follows });
        return currentUser;
    }

    // -------------------------------------------------------------------------
    // SIGN EVENT (dispatches to correct method)
    // -------------------------------------------------------------------------
    async function signEvent(event) {
        if (!currentUser) throw new Error('Not logged in');

        if (currentUser.loginMethod === 'extension') {
            return await window.nostr.signEvent(event);
        } else if (currentUser.loginMethod === 'nsec' && SecureKeyStore.has()) {
            return SecureKeyStore.signEvent(event);
        } else if (currentUser.loginMethod === 'bunker' && bunkerSigner) {
            return await bunkerSigner.signEvent(event);
        }
        throw new Error('No signing method available');
    }

    // -------------------------------------------------------------------------
    // LOGOUT (full cleanup)
    // -------------------------------------------------------------------------
    function logout() {
        const wasNsec = currentUser?.loginMethod === 'nsec';
        const wasBunker = currentUser?.loginMethod === 'bunker';

        currentUser = null;

        // Wipe nsec key bytes from memory
        SecureKeyStore.clear();

        // Destroy inactivity monitor
        if (inactivityMonitor) {
            inactivityMonitor.destroy();
            inactivityMonitor = null;
        }

        // Close bunker signer connection
        if (bunkerSigner) {
            try { bunkerSigner.close(); } catch (e) { /* ignore */ }
            bunkerSigner = null;
        }

        // Clear bunker reconnection data from localStorage
        localStorage.removeItem('bunker_local_sk');
        localStorage.removeItem('bunker_relays');
        localStorage.removeItem('bunker_remote_signer_pubkey');
        localStorage.removeItem('bunker_user_pubkey');
        localStorage.removeItem('bunker_secret');

        onLogoutCallback?.();
    }

    // -------------------------------------------------------------------------
    // PAGE UNLOAD HANDLER — wipe keys on navigation/close
    // -------------------------------------------------------------------------
    window.addEventListener('beforeunload', () => {
        SecureKeyStore.clear();
        if (inactivityMonitor) { inactivityMonitor.destroy(); inactivityMonitor = null; }
        if (bunkerSigner) { try { bunkerSigner.close(); } catch (e) { /* ignore */ } }
    });

    // -------------------------------------------------------------------------
    // PUBLIC API
    // -------------------------------------------------------------------------
    return {
        loginWithExtension,
        loginWithNsec,
        loginWithBunkerQR,
        loginWithBunkerURL,
        signEvent,
        logout,
        getCurrentUser: () => currentUser,
        isLoggedIn: () => currentUser !== null,
        getLoginMethod: () => currentUser?.loginMethod || null,
        hasBunkerSupport: () => !!BunkerSigner,
    };
}


// =============================================================================
// SECTION 7: INTEGRATION EXAMPLE
// =============================================================================

/*
// ─── In your HTML <head> ───────────────────────────────────────────────
// Paste the CSP meta tags from Section 1 above.

// ─── In your <script type="module"> ────────────────────────────────────

import * as NostrTools from "https://esm.sh/nostr-tools@2.7.2";

// Optional: NIP-46 bunker support
let BunkerSigner, parseBunkerInput, BunkerSimplePool;
try {
    const nip46 = await import("https://esm.sh/nostr-tools@2.23.0/nip46");
    const poolMod = await import("https://esm.sh/nostr-tools@2.23.0/pool");
    BunkerSigner = nip46.BunkerSigner;
    parseBunkerInput = nip46.parseBunkerInput;
    BunkerSimplePool = poolMod.SimplePool;
} catch (e) {
    console.warn('NIP-46 not available:', e.message);
}

import {
    escapeHtml,
    sanitizeUrl,
    sanitizeDisplayName,
    sanitizeBio,
    sanitizeNip05,
    detectSpam,
    detectNSFW,
    detectDeletedAccount,
    createNostrAuth
} from './nostr-auth-security-kit.js';

// ─── Initialize auth ───────────────────────────────────────────────────

const auth = createNostrAuth({
    NostrTools,
    nip19: NostrTools.nip19,
    fetchProfile: async (pubkey) => {
        // Your relay query for kind:0
    },
    fetchFollows: async (pubkey) => {
        // Your relay query for kind:3 → return array of pubkey strings
    },
    onLoginSuccess: ({ pubkey, npub, profile, loginMethod, follows }) => {
        console.log(`Logged in as ${npub} via ${loginMethod}`);
        // Update your UI here
    },
    onLogout: () => {
        console.log('Logged out');
        // Reset your UI here
    },
    BunkerSigner,
    parseBunkerInput,
    BunkerSimplePool,
});

// ─── Wire up your login buttons ────────────────────────────────────────

document.getElementById('ext-login-btn').onclick = () => auth.loginWithExtension();

document.getElementById('nsec-login-btn').onclick = () => {
    const nsec = document.getElementById('nsec-input').value.trim();
    document.getElementById('nsec-input').value = ''; // Always clear immediately
    auth.loginWithNsec(nsec);
};

document.getElementById('logout-btn').onclick = () => auth.logout();

// ─── Rendering user content safely ────────────────────────────────────

function renderProfile(profile) {
    const name = sanitizeDisplayName(profile.name);
    const { preview: bio } = sanitizeBio(profile.about);
    const picture = sanitizeUrl(profile.picture) || '/default-avatar.png';
    const nip05 = sanitizeNip05(profile.nip05);

    // Safe to use in innerHTML because everything is escaped
    return `
        <img src="${picture}" onerror="this.src='/default-avatar.png'">
        <h3>${name}</h3>
        <p>${bio}</p>
        ${nip05 ? `<span class="nip05">✓ ${nip05}</span>` : ''}
    `;
}

// ─── Signing events ────────────────────────────────────────────────────

async function publishNote(content) {
    const event = {
        kind: 1,
        pubkey: auth.getCurrentUser().pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content,
    };
    const signed = await auth.signEvent(event);
    await pool.publish(RELAYS, signed);
}

// ─── Content filtering ─────────────────────────────────────────────────

function shouldShowProfile(profile, notes) {
    if (detectSpam(profile, notes) >= 50) return false;
    if (detectNSFW(profile, notes)) return false;
    if (detectDeletedAccount(profile, notes, [])) return false;
    return true;
}
*/
