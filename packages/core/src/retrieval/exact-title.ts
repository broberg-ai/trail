/**
 * F261 — ET NAVN ER ET OPSLAG, IKKE EN ORDTÆLLING.
 *
 * Ejerens formulering, 6/9 2026: *«hvis jeg søger efter "Cardmem" så leder jeg
 * i min hjerne efter om der er en præcis reference (en neuron) med det navn.»*
 *
 * Det er ikke en rangerings-justering. En TITEL er en anden slags bevis end en
 * ordtælling: at «cardmem» står som titel på en Neuron betyder at den Neuron
 * ER cardmem. At ordet står fyrre gange i en log betyder at loggen NÆVNER det.
 * En frekvens-score kan ikke skelne de to; en titel kan.
 *
 * MÅLT FØR REGLEN BLEV SKREVET, i broberg.ai: søgning på «Christian Broberg»
 * gav hans egen Neuron som nr. 17 — under seksten sider der blot nævnte
 * «broberg». Betydnings-halvdelen rangerede den som nr. 1 (0,815, basens
 * højeste), men måtte ikke bruge det, fordi ordsøgningen allerede havde fundet
 * dokumentet og dermed «brugt» pladsen.
 *
 * BÅDE SØGNING OG CHAT KALDER DENNE ENE FUNKTION. To kopier ville drive fra
 * hinanden, og så ville Aidan og søgefeltet svare forskelligt på det samme
 * navn — hvilket er værre end at begge er middelmådige, fordi ingen af dem så
 * kan bruges til at kontrollere den anden.
 */
import type { TrailDatabase } from '@trail/db';

export interface ExactTitleHit {
  id: string;
  title: string;
  filename: string;
  path: string;
}

/**
 * Neuroner hvis TITEL er præcis det der blev søgt efter.
 *
 * Ufølsom for store bogstaver og for mellemrum i kanterne — «christian
 * broberg» og « Christian Broberg » er det samme opslag for et menneske.
 *
 * FLERE TRÆF RETURNERES ALLE, nyeste først. Der ER dubletter i drift (målt:
 * to Neuroner med titlen «Christian Broberg» i samme videnbase), og at vælge
 * én ville skjule den anden. En dublet skal kunne SES, ikke skjules af et
 * valg vi traf på brugerens vegne.
 */
export async function exactTitleMatches(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId: string,
  query: string,
  limit = 5,
): Promise<ExactTitleHit[]> {
  const q = query.trim();
  // Et tomt eller absurd langt opslag er ikke et navn.
  if (q.length === 0 || q.length > 200) return [];

  const rows = (await db.execute(
    `SELECT id, title, filename, path
       FROM documents
      WHERE tenant_id = ?
        AND knowledge_base_id = ?
        AND kind = 'wiki'
        AND archived = 0
        AND LOWER(TRIM(title)) = LOWER(?)
      ORDER BY updated_at DESC
      LIMIT ?`,
    [tenantId, knowledgeBaseId, q, limit],
  )).rows as Array<{ id: string; title: string; filename: string; path: string }>;

  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ''),
    filename: String(r.filename ?? ''),
    path: String(r.path ?? ''),
  }));
}
