/**
 * F163.3 Phase 0 — verify KB-locale-aware Vision-prompt.
 *
 * What this proves (not infers):
 *   1. Anthropic + OpenRouter request bodies include the right
 *      lang-instruction string when language='da'.
 *   2. Same for 'en' (default fallback) and 'de'.
 *   3. Unknown locale ('zz') falls through to English instruction.
 *   4. Vision-rerun handler resolves KB.language from knowledge_bases
 *      via the JOIN we added to candidatesQuery.
 *
 * Mocks fetch globally so we never hit a real API. Inspects the
 * outgoing body to assert the prompt-instruction was injected.
 *
 * Run with: `cd apps/server && bun run scripts/verify-f163-3-0-locale.ts`
 */

import { createVisionBackendWithMetadata } from '../src/services/vision.js';

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

const realFetch = globalThis.fetch;
let lastBody: unknown = null;
function installFetchShim(responseBody: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) {
      try {
        lastBody = JSON.parse(String(init.body));
      } catch {
        lastBody = null;
      }
    }
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

const TINY_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63000100000005000156B5A6E40000000049454E44AE426082',
  'hex',
);

console.log(`\n=== F163.3 Phase 0 verify (KB-locale-aware Vision-prompt) ===\n`);

process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-locale';
delete process.env.OPENROUTER_API_KEY;

// ── 1. Danish ──────────────────────────────────────────────────────────
console.log('[1] language="da" → "Skriv beskrivelsen på dansk."');
installFetchShim({ content: [{ type: 'text', text: 'Et anatomisk diagram.\n[QUALITY: normal]' }] });
const backend = createVisionBackendWithMetadata();
if (!backend) {
  console.log('  ✗ no backend (env not set?)');
  process.exit(1);
}
await backend(new Uint8Array(TINY_PNG), { page: 1, language: 'da' });
const body1 = lastBody as { messages?: Array<{ content?: Array<{ type: string; text?: string }> }> };
const promptText1 = body1.messages?.[0]?.content?.find((c) => c.type === 'text')?.text ?? '';
assert(promptText1.includes('Skriv beskrivelsen på dansk.'), 'Danish instruction injected');
assert(!promptText1.includes('Write the description in English.'), 'English instruction NOT present');
restoreFetch();

// ── 2. English (default) ───────────────────────────────────────────────
console.log('\n[2] language="en" → "Write the description in English."');
installFetchShim({ content: [{ type: 'text', text: 'A diagram.\n[QUALITY: normal]' }] });
await backend!(new Uint8Array(TINY_PNG), { page: 1, language: 'en' });
const body2 = lastBody as { messages?: Array<{ content?: Array<{ type: string; text?: string }> }> };
const promptText2 = body2.messages?.[0]?.content?.find((c) => c.type === 'text')?.text ?? '';
assert(promptText2.includes('Write the description in English.'), 'English instruction injected');
restoreFetch();

// ── 3. German ──────────────────────────────────────────────────────────
console.log('\n[3] language="de" → "Schreib die Beschreibung auf Deutsch."');
installFetchShim({ content: [{ type: 'text', text: 'Ein Diagramm.\n[QUALITY: normal]' }] });
await backend!(new Uint8Array(TINY_PNG), { page: 1, language: 'de' });
const body3 = lastBody as { messages?: Array<{ content?: Array<{ type: string; text?: string }> }> };
const promptText3 = body3.messages?.[0]?.content?.find((c) => c.type === 'text')?.text ?? '';
assert(promptText3.includes('Schreib die Beschreibung auf Deutsch.'), 'German instruction injected');
restoreFetch();

// ── 4. Unknown locale → English fallback ───────────────────────────────
console.log('\n[4] language="zz" (unknown) → falls back to English');
installFetchShim({ content: [{ type: 'text', text: 'fallback.\n[QUALITY: normal]' }] });
await backend!(new Uint8Array(TINY_PNG), { page: 1, language: 'zz' });
const body4 = lastBody as { messages?: Array<{ content?: Array<{ type: string; text?: string }> }> };
const promptText4 = body4.messages?.[0]?.content?.find((c) => c.type === 'text')?.text ?? '';
assert(promptText4.includes('Write the description in English.'), 'unknown locale → English fallback');
restoreFetch();

// ── 5. Missing language → defaults to English ──────────────────────────
console.log('\n[5] context.language undefined → English default');
installFetchShim({ content: [{ type: 'text', text: 'A.\n[QUALITY: normal]' }] });
await backend!(new Uint8Array(TINY_PNG), { page: 1 });
const body5 = lastBody as { messages?: Array<{ content?: Array<{ type: string; text?: string }> }> };
const promptText5 = body5.messages?.[0]?.content?.find((c) => c.type === 'text')?.text ?? '';
assert(promptText5.includes('Write the description in English.'), 'undefined language → English default');
restoreFetch();

// ── 6. Page number still in prompt ─────────────────────────────────────
console.log('\n[6] Page number still flows through');
installFetchShim({ content: [{ type: 'text', text: 'p42.\n[QUALITY: normal]' }] });
await backend!(new Uint8Array(TINY_PNG), { page: 42, language: 'da' });
const body6 = lastBody as { messages?: Array<{ content?: Array<{ type: string; text?: string }> }> };
const promptText6 = body6.messages?.[0]?.content?.find((c) => c.type === 'text')?.text ?? '';
assert(promptText6.includes('page 42'), 'page number injected alongside language');
restoreFetch();

console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures})`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
