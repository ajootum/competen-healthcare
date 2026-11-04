// SALE-2026-11 R2 staging walk (fixture learner, staging dev server on 3190). Credentials are read from WALK_FIXTURE and never printed.
//   npx tsx docs/evidence/SALE-R2/walk/sale-r2-walk.ts   (env: WALK_BASE, WALK_FIXTURE, WALK_WIDTH)
// Run after WALK-SETUP-staging.sql. Proves, at phone width with 0 console errors and no 5xx:
//   SALE-08  a topic last practised today is not due; after a SIMULATED DELAY (WALK-DELAY-staging.sql, answers moved 8 days back) it is
//            "Due for retrieval" with its reason; the delay is then undone exactly (WALK-DELAY-UNDO-staging.sql).
//   SALE-09  a prerequisite suggestion with its reason (framework link, the learner's own notes on the prerequisite).
//   SALE-10  a transfer check started from the offer, its question answered, and the answer shown as transfer evidence in the learning state.
import { chromium, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://localhost:3190";
const WIDTH = Number(process.env.WALK_WIDTH ?? 390);
const OUT = join(__dirname, "shots");
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const EMAIL = field("email"), PASSWORD = field("password");
if (!EMAIL || !PASSWORD) { console.error("fixture file lacks email=/password="); process.exit(1); }
const RUNNER = "C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs";
const staging = (file: string) => {
  const out = execSync(`node "${RUNNER}" "${join(__dirname, file)}"`, { input: "ezhvpgtcqcdsgylrxgdb\n", encoding: "utf8" });
  return /Committed/.test(out);
};

const log: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };
const REVISE = `${BASE}/individual/scholar/study/revise`;
const PROGRESS = `${BASE}/individual/scholar/study/progress`;
const CRIT = "Essential Nursing Care of the Critically Ill";
const QI = "Quality Improvement Science and Methods";

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
const shot = async (page: Page, name: string, full = false) => { await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, caret: "initial" }); };
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// A dev recompile can abort a navigation (net::ERR_ABORTED): tried once more.
const go = async (page: Page, url: string) => {
  try { await page.goto(url, { waitUntil: "networkidle", timeout: 240_000 }); }
  catch (e) { if (!/ERR_ABORTED/.test(String(e))) throw e; await page.waitForTimeout(3000); await page.goto(url, { waitUntil: "networkidle", timeout: 240_000 }); }
  await page.waitForTimeout(800);
};
// WALK_PHASE=progress runs only the last step (the learning state after a transfer answer already recorded).
const PHASE = process.env.WALK_PHASE ?? "all";
const dueTopics = (page: Page) => page.locator("[data-retrieval] li[data-retrieval-topic]").evaluateAll(els => els.map(e => ({ key: e.getAttribute("data-retrieval-topic"), rules: e.getAttribute("data-retrieval-rules"), text: (e.textContent ?? "").replace(/\s+/g, " ").trim() })));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 860 } });
  const consoleErrors: string[] = [];
  const fivexx: string[] = [];
  // The CSP report-only notice about upgrade-insecure-requests is the browser's note on the dev header, not an app error (the R1 walk filters it too).
  page.on("console", m => { if (m.type() === "error" && !/Content Security Policy|upgrade-insecure/i.test(m.text())) consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", e => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("response", r => { if (r.status() >= 500) fivexx.push(`${r.status()} ${r.url()}`); });
  const result: Record<string, unknown> = { width: WIDTH, at: new Date().toISOString() };
  let delayed = false;
  try {
    await signIn(page);
    if (PHASE === "all") {

    // ── SALE-08: before the delay ──
    await go(page, REVISE);
    ok(await page.locator("[data-retrieval]").count() === 1, "SALE-08 Revise shows Due for retrieval (scholar_retrieval_schedule on)");
    const before = await dueTopics(page);
    result.dueBefore = before;
    ok(!before.some(d => d.key === CRIT.toLowerCase()), `SALE-08 before the delay: "${CRIT}" (last practised today) is not due`);
    await page.locator("[data-retrieval]").scrollIntoViewIfNeeded();
    await shot(page, "01-retrieval-before-delay");

    // ── the simulated delay ──
    delayed = staging("WALK-DELAY-staging.sql");
    ok(delayed, "simulated delay applied on staging (its answers moved 8 days back)");
    await go(page, REVISE);
    const after = await dueTopics(page);
    result.dueAfter = after;
    const crit = after.find(d => d.key === CRIT.toLowerCase());
    ok(!!crit, `SALE-08 after the delay: "${CRIT}" is Due for retrieval`);
    ok(!!crit && /Last practised 8 days ago/.test(crit.text), "SALE-08 the reason says when it was last practised and why the gap");
    ok(!!crit && /Recall it now/.test(crit.text), "SALE-08 the action is a retrieval exercise on its own sections (not only flashcards)");
    ok(!!crit && !/%/.test(crit.text), "SALE-08 no percentage or score shown");
    info(`due item: ${crit?.text.slice(0, 300)}`);
    await page.locator("[data-retrieval]").scrollIntoViewIfNeeded();
    await shot(page, "02-retrieval-due-after-delay");
    ok(await fits(page), "Revise fits 390 px");

    // ── SALE-09: prerequisite suggestion with its reason ──
    const pre = page.locator("[data-prerequisites] li[data-prerequisite-topic]").first();
    const preText = (await pre.textContent().catch(() => "")) ?? "";
    result.prerequisite = preText.replace(/\s+/g, " ").trim();
    ok(/Performs a systematic respiratory assessment/.test(preText), "SALE-09 a prerequisite review is suggested from the framework link");
    ok(/framework lists/.test(preText) && /different questions/.test(preText), "SALE-09 the reason names the framework prerequisite and the different questions missed");
    ok(/Review your notes/.test(preText), "SALE-09 it links to the learner's own notes on the prerequisite");
    await pre.scrollIntoViewIfNeeded();
    await shot(page, "03-prerequisite-suggestion");

    // undo the delay now, before anything else is answered
    ok(staging("WALK-DELAY-UNDO-staging.sql"), "simulated delay undone exactly on staging");
    delayed = false;

    // ── SALE-10: transfer check ──
    await go(page, REVISE);
    const offer = page.locator(`[data-transfer] li[data-transfer-topic="${QI}"]`);
    ok(await offer.count() === 1, `SALE-10 a transfer check is offered on "${QI}" (some understanding shown)`);
    await offer.scrollIntoViewIfNeeded();
    await shot(page, "04-transfer-offer");
    await offer.getByRole("button", { name: /Try it in a new setting/ }).click();
    await page.waitForURL(/study\/revise\?session=/, { timeout: 600_000, waitUntil: "commit" });
    await page.getByText(/Transfer check on/).first().waitFor({ timeout: 600_000 });
    const session = new URL(page.url()).searchParams.get("session");
    result.transferSession = session;
    ok(!!session, "SALE-10 the transfer check opened as a revision session");
    const label = (await page.getByText(/Transfer check on/).first().textContent().catch(() => "")) ?? "";
    ok(/Transfer check on Quality Improvement Science and Methods/.test(label), "SALE-10 the session says it is a transfer check, and on which topic");
    // Touch nothing until the page has hydrated (Dictate is drawn on the client only): a change to the DOM before hydration breaks it.
    await page.getByRole("button", { name: /Dictate/ }).first().waitFor({ timeout: 300_000 }).catch(() => info("Dictate not drawn: continuing"));
    await page.waitForTimeout(1000);
    await shot(page, "05-transfer-question");
    // answer the first question as a learner would
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: /Check answer|Save answer/ }) }).first();
    // Until the page has hydrated, typing does not reach React state and the button stays disabled: try again until it registers.
    const submit = form.getByRole("button", { name: /Check answer|Save answer/ });
    for (let i = 0; i < 120 && await submit.isDisabled(); i++) {
      if (await form.locator('input[type="radio"]').count()) await form.locator('input[type="radio"]').first().check();
      else if (await form.locator("textarea").count()) await form.locator("textarea").first().fill("Plan, do, study, act: test a small change, measure it, and adjust before spreading it.");
      await page.waitForTimeout(1500);
    }
    const answerResp = page.waitForResponse(r => r.url().includes("/api/individual/scholar/revision/answer") && r.request().method() === "POST", { timeout: 240_000 });
    await form.getByRole("button", { name: /Check answer|Save answer/ }).click();
    let ar = await answerResp;
    // A short written answer is marked by the learner against the key (the ordinary route asks for the self-grade before it records).
    // The walk answers as a learner who compares honestly: its answer does not say what the key says.
    const self = page.getByRole("button", { name: "It does not", exact: true });
    if (await self.first().waitFor({ timeout: 20_000 }).then(() => true, () => false)) {
      info("short answer: graded by the learner against the stored answer (It does not), as the revision route asks");
      const graded = page.waitForResponse(r => r.url().includes("/api/individual/scholar/revision/answer") && r.request().method() === "POST", { timeout: 240_000 });
      await self.first().click();
      ar = await graded;
    }
    const body = await ar.json().catch(() => ({})) as Record<string, unknown>;
    ok(ar.status() < 400 && !body.needsSelfGrade, `SALE-10 the transfer answer was recorded by the ordinary revision route (${ar.status()})`);
    await page.waitForTimeout(1500);
    await shot(page, "06-transfer-answered");
    ok(await fits(page), "the transfer session fits 390 px");
    }

    // ── the learning state shows it as transfer evidence ──
    await go(page, PROGRESS);
    const topic = page.locator(`[data-learning-state-topic="${QI.toLowerCase()}"]`);
    await topic.scrollIntoViewIfNeeded();
    const fold = page.locator("section[aria-labelledby='learning-state-h'] details").first();
    if (!(await fold.evaluate(d => (d as HTMLDetailsElement).open))) await fold.locator("summary").first().click();
    await topic.locator("summary").first().click();
    await page.waitForTimeout(300);
    const app = (await topic.locator('[data-dimension="application"]').textContent().catch(() => "")) ?? "";
    result.application = app.replace(/\s+/g, " ").trim();
    ok(/Transfer checks/.test(app), "SALE-10 the learning state's Applying it dimension shows the transfer check");
    const ev = (await topic.locator("li", { hasText: "(transfer check)" }).first().textContent().catch(() => "")) ?? "";
    result.transferEvidenceLine = ev.trim();
    ok(/(transfer check)/.test(ev), "SALE-10 the answer is listed as a transfer check in the evidence behind the topic");
    ok(/not verified competence/i.test((await page.locator("section[aria-labelledby='learning-state-h']").textContent()) ?? ""), "never competence: the not-verified-competence note is shown");
    await topic.scrollIntoViewIfNeeded();
    await shot(page, "07-learning-state-transfer");
    ok(await fits(page), "Progress fits 390 px");
  } catch (e) {
    ok(false, `walk error: ${String(e).slice(0, 400)}`);
    await shot(page, "zz-error", true).catch(() => {});
  } finally {
    if (delayed) ok(staging("WALK-DELAY-UNDO-staging.sql"), "simulated delay undone (after an error)");
    ok(consoleErrors.length === 0, `0 console errors (${consoleErrors.length})`);
    ok(fivexx.length === 0, `no 5xx (${fivexx.length})`);
    if (consoleErrors.length) info(`console: ${consoleErrors.join(" | ")}`);
    if (fivexx.length) info(`5xx: ${fivexx.join(" | ")}`);
    result.log = log;
    writeFileSync(join(__dirname, `walk-${WIDTH}${PHASE === "all" ? "" : `-${PHASE}`}.json`), JSON.stringify(result, null, 2));
    writeFileSync(join(__dirname, `walk-${WIDTH}${PHASE === "all" ? "" : `-${PHASE}`}.log`), log.join("\n") + "\n");
    await browser.close();
  }
})();
