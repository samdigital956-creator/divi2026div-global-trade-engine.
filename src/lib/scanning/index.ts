import "server-only";
import net from "node:net";

export type ScanResult = { clean: true; engine: string } | { clean: false; engine: string; signature: string };

export interface FileScanner {
  readonly id: string;
  configured(): boolean;
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

/**
 * ClamAV daemon (clamd) over TCP using the INSTREAM command:
 * "zINSTREAM\0", then chunks prefixed with a 4-byte big-endian length, then a
 * zero-length chunk. clamd replies "stream: OK" or "stream: <name> FOUND".
 */
export class ClamAvScanner implements FileScanner {
  readonly id = "clamav";
  constructor(
    private readonly host = process.env.CLAMAV_HOST,
    private readonly port = Number(process.env.CLAMAV_PORT || 3310),
    private readonly timeoutMs = 30_000,
  ) {}

  configured() {
    return !!this.host;
  }

  scan(bytes: Uint8Array): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };
      socket.setTimeout(this.timeoutMs, () => finish(() => reject(new Error("clamd timed out"))));
      socket.on("error", (err) => finish(() => reject(err)));
      socket.on("data", (d) => chunks.push(d));
      socket.on("end", () => finish(() => {
        const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
        if (/^stream: OK$/.test(reply)) return resolve({ clean: true, engine: this.id });
        const found = /^stream: (.+) FOUND$/.exec(reply);
        if (found) return resolve({ clean: false, engine: this.id, signature: found[1] });
        reject(new Error(`clamd error: ${reply.slice(0, 120)}`));
      }));
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const CHUNK = 64 * 1024;
        for (let i = 0; i < bytes.byteLength; i += CHUNK) {
          const part = bytes.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.byteLength);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // end of stream
      });
    });
  }
}

let override: FileScanner | null | undefined;
export function setFileScannerForTesting(s: FileScanner | null | undefined) {
  override = s;
}

/** The configured scanner, or null when malware scanning is not set up. */
export function fileScanner(): FileScanner | null {
  if (override !== undefined) return override;
  const clam = new ClamAvScanner();
  return clam.configured() ? clam : null;
}
