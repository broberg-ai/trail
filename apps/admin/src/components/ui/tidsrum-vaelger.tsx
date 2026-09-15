/**
 * F273.2 — «Hvad lærte jeg mellem X og Y».
 *
 * Ejerens ord: «jeg kan ikke finde en given aktivitet der er sket i Trail i et
 * bestemt interval.» Det er kontrollen der stiller spørgsmålet.
 *
 * TO RETTELSER EFTER FØRSTE UDGAVE, begge rapporteret af ejeren med et
 * skærmbillede — og begge fordi jeg skrev komponenten uden at se på koden
 * omkring den:
 *
 *  1. TEKSTERNE VAR HARDKODET PÅ DANSK. Panelet omkring dem kalder `t()` for
 *     hver eneste streng, så på en engelsk flade stod mine knapper alene
 *     tilbage på dansk. Alt går nu gennem `timeRange.*` i begge locales.
 *  2. FELTERNE VAR TEKSTFELTER med «ÅÅÅÅ-MM-DD» som pladsholder. Det er ikke
 *     en datovælger, det er en formular der beder brugeren om at kende et
 *     format. Nu en rigtig kalender — se date-picker.tsx.
 *
 * DATOERNE VISES ALTID PÅ DANSK, også når sproget er engelsk. Det er ejerens
 * regel og den er ikke en oversættelses-forglemmelse: `04/09/2026` betyder to
 * forskellige dage i de to sprog, og tallet afslører ikke hvilken der var ment.
 * Se lib/dates.ts.
 */
import { useState } from 'preact/hooks';
import type { Tidsrum } from '../../api';
import { t, useLocale } from '../../lib/i18n';
import { danskISODato, danskVaegurVisning } from '../../lib/dates';
import { DatePicker } from './date-picker';

/** `YYYY-MM-DD` for en dag N dage fra i dag, i DANSK tid. */
function dagsdato(forskyd = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + forskyd);
  return danskISODato(d);
}

/** Et hurtigvalg. `byg` kaldes ved klik — aldrig på forhånd, så «i dag» ikke
 *  bliver hængende på gårsdagens dato i en fane der har stået åben. */
const HURTIGVALG: ReadonlyArray<{ id: string; noegle: string; byg: () => Tidsrum }> = [
  { id: 'i-dag', noegle: 'timeRange.today', byg: () => ({ fra: dagsdato(), til: dagsdato() }) },
  { id: 'i-gaar', noegle: 'timeRange.yesterday', byg: () => ({ fra: dagsdato(-1), til: dagsdato(-1) }) },
  { id: 'syv-dage', noegle: 'timeRange.last7', byg: () => ({ fra: dagsdato(-6), til: dagsdato() }) },
  { id: 'tredive-dage', noegle: 'timeRange.last30', byg: () => ({ fra: dagsdato(-29), til: dagsdato() }) },
];

export interface TidsrumVaelgerProps {
  værdi: Tidsrum;
  onVælg: (t: Tidsrum) => void;
  /** Serverens kvittering på hvad der faktisk blev spurgt om. */
  opløst?: { fra: string | null; til: string | null; zone: string } | null;
  /** Antal fundne — så «0» kan vises SAMMEN med vinduet og ikke alene. */
  antal?: number | null;
  fejl?: string | null;
}

const CHIP =
  'px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-md border transition ' +
  'hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-bg-elevated)] ' +
  'active:scale-[0.97]';

export function TidsrumVaelger({ værdi, onVælg, opløst, antal, fejl }: TidsrumVaelgerProps) {
  useLocale();
  const [fra, setFra] = useState(værdi.fra ?? '');
  const [til, setTil] = useState(værdi.til ?? '');
  const aktiv = Boolean(værdi.fra || værdi.til);

  const anvend = (f: string, t2: string) => {
    setFra(f);
    setTil(t2);
    onVælg({ fra: f || undefined, til: t2 || undefined });
  };

  return (
    <div class="flex flex-col gap-2" data-testid="neurons-timerange">
      <div class="flex flex-wrap items-center gap-2">
        {HURTIGVALG.map((h) => (
          <button
            key={h.id}
            type="button"
            data-testid={`neurons-timerange-${h.id}`}
            class={`${CHIP} border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]`}
            onClick={() => {
              const v = h.byg();
              anvend(v.fra ?? '', v.til ?? '');
            }}
          >
            {t(h.noegle)}
          </button>
        ))}

        <DatePicker
          testid="neurons-timerange-from"
          value={fra}
          onChange={(v) => anvend(v, til)}
          placeholder={t('timeRange.from')}
          label={t('timeRange.fromLabel')}
        />
        <DatePicker
          testid="neurons-timerange-to"
          value={til}
          onChange={(v) => anvend(fra, v)}
          placeholder={t('timeRange.to')}
          label={t('timeRange.toLabel')}
          min={fra}
        />

        {aktiv && (
          <button
            type="button"
            data-testid="neurons-timerange-clear"
            class={`${CHIP} border-[color:var(--color-border)] bg-transparent text-[color:var(--color-fg-subtle)]`}
            onClick={() => anvend('', '')}
          >
            {t('timeRange.clear')}
          </button>
        )}
      </div>

      {/* Kvitteringen. Den er SERVERENS opløsning af vinduet, ikke vores eget
          valg — ellers ville skærmen bekræfte sin egen hensigt. Antallet står
          i SAMME sætning som vinduet, så «0» aldrig kan læses alene som
          «noget gik galt». */}
      {fejl ? (
        <span
          data-testid="neurons-timerange-error"
          class="text-[11px] font-mono text-[color:var(--color-danger)]"
        >
          {fejl}
        </span>
      ) : opløst && (opløst.fra || opløst.til) ? (
        <span
          data-testid="neurons-timerange-resolved"
          class="text-[11px] font-mono text-[color:var(--color-fg-subtle)]"
        >
          {t(antal === 0 ? 'timeRange.resolvedNone' : 'timeRange.resolvedSome', {
            n: antal ?? '—',
            fra: opløst.fra ? danskVaegurVisning(opløst.fra) : t('timeRange.boundStart'),
            til: opløst.til ? danskVaegurVisning(opløst.til) : t('timeRange.boundNow'),
            zone: opløst.zone,
          })}
        </span>
      ) : null}
    </div>
  );
}
