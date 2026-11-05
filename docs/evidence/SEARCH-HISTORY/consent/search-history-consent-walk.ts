/* eslint-disable @typescript-eslint/no-unused-vars -- evidence script */
// My Search History, owner privacy decision 5 Nov 2026: the STAGING walk for the learner's own setting, as two fixture learners.
//   A = harness-guided-browser@competen.test (AI help on at v3), B = scholar-demo@competen.demo.
// Proves: the setting OFF keeps nothing; AI help and lessons still work with it OFF; a v3 learner is not asked again; the notice and its link
// appear at every capture point; ON keeps; OFF stops and removes nothing; delete and clear work with it OFF; deleting a material removes what
// relied on it and nothing else. A few real AI calls, on purpose. Signed in with a magic-link session minted by the STAGING service role (no
// password). Refuses production. Reads are counts and keys. No account is reset and no lesson is repeated.
// Run:  npx tsx docs/evidence/SEARCH-HISTORY/consent/search-history-consent-walk.ts   (dev server on 3199 pointed at staging)
import { chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));
const { loadEnvConfig } = require("@next/env");
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const { Client } = require("pg");
loadEnvConfig(ROOT);

const PROD = "rnnqhlrcgvsauigxwszl";
const URL_ = process.env.STAGING_SUPABASE_URL!, ANON = process.env.STAGING_ANON_KEY!, SERVICE = process.env.STAGING_SERVICE_ROLE_KEY!;
const DB = (readFileSync("C:/Users/elish/Documents/Competen/competen-healthcare/.env.local", "utf8").match(/^STAGING_DB_URL=(.*)$/m)?.[1] ?? "").trim().replace(/^"|"$/g, "");
if (!URL_ || !ANON || !SERVICE || !DB) throw new Error("missing STAGING_* settings");
if ([URL_, DB].some(x => x.includes(PROD)) || !URL_.includes("ezhvpgtcqcdsgylrxgdb") || !DB.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("REFUSING: not the staging project");

const BASE = process.env.WALK_BASE ?? "http://localhost:3199";
const S = `${BASE}/individual/scholar/study`;
const HIST = `${S}/saved/searches`, SETTINGS = `${BASE}/individual/scholar/settings`;
const ROUTE = "/api/individual/scholar/library/history";
const OUT = join(ROOT, "docs/evidence/SEARCH-HISTORY/consent");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const A = { email: "harness-guided-browser@competen.test", id: "32142f0d-c150-4180-8156-fb4e11a20fea" };
const B = { email: "scholar-demo@competen.demo", id: "0f62a14e-c264-4db1-bf99-00fd55ae547c" };
const LESSON = "2b9fccd2-530b-45e0-a77c-5c68d0f2c982";
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const NOTICE = "scholar-search-history-notice-v1";

const log: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };
const consoleErrors: string[] = [], fivexx: string[] = [];

const db = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];
const captured = async (id: string) => Number((await one("select count(*) n from individual_scholar_search_history where user_id = $1 and origin = 'captured'", [id])).n);
const hasQuery = async (id: string, q: string) => Number((await one("select count(*) n from individual_scholar_search_history where user_id = $1 and query = $2", [id, q])).n);
const aiCalls = async (id: string) => Number((await one("select (select count(*) from plat_ai_requests where actor_id = $1) + (select count(*) from ai_usage_ledger where user_id = $1) as n", [id])).n);
const aiRow = async (id: string) => JSON.stringify(await one("select status, notice_version, granted_at, revoked_at, updated_at from individual_scholar_consent where user_id = $1 and feature = 'ai_processing_uploads'", [id]));
const choiceRow = (id: string) => one("select status, notice_version, granted_at, revoked_at from individual_scholar_consent where user_id = $1 and feature = 'scholar_search_history'", [id]);
const records = (id: string) => one(`select
    (select count(*) from individual_scholar_artefact where user_id = $1)::int as artefacts,
    (select count(*) from individual_scholar_learning_session where user_id = $1)::int as sessions,
    (select count(*) from individual_scholar_attempt where user_id = $1)::int as attempts,
    (select count(*) from individual_scholar_material where user_id = $1)::int as materials,
    (select count(*) from individual_scholar_card where user_id = $1)::int as cards,
    (select count(*) from individual_scholar_note where user_id = $1)::int as notes`, [id]);
/** Staging only: a throwaway copy of one row, with these columns changed. Generated columns are left to the database. */
async function copyRow(table: string, id: string, over: Record<string, unknown>) {
  const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'", [table])).rows.map((r: { column_name: string }) => `"${r.column_name}"`).join(", ");
  await db.query(`insert into ${table} (${cols}) select ${cols} from jsonb_populate_record(null::${table}, (select to_jsonb(t) from ${table} t where t.id = $1) || $2::jsonb)`, [id, JSON.stringify(over)]);
}
const waitFor = async (f: () => Promise<boolean>, secs = 90) => { for (let i = 0; i < secs; i++) { if (await f()) return true; await new Promise(r => setTimeout(r, 1000)); } return false; };

async function cookiesFor(email: string) {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error(`could not mint a session for ${email}`);
  const jar = new Map<string, string>();
  const sb = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs: { name: string; value: string }[]) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
  const r = await sb.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  if (r.error || !r.data?.user) throw new Error(`could not verify the session for ${email}`);
  return [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const }));
}
// The material page asks for its topic analysis on load. On this fixture that answers 503 "not_eligible" with or without history (seen with the setting off and on): not this walk.
const isAnalyse = (u: string) => u.includes("/materials/") && u.endsWith("/analyse");
function watch(page: Page, tag: string) {
  page.on("console", m => { if (m.type() === "error" && !/Content Security Policy|upgrade-insecure|Download the React DevTools/i.test(m.text()) && !isAnalyse(m.location().url)) consoleErrors.push(`${tag} at ${page.url().replace(BASE, "")}: ${m.text().slice(0, 2600)}`); });
  page.on("pageerror", e => consoleErrors.push(`${tag} pageerror: ${String(e).slice(0, 240)}`));
  page.on("response", r => { if (r.status() >= 500 && !isAnalyse(r.url())) fivexx.push(`${tag} ${r.status()} ${r.url()}`); });
}
async function context(browser: Browser, cookies: Awaited<ReturnType<typeof cookiesFor>>, tag: string, size: { width: number; height: number; mobile?: boolean }) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: !!size.mobile, hasTouch: !!size.mobile, reducedMotion: "reduce" });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  watch(page, tag);
  return { ctx, page };
}
async function go(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
}
async function overflow(page: Page, label: string) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
  ok(o.sw <= o.vw, `${label}: no horizontal overflow (${o.sw} <= ${o.vw})`);
}
/** The notice in this region of the page: says the right state, and its link reaches the setting. */
async function noticeAt(page: Page, label: string, state: "on" | "off", within?: ReturnType<Page["locator"]>) {
  const root = within ?? page.locator("body");
  const n = root.locator('[data-testid="history-notice"]').first();
  const seen = await n.isVisible({ timeout: 60_000 }).catch(() => false) || await n.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
  const got = seen ? await n.getAttribute("data-history") : null;
  const link = n.locator('[data-testid="history-notice-link"]');
  const href = seen ? await link.getAttribute("href").catch(() => null) : null;
  const name = seen ? (await link.innerText().catch(() => "")).trim() : "";
  ok(seen && got === state && !!href?.endsWith("/study/saved/searches#history-setting") && name === "Manage My Search History", `${label}: notice says ${state}, with a named link to the setting (saw ${got}, ${href ? "linked" : "no link"})`);
}
/** Click the setting's button until the page shows the new state: a click before hydration does nothing, so it is tried again. */
async function turn(page: Page, to: "on" | "off", root = "") {
  const setting = page.locator(`${root} [data-testid="history-setting"]`.trim());
  for (let i = 0; i < 20; i++) {
    if ((await setting.getAttribute("data-history")) === to) return true;
    await setting.locator(`[data-testid="history-turn-${to}"]`).click();
    if (await waitFor(async () => (await setting.getAttribute("data-history")) === to, 5)) return true;
  }
  return false;
}
/** POST as the signed-in learner, from the page. */
const post = (page: Page, body: unknown) => page.evaluate(async ({ route, body }) => { const r = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; }, { route: ROUTE, body });
const key = () => `c:walk${randomUUID().replace(/-/g, "")}`.slice(0, 40);

async function learnSearch(page: Page, q: string) {
  await go(page, `${S}/learn`);
  await page.locator("#learn-q").fill(q);
  await page.getByRole("button", { name: "Search my library" }).click();
  await page.waitForURL(/\/study\/learn\?.*q=/, { timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
}
async function librarySearch(page: Page, q: string) {
  await go(page, `${S}/saved`);
  const form = page.locator('form[role="search"]').first();
  await form.locator('input[name="q"]').fill(q);
  await form.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/\/study\/saved\?.*q=/, { timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
}
async function openAskPanel(page: Page) {
  const art = (await one("select id from individual_scholar_artefact where user_id = $1 and superseded_at is null order by created_at desc limit 1", [A.id])).id;
  await go(page, `${S}/saved?version=${art}`);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Ask about this/ }).first().click();
  const dlg = page.locator("dialog[open]");
  await dlg.waitFor({ timeout: 30_000 });
  return dlg;
}
async function askInPanel(page: Page, q: string) {
  const dlg = await openAskPanel(page);
  await dlg.locator("textarea").first().fill(q);
  await dlg.locator('button[type="submit"]').first().click();
  await dlg.getByRole("button", { name: /study|learning|education/i }).first().click({ timeout: 25_000 }).catch(() => info("Ask panel: no clarify prompt"));
  const answered = await dlg.locator("article").first().waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
  // The box empties when the reply has finished (closing the panel earlier would stop it).
  await page.waitForFunction(() => (document.querySelector("dialog[open] textarea") as HTMLTextAreaElement | null)?.value === "", undefined, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  return answered;
}
/** Fill a React box and wait until React has it: its form's submit button enables only once the words reached state (the page is hydrated). */
async function hydratedFill(page: Page, selector: string, q: string) {
  for (let i = 0; i < 60; i++) {
    await page.locator(selector).fill(q);
    await page.waitForTimeout(500);
    const live = await page.locator(selector).evaluate(el => { const b = (el as HTMLTextAreaElement).form?.querySelector('button[type="submit"]') as HTMLButtonElement | null; return !!b && !b.disabled; });
    if (live) return;
    await page.locator(selector).fill("");
    await page.waitForTimeout(1000);
  }
  throw new Error(`${selector}: the form never became ready`);
}
async function askInLearn(page: Page, q: string) {
  await go(page, `${S}/learn?session=${LESSON}&panel=ask`);
  await page.locator("#ask-q").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(3000);
  await hydratedFill(page, "#ask-q", q);
  const done = page.waitForResponse(r => /learn\/act/.test(r.url()) && r.request().method() === "POST", { timeout: 180_000 });
  await page.locator("#ask-q").evaluate(el => (el as HTMLTextAreaElement).form!.requestSubmit());
  const r = await done;
  await r.finished().catch(() => {});
  return r.status();
}
async function askUnderstand(page: Page, material: string, q: string) {
  await go(page, `${S}/${material}`);
  const box = page.locator(`#explain-q-${material}`);
  await box.waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2000);
  await hydratedFill(page, `#explain-q-${material}`, q);
  const done = page.waitForResponse(r => /scholar\/explain/.test(r.url()) && r.request().method() === "POST", { timeout: 180_000 });
  await box.evaluate(el => (el as HTMLTextAreaElement).form!.requestSubmit());
  const r = await done;
  await r.finished().catch(() => {});
  return r.status();
}

async function main() {
  await db.connect();
  const browser = await chromium.launch();
  // Start from a learner who has never chosen, and with nothing left from an aborted run.
  await db.query("delete from individual_scholar_search_history where user_id = $1 and query = 'probe only'", [A.id]);
  await db.query("delete from individual_scholar_learning_session where user_id = $1 and title = 'Consent walk lesson'", [B.id]);
  await db.query("delete from individual_scholar_material where user_id = $1 and title like 'Consent walk material%'", [B.id]);
  await db.query("delete from individual_scholar_consent where feature = 'scholar_search_history' and user_id = any($1)", [[A.id, B.id]]);
  const aiA0 = await aiRow(A.id), aiB0 = await aiRow(B.id), recA0 = await records(A.id), ai0 = await aiCalls(A.id);
  const material = (await one("select material_id from individual_scholar_learning_step where user_id = $1 and session_id = $2 limit 1", [A.id, LESSON])).material_id;
  info(`A AI consent at the start: ${(JSON.parse(aiA0) as { notice_version: string; status: string }).status} at ${(JSON.parse(aiA0) as { notice_version: string }).notice_version}`);
  ok(JSON.parse(aiA0).status === "granted" && JSON.parse(aiA0).notice_version === "scholar-ai-uploads-notice-v3", "A has agreed to AI notice v3 and has made no history choice");

  const a = await context(browser, await cookiesFor(A.email), "A", { width: 1440, height: 1000 });
  const sent: string[] = [];
  a.page.on("request", r => { if (r.url().includes(ROUTE) && r.method() === "POST") sent.push(r.postData() ?? ""); });

  // ---- 1. Default OFF, and the v3 learner is not asked again ----
  const QS = `consent search off walk${STAMP}`, QL = `consent library off walk${STAMP}`;
  const before = await captured(A.id);
  await go(a.page, `${S}/learn`);
  const head = await a.page.locator("main, header").first().innerText().catch(() => "");
  const headerAll = await a.page.locator("body").innerText();
  ok(/AI help on/.test(headerAll) && !/agree again/i.test(headerAll), "v3 learner: the header says AI help on, and nothing asks them to agree again");
  await noticeAt(a.page, "Learn search, off", "off");
  ok(await a.page.locator('input[name="hk"]').count() === 0, "Learn search, off: the form carries no history key");
  await a.page.screenshot({ path: join(SHOTS, "c1-learn-off-1440.png") });

  await learnSearch(a.page, QS);
  ok(!a.page.url().includes("hk="), "Learn search, off: the results address has no history key");
  await a.page.waitForTimeout(2000);
  ok((await hasQuery(A.id, QS)) === 0, "Learn search, off: nothing kept");
  await librarySearch(a.page, QL);
  await noticeAt(a.page, "Library search, off", "off");
  await a.page.waitForTimeout(2000);
  ok((await hasQuery(A.id, QL)) === 0, "Library search, off: nothing kept");
  ok(sent.length === 0, `off: the page sent the history route nothing (${sent.length} sent)`);

  const direct = await post(a.page, { activity: "material_search", query: `consent direct walk${STAMP}`, requestKey: key() });
  ok(direct.status === 200 && direct.json.kept === false && direct.json.reason === "off", `off: a direct capture is refused by the server (${JSON.stringify(direct.json)})`);
  sent.length = 0; // that POST was the walk's own

  // ---- 2. AI help and lessons work with it OFF ----
  const aiStart = await aiCalls(A.id);
  const QP = `How does preload change in sepsis? consent off panel walk${STAMP}`, QA = `Why is oxygen given to a target range? consent off ask walk${STAMP}`, QU = `What is cardiac output? consent off understand walk${STAMP}`;
  const dlgOff = await openAskPanel(a.page);
  await noticeAt(a.page, "Ask panel, off", "off", dlgOff);
  const panelText = await dlgOff.innerText();
  ok(/The answer is not saved/.test(panelText) && !/private to you/.test(panelText), "Ask panel: says the answer is not saved, with no absolute claim");
  await a.page.screenshot({ path: join(SHOTS, "c2-ask-panel-off-1440.png") });
  await a.page.keyboard.press("Escape");
  ok(await askInPanel(a.page, QP), "AI help with it off: the Ask panel answered");
  const learnStatus = await askInLearn(a.page, QA);
  ok(learnStatus === 200, `AI help with it off: Learn Ask answered (${learnStatus})`);
  ok((await a.page.locator("main").innerText()).length > 200, "a lesson opens with it off");
  await noticeAt(a.page, "Learn Ask, off", "off", a.page.locator('aside[aria-labelledby="ask-h"]'));
  const expStatus = await askUnderstand(a.page, material, QU);
  ok(expStatus === 200, `AI help with it off: Understand answered (${expStatus})`);
  await noticeAt(a.page, "Understand, off", "off");
  const aiOff = (await aiCalls(A.id)) - aiStart;
  ok(aiOff >= 3, `AI really ran with it off (${aiOff} AI ledger and request rows)`);
  await a.page.waitForTimeout(2000);
  ok((await hasQuery(A.id, QP)) + (await hasQuery(A.id, QA)) + (await hasQuery(A.id, QU)) === 0, "off: none of the three questions was kept");
  ok((await captured(A.id)) === before, `off: captured rows unchanged (${before})`);
  ok(sent.length === 0, "off: no question was sent to the history route");
  ok((await aiRow(A.id)) === aiA0, "off: the AI consent row is untouched");

  // ---- 3. Reach the setting from a notice, read it, turn it ON ----
  await go(a.page, `${S}/learn`);
  await a.page.locator('[data-testid="history-notice-link"]').click();
  await a.page.waitForURL(/saved\/searches/, { timeout: 120_000 });
  await a.page.locator('[data-testid="history-setting"]').waitFor({ timeout: 120_000 });
  const noticeText = await a.page.locator('[data-testid="history-setting-notice"]').innerText();
  ok(await a.page.locator('[data-testid="history-setting-notice"]').isVisible(), "setting: while off, the whole notice is open");
  ok(/not ordinarily visible to other learners, educators or employers/.test(noticeText) && /separate from AI help/.test(noticeText) && /Answers are not kept/.test(noticeText) && /Personal AI does not use it/.test(noticeText), "setting: the notice says what is kept, who may see it, and that it is apart from AI help");
  ok((await a.page.locator('[data-testid="history-setting"]').getAttribute("data-history")) === "off", "setting: a learner who never chose is off");
  ok(!(await choiceRow(A.id)), "no choice row until the learner chooses");
  await a.page.screenshot({ path: join(SHOTS, "c3-setting-off-1440.png"), fullPage: true });
  ok(await turn(a.page, "on"), "setting: turning it on shows on");
  const on = await choiceRow(A.id);
  ok(on?.status === "granted" && on?.notice_version === NOTICE && !!on?.granted_at, `the choice is recorded with its notice version and time (${on?.notice_version})`);
  const audited = await one("select count(*) n from audit_log where action = 'individual_scholar_consent_granted' and actor_id = $1 and created_at > now() - interval '5 minutes' and new_value->>'feature' = 'scholar_search_history' and new_value->>'notice_version' = 'scholar-search-history-notice-v1'", [A.id]).catch(() => null);
  ok(Number(audited?.n ?? 0) >= 1, "the choice is audited, as the feature name only");
  ok((await aiRow(A.id)) === aiA0, "turning it on did not touch the AI consent row");
  await a.page.screenshot({ path: join(SHOTS, "c4-setting-on-1440.png"), fullPage: true });

  // ---- 4. ON: each capture point keeps, once, and says so ----
  const QS2 = `consent search on walk${STAMP}`, QL2 = `consent library on walk${STAMP}`, QP2 = `How is afterload raised? consent on panel walk${STAMP}`, QA2 = `What does oxygen do here? consent on ask walk${STAMP}`, QU2 = `What sets stroke volume? consent on understand walk${STAMP}`;
  await go(a.page, `${S}/learn`);
  await noticeAt(a.page, "Learn search, on", "on");
  await a.page.waitForFunction(() => !!(document.querySelector('input[name="hk"]') as HTMLInputElement | null)?.value, undefined, { timeout: 120_000 });
  await a.page.locator("#learn-q").fill(QS2);
  await a.page.getByRole("button", { name: "Search my library" }).click();
  await a.page.waitForURL(/hk=/, { timeout: 120_000 });
  ok(await waitFor(async () => (await hasQuery(A.id, QS2)) === 1, 30), "Learn search, on: kept once");
  await a.page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await a.page.waitForTimeout(1500);
  ok((await hasQuery(A.id, QS2)) === 1, "Learn search, on: a reload adds nothing");
  await go(a.page, `${S}/saved`);
  await noticeAt(a.page, "Library search, on", "on");
  const lib = a.page.locator('form[role="search"]').first();
  await a.page.waitForFunction(() => !!(document.querySelector('form[role="search"] input[name="hk"]') as HTMLInputElement | null)?.value, undefined, { timeout: 120_000 });
  await lib.locator('input[name="q"]').fill(QL2);
  await lib.getByRole("button", { name: "Search", exact: true }).click();
  ok(await waitFor(async () => (await hasQuery(A.id, QL2)) === 1, 30), "Library search, on: kept once");
  const dlgOn = await openAskPanel(a.page);
  await noticeAt(a.page, "Ask panel, on", "on", dlgOn);
  await a.page.keyboard.press("Escape");
  ok(await askInPanel(a.page, QP2), "Ask panel, on: answered");
  ok(await waitFor(async () => (await hasQuery(A.id, QP2)) === 1, 60), "Ask panel, on: the question is kept once");
  ok((await askInLearn(a.page, QA2)) === 200, "Learn Ask, on: answered");
  await noticeAt(a.page, "Learn Ask, on", "on", a.page.locator('aside[aria-labelledby="ask-h"]'));
  ok(await waitFor(async () => (await hasQuery(A.id, QA2)) === 1, 60), "Learn Ask, on: the question is kept once");
  ok((await askUnderstand(a.page, material, QU2)) === 200, "Understand, on: answered");
  await noticeAt(a.page, "Understand, on", "on");
  ok(await waitFor(async () => (await hasQuery(A.id, QU2)) === 1, 60), "Understand, on: the question is kept once");
  const cols = (await db.query("select column_name from information_schema.columns where table_name = 'individual_scholar_search_history'")).rows.map((r: { column_name: string }) => r.column_name);
  ok(!cols.some((c: string) => /answer|content|response/.test(c)), "the table has no column an answer could be kept in");

  // ---- 5. OFF from Settings: stops, removes nothing, and delete still works ----
  const kept = await captured(A.id);
  await go(a.page, `${SETTINGS}#privacy`);
  const inSettings = a.page.locator('#privacy [data-testid="history-setting"]');
  await inSettings.waitFor({ timeout: 120_000 });
  ok((await inSettings.getAttribute("data-history")) === "on", "Settings (AI and privacy) shows the same setting, on");
  await a.page.screenshot({ path: join(SHOTS, "c5-settings-1440.png"), fullPage: true });
  ok(await turn(a.page, "off", "#privacy"), "Settings: turning it off shows off");
  const off = await choiceRow(A.id);
  ok(off?.status === "revoked" && !!off?.revoked_at && off?.notice_version === NOTICE, "turning it off is recorded, with when");
  ok((await aiRow(A.id)) === aiA0, "turning it off did not touch the AI consent row");
  ok((await captured(A.id)) === kept, `turning it off removed nothing (${kept})`);
  const QS3 = `consent search after off walk${STAMP}`;
  await learnSearch(a.page, QS3);
  await a.page.waitForTimeout(2000);
  ok((await hasQuery(A.id, QS3)) === 0, "after turning it off: a new search is not kept");
  await go(a.page, `${HIST}?q=${encodeURIComponent(`consent walk${STAMP}`.replace("consent ", ""))}`);
  await go(a.page, `${HIST}?show=searches&q=${encodeURIComponent(`library on walk${STAMP}`)}`);
  const row = a.page.locator('[data-testid="history-list"] li[data-entry]').first();
  await row.waitFor({ timeout: 60_000 });
  ok((await a.page.locator('[data-testid="history-list"] li[data-entry]').count()) === 1, "with it off: entries already kept can still be found");
  const k = await row.getAttribute("data-entry");
  const removed = await a.page.evaluate(async ({ route, k }) => (await fetch(`${route}?key=${encodeURIComponent(k!)}`, { method: "DELETE" })).status, { route: ROUTE, k });
  ok(removed === 200 && (await hasQuery(A.id, QL2)) === 0, "with it off: one entry can still be removed");
  const recA1 = await records(A.id);
  ok(recA1.materials === recA0.materials && recA1.notes === recA0.notes && recA1.cards === recA0.cards && recA1.attempts === recA0.attempts && recA1.sessions === recA0.sessions, `A's materials, notes, cards, attempts and lessons unchanged across the walk (${JSON.stringify(recA1)})`);
  info(`A's saved teaching across the walk: ${recA0.artefacts} to ${recA1.artefacts}. What Learn does on its own, not the history`);
  info(`AI ledger and request rows for A during this walk: ${(await aiCalls(A.id)) - ai0} (six questions, on purpose)`);

  // ---- 6. Deleting a material removes what relied on it; clear works with it off (B) ----
  const b = await context(browser, await cookiesFor(B.email), "B", { width: 1440, height: 1000 });
  await go(b.page, HIST);
  ok(await turn(b.page, "on"), "B turns it on");
  ok((await aiRow(B.id)) === aiB0, "B: turning it on did not touch B's AI consent row");
  const m1 = randomUUID(), m2Row = await one("select id from individual_scholar_material where user_id = $1 order by created_at limit 1", [B.id]);
  const s1 = randomUUID(), s2 = randomUUID();
  // A throwaway material, section and two lessons on staging: one relies only on it, the other also on a material B keeps.
  await copyRow("individual_scholar_material", m2Row.id, { id: m1, title: `Consent walk material ${STAMP}`, storage_path: `${B.id}/consent-walk-${STAMP}.txt`, file_name: `consent-walk-${STAMP}.txt`, sha256: randomBytes(32).toString("hex") });
  const c2 = (await one("select id from individual_scholar_chunk where material_id = $1 limit 1", [m2Row.id])).id;
  const c1 = randomUUID();
  await copyRow("individual_scholar_chunk", c2, { id: c1, material_id: m1 });
  const sess = await one("select id from individual_scholar_learning_session where user_id = $1 limit 1", [B.id]);
  for (const sid of [s1, s2]) await copyRow("individual_scholar_learning_session", sess.id, { id: sid, title: "Consent walk lesson" });
  await db.query("insert into individual_scholar_learning_step (session_id, user_id, step, chunk_id, material_id) values ($1,$2,0,$3,$4)", [s1, B.id, c1, m1]);
  await db.query("insert into individual_scholar_learning_step (session_id, user_id, step, chunk_id, material_id) values ($1,$2,0,$3,$4), ($1,$2,1,$5,$6)", [s2, B.id, c1, m1, c2, m2Row.id]);
  const linked = `consent linked walk${STAMP}`, inLesson = `consent in lesson walk${STAMP}`, inBoth = `consent both walk${STAMP}`, noLink = `consent no link walk${STAMP}`;
  const k1 = await post(b.page, { activity: "ask", query: linked, requestKey: key(), materialId: m1 });
  const k2 = await post(b.page, { activity: "ask", query: inLesson, requestKey: key(), sessionId: s1, step: 0 });
  const k3 = await post(b.page, { activity: "ask", query: inBoth, requestKey: key(), sessionId: s2, step: 1 });
  const k4 = await post(b.page, { activity: "material_search", query: noLink, requestKey: key() });
  ok([k1, k2, k3, k4].every(r => r.json.kept === true), "B, on: four entries kept (linked to the material, in its lesson, in a two-material lesson, no link)");
  const recB0 = await records(B.id);
  const del = await b.page.evaluate(async id => (await fetch(`/api/individual/scholar/materials/${id}`, { method: "DELETE" })).status, m1);
  ok(del === 200, `the learner deletes the material (${del})`);
  ok((await hasQuery(B.id, linked)) === 0, "deleted material: the entry linked to it is gone");
  ok((await hasQuery(B.id, inLesson)) === 0, "deleted material: the entry asked in the lesson that relied only on it is gone");
  ok(!(await one("select id from individual_scholar_learning_session where id = $1", [s1])), "deleted material: that lesson went too (the existing rule)");
  ok((await hasQuery(B.id, inBoth)) === 1 && !!(await one("select id from individual_scholar_learning_session where id = $1", [s2])), "deleted material: a lesson that also relies on another material stays, and so does its entry");
  ok((await hasQuery(B.id, noLink)) === 1, "deleted material: a search with no link stays (open question for the owner)");
  const recB1 = await records(B.id);
  ok(recB1.attempts === recB0.attempts && recB1.artefacts === recB0.artefacts && recB1.notes === recB0.notes && recB1.cards === recB0.cards, `deleted material: attempts, saved teaching, notes and cards are unchanged, as this throwaway material had none (${recB1.attempts} attempts)`);
  await db.query("delete from individual_scholar_learning_session where id = $1", [s2]);
  ok((await hasQuery(B.id, inBoth)) === 0, "when that lesson goes, its entry goes");

  await post(b.page, { activity: "material_search", query: `consent before clear walk${STAMP}`, requestKey: key() });
  const recB2 = await records(B.id);
  await go(b.page, HIST);
  ok(await turn(b.page, "off"), "B turns it off");
  await b.page.locator('[data-testid="history-list"][data-ready="1"]').waitFor({ timeout: 60_000 }).catch(() => {});
  await b.page.getByTestId("history-clear").click();
  await b.page.getByRole("button", { name: "Yes, clear my search history" }).click();
  ok(await waitFor(async () => (await captured(B.id)) === 0, 30), "with it off: clear all removes every search and question");
  ok(JSON.stringify(await records(B.id)) === JSON.stringify(recB2), "clear touched none of B's records");
  ok((await aiRow(B.id)) === aiB0, "B's AI consent row is unchanged across the walk");

  // ---- 7. The three widths ----
  for (const [w, h, mobile, tag] of [[1440, 1000, false, "1440"], [820, 1100, false, "820"], [390, 844, true, "390"]] as const) {
    const v = await context(browser, await cookiesFor(B.email), `B${tag}`, { width: w, height: h, mobile });
    await go(v.page, HIST);
    await v.page.locator('[data-testid="history-setting"]').waitFor({ timeout: 120_000 });
    await overflow(v.page, `My Search History with the setting at ${tag}`);
    await v.page.screenshot({ path: join(SHOTS, `c6-setting-${tag}.png`), fullPage: true });
    await go(v.page, `${S}/learn`);
    await overflow(v.page, `Learn search with the notice at ${tag}`);
    await go(v.page, `${SETTINGS}`);
    await overflow(v.page, `Settings with the setting at ${tag}`);
    await v.ctx.close();
  }

  ok(consoleErrors.length === 0, `no application console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  ok(fivexx.length === 0, `no 5xx responses${fivexx.length ? `: ${fivexx.join(" | ")}` : ""}`);

  // Leave both fixtures as a learner who has never chosen, with no walk rows.
  await db.query("delete from individual_scholar_consent where feature = 'scholar_search_history' and user_id = any($1)", [[A.id, B.id]]);
  await db.query("delete from individual_scholar_search_history where user_id = any($1) and origin = 'captured' and query ~ 'walk[0-9]{6}'", [[A.id, B.id]]);
  await db.query("delete from individual_scholar_search_history where user_id = $1", [B.id]);
  await browser.close(); await db.end();
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  log.push(`${fails ? "RED" : "ALL PASS"} -- ${log.filter(l => l.startsWith("PASS")).length} passed, ${fails} failed`);
  writeFileSync(join(OUT, `walk-consent-${STAMP}.log`), log.join("\n") + "\n");
  console.log(log[log.length - 1]);
  process.exit(fails ? 1 : 0);
}
main().catch(async e => { console.error("CONSENT WALK ABORTED:", e?.message ?? e); console.log(log.join("\n")); writeFileSync(join(OUT, `walk-consent-${STAMP}-aborted.log`), log.join("\n") + `\nABORTED ${e?.message ?? e}\n`); await db.end().catch(() => {}); process.exit(2); });
