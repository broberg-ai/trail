import { useEffect, useMemo, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { marked } from 'marked';
import { showClaimAnchors } from '../lib/claim-anchors-pref';
import type { Document } from '@trail/shared';
import { formatSeqId, deriveType } from '@trail/shared';
import { useKb } from '../lib/kb-cache';
import { CopyId } from '../components/copy-id';
import {
  slugify,
  normalizedSlug,
  isHeuristicPath,
  isPinned,
  computeConfidence,
  HEURISTIC_FADED_THRESHOLD,
} from '@trail/shared';
import {
  listWikiPages,
  getDocumentContent,
  getNeuronProvenance,
  saveNeuronEdit,
  updateUserNote,
  NeuronEditConflictError,
  ApiError,
  type NeuronProvenance,
} from '../api';
import { rewriteWikiLinks } from '../lib/wiki-links';
import { displayPath } from '../lib/display-path';
import { t } from '../lib/i18n';
import { NeuronEditorPanel } from './neuron-editor';
import { TagChips, parseTags } from '../components/tag-chips';
import { CenteredLoader } from '../components/centered-loader';
import { ConnectorBadge } from '../components/connector-badge';
import { ConfidencePill } from '../components/confidence-pill';

/**
 * Single-Neuron panel. Routes between the read-only reader and the F91
 * edit-mode view based on the `?edit=1` query flag. Sub-components own
 * their own hooks so the hook-order rule holds across mode flips.
 */
export function WikiReaderPanel() {
  const route = useRoute();
  return route.query.edit === '1' ? <NeuronEditorPanel /> : <ReaderView />;
}

/**
 * Drop a leading YAML frontmatter block (`---\n…\n---\n`) from the body
 * before markdown rendering. Only touches content that STARTS with `---`
 * so mid-doc separators (hr rules) still render. If the closing fence
 * isn't found, returns the original content unchanged — safer than
 * swallowing the whole body on a malformed header.
 */
/**
 * Extract the `tags:` line from a leading YAML frontmatter block. Handles
 * both inline arrays (`tags: [a, b, "c d"]`) and the rarer block form
 * (`tags:\n  - a\n  - b`). Returns empty array when no frontmatter or no
 * tags line — the reader falls back to the DB column in that case.
 */
function parseFrontmatterTags(raw: string): string[] {
  if (!raw.startsWith('---')) return [];
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return [];
  const block = raw.slice(0, end);
  // Inline form: `tags: [a, b, "c"]`
  const inline = block.match(/^tags\s*:\s*\[(.+)\]\s*$/m);
  if (inline) {
    return inline[1]!
      .split(',')
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  // Block form: `tags:\n  - a\n  - b`
  const blockMatch = block.match(/^tags\s*:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (blockMatch) {
    return blockMatch[1]!
      .split('\n')
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .map((t) => t.replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return [];
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  // Require the opening `---` to be on its own line (next char is \n).
  if (raw[3] !== '\n' && raw[3] !== '\r') return raw;
  // Look for the closing `\n---\n` (allow trailing whitespace on either line).
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return raw;
  // Advance past the closing fence + its newline (may be \r\n).
  let after = end + 4;
  if (raw[after] === '\r') after++;
  if (raw[after] === '\n') after++;
  return raw.slice(after);
}

function ReaderView() {
  const route = useRoute();
  const kbId = route.params.kbId ?? '';
  const slug = decodeURIComponent(route.params.slug ?? '');
  const kb = useKb(kbId);
  const [pages, setPages] = useState<Document[] | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<NeuronProvenance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState<number | null>(null);
  // F112 — "Din tanke" / Luhmann-friction note. Local form-state vs
  // server value tracked separately so dirty-check works honestly.
  // null = not yet loaded; '' = loaded and empty.
  const [userNote, setUserNote] = useState<string | null>(null);
  const [userNoteServer, setUserNoteServer] = useState<string | null>(null);
  const [userNoteSaving, setUserNoteSaving] = useState(false);
  const [userNoteSaved, setUserNoteSaved] = useState(false);
  // F112.1 — per-Neuron share flag. Default false on new docs.
  const [userNoteShare, setUserNoteShare] = useState(false);
  const [userNoteShareServer, setUserNoteShareServer] = useState(false);

  useEffect(() => {
    if (!kbId) return;
    listWikiPages(kbId)
      .then(setPages)
      .catch((err: ApiError) => setError(err.message));
  }, [kbId]);

  const doc = useMemo(() => {
    if (!pages) return null;
    // Match the requested slug against every Neuron's canonical slug
    // form (slugify of filename-sans-.md). Robust against old links
    // in the wild that carry raw display casing or spaces — a link
    // written as `/neurons/FMC` or `/neurons/ARC Farm Intelligence`
    // still lands on `fmc.md` / `arc-farm-intelligence.md`. Falls
    // back to exact filename match for extra-safe round-tripping.
    const wanted = slugify(slug);
    const canonical = pages.find((p) => {
      const d = p as Document & { filename: string };
      const fileSlug = slugify(d.filename.replace(/\.md$/i, ''));
      return fileSlug === wanted || d.filename.replace(/\.md$/i, '') === slug;
    });
    if (canonical) return canonical;

    // F148 Lag 2 — bilingual fold fallback. When canonical slug match
    // fails we fold both sides toward the KB's configured language and
    // retry. Example: URL `/neurons/yin-og-yang` on a Danish KB finds
    // filename `yin-and-yang.md` via `and→og` fold. Only accept entydig
    // (exactly one) match; ambiguous folds fall through to 404 rather
    // than guess. Uses `kb?.language` — `useKb` may still be loading,
    // in which case we skip the fold (re-render picks it up when kb
    // arrives).
    if (!kb) return null;
    const folded = normalizedSlug(wanted, kb.language);
    const foldedMatches = pages.filter((p) => {
      const d = p as Document & { filename: string };
      const fileSlug = slugify(d.filename.replace(/\.md$/i, ''));
      return normalizedSlug(fileSlug, kb.language) === folded;
    });
    return foldedMatches.length === 1 ? foldedMatches[0]! : null;
  }, [pages, slug, kb?.language, kb]);

  useEffect(() => {
    if (!doc) {
      setContent(null);
      setProvenance(null);
      setUserNote(null);
      setUserNoteServer(null);
      setUserNoteShare(false);
      setUserNoteShareServer(false);
      return;
    }
    getDocumentContent(doc.id)
      .then((r) => {
        setContent(r.content ?? '');
        const note = r.userNote ?? '';
        setUserNote(note);
        setUserNoteServer(note);
        setUserNoteShare(r.userNoteShare ?? false);
        setUserNoteShareServer(r.userNoteShare ?? false);
      })
      .catch((err: ApiError) => setError(err.message));
    // Provenance lookup is independent of content — fire in parallel.
    // Silent on failure; the panel just doesn't render the "Created via"
    // line if the lookup 404s or throws.
    getNeuronProvenance(doc.id).then(setProvenance).catch(() => setProvenance(null));
  }, [doc]);

  const html = useMemo(() => {
    if (content === null) return '';
    // Strip YAML frontmatter before rendering. It's load-bearing for the
    // reference-extractor (sources:) + F139 decay (pinned:, type:) so we
    // keep it in the raw content, but the reader's header already shows
    // title / tags / date in a styled form — re-rendering the same metadata
    // as plain prose clutters the top of every Neuron.
    const stripped = stripFrontmatter(content);
    const preprocessed = rewriteWikiLinks(stripped, kbId);
    return marked.parse(preprocessed, { async: false }) as string;
  }, [content, kbId]);

  const d = doc as (Document & { filename: string; title: string | null; version: number; path?: string; tags?: string | null; createdAt?: string; updatedAt?: string }) | null;
  const effectiveVersion = localVersion ?? (d?.version ?? 0);
  const editHref = d ? `/kb/${kbId}/neurons/${encodeURIComponent(slug)}?edit=1` : null;
  // Prefer the DB column (kept in sync by F92 on approve), fall back to
  // the frontmatter so older Neurons written before F92's backfill still
  // show chips. Same parser accepts both `[a, b]` arrays and CSV strings.
  const dbTags = d ? parseTags(d.tags) : [];
  const frontmatterTags = parseFrontmatterTags(content ?? '');
  const readerTags = dbTags.length > 0 ? dbTags : frontmatterTags;

  return (
    <div class="page-shell">
      <header class="mb-4 flex items-center justify-between gap-4">
        <a
          href={`/kb/${kbId}/neurons`}
          class="text-sm text-[color:var(--color-fg-subtle)] hover:text-[color:var(--color-fg)] transition"
        >
          ← Neurons
        </a>
        {editHref ? (
          <a
            href={editHref}
            class="px-3 py-1.5 rounded-md border border-[color:var(--color-border)] text-sm hover:bg-[color:var(--color-bg-card)] transition"
          >
            {t('neuronEditor.editButton')}
          </a>
        ) : null}
      </header>

      {error ? (
        <div class="border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/5 rounded-md p-4 text-sm">
          {error}
        </div>
      ) : null}

      {!pages && !error ? <CenteredLoader /> : null}

      {pages && !d ? (
        <div class="text-center py-16">
          <h1 class="text-2xl font-semibold mb-2">Neuron not found</h1>
          <p class="text-[color:var(--color-fg-muted)] text-sm mb-6">
            No Neuron matches slug <code class="font-mono">{slug}</code> in this Trail.
          </p>
          <a
            href={`/kb/${kbId}/neurons`}
            class="inline-block px-4 py-2 rounded-md border border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-card)] transition text-sm"
          >
            Back to Neurons
          </a>
        </div>
      ) : null}

      {d ? (
        <article>
          <div class="mb-6">
            <div class="font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fg-subtle)] mb-1">
              {displayPath(d.path ?? '')}
            </div>
            <h1 class="text-3xl font-semibold tracking-tight mb-2">
              {d.title ?? d.filename}
            </h1>
            <div class="flex items-center gap-3 flex-wrap">
              {(() => {
                // F145 — the per-KB seq is the stable, human-readable handle for
                // cross-session references. Shown next to the version so it sits
                // with the other identity metadata.
                const seqId = formatSeqId(kb?.name, (d as Document & { seq?: number | null }).seq);
                return seqId ? <CopyId id={seqId} /> : null;
              })()}
              <span class="text-[11px] font-mono text-[color:var(--color-fg-subtle)]">
                v{d.version}
              </span>
              {/* F101 — semantic type derived from path. Identity-level
                  metadata so it sits next to version + seqId. Note-type
                  is the catch-all and adds no signal; suppress to keep
                  the row uncluttered. */}
              {(() => {
                const ntype = deriveType(d.path ?? '');
                if (ntype === 'note') return null;
                return (
                  <span
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-[color:var(--color-bg-elevated)] border border-[color:var(--color-border)] text-[color:var(--color-fg-muted)]"
                    title={`Type: ${ntype} (path-derived)`}
                  >
                    {ntype}
                  </span>
                );
              })()}
              {d.updatedAt || d.createdAt ? (
                <span
                  class="text-[11px] font-mono text-[color:var(--color-fg-subtle)]"
                  title={d.updatedAt ?? d.createdAt ?? ''}
                >
                  {formatAbsolute(d.updatedAt ?? d.createdAt ?? '')}
                </span>
              ) : null}
              {readerTags.length > 0 ? (
                <div class="inline-flex flex-wrap gap-1.5">
                  {readerTags.map((tag) => (
                    <a
                      key={tag}
                      href={`/kb/${kbId}/neurons?tag=${encodeURIComponent(tag)}`}
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)] border border-[color:var(--color-accent)]/30 hover:bg-[color:var(--color-accent)]/25 transition"
                      title={`Filter Neurons by "${tag}"`}
                    >
                      {tag}
                    </a>
                  ))}
                </div>
              ) : null}
              {isHeuristicPath(d.path) ? (
                <HeuristicBadge
                  updatedAt={d.updatedAt ?? d.createdAt ?? null}
                  content={content}
                />
              ) : null}
              {d && isHeuristicPath(d.path) ? (
                <PinButton
                  docId={d.id}
                  version={effectiveVersion}
                  content={content}
                  onSaved={(newContent, newVersion) => {
                    setContent(newContent);
                    setLocalVersion(newVersion);
                  }}
                />
              ) : null}
            </div>
            {provenance?.connector ? (
              <div class="mt-3 flex items-center gap-2 text-[11px] font-mono text-[color:var(--color-fg-subtle)] flex-wrap">
                <span>{t('queue.createdVia')}</span>
                <ConnectorBadge variant="tag" connector={provenance.connector} />
                <ConfidencePill confidence={provenance.confidence} />
              </div>
            ) : null}
          </div>
          {content === null ? (
            <div class="loading-delayed text-[color:var(--color-fg-muted)] text-sm">
              Loading content…
            </div>
          ) : (
            <div
              class={`prose-body text-[15px] leading-relaxed${showClaimAnchors.value ? '' : ' claims-hidden'}`}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {/* F112 — Luhmann-friction "Your Take" field. Curator's own
              reflection, persisted via PUT /user-note (queue-bypass).
              Renders only when content has loaded so curator doesn't
              start typing into a phantom Neuron during route flicker. */}
          {doc && content !== null && userNote !== null ? (
            <UserNoteSection
              docId={doc.id}
              value={userNote}
              serverValue={userNoteServer}
              onChange={setUserNote}
              share={userNoteShare}
              shareServer={userNoteShareServer}
              onShareChange={(next) => {
                setUserNoteShare(next);
                // Share is a deliberate click — fire save immediately
                // rather than waiting for a debounced text-save.
                setUserNoteSaving(true);
                setUserNoteSaved(false);
                updateUserNote(doc.id, userNote, next)
                  .then(() => {
                    setUserNoteShareServer(next);
                    setUserNoteServer(userNote.trim() === '' ? '' : userNote);
                    setUserNoteSaved(true);
                    setTimeout(() => setUserNoteSaved(false), 2000);
                  })
                  .catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  )
                  .finally(() => setUserNoteSaving(false));
              }}
              onSave={async (value) => {
                setUserNoteSaving(true);
                setUserNoteSaved(false);
                try {
                  await updateUserNote(doc.id, value);
                  setUserNoteServer(value.trim() === '' ? '' : value);
                  setUserNoteSaved(true);
                  setTimeout(() => setUserNoteSaved(false), 2000);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setUserNoteSaving(false);
                }
              }}
              saving={userNoteSaving}
              savedToast={userNoteSaved}
            />
          ) : null}
        </article>
      ) : null}
    </div>
  );
}

function togglePinned(content: string, pin: boolean): string {
  if (pin) {
    if (content.startsWith('---')) {
      const afterFence = content.indexOf('\n');
      if (afterFence === -1) return `---\npinned: true\n---\n\n${content}`;
      return content.slice(0, afterFence + 1) + 'pinned: true\n' + content.slice(afterFence + 1);
    }
    return `---\npinned: true\n---\n\n${content}`;
  } else {
    if (!content.startsWith('---')) return content;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return content;
    const beforeFm = content.slice(0, end + 4);
    const afterFm = content.slice(end + 4);
    const cleanedFm = beforeFm.replace(/^pinned\s*:\s*(true|yes)\s*$/im, '').replace(/\n\n+/g, '\n');
    return cleanedFm + afterFm;
  }
}

function PinButton({
  docId,
  version,
  content,
  onSaved,
}: {
  docId: string;
  version: number;
  content: string | null;
  onSaved: (newContent: string, newVersion: number) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (content === null) return null;
  const pinned = isPinned(content);

  async function handleToggle() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const newContent = togglePinned(content!, !pinned);
    try {
      const res = await saveNeuronEdit(docId, { content: newContent, expectedVersion: version });
      onSaved(newContent, res.version);
    } catch (err) {
      setError(err instanceof NeuronEditConflictError ? t('heuristic.pinError') : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggle}
        disabled={saving}
        class={
          'px-2.5 py-1 rounded text-[11px] font-mono border transition ' +
          (pinned
            ? 'border-[color:var(--color-accent)]/40 text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10'
            : 'border-[color:var(--color-border)] text-[color:var(--color-fg-muted)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-fg)]') +
          ' active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        {saving ? t('heuristic.pinSaving') : pinned ? t('heuristic.unpinAction') : t('heuristic.pinAction')}
      </button>
      {error ? (
        <span class="text-[10px] font-mono text-[color:var(--color-danger)]">{error}</span>
      ) : null}
    </div>
  );
}

/**
 * F139 — heuristic confidence badge for the Neuron reader header.
 * Only renders for Neurons under /neurons/heuristics/. Shows the
 * computed confidence (decayed by age unless pinned) and a distinct
 * style when faded below the threshold so a curator can see at a
 * glance which decision-rules the system currently excludes from chat
 * context.
 */
function HeuristicBadge({
  updatedAt,
  content,
}: {
  updatedAt: string | null;
  content: string | null;
}) {
  const pinned = isPinned(content ?? '');
  const confidence = computeConfidence(updatedAt, pinned);
  const faded = confidence < HEURISTIC_FADED_THRESHOLD;
  const toneClass = faded
    ? 'bg-[color:var(--color-danger)]/10 border-[color:var(--color-danger)]/30 text-[color:var(--color-danger)]'
    : pinned
    ? 'bg-[color:var(--color-accent)]/10 border-[color:var(--color-accent)]/30 text-[color:var(--color-accent)]'
    : 'bg-[color:var(--color-success)]/10 border-[color:var(--color-success)]/30 text-[color:var(--color-success)]';
  const label = pinned
    ? t('heuristic.pinned')
    : faded
    ? t('heuristic.faded', { n: confidence.toFixed(1) })
    : t('heuristic.active', { n: confidence.toFixed(1) });
  return (
    <span
      title={t('heuristic.hint')}
      class={
        'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ' +
        toneClass
      }
    >
      {label}
    </span>
  );
}

/**
 * Absolute timestamp for the Neuron reader header — short, readable,
 * no guessing what "3d" means. SQLite stamps are UTC without a
 * timezone marker; we treat them as UTC and let the browser localise.
 */
function formatAbsolute(iso: string): string {
  try {
    const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

/**
 * F112 — "Your Take" / Din tanke field.
 *
 * Curator's own reflection on the Neuron. Auto-saves on blur AND on
 * 1.5s debounce while typing. Visually distinct from the LLM-body
 * (left amber rule + soft card background) so the curator immediately
 * reads "this is mine, not the model's".
 *
 * The Luhmann pattern in one widget: writing in your own words is
 * the act that makes ideas stick. The textarea uses ample whitespace
 * + plain monospace to reinforce "this is your scratch-pad", not a
 * polished publishing surface.
 */
function UserNoteSection({
  docId,
  value,
  serverValue,
  onChange,
  share,
  shareServer: _shareServer,
  onShareChange,
  onSave,
  saving,
  savedToast,
}: {
  docId: string;
  value: string;
  serverValue: string | null;
  onChange: (v: string) => void;
  share: boolean;
  shareServer: boolean;
  onShareChange: (next: boolean) => void;
  onSave: (v: string) => Promise<void>;
  saving: boolean;
  savedToast: boolean;
}) {
  // Debounced auto-save while typing. Resets on every keystroke, fires
  // 1.5s after the last change. Saved on blur regardless. The dirty
  // check (value !== serverValue) prevents save-thrash on identical
  // re-edits.
  useEffect(() => {
    if (serverValue === null) return;
    if (value === serverValue) return;
    const timer = setTimeout(() => {
      void onSave(value);
    }, 1500);
    return () => clearTimeout(timer);
  }, [value, serverValue, onSave]);

  const dirty = serverValue !== null && value !== serverValue;
  const empty = value.trim().length === 0;

  return (
    <section
      class="mt-10 pt-6 border-t border-[color:var(--color-border)]"
      aria-labelledby={`user-note-${docId}`}
    >
      <div class="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <h2
            id={`user-note-${docId}`}
            class="text-sm font-medium text-[color:var(--color-fg)]"
          >
            {t('wikiReader.userNote.heading')}
          </h2>
          <p class="text-[11px] text-[color:var(--color-fg-subtle)] mt-0.5 max-w-xl">
            {t('wikiReader.userNote.hint')}
          </p>
        </div>
        <div class="text-[11px] font-mono text-[color:var(--color-fg-subtle)] shrink-0">
          {saving
            ? t('wikiReader.userNote.saving')
            : savedToast
              ? t('wikiReader.userNote.saved')
              : dirty
                ? t('wikiReader.userNote.dirty')
                : ''}
        </div>
      </div>
      <div class="border-l-2 border-[color:var(--color-accent)]/40 pl-4">
        <textarea
          value={value}
          onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          onBlur={() => {
            if (dirty) void onSave(value);
          }}
          placeholder={t('wikiReader.userNote.placeholder')}
          rows={empty ? 3 : Math.max(3, Math.min(20, value.split('\n').length + 1))}
          maxLength={4000}
          class="w-full font-mono text-[14px] leading-relaxed bg-[color:var(--color-bg-card)]/30 border border-[color:var(--color-border)] rounded-md px-3 py-2 text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-subtle)] focus:outline-none focus:border-[color:var(--color-accent)]/40 transition resize-y"
        />
        {/* F112.1 — opt-in share toggle. Default off; only when curator
            explicitly checks does the note flow into chat retrieveContext
            + F160 retrieve responses. Saves immediately on click (not
            debounced) since it's a deliberate action, not a typing flow. */}
        <label class="mt-2 flex items-start gap-2 text-[11px] text-[color:var(--color-fg-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => onShareChange((e.target as HTMLInputElement).checked)}
            class="mt-0.5 accent-[color:var(--color-accent)]"
          />
          <span>
            {t('wikiReader.userNote.shareLabel')}
            <span class="block text-[10px] text-[color:var(--color-fg-subtle)] mt-0.5 max-w-md">
              {t('wikiReader.userNote.shareHint')}
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
