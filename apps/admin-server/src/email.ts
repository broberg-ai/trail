import { Resend } from 'resend';

/**
 * F172 — magic-link email via Resend.
 *
 * Sender: trail@webhouse.dk in Phase 1 (only verified domain in Christian's
 * Resend account today). Phase 2 migrates to noreply@trailmem.com once
 * SPF+DKIM+DMARC are added via DNS Manager MCP — flip RESEND_FROM secret,
 * no code change.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM ?? 'trail@webhouse.dk';
const MAGIC_LINK_BASE_URL = process.env.MAGIC_LINK_BASE_URL ?? 'https://app.trailmem.com';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export interface SendMagicLinkInput {
  email: string;
  token: string;
  intent: 'login' | 'welcome';
  userName?: string;
}

export async function sendMagicLink(input: SendMagicLinkInput): Promise<void> {
  const link = `${MAGIC_LINK_BASE_URL}/auth/verify?token=${encodeURIComponent(input.token)}`;
  const subject =
    input.intent === 'welcome' ? 'Welcome to Trail — your link to log in' : 'Your Trail login link';
  const greeting = input.userName ? `Hi ${input.userName},` : 'Hi,';
  const intro =
    input.intent === 'welcome'
      ? 'Your Trail is set up. Click the link below to log in for the first time.'
      : 'Click the link below to log in to Trail.';

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

  if (!resend) {
    // No Resend key — log so dev can copy the link. Useful in local dev.
    console.warn(`[email] RESEND_API_KEY not set; magic-link is: ${link}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: `Trail <${RESEND_FROM}>`,
    to: input.email,
    subject,
    text,
    html,
  });
  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
