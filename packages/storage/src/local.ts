import { join, dirname } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  writeSync,
  renameSync,
  copyFileSync,
} from 'node:fs';
import type { Storage } from './index.js';

export class LocalStorage implements Storage {
  constructor(private root: string) {
    mkdirSync(this.root, { recursive: true });
  }

  private resolve(path: string): string {
    if (path.includes('..')) throw new Error('Invalid path: traversal not allowed');
    return join(this.root, path);
  }

  async put(path: string, data: Uint8Array | Buffer, _contentType?: string): Promise<void> {
    const full = this.resolve(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const full = this.resolve(path);
    if (!existsSync(full)) return null;
    return readFileSync(full);
  }

  async delete(path: string): Promise<void> {
    const full = this.resolve(path);
    if (existsSync(full)) unlinkSync(full);
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolve(path));
  }

  async signedUrl(path: string, _expiresSec = 3600): Promise<string> {
    // In local mode, return an in-app URL. Server serves this via authenticated route.
    return `/api/v1/storage/${encodeURIComponent(path)}`;
  }

  async appendChunk(tempPath: string, offset: number, bytes: Uint8Array): Promise<void> {
    const full = this.resolve(tempPath);
    mkdirSync(dirname(full), { recursive: true });
    // O_RDWR|O_CREAT — open-for-write without truncating; creates if missing.
    const fd = openSync(full, 'a+');
    try {
      const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      writeSync(fd, buf, 0, buf.length, offset);
    } finally {
      closeSync(fd);
    }
  }

  async finalize(tempPath: string, finalPath: string): Promise<void> {
    const tempFull = this.resolve(tempPath);
    const finalFull = this.resolve(finalPath);
    if (!existsSync(tempFull)) {
      throw new Error(`finalize: temp file missing at ${tempPath}`);
    }
    mkdirSync(dirname(finalFull), { recursive: true });
    try {
      renameSync(tempFull, finalFull);
    } catch (err) {
      // EXDEV — cross-device link. Fall back to copy + unlink.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV') throw err;
      copyFileSync(tempFull, finalFull);
      unlinkSync(tempFull);
    }
  }

  /**
   * F230.1 — a key returned here must never contain a double slash.
   *
   * This used to join `${prefix}/${relPath}` unconditionally, so a caller
   * passing a prefix that ALREADY ended in a slash got `.../images//file.png`.
   * The F161 backfill did exactly that, and then derived the filename with
   * `key.slice(prefix.length)` — leaving a leading slash on 212 of Sanne's
   * image rows.
   *
   * NOTHING FAILED ALONG THE WAY, and that is why it survived: POSIX collapses
   * a double slash, so the file was found, read, measured and stored without a
   * single error. Only the HTTP layer is strict enough to notice — a URL with
   * an empty path segment matches no route — and by then the cause is four
   * layers away from the symptom.
   *
   * So the trailing slash is stripped HERE rather than at the call site: a
   * caller cannot be wrong about a shape this function is allowed to have two
   * answers for.
   */
  async list(prefix: string): Promise<string[]> {
    const full = this.resolve(prefix);
    if (!existsSync(full)) return [];
    const base = prefix.replace(/\/+$/, '');
    const results: string[] = [];
    const walk = (dir: string, rel: string): void => {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        if (statSync(entryPath).isDirectory()) {
          walk(entryPath, relPath);
        } else {
          results.push(base ? `${base}/${relPath}` : relPath);
        }
      }
    };
    walk(full, '');
    return results;
  }
}
