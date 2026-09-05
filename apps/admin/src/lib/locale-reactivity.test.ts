import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * F250 — værn mod at sprogskiftet igen holder op med at nå en flade.
 *
 * getLocale() er en ØJEBLIKS-AFLÆSNING uden abonnering. Kaldes den i en
 * komponents render-krop, bliver komponenten stående på det sprog den blev
 * FØDT med: setLocale() notificerer lyttere, og en global variabel har ingen.
 * Ejeren så præcis det 5/9 — dansk menu, engelsk Konto-side, samme skærm.
 *
 * useLocale() er hooken der abonnerer, og den fandtes hele tiden; den var bare
 * ikke brugt seks steder. Derfor pinner denne test ANTALLET af getLocale()-kald
 * frem for at forbyde funktionen: den er stadig den rigtige på de fire steder
 * nedenfor, hvor en hook enten er ulovlig eller ville være forkert.
 *
 * Går tallet OP, er der kommet et nyt kaldested, og det skal vurderes bevidst —
 * ikke opdages af en ejer på en telefon.
 */

const SRC = new URL('../', import.meta.url).pathname;

/** De eneste lovlige kald, med grunden. Ændres listen, ændres ALLOWED. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'panels/settings-account.tsx': {
    count: 1,
    why: 'formatDate er en ren funktion uden for en komponent — en hook ville være ulovlig. Den kaldes fra en render der selv abonnerer, så den læser den aktuelle værdi.',
  },
  'panels/cost.tsx': {
    count: 1,
    why: 'useState-initializer: kører kun ved mount og sætter en STARTVALUTA som brugeren derefter selv vælger og som gemmes i localStorage. En hook her ville overskrive hendes valg ved hvert sprogskift.',
  },
  'components/new-trail-modal.tsx': {
    count: 2,
    why: 'initial state + reset-handler: sproget på en NY Trail følger admin-sproget som udgangspunkt, men er brugerens valg derefter.',
  },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

function countCalls(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of walk(SRC)) {
    // i18n.ts DEFINERER funktionen — dens egen export tæller ikke med.
    if (file.endsWith('lib/i18n.ts')) continue;
    // Kommentarer strippes FØRST. Uden det talte testen sit eget kommentar-ord
    // med — den fandt 2 kald i settings-account hvor der er 1 — og en test der
    // ikke kan skelne en forklaring fra et kald ville derefter enten larme
    // falsk eller blive slækket til at larme mindre. Målt ved første kørsel.
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const n = (src.match(/\bgetLocale\(\)/g) ?? []).length;
    if (n > 0) found.set(file.slice(SRC.length), n);
  }
  return found;
}

test('ingen NYE getLocale()-kald — sprogskiftet skal nå hver flade', () => {
  const found = countCalls();
  const uventede: string[] = [];
  for (const [file, n] of found) {
    const allowed = ALLOWED[file];
    if (!allowed) {
      uventede.push(`${file}: ${n} kald — nyt kaldested. Brug useLocale() i en render-krop, eller tilføj filen til ALLOWED med en grund.`);
    } else if (n > allowed.count) {
      uventede.push(`${file}: ${n} kald, kun ${allowed.count} tilladt (${allowed.why})`);
    }
  }
  expect(uventede.join('\n')).toBe('');
});

test('de tilladte kaldesteder findes stadig — listen må ikke blive et fossil', () => {
  const found = countCalls();
  // Et ALLOWED-punkt der er forsvundet betyder at listen beskytter noget der
  // ikke er der. Så ville testen fortsat være grøn mens den holdt øje med
  // ingenting — samme fejlform som resten af reglen handler om.
  const forsvundne = Object.keys(ALLOWED).filter((f) => !found.has(f));
  expect(forsvundne).toEqual([]);
});
