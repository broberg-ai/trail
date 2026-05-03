/**
 * F22 — centralised marked configuration with claim-anchor extension.
 *
 * The compile pipeline (packages/core/src/compile/claim-anchors.ts)
 * injects `{#claim-xxx}` markers into headings, list items, and
 * paragraph-leader lines. This module installs a marked extension
 * that strips those markers from rendered text AND emits them as:
 *
 *   1. HTML `id="claim-xxx"` on the corresponding block element so
 *      `#claim-xxx` URL fragments scroll to the right paragraph.
 *   2. A small `<a class="claim-anchor">` icon at the start of the
 *      block, with `title="claim-xxx"` for hover-tooltip and an
 *      `href="#claim-xxx"` so click copies a deep-link.
 *
 * Visibility of the icon is curator-controllable via a CSS class on
 * the article wrapper: `.claims-hidden .claim-anchor { display: none }`.
 * The wiki-reader stores the preference in localStorage so it
 * survives reloads.
 *
 * Single import point so panels (wiki-reader, sources, queue, chat,
 * neuron-editor) all get the same behaviour without each panel
 * configuring marked separately.
 */
import { marked } from 'marked';

const ANCHOR_REGEX_GLOBAL = /\{#(claim-[a-f0-9]{8})\}/g;

let installed = false;

function anchorIconHtml(id: string): string {
  // `tabindex="-1"` keeps the icon out of the keyboard tab-order so a
  // curator reading prose isn't dragged through a marker on every
  // paragraph; the link still works on click + screen-reader focus.
  // `title` carries the full id for hover-tooltip per Christian's
  // 2026-05-03 ask.
  return (
    `<a class="claim-anchor" href="#${id}" title="${id}" ` +
    `aria-label="Anchor: ${id}" tabindex="-1">#</a>`
  );
}

/**
 * Install the F22 anchor renderer once. Idempotent — subsequent
 * calls no-op.
 */
export function ensureAnchorMarkedExtensions(): void {
  if (installed) return;
  installed = true;

  marked.use({
    walkTokens: (token) => {
      // Inline text tokens carry the raw paragraph text that
      // parseInline() ultimately reads from. The block-level token's
      // `text`/`raw` are NOT what gets rendered — those come from the
      // inline `tokens[]` array. Strip from both so the marker never
      // surfaces in the final HTML even when it sits at position 0
      // of a paragraph.
      if (token.type === 'text') {
        const t = token as unknown as { text?: string; raw?: string };
        if (typeof t.text === 'string' && ANCHOR_REGEX_GLOBAL.test(t.text)) {
          // Reset lastIndex — `test` on a /g regex advances state.
          ANCHOR_REGEX_GLOBAL.lastIndex = 0;
          t.text = t.text.replace(ANCHOR_REGEX_GLOBAL, '').replace(/^\s+/, '');
        }
        if (typeof t.raw === 'string') {
          t.raw = t.raw.replace(ANCHOR_REGEX_GLOBAL, '').replace(/^\s+/, '');
        }
        return;
      }
      // Block-level tokens: extract the id (for the renderer's id-attr +
      // icon) and clean text/raw. The renderer uses __anchorId.
      if (
        token.type !== 'heading' &&
        token.type !== 'paragraph' &&
        token.type !== 'list_item'
      ) {
        return;
      }
      const t = token as unknown as { text?: string; raw?: string; __anchorId?: string };
      const fields: Array<'text' | 'raw'> = ['text', 'raw'];
      let id: string | undefined;
      for (const f of fields) {
        const v = t[f];
        if (typeof v !== 'string') continue;
        ANCHOR_REGEX_GLOBAL.lastIndex = 0;
        const m = v.match(ANCHOR_REGEX_GLOBAL);
        if (m && m[0]) {
          const inner = m[0].slice(2, -1); // strip {# and }
          id = inner;
        }
        t[f] = v.replace(ANCHOR_REGEX_GLOBAL, '').replace(/\n{3,}/g, '\n\n').trim();
      }
      if (id) t.__anchorId = id;
    },
    renderer: {
      heading(this: unknown, token: { depth: number; text: string; __anchorId?: string }) {
        const id = token.__anchorId;
        const idAttr = id ? ` id="${id}"` : '';
        const icon = id ? anchorIconHtml(id) : '';
        const inner = (this as { parser: { parseInline: (t: unknown[]) => string } }).parser.parseInline(
          (token as unknown as { tokens?: unknown[] }).tokens ?? [],
        );
        return `<h${token.depth}${idAttr}>${icon}${inner}</h${token.depth}>\n`;
      },
      paragraph(this: unknown, token: { text: string; __anchorId?: string; tokens?: unknown[] }) {
        const id = token.__anchorId;
        const idAttr = id ? ` id="${id}"` : '';
        const icon = id ? anchorIconHtml(id) : '';
        const inner = (this as { parser: { parseInline: (t: unknown[]) => string } }).parser.parseInline(
          token.tokens ?? [],
        );
        return `<p${idAttr}>${icon}${inner}</p>\n`;
      },
      listitem(this: unknown, token: { __anchorId?: string; tokens?: unknown[] }) {
        const id = token.__anchorId;
        const idAttr = id ? ` id="${id}"` : '';
        const icon = id ? anchorIconHtml(id) : '';
        const inner = (this as { parser: { parse: (t: unknown[]) => string } }).parser.parse(
          token.tokens ?? [],
        );
        return `<li${idAttr}>${icon}${inner}</li>\n`;
      },
    },
  });
}

/**
 * Strip naked `{#claim-xxx}` markers from any string — fallback
 * for surfaces that render markdown without the marked extension
 * (e.g. plain-text previews).
 */
export function stripAnchorMarkers(text: string): string {
  return text.replace(ANCHOR_REGEX_GLOBAL, '').trim();
}
