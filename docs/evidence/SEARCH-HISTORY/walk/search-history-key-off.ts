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


// FAIL CLOSED WITH THE KEY OFF, live on staging: the key is published OFF for this script and ON again at its end.
async function setKey(v: "on" | "off") { await db.query(`update workspace_config_overrides set published = $1::jsonb, draft = $1::jsonb, updated_at = now() where scope_type = 'platform' and scope_ref = 'individual' and config_path = 'individual.policy.scholar_search_history'`, [JSON.stringify({ value: v })]); }
async function main() {
  await db.connect();
  const browser = await chromium.launch();
  const a = await context(browser, await cookiesFor(A.email), "OFF", { width: 1440, height: 1000 });
  const before = await counts(A.id);
  await setKey("off");
  try {
    await a.page.waitForTimeout(70_000); // any short policy cache expires
    const API = `${BASE}/api/individual/scholar/library/history`;
    await a.page.goto(HIST, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await a.page.waitForLoadState("networkidle").catch(() => {});
    const text = await a.page.locator("main").innerText();
    ok(/not offered here/.test(text) && (await a.page.locator('[data-testid="history-list"]').count()) === 0, "key off: the page says it is not offered and shows no list");
    const g = await a.page.request.get(API), pa = await a.page.request.patch(API, { data: { key: `lesson:${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`, pinned: true } }), d = await a.page.request.delete(`${API}?all=1&confirm=CLEAR`);
    ok(g.status() === 403 && pa.status() === 403 && d.status() === 403, `key off: GET, PATCH and clear answer 403 (${g.status()}, ${pa.status()}, ${d.status()})`);
    const p = await a.page.request.post(API, { data: { activity: "material_search", query: "key off probe", requestKey: `c:walkoff${STAMP}abcdefgh` } });
    const pj = await p.json();
    ok(p.status() === 200 && pj.kept === false && pj.reason === "off", `key off: a capture keeps nothing and shows no error (${JSON.stringify(pj)})`);
    await a.page.goto(`${BASE}/individual/scholar/study/learn`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await a.page.waitForLoadState("networkidle").catch(() => {});
    ok((await a.page.getByTestId("learn-history-link").count()) === 0 && (await a.page.locator('input[name="hk"]').count()) === 0, "key off: Learn's search has no history link and no key field");
    await a.page.goto(`${BASE}/individual/scholar/study/saved`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await a.page.waitForLoadState("networkidle").catch(() => {});
    ok((await a.page.getByTestId("library-history-link").count()) === 0, "key off: the library has no history link");
    const after = await counts(A.id);
    ok(after.captured === before.captured && after.hidden === before.hidden, "key off: no history row was written or changed");
  } finally { await setKey("on"); }
  await browser.close(); await db.end();
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  log.push(`${fails ? "RED" : "ALL PASS"} -- ${log.filter(l => l.startsWith("PASS")).length} passed, ${fails} failed`);
  writeFileSync(join(OUT, `walk-key-off-${STAMP}.log`), log.join("\n") + "\n");
  console.log(log[log.length - 1]);
  process.exit(fails ? 1 : 0);
}
main().catch(async e => { console.error("ABORTED:", e?.message ?? e); await setKey("on").catch(() => {}); await db.end().catch(() => {}); process.exit(2); });
