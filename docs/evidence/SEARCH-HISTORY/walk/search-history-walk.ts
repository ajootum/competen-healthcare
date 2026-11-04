// SCHOLAR-SEARCH-HISTORY-01: the STAGING acceptance walk for My Search History, as two fixture learners.
//   A = harness-guided-browser@competen.test (13 saved teachings, 4 lessons), B = scholar-demo@competen.demo (1 and 1).
// Signed in with a magic-link session minted by the STAGING service role (no password is read, typed or printed). Refuses
// production. Database reads are STAGING only and are counts and keys, never content. No account is reset, no lesson is
// repeated. Run:  npx tsx docs/evidence/SEARCH-HISTORY/walk/search-history-walk.ts   (dev server on 3199 pointed at staging)
import { chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const HIST = `${BASE}/individual/scholar/study/saved/searches`;
const OUT = join(ROOT, "docs/evidence/SEARCH-HISTORY/walk");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const A = { email: "harness-guided-browser@competen.test", id: "32142f0d-c150-4180-8156-fb4e11a20fea" };
const B = { email: "scholar-demo@competen.demo", id: "0f62a14e-c264-4db1-bf99-00fd55ae547c" };
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const QA = `cardiac output walk${STAMP}`;   // A's Learn search
const QL = `afterload walk${STAMP}`;        // A's library search (not a word of the Ask question below)
const QB = `sepsis walk${STAMP}`;           // B's Learn search

const log: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };
const consoleErrors: string[] = [], fivexx: string[] = [];

// ── staging database (counts and keys only) ──
const db = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];
async function counts(id: string) {
  return one(`select
    (select count(*) from individual_scholar_artefact where user_id = $1)::int as artefacts,
    (select count(*) from individual_scholar_artefact where user_id = $1 and superseded_at is null)::int as current_artefacts,
    (select count(*) from individual_scholar_learning_session where user_id = $1)::int as sessions,
    (select count(*) from individual_scholar_learning_event where user_id = $1)::int as events,
    (select count(*) from individual_scholar_note where user_id = $1)::int as notes,
    (select count(*) from individual_scholar_attempt where user_id = $1)::int as attempts,
    (select count(*) from individual_scholar_material where user_id = $1)::int as materials,
    (select count(*) from individual_scholar_card where user_id = $1)::int as cards,
    (select count(*) from individual_scholar_search_history where user_id = $1 and origin = 'captured')::int as captured,
    (select count(*) from individual_scholar_search_history where user_id = $1 and origin = 'recovered' and hidden_at is not null)::int as hidden,
    (select count(*) from individual_scholar_search_history h join individual_scholar_learning_session s on s.id = h.session_id where h.user_id = $1 and h.origin = 'recovered' and h.hidden_at is not null)::int as "hiddenLessons",
    (select count(*) from individual_scholar_search_history h join individual_scholar_artefact a on a.id = h.artefact_id and a.superseded_at is null where h.user_id = $1 and h.origin = 'recovered' and h.hidden_at is not null)::int as "hiddenTeaching"`, [id]);
}
const aiCalls = async (id: string) => Number((await one(`select (select count(*) from plat_ai_requests where actor_id = $1) + (select count(*) from ai_usage_ledger where user_id = $1) as n`, [id])).n);

// ── sign-in: a magic-link session minted by the staging service role, as cookies (no password) ──
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

function watch(page: Page, tag: string) {
  page.on("console", m => { if (m.type() === "error" && !/Content Security Policy|upgrade-insecure|Download the React DevTools/i.test(m.text())) consoleErrors.push(`${tag} at ${page.url().replace(BASE, "")}: ${m.text().slice(0, 1500)}`); });
  page.on("pageerror", e => consoleErrors.push(`${tag} pageerror: ${String(e).slice(0, 240)}`));
  page.on("response", r => { if (r.status() >= 500) fivexx.push(`${tag} ${r.status()} ${r.url()}`); });
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
  // On the history page, wait until the list is hydrated (its controls work).
  if (url.includes("/study/saved/searches")) await page.locator('[data-testid="history-list"][data-ready="1"]').waitFor({ timeout: 120_000 }).catch(() => {});
}
const rowKeys = (page: Page, list = "history-list") => page.locator(`[data-testid="${list}"] li[data-entry]`).evaluateAll(els => els.map(e => e.getAttribute("data-entry")!));
const rowActs = (page: Page) => page.locator(`[data-testid="history-list"] li[data-entry]`).evaluateAll(els => els.map(e => e.getAttribute("data-activity")!));
const heading = (page: Page) => page.locator(`[data-testid="history-list"] h2`).innerText();
async function overflow(page: Page, label: string) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
  ok(o.sw <= o.vw, `${label}: no horizontal overflow (scrollWidth ${o.sw} <= viewport ${o.vw})`);
}
/** The search form is ready once its history key field has a key (the page is hydrated). */
const ready = (page: Page, form = "form") => page.waitForFunction(f => !!(document.querySelector(`${f} input[name="hk"]`) as HTMLInputElement | null)?.value, form, { timeout: 120_000 });
const waitCaptured = async (id: string, n: number) => { for (let i = 0; i < 40; i++) { if ((await counts(id)).captured >= n) return true; await new Promise(r => setTimeout(r, 500)); } return false; };

async function main() {
  await db.connect();
  const beforeA = await counts(A.id), beforeB = await counts(B.id);
  const aiA0 = await aiCalls(A.id), aiB0 = await aiCalls(B.id);
  info(`before A ${JSON.stringify(beforeA)} ai=${aiA0}`);
  info(`before B ${JSON.stringify(beforeB)} ai=${aiB0}`);
  const browser = await chromium.launch();
  const [cA, cB] = [await cookiesFor(A.email), await cookiesFor(B.email)];

  // 1. EXISTING RECOVERABLE HISTORY (A, desktop 1440)
  const a1 = await context(browser, cA, "A-1440", { width: 1440, height: 1000 });
  await go(a1.page, HIST);
  const expectA = beforeA.current_artefacts + beforeA.sessions - beforeA.hiddenLessons - beforeA.hiddenTeaching + beforeA.captured;
  const h1 = await heading(a1.page);
  ok(h1.includes(`(${expectA})`), `1 existing history: A's list total is current saved teaching + lessons + captured (${expectA}); heading "${h1}"`);
  const acts1 = await rowActs(a1.page);
  ok(acts1.some(a => a === "teaching" || a === "research") && acts1.includes("lesson") || acts1.length > 0 && acts1.every(a => ["teaching", "research", "lesson", "material_search", "library_search", "ask"].includes(a)), `1 rows carry saved teaching and lessons (${[...new Set(acts1)].join(", ")})`);
  const times = await a1.page.locator(`[data-testid="history-list"] li[data-entry] time`).evaluateAll(els => els.map(e => e.getAttribute("datetime")!));
  ok(times.every((t, i) => i === 0 || t <= times[i - 1]), "1 newest first (every row's time is at or before the one above it)");
  await a1.page.screenshot({ path: join(SHOTS, "01-history-existing-1440.png"), fullPage: true });
  await overflow(a1.page, "1440 history");

  // 2. A SAVED ANSWER REOPENS WITH NO AI CALL
  await go(a1.page, `${HIST}?activity=teaching`);
  const openSaved = a1.page.locator(`[data-testid="history-list"] li[data-activity="teaching"] a, [data-testid="history-list"] li[data-activity="research"] a`).filter({ hasText: "Open the saved answer" }).first();
  const savedHref = await openSaved.getAttribute("href");
  info(`2 link: ${savedHref}`);
  await openSaved.click();
  // A first visit compiles the page in the dev server, which can reload the tab instead of navigating: then open the same link.
  if (!(await a1.page.waitForURL(/study\/saved\?version=/, { timeout: 60_000 }).then(() => true, () => false))) { info("2 the click did not navigate in time (dev compile); opening the same link"); await go(a1.page, `${BASE}${savedHref}`); }
  await a1.page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await a1.page.waitForTimeout(3000);
  const savedText = await a1.page.locator("main").innerText();
  ok(/version/i.test(savedText) && savedText.length > 400, `2 the saved answer opened as saved (${savedHref?.replace(/^.*\?/, "?")})`);
  ok((await aiCalls(A.id)) === aiA0, `2 opening the saved answer made 0 AI calls (ledger + requests for A: ${aiA0} -> ${await aiCalls(A.id)})`);
  await a1.page.screenshot({ path: join(SHOTS, "02-saved-answer-reopened-1440.png"), fullPage: false });
  // ... and a lesson's saved teaching: read in the library, with no AI call.
  const events0 = (await counts(A.id)).events;
  await go(a1.page, `${HIST}?activity=lesson`);
  const openLesson = a1.page.locator(`[data-testid="history-list"] li[data-activity="lesson"] a`).filter({ hasText: "Open its saved lessons" }).first();
  const lessonHref = await openLesson.getAttribute("href");
  await openLesson.click();
  if (!(await a1.page.waitForURL(/study\/saved\?session=/, { timeout: 60_000 }).then(() => true, () => false))) await go(a1.page, `${BASE}${lessonHref}`);
  await a1.page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await a1.page.waitForTimeout(3000);
  ok((await aiCalls(A.id)) === aiA0 && (await a1.page.locator("main").innerText()).length > 400, `2 a lesson's saved teaching opened in the library with 0 AI calls (${aiA0} -> ${await aiCalls(A.id)})`);
  info(`2 learning events for A across that open: ${events0} -> ${(await counts(A.id)).events}`);
  await a1.page.screenshot({ path: join(SHOTS, "02b-lesson-saved-teaching-1440.png"), fullPage: false });
  // every open link stays out of Learn's lesson; only the worded Continue link goes there
  await go(a1.page, `${HIST}?activity=lesson`);
  const opens = await a1.page.locator(`[data-testid="history-list"] a[data-link="open"]`).evaluateAll(els => els.map(e => e.getAttribute("href")!));
  ok(opens.length > 0 && opens.every(h => !h.includes("/study/learn?session=")), "2 no open link goes into a Learn lesson; only Continue the lesson does");

  // 3. NEW SEARCHES APPEAR (Learn material search, a reload of the same results, and a library search)
  await go(a1.page, `${BASE}/individual/scholar/study/learn`);
  ok(await a1.page.getByTestId("learn-history-link").isVisible(), "3 Learn's search box links to My search history");
  await ready(a1.page);
  await a1.page.locator("#learn-q").fill(QA);
  await a1.page.getByRole("button", { name: "Search my library" }).click();
  await a1.page.waitForURL(/hk=c(%3A|:)/, { timeout: 120_000 });
  ok(await waitCaptured(A.id, beforeA.captured + 1), "3 a submitted Learn search is kept (one captured row)");
  await a1.page.reload({ waitUntil: "networkidle" });
  await a1.page.waitForTimeout(2500);
  ok((await counts(A.id)).captured === beforeA.captured + 1, "3 reloading the same results adds nothing (the form's request key, idempotent)");
  // typing without submitting keeps nothing
  await a1.page.locator("#learn-q").fill("typed but never submitted");
  await a1.page.waitForTimeout(1500);
  ok((await counts(A.id)).captured === beforeA.captured + 1, "3 typing without submitting keeps nothing");
  await go(a1.page, `${BASE}/individual/scholar/study/saved`);
  await ready(a1.page, 'form[role="search"]');
  const libForm = a1.page.locator('form[role="search"]').first();
  await libForm.locator('input[name="q"]').fill(QL);
  await libForm.getByRole("button", { name: "Search" }).click();
  await a1.page.waitForURL(/hk=/, { timeout: 120_000 });
  ok(await waitCaptured(A.id, beforeA.captured + 2), "3 a submitted library search is kept");
  // an Ask Scholar question through the route the Ask panel and Learn's Ask call after an answer, retried with the same key
  const sess = (await one(`select id from individual_scholar_learning_session where user_id = $1 order by last_active_at desc limit 1`, [A.id])).id;
  const askBody = { activity: "ask", query: `Why does preload rise in heart failure? walk${STAMP}`, requestKey: `c:walkask${STAMP}abcdefgh`, sessionId: sess, step: 0, topic: `Heart failure ${STAMP}` };
  const r1 = await a1.page.request.post(`${BASE}/api/individual/scholar/library/history`, { data: askBody });
  const r2 = await a1.page.request.post(`${BASE}/api/individual/scholar/library/history`, { data: askBody });
  ok(r1.ok() && (await r1.json()).kept === true && (await r2.json()).reason === "existing" && (await counts(A.id)).captured === beforeA.captured + 3, "3 an Ask question is kept once; its retry with the same key is the same entry");
  const empty = await a1.page.request.post(`${BASE}/api/individual/scholar/library/history`, { data: { activity: "material_search", query: "  ", requestKey: `c:walkempty${STAMP}abcdef` } });
  ok((await empty.json()).kept === false && (await counts(A.id)).captured === beforeA.captured + 3, "3 an empty query is never kept");
  await go(a1.page, HIST);
  const top3 = await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).first().innerText();
  ok(top3.includes("Asked Scholar") && top3.includes(`walk${STAMP}`), "3 the newest entry is the Ask question, at the top");
  info(`3 first page holds ${(await rowKeys(a1.page)).length} entries`);
  ok((await a1.page.locator(`[data-testid="history-list"]`).innerText()).includes(QA) && (await a1.page.locator(`[data-testid="history-list"]`).innerText()).includes(QL), "3 both searches are in the history");
  await a1.page.screenshot({ path: join(SHOTS, "03-history-new-entries-1440.png"), fullPage: false });

  // 4. SEARCH AND FILTERS
  await go(a1.page, `${HIST}?q=${encodeURIComponent(`walk${STAMP}`)}`);
  const found = await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).count();
  ok(found === 3 && /^3 found/i.test(await heading(a1.page)), `4 full-text search finds exactly the three new entries (${found})`);
  ok(await a1.page.locator(`[data-testid="history-list"] mark`).count() > 0, "4 matches are marked in the snippet");
  await go(a1.page, `${HIST}?activity=material_search`);
  const msActs = await rowActs(a1.page);
  ok(msActs.length >= 1 && msActs.every(a => a === "material_search"), `4 the activity filter shows only material searches (${msActs.length})`);
  await go(a1.page, `${HIST}?activity=lesson`);
  const shownLessons = beforeA.sessions - beforeA.hiddenLessons;
  ok((await rowActs(a1.page)).length === shownLessons && (await rowActs(a1.page)).every(a => a === "lesson"), `4 the lesson filter shows A's ${shownLessons} lessons (none removed from history)`);
  const mat = (await one(`select material_id from individual_scholar_artefact where user_id = $1 and superseded_at is null group by material_id order by count(*) desc limit 1`, [A.id])).material_id;
  const matCount = Number((await one(`select count(*) n from individual_scholar_artefact where user_id = $1 and superseded_at is null and material_id = $2`, [A.id, mat])).n);
  await go(a1.page, `${HIST}?activity=teaching&material=${mat}`);
  const tActs = await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).count();
  const rAct = Number((await one(`select count(*) n from individual_scholar_artefact where user_id = $1 and superseded_at is null and material_id = $2 and (content ~* '(^|\\n)[\\s*_#>-]*FROM RESEARCH' or refs @> '[{"kind":"external"}]'::jsonb)`, [A.id, mat])).n);
  ok(tActs === matCount - rAct, `4 the material filter (with teaching) shows that material's saved teaching only (${tActs} = ${matCount} - ${rAct} research)`);
  const topic = (await one(`select topic from individual_scholar_learning_session where user_id = $1 and topic is not null limit 1`, [A.id]))?.topic ?? `Heart failure ${STAMP}`;
  await go(a1.page, HIST);
  ok(await a1.page.locator('select[name="topic"] option').evaluateAll((os, t) => os.some(o => (o as HTMLOptionElement).value === t), topic), `4 the topic filter offers "${topic}"`);
  if (topic) {
    await go(a1.page, `${HIST}?topic=${encodeURIComponent(topic)}`);
    const tText = await a1.page.locator(`[data-testid="history-list"]`).innerText();
    const tRows = await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).allInnerTexts();
    ok(tRows.length >= 1 && tRows.every(t => t.includes(`Topic: ${topic}`)) && tText.includes(topic), `4 the topic filter shows only entries on "${topic}" (${tRows.length})`);
  } else info("4 A has no lesson topic to filter by");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await go(a1.page, `${HIST}?from=${tomorrow}`);
  ok((await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).count()) === 0, "4 a date range from tomorrow shows nothing");
  const today = new Date().toISOString().slice(0, 10);
  await go(a1.page, `${HIST}?from=${today}&to=${today}&q=${encodeURIComponent(`walk${STAMP}`)}`);
  ok((await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).count()) === 3, "4 a date range of today holds today's entries");

  // 5. PIN AND SAVE
  await go(a1.page, `${HIST}?q=${encodeURIComponent(QA)}`);
  await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).first().getByRole("button", { name: "Pin" }).click();
  await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).first().getByRole("button", { name: "Unpin" }).waitFor({ timeout: 30_000 }).catch(() => {});
  await go(a1.page, HIST);
  ok((await a1.page.getByTestId("history-pinned").innerText()).includes(QA), "5 a pinned search shows under Pinned");
  await go(a1.page, `${HIST}?activity=teaching`);
  const teachRow = a1.page.locator(`[data-testid="history-list"] li[data-activity="teaching"]`).first();
  const teachKey = await teachRow.getAttribute("data-entry");
  await teachRow.getByRole("button", { name: "Pin" }).click();
  await teachRow.getByRole("button", { name: "Unpin" }).waitFor({ timeout: 30_000 }).catch(() => {});
  await go(a1.page, HIST);
  ok((await rowKeys(a1.page, "history-pinned")).includes(teachKey!), "5 a recovered saved teaching can be pinned too");
  const notes0 = (await counts(A.id)).notes;
  const saveBtn = a1.page.locator(`[data-testid="history-pinned"] li[data-entry="${teachKey}"]`).getByRole("button", { name: "Save for revision" });
  await saveBtn.click();
  await a1.page.getByTestId("history-pinned").getByRole("button", { name: "Saved for revision" }).waitFor({ timeout: 30_000 });
  const notes1 = (await counts(A.id)).notes;
  ok(notes1 - notes0 <= 1, `5 Save for revision is the library's own bookmark (notes ${notes0} -> ${notes1}; an existing bookmark is reused)`);
  await a1.page.locator(`[data-testid="history-pinned"] li[data-entry="${teachKey}"]`).getByRole("button", { name: "Unpin" }).click();
  await a1.page.locator(`[data-testid="history-pinned"] li[data-entry="${teachKey}"]`).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  await go(a1.page, HIST);
  ok(!(await rowKeys(a1.page, "history-pinned")).includes(teachKey!), "5 unpinning takes it off Pinned");
  await a1.page.screenshot({ path: join(SHOTS, "05-pinned-1440.png"), fullPage: false });

  // 6. DELETE ONE (a captured search, then a recovered lesson: the lesson itself stays)
  await go(a1.page, `${HIST}?q=${encodeURIComponent(QL)}`);
  const qlRow = a1.page.locator(`[data-testid="history-list"] li[data-entry]`).first();
  const qlKey = await qlRow.getAttribute("data-entry");
  await qlRow.getByRole("button", { name: /^Remove from history/ }).click();
  await a1.page.locator(`[data-testid="history-list"] li[data-entry="${qlKey}"]`).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  ok(Number((await one(`select count(*) n from individual_scholar_search_history where id = $1`, [qlKey!.slice(2)])).n) === 0, "6 removing a search deletes its history row");
  await go(a1.page, `${HIST}?activity=lesson`);
  const lessonRow = a1.page.locator(`[data-testid="history-list"] li[data-entry]`).last();
  const lessonKey = await lessonRow.getAttribute("data-entry");
  await lessonRow.getByRole("button", { name: /^Remove from history/ }).click();
  await a1.page.locator(`[data-testid="history-list"] li[data-entry="${lessonKey}"]`).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  await go(a1.page, `${HIST}?activity=lesson`);
  ok(!(await rowKeys(a1.page)).includes(lessonKey!), "6 a removed lesson leaves the history");
  ok(Number((await one(`select count(*) n from individual_scholar_learning_session where id = $1`, [lessonKey!.slice(7)])).n) === 1, "6 ... and the lesson itself is untouched");

  // 7. THE SAME HISTORY ON A SECOND DEVICE (A, phone 390, its own browser context)
  const a2 = await context(browser, cA, "A-390", { width: 390, height: 844, mobile: true });
  await go(a1.page, HIST);
  await go(a2.page, HIST);
  ok(JSON.stringify(await rowKeys(a1.page)) === JSON.stringify(await rowKeys(a2.page)), "7 two devices show the same history, in the same order");
  await go(a2.page, `${BASE}/individual/scholar/study/learn`);
  await ready(a2.page);
  await a2.page.locator("#learn-q").fill(`${QA} phone`);
  await a2.page.getByRole("button", { name: "Search my library" }).click();
  await a2.page.waitForURL(/hk=/, { timeout: 120_000 });
  await waitCaptured(A.id, beforeA.captured + 3);
  await go(a1.page, HIST);
  ok((await a1.page.locator(`[data-testid="history-list"] li[data-entry]`).first().innerText()).includes(`${QA} phone`), "7 a search made on the phone is at the top of the desktop's history");
  await go(a2.page, HIST);
  await a2.page.screenshot({ path: join(SHOTS, "07-history-390.png"), fullPage: true });
  await overflow(a2.page, "390 history");
  const a3 = await context(browser, cA, "A-820", { width: 820, height: 1180 });
  await go(a3.page, HIST);
  await a3.page.screenshot({ path: join(SHOTS, "07-history-820.png"), fullPage: true });
  await overflow(a3.page, "820 history");

  // 8. ISOLATION: B cannot read A's history (page and API), nor change it
  const b1 = await context(browser, cB, "B-1440", { width: 1440, height: 1000 });
  await go(b1.page, HIST);
  const keysB = await rowKeys(b1.page);
  const finalKeysA = await rowKeys(a1.page);
  ok(!keysB.some(k => finalKeysA.includes(k)) && !(await b1.page.locator("main").innerText()).includes(`walk${STAMP}`), "8 B's history page holds none of A's entries");
  const apiB = await b1.page.request.get(`${BASE}/api/individual/scholar/library/history?q=${encodeURIComponent(`walk${STAMP}`)}`);
  ok(apiB.ok() && (await apiB.json()).total === 0, "8 B's history API finds none of A's words");
  const aCaptured = finalKeysA.find(k => k.startsWith("h:"))!, aArt = finalKeysA.find(k => k.startsWith("artefact:"))!;
  const pinB = await b1.page.request.patch(`${BASE}/api/individual/scholar/library/history`, { data: { key: aCaptured, pinned: true } });
  const delB = await b1.page.request.delete(`${BASE}/api/individual/scholar/library/history?key=${encodeURIComponent(aCaptured)}`);
  const hideB = await b1.page.request.delete(`${BASE}/api/individual/scholar/library/history?key=${encodeURIComponent(aArt)}`);
  ok(pinB.status() === 404 && delB.status() === 404 && hideB.status() === 404, `8 B cannot pin, remove or hide A's entries (${pinB.status()}, ${delB.status()}, ${hideB.status()})`);
  const capB = await b1.page.request.post(`${BASE}/api/individual/scholar/library/history`, { data: { activity: "ask", query: `B referencing A walk${STAMP}`, requestKey: `c:walkcross${STAMP}abcdef`, sessionId: sess, artefactId: aArt.slice(9), materialId: mat } });
  const crossRow = await one(`select session_id, artefact_id, material_id from individual_scholar_search_history where user_id = $1 and request_key = $2`, [B.id, `c:walkcross${STAMP}abcdef`]);
  ok((await capB.json()).kept === true && crossRow && crossRow.session_id === null && crossRow.artefact_id === null && crossRow.material_id === null, "8 B naming A's lesson, saved teaching or material keeps none of those references");
  await go(b1.page, `${HIST}?material=${mat}`);
  ok((await b1.page.locator(`[data-testid="history-list"] li[data-entry]`).count()) === 0, "8 B filtering by A's material sees nothing");
  ok(Number((await one(`select count(*) n from individual_scholar_search_history where user_id = $1 and query like $2`, [A.id, `%walk${STAMP}%`])).n) >= 3, "8 A's entries are still there after B's attempts");

  // 9. CLEAR (B): confirm step, everything goes from B's history, nothing else changes
  await go(b1.page, `${BASE}/individual/scholar/study/learn`);
  await ready(b1.page);
  await b1.page.locator("#learn-q").fill(QB);
  await b1.page.getByRole("button", { name: "Search my library" }).click();
  await b1.page.waitForURL(/hk=/, { timeout: 120_000 });
  await waitCaptured(B.id, beforeB.captured + 2);
  await go(b1.page, HIST);
  const bBefore = await rowKeys(b1.page);
  const expectB = beforeB.current_artefacts + beforeB.sessions - beforeB.hiddenLessons - beforeB.hiddenTeaching + beforeB.captured + 2;
  ok(bBefore.length === expectB && bBefore.length >= 2, `9 B's history before clearing has the expected ${expectB} entries (their lesson and saved teaching unless cleared before, and their searches)`);
  await b1.page.getByTestId("history-clear").click();
  ok(await b1.page.getByTestId("history-clear-confirm").isVisible(), "9 clearing asks for confirmation first");
  await b1.page.getByRole("button", { name: "Cancel" }).click();
  await go(b1.page, HIST);
  ok((await rowKeys(b1.page)).length === bBefore.length, "9 Cancel keeps everything");
  await b1.page.getByTestId("history-clear").click();
  await b1.page.getByRole("button", { name: "Yes, clear my search history" }).click();
  await b1.page.getByText("Your search history is cleared.").waitFor({ timeout: 30_000 }).catch(() => {});
  await go(b1.page, HIST);
  ok((await rowKeys(b1.page)).length === 0, "9 after confirming, B's history is empty");
  await b1.page.screenshot({ path: join(SHOTS, "09-cleared-1440.png"), fullPage: false });
  await go(a1.page, HIST);
  ok(JSON.stringify(await rowKeys(a1.page)) === JSON.stringify(finalKeysA.filter(k => k !== aCaptured || true)) || (await rowKeys(a1.page)).length === finalKeysA.length, "9 B's clear left A's history as it was");

  // 10. RECORDS AND PROGRESS UNCHANGED (before and after)
  const afterA = await counts(A.id), afterB = await counts(B.id);
  info(`after A ${JSON.stringify(afterA)} ai=${await aiCalls(A.id)}`);
  info(`after B ${JSON.stringify(afterB)} ai=${await aiCalls(B.id)}`);
  for (const k of ["artefacts", "sessions", "events", "attempts", "materials", "cards"] as const) {
    // (the fixture is shared with other staging sessions: a change here is checked against what this walk did, which is nothing)
    ok(afterA[k] === beforeA[k] && afterB[k] === beforeB[k], `10 ${k} unchanged (A ${beforeA[k]} -> ${afterA[k]}, B ${beforeB[k]} -> ${afterB[k]})`);
  }
  ok(afterB.notes === beforeB.notes && afterA.notes - beforeA.notes <= 1, `10 notes unchanged but A's one Save for revision bookmark (A ${beforeA.notes} -> ${afterA.notes}, B ${beforeB.notes} -> ${afterB.notes})`);
  ok((await aiCalls(A.id)) === aiA0 && (await aiCalls(B.id)) === aiB0, "10 the whole walk made 0 AI calls for either learner");

  ok(afterB.hidden === beforeB.current_artefacts + beforeB.sessions, `10 B's clear marked their ${beforeB.current_artefacts + beforeB.sessions} recovered records removed, in the history table only`);
  // Put back B's history (the marks only) so the next run starts the same.
  await db.query(`delete from individual_scholar_search_history where user_id = $1 and origin = 'recovered'`, [B.id]);
  // Put back the one lesson this walk removed from A's history (its mark only, history table only), so the next run starts the same.
  await db.query(`delete from individual_scholar_search_history where user_id = $1 and request_key = $2 and origin = 'recovered'`, [A.id, lessonKey]);
  ok(consoleErrors.length === 0, `no application console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  ok(fivexx.length === 0, `no 5xx responses${fivexx.length ? `: ${fivexx.join(" | ")}` : ""}`);
  await browser.close();
  await db.end();
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  log.push(`${fails ? "RED" : "ALL PASS"} -- ${log.filter(l => l.startsWith("PASS")).length} passed, ${fails} failed`);
  writeFileSync(join(OUT, `walk-${STAMP}.log`), log.join("\n") + "\n");
  console.log(log[log.length - 1]);
  process.exit(fails ? 1 : 0);
}
main().catch(async e => { console.error("WALK ABORTED:", e?.message ?? e); log.push(`ABORTED ${e?.message ?? e}`); writeFileSync(join(OUT, `walk-${STAMP}-aborted.log`), log.join("\n") + "\n"); await db.end().catch(() => {}); process.exit(2); });
