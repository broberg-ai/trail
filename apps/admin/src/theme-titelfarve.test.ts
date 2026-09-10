/**
 * F270 — titellinjen i den installerede app.
 *
 * Christian, 10/9 2026: den installerede PWA på hans Mac har en creme stribe
 * med trafiklys og ⋮ oven på et mørkt design. Chrome maler den stribe med
 * `theme-color`.
 *
 * ROOT CAUSE, og den er ikke manifestet: index.html havde
 *     <meta name="theme-color" media="(prefers-color-scheme: dark)">
 * altså farven bundet til STYRESYSTEMET — mens dette tema følger localStorage
 * og har «light» som default uanset hvad maskinen står på. De to kan derfor
 * være uenige, og det er præcis dét tilfælde han sad i.
 *
 * Første prøve er den negative kontrol: den er rød hvis farven holder op med
 * at følge det ANVENDTE tema.
 */
import { describe, expect, test, beforeEach } from 'bun:test';

function friskDom(): void {
  // Minimal DOM — bun:test har ingen browser, så vi bygger det metaen kræver.
  const head: { children: Array<{ name: string; content: string }> } = { children: [] };
  (globalThis as any).document = {
    documentElement: {
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      getAttribute(k: string) { return this.attrs[k] ?? null; },
    },
    head: { appendChild: (el: any) => head.children.push(el) },
    createElement: () => {
      const el: any = { name: '', content: '', setAttribute(k: string, v: string) { if (k === 'content') el.content = v; } };
      return el;
    },
    querySelector: (sel: string) =>
      sel.includes('theme-color') ? head.children.find((c) => c.name === 'theme-color') ?? null : null,
  };
  (globalThis as any).localStorage = {
    store: {} as Record<string, string>,
    getItem(k: string) { return this.store[k] ?? null; },
    setItem(k: string, v: string) { this.store[k] = v; },
  };
}

function metaFarve(): string | null {
  return (globalThis as any).document.querySelector('meta[name="theme-color"]')?.content ?? null;
}

describe('titelfarven følger det ANVENDTE tema', () => {
  beforeEach(() => { friskDom(); });

  test('mørkt tema → mørk titellinje, uanset hvad maskinen står på', async () => {
    const { setTheme } = await import('./theme.js');
    setTheme('dark');
    expect(metaFarve()).toBe('#17140F');
    expect((globalThis as any).document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('lyst tema → lys titellinje', async () => {
    const { setTheme } = await import('./theme.js');
    setTheme('light');
    expect(metaFarve()).toBe('#FAF9F5');
  });

  test('den følger MED når temaet skiftes — ikke kun ved opstart', async () => {
    const { setTheme } = await import('./theme.js');
    setTheme('light');
    setTheme('dark');
    expect(metaFarve()).toBe('#17140F');
    setTheme('light');
    expect(metaFarve()).toBe('#FAF9F5');
  });

  test('farverne er de SAMME som app\'ens egen palet', async () => {
    const { titelfarver } = await import('./theme.js');
    // Værdierne i index.html's bootstrap-CSS. Driver de fra hinanden, er
    // striben en anden farve end headeren lige under den.
    expect(titelfarver.light).toBe('#FAF9F5');
    expect(titelfarver.dark).toBe('#17140F');
  });
});
