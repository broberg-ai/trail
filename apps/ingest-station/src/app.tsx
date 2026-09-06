import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { KnowledgeBase, Document } from '@trail/shared';
import { PasteSource } from '@trail/ui';
import {
  ApiError,
  getKey,
  setKey,
  getActiveTenant,
  setActiveTenant,
  listTenants,
  listKbs,
  listSources,
  uploadSource,
  recompileSource,
  deleteSource,
  subscribeStream,
  type StreamEvent,
  type Tenant,
} from './api';

// The list endpoint returns awaiting_local_compile (F191.1) + neuronCount; the
// shared Document type doesn't model them yet, so augment locally.
type Source = Document & { awaitingLocalCompile?: boolean; neuronCount?: number };

const ACCEPTED = '.md · .pdf · .docx · .pptx · .txt · .html · .csv · billeder';

// F191 — localhost auto-login. The Vite config injects the personal key from
// the gitignored .env.local-ingest as __TRAIL_DEV_KEY__ (empty string in a
// standalone build with no env file). Persist it BEFORE first render so the api
// client + the KB load use it — no paste gate when you're on localhost with the
// key already in .env.
declare const __TRAIL_DEV_KEY__: string;
// Overwrite even when a key is already stored: the .env file is the source of
// truth on localhost, so a ROTATED key (e.g. swapped to a scope='all' key)
// must replace a stale/revoked one in localStorage rather than being ignored.
if (typeof __TRAIL_DEV_KEY__ === 'string' && __TRAIL_DEV_KEY__ && getKey() !== __TRAIL_DEV_KEY__) {
  setKey(__TRAIL_DEV_KEY__);
}

export function App() {
  const [key, setKeyState] = useState(getKey());
  if (!key) return <KeyGate onSaved={(k) => { setKey(k); setKeyState(k); }} />;
  return <Station onSignOut={() => { setKey(''); setKeyState(''); }} />;
}

// ── Auth gate ────────────────────────────────────────────────────────────
function KeyGate({ onSaved }: { onSaved: (key: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div data-testid="ingest-keygate-root" class="min-h-screen flex items-center justify-center bg-cream text-ink p-6">
      <div class="w-full max-w-md">
        <h1 class="flex items-center gap-2 mb-2">
          <TrailLogo size={30} />
          <span class="font-mono font-semibold tracking-tight text-2xl">trail</span>
          <span class="text-muted text-lg">ingest</span>
        </h1>
        <p class="text-muted text-sm mb-6">
          Log ind med en personlig API-nøgle (<code>trail_…</code>) fra cloud-admin
          (Indstillinger → API-nøgler). Kilder du dropper her kompileres gratis i din
          åbne Claude Code-session.
        </p>
        <input
          data-testid="ingest-keygate-input"
          type="password"
          value={val}
          onInput={(e) => setVal((e.target as HTMLInputElement).value)}
          placeholder="trail_…"
          class="w-full border border-line rounded-lg px-3 py-2 mb-3 font-mono text-sm bg-white"
        />
        <button
          data-testid="ingest-keygate-submit"
          disabled={!val.trim().startsWith('trail_')}
          onClick={() => onSaved(val.trim())}
          class="w-full bg-accent text-white rounded-lg px-4 py-2 font-medium
                 hover:opacity-90 active:scale-[0.99] transition disabled:opacity-40"
        >
          Forbind
        </button>
      </div>
    </div>
  );
}

// ── Main surface ───────────────────────────────────────────────────────────
function Station({ onSignOut }: { onSignOut: () => void }) {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [tenant, setTenant] = useState<string>(getActiveTenant());
  const [kbs, setKbs] = useState<KnowledgeBase[] | null>(null);
  const [kbId, setKbId] = useState<string>('');
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // F191.6 — load the tenants this key can reach. Keep the persisted choice if
  // it's still valid, else default to the first.
  useEffect(() => {
    listTenants()
      .then(({ tenants: list }) => {
        setTenants(list);
        setTenant((cur) => {
          const next = cur && list.some((t) => t.slug === cur) ? cur : (list[0]?.slug ?? '');
          setActiveTenant(next);
          return next;
        });
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 401
        ? 'Ugyldig nøgle — log ind igen.'
        : `Kunne ikke hente tenants: ${(e as Error).message}`));
  }, []);

  // Load the active tenant's KBs (re-runs on tenant switch). setActiveTenant
  // first so the X-Trail-Tenant header is in place before the request.
  useEffect(() => {
    if (!tenant) return;
    setActiveTenant(tenant);
    setKbs(null);
    setKbId('');
    setSources([]);
    listKbs()
      .then((list) => {
        setKbs(list);
        if (list.length > 0) setKbId(list[0]!.id);
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 401
        ? 'Ugyldig nøgle — log ind igen.'
        : `Kunne ikke hente Trails: ${(e as Error).message}`));
  }, [tenant]);

  const refresh = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setSources(await listSources(id));
      setError(null);
    } catch (e) {
      setError(`Kunne ikke hente kilder: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { void refresh(kbId); }, [kbId, refresh]);

  // Live progress — refresh the list whenever a relevant event for this KB fires.
  useEffect(() => {
    if (!kbId) return;
    const unsub = subscribeStream((ev: StreamEvent) => {
      const evKb = ev.data.kbId;
      if (ev.event === 'ping' || ev.event === 'hello') return;
      if (typeof evKb === 'string' && evKb !== kbId) return;
      // candidate_created / candidate_resolved / ingest_started → a source moved.
      void refresh(kbId);
    });
    return unsub;
  }, [kbId, refresh]);

  // F162 dedup — a byte-identical file already in this Trail comes back as a
  // 409 `duplicate_source`. Surface it on the drop (the "already ingested"
  // notice Christian asked for) with an "upload anyway" escape, instead of a
  // raw error.
  const [duplicates, setDuplicates] = useState<{ file: File; name: string; createdAt?: string }[]>([]);

  const uploadOne = useCallback(async (f: File, force: boolean) => {
    setUploading((n) => n + 1);
    try {
      await uploadSource(kbId, f, force);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.code === 'duplicate_source') {
        setDuplicates((d) =>
          d.some((x) => x.name === f.name)
            ? d
            : [...d, { file: f, name: f.name, createdAt: e.body?.existingCreatedAt as string | undefined }],
        );
      } else {
        setError(`Upload fejlede for ${f.name}: ${(e as Error).message}`);
      }
    } finally {
      setUploading((n) => n - 1);
    }
  }, [kbId]);

  const doUpload = useCallback(async (files: FileList | File[]) => {
    if (!kbId) return;
    for (const f of Array.from(files)) await uploadOne(f, false);
    void refresh(kbId);
  }, [kbId, uploadOne, refresh]);

  const forceUpload = useCallback(async (name: string) => {
    const dup = duplicates.find((d) => d.name === name);
    if (!dup) return;
    setDuplicates((d) => d.filter((x) => x.name !== name));
    await uploadOne(dup.file, true);
    void refresh(kbId);
  }, [duplicates, uploadOne, refresh, kbId]);

  const skipDuplicate = useCallback((name: string) => {
    setDuplicates((d) => d.filter((x) => x.name !== name));
  }, []);

  // "Prøv igen" — re-park a failed source so the next /local-ingest drain
  // retries it. Tracked per-id so each button shows its own loading state.
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const onRetry = useCallback(async (id: string) => {
    setRetrying((s) => new Set(s).add(id));
    try {
      await recompileSource(id);
      await refresh(kbId);
    } catch (e) {
      setError(`Kunne ikke genstarte ${id}: ${(e as Error).message}`);
    } finally {
      setRetrying((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [kbId, refresh]);

  // "Slet" — soft-archive a source that can't be salvaged (e.g. a legacy .doc
  // that never extracts). Per-id loading so each button is independent.
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const onDelete = useCallback(async (id: string) => {
    setDeleting((s) => new Set(s).add(id));
    try {
      await deleteSource(id);
      await refresh(kbId);
    } catch (e) {
      setError(`Kunne ikke slette ${id}: ${(e as Error).message}`);
    } finally {
      setDeleting((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [kbId, refresh]);

  const awaiting = sources.filter((s) => s.awaitingLocalCompile);

  return (
    <div data-testid="ingest-station-root" class="min-h-screen bg-cream text-ink">
      <header class="flex items-center justify-between px-6 py-4 border-b border-line">
        <div class="flex items-center gap-3 min-w-0">
          {/* Brand identity — Trail mark + wordmark + surface name */}
          <span class="flex items-center gap-2 shrink-0">
            <TrailLogo />
            <span class="font-mono font-semibold tracking-tight text-xl">trail</span>
            <span class="text-muted text-sm">ingest</span>
          </span>
          {tenants && tenants.length > 1 && (
            <TenantPicker tenants={tenants} value={tenant} onChange={setTenant} />
          )}
          {kbs && kbs.length > 0 && (
            <KbPicker kbs={kbs} value={kbId} onChange={setKbId} />
          )}
        </div>
        <button data-testid="ingest-signout" onClick={onSignOut} class="text-sm text-muted hover:text-ink transition shrink-0">Log ud</button>
      </header>

      <main class="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div class="mb-4 rounded-lg border border-err/30 bg-err/5 text-err px-4 py-3 text-sm">{error}</div>
        )}

        {/* Drop-zone */}
        <div
          data-testid="ingest-dropzone"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer?.files) void doUpload(e.dataTransfer.files); }}
          onClick={() => fileInput.current?.click()}
          class={`rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition
                  ${dragOver ? 'border-accent bg-accent/5' : 'border-line hover:border-accent/50'}`}
        >
          <p class="font-medium">Slip filer hvor som helst, eller klik for at vælge</p>
          <p class="text-muted text-sm mt-1 font-mono">{ACCEPTED}</p>
          {uploading > 0 && <p class="text-accent text-sm mt-3">Uploader {uploading}…</p>}
          <input
            data-testid="ingest-file-input"
            ref={fileInput}
            type="file"
            multiple
            class="hidden"
            onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) void doUpload(f); }}
          />
        </div>

        {/* F149.7 — «Indsæt tekst», samme komponent som admin bruger, så de to
            flader ikke kan drive fra hinanden. force=false: en indsat note er
            aldrig en dublet (filnavnet bærer et tidsstempel), så dedup-dialogen
            er ikke relevant her. */}
        <PasteSource
          upload={(file) => uploadSource(kbId, file, false)}
          onSaved={() => void refresh(kbId)}
          testidPrefix="ingest-paste"
        />

        {/* Awaiting-session banner (F191.4) */}
        {awaiting.length > 0 && (
          <div data-testid="ingest-awaiting-banner" class="mt-6 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
            <strong>{awaiting.length}</strong> kilde{awaiting.length === 1 ? '' : 'r'} venter på
            kompilering i en aktiv Claude Code-session. Kør <code>/local-ingest {kbId}</code> i en
            åben cc-session (eller lad buddy dispatche et job) — så kompileres de gratis ($0) og
            dukker op som Neuroner her.
          </div>
        )}

        {/* Dedup notices — "already ingested" feedback on drop (F162) */}
        {duplicates.map((d) => (
          <div
            key={d.name}
            class="mt-4 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm flex items-center justify-between gap-3"
          >
            <span class="min-w-0">
              <strong class="break-all">{d.name}</strong> er allerede i denne Trail
              {d.createdAt ? ` (uploadet ${new Date(d.createdAt).toLocaleDateString('da-DK')})` : ''} — samme indhold.
            </span>
            <span class="flex items-center gap-2 shrink-0">
              <button
                data-testid="ingest-dup-force"
                onClick={() => forceUpload(d.name)}
                class="text-xs px-2.5 py-1 rounded-full border border-line transition
                       hover:border-accent/50 hover:text-accent active:scale-[0.97]"
              >
                Upload alligevel
              </button>
              <button
                data-testid="ingest-dup-skip"
                onClick={() => skipDuplicate(d.name)}
                class="text-xs px-2 py-1 rounded-full text-muted hover:text-ink active:scale-[0.97] transition"
              >
                Spring over
              </button>
            </span>
          </div>
        ))}

        {/* F192 — kø + færdig board so the curator sees what's compiled vs still waiting */}
        <SourceBoard sources={sources} />

        {/* What failed — with retry / delete */}
        <FailedList sources={sources} onRetry={onRetry} retrying={retrying} onDelete={onDelete} deleting={deleting} />
      </main>
    </div>
  );
}

// Trail brand mark — concentric circles (mirrors admin favicon.svg), rendered
// with the Station's own tokens so it reads as one product.
function TrailLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
      <circle cx="16" cy="16" r="14" fill="none" style={{ stroke: 'var(--color-ink)' }} stroke-width="2" />
      <circle cx="16" cy="16" r="9" fill="none" style={{ stroke: 'var(--color-accent)' }} stroke-width="0.9" opacity="0.55" />
      <circle cx="16" cy="16" r="3.5" style={{ fill: 'var(--color-accent)' }} />
    </svg>
  );
}

// F191.6 — tenant picker. NO native <select> (project rule); a small popover,
// same pattern as KbPicker. Only rendered when the key spans >1 tenant.
function TenantPicker({ tenants, value, onChange }: { tenants: Tenant[]; value: string; onChange: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = tenants.find((t) => t.slug === value);
  return (
    <div class="relative shrink-0">
      <button
        data-testid="ingest-tenant-trigger"
        onClick={() => setOpen((o) => !o)}
        class="text-sm border border-line rounded-lg pl-2.5 pr-3 py-1.5 bg-white hover:border-accent/50 active:scale-[0.99] transition flex items-center gap-1.5"
      >
        <span class="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} />
        {current?.name ?? 'Vælg tenant'} ▾
      </button>
      {open && (
        <div class="absolute z-10 mt-1 w-60 max-h-80 overflow-auto rounded-lg border border-line bg-white shadow-lg">
          {tenants.map((t) => (
            <button
              data-testid={`ingest-tenant-opt-${t.slug}`}
              key={t.slug}
              onClick={() => { onChange(t.slug); setOpen(false); }}
              class={`flex w-full items-center justify-between text-left px-3 py-2 text-sm hover:bg-cream transition
                      ${t.slug === value ? 'text-accent font-medium' : ''}`}
            >
              <span class="truncate">{t.name}</span>
              <span class="text-xs text-muted ml-2 shrink-0">{t.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Custom KB picker — NO native <select> (project rule). A small popover list.
function KbPicker({ kbs, value, onChange }: { kbs: KnowledgeBase[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = kbs.find((k) => k.id === value);
  return (
    <div class="relative">
      <button
        data-testid="ingest-kb-trigger"
        onClick={() => setOpen((o) => !o)}
        class="text-sm border border-line rounded-lg px-3 py-1.5 bg-white hover:border-accent/50 active:scale-[0.99] transition"
      >
        {current?.name ?? 'Vælg Trail'} ▾
      </button>
      {open && (
        <div class="absolute z-10 mt-1 w-56 max-h-80 overflow-auto rounded-lg border border-line bg-white shadow-lg">
          {kbs.map((k) => (
            <button
              data-testid={`ingest-kb-opt-${k.id}`}
              key={k.id}
              onClick={() => { onChange(k.id); setOpen(false); }}
              class={`block w-full text-left px-3 py-2 text-sm hover:bg-cream transition
                      ${k.id === value ? 'text-accent font-medium' : ''}`}
            >
              {k.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// F192 — source status board: what's queued vs compiled (with neuron counts).
// Earlier the Station showed failures only ("the Færdig/Afventer rows are
// noise — Christian's call"); he reversed that — he wants to SEE which dropped
// sources are still waiting and which are done, so he doesn't have to ask cc
// how far an ingest has come. Source-kind only — the compiled /neurons/*.md
// wiki pages are NOT sources and must not appear here.
function SourceBoard({ sources }: { sources: Source[] }) {
  const [tab, setTab] = useState<'queued' | 'done'>('queued');
  const queued = sources.filter(
    (s) => s.kind === 'source' && (s.awaitingLocalCompile || s.status === 'processing' || s.status === 'pending'),
  );
  const done = sources.filter(
    (s) => s.kind === 'source' && !s.awaitingLocalCompile && s.status === 'ready',
  );
  if (queued.length === 0 && done.length === 0) return null;

  // Fall back if the selected tab has no rows (e.g. the last queued source just
  // compiled and moved to Færdig) so the panel never shows an empty tab.
  const active: 'queued' | 'done' =
    tab === 'queued' && queued.length === 0 ? 'done'
    : tab === 'done' && done.length === 0 ? 'queued'
    : tab;

  const rows = active === 'queued' ? queued : done;
  const badge =
    active === 'queued'
      ? (s: Source) => (s.awaitingLocalCompile ? 'venter på cc-session' : 'kompilerer…')
      : (s: Source) => `${s.neuronCount ?? 0} neuron${(s.neuronCount ?? 0) === 1 ? '' : 'er'}`;

  return (
    <div class="mt-6" data-testid="ingest-board">
      <div role="tablist" class="flex items-center gap-1 mb-3 border-b border-line">
        <BoardTab
          testid="ingest-tab-queued"
          label="Kø"
          count={queued.length}
          tone="warn"
          active={active === 'queued'}
          onClick={() => setTab('queued')}
        />
        <BoardTab
          testid="ingest-tab-done"
          label="Færdig"
          count={done.length}
          tone="accent"
          active={active === 'done'}
          onClick={() => setTab('done')}
        />
      </div>
      <SourceRows
        testid={active === 'queued' ? 'ingest-queued' : 'ingest-done'}
        tone={active === 'queued' ? 'warn' : 'accent'}
        rows={rows}
        badge={badge}
      />
    </div>
  );
}

// A single tab (Kø / Færdig) with a state-dot + count. Custom button, no native
// control; an underline marks the active tab.
function BoardTab({
  testid,
  label,
  count,
  tone,
  active,
  onClick,
}: {
  testid: string;
  label: string;
  count: number;
  tone: 'warn' | 'accent';
  active: boolean;
  onClick: () => void;
}) {
  const dot = tone === 'accent' ? 'var(--color-accent)' : 'var(--color-warn)';
  return (
    <button
      data-testid={testid}
      role="tab"
      aria-selected={active}
      onClick={onClick}
      class={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium -mb-px border-b-2 transition active:scale-[0.98]
              ${active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
    >
      <span class="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
      {label} <span class="text-muted font-normal">({count})</span>
    </button>
  );
}

// The rows for the active tab: filename + type/pages + a state badge.
// Tokens-only styling (no hardcoded colors), data-testid for Lens, no native
// controls — matches the rest of the Station.
function SourceRows({
  testid,
  tone,
  rows,
  badge,
}: {
  testid: string;
  tone: 'warn' | 'accent';
  rows: Source[];
  badge: (s: Source) => string;
}) {
  const badgeCls = tone === 'accent' ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn';
  return (
    <ul data-testid={`${testid}-group`} class="divide-y divide-line border border-line rounded-lg overflow-hidden bg-white">
      {rows.map((s) => (
        <li key={s.id} data-testid={`${testid}-row`} class="flex items-center justify-between py-3 px-4 gap-3">
          <div class="min-w-0">
            <span class="block truncate font-medium">{s.title ?? s.filename}</span>
            <span class="block text-xs text-muted mt-0.5 font-mono uppercase">
              {s.fileType}{s.pageCount ? ` · ${s.pageCount} sider` : ''}
            </span>
          </div>
          <span class={`text-xs shrink-0 px-2 py-0.5 rounded-full ${badgeCls}`}>{badge(s)}</span>
        </li>
      ))}
    </ul>
  );
}

// Each failed source shows its error + a "Prøv igen" retry that re-parks it for
// the next /local-ingest drain, and a "Slet" to soft-archive an unsalvageable
// one. Renders nothing when nothing failed.
function FailedList({
  sources,
  onRetry,
  retrying,
  onDelete,
  deleting,
}: {
  sources: Source[];
  onRetry: (id: string) => void;
  retrying: Set<string>;
  onDelete: (id: string) => void;
  deleting: Set<string>;
}) {
  const failed = sources.filter((s) => s.status === 'failed' && !s.awaitingLocalCompile);
  if (failed.length === 0) return null;
  return (
    <div class="mt-6">
      <h2 class="text-sm font-medium text-err mb-2">
        {failed.length} kilde{failed.length === 1 ? '' : 'r'} fejlede
      </h2>
      <ul class="divide-y divide-line border border-err/20 rounded-lg overflow-hidden">
        {failed.map((s) => (
          <li key={s.id} class="flex items-center justify-between py-3 px-4 gap-3 bg-err/5">
            <div class="min-w-0">
              <span class="block truncate font-medium">{s.title ?? s.filename}</span>
              {s.errorMessage && (
                <span class="block text-xs text-err/80 truncate mt-0.5" title={s.errorMessage}>
                  {s.errorMessage}
                </span>
              )}
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                data-testid={`ingest-retry-${s.id}`}
                onClick={() => onRetry(s.id)}
                disabled={retrying.has(s.id) || deleting.has(s.id)}
                class="text-xs px-2.5 py-0.5 rounded-full border border-err/30 bg-white transition
                       hover:border-accent/50 hover:text-accent active:scale-[0.97]
                       disabled:opacity-50 disabled:cursor-wait"
              >
                {retrying.has(s.id) ? 'Genstarter…' : 'Prøv igen'}
              </button>
              <button
                data-testid={`ingest-delete-${s.id}`}
                onClick={() => onDelete(s.id)}
                disabled={deleting.has(s.id) || retrying.has(s.id)}
                class="text-xs px-2.5 py-0.5 rounded-full text-muted transition
                       hover:text-err hover:bg-err/10 active:scale-[0.97]
                       disabled:opacity-50 disabled:cursor-wait"
              >
                {deleting.has(s.id) ? 'Sletter…' : 'Slet'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
