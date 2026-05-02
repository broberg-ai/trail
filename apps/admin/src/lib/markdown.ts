/**
 * F22 — centralised marked configuration with claim-anchor extension.
 *
 * The compile pipeline (packages/core/src/compile/claim-anchors.ts)
 * injects `{#claim-xxx}` markers into headings, list items, and
 * paragraph-leader lines. This module installs a marked extension
 * that strips those markers from rendered text AND emits them as
 * HTML `id="claim-xxx"` attributes on the corresponding element.
 *
 * Single import point so panels (wiki-reader, sources, queue, chat,
 * neuron-editor) all get the same behaviour without each panel
 * configuring marked separately.
 */
import { marked } from 'marked';

const ANCHOR_REGEX_GLOBAL = /\{#(claim-[a-f0-9]{8})\}/g;

let installed = false;

/**
 * Install the F22 anchor renderer once. Idempotent — subsequent
 * calls no-op.
 */
export function ensureAnchorMarkedExtensions(): void {
  if (installed) return;
  installed = true;

  marked.use({
    walkTokens: (token) => {
      // Only mutate token kinds we know about. Heading + paragraph +
      // list_item tokens carry their text via `text`/`raw`. We strip
      // the anchor marker from the user-visible text and stash the
      // anchor id in a side-channel via __anchorId so the renderer
      // can pick it up.
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
        const id = token.__anchorId ? ` id="${token.__anchorId}"` : '';
        const inner = (this as { parser: { parseInline: (t: unknown[]) => string } }).parser.parseInline(
          (token as unknown as { tokens?: unknown[] }).tokens ?? [],
        );
        return `<h${token.depth}${id}>${inner}</h${token.depth}>\n`;
      },
      paragraph(this: unknown, token: { text: string; __anchorId?: string; tokens?: unknown[] }) {
        const id = token.__anchorId ? ` id="${token.__anchorId}"` : '';
        const inner = (this as { parser: { parseInline: (t: unknown[]) => string } }).parser.parseInline(
          token.tokens ?? [],
        );
        return `<p${id}>${inner}</p>\n`;
      },
      listitem(this: unknown, token: { __anchorId?: string; tokens?: unknown[] }) {
        const id = token.__anchorId ? ` id="${token.__anchorId}"` : '';
        const inner = (this as { parser: { parse: (t: unknown[]) => string } }).parser.parse(
          token.tokens ?? [],
        );
        return `<li${id}>${inner}</li>\n`;
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
