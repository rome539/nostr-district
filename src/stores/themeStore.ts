/**
 * themeStore.ts — UI colour themes with CSS variable injection
 *
 * Defines built-in presets and injects --nd-xxx CSS custom properties
 * on :root whenever the active theme changes. All HTML overlay components
 * (chat, settings, gif picker, etc.) reference var(--nd-xxx) so they
 * update live without re-render.
 *
 * Kind 16767 (ditto-style custom themes) is handled separately — TBD.
 */

export interface Theme {
  id: string;
  name: string;
  bg: string;
  navy: string;
  accent: string;
  purp: string;
  dpurp: string;
  text: string;
  subtext: string;
}

export const THEMES: Theme[] = [
  {
    id: 'district',
    name: 'District',
    bg: '#0a0014',
    navy: '#1a1040',
    accent: '#5dcaa5',
    purp: '#7b68ee',
    dpurp: '#4a2d8e',
    text: '#fff5e6',
    subtext: '#b8a8f8',
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    bg: '#1a0030',
    navy: '#2a0058',
    accent: '#ff71ce',
    purp: '#b967ff',
    dpurp: '#7000b0',
    text: '#fffb96',
    subtext: '#e0b0ff',
  },
  {
    id: 'matrix',
    name: 'Matrix',
    bg: '#000a00',
    navy: '#001800',
    accent: '#00ff41',
    purp: '#00cc22',
    dpurp: '#007700',
    text: '#ccffcc',
    subtext: '#80cc80',
  },
  {
    id: 'amber',
    name: 'Amber',
    bg: '#0d0800',
    navy: '#1a1000',
    accent: '#f0b040',
    purp: '#c07820',
    dpurp: '#8b4500',
    text: '#fff3d0',
    subtext: '#d4a855',
  },
];

const STORAGE_KEY = 'nd_theme';

function applyThemeCss(theme: Theme): void {
  let el = document.getElementById('nd-theme-vars') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'nd-theme-vars';
    document.head.appendChild(el);
  }
  el.textContent = `
    :root {
      --nd-bg: ${theme.bg};
      --nd-navy: ${theme.navy};
      --nd-accent: ${theme.accent};
      --nd-purp: ${theme.purp};
      --nd-dpurp: ${theme.dpurp};
      --nd-text: ${theme.text};
      --nd-subtext: ${theme.subtext};
    }
  `;
}

class ThemeStore {
  private _current: Theme;
  private _listeners: Array<(theme: Theme) => void> = [];

  constructor() {
    const saved = localStorage.getItem(STORAGE_KEY);
    this._current = THEMES.find(t => t.id === saved) ?? THEMES[0];
    applyThemeCss(this._current);
  }

  get current(): Theme { return this._current; }

  set(id: string): void {
    const theme = THEMES.find(t => t.id === id);
    if (!theme || theme === this._current) return;
    this._current = theme;
    localStorage.setItem(STORAGE_KEY, id);
    applyThemeCss(theme);
    this._listeners.forEach(fn => fn(theme));
  }

  onChange(fn: (theme: Theme) => void): () => void {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }
}

export const themeStore = new ThemeStore();
