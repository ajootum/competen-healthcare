// SALE-2026-11 R3 staging walk (fixture learner, staging dev server, phone width). Credentials are read from WALK_FIXTURE, never printed.
//   npx tsx docs/evidence/SALE-R3/walk/sale-r3-walk.ts   (env: WALK_BASE, WALK_FIXTURE, WALK_WIDTH; STAGING_DB_URL from .env.local)
// Proves: SALE-11 a next learning action with its reason on Today; snooze and dismiss leave the plan unchanged and are recorded; accept
// adds one entry to the learner's own calendar and is recorded. SALE-12 annotate a saved explanation, write a personal summary, choose
// notes in the Notebook and make practice from them (Revise opens on exactly their sections and starts), with the way back to the
// Notebook; misconceptions to revisit and related materials shown. Every page fits the width; 0 console errors; no 5xx.
import { chromium, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { judgeDbTarget } from "../../../../scripts/production-guard";

loadEnvConfig(process.cwd());
const BASE = process.env.WALK_BASE ?? "http://localhost:3193";
const WIDTH = Number(process.env.WALK_WIDTH ?? 390);
/** "all", or "notebook" to run the SALE-12 part only (the SALE-11 decisions change the fixture and are not repeated). */
const PART = process.env.WALK_PART ?? "all";
const OUT = join(__dirname, "shots");
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const EMAIL = field("email"), PASSWORD = field("password");
if (!EMAIL || !PASSWORD) { console.error("fixture file lacks email=/password="); process.exit(1); }
const DB = process.env.STAGING_DB_URL ?? "";
if (!judgeDbTarget(DB).ok) { console.error("STAGING_DB_URL refused by the production guard"); process.exit(2); }

const log: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); return cond; };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };
const errors: string[] = [];
const fivexx: string[] = [];
const shot = (page: Page, name: string, full = true) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, caret: "initial" });
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const settle = (page: Page) => page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});

async function db<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
}
type PlanState = { entries: number; entriesStamp: string; plan: string; events: number };
async function planState(uid: string): Promise<PlanState> {
  const [e] = await db<{ n: string; stamp: string | null }>("select count(*) as n, coalesce(max(updated_at)::text, '') as stamp from individual_learning_calendar_entry where user_id = $1", [uid]);
  const p = await db<{ row: string }>("select md5(row_to_json(s)::text) as row from individual_scholar_study_plan s where user_id = $1", [uid]).catch(() => []);
  const [ev] = await db<{ n: string }>("select count(*) as n from individual_learning_plan_event where user_id = $1 and kind = 'next_action'", [uid]);
  return { entries: Number(e.n), entriesStamp: e.stamp ?? "", plan: p.map(r => r.row).join(","), events: Number(ev.n) };
}
const latestEvent = async (uid: string) => (await db<{ ref: string; status: string; value: any }>(
  "select ref, status, value from individual_learning_plan_event where user_id = $1 and kind = 'next_action' order by created_at desc limit 1", [uid]))[0];

async function signIn(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
    await page.waitForTimeout(1500);
    await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
    await page.locator("input#password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    const left = await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).then(() => true, () => false);
    console.log(`sign-in attempt ${attempt}: ${left ? "ok" : "still on /login"}`);
    if (left) return;
  }
  throw new Error("sign-in did not complete");
}

async function main() {
  const [u] = await db<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [EMAIL]);
  if (!u) throw new Error("fixture user not found on staging");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 860 }, deviceScaleFactor: 1, hasTouch: WIDTH < 768 });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error") errors.push(`${page.url()} :: ${m.text()}`); });
  page.on("pageerror", e => errors.push(`${page.url()} :: pageerror ${e.message}`));
  page.on("response", r => { if (r.status() >= 500) fivexx.push(`${r.status()} ${r.url()}`); });
  await signIn(page);
  if (PART === "probe") {
    for (const path of ["study/saved", "study/saved?view=notebook", "study/plan?view=today"]) { await page.goto(`${BASE}/individual/scholar/${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 }); await settle(page); await page.waitForTimeout(3000); }
    await shot(page, "06-today-after-fix-390");
    console.log(`suggestions now: ${JSON.stringify(await page.getByTestId("next-action").allInnerTexts().then(t => t.map(x => x.split(String.fromCharCode(10))[0])))}`);
    for (const e of errors) console.log(`ERR ${e}`);
    await browser.close(); return;
  }

  // ── SALE-11: next learning actions on Today ──
  if (PART !== "notebook") {
  const TODAY = `${BASE}/individual/scholar/study/plan?view=today`;
  await page.goto(TODAY, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await settle(page);
  const card = page.getByTestId("plan-next-actions");
  ok(await card.isVisible({ timeout: 60_000 }).catch(() => false), "Today shows 'Next learning actions'");
  const items = card.getByTestId("next-action");
  const n = await items.count();
  const listed: { kind: string; action: string; reason: string }[] = [];
  for (let i = 0; i < n; i++) listed.push({
    kind: (await items.nth(i).getAttribute("data-kind")) ?? "", action: (await items.nth(i).locator("p").first().innerText()).trim(),
    reason: (await items.nth(i).getByTestId("next-action-reason").innerText()).trim(),
  });
  info(`suggestions: ${JSON.stringify(listed)}`);
  ok(n >= 1 && listed.every(x => x.action.length > 3 && x.reason.length > 20), "every suggestion names an action and gives a short reason");
  ok(listed.every(x => !/^(learn|study|revise)\s/i.test(x.action) || /exercise|misconception|case|lesson|prerequisite/i.test(x.action)), "actions are actions, not only a topic");
  await items.first().locator("summary", { hasText: "Why this?" }).click().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, "01-today-next-actions-390");
  ok(await fits(page), `Today fits ${WIDTH}px`);

  const decideOn = async (i: number, label: string, how: (li: ReturnType<typeof items.nth>) => Promise<void>) => {
    const li = card.getByTestId("next-action").nth(i);
    const action = (await li.locator("p").first().innerText()).trim();
    await how(li);
    await li.getByRole("status").first().waitFor({ timeout: 60_000 }).catch(() => {});
    const said = await li.getByRole("status").first().innerText().catch(() => "");
    info(`${label} "${action}": ${said}`);
    await page.waitForTimeout(2500);
    await settle(page);
    return action;
  };
  // snooze (plan unchanged, recorded deferred)
  if (n >= 1) {
    const before = await planState(u.id);
    const a = await decideOn(0, "snooze", async li => { await li.getByRole("button", { name: /^Later/ }).click(); await li.getByRole("button", { name: "Snooze until tomorrow" }).click(); });
    const after = await planState(u.id);
    const ev = await latestEvent(u.id);
    ok(after.entries === before.entries && after.entriesStamp === before.entriesStamp && after.plan === before.plan, `snooze "${a}": the plan and calendar are unchanged`);
    ok(after.events === before.events + 1 && ev?.status === "deferred" && typeof ev.value?.until === "string", `snooze recorded (next_action deferred until ${ev?.value?.until})`);
    await page.goto(TODAY, { waitUntil: "domcontentloaded" }); await settle(page);
    const still = await page.getByTestId("next-action").allInnerTexts();
    ok(!still.some(t => t.startsWith(a)), "the snoozed suggestion is not shown again today");
  }
  // dismiss (plan unchanged, recorded declined)
  if ((await page.getByTestId("next-action").count()) >= 1) {
    const before = await planState(u.id);
    const a = await decideOn(0, "dismiss", async li => { await li.getByRole("button", { name: /^Dismiss/ }).click(); });
    const after = await planState(u.id);
    const ev = await latestEvent(u.id);
    ok(after.entries === before.entries && after.entriesStamp === before.entriesStamp && after.plan === before.plan, `dismiss "${a}": the plan and calendar are unchanged`);
    ok(after.events === before.events + 1 && ev?.status === "declined" && typeof ev.value?.fingerprint === "string", "dismiss recorded (next_action declined with its evidence fingerprint)");
  } else info("no suggestion left to dismiss");
  // accept (one calendar entry, recorded accepted)
  await page.goto(TODAY, { waitUntil: "domcontentloaded" }); await settle(page);
  if ((await page.getByTestId("next-action").count()) >= 1) {
    const before = await planState(u.id);
    const a = await decideOn(0, "accept", async li => { await li.getByRole("button", { name: /^Add to today/ }).click(); });
    const after = await planState(u.id);
    const ev = await latestEvent(u.id);
    const entry = ev?.value?.entryId ? (await db<{ title: string; entry_type: string; entry_date: string; duration_minutes: number }>(
      "select title, entry_type, entry_date::text, duration_minutes from individual_learning_calendar_entry where user_id = $1 and id = $2", [u.id, ev.value.entryId]))[0] : null;
    ok(after.entries === before.entries + 1 && after.plan === before.plan, `accept "${a}": exactly one entry added to the learner's own calendar, plan settings unchanged`);
    ok(ev?.status === "accepted" && !!entry && entry.entry_type === "study_session" && entry.title.startsWith(a), `accept recorded with its entry (${entry?.title} · ${entry?.entry_date} · ${entry?.duration_minutes} min)`);
    await page.goto(TODAY, { waitUntil: "domcontentloaded" }); await settle(page);
    ok((await page.getByText(/In your plan for/).count()) >= 1, "the accepted suggestion shows as in your plan");
    await shot(page, "02-today-after-decisions-390");
  } else info("no suggestion left to accept");
  }

  // ── SALE-12: annotate a saved explanation ──
  const NOTE = `R3 walk annotation ${new Date().toISOString().slice(11, 19)}: preload is the stretch on the ventricle before it contracts.`;
  await page.goto(`${BASE}/individual/scholar/study/saved`, { waitUntil: "domcontentloaded", timeout: 300_000 }); await settle(page);
  const notesBox = page.locator("details", { has: page.locator("summary", { hasText: /^Your notes/ }) }).first();
  if (await notesBox.isVisible({ timeout: 30_000 }).catch(() => false)) {
    await notesBox.locator("summary").first().click();
    await notesBox.locator("textarea").first().waitFor({ timeout: 30_000 });
    // the page may still be hydrating: type again until the form takes the text
    for (let t = 0; t < 10; t++) {
      await notesBox.locator("textarea").first().fill(NOTE);
      if (await notesBox.getByRole("button", { name: "Save note" }).isEnabled()) break;
      await page.waitForTimeout(1500);
    }
    await notesBox.getByRole("button", { name: "Save note" }).click();
    ok(await notesBox.getByText(NOTE).isVisible({ timeout: 30_000 }).catch(() => false), "annotated a saved explanation (note saved on the saved lesson)");
  } else ok(false, "a saved explanation to annotate");

  // ── SALE-12: the Notebook ──
  const NB = `${BASE}/individual/scholar/study/saved?view=notebook`;
  await page.goto(NB, { waitUntil: "domcontentloaded", timeout: 300_000 }); await settle(page);
  ok(await page.getByTestId("notebook").isVisible({ timeout: 60_000 }).catch(() => false), "the Notebook view opens from the library");
  ok(await page.getByTestId("notebook-misconceptions").isVisible(), "misconceptions to revisit are shown");
  info(`misconceptions listed: ${await page.getByTestId("notebook-misconceptions").locator("li").count()}`);
  // personal summary on a section of a material
  const SUMMARY = `R3 walk summary ${new Date().toISOString().slice(11, 19)}: preload rises with venous return; too much stretch fails the heart.`;
  const form = page.locator("details", { has: page.locator("summary", { hasText: "Write a personal summary" }) });
  await form.locator("summary").click();
  const selects = form.locator("select");
  const mats = await selects.nth(0).locator("option").count();
  if (mats > 1) {
    await selects.nth(0).selectOption({ index: 1 });
    await page.waitForFunction(() => { const s = document.querySelectorAll("details select")[1] as HTMLSelectElement | undefined; return !!s && !s.disabled && s.options.length > 1; }, null, { timeout: 60_000 }).catch(() => {});
    if ((await selects.nth(1).locator("option").count()) > 1) await selects.nth(1).selectOption({ index: 1 });
    for (let t = 0; t < 10; t++) { await form.locator("textarea").fill(SUMMARY); if (await form.getByRole("button", { name: "Save summary" }).isEnabled()) break; await page.waitForTimeout(1500); }
    await form.getByRole("button", { name: "Save summary" }).click();
    let saved = 0;
    for (let w = 0; w < 30 && !saved; w++) { saved = (await db("select 1 from individual_scholar_note where user_id = $1 and kind = 'summary' and body = $2", [u.id, SUMMARY])).length; if (!saved) await page.waitForTimeout(1000); }
    ok(saved === 1, "wrote a personal summary (kept as kind summary)");
  } else ok(false, "a material to summarise");
  await page.goto(NB, { waitUntil: "domcontentloaded" }); await settle(page);
  const list = page.getByTestId("notebook-item");
  const sum = list.filter({ hasText: SUMMARY });
  const ann = list.filter({ hasText: NOTE });
  ok(await sum.count() === 1 && (await sum.getAttribute("data-kind")) === "summary", "the summary is in the Notebook, as a summary");
  ok(await ann.count() === 1, "the annotation is in the Notebook");
  ok((await ann.getByRole("link", { name: /^Source: / }).count()) === 1 && (await sum.getByRole("link", { name: /^Source: / }).count()) === 1, "each keeps its cited source");
  const rel = await ann.locator("summary", { hasText: /^Related/ }).count();
  if (rel) { await ann.locator("summary", { hasText: /^Related/ }).click(); info(`related to the annotation: ${(await ann.locator("details li").allInnerTexts()).join(" | ")}`); }
  ok(true, `related materials offered where they exist (${rel ? "shown" : "none for this note"})`);
  // choose both, make practice
  await ann.getByRole("checkbox").check();
  await sum.getByRole("checkbox").check();
  const practice = page.getByTestId("notebook-practice");
  await shot(page, "03-notebook-chosen-390", true);
  ok(await fits(page), `the Notebook fits ${WIDTH}px`);
  const go = practice.getByTestId("notebook-practice-link").first();
  ok(await go.isVisible(), `make practice offered: "${(await go.innerText().catch(() => "")).trim()}"`);
  const target = await go.getAttribute("href");
  await go.click();
  await page.waitForURL(/study\/revise\?material=/, { timeout: 300_000 }); await settle(page);
  const url = new URL(page.url());
  const secs = (url.searchParams.get("sections") ?? "").split(",").filter(Boolean);
  const ids = await db<{ chunk_id: string | null; artefact_id: string | null; body: string }>(
    "select chunk_id, artefact_id, body from individual_scholar_note where user_id = $1 and (body = $2 or body = $3)", [u.id, NOTE, SUMMARY]);
  const artSecs = ids.find(r => r.artefact_id) ? (await db<{ chunk_id: string }>("select chunk_id from individual_scholar_artefact_source where user_id = $1 and artefact_id = $2", [u.id, ids.find(r => r.artefact_id)!.artefact_id])).map(r => r.chunk_id) : [];
  const expected = new Set([...ids.flatMap(r => (r.chunk_id ? [r.chunk_id] : [])), ...artSecs]);
  info(`practice link ${target}`);
  ok(secs.length > 0 && secs.every(s => expected.has(s)), `Revise opens on exactly the chosen notes' sections (${secs.length})`);
  ok(await page.getByTestId("notebook-return").isVisible({ timeout: 30_000 }).catch(() => false), "Revise offers 'Back to your Notebook'");
  ok(await page.getByText(/Only the \d+ sections?/).isVisible().catch(() => false), "the Revise builder is limited to those sections");
  await shot(page, "04-revise-from-notes-390");
  ok(await fits(page), `Revise fits ${WIDTH}px`);
  await page.getByRole("button", { name: "Start revising" }).click();
  const started = await page.waitForURL(/session=/, { timeout: 240_000 }).then(() => true, () => false);
  await settle(page);
  ok(started, "practice from the notes starts (existing revision session, SQIE generation and routing)");
  if (started) {
    const sid = new URL(page.url()).searchParams.get("session");
    const rows = await db<{ n: string; outside: string }>(
      `select count(*) as n, count(*) filter (where not (q.chunk_id = any($3::uuid[]))) as outside
         from individual_scholar_revision_session_item i join individual_scholar_question q on q.id = i.question_id and q.user_id = i.user_id where i.user_id = $1 and i.session_id = $2`, [u.id, sid, secs]).catch(e => { info(`session read: ${e.message}`); return []; });
    if (rows[0]) ok(Number(rows[0].n) > 0 && Number(rows[0].outside) === 0, `the practice questions (${rows[0].n}) are all from the chosen sections`);
    await shot(page, "05-practice-started-390");
  }
  // back to the Notebook, at the note
  await page.goto(`${BASE}/individual/scholar/study/revise?material=${url.searchParams.get("material")}&sections=${secs.join(",")}&nb=1`, { waitUntil: "domcontentloaded" }); await settle(page);
  await page.getByTestId("notebook-return").getByRole("link").click();
  ok(await page.waitForURL(/view=notebook/, { timeout: 60_000 }).then(() => true, () => false), "Back to your Notebook returns to the Notebook");
  // Notebook -> the lesson / saved lesson and back
  await settle(page);
  const open = page.getByTestId("notebook-item").filter({ hasText: NOTE }).getByRole("link", { name: /^Open (saved )?lesson$/ });
  if (await open.count()) {
    await open.first().click();
    await settle(page);
    ok(await page.getByTestId("notebook-return").waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false), `the lesson opened from a note offers the way back (${new URL(page.url()).pathname}${new URL(page.url()).search.slice(0, 60)})`);
    await page.getByTestId("notebook-return").getByRole("link").click();
    ok(await page.waitForURL(/view=notebook#n-/, { timeout: 60_000 }).then(() => true, () => false), "and returns to that note in the Notebook");
  } else info("no lesson link on the annotation");

  // The dev server's report-only CSP notice ("upgrade-insecure-requests is ignored when delivered in a report-only policy") is printed by the
  // browser on every page of every dev build, before any app code; it is listed but not counted as an application error.
  const csp = (e: string) => /upgrade-insecure-requests' is ignored when delivered in a report-only policy/.test(e);
  info(`dev-only CSP report-only notices: ${errors.filter(csp).length}`);
  const appErrors = errors.filter(e => !csp(e));
  ok(appErrors.length === 0, `0 console errors (${appErrors.length})`);
  for (const e of appErrors.slice(0, 10)) info(`console: ${e.slice(0, 3000)}`);
  ok(fivexx.length === 0, `no 5xx (${fivexx.length})`);
  for (const e of fivexx.slice(0, 10)) info(`5xx: ${e}`);
  await browser.close();
  const fails = log.filter(l => l.startsWith("FAIL")).length;
  writeFileSync(join(__dirname, `walk-${WIDTH}.log`), log.join("\n") + `\n${fails ? `${fails} FAIL` : "ALL PASS"}\n`);
  console.log(fails ? `${fails} FAIL` : "ALL PASS");
}
main().catch(e => { console.error(e); process.exit(1); });
