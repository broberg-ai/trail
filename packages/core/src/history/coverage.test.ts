/**
 * F253.1 — invarianten skal kunne SE en skrivning der sprang loggen over.
 *
 * Prøven er bygget om den fejl vi faktisk målte i produktion 6. september, og
 * ikke om en opdigtet: to Neuroner var skrevet direkte i databasen udenom
 * appen, med SAMME LÆNGDE før og efter. Fikstur nummer 2 herunder gengiver
 * præcis det — en tekst-erstatning af samme længde — fordi en prøve der kun
 * ændrer længden ville bestå med en invariant der sammenlignede `LENGTH()`.
 *
 * NEGATIV KONTROL FØRST: en base hvor alt er logget SKAL melde intakt. Uden
 * den beviser en grøn «revne fundet» ingenting — en invariant der altid råber
 * finder også revner der ikke er der.
 */
import { test, expect } from 'bun:test';
import { createLibsqlDatabase } from '@trail/db';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { auditEventLogCoverage, repairEventLogCoverage } from './coverage.js';

const T = 't-cov';

async function seed() {
  const p = join(process.env.TMPDIR ?? '/tmp', `cov-${process.pid}-${Math.random()}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.execute(`INSERT INTO tenants (id, slug, name, plan) VALUES (?,?,?,?)`, [T, 'cov', 'Cov', 'hobby']);
  await trail.execute(`INSERT INTO users (id, tenant_id, email, display_name, role, onboarded) VALUES (?,?,?,?,?,1)`,
    ['u-cov', T, 'cov@local.trail', 'C', 'owner']);
  await trail.execute(`INSERT INTO knowledge_bases (id, tenant_id, created_by, name, slug, language) VALUES (?,?,?,?,?,?)`,
    ['kb-cov', T, 'u-cov', 'cov', 'cov', 'da']);
  return { trail, path: p };
}

/** Skriv en Neuron ORDENTLIGT: indhold + hændelse med kopi, som appen gør. */
async function neuronMedLog(trail: any, id: string, text: string, version = 1) {
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, path, file_type, file_size, content, version, archived)
     VALUES (?,?,?,?,'wiki',?,'/neurons/',?,?,?,?,0)`,
    [id, T, 'kb-cov', 'u-cov', `${id}.md`, 'md', text.length, text, version],
  );
  for (let v = 1; v <= version; v += 1) {
    await trail.execute(
      `INSERT INTO wiki_events (id, tenant_id, document_id, event_type, actor_kind, previous_version, new_version, content_snapshot)
       VALUES (?,?,?,?,'llm',?,?,?)`,
      [`evt-${id}-${v}`, T, id, v === 1 ? 'created' : 'edited', v === 1 ? null : v - 1, v, text],
    );
  }
}

test('negativ kontrol — en base hvor alt er logget melder INTAKT', async () => {
  const { trail } = await seed();
  await neuronMedLog(trail, 'n1', 'hej verden', 1);
  await neuronMedLog(trail, 'n2', 'to versioner', 2);

  const r = await auditEventLogCoverage(trail, T);
  expect(r.neurons).toBe(2);
  expect(r.withoutHistory).toBe(0);
  expect(r.gaps).toEqual([]);
  expect(r.intact).toBe(true);
});

test('en skrivning udenom loggen fanges — også når LÆNGDEN er uændret', async () => {
  const { trail } = await seed();
  const før = 'nada-protokollen varer 45 minutter';
  await neuronMedLog(trail, 'n1', før, 1);

  // Præcis den hændelse vi målte: et script skriver direkte, samme længde.
  const efter = 'nada-protokollen varer 40 minutter';
  expect(efter.length).toBe(før.length); // ellers beviser prøven noget andet
  await trail.execute(`UPDATE documents SET content = ? WHERE id = 'n1'`, [efter]);

  const r = await auditEventLogCoverage(trail, T);
  expect(r.intact).toBe(false);
  expect(r.gaps).toHaveLength(1);
  expect(r.gaps[0]!.documentId).toBe('n1');
  expect(r.gaps[0]!.contentDrift).toBe(true);
});

test('en skrivning der senere blev overskrevet fanges af version-invarianten', async () => {
  const { trail } = await seed();
  // Version 3, men kun 2 hændelser: én skrivning blev aldrig logget, og en
  // senere ægte skrivning har visket indholds-sporet ud. Indholds-invarianten
  // er GRØN her — det er hele grunden til at der er to.
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, path, file_type, file_size, content, version, archived)
     VALUES ('n1',?,'kb-cov','u-cov','wiki','n1.md','/neurons/','md',5,'endelig',3,0)`, [T]);
  for (const [v, txt] of [[1, 'først'], [3, 'endelig']] as const) {
    await trail.execute(
      `INSERT INTO wiki_events (id, tenant_id, document_id, event_type, actor_kind, new_version, content_snapshot)
       VALUES (?,?,?,?,'llm',?,?)`, [`evt-${v}`, T, 'n1', v === 1 ? 'created' : 'edited', v, txt]);
  }

  const r = await auditEventLogCoverage(trail, T);
  expect(r.gaps).toHaveLength(1);
  expect(r.gaps[0]!.contentDrift).toBe(false); // indholdet MATCHER — den svage invariant ser intet
  expect(r.gaps[0]!.versionDrift).toBe(true);  // …men versionerne røber det
});

test('flere hændelser end versioner er IKKE et hul (en arkivering bumper ikke version)', async () => {
  const { trail } = await seed();
  await neuronMedLog(trail, 'n1', 'tekst', 1);
  await trail.execute(
    `INSERT INTO wiki_events (id, tenant_id, document_id, event_type, actor_kind, new_version, content_snapshot)
     VALUES ('evt-extra',?, 'n1','renamed','user',1,'tekst')`, [T]);

  const r = await auditEventLogCoverage(trail, T);
  expect(r.intact).toBe(true);
});

test('en Neuron helt uden historik tælles for sig — den kan slet ikke tidsrejses', async () => {
  const { trail } = await seed();
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, path, file_type, file_size, content, version, archived)
     VALUES ('n1',?,'kb-cov','u-cov','wiki','n1.md','/neurons/','md',3,'ude',1,0)`, [T]);

  const r = await auditEventLogCoverage(trail, T);
  expect(r.withoutHistory).toBe(1);
  expect(r.intact).toBe(false);
});

test('kilde-filer tælles ikke med — de har med vilje ingen log', async () => {
  const { trail } = await seed();
  await trail.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, path, file_type, file_size, content, archived)
     VALUES ('s1',?,'kb-cov','u-cov','source','s1.md','/','md',3,'rå',0)`, [T]);

  const r = await auditEventLogCoverage(trail, T);
  expect(r.neurons).toBe(0);
  expect(r.intact).toBe(true);
});

test('reparationen lukker revnen — og læses tilbage fra en frisk forespørgsel', async () => {
  const { trail } = await seed();
  await neuronMedLog(trail, 'n1', 'oprindelig tekst her', 1);
  await trail.execute(`UPDATE documents SET content = ? WHERE id = 'n1'`, ['ændret tekst uden log']);

  const før = await auditEventLogCoverage(trail, T);
  expect(før.intact).toBe(false);

  const antal = await repairEventLogCoverage(trail, T, før.gaps);
  expect(antal).toBe(1);

  // LÆS TILBAGE — ikke reparationens eget returtal, men basens tilstand.
  const efter = await auditEventLogCoverage(trail, T);
  expect(efter.intact).toBe(true);

  // Og hændelsen skal BÆRE det indhold der faktisk står, ikke en rekonstruktion.
  const ev: any = (await trail.execute(
    `SELECT content_snapshot AS snap, actor_kind AS actor, summary FROM wiki_events
      WHERE document_id = 'n1' ORDER BY created_at DESC, rowid DESC LIMIT 1`)).rows[0];
  expect(ev.snap).toBe('ændret tekst uden log');
  expect(ev.actor).toBe('system');
  expect(String(ev.summary)).toContain('Indhentning');
});

test('reparationen opfinder ikke en fortid — hændelsen bærer den version der ER', async () => {
  // FØRSTE UDGAVE AF DENNE PRØVE VAR VATTERET, og mutationstesten afslørede det:
  // den asserterede på dokumentets version, som reparationen aldrig rører — så
  // den var grøn uanset hvad hændelsen indeholdt. Den påstod altså noget den
  // ikke målte. Nu asserteres der på HÆNDELSENS new_version, som er dét tal
  // reparationen faktisk skriver, og som en tilbagerulning senere læser.
  const { trail } = await seed();
  await neuronMedLog(trail, 'n1', 'tekst', 2);
  await trail.execute(`UPDATE documents SET content = 'skredet' WHERE id = 'n1'`);

  const før = await auditEventLogCoverage(trail, T);
  await repairEventLogCoverage(trail, T, før.gaps);

  const doc: any = (await trail.execute(`SELECT version FROM documents WHERE id = 'n1'`)).rows[0];
  const ev: any = (await trail.execute(
    `SELECT new_version AS nv, previous_version AS pv FROM wiki_events
      WHERE document_id = 'n1' ORDER BY created_at DESC, rowid DESC LIMIT 1`)).rows[0];

  expect(Number(doc.version)).toBe(2);       // dokumentet røres ikke
  expect(Number(ev.nv)).toBe(2);             // hændelsen siger den version der ER — ikke en ny
  expect(Number(ev.pv)).toBe(1);
});
