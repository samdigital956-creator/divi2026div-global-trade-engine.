"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/surface";
import { formatBytes } from "@/lib/format";

type Option = { id: string; label: string };

export function UploadForm({
  shipments,
  types,
  defaultShipmentId,
  accept,
  maxBytes,
}: {
  shipments: Option[];
  types: Option[];
  defaultShipmentId?: string;
  accept: string;
  maxBytes: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function pick(f: File | null | undefined) {
    setError(null);
    setFieldErrors({});
    if (!f) return setFile(null);
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!accept.split(",").includes(`.${ext}`)) {
      setFieldErrors({ file: "Unsupported file type. Upload a PDF, PNG, JPEG or TIFF." });
      return setFile(null);
    }
    if (f.size > maxBytes) {
      setFieldErrors({ file: `Files must be ${formatBytes(maxBytes)} or smaller (this one is ${formatBytes(f.size)}).` });
      return setFile(null);
    }
    setFile(f);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const errs: Record<string, string> = {};
    if (!fd.get("shipmentId")) errs.shipmentId = "Choose a shipment.";
    if (!fd.get("documentTypeId")) errs.documentTypeId = "Choose a document type.";
    if (!file) errs.file = "Choose a file to upload.";
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    fd.set("file", file!);

    // XHR for upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      let body: { id?: string; error?: { message: string; fieldErrors?: Record<string, string> } } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 201 && body.id) {
        router.push(`/documents/${body.id}?uploaded=1`);
        router.refresh();
      } else {
        setProgress(null);
        if (xhr.status === 401) setError("Your session has expired. Sign in again to upload.");
        else setError(body.error?.message ?? "Upload failed. Please try again.");
        setFieldErrors(body.error?.fieldErrors ?? {});
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Network error during upload. Check your connection and try again.");
    };
    setError(null);
    setProgress(0);
    xhr.send(fd);
  }

  const busy = progress !== null;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Shipment" name="shipmentId" error={fieldErrors.shipmentId} required>
          <Select name="shipmentId" defaultValue={defaultShipmentId ?? ""} error={fieldErrors.shipmentId} disabled={busy}>
            <option value="">Select a shipment…</option>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Document type" name="documentTypeId" error={fieldErrors.documentTypeId} required>
          <Select name="documentTypeId" defaultValue="" error={fieldErrors.documentTypeId} disabled={busy}>
            <option value="">Select a type…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="File" name="file" error={fieldErrors.file} required>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            drag ? "border-accent bg-accent-soft" : fieldErrors.file ? "border-bad/60" : "border-line-strong bg-bg/40"
          }`}
        >
          <input ref={inputRef} id="file" type="file" accept={accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
          {file ? (
            <>
              <p className="text-sm font-medium text-ink">{file.name}</p>
              <p className="mt-1 text-xs text-muted">{formatBytes(file.size)}</p>
              {!busy && (
                <button type="button" className="mt-3 text-sm text-accent hover:underline" onClick={() => inputRef.current?.click()}>
                  Choose a different file
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-ink-2">Drag a file here, or</p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
                Browse files
              </Button>
              <p className="mt-3 text-xs text-faint">PDF, PNG, JPEG or TIFF · up to {formatBytes(maxBytes)}</p>
            </>
          )}
        </div>
      </Field>

      {busy && (
        <div className="space-y-1.5" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted">{progress! < 100 ? `Uploading… ${progress}%` : "Verifying and storing securely…"}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <ButtonLink href={defaultShipmentId ? `/shipments/${defaultShipmentId}` : "/documents"} variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />} Upload document
        </Button>
      </div>
    </form>
  );
}
