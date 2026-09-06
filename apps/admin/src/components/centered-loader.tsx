/**
 * CenteredLoader — panelets vente-tilstand.
 *
 * F257.4: erstattede den 320px store neuron-animation i et 60vh-felt. Den
 * fyldte omkring en tredjedel af skærmen for at sige «vent», og den sagde
 * ikke andet end det.
 *
 * NAVNET ER BEHOLDT MED VILJE. 22 kaldesteder bruger det, og at omdøbe dem
 * alle sammen i samme ombæring ville gøre diff'en umulig at læse — og
 * blande «vi skiftede udseendet» sammen med «vi rørte 22 filer». Formen
 * ligger i {@link WaitingState}; denne er den tynde indpakning kaldestederne
 * allerede kender.
 */
import { WaitingState } from './waiting-state';
import { t } from '../lib/i18n';

interface Props {
  /** Tekst under pulsen. Skelet-varianten er tekstløs og ignorerer den. */
  label?: string;
  /** `list` → skelet-rækker. `value` → pulslinje (standard). */
  variant?: 'list' | 'value';
  /** Antal skelet-rækker. Kun for `list`. */
  rows?: number;
}

export function CenteredLoader({ label, variant, rows }: Props) {
  return <WaitingState label={label ?? t('common.loading')} variant={variant} rows={rows} />;
}
