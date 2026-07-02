/**
 * F201.11 proof — ambient distill-compile. Uses an INJECTED ai stub (no
 * Mistral key needed locally) to prove:
 *   - the distill routes through the Mistral EU tier (never a US model) — GDPR
 *   - a mixed capture → distilled candidate KEEPS the decision, DROPS the noise
 *   - a pure-noise capture → verdict 'noise' (confidence 0) → won't auto-approve
 *   - only connector=trail-ambient-capture is treated as ambient
 *   - the strict format parses; a bad/empty knowledge body falls back to noise
 *
 * The real Mistral EU extraction (does the LIVE model actually drop the tab-
 * list?) is proven separately against the deployed engine after TRAIL_AMBIENT_
 * DISTILL=1 — see the handoff evidence.
 *
 * Run from apps/server:  bun run scripts/verify-f201-11-ambient-distill.ts
 */
import {
  distillAmbientCapture, parseDistill, isAmbientCandidate, stampDistill,
  type DistillAi,
} from '../src/services/ambient-distill.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// Christian's real 2026-07-02 capture, shape-faithful: a real decision buried
// in tab-list + read-only-code noise.
const MIXED = {
  title: 'Arbejdssession 17:56 — Claude',
  content: [
    'Fokusforløb:',
    '- Claude: "Trail: Ambient capture agent" — Music Quiz, Social Media (NEW), Tailscale-alternativ',
    '  Skærm: import DOMPurify from "dompurify"; const clean = DOMPurify.sanitize(html)',
    '- iTerm2: "CMS"',
    '  Skærm: F156 Inline Editing — visible text only. Committed ecb74667.',
  ].join('\n'),
};
const NOISE = {
  title: 'Arbejdssession 18:02 — Google Chrome',
  content: '- Google Chrome: "New tab", "Music Quiz", "Settings" — Home, Bookmarks, History',
};

// Injected ai: records the routing override + returns a plausible distill.
let captured: { override?: { provider?: string; model?: string }; fallback?: Array<{ provider?: string }> } = {};
const fakeAi: DistillAi = {
  chat: async (args) => {
    captured = { override: args.override, fallback: args.fallback };
    const msg = args.messages[0]!.content;
    if (msg.includes('F156') && msg.includes('ecb74667')) {
      return { text: 'VERDICT: KNOWLEDGE\nTITEL: Beslutning: F156 inline editing\nVIDEN:\n- Besluttede F156 = inline editing, visible text only (commit ecb74667)' };
    }
    return { text: 'VERDICT: NOISE' };
  },
};

// AC3 — routes to Mistral EU, never a US model.
const mixed = await distillAmbientCapture(MIXED, { tenantId: 't', kbId: 'k' }, fakeAi);
check('distill routes through Mistral EU (override provider=mistral)', captured.override?.provider === 'mistral', `${captured.override?.provider}/${captured.override?.model}`);
check('fallback is also Mistral (no US model in the chain)', captured.fallback?.every((f) => f.provider === 'mistral') === true);

// AC1 — mixed capture keeps the decision, drops the noise.
check('mixed capture → verdict knowledge', mixed.verdict === 'knowledge', mixed.verdict);
check('distilled content KEEPS the decision (F156 + commit)', mixed.content.includes('F156') && mixed.content.includes('ecb74667'));
check('distilled content DROPS the noise (no Music Quiz / DOMPurify)', !mixed.content.includes('Music Quiz') && !mixed.content.includes('DOMPurify'));
check('distilled title is the extracted one, not the raw window title', mixed.title.includes('F156') && !mixed.title.includes('17:56'));
check('knowledge confidence > 0 (auto-approvable under F201.8)', mixed.confidence > 0, `conf=${mixed.confidence}`);

// AC2 — pure noise → noise verdict, confidence 0, flagged.
const noise = await distillAmbientCapture(NOISE, {}, fakeAi);
check('pure-noise capture → verdict noise', noise.verdict === 'noise', noise.verdict);
check('noise confidence is 0 (never auto-approves)', noise.confidence === 0);
const stamped = stampDistill('{"connector":"trail-ambient-capture"}', noise.verdict);
check('metadata stamped distill=noise', JSON.parse(stamped).distill === 'noise');
const stampedK = stampDistill('{"connector":"trail-ambient-capture"}', mixed.verdict);
check('metadata stamped distill=knowledge for a knowledge verdict', JSON.parse(stampedK).distill === 'knowledge');

// AC4 — only ambient candidates are distilled.
check('isAmbientCandidate true for trail-ambient-capture', isAmbientCandidate('{"connector":"trail-ambient-capture"}') === true);
check('isAmbientCandidate false for chat-answer', isAmbientCandidate('{"connector":"chat"}') === false);
check('isAmbientCandidate false for missing/blank metadata', isAmbientCandidate(undefined) === false && isAmbientCandidate('{}') === false);

// Parse robustness — NONE anywhere → noise; KNOWLEDGE with empty body → noise.
check('parseDistill: bare NOISE → noise', parseDistill('VERDICT: NOISE', MIXED).verdict === 'noise');
check('parseDistill: KNOWLEDGE with empty VIDEN body → noise (no empty candidate)',
  parseDistill('VERDICT: KNOWLEDGE\nTITEL: x\nVIDEN:\n', MIXED).verdict === 'noise');

console.log(`\nF201.11: ${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
