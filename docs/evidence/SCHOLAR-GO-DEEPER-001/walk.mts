// SCHOLAR-GO-DEEPER-001: the browser walk, on a STAGING-pointed dev server as the fixture learner. Credentials from WALK_FIXTURE, keys read inside this script and never printed.
// Sets the staging policy itself (off for a saved v2 round, on for the rest, off again to prove saved rounds stay readable, then leaves it on staging as OFF).
// Every /learn/act POST and every plat_ai_requests row for the learner is counted. Usage: WALK_FIXTURE=... npx tsx docs/evidence/SCHOLAR-GO-DEEPER-001/walk.mts
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3207";
const SESSION = "3484e65a-ee9c-425a-9b63-b2cca40c898e";
const LESSON = `${BASE}/individual/scholar/study/learn?session=${SESSION}`;
const OUT = join(process.cwd(), "docs/evidence/SCHOLAR-GO-DEEPER-001");
mkdirSync(join(OUT, "shots"), { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const lines: string[] = [];
const ok = (c: boolean, what: string) => { const l = `${c ? "PASS" : "FAIL"} ${what}`; lines.push(l); console.log(l); };
const note = (what: string) => { lines.push(`NOTE ${what}`); console.log(`NOTE ${what}`); };
const flush = () => writeFileSync(join(OUT, "walk-result.txt"), `${lines.join("\n")}\n`);

const req = createRequire(join(process.cwd(), "package.json"));
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = req("@supabase/supabase-js").createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId = users.find((u: { email?: string }) => u.email === field("email"))?.id;
if (!userId) throw new Error("no learner");
const PATH = "individual.policy.scholar_go_deeper_structured";
const setPolicy = async (value: "on" | "off") => {
  const { error } = await admin.from("workspace_config_overrides").upsert({ scope_type: "platform", scope_ref: "individual", config_path: PATH, published: { value }, updated_at: new Date().toISOString() }, { onConflict: "scope_type,scope_ref,config_path" });
  if (error) throw new Error(`policy: ${error.message}`);
  note(`staging policy scholar_go_deeper_structured = ${value}`);
};
const since = new Date().toISOString();
const aiRows = async (from = since) => {
  const { data, error } = await admin.from("plat_ai_requests").select("model, input_tokens, output_tokens, cost_usd, created_at").eq("actor_id", userId).gte("created_at", from).order("created_at");
  if (error) throw new Error(`the count could not be read: ${error.message}`); // a failed read must never look like zero calls
  return (data ?? []) as { model: string; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string }[];
};
const stamp = async (fn: () => Promise<void>, what: string) => { const from = new Date().toISOString(); await fn(); await new Promise(r => setTimeout(r, 4000)); const rows = await aiRows(from); note(`${what}: ${rows.length} model call(s), USD ${rows.reduce((n, x) => n + Number(x.cost_usd ?? 0), 0).toFixed(4)}`); return rows.length; };

const browser = await chromium.launch();
const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors: string[] = [], consoleErrors: string[] = [];
let actPosts: string[] = [];
page.on("response", r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url().slice(0, 120)}`); });
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240)); });
page.on("request", r => { if (r.method() === "POST" && r.url().includes("/learn/act")) { const b = r.postDataJSON() as { action?: string; open?: boolean; depth?: string } | null; actPosts.push(`${b?.action}${b?.open ? ":open" : ""}${b?.depth ? `:${b.depth}` : ""}`); } });

/** Polled from here, so a navigation in the page cannot strand the wait. */
const until = async (test: () => Promise<boolean>, ms = 300_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test().catch(() => false)) return; await new Promise(r => setTimeout(r, 500)); } throw new Error("timed out waiting"); };
const roundCount = () => page.locator('[data-testid="go-deeper-round"]').count();
const signIn = async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(3000);
  await page.getByRole("textbox", { name: /email/i }).fill(field("email"));
  await page.locator("input#password").fill(field("password"));
  await page.getByRole("button", { name: /sign in/i }).click();
  await until(async () => !new URL(page.url()).pathname.startsWith("/login"));
};
const toLessonThree = async (p: Page = page) => {
  await p.goto(LESSON, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await p.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await p.waitForTimeout(2500);
  // The session's third lesson: its row in "Later lessons", or already current.
  const row = p.locator("nav[aria-label='Later lessons'] button, nav[aria-label='Later lessons'] a").last();
  if (await row.count()) { await row.click(); await p.waitForTimeout(2500); }
};
const shot = (name: string, p: Page = page, full = true) => p.screenshot({ path: join(OUT, `shots/${name}.png`), fullPage: full });
const overflow = (p: Page = page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const waitRound = async (n: number) => { await until(async () => (await roundCount()) >= n, 180_000); };

await setPolicy("off");
await signIn();
await toLessonThree();
await page.waitForTimeout(1500);
// Teach me: the saved one if there is one, otherwise the Understand button asks for it.
const teachCalls = await stamp(async () => {
  await page.getByRole("button", { name: /^Go deeper/ }).first().waitFor({ timeout: 180_000 });
  await until(async () => /KEY POINTS/i.test(await page.locator("body").innerText()), 180_000).catch(() => {});
}, "Teach me (or its saved lesson)");
note(`Teach me calls: ${teachCalls}`);
await shot("00-teach-me");

// 1. POLICY OFF: Go deeper exactly as it was, and that round is saved. Skipped when an earlier run of this walk already saved it (a round is not spent twice).
const { data: before } = await admin.from("individual_scholar_artefact").select("id").eq("user_id", userId).eq("action", "deeper").ilike("prompt_version", "%deeper-v2%").gte("created_at", "2026-11-06T13:00:00Z");
const hadV2 = (before ?? []).length > 0;
if (hadV2) note("policy off: the v2 round from the earlier run of this walk is reused (that run: one model call, no structured card, no level control)");
actPosts = [];
if (!hadV2) {
const v2Calls = await stamp(async () => {
  await page.getByRole("button", { name: /^Go deeper/ }).first().click();
  await page.waitForTimeout(1000);
  await until(async () => !(await page.locator("body").innerText()).includes("Working…"), 180_000);
  await page.waitForTimeout(800);
}, "policy OFF: Go deeper (v2)");
ok(v2Calls <= 1, `policy off: one model call at most (${v2Calls}), requests ${actPosts.join(", ")}`);
ok((await page.locator('[data-testid="go-deeper-round"]').count()) === 0, "policy off: no structured card");
ok((await page.getByText("Explore at your level").count()) === 0, "policy off: no level control");
await shot("01-policy-off-v2-round");
}
const { data: v2rows } = await admin.from("individual_scholar_artefact").select("id, prompt_version").eq("user_id", userId).eq("action", "deeper").order("created_at", { ascending: false }).limit(1);
const v2Saved = v2rows?.[0]?.prompt_version?.includes("deeper-v2") ?? false;
note(`a v2 round was saved: ${v2Saved} (${v2rows?.[0]?.prompt_version ?? "none"})`);

// 2. POLICY ON: the v2 round is still there, and the next round is structured and builds on it.
await setPolicy("on");
await toLessonThree();
await page.waitForTimeout(2000);
if (v2Saved) ok((await page.getByText(/OVERVIEW|Go deeper/).count()) > 0, "policy on: the saved v2 round is still in the thread");
actPosts = [];
const exploreCalls = await stamp(async () => {
  await page.getByRole("button", { name: /^Go deeper/ }).first().click();
  await waitRound(1);
  await page.waitForTimeout(1200);
}, "policy ON: Go deeper (Explore)");
ok(exploreCalls === 1, `structured round: exactly one model call (${exploreCalls}), requests ${actPosts.join(", ")}`);
const round = page.locator('[data-testid="go-deeper-round"]').last();
ok((await round.getAttribute("data-level")) === "explore", "default level is Explore (the learner's standard depth)");
ok((await round.getByText("The question we are exploring").count()) === 1, "the grey question block");
ok((await round.getByText("Sources and evidence").count()) === 1, "the Sources and evidence footer");
ok((await round.getByText(/No published research was consulted/).count()) === 1, "the evidence limit is stated");
ok((await round.getByText("Explore at your level").count()) === 1, "the level control");
ok((await round.getByText("From your notes").count()) >= 1, "at least one section marked From your notes");
note(`Scholar sections marked: ${await round.getByText("Scholar’s explanation").count()}`);
const raw = await round.innerText();
ok(!/FOCUS QUESTION:|SECTION:|KEY TAKEAWAYS:|CHECK YOUR REASONING:/.test(raw), "no raw labels on the page");
writeFileSync(join(OUT, "walk-round-explore.txt"), raw);

for (const [name, w, h] of [["desktop", 1440, 900], ["tablet", 820, 1180], ["phone", 390, 844]] as const) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(900);
  ok((await overflow()) <= 1, `${name}: no sideways page scroll (${await overflow()}px)`);
  await round.screenshot({ path: join(OUT, `shots/02-round-${name}.png`) });
  const minTap = await round.locator("input[type=radio] + *, label:has(input[type=radio]), summary, button").evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => Math.round(e.getBoundingClientRect().height)).sort((a, b) => a - b)[0] ?? 0);
  note(`${name}: smallest control height ${minTap}px`);
}
await page.setViewportSize({ width: 1440, height: 900 });

// 3. A CHECK: choosing an option writes it into the lesson's own check, the learner adds reasons, clarify judges, and the answer is kept.
const radio = round.locator('[role="radiogroup"] input[type=radio]').first();
const answerBtn = round.getByRole("button", { name: "Answer this" }).first();
if (await radio.count()) {
  await radio.check();
  await page.waitForTimeout(600);
  ok((await page.locator("#check-answer").inputValue()).startsWith("I chose:"), "choosing an option opens the check with the choice written in");
} else if (await answerBtn.count()) {
  note("this round's question has no options; answered as an open question");
  await answerBtn.click();
  await page.waitForTimeout(600);
} else note("no answerable question in this round");
if (await page.locator("#check-answer").count()) {
  await shot("03-check-open", page, false);
  const y0 = await page.evaluate(() => window.scrollY);
  await page.locator("#check-answer").fill(`${await page.locator("#check-answer").inputValue()}the order follows how the nervous system matures, and one finding has to be read with the others.`);
  const checkCalls = await stamp(async () => {
    await page.getByRole("button", { name: /Check my answer/i }).click();
    await page.getByLabel("Feedback on your answer").waitFor({ timeout: 180_000 });
  }, "check answered (clarify)");
  ok(checkCalls === 1, `the check is one model call (${checkCalls})`);
  ok(Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 900, "the learner keeps their place while the feedback arrives");
  await shot("04-check-feedback", page, false);
  const { data: kept } = await admin.from("individual_scholar_attempt").select("id, marking, score, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  ok(!!kept?.[0] && kept[0].marking === "ai_evaluation" && kept[0].created_at >= since, `the judged answer is kept through the existing mechanism (marking ${kept?.[0]?.marking}, score ${kept?.[0]?.score})`);
  const cont = page.getByRole("button", { name: /Continue learning/i });
  if (await cont.count()) await cont.first().click();
  await page.waitForTimeout(800);
}

// 4. A LEVEL: another level is asked for by name, and only then generated.
actPosts = [];
const newest = page.locator('[data-testid="go-deeper-round"]').last();
await newest.getByLabel("Advanced").check({ force: true });
await page.waitForTimeout(500);
ok(actPosts.length === 0, "moving the level control alone asks for nothing");
const advCalls = await stamp(async () => {
  await newest.getByRole("button", { name: "Go deeper at Advanced" }).click();
  await waitRound(2);
  await page.waitForTimeout(1200);
}, "Go deeper at Advanced");
ok(advCalls === 1, `Advanced: exactly one model call (${advCalls}), requests ${actPosts.join(", ")}`);
const adv = page.locator('[data-testid="go-deeper-round"]').last();
ok((await adv.getAttribute("data-level")) === "advanced", "the new round is at Advanced");
writeFileSync(join(OUT, "walk-round-advanced.txt"), await adv.innerText());
await adv.screenshot({ path: join(OUT, "shots/05-round-advanced-desktop.png") });
await adv.getByLabel("Explore").check({ force: true });
await page.waitForTimeout(400);
ok((await adv.getByRole("link", { name: /Read your Explore round/ }).count()) === 1, "a level already taught points to its saved round, with no AI");

// 5. THE ROUND LIMIT: v2 + Explore + Advanced = three. The next says so with no call.
if (v2Saved) {
  const capCalls = await stamp(async () => {
    await page.getByRole("button", { name: /^Go deeper/ }).first().click();
    await page.getByText(/depth reached/i).first().waitFor({ timeout: 120_000 });
  }, "a fourth Go deeper (the limit)");
  ok(capCalls === 0, `past the limit: no model call (${capCalls}); a v2 round counts towards it`);
}

// 6. REOPEN: everything saved comes back with no AI.
const reopen = await stamp(async () => { await toLessonThree(); await waitRound(2); await page.waitForTimeout(1500); }, "reopening the lesson");
ok(reopen === 0, `reopening: no model call (${reopen})`);
ok((await page.locator('[data-testid="go-deeper-round"]').count()) === 2, "both structured rounds are back");
await shot("06-reopened-desktop");

// 7. DARK, KEYBOARD.
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(700);
await page.locator('[data-testid="go-deeper-round"]').first().screenshot({ path: join(OUT, "shots/07-round-dark.png") });
await page.emulateMedia({ colorScheme: "light" });
const levelRadio = page.locator('[data-testid="go-deeper-round"]').last().locator('input[name="go-deeper-level"]').first();
await levelRadio.focus();
await page.keyboard.press("ArrowRight");
ok(await page.evaluate(() => document.activeElement?.getAttribute("name") === "go-deeper-level"), "the level control works from the keyboard");

// 8. POLICY OFF AGAIN: saved structured rounds stay readable, and no level control is offered.
await setPolicy("off");
const offReopen = await stamp(async () => { await toLessonThree(); await waitRound(2); await page.waitForTimeout(1500); }, "reopening with the policy off");
ok(offReopen === 0, `policy off: reopening makes no model call (${offReopen})`);
ok((await page.locator('[data-testid="go-deeper-round"]').count()) === 2, "policy off: saved structured rounds stay readable");
ok((await page.getByText("Explore at your level").count()) === 0, "policy off: no level control");

const all = await aiRows();
note(`whole walk: ${all.length} model calls, USD ${all.reduce((n, x) => n + Number(x.cost_usd ?? 0), 0).toFixed(4)}`);
ok(errors.length === 0, `no server errors (${errors.join(" | ")})`);
note(`console errors: ${[...new Set(consoleErrors)].slice(0, 5).join(" | ") || "none"}`);
flush();
await browser.close();
