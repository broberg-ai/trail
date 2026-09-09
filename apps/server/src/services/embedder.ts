/**
 * F254.1 — det ENE sted Trail beder om en vektor.
 *
 * Ligger her og ikke i kernen, fordi @broberg/ai-sdk hører til serveren.
 * Kernen kender kun tallene (packages/core/src/retrieval/vectors.ts), så
 * lighed og kodning kan prøves uden netværk og uden nøgle.
 *
 * EU-RUTEN ER IKKE EN INDSTILLING. Vi bruger Mistral fordi vores data skal
 * blive i EU. Det er hele begrundelsen — den gælder alt hvad Trail rummer, og
 * den afhænger ikke af hvilken kunde eller hvilken slags indhold der ligger i
 * en given videnbase. En begrundelse der peger på ét datasæt bliver forkert
 * den dag datasættet skifter, og så ser reglen ud som noget man kan forhandle.
 *
 * SDK'ets `embedding`-tier peger på OpenAIs text-embedding-3-small i USA, så
 * overriden er hardkodet. `assertEuRoute` læser SVARET tilbage frem for at
 * stole på at anmodningen så rigtig ud.
 */
import { ai } from '../lib/ai.js';
import { EMBEDDING_PROVIDER, EMBEDDING_MODEL } from '@trail/core';

export interface EmbedResult {
  vectors: number[][];
  model: string;
  provider: string;
  costCents: number;
  inputTokens: number;
}

/**
 * En vektor pr. tekst. Batchet — SDK'et tager et array, og et kald pr.
 * tekststykke ville gøre en bagfyldning af 6.796 Neuroner til titusinder af
 * rundture.
 *
 * KASTER hvis svaret ikke kom fra Mistral. Det er med vilje hårdt: en vektor
 * lavet i USA er ikke «lidt forkert», den er et brud på det vi lover kunden,
 * og den ville ligge i basen uden at nogen kunne se hvor den kom fra.
 */
/**
 * F265.11 — residens-vagten som REN FUNKTION, så den kan prøves uden at kalde
 * en model. En vagt der kun kan afprøves ved at bruge penge på et rigtigt kald,
 * bliver afprøvet én gang og aldrig igen.
 *
 * Kaster ved alt andet end en bekræftet EU-region. Returnerer intet — den er en
 * spærre, ikke et opslag.
 */
export function bekraeftResidens(usage: Record<string, unknown> | null | undefined): void {
  const provider = String(usage?.provider ?? '');
  const region = usage?.region === undefined ? null : String(usage.region);

  // LÆS SVARET, IKKE ANMODNINGEN. En override der blev ignoreret ser identisk
  // ud fra kaldestedet.
  //
  // TO SPØRGSMÅL, IKKE ÉT — og det er hele F265.11. Provider svarer på «blev
  // min override ignoreret»; region svarer på «hvor endte data». Den gamle
  // vagt tjekkede KUN det første og lovede det andet i sin fejltekst: en
  // gateway foran Mistral hedder stadig «mistral», så vagten bestod mens data
  // forlod EU. Fundet af ai-sdk som en skærpelse af vores brug (#27112).
  if (provider !== EMBEDDING_PROVIDER) {
    throw new Error(
      `F254: embedding-kaldet gik til «${provider || 'ukendt'}», ikke til ${EMBEDDING_PROVIDER}. ` +
        `Min override blev ignoreret. Ingen vektorer gemt.`,
    );
  }

  // REGIONEN ER DEN ENESTE POSITIVE RESIDENS-PÅSTAND.
  //
  // SDK'ens egen .d.ts: «"unknown" is NOT a synonym for safe. region !== "us"
  // is not an EU check — it passes every OpenRouter call. Only region === "eu"
  // may be treated as EU-resident.» Feltet er UDLEDT af den vært kaldet ramte
  // (regionOfHost), ikke af leverandørnavnet — derfor lukker det gateway-hullet
  // ovenstående tjek lader stå åbent.
  //
  // MÅLT PÅ ET ÆGTE KALD af ai-sdk før denne vagt blev sat (#27115):
  //   api.mistral.ai/v1           → "eu"
  //   gateway.example.com/mistral → "unknown"   ← præcis vores hul
  // Jeg nægtede at stramme på et tabelopslag alene: tabellen beviser at
  // klassifikationen findes, ikke at feltet er udfyldt på DENNE sti — og er
  // det tomt, stopper al indeksering for alle kunder.
  if (region === null) {
    // EGEN BESKED. «Vi kunne ikke afgøre hvor kaldet gik hen» er noget andet
    // end «det gik til USA», og kun den første betyder at instrumentet er i
    // stykker. Slås de sammen, leder et menneske det forkerte sted.
    throw new Error(
      `F265.11: svaret bar ingen region. Residensen kan ikke afgøres, og en ` +
        `ubekræftet residens er ikke en godkendt residens. Ingen vektorer gemt.`,
    );
  }
  if (region !== 'eu') {
    throw new Error(
      `F265.11: embedding-kaldet endte i regionen «${region}», ikke «eu». ` +
        `Vektorer af persondata må ikke laves uden for EU. Ingen vektorer gemt.`,
    );
  }

}

export async function embed(input: string[]): Promise<EmbedResult> {
  if (input.length === 0) {
    return { vectors: [], model: EMBEDDING_MODEL, provider: EMBEDDING_PROVIDER, costCents: 0, inputTokens: 0 };
  }

  // INGEN `as never`. Første udgave havde et cast her, og det kostede en
  // deploy: feltet hedder `text`, ikke `input`, og castet fjernede præcis den
  // kontrol der ville have sagt det. Zod afviste anmodningen i produktion i
  // stedet — samme fejl, opdaget et døgn senere og et lag længere nede.
  const res = await ai.embedding({
    text: input,
    tier: 'embedding',
    override: { provider: EMBEDDING_PROVIDER, model: EMBEDDING_MODEL, transport: 'http' },
    labels: { feature: 'F254-embedding' },
  });

  const usage = res.usage as unknown as Record<string, unknown>;
  const provider = String(usage?.provider ?? '');
  const model = String(usage?.model ?? '');

  bekraeftResidens(usage);

  const vectors = res.vectors;
  if (!Array.isArray(vectors) || vectors.length !== input.length) {
    // Færre vektorer end tekster ville parre dem forkert — og en forkert parret
    // vektor giver ingen fejl, kun tavst forkerte søgeresultater for evigt.
    throw new Error(`F254: fik ${vectors?.length ?? 0} vektorer for ${input.length} tekster.`);
  }

  return {
    vectors,
    model: model || EMBEDDING_MODEL,
    provider,
    costCents: Number(usage?.costUsd ?? 0) * 100,
    inputTokens: Number(usage?.inputTokens ?? usage?.promptTokens ?? 0),
  };
}
