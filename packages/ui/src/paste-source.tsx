import { useCallback, useState } from 'preact/hooks';
import { noteFilnavn, kanGemmes } from '@trail/shared';

/**
 * F149.7 — «Indsæt tekst» ved siden af drop-zonen.
 *
 * Christian: «et felt eller en knap på Sources, hvor den blot åbner et txt felt
 * hvor jeg kan paste nogle tanker og skriblerier ind der sendes direkte til
 * Active Ingest.»
 *
 * Teksten pakkes som en File og sendes gennem det EKSISTERENDE upload-kald —
 * ingen ny server-rute, så dedup, connector-stempling og kompilerings-kæden
 * gælder uden en kopi der kan drive fra originalen.
 *
 * `upload` injiceres, fordi de to flader autentificerer forskelligt: admin
 * bruger session-cookie, Ingest-Station en API-nøgle. Alt ANDET — navngivning,
 * validering, knappernes tilstande — er fælles, og det er netop det der ellers
 * ville drive fra hinanden i to kopier.
 */
export function PasteSource({
  upload,
  onSaved,
  testidPrefix = 'paste-source',
}: {
  upload: (file: File) => Promise<unknown>;
  onSaved?: () => void;
  testidPrefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState('');
  const [gemmer, setGemmer] = useState(false);
  const [fejl, setFejl] = useState<string | null>(null);
  const [kvittering, setKvittering] = useState<string | null>(null);

  const gem = useCallback(async () => {
    if (!kanGemmes(tekst) || gemmer) return;
    setGemmer(true);
    setFejl(null);
    try {
      const navn = noteFilnavn(tekst);
      // type text/markdown, så motoren vælger markdown-parseren — ikke fordi
      // noten ER markdown, men fordi den behandler almindelig tekst korrekt og
      // en overskrift bliver til en overskrift hvis brugeren skrev en.
      await upload(new File([tekst], navn, { type: 'text/markdown' }));
      setTekst('');
      setOpen(false);
      setKvittering(navn);
      onSaved?.();
    } catch (err) {
      // Fejlen VISES frem for at lukke feltet. Lukkede vi, ville teksten være
      // tabt — og en note man lige har skrevet er det dyreste at miste.
      setFejl(err instanceof Error ? err.message : String(err));
    } finally {
      setGemmer(false);
    }
  }, [tekst, gemmer, upload, onSaved]);

  if (!open) {
    return (
      <div class="mt-3">
        <button
          type="button"
          data-testid={`${testidPrefix}-open`}
          onClick={() => { setOpen(true); setKvittering(null); }}
          class="rounded-lg border border-line px-4 py-2 text-sm text-ink transition
                 hover:bg-ink/5 active:scale-[0.98] active:bg-ink/10"
        >
          ✎ Indsæt tekst
        </button>
        {kvittering && (
          <span data-testid={`${testidPrefix}-receipt`} class="ml-3 text-sm text-muted">
            Gemt som <code>{kvittering}</code> — kompileres nu.
          </span>
        )}
      </div>
    );
  }

  const kan = kanGemmes(tekst) && !gemmer;

  return (
    <div data-testid={`${testidPrefix}-root`} class="mt-3 rounded-lg border border-line p-4">
      <label class="block text-sm text-muted mb-2" for={`${testidPrefix}-textarea`}>
        Tanker og skriblerier — det bliver en kilde som alt andet du lægger ind.
      </label>
      <textarea
        id={`${testidPrefix}-textarea`}
        data-testid={`${testidPrefix}-textarea`}
        value={tekst}
        rows={10}
        autoFocus
        placeholder={'# En overskrift bliver til notens navn\n\nSkriv eller indsæt her…'}
        onInput={(e) => setTekst((e.target as HTMLTextAreaElement).value)}
        class="w-full rounded-md border border-line bg-cream px-3 py-2 font-mono text-sm text-ink
               focus:outline-none focus:ring-2 focus:ring-ink/20"
      />
      {fejl && (
        <p data-testid={`${testidPrefix}-error`} class="mt-2 text-sm text-danger">
          Kunne ikke gemme: {fejl}
        </p>
      )}
      <div class="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid={`${testidPrefix}-save`}
          disabled={!kan}
          onClick={() => void gem()}
          class="rounded-lg bg-ink px-4 py-2 text-sm text-cream transition
                 hover:bg-ink/90 active:scale-[0.98]
                 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {gemmer ? 'Gemmer…' : 'Gem som kilde'}
        </button>
        <button
          type="button"
          data-testid={`${testidPrefix}-cancel`}
          disabled={gemmer}
          onClick={() => { setOpen(false); setFejl(null); }}
          class="rounded-lg border border-line px-4 py-2 text-sm text-muted transition
                 hover:bg-ink/5 active:scale-[0.98] disabled:opacity-40"
        >
          Annullér
        </button>
        {!kanGemmes(tekst) && (
          <span class="text-sm text-muted">Skriv noget først.</span>
        )}
      </div>
    </div>
  );
}
