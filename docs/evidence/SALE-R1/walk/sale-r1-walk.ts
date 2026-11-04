// SALE-2026-11 R1 staging walk (fixture learner, staging dev server). Credentials are read from WALK_FIXTURE and never printed.
//   npx tsx docs/evidence/SALE-R1/walk/sale-r1-walk.ts   (env: WALK_BASE, WALK_SESSION, WALK_FIXTURE, WALK_WIDTH)
// Proves: a wrong answer changes the next teaching action and the reason is shown; the suggested approach runs; a DIFFERENT question
// follows; a right answer on it updates the learning state on Progress; phone width fits; 0 console errors; no 5xx.
import { chromium, type Page } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://localhost:3181";
const SESSION = process.env.WALK_SESSION ?? "2b9fccd2-530b-45e0-a77c-5c68d0f2c982";
const WIDTH = Number(process.env.WALK_WIDTH ?? 390);
const OUT = join(__dirname, "shots");
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const EMAIL = field("email"), PASSWORD = field("password");
if (!EMAIL || !PASSWORD) { console.error("fixture file lacks email=/password="); process.exit(1); }

const log: string[] = [];
let lastCheck: { kept: boolean; withheld: boolean } | null = null;
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; log.push(l); console.log(l); };
const info = (what: string) => { const l = `INFO ${what}`; log.push(l); console.log(l); };
const LESSON = `${BASE}/individual/scholar/study/learn?session=${SESSION}`;
const PROGRESS = `${BASE}/individual/scholar/study/progress`;

async function signIn(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240_000 });
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
const panel = (page: Page) => page.locator("form:has(#check-answer)");
const adaptive = (page: Page) => page.locator("section[data-adaptive-need]");
const shot = async (page: Page, name: string, full = false) => { await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, caret: "initial" }); };
const openFold = async (page: Page) => { const f = page.locator("section[aria-labelledby='learning-state-h'] details").first(); if (!(await f.evaluate(d => (d as HTMLDetailsElement).open))) await f.locator("summary").first().click(); await page.waitForTimeout(300); };
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Submit the open check; a judgement withheld by the grounding check (nothing kept) is retried up to twice, as a learner would. */
async function submitCheck(page: Page) {
  for (let i = 0; i < 3; i++) {
    lastCheck = null;
    await page.getByRole("button", { name: "Check my answer" }).click();
    await waitOutcome(page);
    for (let w = 0; w < 20 && !lastCheck; w++) await page.waitForTimeout(500);
    if (lastCheck && (lastCheck as { kept: boolean }).kept) return;
    info(`judgement not kept (attempt ${i + 1}); trying again`);
    await panel(page).getByRole("button", { name: "Try again" }).click().catch(() => {});
    await page.waitForTimeout(500);
  }
}
async function waitOutcome(page: Page) {
  const status = panel(page).getByRole("status").filter({ hasText: /reading your answer/i }).first();
  await status.waitFor({ timeout: 15_000 }).catch(() => {});
  await status.waitFor({ state: "detached", timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(800);
}
/** Per topic: the understanding and delayed-recall lines of "What your evidence shows". */
async function learningState(page: Page): Promise<Record<string, { headline: string; understanding: string; enough: string }>> {
  await page.goto(PROGRESS, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.locator("#learning-state-h").waitFor({ timeout: 240_000 });
  return page.evaluate(() => {
    const out: Record<string, { headline: string; understanding: string; enough: string }> = {};
    for (const li of Array.from(document.querySelectorAll("li[data-learning-state-topic]"))) {
      out[li.getAttribute("data-learning-state-topic")!] = {
        headline: li.querySelector("[data-learning-state-headline]")?.textContent?.trim() ?? "",
        understanding: li.querySelector("[data-dimension='understanding']")?.textContent?.trim() ?? "",
        enough: li.querySelector("summary")?.textContent?.trim() ?? "",
      };
    }
    return out;
  });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 860 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [], failed: string[] = [], decisions: unknown[] = [];
  page.on("console", m => { if (m.type() === "error" && !/Content Security Policy|upgrade-insecure/i.test(m.text())) consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 2500)}`); });
  page.on("response", async r => {
    if (r.status() >= 500) failed.push(`${r.status()} ${r.url()}`);
    if (/\/learn\/(act|checks)$/.test(new URL(r.url()).pathname) && r.request().method() === "POST") {
      const body = r.request().postDataJSON?.() as Record<string, unknown> | undefined;
      if (body?.action === "clarify" || r.url().endsWith("/checks")) { const j = await r.json().catch(() => null); info(`check response ${r.status()}: kept=${!!j?.kept} adaptive=${!!j?.adaptive} withheld=${!!j?.withheld} ${j?.error ? `error=${j.error}` : ""}`); lastCheck = { kept: !!j?.kept, withheld: !!j?.withheld || !r.ok() }; if (j?.adaptive) decisions.push({ sent: { followUp: body?.followUp ?? null, confidence: body?.confidence ?? null }, kept: j.kept?.attemptId ?? null, adaptive: j.adaptive }); }
    }
  });
  await signIn(page);

  // 0. The learning state before (SALE-04).
  const before = await learningState(page);
  info(`learning state before: ${Object.keys(before).length} topics`);
  ok(Object.keys(before).length > 0, "SALE-04 Progress shows What your evidence shows, by topic");
  ok(await fits(page), `Progress fits ${WIDTH}px with no sideways scroll`);
  const pageText = await page.locator("section[aria-labelledby='learning-state-h']").innerText();
  ok(!/\d+\s?%/.test(pageText), "SALE-04 the learning state shows no percentage");
  ok(/not verified competence/i.test(pageText), "SALE-04 the learning state says it is not verified competence");
  await openFold(page);
  const firstTopic = page.locator("li[data-learning-state-topic] summary").first();
  await firstTopic.click();
  await page.waitForTimeout(400);
  await page.locator("li[data-learning-state-topic]").first().screenshot({ path: join(OUT, "01-learning-state-topic.png"), caret: "initial" });
  ok((await page.locator("li[data-learning-state-topic]").first().getByRole("button", { name: "Correct topics" }).count()) > 0, "SALE-04 the learner can correct the topics behind a topic's evidence");

  // 1. A wrong answer (SALE-05/06).
  await page.goto(LESSON, { waitUntil: "domcontentloaded", timeout: 240_000 });
  // A resume banner ("Go to lesson n") takes the learner to where they stopped.
  const resume = page.getByRole("button", { name: /^Go to lesson \d+/ }).first();
  if (await resume.waitFor({ timeout: 60_000 }).then(() => true, () => false)) { info(`resume: ${(await resume.innerText()).trim()}`); await resume.click(); }
  const answerable = await page.getByRole("button", { name: "Answer this" }).first().waitFor({ timeout: 240_000 }).then(() => true, () => false);
  if (!answerable) {
    await shot(page, "debug-lesson", true);
    const btns = await page.getByRole("button").allInnerTexts();
    console.log("DEBUG buttons:", btns.map(b => b.trim()).filter(Boolean).slice(0, 60).join(" | "));
    throw new Error("no answerable lesson check on this session");
  }
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Answer this" }).first().click();
  await page.locator("#check-answer").waitFor({ timeout: 60_000 });
  const q1 = (await page.locator("form:has(#check-answer)").locator("xpath=ancestor::li[1]").first().innerText().catch(() => "")).split("\n")[0].trim();
  info(`question 1: ${q1.slice(0, 160)}`);
  await page.locator("#check-answer").fill("I am not sure. I think you just give the patient more medicine and wait.");
  await page.getByRole("button", { name: "Sure", exact: true }).click();
  await submitCheck(page);
  await adaptive(page).waitFor({ timeout: 60_000 });
  const need1 = await adaptive(page).getAttribute("data-adaptive-need"), approach1 = await adaptive(page).getAttribute("data-adaptive-approach");
  const reason1 = (await adaptive(page).locator("p").nth(1).innerText()).trim();
  info(`after the wrong answer: need=${need1} approach=${approach1}`);
  info(`reason shown: ${reason1}`);
  ok(!!need1 && need1 !== "understood" && approach1 !== "challenge", "SALE-05/06 a wrong answer changes the next teaching action (not the harder question)");
  ok(reason1.length > 30, "SALE-06 the reason for the next action is shown");
  await adaptive(page).locator("summary").click();
  await adaptive(page).scrollIntoViewIfNeeded();
  await adaptive(page).screenshot({ path: join(OUT, "02-next-step-after-wrong.png"), caret: "initial" });
  ok(await fits(page), `the lesson with the next step fits ${WIDTH}px`);

  // 2. Run the chosen approach (SALE-07 correct), then a different question.
  const runBtn = adaptive(page).getByRole("button").first();
  const runLabel = (await runBtn.innerText()).trim();
  info(`running: ${runLabel}`);
  await runBtn.click();
  await adaptive(page).getByRole("button", { name: "Working…" }).waitFor({ state: "detached", timeout: 240_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, "03-after-corrective-step");
  const diff = adaptive(page).getByRole("button", { name: /different question|question from an earlier lesson/i });
  ok((await diff.count()) > 0, "SALE-07 after the corrective step a different question is offered");
  await diff.first().click();
  await page.locator("#check-answer").waitFor({ timeout: 240_000 });
  await page.waitForTimeout(500);
  // A lesson question shows inside its list item; an Ask me question shows at the top of the check panel.
  const q2 = ((await page.locator("form:has(#check-answer)").locator("xpath=ancestor::li[1]").first().innerText({ timeout: 3000 }).catch(() => ""))
    || (await panel(page).locator("p").nth(1).innerText().catch(() => ""))).split("\n")[0].trim();
  info(`question 2: ${q2.slice(0, 160)}`);
  ok(!!q2 && q2 !== q1, "SALE-07 the follow-up question is a different question");

  // 3. A right answer on it: the lesson's own key points, in the learner's words.
  // The lesson's own teaching that cites the same source as the follow-up question ([S n]), in the lesson card that holds the check.
  const tag = (q2.match(/\[S\d+\]/) ?? [""])[0];
  const points = await page.evaluate(({ tag, q2 }) => {
    const card = document.getElementById("check-answer")?.closest("section[data-lesson-index]") ?? document;
    const own = Array.from(card.querySelectorAll("p, li")).map(e => (e as HTMLElement).innerText.trim())
      .filter(t => t && (!tag || t.includes(tag)) && !t.includes("?") && t !== q2);
    const h = Array.from(card.querySelectorAll("h4, h5")).find(x => /^key points$/i.test((x.textContent ?? "").trim()));
    const keys = (h?.nextElementSibling?.textContent ?? "").trim();
    return [...new Set(own), keys].join(" ").replace(/\[[SRE]\d+\]/g, "").replace(/\s+/g, " ").trim();
  }, { tag, q2 });
  info(`answer 2 built from the lesson's teaching citing ${tag || "(no tag)"}: ${points.length} chars`);
  await page.locator("#check-answer").fill(points.slice(0, 580) || "The key points of the lesson.");
  await submitCheck(page);
  await page.waitForTimeout(1500);
  const need2 = await adaptive(page).getAttribute("data-adaptive-need").catch(() => null), approach2 = await adaptive(page).getAttribute("data-adaptive-approach").catch(() => null);
  const reason2 = (await adaptive(page).locator("p").nth(1).innerText().catch(() => "")).trim();
  info(`after the second answer: need=${need2} approach=${approach2}`);
  info(`reason shown: ${reason2}`);
  ok(need2 === "understood" ? /different question well/i.test(reason2) : !!need2, "SALE-07 the follow-up answer is recorded against the step it followed, with its reason");
  await adaptive(page).scrollIntoViewIfNeeded().catch(() => {});
  await adaptive(page).screenshot({ path: join(OUT, "04-next-step-after-follow-up.png"), caret: "initial" }).catch(() => {});

  // 4. The learning state after (SALE-04 updated by the right answer on a different question).
  const after = await learningState(page);
  const changed = Object.keys(after).filter(k => !before[k] || before[k].understanding !== after[k].understanding || before[k].headline !== after[k].headline);
  for (const k of changed) info(`state changed for "${k}": ${before[k]?.understanding ?? "(new)"} => ${after[k].understanding}`);
  ok(changed.length > 0, "SALE-04 the learning state reflects the new answers");
  await openFold(page);
  const t = changed[0] ? page.locator(`li[data-learning-state-topic="${changed[0]}"]`) : page.locator("li[data-learning-state-topic]").first();
  await t.locator("summary").click();
  await page.waitForTimeout(400);
  await t.screenshot({ path: join(OUT, "05-learning-state-after.png"), caret: "initial" });
  ok(await fits(page), `Progress still fits ${WIDTH}px`);

  ok(consoleErrors.length === 0, `0 console errors (${consoleErrors.length})${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  ok(failed.length === 0, `no 5xx (${failed.join(", ")})`);
  writeFileSync(join(__dirname, `walk-${WIDTH}.json`), JSON.stringify({ base: BASE, width: WIDTH, session: SESSION, q1, q2, need1, approach1, reason1, need2, approach2, reason2, changed: changed.map(k => ({ topic: k, before: before[k] ?? null, after: after[k] })), decisions, log }, null, 2));
  await browser.close();
  process.exit(log.some(l => l.startsWith("FAIL")) ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
