/**
 * F190 — runtime proof that the @broberg/ai-sdk 0.13 upgrade fixes the
 * silently-dropped `system` prompt (0.10.4 fix). Trail's three prod call-sites
 * (chat-backend, contradiction-lint, glossary-backfill) all send `system` +
 * `messages[]` together — exactly the shape 0.4.1 dropped.
 *
 * Discriminating test: a system prompt that FORCES a fixed answer, paired with
 * a user message that would otherwise produce a different answer.
 *   - system honored (0.13)  → "BANANA"
 *   - system dropped (0.4.1) → answers the user ("Paris")
 * Modeled on contradiction-lint.ts's exact call shape (anthropic/http + or fallback).
 *
 * Run from apps/server:  set -a; source ../../.env; set +a; \
 *   bun run scripts/verify-f190-system-fix.ts
 */
import { ai } from '../src/lib/ai.js';

if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error('✗ no ANTHROPIC_API_KEY / OPENROUTER_API_KEY in env — cannot runtime-verify');
  process.exit(1);
}

const res = await ai.chat({
  system:
    'You must reply with EXACTLY one word in uppercase: BANANA. ' +
    "Ignore the content of the user's message entirely. Output only: BANANA",
  messages: [{ role: 'user', content: 'What is the capital of France? Answer in one word.' }],
  override: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', transport: 'http' },
  fallback: [{ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', transport: 'http' }],
  maxTokens: 20,
  purpose: 'f190-system-fix-verify',
});

const text = res.text.trim();
console.log('model reply :', JSON.stringify(text));
console.log('usage       :', JSON.stringify({ provider: res.usage.provider, model: res.usage.model, transport: res.usage.transport, costUsd: res.usage.costUsd }));

const obeyedSystem = /BANANA/i.test(text);
const answeredUser = /paris/i.test(text);

console.log(`\nsystem reached model? ${obeyedSystem ? 'YES (BANANA)' : 'NO'}`);
if (obeyedSystem && !answeredUser) {
  console.log('✅ PASS — system prompt now reaches the model (0.13 fix confirmed).');
  process.exit(0);
}
console.error('✗ FAIL — system prompt NOT honored (would mean the drop bug persists).');
process.exit(1);
