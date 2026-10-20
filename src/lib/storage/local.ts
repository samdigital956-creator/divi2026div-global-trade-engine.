import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_URL_TTL_SECONDS, type SignedUrlOptions, type StorageDriver } from "./types";

type TokenPayload = { k: string; e: number; f: string; c: string; i: boolean };

/**
 * Filesystem driver for local development. Files live outside /public and are
 * only served by /api/storage/local after HMAC-signed, expiring token checks.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local";

  constructor(
    private root: string,
    private secret: string,
  ) {}

  private resolve(key: string) {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Uint8Array) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { mode: 0o600 });
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async read(key: string) {
    return readFile(this.resolve(key));
  }

  async signedDownloadUrl(key: string, opts: SignedUrlOptions) {
    const payload: TokenPayload = {
      k: key,
      e: Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS),
      f: opts.filename,
      c: opts.contentType,
      i: !!opts.inline,
    };
    return `/api/storage/local?t=${this.sign(payload)}`;
  }

  sign(payload: TokenPayload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", this.secret).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  verify(token: string): TokenPayload | null {
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = createHmac("sha256", this.secret).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
      if (typeof payload.e !== "number" || payload.e < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }
}
