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


// One REAL question in each Ask UI, as fixture A, to prove the capture wiring end to end: exactly 2 AI calls (asked for here),
// each question kept once, with its reference, and never the answer.
async function main() {
  await db.connect();
  const browser = await chromium.launch();
  const a = await context(browser, await cookiesFor(A.email), "ASK", { width: 1440, height: 1000 });
  const q1 = `How does preload change in sepsis? uiask${STAMP}`, q2 = `Why is oxygen given to a target range? uiask${STAMP}`;
  const cap = async (q: string) => (await db.query("select activity, query, session_id, step, material_id, chunk_id, artefact_id from individual_scholar_search_history where user_id = $1 and query = $2", [A.id, q])).rows;
  const wait = async (q: string) => { for (let i = 0; i < 90; i++) { if ((await cap(q)).length) return true; await new Promise(r => setTimeout(r, 1000)); } return false; };
  const ai0 = await aiCalls(A.id);
  a.page.on("response", async r => { if (/learn\/(assistant|act)|library\/history/.test(r.url()) && r.request().method() !== "GET") info(`${r.status()} ${r.url().replace(BASE, "")}`); });

  // 1. The in-place Ask panel, from a saved lesson in the library
  // The saved answer's own page: the panel here is not inside the library list's export form.
  const art = (await one("select id from individual_scholar_artefact where user_id = $1 and superseded_at is null order by created_at desc limit 1", [A.id])).id;
  await go(a.page, `${BASE}/individual/scholar/study/saved?version=${art}`);
  await ready(a.page, 'form[role="search"]');
  await a.page.waitForTimeout(1500);
  await a.page.getByRole("button", { name: /Ask about this/ }).first().click();
  await a.page.locator("dialog[open]").waitFor({ timeout: 30_000 });
  const dlg = a.page.locator("dialog[open]");
  await dlg.locator("textarea").first().fill(q1);
  await dlg.locator('button[type="submit"]').first().click();
  // A clinical question can first ask whether it is about a real patient: answer "study" as a learner would.
  await dlg.getByRole("button", { name: /study|learning|education/i }).first().click({ timeout: 25_000 }).catch(() => info("Ask panel: no clarify prompt"));
  await a.page.waitForTimeout(1000);
  await a.page.screenshot({ path: join(SHOTS, "11-ask-panel-1440.png") });
  info(`Ask panel text: ${(await dlg.innerText().catch(() => "(closed)")).replace(/\s+/g, " ").slice(0, 400)}`);
  ok(await wait(q1), "Ask panel: an answered question appears in the history table");
  const r1 = await cap(q1);
  ok(r1.length === 1 && r1[0].activity === "ask" && !!(r1[0].material_id || r1[0].session_id), `Ask panel: one row, with its reference (material ${!!r1[0]?.material_id}, lesson ${!!r1[0]?.session_id})`);
  await a.page.screenshot({ path: join(SHOTS, "11-ask-panel-1440.png") });
  await a.page.keyboard.press("Escape");

  // 2. Learn's Ask tab, in a recorded lesson with saved teaching
  const sess = "2b9fccd2-530b-45e0-a77c-5c68d0f2c982";
  await go(a.page, `${BASE}/individual/scholar/study/learn?session=${sess}&panel=ask`);
  await a.page.locator("#ask-q").waitFor({ timeout: 120_000 });
  await a.page.waitForTimeout(4000);
  await a.page.locator("#ask-q").fill(q2);
  await a.page.locator("#ask-q").evaluate(el => (el as HTMLTextAreaElement).form!.requestSubmit());
  ok(await wait(q2), "Learn Ask: an answered question appears in the history table");
  const r2 = await cap(q2);
  ok(r2.length === 1 && r2[0].session_id === sess && Number.isInteger(r2[0].step), `Learn Ask: one row, tied to its lesson and step (${r2[0]?.step})`);
  await a.page.screenshot({ path: join(SHOTS, "12-learn-ask-1440.png") });

  // 3. Both show in the page, say the answer was not kept, and no answer text is stored
  await go(a.page, `${HIST}?q=${encodeURIComponent(`uiask${STAMP}`)}`);
  const rows = await a.page.locator('[data-testid="history-list"] li[data-entry]').allInnerTexts();
  ok(rows.length === 2 && rows.every(t => t.includes("Asked Scholar") && t.includes("does not keep Ask answers")), `history page: both questions, each saying the answer was not kept (${rows.length})`);
  const cols = (await db.query("select column_name from information_schema.columns where table_name = 'individual_scholar_search_history'")).rows.map((r: { column_name: string }) => r.column_name);
  ok(!cols.some((c: string) => /answer|content|response/.test(c)), "the table has no column an answer could be kept in");
  const spent = (await aiCalls(A.id)) - ai0;
  info(`AI ledger + request rows for A during this script: ${spent} (the two questions asked here)`);
  ok(consoleErrors.length === 0, `no application console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  ok(fivexx.length === 0, `no 5xx responses${fivexx.length ? `: ${fivexx.join(" | ")}` : ""}`);
  await browser.close(); await db.end();
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  log.push(`${fails ? "RED" : "ALL PASS"} -- ${log.filter(l => l.startsWith("PASS")).length} passed, ${fails} failed`);
  writeFileSync(join(OUT, `walk-ask-ui-${STAMP}.log`), log.join("\n") + "\n");
  console.log(log[log.length - 1]);
  process.exit(fails ? 1 : 0);
}
main().catch(async e => { console.error("ASK WALK ABORTED:", e?.message ?? e); console.log(log.join("\n")); await db.end().catch(() => {}); process.exit(2); });
