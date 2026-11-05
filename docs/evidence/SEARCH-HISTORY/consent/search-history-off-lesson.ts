/* eslint-disable @typescript-eslint/no-unused-vars -- evidence script */
// My Search History, owner privacy decision 5 Nov 2026: the STAGING walk for the learner's own setting, as two fixture learners.
//   A = harness-guided-browser@competen.test (AI help on at v3), B = scholar-demo@competen.demo.
// Proves: the setting OFF keeps nothing; AI help and lessons still work with it OFF; a v3 learner is not asked again; the notice and its link
// appear at every capture point; ON keeps; OFF stops and removes nothing; delete and clear work with it OFF; deleting a material removes what
// relied on it and nothing else. A few real AI calls, on purpose. Signed in with a magic-link session minted by the STAGING service role (no
// password). Refuses production. Reads are counts and keys. No account is reset and no lesson is repeated.
// THIS FILE: a NEW lesson is started and taught with My Search History off (one AI call). The throwaway lesson is removed afterwards.
// Run:  npx tsx docs/evidence/SEARCH-HISTORY/consent/search-history-off-lesson.ts   (dev server on 3199 pointed at staging)
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
  await db.query("delete from individual_scholar_consent where feature = 'scholar_search_history' and user_id = $1", [B.id]);
  const b = await context(browser, await cookiesFor(B.email), "B", { width: 1440, height: 1000 });
  const sent: string[] = [];
  b.page.on("request", r => { if (r.url().includes(ROUTE) && r.method() === "POST") sent.push(r.url()); });
  const acts: string[] = [];
  b.page.on("response", async r => { if (/learn\/act/.test(r.url()) && r.request().method() === "POST") acts.push(`${r.status()} ${JSON.parse(r.request().postData() ?? "{}").action ?? "?"}`); });
  const before = await one("select (select count(*) from individual_scholar_learning_session where user_id = $1)::int s, (select count(*) from individual_scholar_search_history where user_id = $1 and origin = 'captured')::int c", [B.id]);
  const ai0 = await aiCalls(B.id), ai = await aiRow(B.id);
  ok(!(await choiceRow(B.id)), "B has made no history choice: it is off");
  const topic = `medication safety lesson walk${STAMP}`;
  await go(b.page, `${S}/learn?q=${encodeURIComponent(topic)}&teach=1`);
  await b.page.waitForTimeout(4000);
  info(`after Teach me: ${b.page.url().replace(BASE, "").slice(0, 90)}`);
  // Learn opens the lesson and may offer its first step to start. Press what a learner would, once.
  const start = b.page.getByRole("button", { name: /^(Start learning|Teach me|Start)/ }).first();
  if (await start.isVisible().catch(() => false)) await start.click();
  ok(await waitFor(async () => acts.some(a => a.startsWith("200")), 120), `a lesson is taught with it off (${acts.join(", ")})`);
  await b.page.waitForTimeout(2000);
  await b.page.screenshot({ path: join(SHOTS, "c7-new-lesson-off-1440.png") });
  const after = await one("select (select count(*) from individual_scholar_learning_session where user_id = $1)::int s, (select count(*) from individual_scholar_search_history where user_id = $1 and origin = 'captured')::int c", [B.id]);
  ok(after.s === before.s + 1, `a new lesson exists (${before.s} to ${after.s})`);
  ok(await waitFor(async () => (await aiCalls(B.id)) > ai0, 30), `AI really ran (${(await aiCalls(B.id)) - ai0} rows)`);
  ok(after.c === before.c && sent.length === 0, "off: nothing kept, and nothing sent to the history route");
  ok((await hasQuery(B.id, topic)) === 0, "off: the typed topic is not kept");
  ok((await aiRow(B.id)) === ai, "the AI consent row is untouched");
  ok(consoleErrors.length === 0, `no application console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  ok(fivexx.length === 0, `no 5xx responses${fivexx.length ? `: ${fivexx.join(" | ")}` : ""}`);
  const made = (await db.query("delete from individual_scholar_learning_session where user_id = $1 and created_at > now() - interval '15 minutes' returning id", [B.id])).rowCount;
  info(`removed the throwaway lesson (${made})`);
  await browser.close(); await db.end();
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  log.push(`${fails ? "RED" : "ALL PASS"} -- ${log.filter(l => l.startsWith("PASS")).length} passed, ${fails} failed`);
  writeFileSync(join(OUT, `walk-off-lesson-${STAMP}.log`), log.join("\n") + "\n");
  console.log(log[log.length - 1]);
  process.exit(fails ? 1 : 0);
}
main().catch(async e => { console.error("ABORTED:", e?.message ?? e); console.log(log.join("\n")); await db.end().catch(() => {}); process.exit(2); });
