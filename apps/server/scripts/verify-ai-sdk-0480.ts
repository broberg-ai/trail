/**
 * F287.2 — bevis at motorens LLM-veje FAKTISK svarer på @broberg/ai-sdk 0.48.0.
 *
 * HVORFOR DETTE SCRIPT FINDES. F287.1 opgraderede 0.38.0 → 0.48.0 og beviste
 * det med typecheck og testsuite. Ingen af delene kalder en provider. En
 * opgradering af det lag der ER motorens eneste vej til en LLM kan derfor stå
 * fuldstændig grøn og alligevel være brudt på den første rigtige forespørgsel
 * — og så opdages det i produktion, hos tre kunder, på én gang.
 *
 * DEN FÆLDE SCRIPTET SELV ER BYGGET IMOD. En grøn kørsel her ville bevise
 * ingenting hvis den kom fra 0.38.0. Derfor læser `assertInstalledVersion()`
 * pakkens EGEN package.json fra node_modules og STOPPER hvis tallet ikke er
 * 0.48.0 — før der sendes et eneste kald. Uden det er scriptets output en
 * påstand om «en version», ikke om DEN version.
 *
 * REGION LÆSES AF SVARET, ikke af tier-tabellen. `resolveModel('vision')` kan
 * sige én ting mens kaldet gik et andet sted hen (den præcise drift ai-sdk
 * selv rettede i 0.29). `usage.provider` / `usage.model` er hvad der FAKTISK
 * svarede, og det er dét vi printer.
 *
 * Kør:  bun run apps/server/scripts/verify-ai-sdk-0480.ts
 * Kræver MISTRAL_API_KEY i miljøet (læses fra repoets .env af bun).
 * Koster to rigtige provider-kald — små, men ikke gratis.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ai } from '../src/lib/ai.js';

const FORVENTET_VERSION = '0.48.0';

function assertInstalledVersion(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@broberg/ai-sdk/package.json');
  const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  console.log(`installeret @broberg/ai-sdk: ${version}  (${pkgPath})`);
  if (version !== FORVENTET_VERSION) {
    throw new Error(
      `FORKERT VERSION: ${version}, forventede ${FORVENTET_VERSION}. `
      + 'En grøn kørsel på en anden version beviser ikke det dette script findes for.',
    );
  }
  return version;
}

/**
 * 64×64 px i REN MAGENTA (#FF00FF) — og farven er hele pointen.
 *
 * FØRSTE UDGAVE BRUGTE EN 1×1 RØD PIXEL, og den kørte grønt mens den beviste
 * ingenting. Modellen svarede: «Billedet viser en person, der sidder på en stol
 * og arbejder på en bærbar computer.» Det er en ren opdigtning — men den ville
 * være kommet nøjagtig lige så let hvis billedet ALDRIG var nået frem og
 * modellen kun havde set ordene «beskriv dette billede». Testen kunne altså
 * ikke skelne «vision-vejen bar billedet» fra «vision-vejen tabte billedet».
 * Den fejlede i den GRØNNE retning, hvilket er den slags der ikke opdages.
 *
 * En usædvanlig, entydig farve kan ikke gættes ud af prompten. Svaret SKAL
 * nævne den, ellers så modellen ikke billedet — og så fejler scriptet.
 */
const MAGENTA_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAdklEQVR4nO3PQQkAMAzAwPo33Yno4xgEIuAyO/t1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWHHtBp+HSthEAJgAAAABJRU5ErkJggg==',
  'base64',
);

/** Ord der alle betyder «magenta» nok til at bevise at billedet blev set.
 *  Bevidst bredt: vi tester billed-transporten, ikke modellens farveordforråd. */
const MAGENTA_ORD = ['magenta', 'pink', 'lyser\u00f8d', 'lilla', 'violet', 'fuchsia', 'purple', 'ros', 'r\u00f8dlilla'];

// Samme override som motorens egne kaldesteder bruger (source-inferer.ts:76,
// vision.ts:22). Vi prøver netop DE veje, ikke en generisk standardrute.
const CHAT_OVERRIDE = { provider: 'mistral', model: 'mistral-small-latest', transport: 'http' as const };
const VISION_OVERRIDE = { provider: 'mistral', model: 'mistral-small-latest', transport: 'http' as const };

async function main(): Promise<void> {
  assertInstalledVersion();

  if (!process.env.MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY mangler — scriptet kan ikke bevise noget uden en rigtig provider.');
  }

  let fejl = 0;

  // ── ai.chat ────────────────────────────────────────────────────────────
  console.log('\n— ai.chat (motorens vej for source-infer, tags, oversættelse, lint)');
  try {
    const res = await ai.chat({
      messages: [{ role: 'user', content: 'Svar med præcis ét ord: hvilken farve er himlen på en skyfri dag?' }],
      override: CHAT_OVERRIDE,
      maxTokens: 32,
      purpose: 'verify-ai-sdk-0480',
    });
    const text = (res.text ?? '').trim();
    console.log(`  svar      : ${JSON.stringify(text)}`);
    console.log(`  provider  : ${res.usage.provider}   (læst af SVARET)`);
    console.log(`  model     : ${res.usage.model}`);
    console.log(`  tokens    : ${res.usage.inputTokens} ind / ${res.usage.outputTokens} ud`);
    console.log(`  costUsd   : ${res.usage.costUsd}`);
    if (text.length === 0) {
      console.log('  FEJL: tomt svar — vejen svarede, men uden indhold.');
      fejl += 1;
    }
  } catch (err) {
    console.log(`  FEJL: ${err instanceof Error ? err.message : String(err)}`);
    fejl += 1;
  }

  // ── ai.vision ──────────────────────────────────────────────────────────
  console.log('\n— ai.vision (motorens vej for billed-kilder og indlejrede billeder)');
  try {
    const res = await ai.vision({
      image: new Uint8Array(MAGENTA_PNG),
      mimeType: 'image/png',
      prompt: 'Hvilken farve er dette billede? Svar kort.',
      tier: 'vision',
      override: VISION_OVERRIDE,
      purpose: 'verify-ai-sdk-0480',
    });
    const text = (res.text ?? '').trim();
    console.log(`  svar      : ${JSON.stringify(text.slice(0, 160))}`);
    console.log(`  provider  : ${res.usage.provider}   (læst af SVARET)`);
    console.log(`  model     : ${res.usage.model}`);
    console.log(`  tokens    : ${res.usage.inputTokens} ind / ${res.usage.outputTokens} ud`);
    console.log(`  costUsd   : ${res.usage.costUsd}`);
    if (text.length === 0) {
      console.log('  FEJL: tomt svar — vejen svarede, men uden indhold.');
      fejl += 1;
    } else if (!MAGENTA_ORD.some((ord) => text.toLowerCase().includes(ord))) {
      // Det er HER testen får lov at diskriminere. Et svar uden farven betyder
      // at modellen ikke så billedet — uanset hvor overbevisende det lyder.
      console.log(`  FEJL: svaret nævner ikke billedets farve (${MAGENTA_ORD.join('/')}).`);
      console.log('        Billedet nåede altså sandsynligvis ikke frem — svaret er opdigtet.');
      fejl += 1;
    }
  } catch (err) {
    console.log(`  FEJL: ${err instanceof Error ? err.message : String(err)}`);
    fejl += 1;
  }

  console.log(`\n${fejl === 0 ? 'BEGGE VEJE SVAREDE' : `${fejl} vej(e) fejlede`} på @broberg/ai-sdk ${FORVENTET_VERSION}.`);
  if (fejl > 0) process.exit(1);
}

await main();
