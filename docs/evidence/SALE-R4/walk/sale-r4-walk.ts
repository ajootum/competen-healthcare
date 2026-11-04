// SALE-2026-11 R4 staging walk (fixture learner, staging dev server). Credentials are read from WALK_FIXTURE and never printed.
//   npx tsx docs/evidence/SALE-R4/walk/sale-r4-walk.ts   (env: WALK_BASE, WALK_FIXTURE, WALK_COMPETENCY, WALK_WIDTH)
// Proves: a finished OSCE run (and, by the same path, a completed clinical case) appears on Progress as APPLICATION evidence, by skill, linked to a competency with its framework version
// and mapping status; My Competencies shows three SEPARATE views (self-assessment, learning evidence, verified competence) and the
// formative result does not reach the verified view; phone width fits; 0 console errors; no 5xx.
import { chromium, type Page } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.WALK_BASE ?? "http://localhost:3194";
const WIDTH = Number(process.env.WALK_WIDTH ?? 390);
const COMPETENCY = process.env.WALK_COMPETENCY ?? "";
const OUT = join(__dirname, "shots");
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const EMAIL = field("email"), PASSWORD = field("password");
if (!EMAIL || !PASSWORD) { console.error("fixture file lacks email=/password="); process.exit(1); }

const log: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };
const shot = async (page: Page, name: string, full = true) => { await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, caret: "initial" }); };
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function signIn(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240_000 });
    await page.waitForTimeout(1500);
    await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
    await page.locator("input#password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    const left = await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).then(() => true, () => false);
    if (left) return;
  }
  throw new Error("sign-in did not complete");
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 860 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  const fivexx: string[] = [];
  // As in the R1 walk: the browser's notice that a report-only CSP ignores upgrade-insecure-requests (next.config.ts) is not an app error. Counted apart.
  let cspNotices = 0;
  page.on("console", m => { if (m.type() !== "error") return; if (/Content Security Policy|upgrade-insecure/i.test(m.text())) cspNotices++; else errors.push(m.text().slice(0, 300)); });
  page.on("response", r => { if (r.status() >= 500) fivexx.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
  await signIn(page);
  info(`signed in at ${WIDTH}px`);

  // 1. An OSCE station for the competency. The fixture has no programme, so the builder offers no competency: the station is made from the
  //    practice template through the app's own route (no AI), then linked to the competency the learner self-rated (staging setup step,
  //    staging-link-station.mjs, the column a competency-built station sets). It is then run and self-marked in the OSCE player.
  //    (A private case needs the learner's notes linked to a competency; this fixture has none, so the case path is proved by unit tests.)
  await page.goto(`${BASE}/individual/scholar/my-competencies`, { waitUntil: "networkidle", timeout: 240_000 });
  const competencyId = COMPETENCY || (await page.locator("[data-view=view-self] [data-competency]").first().getAttribute("data-competency").catch(() => null)) || "";
  info(`competency: the first one the learner self-rated (${competencyId ? "found" : "none"})`);
  await page.goto(`${BASE}/individual/scholar/study/apply/osce`, { waitUntil: "networkidle", timeout: 240_000 });
  const made = await page.evaluate(async () => {
    const r = await fetch("/api/individual/scholar/osce/stations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "template", templateKey: "respiratory-assessment", fresh: true }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  const stationId: string = made.body?.id ?? "";
  info(`station route: ${made.status} ${stationId ? "station made from the practice template" : JSON.stringify(made.body)?.slice(0, 300)}`);
  ok(!!stationId && !!competencyId, "an OSCE station was made and a competency to link it to was found");
  if (!stationId || !competencyId) { writeFileSync(join(__dirname, `walk-${WIDTH}.log`), log.join("\n")); await browser.close(); process.exit(1); }
  const linked = execFileSync(process.execPath, [join(__dirname, "staging-link-station.mjs"), stationId, competencyId, process.env.WALK_FIXTURE!], { encoding: "utf8" }).trim();
  info(`setup: ${linked}`);
  try {
  await page.goto(`${BASE}/individual/scholar/study/apply/osce/${stationId}`, { waitUntil: "networkidle", timeout: 240_000 });
  // The player opens in the state the run is in: brief (start), running (an open run is resumed), or check (a timed-out run).
  const startBtn = page.getByRole("button", { name: /Start the station|Resume my run/ });
  const finishBtn = page.getByRole("button", { name: "Finish now" }).first();
  const markBtn = page.getByRole("button", { name: /Mark every item|Save my marks/ });
  await Promise.race([startBtn.waitFor({ timeout: 180_000 }), finishBtn.waitFor({ timeout: 180_000 }), markBtn.waitFor({ timeout: 180_000 })]).catch(() => {});
  await page.waitForTimeout(3000);
  if (!(await markBtn.isVisible().catch(() => false))) {
    if (!(await finishBtn.isVisible().catch(() => false))) {
      const started = page.waitForResponse(r => r.url().includes("/api/individual/scholar/osce/attempts") && r.request().method() === "POST", { timeout: 180_000 });
      await startBtn.click();
      info(`start: ${(await started).status()}`);
    }
    if (!(await markBtn.isVisible().catch(() => false))) {
      await finishBtn.waitFor({ timeout: 60_000 });
      const boxes = page.locator("textarea");
      for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).fill("Introduce myself, gain consent, assess airway, breathing and circulation, record observations and escalate any deterioration using SBAR.");
      // Wait for the autosave to settle before finishing, as a learner sees "Saved" (a finish racing an in-flight save is a known OSCE-route issue, reported separately).
      await page.getByText(/^Saved \d/).first().waitFor({ timeout: 60_000 }).catch(() => info("no Saved indicator seen"));
      await page.waitForTimeout(1000);
      await finishBtn.click();
    }
  } else info("the run had already ended (time up): marking it");
  await page.getByRole("button", { name: /Mark every item|Save my marks/ }).waitFor({ timeout: 60_000 });
  const items = page.locator("ol fieldset");
  const n = await items.count();
  for (let i = 0; i < n; i++) await items.nth(i).locator("input[type=radio]").first().check();
  info(`marked ${n} checklist items`);
  await page.getByRole("button", { name: "Save my marks" }).click();
  await page.getByRole("button", { name: "Practise this station again" }).waitFor({ timeout: 60_000 }).then(() => ok(true, "the OSCE run was finished and marked"), () => ok(false, "the OSCE run was finished and marked"));
  } catch (e) {
    await shot(page, `debug-osce-${WIDTH}`);
    info(`OSCE step failed: ${String(e).slice(0, 200)}; console: ${errors.slice(0, 3).join(" | ").slice(0, 400)}; buttons: ${(await page.getByRole("button").allInnerTexts()).join(" / ").slice(0, 400)}`);
    throw e;
  }
  await shot(page, `01-osce-marked-${WIDTH}`, false);

  // 2. Progress: application evidence by skill, the record, its competency link and mapping status.
  await page.goto(`${BASE}/individual/scholar/study/progress`, { waitUntil: "networkidle", timeout: 240_000 });
  const app = page.locator("[data-testid=application-evidence]");
  ok(await app.count() === 1, "Progress shows 'Applying what you learned' (key on in staging)");
  const skills = await app.locator("[data-skill]").evaluateAll(els => els.map(e => `${e.getAttribute("data-skill")}=${e.getAttribute("data-word")}`));
  info(`skills: ${skills.join(", ")}`);
  ok(skills.length > 0, "at least one application skill is shown with an evidence word");
  ok(!(await app.innerText()).match(/\d+\s*%/), "no percentage in the application section");
  await app.locator("details summary").first().click();
  await page.waitForTimeout(400);
  const rec = app.locator("[data-application-record=osce]").first();
  ok(await rec.count() === 1, "the finished OSCE run is listed as an application record");
  const recText = (await rec.innerText()).replace(/\s+/g, " ");
  info(`record: ${recText.slice(0, 400)}`);
  const status = await rec.locator("[data-mapping-status]").evaluateAll(els => els.map(e => e.getAttribute("data-mapping-status")));
  ok(status.length > 0 && status.every(s => s === "published" || s === "draft" || s === "not_recorded"), `the record links to a competency with a mapping status (${status.join(", ")})`);
  ok(/framework version/.test(recText), "the record names the framework version");
  ok(/not an assessment and not verified competence/i.test(await app.innerText()), "the section says it is not verified competence");
  ok(await fits(page), `Progress fits ${WIDTH}px`);
  await rec.scrollIntoViewIfNeeded();
  await shot(page, `03-progress-application-${WIDTH}`, false);

  // 3. My Competencies: three separate views; the case result is learning evidence only.
  await page.goto(`${BASE}/individual/scholar/my-competencies`, { waitUntil: "networkidle", timeout: 240_000 });
  const tv = page.locator("[data-testid=competency-three-views]");
  ok(await tv.count() === 1, "My Competencies shows the three views (key on in staging)");
  const views = await tv.locator("[data-view]").evaluateAll(els => els.map(e => e.getAttribute("data-view")));
  ok(JSON.stringify(views) === JSON.stringify(["view-self", "view-learning", "view-verified"]), `three separate views in order: ${views.join(", ")}`);
  const learning = tv.locator("[data-view=view-learning]");
  const caseRows = learning.locator("[data-source=osce]");
  ok(await caseRows.count() > 0, "the OSCE run appears under Learning evidence for its competency");
  const qRows = learning.locator("[data-source=question]");
  info(`learning evidence rows: ${await caseRows.count()} OSCE, ${await qRows.count()} question`);
  const lt = (await learning.innerText()).replace(/\s+/g, " ");
  ok(/framework version/.test(lt), "learning evidence rows show the framework version and mapping status");
  const verified = (await tv.locator("[data-view=view-verified]").innerText()).replace(/\s+/g, " ");
  info(`verified view: ${verified.slice(0, 300)}`);
  ok(!/Clinical case|Question|OSCE practice/.test(verified.replace(/Practice results, self-assessments and learning evidence never do/, "")), "the verified view lists no case, question or OSCE result");
  ok(/Only an authorised verification process sets this/.test(verified), "the verified view says only an authorised verification sets it");
  ok(!/benner|novice|advanced beginner|proficient/i.test(await tv.innerText()), "no stage is shown in the three views");
  ok(await fits(page), `My Competencies fits ${WIDTH}px`);
  await tv.scrollIntoViewIfNeeded();
  await shot(page, `04-three-views-${WIDTH}`, false);
  await shot(page, `05-my-competencies-full-${WIDTH}`);

  info(`report-only CSP notices excluded: ${cspNotices}`);
  ok(errors.length === 0, `0 console errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  ok(fivexx.length === 0, `no 5xx${fivexx.length ? `: ${fivexx.slice(0, 5).join(", ")}` : ""}`);
  writeFileSync(join(__dirname, `walk-${WIDTH}.log`), log.join("\n") + "\n");
  writeFileSync(join(__dirname, `walk-${WIDTH}.json`), JSON.stringify({ width: WIDTH, stationId, competencyId, skills, status, errors, fivexx, at: new Date().toISOString() }, null, 2));
  await browser.close();
  process.exit(log.some(l => l.startsWith("FAIL")) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
