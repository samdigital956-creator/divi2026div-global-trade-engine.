import "server-only";
import path from "node:path";
import { env } from "../env";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";
import type { StorageDriver } from "./types";

export type { StorageDriver } from "./types";

let driver: StorageDriver | null | undefined;

/** Returns the configured private storage driver, or null if storage is not configured. */
export function storage(): StorageDriver | null {
  if (driver !== undefined) return driver;
  const kind = process.env.STORAGE_DRIVER ?? (env.isProduction ? "s3" : "local");
  if (kind === "s3") {
    const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
    driver =
      S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
        ? new S3StorageDriver({
            bucket: S3_BUCKET,
            accessKeyId: S3_ACCESS_KEY_ID,
            secretAccessKey: S3_SECRET_ACCESS_KEY,
            endpoint: process.env.S3_ENDPOINT || undefined,
            region: process.env.S3_REGION || "auto",
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
          })
        : null;
  } else if (kind === "local") {
    driver = new LocalStorageDriver(
      path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_LOCAL_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "uploads")),
      env.appSecret,
    );
  } else {
    driver = null;
  }
  return driver;
}

/** Test hook. */
export function setStorageDriverForTesting(d: StorageDriver | null | undefined) {
  driver = d;
}

export function storageKeyFor(orgId: string, shipmentId: string, documentId: string) {
  // No user-supplied text in object keys.
  return `orgs/${orgId}/shipments/${shipmentId}/${documentId}`;
}
