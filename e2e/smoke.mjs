/**
 * End-to-end smoke test against a running app + Firebase Auth emulator.
 *   1. firebase emulators:start --only auth --project demo-gtc
 *   2. start the app with FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 (see README)
 *   3. node e2e/smoke.mjs [baseUrl] [screenshotDir]
 * Uses the `playwright` library (not the test runner).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? path.join(tmpdir(), "gtc-e2e");
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);

const pdf = path.join(SHOTS, "invoice.pdf");
writeFileSync(
  pdf,
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 58>>stream\nBT /F1 14 Tf 20 150 Td (COMMERCIAL INVOICE INV-77) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const fakePdf = path.join(SHOTS, "malware.pdf");
writeFileSync(fakePdf, "MZ this is not a pdf");

const steps = [];
function step(name) {
  steps.push(name);
  console.log(`• ${name}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await ctxA.newPage();

  step("unauthenticated visit redirects to login");
  await a.goto(`${BASE}/shipments`);
  await a.waitForURL(/\/login/);

  step("register owner A");
  await a.goto(`${BASE}/register`);
  await a.getByRole("button", { name: "Create account" }).click();
  assert(await a.getByText("Enter your full name.").isVisible(), "client validation shown");
  await a.fill('input[name="name"]', "Alex Importer");
  await a.fill('input[name="email"]', `alex-${run}@acme.test`);
  await a.fill('input[name="password"]', "correct-horse-battery");
  await a.fill('input[name="confirm"]', "correct-horse-battery");
  await a.getByRole("button", { name: "Create account" }).click();
  await a.waitForURL(/\/onboarding/);
  await a.screenshot({ path: path.join(SHOTS, "01-onboarding.png"), fullPage: true });

  step("create organization A");
  await a.fill('input[name="name"]', `Acme Imports ${run}`);
  await a.fill('input[name="countryCode"]', "US");
  await a.getByRole("button", { name: "Create organization" }).click();
  await a.waitForURL(/\/dashboard/);
  await a.getByText("No shipments yet").first().waitFor();
  await a.screenshot({ path: path.join(SHOTS, "02-dashboard-empty.png"), fullPage: true });

  step("create shipment with validation errors, then fix");
  await a.goto(`${BASE}/shipments/new`);
  await a.fill('input[name="reference"]', "PO-1001");
  await a.fill('input[name="containerNumber"]', "BAD");
  await a.getByRole("button", { name: "Create shipment" }).click();
  await a.getByText("Select a transport mode.").waitFor();
  assert(await a.getByText("Container numbers look like MSCU1234567.").isVisible(), "container error");
  assert((await a.inputValue('input[name="reference"]')) === "PO-1001", "form keeps values");
  await a.selectOption('select[name="transportMode"]', "ocean");
  await a.fill('input[name="containerNumber"]', "MSCU1234567");
  await a.fill('input[name="supplierName"]', "Shenzhen Widgets Ltd");
  await a.fill('input[name="originCountry"]', "CN");
  await a.fill('input[name="destinationCountry"]', "US");
  await a.fill('input[name="estimatedArrival"]', "2026-11-28");
  await a.getByRole("button", { name: "Create shipment" }).click();
  await a.waitForURL(/\/shipments\/[0-9a-f-]+\?created=1/);
  const shipmentUrl = a.url().split("?")[0];
  await a.getByText("Shipment created").waitFor();

  step("reject invalid upload");
  await a.getByRole("link", { name: "Upload document" }).first().click();
  await a.waitForURL(/\/documents\/upload/);
  await a.selectOption('select[name="documentTypeId"]', { label: "Commercial invoice" });
  await a.setInputFiles("#file", fakePdf);
  await a.getByRole("button", { name: "Upload document" }).click();
  await a.getByText("does not match its .pdf extension").first().waitFor();
  await a.screenshot({ path: path.join(SHOTS, "03-upload-rejected.png"), fullPage: true });

  step("upload valid PDF");
  await a.setInputFiles("#file", pdf);
  await a.getByRole("button", { name: "Upload document" }).click();
  await a.waitForURL(/\/documents\/[0-9a-f-]+\?uploaded=1/);
  const docUrl = a.url().split("?")[0];
  const docId = docUrl.split("/").pop();
  await a.getByText("AI extraction not configured").first().waitFor();
  assert(await a.getByRole("button", { name: "Approve document" }).isDisabled(), "approve disabled until fields filled");
  await a.waitForTimeout(800);
  await a.screenshot({ path: path.join(SHOTS, "04-review-empty.png"), fullPage: true });

  step("signed preview link works");
  const fileRes = await a.request.get(`${BASE}/api/documents/${docId}/file?mode=download`, { maxRedirects: 0 });
  assert(fileRes.status() === 302, `download redirects (got ${fileRes.status()})`);
  const signed = fileRes.headers()["location"];
  const signedRes = await a.request.get(new URL(signed, BASE).toString());
  assert(signedRes.status() === 200 && (await signedRes.body()).subarray(0, 5).toString() === "%PDF-", "signed link serves PDF");

  step("enter values, see field validation, approve");
  await a.fill('input[name="f:total_value"]', "abc");
  await a.getByRole("button", { name: "Save values" }).click();
  await a.getByText("Enter a number.").waitFor();
  const values = {
    invoice_number: "INV-77",
    invoice_date: "2026-10-01",
    seller_name: "Shenzhen Widgets Ltd",
    buyer_name: "Acme Imports Inc",
    currency: "USD",
    total_value: "12,500.00",
  };
  for (const [k, v] of Object.entries(values)) await a.fill(`[name="f:${k}"]`, v);
  await a.fill('textarea[name="f:goods_description"]', "Injection-moulded plastic widgets");
  await a.getByRole("button", { name: "Save values" }).click();
  await a.getByText("Values saved.").waitFor();
  await a.getByRole("button", { name: "Approve document" }).click();
  await a.getByText(/^Approved by/).waitFor();
  await a.screenshot({ path: path.join(SHOTS, "05-review-approved.png"), fullPage: true });

  step("invite a teammate");
  await a.goto(`${BASE}/settings/members`);
  await a.fill('input[name="email"]', `bea-${run}@acme.test`);
  await a.getByRole("button", { name: "Invite" }).click();
  await a.getByText(/Invitation created/).waitFor();
  await a.screenshot({ path: path.join(SHOTS, "06-members.png"), fullPage: true });

  step("audit history records document access and approval");
  await a.goto(`${BASE}/audit`);
  for (const action of ["document.viewed", "document.downloaded", "document.approved", "upload.rejected", "member.invited"]) {
    assert(await a.getByText(action, { exact: true }).first().isVisible(), `audit shows ${action}`);
  }
  await a.screenshot({ path: path.join(SHOTS, "07-audit.png"), fullPage: true });

  await a.goto(`${BASE}/settings`);
  await a.screenshot({ path: path.join(SHOTS, "08-settings.png"), fullPage: true });
  await a.goto(`${BASE}/dashboard`);
  await a.screenshot({ path: path.join(SHOTS, "09-dashboard.png"), fullPage: true });

  step("mobile layout");
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctxA.storageState() });
  const mp = await m.newPage();
  await mp.goto(shipmentUrl);
  await mp.screenshot({ path: path.join(SHOTS, "10-mobile-shipment.png"), fullPage: true });
  await mp.getByRole("button", { name: "Open menu" }).click();
  await mp.screenshot({ path: path.join(SHOTS, "11-mobile-menu.png") });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert(!overflow, "no horizontal page scroll on mobile");
  await m.close();

  step("second organization cannot see the first one's data");
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await ctxB.newPage();
  await b.goto(`${BASE}/register`);
  await b.fill('input[name="name"]', "Blake Other");
  await b.fill('input[name="email"]', `blake-${run}@beta.test`);
  await b.fill('input[name="password"]', "another-strong-pass");
  await b.fill('input[name="confirm"]', "another-strong-pass");
  await b.getByRole("button", { name: "Create account" }).click();
  await b.waitForURL(/\/onboarding/);
  await b.fill('input[name="name"]', `Beta Trading ${run}`);
  await b.getByRole("button", { name: "Create organization" }).click();
  await b.waitForURL(/\/dashboard/);
  // With loading.tsx streaming, Next.js may send 200 before notFound() renders,
  // so assert on what is rendered rather than only on the status code.
  for (const url of [shipmentUrl, docUrl]) {
    const res = await b.goto(url);
    await b.getByText("Page not found").waitFor();
    const html = await b.content();
    assert(!html.includes("PO-1001") && !html.includes("Shenzhen Widgets") && !html.includes("INV-77"), `no A data rendered at ${url} (status ${res.status()})`);
  }
  await b.screenshot({ path: path.join(SHOTS, "12-cross-tenant-404.png"), fullPage: true });
  const fRes = await b.request.get(`${BASE}/api/documents/${docId}/file`, { maxRedirects: 0 });
  assert(fRes.status() === 404, `B cannot fetch A's file (got ${fRes.status()})`);
  await b.goto(`${BASE}/shipments`);
  assert(!(await b.getByText("PO-1001").count()), "A's shipment not listed for B");

  step("sign out ends the session");
  await b.getByRole("button", { name: "Sign out" }).first().click();
  await b.waitForURL(/\/login/);
  const after = await b.request.get(`${BASE}/api/auth/session`);
  assert((await after.json()).authenticated === false, "session cleared");

  step("login again as A");
  const ctxA2 = await browser.newContext();
  const a2 = await ctxA2.newPage();
  await a2.goto(`${BASE}/login`);
  await a2.fill('input[name="email"]', `alex-${run}@acme.test`);
  await a2.fill('input[name="password"]', "wrong-password");
  await a2.getByRole("button", { name: "Sign in" }).click();
  await a2.getByText("Incorrect email or password.").waitFor();
  await a2.fill('input[name="password"]', "correct-horse-battery");
  await a2.getByRole("button", { name: "Sign in" }).click();
  await a2.waitForURL(/\/dashboard/);
  await a2.getByText("PO-1001").first().waitFor();

  console.log(`\n✓ ${steps.length} steps passed. Screenshots: ${SHOTS}`);
} catch (err) {
  console.error(`\n✗ failed during: ${steps.at(-1)}\n`, err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
