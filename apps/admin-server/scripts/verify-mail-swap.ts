/**
 * F005 adoption proof — @broberg/mail magic-link swap (apps/admin-server/src/email.ts).
 *
 * Per CLAUDE.md "Verification before 'this works'": a real send must succeed
 * through the new package, not just a no-op. This builds a LIVE mailer with the
 * production config shape and delivers ONE labelled test mail to cb@webhouse.dk
 * (a fleet admin in @broberg/mail's ALWAYS_ALLOWED), asserting {ok, id}.
 *
 * Safe by default: dry-run unless `--send` is passed.
 *
 * Run (real send):  set -a; source .env; set +a; \
 *   bun run apps/admin-server/scripts/verify-mail-swap.ts --send
 */
import { createMailer } from '@broberg/mail';

const SEND = process.argv.includes('--send');
const TO = 'cb@webhouse.dk'; // fleet admin (ALWAYS_ALLOWED) + the repo owner
const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? 'trail@webhouse.dk';

if (!apiKey) {
  console.error('✗ RESEND_API_KEY not in env — `set -a; source .env; set +a` first.');
  process.exit(1);
}

// Same construction shape as src/email.ts, forced live for the proof.
const mailer = createMailer({ apiKey, from, fromName: 'Trail', live: true });

const message = {
  to: TO,
  subject: 'Trail mail-swap proof (@broberg/mail F005)',
  text: 'This is the F005 @broberg/mail adoption proof for Trail magic-link delivery. If you received this, the swap delivers end-to-end through the verified domain. — Trail',
  html: '<p>This is the <b>F005 @broberg/mail</b> adoption proof for Trail magic-link delivery.</p><p>If you received this, the swap delivers end-to-end through the verified domain.</p><p>— Trail</p>',
};

if (!SEND) {
  console.log('DRY-RUN (no --send). Would deliver:', { to: TO, from, subject: message.subject });
  process.exit(0);
}

console.log(`Sending live proof mail to ${TO} from ${from} …`);
const result = await mailer.send(message);
console.log('result:', result);

if (result.ok && result.id && !result.skipped) {
  console.log(`\n✅ PASS — real delivery accepted by Resend (id=${result.id}).`);
  process.exit(0);
}
console.error('\n✗ FAIL — send did not deliver:', result);
process.exit(1);
