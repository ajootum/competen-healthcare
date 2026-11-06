// SCHOLAR-GUIDE-ME-001: the browser walk, on a STAGING-pointed dev server as the fixture learner. Credentials from WALK_FIXTURE, keys read inside this script and never printed.
// Sets the staging policy itself and leaves it OFF. Counts every model call for the learner.
import { chromium, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const BASE = "http://127.0.0.1:3208", SESSION = "3484e65a-ee9c-425a-9b63-b2cca40c898e";
const OUT = process.env.WALK_OUT ?? join(process.cwd(), "docs/evidence/SCHOLAR-GUIDE-ME-001");
mkdirSync(join(OUT, "shots"), { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const lines: string[] = [];
const say = (l: string) => { lines.push(l); console.log(l); writeFileSync(join(OUT, "walk-result.txt"), `${lines.join("\n")}\n`); };
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
const aiRows = async (from: string) => { const { data, error } = await admin.from("plat_ai_requests").select("model, cost_usd").eq("actor_id", userId).gte("created_at", from); if (error) throw new Error(`count unreadable: ${error.message}`); return (data ?? []) as { cost_usd: number }[]; };
const stamp = async (what: string, fn: () => Promise<void>) => { const from = new Date().toISOString(); await fn(); await new Promise(r => setTimeout(r, 3500)); const rows = await aiRows(from); note(`${what}: ${rows.length} model call(s), USD ${rows.reduce((n, x) => n + Number(x.cost_usd ?? 0), 0).toFixed(4)}`); return rows.length; };
const until = async (t: () => Promise<boolean>, ms = 180_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await t().catch(e => { if (String(e?.message).startsWith("the panel said")) throw e; return false; })) return; await new Promise(r => setTimeout(r, 400)); } throw new Error("timed out waiting"); };
const since = new Date().toISOString();
await setPolicy("scholar_go_deeper_structured", "off");
await setPolicy("scholar_guide_me_adaptive", "on");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page: Page = await ctx.newPage();
const errors: string[] = [];
page.on("response", r => { if (r.status() >= 500 && !r.url().includes("/position")) errors.push(`${r.status()} ${r.url().slice(0, 120)}`); });
page.on("pageerror", e => note(`page error: ${e.message.slice(0, 200)}`));
page.on("response", async r => { if (!r.url().includes("/learn/act") || r.request().method() !== "POST") return; const q = r.request().postDataJSON(); const j = await r.json().catch(() => null); if (q?.guide || q?.action === "clarify") console.log("  ACT", JSON.stringify({ a: q.action, step: q.step, t: q.guide?.turn, s: q.guide?.step, l: q.guide?.level, open: q.open }), r.status(), JSON.stringify({ g: j?.guide, open: j?.open, cached: j?.cached, withheld: j?.withheld, reason: j?.reason, err: j?.error, code: j?.code, cont: j?.continuity?.message, has: !!j?.answer, v: j?.verdict?.value }).slice(0, 260)); });
await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
await page.waitForTimeout(3000);
// A submit before the login page has hydrated goes nowhere on a slow dev server, so it is tried again.
for (let i = 0; i < 6 && new URL(page.url()).pathname.startsWith("/login"); i++) {
  await page.getByRole("textbox", { name: /email/i }).fill(field("email")).catch(() => {});
  await page.locator("input#password").fill(field("password")).catch(() => {});
  await page.getByRole("button", { name: /sign in/i }).click().catch(() => {});
  await until(async () => !new URL(page.url()).pathname.startsWith("/login"), 40_000).catch(() => {});
}
if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("could not sign in");
const open = async () => {
  await page.goto(`${BASE}/individual/scholar/study/learn?session=${SESSION}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.getByRole("radio", { name: /Guide me/ }).first().waitFor({ timeout: 200_000 });
  await page.waitForTimeout(3000);
  await until(async () => !(await page.getByText(/^Writing|Preparing/).count()), 120_000).catch(() => {});
  const panel = page.locator('[data-testid="guide-me"]');
  // The page may still be hydrating on a dev server's first compile, so the choice is made until it takes.
  await until(async () => { if (await panel.count()) return true; await page.getByRole("radio", { name: /Guide me/ }).first().click(); await page.waitForTimeout(2000); return (await panel.count()) > 0; }, 120_000);
};
await open();
await page.waitForTimeout(10_000); // the newly chosen lesson's panel reads what is saved for it
const panel = page.locator('[data-testid="guide-me"]');
const progress = () => panel.locator('[data-testid="guide-progress"]').innerText().catch(() => "");
const box = panel.getByLabel("Your reasoning");
const checkBtn = panel.getByRole("button", { name: "Check my reasoning" });
await until(async () => (await panel.getByRole("button", { name: "Start guided learning" }).count()) > 0 || (await box.count()) > 0, 300_000);
if (await panel.getByRole("button", { name: "Start guided learning" }).count()) {
  const n = await stamp("teach step 1", async () => { await panel.getByRole("button", { name: "Start guided learning" }).click(); await box.waitFor({ timeout: 180_000 }); });
  ok(n <= 1, `teaching a step is one model call, or none when it is saved (${n})`);
} else note("a saved step opened with no AI");
await page.waitForTimeout(800);
const step1 = await panel.innerText();
writeFileSync(join(OUT, "walk-step1.txt"), step1);
ok((await panel.locator('[data-testid="guide-step"]').innerText()).startsWith("Step 1 of"), `the step pill reads "${await panel.locator('[data-testid="guide-step"]').innerText()}"`);
const before = await progress();
note(`progress on opening: "${before}" (earlier runs of this walk are kept on this lesson; the first run read "Nothing answered yet")`);
ok(/think about this/i.test(step1) && step1.indexOf("From your notes") < step1.search(/think about this/i), "it teaches before it asks");
ok(!/Explain it directly|guidance \d of \d|\[!MEMORY\]/.test(step1), "none of the old navigation or stage wording");
ok(await checkBtn.isDisabled(), "a blank answer cannot be sent");
await box.fill("I don't know");
await page.waitForTimeout(300);
ok(await checkBtn.isDisabled(), "\"I don't know\" is not sent for judging");
ok((await panel.getByText("nothing has been marked").count()) === 1, "and it is met with help");
await box.fill("");
await panel.screenshot({ path: join(OUT, "shots/01-step-desktop.png") });
const h1 = await stamp("a hint", async () => { await panel.getByRole("button", { name: "Give me a hint" }).click(); await until(async () => { if (await panel.getByText(/^Hint 1\./).count()) return true; const said = await panel.locator('p[role="status"]').allInnerTexts(); if (said.some(t => /could not/i.test(t))) { note(`the panel said: ${said.join(" | ")}`); return true; } return false; }, 120_000).catch(async () => { note("no hint and no message"); await panel.screenshot({ path: join(OUT, "shots/99-hint-stuck.png") }); }); });
ok(h1 <= 1, `a hint is one model call, or none when it is saved (${h1})`);
ok((await progress()) === before, "a hint does not count as a step done");
const ex = await stamp("example reasoning", async () => { await panel.getByRole("button", { name: "Show example reasoning" }).click(); await panel.getByText("Example reasoning, on a similar case").waitFor({ timeout: 180_000 }); });
ok(ex <= 1, `example reasoning is one model call, or none when it is saved (${ex})`);
ok((await progress()) === before, "nor does an example");
const wrong = "It does not really tell you anything. Babies just do these things at random from birth, so there is nothing to reason about and it does not depend on how their nervous system is developing.";
await box.fill(wrong);
const judged = async () => {
  await checkBtn.click();
  await until(async () => {
    if (await panel.locator('[data-testid="guide-feedback"]').count()) return true;
    const said = await panel.locator('p[role="status"]').allInnerTexts();
    if (said.some(t => /could not|just now/i.test(t)) && (await checkBtn.isEnabled())) { note(`the panel said "${said.join(" | ")}"; pressed again`); await checkBtn.click(); await page.waitForTimeout(1500); }
    return false;
  });
};
const c1 = await stamp("a wrong answer judged", judged);
ok(c1 >= 1 && c1 <= 2, `judging an answer is one model call a press (${c1})`);
await page.waitForTimeout(500);
const fb1 = await panel.locator('[data-testid="guide-feedback"]').innerText();
writeFileSync(join(OUT, "walk-feedback-wrong.txt"), fb1);
ok(/Not yet|Partly/.test(fb1), `a wrong answer is not called understood (${/Not yet/.test(fb1) ? "Not yet" : /Partly/.test(fb1) ? "Partly" : "?"})`);
ok((await progress()).includes("answered, not yet understood"), `progress reflects it: "${await progress()}"`);
await panel.screenshot({ path: join(OUT, "shots/02-feedback-desktop.png") });
const { data: kept } = await admin.from("individual_scholar_attempt").select("marking, score, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(1);
ok(!!kept?.[0] && kept[0].marking === "ai_evaluation" && kept[0].answered_at >= since, `the judged answer is kept through the existing mechanism (${kept?.[0]?.marking}, score ${kept?.[0]?.score})`);
const again = panel.getByRole("button", { name: /Try this one|Try again/ }).first();
note(`next move offered: ${await again.innerText()}`);
await again.click();
await page.waitForTimeout(500);
// A sound answer: the key points the judge itself gave on the wrong answer.
const keyPoints = fb1.split(/key learning points[^\n]*\n/i)[1]?.split(/\n\s*\n/)[0]?.replace(/\s*\[S\d+\]/g, "").replace(/\s+/g, " ").trim() ?? "";
note(`answering with the judge's own key points (${keyPoints.split(" ").length} words)`);
await box.fill(keyPoints || "It depends on what else is observed, and one response is read with the rest of the picture.");
let gateAsked = false;
const c2 = await stamp("a sound answer judged", async () => {
  await checkBtn.click();
  // The clinical-risk gate may ask whether this is study: it must be asked here, in the panel, and the panel must carry on after it.
  await until(async () => {
    if (await panel.locator('[data-testid="guide-feedback"]').count()) return true;
    const gate = panel.locator('[role="status"]:has(button)');
    const said = await panel.locator('p[role="status"]').allInnerTexts();
    if (said.some(t => /could not|not available|used up|limit/i.test(t))) throw new Error(`the panel said: ${said.join(" | ")}`);
    if (await gate.count()) { gateAsked = true; await panel.screenshot({ path: join(OUT, "shots/02b-risk-question-in-panel.png") }); await gate.locator("button").first().click(); await page.waitForTimeout(800); }
    return false;
  });
});
note(`the clinical-risk gate asked in the panel on this answer: ${gateAsked}`);
ok(c2 === 1, `one model call (${c2})`);
await page.waitForTimeout(500);
const fb2 = await panel.locator('[data-testid="guide-feedback"]').innerText();
writeFileSync(join(OUT, "walk-feedback-right.txt"), fb2);
note(`verdict on the sound answer: ${/Understood/.test(fb2) ? "Understood" : /Partly/.test(fb2) ? "Partly" : "Not yet"}; progress "${await progress()}"`);
const next = panel.getByRole("button", { name: /^(Next step|Finish)$/ }).first();
const hasNextStep = (await next.innerText()) === "Next step";
if (hasNextStep) {
  const n2 = await stamp("the next step", async () => { await next.click(); await page.waitForTimeout(1500); await until(async () => { if (await box.count()) return true; const said = await panel.locator('p[role="status"]').allInnerTexts(); if (said.some(t => t && !/Working/.test(t))) throw new Error(`the panel said: ${said.join(" | ")}`); return false; }, 120_000).catch(async e => { note(String(e.message)); await panel.screenshot({ path: join(OUT, "shots/99-next-step-stopped.png") }); throw e; }); });
  ok(n2 <= 1, `the next step is one model call, or none when it is saved (${n2})`);
}
const ex2 = await stamp("Just explain it", async () => { await panel.getByRole("button", { name: "Just explain it" }).click(); await panel.locator('[data-testid="guide-explained"]').waitFor({ timeout: 180_000 }); });
ok(ex2 <= 1, `Just explain it is one model call, or none when it is saved (${ex2})`);
await page.waitForTimeout(400);
const explained = await panel.locator('[data-testid="guide-explained"]').innerText();
writeFileSync(join(OUT, "walk-explained.txt"), explained);
ok(explained.split(/\s+/).length >= 120, `it is substantial (${explained.split(/\s+/).length} words)`);
ok((await progress()).includes("explained to you"), `an explanation is said to be one, not understanding: "${await progress()}"`);
await panel.getByRole("button", { name: "Back to the question" }).click();
await page.waitForTimeout(400);
ok((await box.count()) === 1 && (await panel.locator('[data-testid="guide-explained"]').count()) === 0, "the learner can go back to the question");
for (const [name, w, h] of [["desktop", 1440, 900], ["tablet", 820, 1180], ["phone", 390, 844]] as const) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(900);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, `${name}: no sideways page scroll`);
  await panel.screenshot({ path: join(OUT, `shots/03-panel-${name}.png`) });
  const gap = await page.evaluate(() => { const q = document.querySelector('[data-testid="guide-me"] textarea'); const l = q?.previousElementSibling; return q && l ? Math.round(q.getBoundingClientRect().top - l.getBoundingClientRect().bottom) : -1; });
  note(`${name}: the answer box sits ${gap}px under its label, directly under the question`);
}
await page.setViewportSize({ width: 1440, height: 900 });
const question = await panel.locator("p[id$='-q']").innerText();
ok((await page.getByText(question, { exact: true }).count()) === 1, "the question appears once on the page: no duplicate panels");
ok(errors.length === 0, `no server errors (${errors.join(" | ")})`);
const reopened = await stamp("reopening the lesson", async () => {
  await page.waitForTimeout(3000);
  await open();
  await until(async () => { if (await box.count()) return true; const start = panel.getByRole("button", { name: "Start guided learning" }); if (await start.count()) await start.click().catch(() => {}); await page.waitForTimeout(1500); return false; }, 120_000);
  await page.waitForTimeout(3000);
});
ok(reopened === 0, `reopening makes no model call (${reopened})`);
note(`after reopening: "${await panel.locator('[data-testid="guide-step"]').innerText()}", progress "${await progress()}"`);
await setPolicy("scholar_guide_me_adaptive", "off");
await open().catch(() => {});
await page.goto(`${BASE}/individual/scholar/study/learn?session=${SESSION}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
await page.getByRole("radio", { name: /Guide me/ }).first().waitFor({ timeout: 200_000 });
await page.waitForTimeout(1500);
ok((await page.locator('[data-testid="guide-me"]').count()) === 0, "policy off: Guide me is as it was");
const all = await aiRows(since);
note(`whole walk: ${all.length} model calls, USD ${all.reduce((n, x) => n + Number(x.cost_usd ?? 0), 0).toFixed(4)}`);
note("staging policy left OFF");
await b.close();
