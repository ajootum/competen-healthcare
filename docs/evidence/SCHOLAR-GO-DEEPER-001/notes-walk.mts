// My Ideas & Notes inside Go Deeper and Guide Me, on a STAGING-pointed dev server as the fixture learner. Each switch goes back to where it was at the end.
// Notes it writes are the fixture learner's and say they are from this walk. No hard deletes.
import { chromium, type Locator, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const BASE = "http://127.0.0.1:3210", SESSION = "3484e65a-ee9c-425a-9b63-b2cca40c898e";
const OUT = process.env.WALK_OUT!;
mkdirSync(join(OUT, "shots"), { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const lines: string[] = [];
const say = (l: string) => { lines.push(l); console.log(l); writeFileSync(join(OUT, "notes-walk-result.txt"), `${lines.join("\n")}\n`); };
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
const setPolicy = async (key: string, value: string) => { const { error } = await admin.from("workspace_config_overrides").upsert({ scope_type: "platform", scope_ref: "individual", config_path: `individual.policy.${key}`, published: { value }, updated_at: new Date().toISOString() }, { onConflict: "scope_type,scope_ref,config_path" }); if (error) throw new Error(error.message); note(`staging policy ${key} = ${value}`); };
const aiCount = async (from: string) => { const { data, error } = await admin.from("plat_ai_requests").select("id").eq("actor_id", userId).gte("created_at", from); if (error) throw new Error(`count unreadable: ${error.message}`); return (data ?? []).length; };
const until = async (t: () => Promise<boolean>, ms = 120_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await t().catch(() => false)) return true; await new Promise(r => setTimeout(r, 400)); } return false; };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page: Page = await ctx.newPage();
const errors: string[] = [];
page.on("response", r => { if (r.status() >= 500 && !r.url().includes("/position")) errors.push(`${r.status()} ${r.url().slice(0, 110)}`); });
page.on("pageerror", e => errors.push(`page: ${e.message.slice(0, 160)}`));
const rowsOf = (label: string) => page.locator(`nav[aria-label='${label}'] button`);
const rowTexts = async (label: string) => (await rowsOf(label).allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim());
const load = async () => {
  await page.goto(`${BASE}/individual/scholar/study/learn?session=${SESSION}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.getByRole("radio", { name: /Guide me/ }).first().waitFor({ timeout: 200_000 });
  await until(async () => [...(await rowTexts("Earlier lessons")), ...(await rowTexts("Later lessons"))].some(t => /Review saved lesson|Taught|Completed|Read/.test(t)), 90_000);
  await page.waitForTimeout(3000);
};
const toLesson3 = async () => { if ((await rowTexts("Later lessons")).length) { await rowsOf("Later lessons").last().click(); await until(async () => (await rowTexts("Later lessons")).length === 0, 60_000); await page.waitForTimeout(2500); } };
const boxes = (within: Locator | Page) => within.locator('[data-testid="my-ideas-box"]');
// One tap opens it, the words go in, and it saves by itself.
const write = async (box: Locator, words: string) => {
  await box.locator("button[aria-expanded]").first().click();
  const field = box.locator("textarea").first();
  await field.waitFor({ timeout: 20_000 });
  await field.fill(words);
  await until(async () => { const { data } = await admin.from("individual_scholar_note").select("id").eq("user_id", userId).ilike("body", `%${words}%`); return (data ?? []).length === 1; }, 30_000);
};
const stored = async (words: string) => { const { data, error } = await admin.from("individual_scholar_note").select("*").eq("user_id", userId).ilike("body", `%${words}%`); if (error) throw new Error(error.message); return (data ?? []) as Record<string, unknown>[]; };

const RUN = Date.now().toString(36);
const { data: was } = await admin.from("workspace_config_overrides").select("published").eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", "individual.policy.scholar_personal_notebook").maybeSingle();
const notebookWas = String((was?.published as { value?: string } | null)?.value ?? "off");
try {
  await setPolicy("scholar_go_deeper_structured", "on");
  await setPolicy("scholar_guide_me_adaptive", "on");
  await setPolicy("scholar_personal_notebook", "on");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(3000);
  for (let i = 0; i < 6 && new URL(page.url()).pathname.startsWith("/login"); i++) {
    await page.getByRole("textbox", { name: /email/i }).fill(field("email")).catch(() => {});
    await page.locator("input#password").fill(field("password")).catch(() => {});
    await page.getByRole("button", { name: /sign in/i }).click().catch(() => {});
    await until(async () => !new URL(page.url()).pathname.startsWith("/login"), 40_000);
  }
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("could not sign in");
  await load();
  await toLesson3();
  let from = new Date().toISOString();

  // ── GO DEEPER ──
  say("--- Go Deeper ---");
  const rounds = page.locator('[data-testid="go-deeper-round"]');
  await until(async () => (await rounds.count()) >= 1, 60_000);
  const round = rounds.first();
  const inRound = boxes(round);
  await until(async () => (await inRound.count()) > 0, 30_000);
  const count = await inRound.count();
  ok(count > 1, `a round has a note line for its sections (${count})`);
  const anchors = await inRound.evaluateAll(els => els.map(e => e.id));
  ok(new Set(anchors).size === anchors.length, "each has its own place");
  await round.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, "shots/n1-go-deeper-closed.png") });
  const deepWords = `Notes walk ${RUN} deeper: my own idea on this section.`;
  const firstBox = inRound.first();
  await write(firstBox, deepWords);
  const deepRow = (await stored(deepWords))[0];
  ok(!!deepRow, "the note is saved by itself");
  note(`saved with: session ${deepRow?.session_id === SESSION ? "this one" : "OTHER"}, step ${deepRow?.step}, anchor ${deepRow?.section_anchor}, label "${String(deepRow?.section_label).slice(0, 60)}", chunk ${deepRow?.chunk_id ?? "none"}`);
  ok(deepRow?.session_id === SESSION && deepRow?.step === 2 && deepRow?.section_anchor === anchors[0].replace(/^ideas-2-/, ""), "it is linked to this lesson and this section");
  await firstBox.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, "shots/n2-go-deeper-writing.png") });
  await load();
  await until(async () => (await boxes(rounds.first()).count()) > 0, 30_000);
  await until(async () => (await boxes(rounds.first()).first().innerText()).includes("note"), 30_000);
  const reopened = await boxes(rounds.first()).allInnerTexts();
  ok(/1 note/.test(reopened[0] ?? "") && (reopened[0] ?? "").includes(RUN), "after a reload it is back under its section, with its words");
  ok(!(reopened[1] ?? "").includes(RUN), "the next section does not show it");

  // ── GUIDE ME ──
  say("--- Guide Me ---");
  const panel = page.locator('[data-testid="guide-me"]');
  await until(async () => { if (await panel.count()) return true; await page.getByRole("radio", { name: /Guide me/ }).first().click(); await page.waitForTimeout(2000); return (await panel.count()) > 0; }, 60_000);
  const start = panel.getByRole("button", { name: "Start guided learning" });
  await until(async () => (await boxes(panel).count()) > 0 || (await start.count()) > 0, 60_000);
  if (await start.count()) { await start.click(); await until(async () => (await boxes(panel).count()) > 0, 180_000); }
  ok((await boxes(panel).count()) === 1, `one note line for the step (${await boxes(panel).count()})`);
  const pill = async () => (await panel.locator('[data-testid="guide-step"]').innerText()).trim();
  const stepAt = await pill();
  note(`at "${stepAt}"`);
  const guideWords = `Notes walk ${RUN} guide: my own idea on this step.`;
  await write(boxes(panel).first(), guideWords);
  const guideRow = (await stored(guideWords))[0];
  ok(!!guideRow && String(guideRow.section_anchor).startsWith("guide-") && guideRow.step === 2, `the step's note is linked to the step (${guideRow?.section_anchor})`);
  await panel.screenshot({ path: join(OUT, "shots/n3-guide-writing.png") });
  // Away and back: the panel is drawn again, and the note saved a moment ago is there.
  await page.getByRole("radio", { name: /Explain/ }).first().click();
  await until(async () => (await panel.count()) === 0, 20_000);
  await page.getByRole("radio", { name: /Guide me/ }).first().click();
  await until(async () => (await boxes(panel).count()) === 1, 60_000);
  ok((await pill()) === stepAt, "coming back to Guide me keeps the step");
  ok(await until(async () => (await boxes(panel).first().innerText()).includes(RUN), 20_000), "the saved note is there, not lost");
  // To the next step, unanswered: the box is the next step's own, closed and empty.
  await panel.getByRole("button", { name: /Move on without answering|Next step/ }).first().click();
  await until(async () => (await pill()) !== stepAt && (await boxes(panel).count()) === 1, 200_000);
  await page.waitForTimeout(1500);
  const nextBox = await boxes(panel).first().innerText();
  note(`next step "${await pill()}" box: "${nextBox.replace(/\s+/g, " ").slice(0, 90)}"`);
  ok(!nextBox.includes(RUN), "the next step's note line does not carry the words");
  ok((await boxes(panel).first().locator("button[aria-expanded]").first().getAttribute("aria-expanded")) === "false", "it starts closed");
  ok((await stored(guideWords)).length === 1, "the note was not written twice");
  ok((await aiCount(from)) <= 2, `notes make no model call; only teaching a new step can (${await aiCount(from)})`);

  // ── PHONE WIDTH ──
  say("--- phone width ---");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(wide <= 1, `nothing scrolls sideways at 390 (${wide})`);
  await boxes(panel).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, "shots/n4-guide-phone.png") });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── NOTEBOOK ──
  say("--- My Notebook ---");
  await page.goto(`${BASE}/individual/scholar/study/notebook`, { waitUntil: "domcontentloaded", timeout: 300_000 }).catch(() => {});
  const inBook = await until(async () => { const t = await page.locator("body").innerText(); return t.includes(`${RUN} deeper`) && t.includes(`${RUN} guide`); }, 45_000);
  ok(inBook, "both notes are in My Notebook, the one place they live");

  // ── THE SWITCHES ──
  say("--- switches ---");
  await setPolicy("scholar_personal_notebook", "off");
  await load();
  await toLesson3();
  await until(async () => (await rounds.count()) >= 1, 60_000);
  await page.waitForTimeout(2000);
  ok((await boxes(page).count()) === 0, "notebook off: no note line in Go Deeper or the lesson");
  ok((await rounds.count()) >= 1, "the round is still there");
  await setPolicy("scholar_personal_notebook", "on");
  await setPolicy("scholar_go_deeper_structured", "off");
  await setPolicy("scholar_guide_me_adaptive", "off");
  await load();
  await page.waitForTimeout(2000);
  ok((await rounds.count()) === 0 && (await panel.count()) === 0, "both teaching switches off: neither shows, and no new surface appears");
  ok(errors.length === 0, `no server or page errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  await setPolicy("scholar_go_deeper_structured", "off");
  await setPolicy("scholar_guide_me_adaptive", "off");
  await setPolicy("scholar_personal_notebook", notebookWas);
  await b.close();
  note(`staging switches restored: go deeper off, guide me off, notebook ${notebookWas}`);
}
