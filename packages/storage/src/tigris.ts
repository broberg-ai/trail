/**
 * F222.1 — Tigris (S3-compatible) implementation of the Storage seam.
 *
 * Built on Bun's native S3 client (`Bun.S3Client`) — the runtime's own
 * stdlib, so no AWS SDK and no hand-rolled SigV4. The engine runs Bun in
 * prod; the client reads the exact env vars `flyctl storage create`
 * injects (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL_S3
 * / AWS_REGION / BUCKET_NAME), passed in explicitly by the factory so a
 * misconfigured machine fails at construction, not at first write.
 *
 * Chunked-upload staging (appendChunk/finalize) stays on LOCAL disk:
 * S3 has no writable-at-offset semantics, and the staging file is
 * ephemeral by design. finalize() is where the bytes leave the machine —
 * it uploads the assembled file to the bucket and removes the temp file.
 * The caller's contract (verify byte-count + sha256 BEFORE finalize) is
 * unchanged.
 */

import { join, dirname } from 'node:path';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import type { Storage } from './index.js';

export interface TigrisConfig {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region?: string;
  /** Local dir for chunked-upload staging files (ephemeral). */
  stagingDir: string;
}

export class TigrisStorage implements Storage {
  private client: InstanceType<typeof Bun.S3Client>;
  private stagingDir: string;

  constructor(cfg: TigrisConfig) {
    for (const k of ['bucket', 'accessKeyId', 'secretAccessKey', 'endpoint'] as const) {
      if (!cfg[k]) throw new Error(`TigrisStorage: missing config '${k}'`);
    }
    this.client = new Bun.S3Client({
      bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      endpoint: cfg.endpoint,
      region: cfg.region ?? 'auto',
    });
    this.stagingDir = cfg.stagingDir;
    mkdirSync(this.stagingDir, { recursive: true });
  }

  /** Same traversal guard as LocalStorage — an S3 key with `..` is never
   *  dangerous to a filesystem, but a key the local impl would refuse must
   *  not silently become legal when the backend swaps (F222 seam rule). */
  private guard(path: string): string {
    if (path.includes('..')) throw new Error('Invalid path: traversal not allowed');
    return path.replace(/^\/+/, '');
  }

  async put(path: string, data: Uint8Array | Buffer, contentType?: string): Promise<void> {
    await this.client.file(this.guard(path)).write(data, contentType ? { type: contentType } : undefined);
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      const buf = await this.client.file(this.guard(path)).arrayBuffer();
      return new Uint8Array(buf);
    } catch (err) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await this.client.file(this.guard(path)).delete();
    } catch (err) {
      if (isNoSuchKey(err)) return; // idempotent, same as LocalStorage
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.client.file(this.guard(path)).exists();
  }

  async signedUrl(path: string, expiresSec = 3600): Promise<string> {
    return this.client.file(this.guard(path)).presign({ expiresIn: expiresSec, method: 'GET' });
  }

  /**
   * List all keys under a prefix. Trailing-slash normalisation matches
   * LocalStorage (F230.1): the returned keys never contain a double slash.
   * Paginates until the bucket says it is done — a truncated listing read
   * as complete is how a migration "finishes" with files left behind.
   */
  async list(prefix: string): Promise<string[]> {
    return [...(await this.statMany(prefix)).keys()];
  }

  /** One paginated LIST sweep; sizes come free on the pages. list() derives
   *  from this so the two can never disagree about which keys exist. */
  async statMany(prefix: string): Promise<Map<string, number>> {
    const clean = this.guard(prefix).replace(/\/+$/, '');
    const s3Prefix = clean === '' ? undefined : `${clean}/`;
    const results = new Map<string, number>();
    let continuationToken: string | undefined;
    do {
      const page = await this.client.list({
        prefix: s3Prefix,
        maxKeys: 1000,
        continuationToken,
      });
      for (const obj of page.contents ?? []) {
        if (obj.key) results.set(obj.key, Number(obj.size ?? 0));
      }
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
    } while (continuationToken);
    return results;
  }

  async appendChunk(tempPath: string, offset: number, bytes: Uint8Array): Promise<void> {
    const full = this.stagingPath(tempPath);
    mkdirSync(dirname(full), { recursive: true });
    const fd = openSync(full, 'a+');
    try {
      const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      writeSync(fd, buf, 0, buf.length, offset);
    } finally {
      closeSync(fd);
    }
  }

  async finalize(tempPath: string, finalPath: string): Promise<void> {
    const full = this.stagingPath(tempPath);
    if (!existsSync(full)) {
      throw new Error(`finalize: temp file missing at ${tempPath}`);
    }
    const bytes = readFileSync(full);
    await this.put(finalPath, bytes);
    // Read-back before removing the staging copy: an upload that "succeeded"
    // but is not there would otherwise delete the only copy of the bytes.
    const check = await this.exists(finalPath);
    if (!check) throw new Error(`finalize: uploaded object missing at ${finalPath}`);
    unlinkSync(full);
  }

  private stagingPath(tempPath: string): string {
    if (tempPath.includes('..')) throw new Error('Invalid path: traversal not allowed');
    return join(this.stagingDir, tempPath);
  }
}

function isNoSuchKey(err: unknown): boolean {
  const e = err as { code?: string; name?: string };
  return e?.code === 'NoSuchKey' || e?.name === 'S3Error' && /NoSuchKey|404/.test(String((e as Error).message));
}
