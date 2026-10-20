/**
 * Live-tracking walk-through against a running app whose tracking provider is
 * Traqo's sandbox (TRAQO_BASE_URL=…/api/v1/sandbox, TRACKING_ALLOW_SANDBOX=true).
 *   node e2e/tracking.mjs [baseUrl] [screenshotDir]
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? path.join(tmpdir(), "gtc-e2e-tracking");
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const step = (s) => console.log(`• ${s}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
try {

  step("register and create organization");
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "Tara Tracker");
  await page.fill('input[name="email"]', `tara-${run}@acme.test`);
  await page.fill('input[name="password"]', "correct-horse-battery");
  await page.fill('input[name="confirm"]', "correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding/);
  await page.fill('input[name="name"]', `Track Co ${run}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await page.waitForURL(/\/dashboard/);

  step("create ocean shipment with a container number");
  await page.goto(`${BASE}/shipments/new`);
  await page.fill('input[name="reference"]', `PO-TRK-${run}`);
  await page.selectOption('select[name="transportMode"]', "ocean");
  await page.fill('input[name="containerNumber"]', "MSCU1234566");
  await page.fill('input[name="estimatedArrival"]', "2026-10-20");
  await page.getByRole("button", { name: "Create shipment" }).click();
  await page.waitForURL(/\/shipments\/[0-9a-f-]+\?created=1/);

  step("start live tracking (container number is prefilled)");
  const ref = page.locator('input[name="reference"]');
  if ((await ref.inputValue()) !== "MSCU1234566") throw new Error("container number not prefilled");
  await page.fill('input[name="sealine"]', "MSCU");
  await page.getByRole("button", { name: "Start live tracking" }).click();
  await page.getByText("Live tracking started.").waitFor({ timeout: 60_000 });
  await page.getByText("In transit").first().waitFor();
  await page.locator(".tracking-map .leaflet-tile").first().waitFor({ timeout: 20_000 });
  await page.getByText(/Carrier · Traqo/).first().waitFor();
  await page.getByText(/ETA slipped|ETA changed/).first().waitFor().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "tracking-shipment.png"), fullPage: true });

  step("refresh");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForLoadState("networkidle");

  step("settings shows tracking configured and usage");
  await page.goto(`${BASE}/settings`);
  await page.getByText("Live trackings this period").waitFor();
  await page.screenshot({ path: path.join(SHOTS, "tracking-settings.png"), fullPage: true });

  step("audit log has tracking.started");
  await page.goto(`${BASE}/audit`);
  await page.getByText(/tracking\.started|Tracking started/i).first().waitFor();
  console.log(`✓ tracking walk-through passed — screenshots in ${SHOTS}`);
} catch (err) {
  await page.screenshot({ path: path.join(SHOTS, "tracking-failure.png"), fullPage: true }).catch(() => {});
  throw err;
} finally {
  await browser.close();
}
