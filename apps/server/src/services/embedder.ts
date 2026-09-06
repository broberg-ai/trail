/**
 * F254.1 — det ENE sted Trail beder om en vektor.
 *
 * Ligger her og ikke i kernen, fordi @broberg/ai-sdk hører til serveren.
 * Kernen kender kun tallene (packages/core/src/retrieval/vectors.ts), så
 * lighed og kodning kan prøves uden netværk og uden nøgle.
 *
 * EU-RUTEN ER IKKE EN INDSTILLING. SDK'ets `embedding`-tier peger på OpenAIs
 * text-embedding-3-small — USA. Sannes Neuroner er en zoneterapi-kliniks:
 * helbredsoplysninger, særlig kategori under GDPR art. 9. Overriden er derfor
 * hardkodet, og `assertEuRoute` læser SVARET tilbage frem for at stole på at
 * anmodningen så rigtig ud. Prisforskellen for hele vores korpus er 8 øre.
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

  // LÆS SVARET, IKKE ANMODNINGEN. En override der blev ignoreret ser identisk
  // ud fra kaldestedet — det er kun `usage.provider` der siger hvor kaldet
  // faktisk gik hen.
  if (provider !== EMBEDDING_PROVIDER) {
    throw new Error(
      `F254: embedding-kaldet gik til «${provider || 'ukendt'}», ikke til ${EMBEDDING_PROVIDER}. ` +
        `Vektorer af persondata må ikke laves uden for EU. Ingen vektorer gemt.`,
    );
  }

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
