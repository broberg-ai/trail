/**
 * Storage abstraction — Phase 1 uses local filesystem.
 * Phase 2 will add Cloudflare R2 / S3 implementations behind the same interface.
 */

export interface Storage {
  /** Upload raw bytes at a given path. */
  put(path: string, data: Uint8Array | Buffer, contentType?: string): Promise<void>;

  /** Fetch raw bytes at a given path, or null if missing. */
  get(path: string): Promise<Uint8Array | null>;

  /** Delete a file. No-op if missing. */
  delete(path: string): Promise<void>;

  /** Check existence. */
  exists(path: string): Promise<boolean>;

  /** Generate a short-lived URL (for direct browser access in Phase 2+). */
  signedUrl(path: string, expiresSec?: number): Promise<string>;

  /** List all paths under a prefix. */
  list(prefix: string): Promise<string[]>;

  /**
   * F180 — Append a chunk at the given byte offset to a staging file.
   * Creates the file (and any parent dirs) if missing. Idempotent on
   * overlapping ranges: re-writing the same offset overwrites the same
   * bytes — no append-and-grow semantics.
   */
  appendChunk(tempPath: string, offset: number, bytes: Uint8Array): Promise<void>;

  /**
   * F180 — Atomically promote a staging file to its final path.
   * Same-FS rename when possible; falls back to copy+unlink on
   * cross-device. Caller is responsible for verifying byte-count and
   * sha256 BEFORE calling finalize.
   */
  finalize(tempPath: string, finalPath: string): Promise<void>;
}

export { LocalStorage } from './local.js';
