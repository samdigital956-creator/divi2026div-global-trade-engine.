export type SignedUrlOptions = {
  filename: string;
  contentType: string;
  /** Render in the browser (preview) instead of forcing a download. */
  inline?: boolean;
  expiresInSeconds?: number;
};

/**
 * Private object storage. Implementations must never expose objects publicly;
 * reads happen only through short-lived signed URLs issued after an
 * authorization check.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Server-side read, e.g. to send a stored document to the extraction provider. */
  get(key: string): Promise<Uint8Array>;
  signedDownloadUrl(key: string, opts: SignedUrlOptions): Promise<string>;
}

export const DEFAULT_URL_TTL_SECONDS = 60;
