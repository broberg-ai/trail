/**
 * Theme store — applies `data-theme="light|dark"` to <html> and persists the
 * mode to localStorage. Two modes only (no "follow system") — the toggle has
 * no label so adding a third state the user has to infer is bad UX.
 */

export type Theme = 'light' | 'dark';

export { TITELFARVE as titelfarver };

const STORAGE_KEY = 'trail.admin.theme';
const DEFAULT: Theme = 'light';

const listeners = new Set<(theme: Theme) => void>();

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return DEFAULT;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'dark' ? 'dark' : 'light';
}

/**
 * F270 — TITELLINJEN I DEN INSTALLEREDE APP.
 *
 * Chrome maler PWA-vinduets titellinje med `theme-color`. index.html havde to
 * media-scopede metas (`prefers-color-scheme`), og DET ER FORKERT AF
 * KONSTRUKTION her: dette tema følger ikke styresystemet, det følger
 * localStorage. Vælger man mørkt på en lys Mac, fulgte metaen maskinen mens
 * app'en fulgte valget — og man fik en creme stribe med trafiklys og ⋮ klistret
 * oven på et mørkt design.
 *
 * Farven har derfor ÉN kilde nu: det tema der faktisk er anvendt. Værdierne er
 * de samme som index.html's egen bootstrap-CSS og index.css' tokens.
 */
const TITELFARVE: Record<Theme, string> = { light: '#FAF9F5', dark: '#17140F' };

function applyThemeColor(theme: Theme): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', TITELFARVE[theme]);
}

function apply(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeColor(theme);
}

let current: Theme = DEFAULT;

export function initTheme(): void {
  current = readStored();
  apply(current);
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  apply(theme);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, theme);
  }
  for (const listener of listeners) listener(theme);
}

export function toggleTheme(): Theme {
  setTheme(current === 'light' ? 'dark' : 'light');
  return current;
}

export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
