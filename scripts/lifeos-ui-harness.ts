/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LIFEOS-API-001 step 5: the interface in a real browser, against staging, through the real API.
 *
 *   LIFEOS_BASE_URL=http://localhost:3117 npx tsx scripts/lifeos-ui-harness.ts [screenshot-dir]
 *
 * It REFUSES anything but the staging project. It creates one new person per run, turns the staging gate on for its
 * run and off at the end, and hard-deletes nothing.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { supabaseStore } from "../src/lib/lifeos/adapters/supabase-store";
import { ISSUER_COMPETEN_AUTH, grantEntitlement, provisionIndividual } from "../src/lib/lifeos/core/provision";
import { todayIn } from "../src/lib/lifeos/core/time";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.STAGING_ANON_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || verdict.ref !== "ezhvpgtcqcdsgylrxgdb" || !serviceKey || !anonKey) {
  console.error("REFUSING: this harness runs against the staging project only.");
  process.exit(1);
}
const BASE = process.env.LIFEOS_BASE_URL ?? "http://localhost:3117";
const SHOTS = process.argv[2] ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const admin: any = createClient(url, serviceKey, { auth: { persistSession: false } });
const store = supabaseStore(admin);
const RUN = Date.now().toString(36);
const PASSWORD = randomBytes(24).toString("base64url");
const TZ = "Africa/Kampala";
const SIZES = { phone: { width: 375, height: 812 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1366, height: 800 } };

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: unknown, msg: string, extra?: unknown) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`); }
};

const setGate = async (enabled: boolean) => {
  const { error } = await admin.from("lifeos_flag").upsert({ flag: "lifeos_core", enabled, note: "staging ui harness", updated_at: new Date().toISOString() });
  if (error) throw new Error(`gate: ${error.message}`);
};

async function person(tag: string) {
  const email = `lifeos-ui-${tag}-${RUN}@competen.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message}`);
  const jar = new Map<string, string>();
  const c = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (all: { name: string; value: string }[]) => { for (const { name, value } of all) jar.set(name, value); },
    },
  });
  const signed = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (signed.error) throw new Error(`signIn: ${signed.error.message}`);
  return { subject: data.user.id as string, cookies: [...jar].map(([name, value]) => ({ name, value, url: BASE })) };
}

const contextFor = async (b: Browser, cookies: { name: string; value: string; url: string }[], size = SIZES.desktop): Promise<BrowserContext> => {
  const ctx = await b.newContext({ viewport: size, timezoneId: TZ, locale: "en-GB" });
  if (cookies.length) await ctx.addCookies(cookies);
  return ctx;
};
const nav = (p: Page, label: string) => p.locator("aside nav").getByRole("button", { name: label }).click();
// The page streams, so goto can return before the screen or a redirect has arrived. Wait for the real screen.
const settled = async (p: Page) => {
  await p.locator("main h1").first().waitFor({ timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('[role="status"]'), undefined, { timeout: 60000 });
};
const dialog = (p: Page) => p.getByRole("dialog");

let lastPage: Page | null = null;

async function main() {
  console.log(`LIFEOS UI HARNESS -- target ${verdict.ok ? verdict.ref : "?"} via ${BASE} -- run ${RUN}\n`);
  const browser = await chromium.launch();
  try {
    await setGate(false);
    const anonCtx = await contextFor(browser, []);
    const anonPage = await anonCtx.newPage();
    const off = await anonPage.goto(`${BASE}/lifeos`, { timeout: 180000 });
    ok("G1", off?.status() === 404, "gate off: the page does not exist", off?.status());
    await setGate(true);
    await anonPage.goto(`${BASE}/lifeos/today`, { timeout: 120000 });
    await anonPage.waitForURL(/\/login/, { timeout: 60000 }).catch(() => {});
    ok("G2", anonPage.url().includes("/login") && decodeURIComponent(anonPage.url()).includes("next=/lifeos/today"), "gate on, signed out: sent to sign-in, and back to this screen afterwards", anonPage.url());

    const outsider = await person("outsider");
    const outsiderCtx = await contextFor(browser, outsider.cookies);
    const outsiderPage = await outsiderCtx.newPage();
    await outsiderPage.goto(`${BASE}/lifeos`, { timeout: 120000 });
    await outsiderPage.getByText("not enabled for this account").waitFor({ timeout: 60000 }).catch(() => {});
    ok("G3", (await outsiderPage.textContent("body"))?.includes("not enabled for this account"), "a signed-in Competen person with no LifeOS access is told so");

    const a = await person("a");
    const pa = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: a.subject, displayName: "UI Harness", accessSource: "platform_grant" });
    await grantEntitlement(store, pa.individualId, { individualId: pa.individualId, source: "platform_grant", planCode: "ui-harness" });
    const ctx = await contextFor(browser, a.cookies);
    const p = await ctx.newPage();
    lastPage = p;
    const consoleErrors: string[] = [];
    p.on("pageerror", e => consoleErrors.push(e.message));
    await p.goto(`${BASE}/lifeos`, { timeout: 120000 });
    await settled(p);
    ok("S1", await p.getByRole("heading", { name: "Calendar", level: 1 }).isVisible(), "the app opens on the Calendar");
    ok("S2", (await p.textContent("body"))?.includes("Inbox clear"), "a new person starts empty: no sample data is seeded");

    // Time zone
    const tzButton = p.getByRole("button", { name: `Use ${TZ}` });
    await tzButton.waitFor({ timeout: 30000 }).catch(() => {});
    ok("Z1", await tzButton.isVisible(), "a device on another time zone is offered, not silently changed");
    await tzButton.click();
    await tzButton.waitFor({ state: "detached", timeout: 60000 });
    ok("Z2", (await admin.from("lifeos_individual").select("timezone").eq("id", pa.individualId).single()).data?.timezone === TZ, "...and the choice is stored");
    const today = todayIn(TZ);

    // Worlds
    await nav(p, "My Worlds");
    ok("W0", await p.getByText("You have no worlds yet").isVisible(), "My Worlds explains the empty state");
    for (const [title, where] of [["Family member", "Family"], ["Team lead", "Work"]]) {
      await p.getByRole("button", { name: "＋ Add a world" }).click();
      await dialog(p).getByLabel("Role or world").fill(title);
      await dialog(p).getByLabel("Where").fill(where);
      await dialog(p).getByRole("button", { name: "Save" }).click();
      await dialog(p).waitFor({ state: "detached", timeout: 60000 });
    }
    ok("W1", await p.getByRole("heading", { name: "Team lead" }).isVisible(), "worlds are saved through the API");

    // Capture, dated: planned straight away
    await p.getByRole("main").getByRole("button", { name: "＋ Capture" }).click();
    const title = `Strategy time ${RUN}`;
    await dialog(p).getByLabel("Commitment").fill(title);
    await dialog(p).getByLabel("Role / world").selectOption({ label: "Team lead · Work" });
    await dialog(p).getByLabel("Date (optional)").fill(today);
    await dialog(p).getByLabel("Time").fill("09:00");
    await dialog(p).getByRole("button", { name: "Save commitment" }).click();
    await dialog(p).waitFor({ state: "detached", timeout: 60000 });
    await nav(p, "Today");
    await p.getByText(title).first().waitFor({ timeout: 60000 });
    ok("C1", true, "a dated capture appears on Today");

    // Capture, undated: inbox
    const undated = `Call back later ${RUN}`;
    await nav(p, "Capture");
    await p.getByLabel("Commitment", { exact: true }).fill(undated);
    await p.getByRole("button", { name: "Save commitment" }).click();
    await p.locator("div", { hasText: undated }).first().waitFor({ timeout: 60000 });
    await nav(p, "Commitments");
    await p.getByRole("heading", { name: /Needs clarification \(1\)/ }).waitFor({ timeout: 60000 });
    ok("C2", true, "an undated capture waits in the inbox, not on a day");

    // Edit: Big Rock and protected time
    await nav(p, "Today");
    const row = p.locator(`div:has(> div > strong:text-is("${title}"))`).first();
    await row.getByRole("button", { name: "✎ Edit / schedule" }).click();
    await dialog(p).getByLabel("Weekly Big Rock").check();
    await dialog(p).getByLabel("Protect this time").check();
    await dialog(p).getByRole("button", { name: "Save changes" }).click();
    await dialog(p).waitFor({ state: "detached", timeout: 90000 });
    await row.getByText("◆ Big Rock").waitFor({ timeout: 60000 });
    ok("E1", (await row.textContent())?.includes("🔒 Protected Q2"), "edit makes it a Big Rock with protected time");
    await nav(p, "Calendar");
    const stats = await p.textContent("main");
    ok("E2", stats?.includes("0/1"), "the Calendar counts one Big Rock, not yet completed");

    // Persistence across devices
    const second = await contextFor(browser, a.cookies, SIZES.phone);
    const phone = await second.newPage();
    await phone.goto(`${BASE}/lifeos/today`, { timeout: 120000 });
    await settled(phone);
    await phone.getByText(title).first().waitFor({ timeout: 60000 });
    ok("D1", (await phone.textContent("main"))?.includes("🔒 Protected Q2"), "a second device sees the same commitment, protected: it is really stored");

    // Complete, reopen
    await nav(p, "Today");
    await row.getByRole("button", { name: "✓ Complete" }).click();
    await row.getByRole("button", { name: "↶ Reopen" }).waitFor({ timeout: 60000 });
    await nav(p, "Calendar");
    await p.getByText("1/1").waitFor({ timeout: 60000 });
    ok("L1", true, "completing it counts the Big Rock as achieved");
    await nav(p, "Today");
    await row.getByRole("button", { name: "↶ Reopen" }).click();
    await row.getByRole("button", { name: "✓ Complete" }).waitFor({ timeout: 60000 });
    ok("L2", true, "reopening returns it");

    // Delegation
    await nav(p, "Commitments");
    const inboxRow = p.locator(`div:has(> div > strong:text-is("${undated}"))`).first();
    await inboxRow.getByRole("button", { name: "✎ Edit / schedule" }).click();
    await dialog(p).getByLabel("Role / world").selectOption({ label: "Family member · Family" });
    await dialog(p).getByRole("button", { name: "Save changes" }).click();
    await dialog(p).waitFor({ state: "detached", timeout: 60000 });
    const delegateRow = p.locator(`div:has(> div > strong:text-is("${undated}"))`).first();
    await delegateRow.getByRole("button", { name: "↗ Delegate" }).click();
    await dialog(p).getByLabel("Responsible person / team").fill("Sister");
    await dialog(p).getByLabel("Follow-up date").fill(today);
    await dialog(p).getByRole("button", { name: "Delegate and track" }).click();
    await dialog(p).waitFor({ state: "detached", timeout: 60000 });
    await p.getByRole("heading", { name: /Waiting on others \(1\)/ }).waitFor({ timeout: 60000 });
    ok("G4", (await p.textContent("main"))?.includes("↗ Sister"), "delegation keeps it on my list, waiting on them");

    // Chief of Staff: proposal, then the person's decision
    await p.getByRole("main").getByRole("button", { name: "＋ Capture" }).click();
    const q2 = `Prepare the plan ${RUN}`;
    await dialog(p).getByLabel("Commitment").fill(q2);
    await dialog(p).getByLabel("Role / world").selectOption({ label: "Team lead · Work" });
    await dialog(p).getByLabel("Date (optional)").fill(today);
    await dialog(p).getByLabel("Time").fill("15:00");
    await dialog(p).getByRole("button", { name: "Save commitment" }).click();
    await dialog(p).waitFor({ state: "detached", timeout: 60000 });
    await nav(p, "Chief of Staff");
    ok("A1", (await p.textContent("main"))?.includes("No AI model"), "the screen says plainly that no AI model is used");
    await p.getByRole("button", { name: "Refresh recommendations" }).click();
    const proposal = p.locator("div", { hasText: `Protect time for: ${q2}` }).last();
    await proposal.waitFor({ timeout: 60000 });
    ok("A2", (await p.textContent("main"))?.includes("Proposal · not yet applied"), "a material suggestion is labelled as not yet applied");
    const before = (await admin.from("lifeos_protected_block").select("id").eq("workspace_id", pa.personalWorkspaceId)).data?.length;
    const card = p.locator(`div:has(> strong:text-is("Protect time for: ${q2}"))`).first();
    await card.getByRole("button", { name: "Approve" }).click();
    await card.waitFor({ state: "detached", timeout: 60000 });
    const after = (await admin.from("lifeos_protected_block").select("id, provenance_source").eq("workspace_id", pa.personalWorkspaceId)).data ?? [];
    ok("A3", after.length === (before ?? 0) + 1 && after.some((b: any) => b.provenance_source === "ai_suggestion"), "approving creates the block, marked as from a suggestion", { before, after: after.length });

    // Plan and review
    await nav(p, "Weekly Plan");
    await p.getByLabel("Weekly intention").fill(`Lead with what matters ${RUN}`);
    await p.getByRole("button", { name: "Save intention" }).click();
    for (let i = 0; i < 60; i++) {
      const row = (await admin.from("lifeos_weekly_plan").select("intention").eq("workspace_id", pa.personalWorkspaceId).limit(5)).data ?? [];
      if (row.some((r: any) => String(r.intention).includes(RUN))) break;
      await p.waitForTimeout(1000);
    }
    await p.reload();
    await settled(p);
    await p.waitForFunction(run => (document.querySelector("#lo-intent") as HTMLTextAreaElement | null)?.value.includes(run), RUN, { timeout: 60000 });
    ok("P1", true, "the weekly intention survives a reload, and the address keeps the screen");

    await nav(p, "Weekly Review");
    await p.getByLabel("Reflection").fill(`What worked ${RUN}`);
    p.once("dialog", d => d.accept());
    await p.getByRole("button", { name: "Finalise the week" }).click();
    await p.getByText("This week is finalised").waitFor({ timeout: 60000 });
    const review = (await admin.from("lifeos_weekly_review").select("status, snapshot").eq("workspace_id", pa.personalWorkspaceId).single()).data;
    ok("R1", review?.status === "final" && typeof review?.snapshot?.bigRocksSelected === "number", "finalising stores the week's counts", review);

    // Search
    await p.getByLabel("Search commitments and worlds").fill(RUN.slice(0, 4) ? "Strategy" : "");
    await p.locator("button", { hasText: title }).first().waitFor({ timeout: 10000 });
    ok("F1", true, "search finds a commitment");
    await p.getByLabel("Search commitments and worlds").fill("zzzz-nothing");
    ok("F2", await p.getByText("No match in your open commitments").isVisible(), "search says when nothing matched, and what it looked through");
    await p.getByLabel("Search commitments and worlds").fill("");

    // Layout at each width, every screen
    const screens = ["calendar", "today", "capture", "commitments", "worlds", "plan", "quadrants", "review", "ai"];
    for (const [name, size] of Object.entries(SIZES)) {
      await p.setViewportSize(size);
      const overflow: string[] = [];
      for (const s of screens) {
        await p.goto(`${BASE}/lifeos/${s}`, { timeout: 120000 });
        await settled(p);
        await p.waitForTimeout(300);
        if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) overflow.push(s);
        if (SHOTS && ["calendar", "quadrants", "today"].includes(s)) await p.screenshot({ path: join(SHOTS, `${name}-${s}.png`) });
      }
      ok(`V-${name}`, overflow.length === 0, `${name}: no sideways page scroll on any of the nine screens`, overflow);
    }
    await p.setViewportSize(SIZES.tablet);
    await p.goto(`${BASE}/lifeos/quadrants`);
    await settled(p);
    const columns = await p.evaluate(() => {
      const quad = [...document.querySelectorAll("h2")].filter(h => /^Q[1-4] ·/.test(h.textContent ?? "")).map(h => h.parentElement!.getBoundingClientRect().width);
      return { min: Math.min(...quad), n: quad.length };
    });
    ok("V-quad", columns.n === 4 && columns.min >= 340, "at tablet width each quadrant keeps usable width: the cramped layout is fixed", columns);

    await p.setViewportSize(SIZES.phone);
    await p.goto(`${BASE}/lifeos`);
    await settled(p);
    ok("V-nav1", await p.locator("nav").filter({ hasText: "More" }).getByRole("button", { name: "☰ More" }).isVisible(), "on a phone the bottom bar has a More tab");
    // dispatchEvent, because the dev server's own badge sits over this corner. It does not exist in production.
    await p.getByRole("button", { name: "☰ More" }).dispatchEvent("click");
    for (const label of ["Weekly Plan", "My Worlds", "Four Quadrants", "Weekly Review", "Chief of Staff"]) {
      ok(`V-more-${label}`, await dialog(p).getByRole("button", { name: label }).isVisible(), `...which reaches ${label}, unreachable on a phone in the prototype`);
    }
    await dialog(p).getByRole("button", { name: "Four Quadrants" }).click();
    await p.getByRole("heading", { name: "Four Quadrants", level: 1 }).waitFor({ timeout: 10000 });
    await p.goBack();
    await p.getByRole("heading", { name: "Calendar", level: 1 }).waitFor({ timeout: 10000 });
    ok("V-back", true, "the browser's back button works between screens");
    await p.getByRole("main").getByRole("button", { name: "＋ Capture" }).click();
    await p.keyboard.press("Escape");
    await dialog(p).waitFor({ state: "detached", timeout: 5000 });
    ok("V-esc", true, "Escape closes a dialog");

    ok("X1", consoleErrors.length === 0, "no uncaught script errors during the walk", consoleErrors.slice(0, 3));

    await setGate(false);
    const offAgain = await p.goto(`${BASE}/lifeos`);
    ok("Z9", offAgain?.status() === 404, "gate off again: the page does not exist. Staging is left OFF", offAgain?.status());
  } catch (e) {
    // Say what was on screen when the walk stopped.
    if (lastPage) {
      console.log(`  STOPPED at ${lastPage.url()}. Alert: ${(await lastPage.locator('[role="alert"]').allTextContents().catch(() => [])).join(" | ").slice(0, 300)}`);
      if (SHOTS) await lastPage.screenshot({ path: join(SHOTS, "failure.png") }).catch(() => {});
    }
    throw e;
  } finally {
    await browser.close();
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map(f => `  - ${f}`).join("\n")); process.exit(1); }
}

main().catch(async e => {
  console.error(String(e).slice(0, 1500));
  await setGate(false).catch(() => {});
  process.exit(1);
});
