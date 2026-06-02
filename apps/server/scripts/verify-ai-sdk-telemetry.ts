/**
 * F190.1 runtime proof — exercises the shared @broberg/ai-sdk client end-to-end:
 *   1) ai.vision() directly (lib/ai.ts client + SDK + ANTHROPIC_API_KEY)
 *   2) describeImageAsSource() (vision.ts wiring)
 * Generates a real PNG with text so vision has content to read. Needs
 * ANTHROPIC_API_KEY (or OPENROUTER_API_KEY) in env. Costs a fraction of a cent.
 *
 * Run from apps/server:  bun run scripts/verify-ai-sdk-telemetry.ts
 */
import sharp from 'sharp';
import { ai } from '../src/lib/ai.js';
import { describeImageAsSource, createVisionBackendWithMetadata } from '../src/services/vision.js';

if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error('✗ no ANTHROPIC_API_KEY / OPENROUTER_API_KEY in env — cannot runtime-verify');
  process.exit(1);
}
console.log('upmetrics sink:', process.env.UPMETRICS_API_KEY ? 'LIVE (agentName=trail)' : 'noop (no UPMETRICS_API_KEY yet — F190.4)');

const svg =
  `<svg width="340" height="120" xmlns="http://www.w3.org/2000/svg">` +
  `<rect width="340" height="120" fill="white"/>` +
  `<text x="18" y="68" font-size="30" font-family="sans-serif" fill="black">Trail F190 vision test</text></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
console.log(`test PNG: ${png.length} bytes`);

// 1) ai.vision() directly
const r = await ai.vision({
  image: new Uint8Array(png),
  mimeType: 'image/png',
  prompt: 'What exact text appears in this image? Reply with only the text.',
  tier: 'vision',
  override: { provider: 'anthropic', model: process.env.VISION_MODEL ?? 'claude-haiku-4-5-20251001', transport: 'http' },
  fallback: [{ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', transport: 'http' }],
  purpose: 'f190-verify',
});
console.log('\n[1] ai.vision()');
console.log('  text:', JSON.stringify(r.text));
console.log('  usage:', JSON.stringify({
  provider: r.usage.provider, model: r.usage.model, transport: r.usage.transport,
  inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens,
  costUsd: r.usage.costUsd, subprocess: r.usage.subprocess ?? false, capability: r.usage.capability,
}));
if (!r.text.toLowerCase().includes('trail')) {
  console.error('  ✗ vision did not read the text back'); process.exit(1);
}
console.log('  ✓ vision read the text back');

// 2) describeImageAsSource() — vision.ts wiring
const src = await describeImageAsSource(png, 'image/png', 'f190-test.png');
console.log('\n[2] describeImageAsSource()');
console.log('  ', src ? JSON.stringify({ model: src.model, costCents: src.costCents, mdLen: src.markdown.length, head: src.markdown.slice(0, 70) }) : 'null');
if (!src || !src.markdown) { console.error('  ✗ no markdown'); process.exit(1); }
console.log('  ✓ produced a source-doc');

// 3) embedded backend (PDF path)
const embed = createVisionBackendWithMetadata();
const er = embed ? await embed(png, { page: 1, language: 'da' }) : null;
console.log('\n[3] createVisionBackendWithMetadata()');
console.log('  ', JSON.stringify(er));

console.log('\n✓ F190.1 vision migration runtime-verified end-to-end');
