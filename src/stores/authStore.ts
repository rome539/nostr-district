type LoginMethod = 'extension' | 'nsec' | 'bunker' | 'guest' | null;

interface AuthState {
  pubkey: string | null;
  npub: string | null;
  displayName: string | null;
  picture: string | null;
  profile: Record<string, any>;
  loginMethod: LoginMethod;
  isLoggedIn: boolean;
  isGuest: boolean;

  login: (data: {
    pubkey: string;
    npub: string;
    profile?: Record<string, any>;
    loginMethod: LoginMethod;
  }) => void;

  loginAsGuest: () => void;
  logout: () => void;
  setDisplayName: (name: string) => void;
}

// Simple store without external dependencies for now
// We'll use a global singleton pattern that works with Phaser
let state: AuthState;
const listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach(fn => fn());
}

export const authStore = {
  getState: (): AuthState => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setDisplayName: (name: string) => {
    state.displayName = name;
    notify();
  },
  updateProfile: (content: Record<string, any>) => {
    state.profile = { ...state.profile, ...content };
    if (content.display_name || content.name) {
      state.displayName = content.display_name || content.name;
    }
    if (content.picture) state.picture = content.picture;
    notify();
  },
};

state = {
  pubkey: null,
  npub: null,
  displayName: null,
  picture: null,
  profile: {},
  loginMethod: null,
  isLoggedIn: false,
  isGuest: false,

  login: (data) => {
    state.pubkey = data.pubkey;
    state.npub = data.npub;
    state.profile = data.profile || {};
    state.displayName = state.profile.display_name || state.profile.name || (data.npub?.slice(0, 12) + '...') || 'anon';
    state.picture = state.profile.picture || null;
    state.loginMethod = data.loginMethod;
    state.isLoggedIn = true;
    state.isGuest = data.loginMethod === 'guest';
    notify();
  },

  loginAsGuest: () => {
    const guestId = Math.random().toString(36).slice(2, 8);
    state.pubkey = null;
    state.npub = null;
    state.displayName = `guest_${guestId}`;
    state.picture = null;
    state.loginMethod = 'guest';
    state.isLoggedIn = false;
    state.isGuest = true;
    notify();
  },

  logout: () => {
    state.pubkey = null;
    state.npub = null;
    state.displayName = null;
    state.picture = null;
    state.profile = {};
    state.loginMethod = null;
    state.isLoggedIn = false;
    state.isGuest = false;
    notify();
  },

  setDisplayName: (name: string) => {
    state.displayName = name;
    notify();
  },
};