/**
 * F253.4 — Hjerne-versioner (/kb/:kbId/brain-versions).
 *
 * Ejeren er ikke programmør. Tilbagerulningen skal kunne bruges herfra uden en
 * terminal, ellers findes den reelt ikke for ham.
 *
 * TO TING I FLADEN ER IKKE PYNT:
 *
 * 1. FORSKELLEN VISES FØR BEKRÆFTELSEN, og kan ikke springes over. En
 *    tilbagerulning man ikke kan se konsekvensen af, tør ingen bruge — og så er
 *    funktionen værdiløs præcis den dag den skal bruges.
 * 2. TIDSPUNKTET STÅR I DANSK TID med zonen navngivet. Serveren svarer i UTC
 *    (`datetime('now')` i en Fly-container), og et klokkeslæt uden zone bliver
 *    læst i læserens egen — lydløst, og forkert i det vindue hvor ingen kigger.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import {
  listBrainVersions,
  takeBrainVersion,
  getBrainVersionDiff,
  restoreBrainVersion,
  type BrainVersion,
  type RestoreDiff,
  type RestoreResult,
} from '../api';
import { PanelHeader } from '../components/ui/panel-header';
import { Modal, ModalButton } from '../components/modal';
import { CenteredLoader } from '../components/centered-loader';
import { dansk } from '../lib/dates';

const GRUND: Record<string, string> = {
  manual: 'Gemt manuelt',
  'auto:ingest': 'Før ny viden kom ind',
  'auto:lint': 'Før et kvalitetstjek',
  'auto:bulk-approve': 'Før en bunke blev godkendt',
  'auto:restore': 'Før en tilbagerulning',
};

export function BrainVersionsPanel() {
  const route = useRoute();
  const kbId = route.params.kbId;

  const [versions, setVersions] = useState<BrainVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [taking, setTaking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Bekræftelses-flowet: forskellen FØRST, derefter knappen.
  const [diff, setDiff] = useState<RestoreDiff | null>(null);
  const [diffFor, setDiffFor] = useState<BrainVersion | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);

  async function load() {
    if (!kbId) return;
    try {
      setVersions((await listBrainVersions(kbId)).versions);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }
  useEffect(() => { void load(); }, [kbId]);

  // Timeren ryddes ved unmount OG ved næste toast — ellers kan en besked fra
  // for fire sekunder siden slukke den der lige er kommet.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  function flash(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  async function handleTake() {
    if (!kbId || taking || !label.trim()) return;
    setTaking(true);
    try {
      const v = await takeBrainVersion(kbId, label.trim());
      setLabel('');
      await load();
      flash(
        v.coverageIntact
          ? `Gemt: "${v.label}" — ${v.neuronCount} Neuroner`
          : `Gemt, men hukommelses-loggen har ${v.coverageGaps} hul(ler). Denne version kan ikke rulles tilbage.`,
      );
    } catch (e) {
      flash(`Kunne ikke gemme: ${(e as Error).message}`);
    } finally {
      setTaking(false);
    }
  }

  /**
   * Løbenummer, så et langsomt svar ikke kan lande oven på et nyere.
   * Klikker man hurtigt på to versioner, ville modalen ellers kunne vise den
   * ENE versions overskrift med den ANDENS tal — et tilsyneladende korrekt
   * skærmbillede der beskriver noget andet end det man bad om.
   */
  const diffSeq = useRef(0);

  async function openDiff(v: BrainVersion) {
    const seq = ++diffSeq.current;
    setDiffFor(v);
    setDiff(null);
    setResult(null);
    setLoadingDiff(true);
    try {
      const d = await getBrainVersionDiff(v.id);
      if (seq !== diffSeq.current) return; // et nyere klik har overhalet dette
      setDiff(d);
    } catch (e) {
      if (seq !== diffSeq.current) return;
      flash(`Kunne ikke beregne forskellen: ${(e as Error).message}`);
      setDiffFor(null);
    } finally {
      if (seq === diffSeq.current) setLoadingDiff(false);
    }
  }

  async function handleRestore() {
    if (!diffFor || restoring) return;
    setRestoring(true);
    try {
      const r = await restoreBrainVersion(diffFor.id);
      setResult(r);
      await load();
    } catch (e) {
      flash(`Tilbagerulning afvist: ${(e as Error).message}`);
      setDiffFor(null);
    } finally {
      setRestoring(false);
    }
  }

  if (!versions && !error) return <CenteredLoader variant="list" />;

  return (
    <div class="page-shell" data-testid="brain-versions-root">
      <PanelHeader
        title="Hjernens versioner"
        subtitle="Et mærke er et bogmærke i hukommelsen — ikke en kopi. Du kan altid gå tilbage til en af dem."
      />

      {toast ? (
        <div
          data-testid="brain-versions-toast"
          style={{
            marginBottom: 20, padding: '10px 14px', borderRadius: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-strong)', fontSize: 14,
          }}
        >
          {toast}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap', alignItems: 'center',
        }}
      >
        <input
          data-testid="brain-version-label-input"
          value={label}
          placeholder="Hvad er det for et øjeblik? (fx «før jeg rydder op i kilderne»)"
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleTake(); }}
          style={{
            flex: '1 1 320px', minWidth: 0, padding: '9px 12px', borderRadius: 8, fontSize: 14,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-bg)', color: 'var(--color-fg)',
          }}
        />
        <button
          type="button"
          data-testid="brain-version-take-btn"
          onClick={() => void handleTake()}
          disabled={taking || !label.trim()}
          class="btn"
        >
          {taking ? 'Gemmer…' : 'Gem hjernen nu'}
        </button>
      </div>

      {error ? (
        <div style={{ color: 'var(--color-danger)' }} data-testid="brain-versions-error">{error}</div>
      ) : null}

      {versions && versions.length === 0 ? (
        <div style={{ opacity: 0.7, fontSize: 14 }} data-testid="brain-versions-empty">
          Ingen versioner endnu. Der bliver gemt et mærke automatisk næste gang ny viden kommer ind — eller du kan gemme et selv nu.
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 10 }}>
        {(versions ?? []).map((v) => (
          <div
            key={v.id}
            data-testid="brain-version-row"
            style={{
              display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
              padding: '14px 16px', borderRadius: 10,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
            }}
          >
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>{v.label}</div>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>
                {dansk(v.takenAt)} (dansk tid) · {GRUND[v.reason] ?? v.reason} · {v.neuronCount} Neuroner
              </div>
            </div>

            {!v.coverageIntact ? (
              <span
                data-testid="brain-version-incomplete"
                title={`Hukommelses-loggen manglede ${v.coverageGaps} hændelse(r) da mærket blev taget.`}
                style={{
                  fontSize: 12, padding: '3px 8px', borderRadius: 999,
                  background: 'var(--color-danger)', color: '#fff',
                }}
              >
                ufuldstændig
              </span>
            ) : null}

            <button
              type="button"
              data-testid="brain-version-diff-btn"
              onClick={() => void openDiff(v)}
              class="btn"
            >
              Se hvad der ville ske
            </button>
          </div>
        ))}
      </div>

      <Modal
        open={!!diffFor}
        title={result ? 'Hjernen er rullet tilbage' : `Tilbage til «${diffFor?.label ?? ''}»`}
        onClose={() => { setDiffFor(null); setDiff(null); setResult(null); }}
        maxWidth="md"
        footer={
          result ? (
            <ModalButton variant="primary" onClick={() => { setDiffFor(null); setDiff(null); setResult(null); }}>
              Luk
            </ModalButton>
          ) : (
            <>
              <ModalButton onClick={() => { setDiffFor(null); setDiff(null); }}>Fortryd</ModalButton>
              <ModalButton
                variant="danger"
                disabled={restoring || loadingDiff || !diff || diff.changes.length === 0}
                onClick={() => void handleRestore()}
              >
                {restoring ? 'Ruller tilbage…' : 'Rul hjernen tilbage'}
              </ModalButton>
            </>
          )
        }
      >
        {loadingDiff ? (
          <div style={{ padding: '18px 0', fontSize: 14 }} data-testid="brain-version-diff-loading">
            Regner forskellen ud…
          </div>
        ) : result ? (
          <div data-testid="brain-version-result" style={{ fontSize: 14, lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>
              <strong>{result.applied}</strong> Neuron(er) er sat tilbage.
            </p>
            <p>
              Der blev gemt et mærke af hjernen <em>lige før</em> rulningen, så du også kan fortryde
              dette. Det ligger øverst i listen.
            </p>
            {result.searchIndexStale ? (
              <p style={{ color: 'var(--color-danger)' }}>
                Søgningen er ikke opdateret endnu — den kan give gamle svar et øjeblik.
              </p>
            ) : null}
          </div>
        ) : diff ? (
          <div data-testid="brain-version-diff" style={{ fontSize: 14, lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>
              Sådan så hjernen ud <strong>{dansk(diff.version.takenAt)}</strong> (dansk tid).
            </p>

            {diff.changes.length === 0 ? (
              <p data-testid="brain-version-diff-empty">
                Der er ikke sket noget siden. Ingenting ville ændre sig.
              </p>
            ) : (
              <>
                <ul style={{ paddingLeft: 20, margin: '12px 0' }}>
                  {diff.revert > 0 ? (
                    <li><strong>{diff.revert}</strong> Neuron(er) får deres gamle tekst tilbage</li>
                  ) : null}
                  {diff.archive > 0 ? (
                    <li><strong>{diff.archive}</strong> Neuron(er) lægges væk — de fandtes ikke dengang</li>
                  ) : null}
                  {diff.unarchive > 0 ? (
                    <li><strong>{diff.unarchive}</strong> Neuron(er) hentes frem igen — de fandtes dengang</li>
                  ) : null}
                </ul>
                <p style={{ opacity: 0.75 }}>
                  {diff.unchanged} Neuron(er) er uændrede og bliver ikke rørt.
                </p>
                <div
                  style={{
                    maxHeight: 220, overflowY: 'auto', overflowX: 'auto',
                    border: '1px solid var(--color-border)', borderRadius: 8, padding: 10,
                    fontFamily: 'var(--font-mono)', fontSize: 12,
                  }}
                >
                  {diff.changes.slice(0, 60).map((c) => (
                    <div key={c.documentId} style={{ whiteSpace: 'nowrap' }}>
                      {c.action === 'revert' ? '↺' : c.action === 'archive' ? '×' : '+'}{' '}
                      {(c.path ?? '') + (c.filename ?? c.documentId)}
                    </div>
                  ))}
                  {diff.changes.length > 60 ? (
                    <div style={{ opacity: 0.6 }}>…og {diff.changes.length - 60} flere</div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
