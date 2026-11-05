/* eslint-disable @typescript-eslint/no-unused-vars -- evidence script */
// My Search History, owner decision 5 Nov 2026 (on by default after a one-time notice): the STAGING walk, as two fixture learners.
//   A = harness-guided-browser@competen.test (a lesson, saved teaching, AI help on at v3), B = scholar-demo@competen.demo.
// Proves: no choice, then the notice, then kept. A search before the notice is not kept. Turn it off stays off across visits. A v1 opt-in stays on, a v1
// opt-out stays off, neither asked again. The AI consent row does not change. The notice and link at all five capture points. Seeing the notice is
// recorded as notified, never as a grant, and the audit row says which happened. One real AI call, on purpose. Signed in with a magic-link session
// minted by the STAGING service role (no password). Refuses production. Reads are counts and keys. No account is reset and no lesson is repeated.
// Run:  npx tsx docs/evidence/SEARCH-HISTORY/default-on/search-history-default-on-walk.ts   (dev server on 3199 pointed at staging)
import { chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
const ROUTE = "/api/individual/scholar/library/history", CONSENT = "/api/individual/scholar/consent";
const OUT = join(ROOT, "docs/evidence/SEARCH-HISTORY/default-on");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const A = { email: "harness-guided-browser@competen.test", id: "32142f0d-c150-4180-8156-fb4e11a20fea" };
const B = { email: "scholar-demo@competen.demo", id: "0f62a14e-c264-4db1-bf99-00fd55ae547c" };
const LESSON = "2b9fccd2-530b-45e0-a77c-5c68d0f2c982";
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const V1 = "scholar-search-history-notice-v1", V2 = "scholar-search-history-notice-v2";

const log: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };
const consoleErrors: string[] = [], fivexx: string[] = [];

const db = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];
const hasQuery = async (id: string, q: string) => Number((await one("select count(*) n from individual_scholar_search_history where user_id = $1 and query = $2", [id, q])).n);
const aiCalls = async (id: string) => Number((await one("select (select count(*) from plat_ai_requests where actor_id = $1) + (select count(*) from ai_usage_ledger where user_id = $1) as n", [id])).n);
const aiRow = async (id: string) => JSON.stringify(await one("select status, notice_version, granted_at, revoked_at, updated_at from individual_scholar_consent where user_id = $1 and feature = 'ai_processing_uploads'", [id]));
const choiceRow = (id: string) => one("select status, notice_version, granted_at, revoked_at from individual_scholar_consent where user_id = $1 and feature = 'scholar_search_history'", [id]);
const clearChoice = (id: string) => db.query("delete from individual_scholar_consent where feature = 'scholar_search_history' and user_id = $1", [id]);
const seed = (id: string, status: "granted" | "revoked", version: string) => db.query(`insert into individual_scholar_consent (user_id, feature, status, notice_version, granted_at, revoked_at, updated_at)
  values ($1, 'scholar_search_history', $2, $3, now(), case when $2 = 'revoked' then now() else null end, now())
  on conflict (user_id, feature) do update set status = excluded.status, notice_version = excluded.notice_version, granted_at = excluded.granted_at, revoked_at = excluded.revoked_at`, [id, status, version]);
const audits = async (id: string, action: string, since: Date) => Number((await one("select count(*) n from audit_log where actor_id = $1 and action = $2 and created_at >= $3 and new_value->>'feature' = 'scholar_search_history'", [id, action, since])).n);
const waitFor = async (f: () => Promise<boolean>, secs = 60) => { for (let i = 0; i < secs; i++) { if (await f()) return true; await new Promise(r => setTimeout(r, 1000)); } return false; };

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
// The material page asks for its topic analysis on load. On fixture A that answers 503 "not_eligible" with or without history: not this walk.
const isAnalyse = (u: string) => u.includes("/materials/") && u.endsWith("/analyse");
function watch(page: Page, tag: string) {
  page.on("console", m => { if (m.type() === "error" && !/Content Security Policy|upgrade-insecure|Download the React DevTools/i.test(m.text()) && !isAnalyse(m.location().url) && !/ERR_FAILED/.test(m.text())) consoleErrors.push(`${tag} at ${page.url().replace(BASE, "")}: ${m.text().slice(0, 1200)}`); });
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
const key = () => `c:walk${randomUUID().replace(/-/g, "")}`.slice(0, 40);
const directPost = (page: Page, q: string) => page.evaluate(async ({ route, body }) => { const r = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; }, { route: ROUTE, body: { activity: "material_search", query: q, requestKey: key() } });

/** The one-time notice in this region: visible, with both buttons and the link, and recorded as seen without any click. */
async function firstNoticeAt(page: Page, id: string, label: string, within?: ReturnType<Page["locator"]>) {
  const root = within ?? page.locator("body");
  const n = root.locator('[data-testid="history-first-notice"]').first();
  const seen = await n.waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
  // It records only once it has been on screen, so go to it as a learner would. A box further down the page is not seen until then.
  if (seen) await n.scrollIntoViewIfNeeded().catch(() => {});
  const keepOn = seen && await n.locator('[data-testid="history-first-keep"]').isVisible();
  const off = seen && await n.locator('[data-testid="history-first-off"]').isVisible();
  const href = seen ? await n.locator('[data-testid="history-notice-link"]').getAttribute("href").catch(() => null) : null;
  const text = seen ? await n.innerText() : "";
  ok(keepOn && off && !!href?.endsWith("/study/saved/searches#history-setting") && /My Search History is on/.test(text) && /not ordinarily visible/.test(text), `${label}: the one-time notice, with Keep it on, Turn it off and the link${keepOn && off && href ? "" : ` (keep ${keepOn}, off ${off}, link ${href}, text: ${text.slice(0, 70)})`}`);
  const recorded = await waitFor(async () => (await choiceRow(id))?.status === "notified", 60);
  const r = await choiceRow(id);
  ok(recorded && r.notice_version === V2 && r.granted_at === null, `${label}: recorded as seen with no click (${r?.status}, grant time ${r?.granted_at})`);
}
/** The short notice in this region, in this state, with its link. No one-time notice. */
async function shortNoticeAt(page: Page, label: string, state: "on" | "off", within?: ReturnType<Page["locator"]>) {
  const root = within ?? page.locator("body");
  const n = root.locator('[data-testid="history-notice"]').first();
  const seen = await n.waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
  const got = seen ? await n.getAttribute("data-history") : null;
  const href = seen ? await n.locator('[data-testid="history-notice-link"]').getAttribute("href") : null;
  ok(seen && got === state && !!href?.endsWith("/study/saved/searches#history-setting") && await root.locator('[data-testid="history-first-notice"]').count() === 0, `${label}: the short notice says ${state}, with its link, and no one-time notice (saw ${got})`);
}
const keyReady = (page: Page) => page.waitForFunction(() => !!(document.querySelector('input[name="hk"]') as HTMLInputElement | null)?.value, undefined, { timeout: 60_000 }).then(() => true).catch(() => false);
async function learnSearch(page: Page, q: string) {
  await page.locator("#learn-q").fill(q);
  await page.getByRole("button", { name: "Search my library" }).click();
  await page.waitForURL(/\/study\/learn\?.*q=/, { timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
}
async function openAskPanel(page: Page) {
  const art = (await one("select id from individual_scholar_artefact where user_id = $1 and superseded_at is null order by created_at desc limit 1", [A.id])).id;
  await go(page, `${S}/saved?version=${art}`);
  await page.waitForTimeout(1500);
  return art;
}
async function setting(page: Page, url: string) {
  await go(page, url);
  const s = page.locator('[data-testid="history-setting"]').first();
  await s.waitFor({ timeout: 120_000 });
  return s;
}

async function main() {
  await db.connect();
  const browser = await chromium.launch();
  await clearChoice(A.id); await clearChoice(B.id);
  await db.query("delete from individual_scholar_search_history where user_id = any($1::uuid[]) and origin = 'captured' and query ~ 'walk[0-9]{6}'", [[A.id, B.id]]);
  const aiA0 = await aiRow(A.id), aiB0 = await aiRow(B.id);
  const material = (await one("select material_id from individual_scholar_learning_step where user_id = $1 and session_id = $2 limit 1", [A.id, LESSON])).material_id;
  ok(JSON.parse(aiA0).status === "granted" && JSON.parse(aiA0).notice_version === "scholar-ai-uploads-notice-v3", "A has agreed to AI notice v3, with no history choice");

  const a = await context(browser, await cookiesFor(A.email), "A", { width: 1440, height: 1000 });
  const b = await context(browser, await cookiesFor(B.email), "B", { width: 1440, height: 1000 });

  // ---- 1. Before the notice nothing can be kept, even if recording fails ----
  const QBLOCK = `blocked record walk${STAMP}`;
  await b.page.route(`**${CONSENT}`, r => r.abort());
  await go(b.page, `${S}/learn`);
  await b.page.locator('[data-testid="history-first-notice"][data-failed="1"]').waitFor({ timeout: 90_000 }).catch(() => {});
  const failedText = await b.page.locator('[data-testid="history-first-notice"]').first().innerText();
  ok(/could not start just now, so nothing is being kept/.test(failedText), "recording fails: the notice says nothing is being kept");
  ok(!(await choiceRow(B.id)), "recording fails: no row");
  ok(await b.page.locator('input[name="hk"]').count() === 0, "recording fails: the search form carries no history key");
  await learnSearch(b.page, QBLOCK);
  await b.page.waitForTimeout(2000);
  ok((await hasQuery(B.id, QBLOCK)) === 0, "recording fails: the search still ran and is not kept");
  const early = await directPost(b.page, `direct before notice walk${STAMP}`);
  ok(early.json.kept === false && early.json.reason === "off", `a search before the notice is not kept, even posted directly (${JSON.stringify(early.json)})`);
  await b.page.unroute(`**${CONSENT}`);

  // ---- 2. No choice, then the notice, then kept. The record says what happened ----
  const t0 = new Date(Date.now() - 2000);
  await go(b.page, `${S}/learn`);
  await firstNoticeAt(b.page, B.id, "Learn search, B");
  await b.page.screenshot({ path: join(SHOTS, "d1-first-notice-learn-1440.png") });
  ok(await audits(B.id, "individual_scholar_consent_notice_shown", t0) === 1, "the audit row says the notice was shown");
  ok(await audits(B.id, "individual_scholar_consent_granted", t0) === 0, "no audit row says it was granted");
  ok(await keyReady(b.page), "once recorded, the same page's search form carries a history key");
  const QKEPT = `kept after notice walk${STAMP}`;
  await learnSearch(b.page, QKEPT);
  ok(await waitFor(async () => (await hasQuery(B.id, QKEPT)) === 1, 30), "after the notice: the search is kept once");
  await shortNoticeAt(b.page, "Learn results, the next page", "on");
  await go(b.page, `${S}/learn`);
  await shortNoticeAt(b.page, "Learn again, a later visit", "on");
  await overflow(b.page, "Learn with the short notice at 1440");
  const sOn = await setting(b.page, HIST);
  ok((await sOn.getAttribute("data-state")) === "on_by_notice" && /because you saw this notice/.test(await sOn.innerText()), "setting: on, because you saw this notice");
  ok((await b.page.locator("body").innerText()).includes("Not ordinarily visible to other learners, educators or employers"), "the page foot stays accurate");
  await b.page.screenshot({ path: join(SHOTS, "d2-setting-on-by-notice-1440.png") });

  // ---- 3. Keep it on is a real grant, with an audit row that says so ----
  const t1 = new Date(Date.now() - 2000);
  await sOn.locator('[data-testid="history-turn-on"]').click();
  ok(await waitFor(async () => (await choiceRow(B.id))?.status === "granted", 30), "Keep it on: recorded as granted");
  const kept = await choiceRow(B.id);
  ok(!!kept.granted_at && kept.notice_version === V2, "Keep it on: a grant time and notice v2");
  ok(await audits(B.id, "individual_scholar_consent_granted", t1) === 1, "Keep it on: the audit row says granted");
  ok(await waitFor(async () => (await b.page.locator('[data-testid="history-setting"]').first().getAttribute("data-state")) === "on_chosen", 20), "setting: on, by their choice");

  // ---- 4. Turn it off, straight from the notice, with no grant behind it. It stays off across visits ----
  await clearChoice(B.id);
  await go(b.page, `${S}/learn`);
  await firstNoticeAt(b.page, B.id, "Learn search, B again");
  await b.page.locator('[data-testid="history-first-off"]').click();
  ok(await waitFor(async () => (await choiceRow(B.id))?.status === "revoked", 30), "Turn it off from the notice: recorded as revoked");
  ok((await choiceRow(B.id)).granted_at === null, "Turn it off from the notice: no false grant time");
  await shortNoticeAt(b.page, "after Turn it off, the same page", "off");
  ok(await b.page.locator('input[name="hk"]').count() === 0, "after Turn it off: no history key");
  const QOFF = `after off walk${STAMP}`;
  for (const visit of [1, 2]) {
    await go(b.page, `${S}/learn`);
    await shortNoticeAt(b.page, `off, visit ${visit}`, "off");
    await b.page.waitForTimeout(1500);
    const r = await choiceRow(B.id);
    ok(r.status === "revoked", `off, visit ${visit}: the row is still revoked, so seeing the page did not turn it on`);
  }
  await learnSearch(b.page, QOFF);
  await b.page.waitForTimeout(2000);
  ok((await hasQuery(B.id, QOFF)) === 0, "off: a search is not kept");
  const seenLate = await b.page.evaluate(async url => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "scholar_search_history", seen: true }) }); return r.json(); }, CONSENT);
  ok(seenLate.state === "off" && (await choiceRow(B.id)).status === "revoked", `a notice recorded late cannot overwrite Turn it off (${JSON.stringify(seenLate)})`);

  // ---- 5. Turn it off from the setting with no row at all ----
  await clearChoice(B.id);
  const sNone = await setting(b.page, HIST);
  ok((await sNone.getAttribute("data-state")) === "unseen" && /Nothing is being kept yet/.test(await sNone.innerText()), "setting, no choice: says nothing is being kept yet");
  await b.page.waitForTimeout(2000);
  ok(!(await choiceRow(B.id)), "opening the setting does not record the notice as seen");
  await sNone.locator('[data-testid="history-turn-off"]').click();
  ok(await waitFor(async () => (await choiceRow(B.id))?.status === "revoked", 30), "Turn it off from the setting, with no row: recorded");

  // ---- 6. The pilot's v1 choices stand ----
  await seed(A.id, "granted", V1);
  await go(a.page, `${S}/learn`);
  await shortNoticeAt(a.page, "a v1 opt-in", "on");
  ok((await choiceRow(A.id)).notice_version === V1 && (await choiceRow(A.id)).status === "granted", "a v1 opt-in: the row is unchanged, not moved to v2");
  ok(await keyReady(a.page), "a v1 opt-in: the search form carries a key");
  const QV1 = `v1 on walk${STAMP}`;
  await learnSearch(a.page, QV1);
  ok(await waitFor(async () => (await hasQuery(A.id, QV1)) === 1, 30), "a v1 opt-in: stays on, and the search is kept");
  await seed(A.id, "revoked", V1);
  await go(a.page, `${S}/learn`);
  await shortNoticeAt(a.page, "a v1 opt-out", "off");
  const QV1off = `v1 off walk${STAMP}`;
  await learnSearch(a.page, QV1off);
  await a.page.waitForTimeout(2000);
  ok((await hasQuery(A.id, QV1off)) === 0, "a v1 opt-out: stays off, and the search is not kept");
  ok((await choiceRow(A.id)).status === "revoked" && (await choiceRow(A.id)).notice_version === V1, "a v1 opt-out: the row is unchanged");

  // ---- 7. The notice and link at all five capture points. It blocks nothing ----
  await clearChoice(A.id);
  await go(a.page, `${S}/learn`);
  await firstNoticeAt(a.page, A.id, "1 Learn search");
  await clearChoice(A.id);
  await go(a.page, `${S}/saved`);
  await firstNoticeAt(a.page, A.id, "2 Library search");
  // The saved answer's page holds the library search box too, whose notice would be seen first. So hold the recording: the learner is still unseen when the panel opens.
  await waitFor(async () => (await choiceRow(A.id))?.status === "notified", 30);
  await clearChoice(A.id);
  const held: { abort: () => Promise<void> }[] = [];
  await a.page.route(`**${CONSENT}`, r => { held.push(r); });
  await openAskPanel(a.page);
  await a.page.getByRole("button", { name: /Ask about this/ }).first().click();
  const dlg = a.page.locator("dialog[open]");
  await dlg.waitFor({ timeout: 30_000 });
  const inPanel = dlg.locator('[data-testid="history-first-notice"]').first();
  const panelSeen = await inPanel.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  const panelLink = panelSeen ? await inPanel.locator('[data-testid="history-notice-link"]').getAttribute("href") : null;
  ok(panelSeen && await inPanel.locator('[data-testid="history-first-keep"]').isVisible() && await inPanel.locator('[data-testid="history-first-off"]').isVisible() && !!panelLink?.endsWith("/study/saved/searches#history-setting"), "3 Ask panel: the one-time notice, with Keep it on, Turn it off and the link");
  await a.page.screenshot({ path: join(SHOTS, "d3-ask-panel-1440.png") });
  await a.page.keyboard.press("Escape");
  await a.page.unroute(`**${CONSENT}`);
  await Promise.all(held.map(r => r.abort().catch(() => {})));
  ok(!(await choiceRow(A.id)), "3 Ask panel: nothing recorded while the recording was held");
  // Leave that page before starting again, so nothing it still has to say can land on the next step.
  await a.page.goto("about:blank");
  await a.page.waitForTimeout(1500);
  await clearChoice(A.id);
  await go(a.page, `${S}/learn?session=${LESSON}&panel=ask`);
  const askBox = a.page.locator('aside[aria-labelledby="ask-h"]');
  await askBox.waitFor({ timeout: 120_000 });
  await firstNoticeAt(a.page, A.id, "4 Ask Scholar in a lesson", askBox);
  await a.page.screenshot({ path: join(SHOTS, "d4-learn-ask-1440.png") });

  // It blocks nothing: with the notice on screen, AI help answers. AI usage rises, and the row is not a grant.
  const ai0 = await aiCalls(A.id);
  const QASK = `Why is oxygen given to a target range? default on walk${STAMP}`;
  for (let i = 0; i < 40; i++) {
    await a.page.locator("#ask-q").fill(QASK);
    await a.page.waitForTimeout(500);
    if (await a.page.locator("#ask-q").evaluate(el => { const c = (el as HTMLTextAreaElement).form?.querySelector('button[type="submit"]') as HTMLButtonElement | null; return !!c && !c.disabled; })) break;
    await a.page.waitForTimeout(1000);
  }
  const done = a.page.waitForResponse(r => /learn\/act/.test(r.url()) && r.request().method() === "POST", { timeout: 180_000 });
  await a.page.locator("#ask-q").evaluate(el => (el as HTMLTextAreaElement).form!.requestSubmit());
  const act = await done; await act.finished().catch(() => {});
  ok(act.status() === 200, `AI help answers with the notice on screen (${act.status()})`);
  ok(await waitFor(async () => (await aiCalls(A.id)) > ai0, 30), "AI really ran");
  ok(await waitFor(async () => (await hasQuery(A.id, QASK)) === 1, 30), "the question, asked after the notice was recorded, is kept once");
  ok((await choiceRow(A.id)).status === "notified", "asking did not turn seeing the notice into a grant");

  await clearChoice(A.id);
  await go(a.page, `${S}/${material}`);
  await firstNoticeAt(a.page, A.id, "5 Ask about your notes", a.page.locator('section[aria-labelledby="explain-h"]'));

  // ---- 8. AI consent, and the setting in Settings ----
  ok((await aiRow(A.id)) === aiA0, "A's AI consent row is byte-identical");
  ok((await aiRow(B.id)) === aiB0, "B's AI consent row is byte-identical");
  const inSettings = await setting(a.page, `${SETTINGS}#privacy`);
  ok((await inSettings.getAttribute("data-state")) === "on_by_notice", "Settings shows the same state");

  // ---- 9. The new and the old supplement, signed out ----
  const anon = await browser.newContext();
  const out = await anon.newPage();
  await out.goto(`${BASE}/legal/search-history`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const cur = await out.locator("main").innerText();
  ok(/on by default/.test(cur) && /scholar-search-history-notice-v2/.test(cur) && /not ordinarily visible/.test(cur) && /Draft under legal review/.test(cur), "the current supplement is v2, signed out, marked as a draft");
  await out.goto(`${BASE}/legal/search-history/notice-v1`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const old = await out.locator("main").innerText();
  ok(/If you turn this on, the searches you submit/.test(old) && /earlier version/.test(old), "the v1 supplement stays reachable, word for word, marked as earlier");
  await anon.close();

  // ---- 10. Touch targets, in a browser that really reports a coarse pointer (Playwright's touch emulation alone does not) ----
  const touch = await chromium.launch({ args: ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"] });
  for (const [w, h, tag] of [[820, 1100, "820"], [390, 844, "390"]] as const) {
    await clearChoice(A.id);
    const t = await touch.newContext({ viewport: { width: w, height: h }, hasTouch: true, reducedMotion: "reduce" });
    await t.addCookies(await cookiesFor(A.email));
    const pg = await t.newPage();
    await go(pg, HIST);
    await pg.locator('[data-testid="history-list"][data-ready="1"]').waitFor({ timeout: 90_000 }).catch(() => {});
    ok(await pg.evaluate(() => matchMedia("(pointer: coarse)").matches), `${tag}: the coarse pointer is in effect`);
    const small = await pg.evaluate(() => [...document.querySelectorAll("section[aria-label='My Search History'] button, section[aria-label='My Search History'] a, section[aria-label='My Search History'] summary, section[aria-label='My Search History'] select, section[aria-label='My Search History'] input:not([type=hidden]):not([type=checkbox]), main p > a[href$='/study/saved']")]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; })
      .map(e => `${((e.textContent ?? "").trim() || e.getAttribute("aria-label") || e.tagName).slice(0, 30)}=${Math.round(e.getBoundingClientRect().height)}`).slice(0, 10));
    ok(small.length === 0, `My Search History at ${tag}: every target is at least 44 px${small.length ? ` (small: ${small.join(" | ")})` : ""}`);
    await go(pg, `${S}/learn`);
    const smallFirst = await pg.evaluate(() => [...document.querySelectorAll("[data-testid='history-first-notice'] button, [data-testid='history-first-notice'] a")]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; })
      .map(e => `${(e.textContent ?? "").trim().slice(0, 30)}=${Math.round(e.getBoundingClientRect().height)}`));
    ok(smallFirst.length === 0 && await pg.locator("[data-testid='history-first-notice']").count() === 1, `the one-time notice at ${tag}: every target is at least 44 px${smallFirst.length ? ` (small: ${smallFirst.join(" | ")})` : ""}`);
    await t.close();
  }
  await touch.close();

  // ---- 11. A phone ----
  await clearChoice(B.id);
  const p = await context(browser, await cookiesFor(B.email), "B390", { width: 390, height: 844, mobile: true });
  await go(p.page, `${S}/learn`);
  await firstNoticeAt(p.page, B.id, "at 390");
  await overflow(p.page, "the one-time notice at 390");
  await p.page.screenshot({ path: join(SHOTS, "d5-first-notice-390.png") });
  await p.ctx.close();

  ok(consoleErrors.length === 0, `no application console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  ok(fivexx.length === 0, `no 5xx responses${fivexx.length ? `: ${fivexx.join(" | ")}` : ""}`);

  await clearChoice(A.id); await clearChoice(B.id);
  await db.query("delete from individual_scholar_search_history where user_id = any($1::uuid[]) and origin = 'captured' and query ~ 'walk[0-9]{6}'", [[A.id, B.id]]);
  await browser.close(); await db.end();
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  log.push(`${fails ? "RED" : "ALL PASS"} -- ${log.filter(l => l.startsWith("PASS")).length} passed, ${fails} failed`);
  writeFileSync(join(OUT, `walk-default-on-${STAMP}.log`), log.join("\n") + "\n");
  console.log(log[log.length - 1]);
  process.exit(fails ? 1 : 0);
}
async function overflow(page: Page, label: string) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
  ok(o.sw <= o.vw, `${label}: no horizontal overflow (${o.sw} <= ${o.vw})`);
}
main().catch(async e => { console.error("WALK ABORTED:", e?.message ?? e); console.log(log.join("\n")); writeFileSync(join(OUT, `walk-default-on-${STAMP}-aborted.log`), log.join("\n") + `\nABORTED ${e?.message ?? e}\n`); await db.end().catch(() => {}); process.exit(2); });
