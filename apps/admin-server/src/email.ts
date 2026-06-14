import { createMailer } from '@broberg/mail';

/**
 * F172 — magic-link email. Delivery via @broberg/mail (F005 fleet mailer):
 * the package owns the Resend REST call, ship-dark (no key ⇒ logged no-op),
 * and the dev recipient gate (`live:false` outside prod ⇒ only fleet admins
 * receive real mail, so a preview/dev send can never reach a real user). Only
 * Trail's subject/HTML template stays here.
 *
 * Sender: trail@webhouse.dk in Phase 1 (only verified domain in Christian's
 * Resend account today). Phase 2 migrates to noreply@trailmem.com once
 * SPF+DKIM+DMARC are added via DNS Manager MCP — flip RESEND_FROM secret,
 * no code change.
 */

const RESEND_FROM = process.env.RESEND_FROM ?? 'trail@webhouse.dk';
const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL ?? 'https://app.trailmem.com';

// Live delivery only in prod (NODE_ENV=production on Fly — the same signal the
// auth/oauth secure-cookies use). In dev, sends are gated to fleet admins
// regardless of whether a key happens to be present locally.
const mailer = createMailer({
  apiKey: process.env.RESEND_API_KEY,
  from: RESEND_FROM,
  fromName: 'Trail',
  live: process.env.NODE_ENV === 'production',
});

export interface SendMagicLinkInput {
  email: string;
  token: string;
  intent: 'login' | 'welcome' | 'invite';
  userName?: string;
  inviterName?: string;
  tenantName?: string;
}

export async function sendMagicLink(input: SendMagicLinkInput): Promise<void> {
  const link = `${MAGIC_LINK_BASE_URL}/auth/verify?token=${encodeURIComponent(input.token)}`;
  const greeting = input.userName ? `Hi ${input.userName},` : 'Hi,';
  let subject: string;
  let intro: string;
  switch (input.intent) {
    case 'invite':
      subject = `${input.inviterName ?? 'A teammate'} invited you to Trail`;
      intro = `${input.inviterName ?? 'A teammate'} has invited you to ${input.tenantName ? `the "${input.tenantName}" Trail` : 'Trail'}. Click the link below to set up your account.`;
      break;
    case 'welcome':
      subject = 'Welcome to Trail — your link to log in';
      intro = 'Your Trail is set up. Click the link below to log in for the first time.';
      break;
    default:
      subject = 'Your Trail login link';
      intro = 'Click the link below to log in to Trail.';
  }

  const text = `${greeting}

${intro}

${link}

This link expires in 15 minutes. If you didn't request it, you can ignore
this email — nothing happens until the link is used.

— Trail
`;

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 1rem; color: #222;">
<h2 style="font-weight: 600; margin: 0 0 1rem;">${subject}</h2>
<p>${greeting}</p>
<p>${intro}</p>
<p style="margin: 2rem 0;">
  <a href="${link}" style="background: #0a7c4a; color: #fff; text-decoration: none; padding: 0.75rem 1.25rem; border-radius: 6px; display: inline-block;">Log in to Trail</a>
</p>
<p style="font-size: 0.9rem; color: #555;">Or paste this link into your browser:<br>
<code style="word-break: break-all;">${link}</code></p>
<p style="font-size: 0.85rem; color: #777; margin-top: 2rem;">This link expires in 15 minutes. If you didn't request it, you can ignore this email — nothing happens until the link is used.</p>
<p style="font-size: 0.85rem; color: #777;">— Trail</p>
</body></html>`;

  const result = await mailer.send({ to: input.email, subject, html, text });
  if (result.skipped) {
    // Ship-dark (no key) or recipient gated out in dev — surface the link so a
    // local dev can still complete login without a real send.
    console.warn(`[email] magic-link not delivered (skipped); link: ${link}`);
    return;
  }
  if (!result.ok) {
    throw new Error(`mail send failed: ${result.error ?? 'unknown error'}`);
  }
}
