import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition } from "./disposition";
import { DEFAULT_URL_TTL_SECONDS, type SignedUrlOptions, type StorageDriver } from "./types";

export type S3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** S3-compatible private bucket (Railway Storage Buckets, AWS S3, R2, MinIO …). */
export class S3StorageDriver implements StorageDriver {
  readonly name = "s3";
  private client: S3Client;

  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error("Empty object");
    return res.Body.transformToByteArray();
  }

  async signedDownloadUrl(key: string, opts: SignedUrlOptions) {
    const cmd = new GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: contentDisposition(opts.filename, opts.inline),
    });
    return getSignedUrl(this.client, cmd, { expiresIn: opts.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS });
  }
}
