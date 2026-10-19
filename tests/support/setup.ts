import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { closePool } from "@/lib/db";

process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), "gtc-test-uploads-"));

afterAll(async () => {
  await closePool();
});
