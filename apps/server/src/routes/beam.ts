import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AppBindings } from '../app.js';

/**
 * F168 — Beam: receive a tar shipment from a remote Trail (typically the
 * operator's local workbench) and run the engine-side import script.
 *
 * Auth: Bearer token from BEAM_TOKEN env (machine-to-machine; never the
 * tenant Bearer keys minted via F111.2). 401 if missing or wrong.
 *
 * Why this exists: Fly's WireGuard SSH tunnel throughputs at ~15 KB/s
 * for sftp put on large files (verified empirically with Sanne's 331 MB
 * tar — ~6 hours estimated). Direct HTTPS to engine.trailmem.com
 * bypasses the tunnel and uses Fly's edge anycast — measured at full
 * line-rate. Same path F170 inter-engine migration will use.
 */
export const beamRoutes = new Hono<AppBindings>();

const INCOMING_DIR = process.env.TRAIL_BEAM_INCOMING_DIR ?? '/data/_incoming';
const IMPORT_SCRIPT = process.env.TRAIL_BEAM_IMPORT_SCRIPT ?? '/usr/local/bin/beam-import.sh';

beamRoutes.post('/internal/beam/import', async (c) => {
  // Auth — BEAM_TOKEN is set as a Fly secret per engine.
  const want = process.env.BEAM_TOKEN;
  if (!want) {
    return c.json({ error: 'beam disabled — BEAM_TOKEN env not set on engine' }, 503);
  }
  const got = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!got || got !== want) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Required headers from the client (beam.ts CLI):
  //   X-Beam-Slug:   destination tenant slug ('sanne-andersen')
  //   X-Beam-Sha256: sha256 of trail.db inside the tar (lowercase hex)
  //   X-Beam-Filename: tar's basename, used for staging path
  const slug = c.req.header('X-Beam-Slug');
  const sha256 = c.req.header('X-Beam-Sha256');
  const filename = c.req.header('X-Beam-Filename');
  if (!slug || !sha256 || !filename) {
    return c.json({
      error: 'missing required headers: X-Beam-Slug, X-Beam-Sha256, X-Beam-Filename',
    }, 400);
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ error: 'slug must match [a-z0-9-]+' }, 400);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return c.json({ error: 'sha256 must be 64-char lowercase hex' }, 400);
  }
  if (!/^[A-Za-z0-9._-]+\.beam\.tar$/.test(filename)) {
    return c.json({ error: 'filename must match [A-Za-z0-9._-]+\\.beam\\.tar' }, 400);
  }

  if (!c.req.raw.body) {
    return c.json({ error: 'request has no body' }, 400);
  }

  // [1] Stream body to /data/_incoming/{filename}
  mkdirSync(INCOMING_DIR, { recursive: true });
  const dest = join(INCOMING_DIR, filename);
  console.log(`[beam] receive → ${dest}`);

  const start = Date.now();
  const ws = createWriteStream(dest, { flags: 'w' });
  let bytes = 0;
  const reader = c.req.raw.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      if (!ws.write(value)) {
        await new Promise<void>((resolve) => ws.once('drain', () => resolve()));
      }
    }
  }
  await new Promise<void>((resolve, reject) => {
    ws.on('error', reject);
    ws.end(() => resolve());
  });
  const elapsedMs = Date.now() - start;
  const mbps = (bytes / 1024 / 1024) / (elapsedMs / 1000);
  console.log(`[beam] received ${bytes} bytes in ${elapsedMs}ms (${mbps.toFixed(1)} MB/s)`);

  // [2] Spawn beam-import.sh — verifies sha256, atomic rename to /data/{slug}/
  console.log(`[beam] spawn ${IMPORT_SCRIPT} ${dest} ${slug} <sha>`);
  const proc = spawn(IMPORT_SCRIPT, [dest, slug, sha256]);
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => { stdout += String(chunk); });
  proc.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const exitCode: number = await new Promise((resolve) => {
    proc.on('exit', (code) => resolve(code ?? -1));
  });

  if (exitCode !== 0) {
    console.error(`[beam] import-script exit ${exitCode}: ${stderr}`);
    return c.json({
      error: 'beam-import.sh failed',
      exit_code: exitCode,
      stdout,
      stderr,
    }, 500);
  }

  console.log(`[beam] import OK for ${slug}`);
  return c.json({
    ok: true,
    slug,
    bytes_received: bytes,
    transfer_mbps: Number(mbps.toFixed(2)),
    transfer_ms: elapsedMs,
    import_stdout: stdout,
  });
});
