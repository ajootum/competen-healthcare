// SCHOLAR-TEACHING-P1-RELEASE-001: the targeted browser tests the owner asked for, on a STAGING-pointed dev server as the fixture learner. Each policy goes back to off at the end.
// 1 clinical-risk gating through the real Guide Me route. 2 Go Deeper answer submission and feedback. 3 saved-state recovery on a lesson over ten sections. 4 lesson-level completion semantics. 5 existing teaching and revision.
// Results go outside the repo while it runs (WALK_OUT), so a write cannot make the dev server recompile mid-request.
import { chromium, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const BASE = "http://127.0.0.1:3208", SESSION = "3484e65a-ee9c-425a-9b63-b2cca40c898e";
const OUT = process.env.WALK_OUT!;
mkdirSync(join(OUT, "shots"), { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const lines: string[] = [];
const say = (l: string) => { lines.push(l); console.log(l); writeFileSync(join(OUT, "release-walk-result.txt"), `${lines.join("\n")}\n`); };
const ok = (c: boolean, what: string) => say(`${c ? "PASS" : "FAIL"} ${what}`);
const note = (w: string) => say(`NOTE ${w}`);
const req = createRequire(join(process.cwd(), "package.json"));
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = req("@supabase/supabase-js").createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId = users.find((u: { email?: string }) => u.email === field("email"))?.id;
if (!userId) throw new Error("no learner");
const setPolicy = async (key: string, value: "on" | "off") => { const { error } = await admin.from("workspace_config_overrides").upsert({ scope_type: "platform", scope_ref: "individual", config_path: `individual.policy.${key}`, published: { value }, updated_at: new Date().toISOString() }, { onConflict: "scope_type,scope_ref,config_path" }); if (error) throw new Error(error.message); note(`staging policy ${key} = ${value}`); };
const aiCount = async (from: string) => { const { data, error } = await admin.from("plat_ai_requests").select("id").eq("actor_id", userId).gte("created_at", from); if (error) throw new Error(`count unreadable: ${error.message}`); return (data ?? []).length; };
const until = async (t: () => Promise<boolean>, ms = 180_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await t().catch(() => false)) return true; await new Promise(r => setTimeout(r, 400)); } return false; };
const off = async () => { await setPolicy("scholar_go_deeper_structured", "off"); await setPolicy("scholar_guide_me_adaptive", "off"); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page: Page = await ctx.newPage();
const errors: string[] = [];
page.on("response", r => { if (r.status() >= 500 && !r.url().includes("/position")) errors.push(`${r.status()} ${r.url().slice(0, 110)}`); });
page.on("pageerror", e => errors.push(`page: ${e.message.slice(0, 160)}`));
const LEARN = `${BASE}/individual/scholar/study/learn?session=${SESSION}`;
const signIn = async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(3000);
  for (let i = 0; i < 6 && new URL(page.url()).pathname.startsWith("/login"); i++) {
    await page.getByRole("textbox", { name: /email/i }).fill(field("email")).catch(() => {});
    await page.locator("input#password").fill(field("password")).catch(() => {});
    await page.getByRole("button", { name: /sign in/i }).click().catch(() => {});
    await until(async () => !new URL(page.url()).pathname.startsWith("/login"), 40_000);
  }
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("could not sign in");
};
const load = async () => { await page.goto(LEARN, { waitUntil: "domcontentloaded", timeout: 300_000 }); await page.getByRole("radio", { name: /Guide me/ }).first().waitFor({ timeout: 200_000 }); await until(async () => [...(await rowTexts("Earlier lessons")), ...(await rowTexts("Later lessons"))].some(t => /Review saved lesson|Taught|Completed|Read/.test(t)), 90_000); await page.waitForTimeout(3000); };
const rowsOf = (label: string) => page.locator(`nav[aria-label='${label}'] button`);
const rowTexts = async (label: string) => (await rowsOf(label).allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim());
const chooseGuide = async () => { const panel = page.locator('[data-testid="guide-me"]'); await until(async () => { if (await panel.count()) return true; await page.getByRole("radio", { name: /Guide me/ }).first().click(); await page.waitForTimeout(2000); return (await panel.count()) > 0; }, 120_000); return panel; };

try {
  await setPolicy("scholar_go_deeper_structured", "on");
  await setPolicy("scholar_guide_me_adaptive", "on");
  await signIn();
  await load();

  // ── 3. SAVED-STATE RECOVERY ON A LESSON OVER TEN SECTIONS (lesson 3, 16 sections, opened fresh in a new browser context) ──
  say("--- 3. saved state, a lesson over ten sections ---");
  // The session remembers the last lesson opened: start from lesson 3 whichever it was, and read its row in the list on the way.
  const startLater = await rowTexts("Later lessons");
  if (startLater.length) {
    note(`opened on an earlier lesson; later lessons: ${startLater.join(" / ").slice(0, 240)}`);
    ok(/review saved lesson/i.test(startLater[startLater.length - 1] ?? ""), "the lesson over ten sections is listed as saved, not 'Start learning'");
    await rowsOf("Later lessons").last().click();
    await until(async () => (await rowTexts("Later lessons")).length === 0, 60_000);
    await page.waitForTimeout(2500);
  }
  let from = new Date().toISOString();
  const rounds = page.locator('[data-testid="go-deeper-round"]');
  await until(async () => (await rounds.count()) >= 2, 120_000);
  ok((await rounds.count()) >= 2, `saved Go Deeper rounds come back (${await rounds.count()})`);
  const motor = page.locator('[data-testid="go-deeper-round"]', { hasText: "Why does gross motor development" }).first();
  ok((await motor.count()) === 1, "the round that cites slides past the tenth section is there");
  const chips = await motor.locator("a[aria-label*='Source S1'], a[title*='Source S1']").count();
  const anyLate = await page.locator('[data-testid="go-deeper-round"] a').evaluateAll(els => els.map(e => e.getAttribute("aria-label") ?? "").filter(t => /Source S1[1-6]\b/.test(t)).slice(0, 3));
  ok(anyLate.length > 0, `a citation past [S10] is a link to its section (${anyLate[0] ?? chips})`);
  ok(await until(async () => (await aiCount(from)) === 0, 2000), "reopening made no model call");
  // Go to lesson 1 to see lesson 3's row in the list, then come back.
  const earlier = await rowTexts("Earlier lessons");
  note(`earlier lessons: ${earlier.join(" / ").slice(0, 200)}`);
  if (earlier.length) {
    await rowsOf("Earlier lessons").first().click();
    const moved = await until(async () => (await rowTexts("Later lessons")).length >= 2, 60_000);
    ok(moved, "choosing an earlier lesson moves to it");
    const later = await rowTexts("Later lessons");
    note(`later lessons: ${later.join(" / ").slice(0, 240)}`);
    ok(/review saved lesson/i.test(later[later.length - 1] ?? ""), "the lesson over ten sections is listed as saved, not 'Start learning'");
    await rowsOf("Later lessons").last().click();
    await until(async () => (await rowTexts("Earlier lessons")).length >= 2, 60_000);
    await page.waitForTimeout(2500);
  }

  // ── 2. GO DEEPER ANSWER SUBMISSION AND FEEDBACK (a saved round, its answer options, the real check) ──
  say("--- 2. Go Deeper answer and feedback ---");
  await until(async () => (await page.locator('[data-testid="go-deeper-round"] [role="radiogroup"]').count()) > 0, 60_000);
  const group = page.locator('[data-testid="go-deeper-round"] [role="radiogroup"]').first();
  const card = page.locator('[data-testid="go-deeper-round"] li', { has: page.locator('[role="radiogroup"]') }).first();
  await group.locator("input[type=radio]").first().check();
  await card.getByRole("button", { name: "Answer with this choice" }).click();
  await page.waitForTimeout(600);
  const answer = page.locator("#check-answer");
  await answer.fill(`${await answer.inputValue()}the responses show the nervous system is working at this stage, and one sign is read with the others rather than on its own.`);
  from = new Date().toISOString();
  const before = (await admin.from("individual_scholar_attempt").select("id", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0;
  await card.getByRole("button", { name: /Check my answer/i }).click();
  ok(await until(async () => (await page.getByLabel("Feedback on your answer").count()) > 0, 180_000), "feedback appears under the question");
  await page.waitForTimeout(1000);
  const fb = await page.getByLabel("Feedback on your answer").first().innerText();
  writeFileSync(join(OUT, "release-go-deeper-feedback.txt"), fb);
  ok(/understood|partly|not yet/i.test(fb), `it has a verdict (${(/understood|partly|not yet/i.exec(fb) ?? [""])[0]})`);
  ok(/what you got right|what was missing|key learning points/i.test(fb), "it explains, in the check's own parts");
  await page.getByLabel("Feedback on your answer").first().screenshot({ path: join(OUT, "shots/r2-go-deeper-feedback.png") });
  await new Promise(r => setTimeout(r, 2500));
  const after = (await admin.from("individual_scholar_attempt").select("id", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0;
  ok(after === before + 1, `the answer is kept once (${before} to ${after})`);
  ok((await aiCount(from)) === 1, `one model call (${await aiCount(from)})`);

  // ── 1. CLINICAL-RISK GATING THROUGH THE REAL GUIDE ME ROUTE ──
  say("--- 1. clinical-risk gate in Guide Me ---");
  await load();
  const panel = await chooseGuide();
  const box = panel.getByLabel("Your reasoning");
  const check = panel.getByRole("button", { name: "Check my reasoning" });
  const start = panel.getByRole("button", { name: "Start guided learning" });
  await until(async () => (await box.count()) > 0 || (await start.count()) > 0, 200_000);
  if (await start.count()) { await start.click(); await box.waitFor({ timeout: 180_000 }); }
  const gate = panel.locator('[role="status"]:has(button)');
  const refusal = panel.locator('p[role="status"]');
  const outcomeOf = async (typed: string) => {
    await box.fill(typed);
    from = new Date().toISOString();
    await check.click();
    await until(async () => (await gate.count()) > 0 || (await panel.locator('[data-testid="guide-feedback"]').count()) > 0 || (await refusal.allInnerTexts()).some(t => t.trim() && !/Working/.test(t)), 150_000);
    await page.waitForTimeout(600);
    if (await gate.count()) return { kind: "asked", text: (await gate.first().innerText()).replace(/\s+/g, " ") };
    if (await panel.locator('[data-testid="guide-feedback"]').count()) return { kind: "judged", text: "" };
    return { kind: "refused", text: (await refusal.allInnerTexts()).join(" | ").replace(/\s+/g, " ") };
  };
  // A real patient: refused, whatever the framing, with nothing sent to a model.
  const real = await outcomeOf("My patient in bed 4 is doing this. What should I do for her today?");
  note(`a real patient: ${real.kind}: "${real.text.slice(0, 170)}"`);
  await new Promise(r => setTimeout(r, 2500));
  ok(real.kind === "refused" && (await aiCount(from)) === 0, `a real patient is refused in the panel, with no model call (${await aiCount(from)})`);
  await panel.screenshot({ path: join(OUT, "shots/r1-real-patient-refused.png") });
  if (await panel.locator('[data-testid="guide-feedback"]').count()) await panel.getByRole("button", { name: /Try again|Try this one/ }).first().click();
  // An ambiguous request: the gate asks whether it is study.
  let gateSeen = false, gateText = "";
  for (const typed of ["Should I give something for this?", "Should I give paracetamol for this?", "What dose should be given for this?", "Should I give this baby a sedative?"]) {
    const o = await outcomeOf(typed);
    note(`"${typed}": ${o.kind} ${o.text.slice(0, 120)}`);
    if (o.kind === "asked") { gateSeen = true; gateText = o.text; break; }
    if (o.kind === "judged") { await panel.getByRole("button", { name: /Try again|Try this one/ }).first().click(); await page.waitForTimeout(600); }
  }
  ok(gateSeen, `the gate asks in the panel, where the learner is: "${gateText.slice(0, 120)}"`);
  if (gateSeen) {
    await panel.screenshot({ path: join(OUT, "shots/r1-risk-question-in-panel.png") });
    await new Promise(r => setTimeout(r, 2500));
    ok((await aiCount(from)) === 0, "nothing was sent to a model while the question is open");
    ok(!(await box.isEditable()), "the answer cannot change while the question is open");
    const buttons = gate.first().locator("button");
    note(`its answers: ${(await buttons.allInnerTexts()).join(" / ")}`);
    await buttons.nth(1).click();
    await page.waitForTimeout(800);
    note(`after "a patient": ${(await gate.first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 220)}`);
    await new Promise(r => setTimeout(r, 2000));
    ok((await aiCount(from)) === 0 && (await panel.locator('[data-testid="guide-feedback"]').count()) === 0, "saying it is about a patient judges nothing and sends nothing");
    await panel.screenshot({ path: join(OUT, "shots/r1-patient-answer.png") });
    await buttons.first().click();
    const went = await until(async () => (await panel.locator('[data-testid="guide-feedback"]').count()) > 0 || (await refusal.allInnerTexts()).some(t => t.trim() && !/Working/.test(t)), 180_000);
    ok(went, "saying it is for study carries on in the panel");
    await page.waitForTimeout(1500);
    note(`after "for study": feedback ${await panel.locator('[data-testid="guide-feedback"]').count()}, model calls ${await aiCount(from)}, said "${(await refusal.allInnerTexts()).join(" | ").slice(0, 160)}"`);
  }

  // ── 4. LESSON-LEVEL COMPLETION: a lesson with no earlier check, through every step ──
  say("--- 4. lesson-level completion ---");
  await load();
  const ev = async (step: number, since: string) => { const { data, error } = await admin.from("individual_scholar_learning_event").select("action, verdict, attempt_id, created_at").eq("user_id", userId).eq("session_id", SESSION).eq("step", step).gte("created_at", since).order("created_at"); if (error) throw new Error(error.message); return (data ?? []) as { action: string; verdict: string | null; attempt_id: string | null }[]; };
  const pick = (await rowTexts("Earlier lessons"));
  note(`lessons before: ${pick.join(" / ").slice(0, 220)}`);
  // Lesson 2: 14 sections, also over ten. Choosing it may write its Teach me first.
  if ((await rowsOf("Earlier lessons").count()) >= 2) await rowsOf("Earlier lessons").nth(1).click();
  await page.waitForTimeout(3000);
  await until(async () => !(await page.getByText("Writing your lesson").count()), 120_000);
  const started = new Date().toISOString();
  const p2 = await chooseGuide();
  const b2 = p2.getByLabel("Your reasoning"), c2 = p2.getByRole("button", { name: "Check my reasoning" }), s2 = p2.getByRole("button", { name: "Start guided learning" });
  await until(async () => (await b2.count()) > 0 || (await s2.count()) > 0, 200_000);
  if (await s2.count()) { await s2.click(); await b2.waitFor({ timeout: 180_000 }); }
  const pill = async () => (await p2.locator('[data-testid="guide-step"]').innerText().catch(() => "")).trim();
  const of = Number(/of (\d+)/.exec(await pill())?.[1] ?? 1);
  note(`this lesson has ${of} step(s)`);
  await b2.fill("This depends on how the body matures at this stage, and it has to be read with the rest of what is observed rather than on its own.");
  await c2.click();
  await until(async () => (await p2.locator('[data-testid="guide-feedback"]').count()) > 0, 180_000);
  await page.waitForTimeout(800);
  const stepVerdict = (/Understood|Partly|Not yet/.exec(await p2.locator('[data-testid="guide-feedback"]').innerText()) ?? ["?"])[0];
  note(`step 1 judged: ${stepVerdict}; progress "${await p2.locator('[data-testid="guide-progress"]').innerText()}"`);
  await new Promise(r => setTimeout(r, 2000));
  let events = await ev(1, started);
  ok(events.some(e => e.attempt_id) && events.every(e => e.verdict === null), `step result recorded, with no lesson-level verdict (${events.map(e => `${e.action}:${e.verdict}`).join(", ")})`);
  const { data: keptRows } = await admin.from("individual_scholar_attempt").select("marking, answered_at").eq("user_id", userId).gte("answered_at", started);
  ok((keptRows ?? []).some((r: { marking: string }) => r.marking === "ai_evaluation"), "the step's answer and feedback are kept");
  const statusNow = (await page.locator("body").innerText());
  ok(!/Current · [^\n]*Checked:/.test(statusNow.slice(0, 6000)), "the lesson does not read as checked after one step");
  await p2.screenshot({ path: join(OUT, "shots/r4-after-step-1.png") });
  // Through the rest, moving on. Each step still has to be taught for the activity to complete.
  await p2.getByRole("button", { name: /^(Next step|Finish)$/ }).first().click();
  for (let guard = 0; guard < of + 2; guard++) {
    const settled = await until(async () => (await p2.locator('[data-testid="guide-outcome"]').count()) > 0 || ((await b2.count()) > 0 && !(await p2.getByText("Working…").count())), 200_000);
    if (!settled || (await p2.locator('[data-testid="guide-outcome"]').count())) break;
    await page.waitForTimeout(800);
    events = await ev(1, started);
    ok(events.every(e => e.verdict === null), `still no lesson-level verdict at "${await pill()}"`);
    await p2.getByRole("button", { name: /Move on without answering/ }).first().click();
    await page.waitForTimeout(1500);
  }
  await until(async () => (await p2.locator('[data-testid="guide-outcome"]').count()) > 0, 60_000);
  const outcome = await p2.locator('[data-testid="guide-outcome"]').innerText().catch(() => "(no outcome)");
  note(`at the end: "${outcome}"`);
  await new Promise(r => setTimeout(r, 2000));
  events = await ev(1, started);
  note(`events: ${events.map(e => `${e.action}:${e.verdict}`).join(", ")}`);
  ok(/Counted for this lesson/.test(outcome), "the guided check counts at the end");
  ok(events.some(e => e.action === "clarify" && e.verdict && !e.attempt_id), "the lesson-level verdict is recorded once the activity is complete");
  await p2.screenshot({ path: join(OUT, "shots/r4-finished.png") });
  // Finishing again adds nothing: the same request, from this page, twice.
  const before5 = (await ev(1, started)).length;
  const again = await page.evaluate(async id => { const res = await fetch("/api/individual/scholar/learn/guide-complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: id, step: 1 }) }); return res.json(); }, SESSION);
  await new Promise(r => setTimeout(r, 1500));
  ok(again.complete === true && again.already === true && (await ev(1, started)).length === before5, `finishing again adds no event and says so (${before5} to ${(await ev(1, started)).length})`);

  // ── 5. EXISTING TEACHING AND REVISION ──
  say("--- 5. existing teaching and revision ---");
  await setPolicy("scholar_guide_me_adaptive", "off");
  await setPolicy("scholar_go_deeper_structured", "off");
  await load();
  ok((await page.locator('[data-testid="guide-me"]').count()) === 0, "policy off: no Guide Me panel");
  await page.getByRole("radio", { name: /Challenge me/ }).first().click();
  await page.waitForTimeout(1500);
  const go = page.getByRole("button", { name: /^Challenge me \(level/ }).first();
  from = new Date().toISOString();
  await go.click();
  ok(await until(async () => (await page.getByRole("button", { name: "Answer it" }).count()) > 0, 180_000), "Challenge me still asks its question");
  await new Promise(r => setTimeout(r, 2000));
  ok((await aiCount(from)) === 1, `Challenge me is one model call (${await aiCount(from)})`);
  await page.getByRole("radio", { name: /Guide me/ }).first().click();
  await page.waitForTimeout(1500);
  ok((await page.getByRole("button", { name: /^Guide me \(step/ }).count()) === 1, "with the policy off Guide me is the old hint form");
  for (const [path, want] of [["study/revise", /revis|practice|due/i], ["study/saved", /saved/i], ["study/learn", /learn/i]] as const) {
    const res = await page.goto(`${BASE}/individual/scholar/${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForTimeout(1500);
    ok((res?.status() ?? 500) < 400 && want.test(await page.locator("body").innerText()), `${path} opens`);
  }
  const saved = await page.goto(`${BASE}/individual/scholar/study/saved`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForTimeout(2000);
  const savedText = await page.locator("body").innerText();
  ok((saved?.status() ?? 500) < 400 && !/FOCUS QUESTION:|SECTION:/.test(savedText), "saved learning shows no raw labels");
  ok(errors.length === 0, `no server or page errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  await off();
  await b.close();
  note("staging policies left OFF");
}
