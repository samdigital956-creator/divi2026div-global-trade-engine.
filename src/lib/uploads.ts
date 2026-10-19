import { ValidationError } from "./errors";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

type FileKind = { mime: string; extensions: string[]; magic: (b: Uint8Array) => boolean };

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export const ALLOWED_FILE_KINDS: FileKind[] = [
  { mime: "application/pdf", extensions: ["pdf"], magic: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) }, // %PDF-
  { mime: "image/png", extensions: ["png"], magic: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"], magic: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    mime: "image/tiff",
    extensions: ["tif", "tiff"],
    magic: (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]),
  },
];

export const ACCEPT_ATTRIBUTE = ALLOWED_FILE_KINDS.flatMap((k) => [k.mime, ...k.extensions.map((e) => `.${e}`)]).join(",");

export type ValidatedUpload = { mime: string; filename: string };

/**
 * Validate an uploaded file by size, extension AND content signature. The
 * browser-declared MIME type is never trusted on its own.
 */
export function validateUpload(filename: string, bytes: Uint8Array): ValidatedUpload {
  const name = sanitiseFilename(filename);
  if (bytes.byteLength === 0) throw new ValidationError("The file is empty.", { file: "The file is empty." });
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    const msg = `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`;
    throw new ValidationError(msg, { file: msg });
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const kind = ALLOWED_FILE_KINDS.find((k) => k.extensions.includes(ext));
  if (!kind) {
    const msg = "Unsupported file type. Upload a PDF, PNG, JPEG or TIFF.";
    throw new ValidationError(msg, { file: msg });
  }
  if (!kind.magic(bytes)) {
    const msg = `The file content does not match its .${ext} extension.`;
    throw new ValidationError(msg, { file: msg });
  }
  return { mime: kind.mime, filename: name };
}

export function sanitiseFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  // Strip control characters; keep unicode letters for display.
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || "document";
}
