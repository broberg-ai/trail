/** F190.2 runtime proof — ai.chat() returns parseable JSON (the shape the 5
 *  migrated helpers depend on). Needs ANTHROPIC_API_KEY or OPENROUTER_API_KEY. */
import { ai } from '../src/lib/ai.js';
const res = await ai.chat({
  messages: [{ role: 'user', content: 'Reply with ONLY this JSON, nothing else: {"ok":true,"n":42}' }],
  override: { provider: 'anthropic', model: process.env.TAG_SUGGEST_MODEL ?? 'claude-haiku-4-5-20251001', transport: 'http' },
  fallback: [{ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', transport: 'http' }],
  maxTokens: 128,
  purpose: 'f190.2-verify',
});
console.log('text:', JSON.stringify(res.text));
const json = res.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
const parsed = JSON.parse(json) as { ok?: boolean };
console.log('usage:', res.usage.provider, res.usage.model, 'in', res.usage.inputTokens, 'out', res.usage.outputTokens, 'cost', res.usage.costUsd);
if (parsed.ok !== true) { console.error('✗ unexpected JSON'); process.exit(1); }
console.log('✓ ai.chat() returns parseable JSON — F190.2 helper path verified');
