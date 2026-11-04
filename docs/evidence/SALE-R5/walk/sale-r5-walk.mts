// SALE-2026-11 R5 staging walk: the HQ Pilot Evaluation readout on the staging dev server (port 3195).
//   npx tsx docs/evidence/SALE-R5/walk/sale-r5-walk.mts   (env: WALK_BASE; reads .env.local for STAGING_* and HQ_FIXTURE_PASSWORD)
// Signs in as a synthetic staging HQ account that holds hq.scholar.analytics.view (Individual Product Administrator).
// Credentials are read from .env.local and never printed. Refuses unless the database URL is staging.
// Proves: the readout renders; cells under the cohort floor are suppressed (no figure); none cells read "No data yet";
// metering off reads "Metering off, no data" and no "$0"; no consenting learner id reaches the page or the export; the
// Markdown and CSV exports download; an anonymous request is refused; phone width fits; 0 console errors; no 5xx.
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const PROD = /export const PRODUCTION_REF\s*=\s*"([a-z0-9]{20})"/.exec(readFileSync(join(ROOT, "scripts", "production-guard.ts"), "utf8"))?.[1];
if (!PROD || !env.STAGING_SUPABASE_URL || env.STAGING_SUPABASE_URL.includes(PROD)) { console.error("REFUSING: not staging"); process.exit(1); }
const BASE = process.env.WALK_BASE ?? "http://localhost:3195";
const PAGE = `${BASE}/super-admin/individual/scholar/analytics/effectiveness`;
const API = `${BASE}/api/hq/individual/scholar-analytics/effectiveness`;
const HQ_USER = "e152ce44-164a-4bcb-aa29-2d9069733e5e"; // ASMT demo reviewer (synthetic staging), individual_product_administrator
const OUT = join(import.meta.dirname, "shots");
mkdirSync(OUT, { recursive: true });

const log: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };

const admin = createClient(env.STAGING_SUPABASE_URL, env.STAGING_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = (await admin.auth.admin.getUserById(HQ_USER)).data?.user?.email;
if (!email || !env.HQ_FIXTURE_PASSWORD) { console.error("fixture account or HQ_FIXTURE_PASSWORD missing"); process.exit(1); }
const { data: consenting } = await admin.from("ckri_participation").select("user_id").eq("permission", "collective_analytics").eq("status", "granted");
const ids = (consenting ?? []).map((r: { user_id: string }) => r.user_id);
info(`consenting learners on staging now: ${ids.length} (under the floor, so every cell with data must be suppressed)`);

async function signIn(page: Page) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240_000 });
    await page.waitForTimeout(3000);
    // Fill after hydration and confirm the values held (a hydrating form resets inputs filled too early).
    for (let i = 0; i < 3; i++) {
      await page.getByRole("textbox", { name: /email/i }).fill(email!);
      await page.locator("input#password").fill(env.HQ_FIXTURE_PASSWORD);
      await page.waitForTimeout(500);
      if ((await page.getByRole("textbox", { name: /email/i }).inputValue()) === email && (await page.locator("input#password").inputValue()).length > 0) break;
    }
    await page.getByRole("button", { name: /sign in/i }).click();
    const left = await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).then(() => true, () => false);
    info(`sign-in attempt ${attempt}: ${left ? "ok" : `still on /login: ${(await page.locator("[role=alert], .text-red-600, p").allInnerTexts()).filter(t => /invalid|error|fail|wrong|incorrect|verify|staff|portal/i.test(t)).slice(0, 3).join(" / ")}`}`);
    if (!left) await page.screenshot({ path: join(OUT, `signin-${attempt}.png`) });
    if (left) return;
  }
  throw new Error("sign-in did not complete");
}

/** Let hydration finish before the next navigation (a dev-mode router refuses an action dispatched before it initialises). */
const settle = async (page: Page) => { await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {}); await page.waitForTimeout(2500); };

const browser = await chromium.launch();
try {
  // anonymous: the API refuses
  const anon = await (await browser.newContext()).request.get(`${API}?format=csv`, { maxRedirects: 0, timeout: 300_000 });
  ok([401, 403, 307, 302].includes(anon.status()), `anonymous export refused (status ${anon.status()})`);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [], server5xx: string[] = [];
  // The report-only CSP header (next.config.ts, every page) makes Chromium print a notice about upgrade-insecure-requests at
  // error level. It is the platform header, not this page: counted apart and reported, as the R1 walk does.
  let cspNotices = 0;
  page.on("console", m => { if (m.type() !== "error") return; if (/Content Security Policy.*upgrade-insecure-requests/i.test(m.text())) cspNotices++; else consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push(String(e)));
  page.on("response", r => { if (r.status() >= 500) server5xx.push(`${r.status()} ${r.url()}`); });
  await signIn(page);
  // The fixture holds several HQ appointments. Choose its Individual Product Administrator appointment as the active context,
  // as the HQ context switcher does (the cookie only selects among appointments the person really holds).
  const { data: appt } = await admin.from("ogs_office_appointments").select("id").eq("person_id", HQ_USER).eq("role", "individual_product_administrator").eq("status", "active").limit(1).maybeSingle();
  if (appt?.id) await ctx.addCookies([{ name: "hq_context", value: appt.id, url: BASE }]);
  info(`active HQ context: individual_product_administrator appointment ${appt?.id ? "selected" : "NOT FOUND"}`);
  await page.goto(PAGE, { waitUntil: "networkidle", timeout: 300_000 });
  ok(await page.getByRole("heading", { name: "Pilot Evaluation", level: 1 }).waitFor({ timeout: 300_000 }).then(() => true, () => false), "readout heading renders");
  await page.locator("tr[data-cell]").first().waitFor({ timeout: 120_000 }).catch(() => {});
  const states = await page.$$eval("tr[data-cell]", rows => rows.map(r => ({ cell: r.getAttribute("data-cell"), state: r.getAttribute("data-state"), figure: (r.querySelector("td") as HTMLElement)?.innerText ?? "" })));
  info(`cells: ${states.map(s => `${s.cell}=${s.state}`).join(", ")}`);
  ok(states.length === 15, `all 15 catalogue cells shown (${states.length})`);
  const below = states.filter(s => s.state === "below_floor");
  ok(below.length > 0 && below.every(s => /^Fewer than \d+ learners$/.test(s.figure)), `${below.length} cell(s) under the floor are suppressed with no figure`);
  ok(states.filter(s => s.state === "none").every(s => s.figure === "No data yet"), "cells with no data read 'No data yet', never 0");
  ok(!states.some(s => s.state === "reported"), "nothing is reported while the cohort is under the floor");
  ok(await page.getByTestId("metering-off").isVisible(), "metering off: 'Metering off, no data' is shown");
  const text = await page.locator("main").innerText().catch(async () => page.locator("body").innerText());
  ok(!/\$0(\.0+)?\b/.test(text), "no '$0' anywhere on the page");
  ok(/Engagement and activity are not learning/.test(text) && /No targets are set/.test(text), "engagement-is-not-learning and no-targets notes shown");
  const html = await page.content();
  ok(!ids.some(id => html.includes(id)), "no consenting learner id in the page HTML");
  ok(await page.getByTestId("comparison-result").innerText().then(t => /^Not compared/.test(t)), "standard against adaptive: not compared below the floor");
  info(`reuse: ${await page.getByTestId("reuse-share").innerText()}`);
  await page.screenshot({ path: join(OUT, "readout-desktop.png"), fullPage: true, caret: "initial" });

  // exports, with the signed-in session
  await settle(page);
  const md = await page.request.get(`${API}?days=90&format=md`, { timeout: 300_000 });
  const mdText = await md.text();
  ok(md.status() === 200 && /attachment; filename="scholar-pilot-evaluation-.*\.md"/.test(md.headers()["content-disposition"] ?? ""), `Markdown export downloads (${md.status()})`);
  ok(/Fewer than \d+ learners/.test(mdText) && /Metering off, no data/.test(mdText) && !/\$0(\.0+)?\b/.test(mdText), "Markdown keeps suppression and metering off, no $0");
  const csv = await page.request.get(`${API}?days=90&format=csv`, { timeout: 300_000 });
  const csvText = await csv.text();
  ok(csv.status() === 200 && (csv.headers()["content-type"] ?? "").startsWith("text/csv") && /below_floor/.test(csvText), `CSV export downloads with suppressed rows (${csv.status()})`);
  ok(!ids.some(id => mdText.includes(id) || csvText.includes(id)), "no consenting learner id in either export");
  writeFileSync(join(import.meta.dirname, "export-sample.md"), mdText);
  writeFileSync(join(import.meta.dirname, "export-sample.csv"), csvText);

  // phone width
  await settle(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${PAGE}?days=30`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.locator("tr[data-cell]").first().waitFor({ timeout: 300_000 }).catch(() => {});
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "phone width (390) has no horizontal page scroll");
  await page.screenshot({ path: join(OUT, "readout-phone.png"), fullPage: true, caret: "initial" });

  // nav entry
  await settle(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/super-admin/individual/scholar/analytics`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.getByRole("heading", { name: "Learner Engagement", level: 1 }).waitFor({ timeout: 300_000 }).catch(() => {});
  ok(await page.getByRole("link", { name: /Pilot Evaluation/ }).first().isVisible(), "Learner Engagement links to Pilot Evaluation");

  info(`platform report-only CSP notices (not counted): ${cspNotices}`);
  await settle(page);
  ok(consoleErrors.length === 0, `0 console errors (${consoleErrors.length})${consoleErrors.length ? `: ${consoleErrors.slice(0, 3).join(" | ")}` : ""}`);
  ok(server5xx.length === 0, `no 5xx (${server5xx.length})${server5xx.length ? `: ${server5xx.slice(0, 3).join(" | ")}` : ""}`);
} catch (e) {
  ok(false, `walk threw: ${String((e as Error)?.message ?? e).split(/\r?\n/)[0]}`);
} finally {
  await browser.close();
  writeFileSync(join(import.meta.dirname, "walk.log"), log.join("\n") + "\n");
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  console.log(fails ? `WALK FAILED: ${fails}` : "WALK PASSED");
  process.exitCode = fails ? 1 : 0;
}
