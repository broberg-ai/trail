/**
 * F286.2 — prove that nothing in the golden set is also in the training set.
 *
 * WHY A SEPARATE SCRIPT AND NOT A COMMENT IN THE EXPORTER. build-dataset.ts
 * makes the split disjoint by construction, and that is exactly the kind of
 * guarantee that quietly stops being true: someone adds a task, hand-edits a
 * file, re-runs half an export. A leak does not surface as an error — it
 * surfaces as a model that scores beautifully and is worth nothing, which is
 * the one failure that never asks to be looked at. So the claim is measured
 * every time, from the files as they are on disk.
 *
 *   bun run apps/scout/src/verify-split.ts
 *
 * Exit 0 = the two sets are disjoint and the golden set is usable.
 * Exit 1 = it says which check failed and on which examples.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { textKey, type Example } from './labels.js';

const DATA = join(import.meta.dir, '..', 'data');

export interface Finding {
  check: string;
  ok: boolean;
  detail: string;
}

export function readJsonl(path: string): Example[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Example);
}

/**
 * The four things that have to hold for a held-out set to mean anything.
 *
 * Pure so the negative control can drive it directly: labels.test.ts moves one
 * golden example into the training rows and asserts this turns red. A checker
 * that has never been seen to fail is a checker nobody has checked.
 */
export function checkSplit(train: Example[], golden: Example[]): Finding[] {
  const findings: Finding[] = [];

  findings.push({
    check: 'begge sæt har rækker',
    ok: train.length > 0 && golden.length > 0,
    detail: `træn ${train.length}, golden ${golden.length}`,
  });

  // The primary leak: the same row on both sides.
  const trainIds = new Set(train.map((r) => `${r.task}:${r.id}`));
  const idLeaks = golden.filter((r) => trainIds.has(`${r.task}:${r.id}`));
  findings.push({
    check: 'intet golden-id optræder i træningssættet',
    ok: idLeaks.length === 0,
    detail: idLeaks.length === 0
      ? `${golden.length} golden-id'er, ingen genfundet blandt ${train.length} træningsrækker`
      : `${idLeaks.length} lækket: ${idLeaks.slice(0, 5).map((r) => `${r.task}:${r.id}`).join(', ')}`,
  });

  // The leak that different ids do not stop: the same TEXT on both sides,
  // whether because a task pair shares a document or because two rows carry
  // identical content. The encoder reads text, not ids — so this is the check
  // that matches what the model actually sees.
  const trainTexts = new Set(train.map((r) => textKey(r.text)));
  const textLeaks = golden.filter((r) => trainTexts.has(textKey(r.text)));
  findings.push({
    check: 'ingen golden-tekst optræder i træningssættet',
    ok: textLeaks.length === 0,
    detail: textLeaks.length === 0
      ? `${new Set(golden.map((r) => textKey(r.text))).size} distinkte golden-tekster, ingen genfundet`
      : `${textLeaks.length} lækket: ${textLeaks.slice(0, 3).map((r) => `${r.task}:${r.id} «${r.text.slice(0, 50)}…»`).join(' | ')}`,
  });

  // A golden set that is all Danish, or all one file format, measures one
  // corner of what the product meets and reports it as the whole.
  const langs = new Set(golden.filter((r) => r.lang !== 'unknown').map((r) => r.lang));
  findings.push({
    check: 'golden dækker både dansk og engelsk',
    ok: langs.has('da') && langs.has('en'),
    detail: `sprog i golden: ${[...new Set(golden.map((r) => r.lang))].sort().join(', ')}`,
  });

  const srcTypes = new Set(golden.filter((r) => r.task === 'source-type').map((r) => r.label));
  findings.push({
    check: 'golden dækker mere end én kildetype',
    ok: srcTypes.size > 1,
    detail: `kildetyper i golden: ${[...srcTypes].sort().join(', ') || '(ingen)'}`,
  });

  // A label with nothing left to train on is a defect the quota guard is meant
  // to prevent; measured here because "meant to" is not evidence.
  const trainLabels = new Set(train.map((r) => `${r.task}/${r.label}`));
  const starved = [...new Set(golden.map((r) => `${r.task}/${r.label}`))].filter(
    (k) => !trainLabels.has(k),
  );
  findings.push({
    check: 'ingen kategori er tømt for træningsdata',
    ok: starved.length === 0,
    detail: starved.length === 0 ? 'alle kategorier med golden-rækker har også træningsrækker' : starved.join(', '),
  });

  return findings;
}

function main(): void {
  const trainPath = join(DATA, 'train.jsonl');
  const goldenPath = join(DATA, 'golden.jsonl');
  if (!existsSync(trainPath) || !existsSync(goldenPath)) {
    console.error(
      `Mangler ${trainPath} / ${goldenPath}.\nKør først:  bun run apps/scout/src/build-dataset.ts`,
    );
    process.exit(1);
  }

  const train = readJsonl(trainPath);
  const golden = readJsonl(goldenPath);
  const findings = checkSplit(train, golden);

  for (const f of findings) {
    console.log(`${f.ok ? '  OK  ' : ' FEJL '} ${f.check}\n         ${f.detail}`);
  }

  const failed = findings.filter((f) => !f.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} kontrol(ler) fejlede — golden-sættet er IKKE holdt ude.`);
    process.exit(1);
  }
  console.log(`\nAlle ${findings.length} kontroller bestået. Golden-sættet er holdt ude af træningen.`);
}

if (import.meta.main) main();
