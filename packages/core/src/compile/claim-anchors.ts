/**
 * F22 — Stable claim anchors for compiled Neurons.
 *
 * Each claim (heading, list item, paragraph) gets a hash-based ID
 * so external citations and intra-document links survive
 * re-compilation. The hash takes the first 50 chars of normalised
 * content — small rephrasings keep the same anchor; substantive
 * rewrites get a new one (which is correct: "the claim changed,
 * old citation is stale").
 *
 * Karpathy's gist solves this with Git SHAs per file. Trail's
 * DB-backed wiki has version numbers but no per-claim handle —
 * this fills the gap. Phase 3's F78 trust-tiers will join on
 * these anchors as the per-claim primary key without re-parsing.
 *
 * Pure functions, zero I/O. Safe to call from anywhere.
 */
import { createHash } from 'node:crypto';
import { deriveType } from '@trail/shared';

const ANCHOR_PREFIX = 'claim-';
const HASH_LENGTH = 8;
const NORMALISE_WINDOW = 50;
const ANCHOR_REGEX = /\{#claim-[a-f0-9]{8}\}/;
const ANCHOR_REGEX_GLOBAL = /\{#claim-[a-f0-9]{8}\}/g;

/**
 * Stable anchor for a claim's content. Same input → same anchor;
 * cosmetic edits (case, whitespace) outside the first 50 chars
 * also keep the anchor stable.
 */
export function generateClaimAnchor(content: string): string {
  const normalised = content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NORMALISE_WINDOW);
  const hash = createHash('sha256').update(normalised).digest('hex').slice(0, HASH_LENGTH);
  return `${ANCHOR_PREFIX}${hash}`;
}

/**
 * Walk markdown line-by-line, append `{#claim-xxx}` to headings
 * and list items, prepend it on its own line for paragraphs.
 *
 * Skipped:
 *   - lines that already carry an anchor (idempotent re-run)
 *   - YAML frontmatter (`---` fenced block at top)
 *   - code blocks (```...```)
 *   - blank lines and table separators
 *
 * Headings + list items get the anchor on the SAME line so marked
 * can pick it up via its standard heading-id renderer. Paragraphs
 * get the anchor on a separate preceding line so the rendered <p>
 * stays clean (preprocessor rewrites it to `<p id="...">`).
 */
export function injectClaimAnchors(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];

  let inFrontmatter = false;
  let inCodeBlock = false;
  let frontmatterClosed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Frontmatter: --- … ---
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      out.push(line);
      continue;
    }
    if (inFrontmatter) {
      out.push(line);
      if (line.trim() === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }
    void frontmatterClosed; // silence unused warning while keeping intent explicit

    // Code blocks: ``` toggles
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }
    if (inCodeBlock) {
      out.push(line);
      continue;
    }

    // Already anchored — skip (idempotent re-run)
    if (ANCHOR_REGEX.test(line)) {
      out.push(line);
      continue;
    }

    // Blank lines pass through
    if (line.trim().length === 0) {
      out.push(line);
      continue;
    }

    // Headings: # … → # … {#claim-xxx}
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[2]) {
      const anchor = generateClaimAnchor(headingMatch[2]);
      out.push(`${line} {#${anchor}}`);
      continue;
    }

    // List items: - … or * … or 1. …
    const listMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.+)$/);
    if (listMatch && listMatch[2]) {
      const anchor = generateClaimAnchor(listMatch[2]);
      out.push(`${line} {#${anchor}}`);
      continue;
    }

    // Skip table separators and HTML blocks
    if (/^[\s|:-]+$/.test(line) || /^\s*</.test(line)) {
      out.push(line);
      continue;
    }

    // Regular paragraph line. Two skip-cases:
    //   (a) Already anchored on the previous output line — happens
    //       on idempotent re-runs where {#claim-xxx} sits on its
    //       own line above the paragraph.
    //   (b) Continuation of a multi-line paragraph — prev is a
    //       non-anchor non-heading non-list non-blank line.
    // Only anchor the FIRST line of a fresh paragraph.
    const prev = out[out.length - 1];
    const prevIsAnchorLine = prev !== undefined && /^\{#claim-[a-f0-9]{8}\}$/.test(prev.trim());
    if (prevIsAnchorLine) {
      out.push(line);
      continue;
    }
    const isContinuation =
      prev !== undefined &&
      prev.trim().length > 0 &&
      !ANCHOR_REGEX.test(prev) &&
      !/^#{1,6}\s/.test(prev) &&
      !/^\s*(?:[-*+]|\d+\.)\s/.test(prev);
    if (isContinuation) {
      out.push(line);
      continue;
    }

    const anchor = generateClaimAnchor(line);
    out.push(`{#${anchor}}`);
    out.push(line);
  }

  return out.join('\n');
}

/**
 * Extract `{anchor → text}` map from anchored markdown. Used by
 * F78 trust-tiers (future) and the verify-script.
 */
export function extractClaimAnchors(markdown: string): Map<string, string> {
  const anchors = new Map<string, string>();
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = line.match(/\{#(claim-[a-f0-9]{8})\}/);
    if (!m || !m[1]) continue;
    const id = m[1];
    const onLine = line.replace(ANCHOR_REGEX_GLOBAL, '').trim();
    if (onLine.length > 0) {
      anchors.set(id, onLine);
    } else if (i + 1 < lines.length) {
      anchors.set(id, (lines[i + 1] ?? '').trim());
    }
  }
  return anchors;
}

/**
 * F101 — ensure the YAML frontmatter declares `type:` derived from
 * the document path. Pure transform: no I/O, idempotent. If
 * frontmatter is missing we don't synthesise one (the LLM-produced
 * content always has frontmatter in current pipelines, and adding
 * one out of nowhere risks shadowing curator-edited fields).
 */
export function ensureTypeFrontmatter(markdown: string, path: string): string {
  const type = deriveType(path);
  if (type === 'note') {
    // Don't pollute frontmatter with the catch-all label.
    return markdown;
  }

  // Check for existing frontmatter
  if (!markdown.startsWith('---\n')) {
    return markdown;
  }
  const closeIdx = markdown.indexOf('\n---', 4);
  if (closeIdx === -1) return markdown;
  const fm = markdown.slice(4, closeIdx);
  // Already has a type line? Replace; otherwise insert.
  const typeRegex = /^type:\s*\S+\s*$/m;
  if (typeRegex.test(fm)) {
    if (typeRegex.exec(fm)?.[0] === `type: ${type}`) return markdown;
    const newFm = fm.replace(typeRegex, `type: ${type}`);
    return `---\n${newFm}\n---${markdown.slice(closeIdx + 4)}`;
  }
  const newFm = `${fm.trimEnd()}\ntype: ${type}`;
  return `---\n${newFm}\n---${markdown.slice(closeIdx + 4)}`;
}

/**
 * Combined post-LLM transform: F22 anchors + F101 type frontmatter.
 * Single call-site in candidate-api.ts write() create branch keeps
 * the order deterministic.
 */
export function prepareCompiledMarkdown(content: string, path: string): string {
  const withType = ensureTypeFrontmatter(content, path);
  const withAnchors = injectClaimAnchors(withType);
  return withAnchors;
}
