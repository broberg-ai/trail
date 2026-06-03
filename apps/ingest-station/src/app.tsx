import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { KnowledgeBase, Document } from '@trail/shared';
import {
  ApiError,
  getKey,
  setKey,
  listKbs,
  listSources,
  uploadSource,
  subscribeStream,
  type StreamEvent,
} from './api';

// The list endpoint returns awaiting_local_compile (F191.1); the shared Document
// type doesn't model it yet, so augment locally.
type Source = Document & { awaitingLocalCompile?: boolean };

const ACCEPTED = '.md · .pdf · .docx · .pptx · .txt · .html · .csv · billeder';

export function App() {
  const [key, setKeyState] = useState(getKey());
  if (!key) return <KeyGate onSaved={(k) => { setKey(k); setKeyState(k); }} />;
  return <Station onSignOut={() => { setKey(''); setKeyState(''); }} />;
}

// ── Auth gate ────────────────────────────────────────────────────────────
function KeyGate({ onSaved }: { onSaved: (key: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div class="min-h-screen flex items-center justify-center bg-cream text-ink p-6">
      <div class="w-full max-w-md">
        <h1 class="text-2xl font-serif mb-1">Trail · Ingest Station</h1>
        <p class="text-muted text-sm mb-6">
          Log ind med en personlig API-nøgle (<code>trail_…</code>) fra cloud-admin
          (Indstillinger → API-nøgler). Kilder du dropper her kompileres gratis i din
          åbne Claude Code-session.
        </p>
        <input
          type="password"
          value={val}
          onInput={(e) => setVal((e.target as HTMLInputElement).value)}
          placeholder="trail_…"
          class="w-full border border-line rounded-lg px-3 py-2 mb-3 font-mono text-sm bg-white"
        />
        <button
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
  const [kbs, setKbs] = useState<KnowledgeBase[] | null>(null);
  const [kbId, setKbId] = useState<string>('');
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Load KBs for the key's tenant.
  useEffect(() => {
    listKbs()
      .then((list) => {
        setKbs(list);
        if (list.length > 0) setKbId((cur) => cur || list[0]!.id);
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 401
        ? 'Ugyldig nøgle — log ind igen.'
        : `Kunne ikke hente Trails: ${(e as Error).message}`));
  }, []);

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

  const doUpload = useCallback(async (files: FileList | File[]) => {
    if (!kbId) return;
    const arr = Array.from(files);
    setUploading((n) => n + arr.length);
    for (const f of arr) {
      try {
        await uploadSource(kbId, f);
      } catch (e) {
        setError(`Upload fejlede for ${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    void refresh(kbId);
  }, [kbId, refresh]);

  const awaiting = sources.filter((s) => s.awaitingLocalCompile);

  return (
    <div class="min-h-screen bg-cream text-ink">
      <header class="flex items-center justify-between px-6 py-4 border-b border-line">
        <div class="flex items-center gap-3">
          <span class="font-serif text-lg">Trail · Ingest Station</span>
          {kbs && kbs.length > 0 && (
            <KbPicker kbs={kbs} value={kbId} onChange={setKbId} />
          )}
        </div>
        <button onClick={onSignOut} class="text-sm text-muted hover:text-ink transition">Log ud</button>
      </header>

      <main class="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div class="mb-4 rounded-lg border border-err/30 bg-err/5 text-err px-4 py-3 text-sm">{error}</div>
        )}

        {/* Drop-zone */}
        <div
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
            ref={fileInput}
            type="file"
            multiple
            class="hidden"
            onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) void doUpload(f); }}
          />
        </div>

        {/* Awaiting-session banner (F191.4) */}
        {awaiting.length > 0 && (
          <div class="mt-6 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
            <strong>{awaiting.length}</strong> kilde{awaiting.length === 1 ? '' : 'r'} venter på
            kompilering i en aktiv Claude Code-session. Kør <code>/local-ingest {kbId}</code> i en
            åben cc-session (eller lad buddy dispatche et job) — så kompileres de gratis ($0) og
            dukker op som Neuroner her.
          </div>
        )}

        {/* Source list */}
        <SourceList sources={sources} />
      </main>
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
        onClick={() => setOpen((o) => !o)}
        class="text-sm border border-line rounded-lg px-3 py-1.5 bg-white hover:border-accent/50 active:scale-[0.99] transition"
      >
        {current?.name ?? 'Vælg Trail'} ▾
      </button>
      {open && (
        <div class="absolute z-10 mt-1 w-56 max-h-80 overflow-auto rounded-lg border border-line bg-white shadow-lg">
          {kbs.map((k) => (
            <button
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

function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) {
    return <p class="mt-10 text-center text-muted">Ingen kilder endnu.</p>;
  }
  return (
    <ul class="mt-6 divide-y divide-line">
      {sources.map((s) => (
        <li key={s.id} class="flex items-center justify-between py-3">
          <span class="truncate mr-3">{s.title ?? s.filename}</span>
          <StatusBadge source={s} />
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ source }: { source: Source }) {
  let label: string;
  let cls: string;
  if (source.awaitingLocalCompile) { label = 'Afventer lokal compile'; cls = 'text-warn bg-warn/10'; }
  else if (source.status === 'processing') { label = 'Kompilerer…'; cls = 'text-accent bg-accent/10'; }
  else if (source.status === 'failed') { label = 'Fejlet'; cls = 'text-err bg-err/10'; }
  else if (source.status === 'ready') { label = 'Færdig'; cls = 'text-ok bg-ok/10'; }
  else { label = source.status; cls = 'text-muted bg-line/40'; }
  return <span class={`shrink-0 text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}
