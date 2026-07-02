/**
 * F201.11 LIVE proof — the REAL Mistral EU model distilling a Christian-shaped
 * capture. Uses the default `ai` client (no stub), so it needs MISTRAL_API_KEY
 * in env. Proves AC1's substance: the live model KEEPS the real decision and
 * DROPS the tab-list / read-only-code noise; and a pure-noise window → 'noise'.
 *
 * Run from apps/server (with the key):
 *   set -a; source ../../.env; set +a; bun run scripts/verify-f201-11-live-distill.ts
 */
import { distillAmbientCapture } from '../src/services/ambient-distill.js';

const MIXED = {
  title: 'Arbejdssession 17:56 — Claude',
  content: [
    'Fokusforløb:',
    '- Claude: "Trail: Ambient capture agent" — faner: Music Quiz, Social Media (NEW), Tailscale-alternativ, OpenCode',
    '  Skærm: import DOMPurify from "dompurify"; function SafeHtml({html}) { const clean = DOMPurify.sanitize(html); return <div dangerouslySetInnerHTML={{__html: clean}} /> }',
    '- iTerm2: "CMS"',
    '  Skærm: F156 Inline Editing — klik direkte på synlig tekst på et LIVE cms-drevet site, redigér in-place, auto-gem. Scope: visible text only, ingen billed/media-redigering. Committed ecb74667, pushed to main.',
  ].join('\n'),
};
const NOISE = {
  title: 'Arbejdssession 18:02 — Google Chrome',
  content: '- Google Chrome: faner "New tab", "Music Quiz", "Indstillinger" — Home, Bookmarks, History, Downloads',
};

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✓' : '✗'} ${n}${d ? `  — ${d}` : ''}`); ok ? pass++ : fail++; };

console.log('→ calling REAL Mistral EU (mistral-small-latest)…\n');

const mixed = await distillAmbientCapture(MIXED, { tenantId: 'verify', kbId: 'verify' });
console.log(`[mixed] verdict=${mixed.verdict} conf=${mixed.confidence}`);
console.log(`[mixed] title: ${mixed.title}`);
console.log(`[mixed] content:\n${mixed.content}\n`);
check('mixed → knowledge', mixed.verdict === 'knowledge', mixed.verdict);
// The decision's SUBSTANCE (inline in-place editing), not the "F156" label —
// the model paraphrases into the person's own words, which is correct.
check('KEEPS the inline-editing decision (substance)', /inline|in-place|redig/i.test(mixed.content));
check('KEEPS the commit hash', mixed.content.includes('ecb74667'));
check('DROPS the tab-list noise (no "Music Quiz")', !/music quiz/i.test(mixed.content));
check('DROPS the read-only code snippet (no "DOMPurify"/"dangerouslySetInnerHTML")', !/dompurify|dangerouslysetinnerhtml/i.test(mixed.content));

const noise = await distillAmbientCapture(NOISE, { tenantId: 'verify', kbId: 'verify' });
console.log(`\n[noise] verdict=${noise.verdict} conf=${noise.confidence}`);
check('pure-noise window → noise verdict', noise.verdict === 'noise', noise.verdict);
check('noise confidence 0', noise.confidence === 0);

console.log(`\nF201.11 LIVE: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
