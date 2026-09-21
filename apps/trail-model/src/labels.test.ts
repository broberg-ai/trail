import { describe, expect, test } from 'bun:test';
import { assignSplits, detectLanguage, goldenQuota, neuronType, sourceType, textKey, type Example } from './labels.js';
import { checkSplit } from './verify-split.js';

function ex(task: string, id: string, label: string, text: string, lang: 'da' | 'en' = 'en'): Example {
  return { task: task as Example['task'], id, label, text, lang, tenant: 't', kb: 'k', split: 'train' };
}

describe('etiketter kommer fra produktionens egne værdier', () => {
  test('kildetype er den pipeline der FAKTISK ville køre', () => {
    // Asked of @trail/pipelines' own registry, so it cannot drift from ingest.
    expect(sourceType('rapport.pdf')).toBe('pdf');
    expect(sourceType('noter.docx')).toBe('docx');
    expect(sourceType('optagelse.wav')).toBe('audio');
    expect(sourceType('skema.xlsx')).toBe('xlsx');
    expect(sourceType('diagram.svg')).toBe('image');
  });

  test('en fil ingen pipeline tager er `text`, ikke en fejl', () => {
    expect(sourceType('memo.md')).toBe('text');
    expect(sourceType('noter.txt')).toBe('text');
    // Measured in production: 2 .doc sources. The docx pipeline accepts only
    // `.docx`, so these went through as raw text — a real category, not a bug.
    expect(sourceType('gammel.doc')).toBe('text');
  });

  test('neuron-type læser sti-konventionen, og `root` er en rigtig kategori', () => {
    expect(neuronType('/neurons/adr/cardmem/')).toBe('adr');
    expect(neuronType('/neurons/concepts/')).toBe('concepts');
    // 52 Neurons sit directly in /neurons/ with no kind. "No kind was chosen"
    // is what a classifier must be able to predict, so it gets a name.
    expect(neuronType('/neurons/')).toBe('root');
    expect(neuronType('/andet/')).toBe('other');
  });

  test('sprog-heuristikken siger `unknown` frem for at gætte', () => {
    expect(detectLanguage('Det er ikke noget vi kan være med til')).toBe('da');
    expect(detectLanguage('This is not the thing that we have to be in')).toBe('en');
    expect(detectLanguage('xyz 42')).toBe('unknown');
  });
});

describe('golden-kvoten', () => {
  test('en kategori med ÉT eksempel får nul golden-rækker', () => {
    // Measured: `supersedes` and `caused-by` have exactly one edge each. Held
    // out they would have nothing to train on; the honest answer is that they
    // cannot be evaluated, not a quota that pretends otherwise.
    expect(goldenQuota(1, 11)).toBe(0);
    expect(goldenQuota(0, 11)).toBe(0);
  });

  test('en kategori beholder altid mindst én træningsrække', () => {
    expect(goldenQuota(2, 11)).toBe(1);
    expect(goldenQuota(3, 99)).toBe(2);
  });
});

describe('opdelingen er tekst-atomar og deterministisk', () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ex('neuron-type', `n${i}`, i < 2 ? 'sjælden' : 'hyppig', `tekst ${i}`)),
    // Same texts, different task — a Neuron is both a neuron-type example and
    // a routing example.
    ...Array.from({ length: 8 }, (_, i) => ex('routing', `r${i}`, 'kb-a', `tekst ${i}`)),
  ];

  test('samme tekst er golden i ALLE opgaver eller i ingen', () => {
    const out = assignSplits(rows, 4);
    const goldenTexts = new Set(out.filter((r) => r.split === 'golden').map((r) => textKey(r.text)));
    const trainTexts = new Set(out.filter((r) => r.split === 'train').map((r) => textKey(r.text)));
    expect([...goldenTexts].filter((t) => trainTexts.has(t))).toEqual([]);
  });

  test('to kørsler vælger de samme eksempler', () => {
    const a = assignSplits(rows, 4).map((r) => `${r.task}:${r.id}:${r.split}`);
    const b = assignSplits([...rows].reverse(), 4).map((r) => `${r.task}:${r.id}:${r.split}`);
    expect(a).toEqual(b);
  });
});

describe('kontrollen kan blive RØD — den negative kontrol', () => {
  const golden = [ex('source-type', 'g1', 'pdf', 'en dansk kilde det er ikke noget vi kan', 'da'), ex('source-type', 'g2', 'text', 'an english source that is not the one we have', 'en')];
  const train = [ex('source-type', 't1', 'pdf', 'helt andet indhold'), ex('source-type', 't2', 'text', 'something else entirely')];

  test('en ren opdeling er grøn', () => {
    expect(checkSplit(train, golden).filter((f) => !f.ok)).toEqual([]);
  });

  test('FLYT ÉT golden-eksempel over i træningen og kontrollen fejler', () => {
    // The mutation the AC asks for: the same row on both sides.
    const leaked = [...train, golden[0]!];
    const failed = checkSplit(leaked, golden).filter((f) => !f.ok);
    expect(failed.map((f) => f.check)).toContain("intet golden-id optræder i træningssættet");
  });

  test('kopiér kun TEKSTEN under et nyt id, og den fejler stadig', () => {
    // The leak a plain id-comparison would miss, and the one that actually
    // happens: the same document exported under two identities.
    const leaked = [...train, ex('routing', 'andet-id', 'kb-a', golden[0]!.text)];
    const failed = checkSplit(leaked, golden).filter((f) => !f.ok);
    expect(failed.map((f) => f.check)).toContain('ingen golden-tekst optræder i træningssættet');
  });

  test('et golden-sæt på ét sprog fejler', () => {
    const daOnly = [golden[0]!, ex('source-type', 'g3', 'text', 'endnu en dansk tekst det er ikke', 'da')];
    const failed = checkSplit(train, daOnly).filter((f) => !f.ok);
    expect(failed.map((f) => f.check)).toContain('golden dækker både dansk og engelsk');
  });

  test('et golden-sæt med kun én kildetype fejler', () => {
    const onePdf = [golden[0]!, ex('source-type', 'g4', 'pdf', 'another english pdf that is not the one we have', 'en')];
    const failed = checkSplit(train, onePdf).filter((f) => !f.ok);
    expect(failed.map((f) => f.check)).toContain('golden dækker mere end én kildetype');
  });

  test('en kategori uden træningsrækker fejler', () => {
    const starved = [...golden, ex('source-type', 'g5', 'audio', 'a lone audio example that is not in the train set', 'en')];
    const failed = checkSplit(train, starved).filter((f) => !f.ok);
    expect(failed.map((f) => f.check)).toContain('ingen kategori er tømt for træningsdata');
  });
});

describe('reparationen — en kategori må aldrig ende uden træningsdata', () => {
  test('en senere opgave kan ikke tømme en tidligere opgaves kategori', () => {
    // The measured failure: `neuron-type/test` had 3 rows, held 2 back, and
    // `routing` then claimed the last text for its own quota — 3 golden,
    // 0 train.
    const rows: Example[] = [
      ...['t1', 't2', 't3'].map((id, i) => ex('neuron-type', id, 'test', `delt ${i}`)),
      ...['r1', 'r2', 'r3'].map((id, i) => ex('routing', id, 'kb-a', `delt ${i}`)),
      ...Array.from({ length: 40 }, (_, i) => ex('routing', `f${i}`, 'kb-b', `fyld ${i}`)),
    ];
    const out = assignSplits(rows, 40);
    for (const task of ['neuron-type', 'routing']) {
      for (const label of new Set(out.filter((r) => r.task === task).map((r) => r.label))) {
        const list = out.filter((r) => r.task === task && r.label === label);
        const train = list.filter((r) => r.split === 'train').length;
        // Reported as an object so a failure names WHICH category was emptied.
        expect({ task, label, hasTrain: train > 0 }).toEqual({ task, label, hasTrain: true });
      }
    }
  });

  test('reparationen bryder ikke tekst-atomariteten', () => {
    const rows: Example[] = [
      ...['t1', 't2', 't3'].map((id, i) => ex('neuron-type', id, 'test', `delt ${i}`)),
      ...['r1', 'r2', 'r3'].map((id, i) => ex('routing', id, 'kb-a', `delt ${i}`)),
    ];
    const out = assignSplits(rows, 40);
    const g = new Set(out.filter((r) => r.split === 'golden').map((r) => textKey(r.text)));
    const t = new Set(out.filter((r) => r.split === 'train').map((r) => textKey(r.text)));
    expect([...g].filter((k) => t.has(k))).toEqual([]);
  });
});
