// COMPETEN-NOTEBOOK-001 P1 + SCHOLAR-NOTEBOOK-UX-002: the acceptance walk, as the fixture learner, on a STAGING-pointed dev server, at one width.
// Credentials come from WALK_FIXTURE and keys are read inside this script. Neither is printed.
//   WALK_FIXTURE=<file> WALK_VIEW=desktop|tablet|phone npx tsx docs/evidence/COMPETEN-NOTEBOOK-001/walk/notebook-walk.mts
import { chromium, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://localhost:3206";
const VIEW = (process.env.WALK_VIEW ?? "desktop") as "desktop" | "tablet" | "phone";
const SIZE = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }[VIEW];
// Written outside the project and copied in afterwards: a file appearing under the project makes the dev server rebuild and reload the page mid-walk.
const OUT = process.env.WALK_OUT ?? join(process.cwd(), "docs/evidence/COMPETEN-NOTEBOOK-001/walk");
mkdirSync(join(OUT, "shots"), { recursive: true });
const SESSION = "3484e65a-ee9c-425a-9b63-b2cca40c898e";
const R = "/individual/scholar/study";
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";

const lines: string[] = [];
const ok = (c: boolean, what: string) => { const l = `${c ? "PASS" : "FAIL"} [${VIEW}] ${what}`; lines.push(l); console.log(l); return c; };
const note = (what: string) => { const l = `NOTE [${VIEW}] ${what}`; lines.push(l); console.log(l); };
const errors: string[] = [];

const req = createRequire(join(process.cwd(), "package.json"));
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = req("@supabase/supabase-js").createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId: string = users.find((u: { email?: string }) => u.email === field("email"))?.id;
if (!userId) throw new Error("no learner");

const stamp = `${VIEW}${Date.now().toString(36)}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: SIZE, hasTouch: VIEW !== "desktop", isMobile: VIEW === "phone", acceptDownloads: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("response", r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url().slice(0, 120)}`); });
page.on("pageerror", e => errors.push(`pageerror ${String(e).slice(0, 160)}`));

// Every request body that holds a note's words, outside the notes route itself. AI routes must never see them unless the learner sends them.
const words: string[] = [];
const leaks: string[] = [];
let goalApproved = false;
page.on("request", r => {
  const b = r.postData() ?? "";
  if (!b || r.url().includes("/api/individual/scholar/notebook/")) return;
  // The study goal: the learner's own click on Add to My Plan, checked below by its own step. Only that step opens this.
  if (goalApproved && r.url().includes("/api/individual/scholar/plan/entries")) return;
  // The library's own note form, whose own words go to its own notes route. Any other note's words reaching that route still count.
  const libraryForm = r.url().includes("/api/individual/scholar/library/notes");
  for (const w of words) if (b.includes(w) && !(libraryForm && w.startsWith("heron"))) leaks.push(`${r.method()} ${r.url().slice(0, 100)}`);
});

const shot = (name: string) => page.screenshot({ path: join(OUT, "shots", `${VIEW}-${name}.png`) });
const settle = async (p: Page, ms = 600) => { await p.waitForLoadState("networkidle", { timeout: 90_000 }).catch(() => {}); await p.waitForTimeout(ms); };
const open = async (path: string) => {
  // A navigation the page itself has just started (a refresh after removing a note) can abort this one: it is simply asked again.
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 }).catch(async () => { await page.waitForTimeout(1500); await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 }); });
  await settle(page);
  // A dev server hydrates slowly: wait until the shell control answers, as a learner would see it react.
  await page.waitForFunction(() => { const b = document.querySelector("[data-testid=\"quick-note-button\"]"); return !!b && Object.keys(b).some(k => k.startsWith("__reactProps")); }, null, { timeout: 120_000 });
};
const noOverflow = async (what: string) => ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${what}: nothing runs off the side`);
const noteByWords = async (w: string) => (await admin.from("individual_scholar_note").select("*").eq("user_id", userId).ilike("body", `%${w}%`)).data ?? [];
const waitSaved = async (scope = page.locator("body")) => { await scope.locator('[data-testid="note-save-status"][data-status="saved"]').first().waitFor({ timeout: 90_000 }); };

// A dev server may reload the sign-in page while it compiles, so a lost attempt is tried again.
let signedIn = false;
for (let i = 0; i < 3 && !signedIn; i++) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("textbox", { name: /email/i }).fill(field("email"));
  await page.locator("input#password").fill(field("password"));
  await page.getByRole("button", { name: /sign in/i }).click();
  signedIn = await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 90_000 }).then(() => true, () => false);
}
if (!signedIn) throw new Error("could not sign in");
// A dev server compiles each route on first use, then reloads open pages. Asked once first, so the reload cannot land mid-step. Reads, and a removal of no real id.
const NONE = "00000000-0000-4000-8000-000000000000";
for (const path of [`${R}/notebook`, `${R}/notebook/new`, `${R}/notebook/${NONE}`, `${R}/saved`, `${R}/learn?session=${SESSION}`, "/api/individual/scholar/notebook/export", `/api/individual/scholar/notebook/notes?session=${NONE}&step=0`, `/api/individual/scholar/learn/sessions/${SESSION}`, `/api/individual/scholar/library/notes?sections=${NONE}`, "/api/individual/scholar/plan/entries"]) {
  await page.request.get(`${BASE}${path}`, { timeout: 300_000 }).catch(() => {});
}
await page.request.delete(`${BASE}/api/individual/scholar/notebook/notes/${NONE}`, { timeout: 300_000 }).catch(() => {});
await page.waitForTimeout(5000);

// ── 1. Open Scholar and write at once ─────────────────────────────────────────────────────────────────────────────────────
await open("/individual/scholar");
const qbtn = page.getByTestId("quick-note-button");
ok(await qbtn.isVisible(), "Quick Note is on Scholar Home");
const btnBox = (await qbtn.boundingBox())!;
ok(btnBox.height >= (VIEW === "desktop" ? 36 : 44), `the control is big enough to tap (${Math.round(btnBox.height)}px)`);
await noOverflow("Home with the header control");
await shot("01-home");
const homeUrl = page.url();
await qbtn.click();
const panel = page.getByTestId("quick-note-panel");
await panel.waitFor({ timeout: 10_000 });
ok(await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA"), "one tap: the cursor is in the field at once");
ok(page.url() === homeUrl, "opening it does not navigate");
ok((await panel.getByTestId("note-extras").count()) === 0, "no title, tag or category is offered before writing starts");
await shot("02-quick-note-blank");
const freeWords = `Free idea quokka${stamp} about head control before sitting`;
words.push(`quokka${stamp}`);
await page.keyboard.type(freeWords);
await waitSaved(panel);
ok(/Saved/.test(await panel.getByTestId("note-save-status").innerText()), "shows Saved");
ok((await panel.getByTestId("note-extras").count()) === 1, "title and tags are offered once writing has started");
await shot("03-quick-note-saved");
let rows = await noteByWords(`quokka${stamp}`);
ok(rows.length === 1 && rows[0].target_kind === "free" && !rows[0].title && !rows[0].material_id && rows[0].client_key, "saved with no lesson, title or category: free-standing, one row");
const freeId: string = rows[0]?.id;
ok(rows[0]?.captured_in === "home", `it records where it was written (${rows[0]?.captured_in})`);
if (VIEW !== "desktop") {
  const nav = await page.locator('nav[aria-label]').last().boundingBox().catch(() => null);
  const box = (await panel.boundingBox())!;
  note(`panel ${Math.round(box.width)}x${Math.round(box.height)} at y ${Math.round(box.y)}; bottom bar at y ${nav ? Math.round(nav.y) : "none"}`);
  ok(box.x >= 0 && box.x + box.width <= SIZE.width, "the panel fits the width");
}
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
ok(!(await panel.isVisible()), "Escape closes it");
ok(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "quick-note-button"), "focus goes back to the control");

// ── 2. Find it, edit it, organise it ──────────────────────────────────────────────────────────────────────────────────────
await open(`${R}/notebook`);
ok(await page.getByTestId("my-notebook").isVisible(), "My Notebook opens");
ok((await page.getByTestId("notebook-start").count()) === 1, "the first thing is a place to start writing");
await noOverflow("My Notebook");
await shot("04-notebook");
page.on("framenavigated", f => { if (f === page.mainFrame() && process.env.WALK_TRACE) console.log("NAV", f.url().slice(21)); });
await page.getByTestId("notebook-search").fill(`quokka${stamp}`.slice(0, 12));
if (process.env.WALK_TRACE) console.log("input before enter:", await page.getByTestId("notebook-search").inputValue());
await page.getByTestId("notebook-search").press("Enter");
await page.waitForURL(/[?&]q=/, { timeout: 180_000 });
await settle(page);
ok((await page.getByTestId("notebook-results").innerText()).includes("match"), "a part-typed word finds it");
ok((await page.locator(`[data-note-id="${freeId}"]`).count()) === 1, "the note is in the results");
ok((await page.locator(`[data-note-id="${freeId}"] mark`).count()) >= 1, "the matched word is marked");
await shot("05-search");
await page.locator(`[data-note-id="${freeId}"] a`).first().click();
await page.waitForURL(`**/study/notebook/${freeId}`, { timeout: 120_000 });
await settle(page);
await noOverflow("the note's page");
const tagWord = `tag${stamp}`;
await page.getByTestId("note-title").fill(`My title ${stamp}`);
await page.getByTestId("note-tags").fill(`${tagWord}, motor`);
await page.getByTestId("note-tags").press("Enter");
await waitSaved();
await page.getByTestId("note-pin").click();
await page.waitForTimeout(600);
await waitSaved();
await page.locator('[data-testid="note-field"]').click();
await page.keyboard.press("End");
await page.keyboard.type(" and an edit");
await page.waitForTimeout(200);
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 90_000 });
rows = await noteByWords(`quokka${stamp}`);
ok(rows[0].title === `My title ${stamp}` && rows[0].tags.includes(tagWord) && !!rows[0].pinned_at && rows[0].body.endsWith("and an edit"), "edit, title, tags and pin all saved");
ok(rows[0].revision > 1, `the revision rises (${rows[0].revision})`);
await shot("06-note-page");

// Link it to a lesson when wanted, and the way back.
await page.getByTestId("note-link-open").click();
await page.getByTestId("note-link-lesson").check();
await page.getByTestId("note-link-session").selectOption(SESSION);
await page.waitForFunction(() => ((document.querySelector('[data-testid="note-link-step"]') as HTMLSelectElement | null)?.options.length ?? 0) > 1, null, { timeout: 90_000 });
await page.getByTestId("note-link-step").selectOption({ index: 1 });
await shot("07-link");
await page.getByTestId("note-link-apply").click();
await page.waitForTimeout(800);
await waitSaved();
rows = await noteByWords(`quokka${stamp}`);
ok(rows[0].target_kind === "lesson" && rows[0].session_id === SESSION, "linked to a lesson when wanted");
await open(`${R}/notebook`);
ok((await page.locator('section[aria-label="Pinned"] [data-note-id="' + freeId + '"]').count()) === 1, "it is under Pinned");
await page.locator(`a[href*="tag=${tagWord}"]`).first().click();
await settle(page, 800);
ok((await page.locator(`[data-note-id="${freeId}"]`).count()) === 1, "a tag finds it");

// Optional topic link (owner, 6 Nov 2026), on a second note, written free-standing first.
await open(`${R}/notebook/new`);
await page.getByTestId("note-field").waitFor();
words.push(`gnu${stamp}`);
await page.getByTestId("note-field").fill(`A thought gnu${stamp} on a topic`);
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 90_000 });
await page.getByTestId("note-link-open").click();
await page.getByTestId("note-link-topic").check();
const topicWords = `Motor milestones ${stamp}`;
await page.getByTestId("note-link-topic-input").fill(topicWords);
await shot("07b-link-topic");
await page.getByTestId("note-link-apply").click();
await page.waitForTimeout(800);
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 90_000 });
rows = await noteByWords(`gnu${stamp}`);
ok(rows.length === 1 && rows[0].target_kind === "topic" && rows[0].topic === topicWords && !rows[0].material_id && !rows[0].session_id, "a note links to a topic when wanted, with nothing else required");
const topicNote: string = rows[0]?.id;
await open(`${R}/notebook?topic=${encodeURIComponent(topicWords)}`);
ok((await page.locator(`[data-note-id="${topicNote}"]`).count()) === 1, "the topic filter finds it");
ok((await page.getByTestId("notebook-topics").innerText()).includes(topicWords), "its topic is offered as a filter");
await shot("07c-topic-filter");
await open(`${R}/notebook?q=${encodeURIComponent(`${stamp}`.slice(0, 16))}`);
await open(`${R}/notebook?q=${encodeURIComponent(`Motor milestones ${stamp}`)}`);
ok((await page.locator(`[data-note-id="${topicNote}"]`).count()) === 1, "searching the topic's words finds it");
await open(`${R}/notebook/${topicNote}`);
await page.getByTestId("note-link-open").click();
await page.locator('input[type="radio"]').first().check();
await page.getByTestId("note-link-apply").click();
await page.waitForTimeout(800);
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 90_000 });
rows = await noteByWords(`gnu${stamp}`);
ok(rows[0].target_kind === "free" && rows[0].topic === null, "and it can go back to free-standing");

// ── 3. The lesson: a note midway through a section ────────────────────────────────────────────────────────────────────────
await open(`${R}/learn?session=${SESSION}`);
await page.waitForTimeout(1500);
// The lesson's own notes may start closed, one click away, when saved teaching is on the page.
const revealNotes = async () => {
  await page.locator('[data-testid="my-ideas-box"]').first().waitFor({ state: "attached", timeout: 90_000 });
  // Saved teaching and the saved reading place arrive after the notes. A learner sees them settle, then reads.
  await settle(page, 2000);
  // The notes panel folds by itself when saved teaching arrives, so it is checked until it stays open.
  for (let i = 0; i < 5; i++) {
    const closed = page.locator('details:not([open]):has([data-testid="my-ideas-box"]) > summary').first();
    if (await closed.count()) await closed.click();
    await page.waitForTimeout(1500);
  }
};
await revealNotes();
const box = page.getByTestId("my-ideas-box").first();
await box.waitFor({ timeout: 90_000 });
const boxes = await page.getByTestId("my-ideas-box").count();
ok(boxes >= 1, `a box follows each section (${boxes})`);
const collapsed = (await box.boundingBox())!;
ok(collapsed.height <= 80, `closed, it is one compact line, no large empty box (${Math.round(collapsed.height)}px)`);
ok((await box.locator("textarea").count()) === 0, "no empty text area breaks the reading flow");
await noOverflow("the lesson");
const toggleTarget = box.locator("button").first();
await toggleTarget.scrollIntoViewIfNeeded();
await page.evaluate(() => { const b = document.querySelector('[data-testid="my-ideas-box"]')!; window.scrollBy(0, b.getBoundingClientRect().top - 260); });
await page.waitForTimeout(300);
await shot("08-lesson-closed-box");
const before = await page.evaluate(() => window.scrollY);
const lessonUrl = page.url();
await toggleTarget.click();
await box.locator("textarea").waitFor({ timeout: 5000 });
ok(await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA"), "opening the box focuses the field at once");
ok(Math.abs(await page.evaluate(() => window.scrollY) - before) <= 2, "opening it does not lose the reading place");
ok(page.url() === lessonUrl, "opening it does not navigate or reset the lesson");
ok((await box.innerText()).includes("It will be linked to this lesson automatically"), "the owner's line is shown");
ok((await box.innerText()).includes("Personal · Private") || VIEW === "phone", "Personal · Private is shown");
ok(await box.locator("textarea").evaluate(e => (e as HTMLTextAreaElement).placeholder.startsWith("An idea, question, reflection")), "the owner's placeholder is shown");
const fontSize = await box.locator("textarea").evaluate(e => parseFloat(getComputedStyle(e).fontSize));
ok(fontSize >= 16, `the field does not make a phone zoom (${fontSize}px)`);
const lessonWords = `Cephalocaudal thought zebra${stamp}: head control comes first`;
words.push(`zebra${stamp}`);
await page.keyboard.type(lessonWords);
await waitSaved(box);
ok(Math.abs(await page.evaluate(() => window.scrollY) - before) <= 60, "writing and saving leave the reading place where it was");
await shot("09-lesson-writing");
rows = await noteByWords(`zebra${stamp}`);
const sectionChunk: string | null = rows[0]?.chunk_id;
ok(rows.length === 1 && rows[0].target_kind === "lesson" && rows[0].session_id === SESSION && !!sectionChunk && !!rows[0].section_label && !!rows[0].section_anchor && rows[0].captured_in === "learn", `attached by itself to the lesson and section ("${rows[0]?.section_label}")`);
const noteOne: string = rows[0]?.id;

// Several notes in one section.
await box.getByTestId("my-ideas-another").click();
await page.waitForTimeout(300);
const secondWords = `Second thought yak${stamp} on the same section`;
words.push(`yak${stamp}`);
await box.locator("textarea").last().fill(secondWords);
await page.waitForTimeout(100);
await box.locator('[data-testid="note-save-status"][data-status="saved"]').last().waitFor({ timeout: 90_000 });
rows = await noteByWords(`yak${stamp}`);
ok(rows.length === 1 && rows[0].chunk_id === sectionChunk, "a second note goes on the same section");

// Ask and the study goal: nothing happens without the learner's click.
const actions = box.getByTestId("note-actions").last();
ok(await actions.getByRole("button", { name: /Develop this idea/ }).isVisible(), "Develop this idea is offered");
ok(await actions.getByRole("button", { name: /Research this question/ }).isVisible(), "Research this question is offered");
const assistantCalls: string[] = [];
const watchAi = (r: { url(): string }) => { if (/learn\/assistant|learn\/act|explain/.test(r.url())) assistantCalls.push(r.url()); };
page.on("request", watchAi);
await actions.getByRole("button", { name: /Develop this idea/ }).click();
const dialog = page.locator("dialog[open]").first();
await dialog.waitFor({ timeout: 5000 });
ok((await dialog.locator("textarea").first().inputValue()).includes(`yak${stamp}`), "Ask opens with the note's words to edit");
await page.waitForTimeout(800);
ok(assistantCalls.length === 0, "opening Ask sends nothing to AI");
await shot("10-ask-prefilled");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
page.off("request", watchAi);
ok(leaks.length === 0, `no note's words were sent anywhere but the notes route (${leaks.length})`);
const goalBtn = actions.getByRole("button", { name: /Make it a study goal/ });
if (await goalBtn.count()) {
  const countEntries = async () => (await admin.from("individual_learning_calendar_entry").select("id", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0;
  const e0 = await countEntries();
  await goalBtn.click();
  await shot("11-goal-form");
  ok((await countEntries()) === e0, "the study goal form adds nothing by itself");
  await box.getByRole("button", { name: "Cancel" }).click();
  ok((await countEntries()) === e0, "Cancel adds nothing");
  if (VIEW === "desktop") {
    await goalBtn.click();
    goalApproved = true;
    await box.getByRole("button", { name: "Add to My Plan" }).click();
    await box.getByTestId("note-goal-added").waitFor({ timeout: 90_000 });
    ok((await countEntries()) === e0 + 1, "Add to My Plan adds exactly one entry, only on approval");
  }
} else note("My Plan is off for this learner, so the study goal action is not offered");

// Quick Note while reading attaches to the section being read, without moving the page.
const sc = await page.evaluate(() => window.scrollY);
await qbtn.click();
await panel.waitFor();
ok(await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA"), "Quick Note in a lesson: the cursor is in the field");
ok(Math.abs(await page.evaluate(() => window.scrollY) - sc) <= 2, "Quick Note does not move the lesson");
ok(/Linked to/.test(await page.getByTestId("quick-note-where").innerText()), `it attaches to what is being read: ${(await page.getByTestId("quick-note-where").innerText()).slice(0, 80)}`);
await shot("12-quick-note-in-lesson");
const quickWords = `Quick lesson llama${stamp}`;
words.push(`llama${stamp}`);
await page.keyboard.type(quickWords);
await waitSaved(panel);
rows = await noteByWords(`llama${stamp}`);
ok(rows.length === 1 && rows[0].session_id === SESSION, "Quick Note in a lesson saved on that lesson");
const pBox = (await panel.boundingBox())!, bBox = (await qbtn.boundingBox())!;
ok(pBox.y >= bBox.y + bBox.height - 1, "the panel does not cover the control that opened it");
if (VIEW !== "desktop") {
  const small = await panel.locator("button, a, textarea, input, select, summary").evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().height < 40).map(e => `${e.tagName} ${(e.textContent ?? "").trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`));
  ok(small.length === 0, `every control in the panel is big enough to tap (${small.join("; ")})`);
}
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
ok(Math.abs(await page.evaluate(() => window.scrollY) - sc) <= 2, "closing it leaves the reading place");

// Close the lesson, reopen it: the exact note, on that section. And in My Notebook.
await open(`${R}/notebook`);
await open(`${R}/learn?session=${SESSION}`);
await page.waitForTimeout(1500);
await revealNotes();
const reopened = page.getByTestId("my-ideas-box").first();
await reopened.waitFor({ timeout: 90_000 });
await page.waitForFunction(() => /2 notes|notes/.test(document.querySelector('[data-testid="my-ideas-box"]')?.textContent ?? ""), null, { timeout: 90_000 }).catch(() => {});
ok(/notes?/.test(await reopened.locator("button").first().innerText()), `reopened: the box says what is there ("${(await reopened.locator("button").first().innerText()).replace(/\s+/g, " ").slice(0, 80)}")`);
await reopened.scrollIntoViewIfNeeded();
await shot("13-reopened-closed");
await reopened.locator("button").first().click();
await page.waitForTimeout(400);
const shownBody = await reopened.innerText();
ok(shownBody.includes(lessonWords) && shownBody.includes(secondWords), "reopened: both notes are on that section, word for word");
await shot("14-reopened-open");
const firstExisting = reopened.getByTestId("my-ideas-existing").filter({ hasText: `zebra${stamp}` }).first();
await firstExisting.getByRole("button", { name: /Edit/ }).click();
// Once editing, its words are in the field, so the row is found by its Done button.
const editing = reopened.getByTestId("my-ideas-existing").filter({ has: page.getByRole("button", { name: "Done" }) }).first();
await editing.locator("textarea").waitFor();
await editing.locator("textarea").fill(`${lessonWords}, edited in place${stamp}`);
await editing.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 90_000 });
ok((await noteByWords(`edited in place${stamp}`)).some((n: { id: string }) => n.id === noteOne), "an existing note is editable in place");
await editing.getByRole("button", { name: "Done" }).click();
await open(`${R}/notebook?q=${encodeURIComponent(`zebra${stamp}`)}`);
ok((await page.locator(`[data-note-id="${noteOne}"]`).count()) === 1, "the same note appears in My Notebook");
ok(/Growth and Development/.test(await page.locator(`[data-note-id="${noteOne}"]`).innerText()), "it says which lesson it is on");
await shot("15-notebook-lesson-note");
// Read to a section further down, leave for a note, come back: the same section is where the learner left it.
await open(`${R}/learn?session=${SESSION}`);
await revealNotes();
const readTo = page.locator('li[id^="lesson-"]').nth(2);
const readToId = await readTo.getAttribute("id");
await page.evaluate(id => { const e = document.getElementById(id!)!; window.scrollBy(0, e.getBoundingClientRect().top - 80); }, readToId);
await page.mouse.wheel(0, 1);
await page.waitForTimeout(3500);
const yLeft = await page.evaluate(() => window.scrollY);
await page.goto(`${BASE}${R}/notebook/${noteOne}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await settle(page);
ok((await page.getByTestId("note-back-to-lesson").count()) === 1, "the note offers the way back to its lesson");
await shot("15a-note-way-back");
await page.getByTestId("note-back-to-lesson").click();
await page.waitForURL(`**/study/learn?session=${SESSION}**`, { timeout: 120_000 });
await settle(page, 1000);
// The lesson's notes, then its saved teaching, then the place: on a dev server this takes a while.
await page.waitForFunction(([id, h]) => { const e = document.getElementById(id as string); if (!e) return false; const y = e.getBoundingClientRect().top; return e.getClientRects().length > 0 && y > -220 && y < (h as number) * 0.6; }, [readToId, SIZE.height], { timeout: 45_000 }).catch(() => {});
const backTop = await page.evaluate(id => document.getElementById(id!)?.getBoundingClientRect().top ?? null, readToId);
ok(backTop !== null && backTop > -220 && backTop < SIZE.height * 0.6, `back at the lesson, the section the learner left is on screen again (${readToId} at y ${backTop === null ? "none" : Math.round(backTop)}, left at scrollY ${Math.round(yLeft)}, back at ${await page.evaluate(() => Math.round(window.scrollY))})`);
await shot("15b-back-at-lesson");
// "Go to this section" opens that note's own box. It arrives from the note's page, as the link does.
await open(`${R}/notebook/${noteOne}`);
await page.goto(`${BASE}${R}/learn?session=${SESSION}#ideas-${(await noteByWords(`zebra${stamp}`))[0]?.step}-${(await noteByWords(`zebra${stamp}`))[0]?.section_anchor}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await settle(page, 5000);
ok(await page.locator('[data-testid="my-ideas-box"] button[aria-expanded="true"]').first().waitFor({ state: "visible", timeout: 45_000 }).then(() => true, () => false), "a link to a section opens that note's box");

// ── 4. Network loss, and an interrupted visit ─────────────────────────────────────────────────────────────────────────────
await qbtn.click();
await panel.waitFor();
await panel.locator('[data-testid="quick-note-new"]').click().catch(() => {});
await page.waitForTimeout(200);
await ctx.setOffline(true);
const offlineWords = `Offline thought okapi${stamp}`;
words.push(`okapi${stamp}`);
await panel.locator("textarea").fill(offlineWords);
await page.waitForFunction(() => document.querySelector('[data-testid="quick-note-panel"] [data-testid="note-save-status"]')?.getAttribute("data-status") === "retrying", null, { timeout: 15_000 });
ok(/kept on this device/.test(await panel.getByTestId("note-save-status").innerText()), "network lost: says the words are kept on this device");
ok(await page.evaluate(k => Object.keys(localStorage).some(x => x.includes(k) && (localStorage.getItem(x) ?? "").includes("okapi")), `:${userId}:`), "network lost: the draft is on this device, under this learner");
ok((await noteByWords(`okapi${stamp}`)).length === 0, "network lost: nothing reached the server");
await shot("16-offline");
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
await page.locator('[data-testid="quick-note-panel"] [data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 90_000 });
ok((await noteByWords(`okapi${stamp}`)).length === 1, "network back: saved once, no duplicate");
ok(await page.evaluate(() => !Object.keys(localStorage).some(x => (localStorage.getItem(x) ?? "").includes("okapi"))), "network back: the draft is gone");
await page.keyboard.press("Escape");

// An interrupted session: the save never lands and the tab goes.
await page.route("**/api/individual/scholar/notebook/notes", r => r.abort());
await qbtn.click();
await panel.waitFor();
const lostWords = `Interrupted thought ibex${stamp}`;
words.push(`ibex${stamp}`);
await panel.locator("textarea").last().fill(lostWords);
await page.waitForTimeout(1800);
await page.unroute("**/api/individual/scholar/notebook/notes");
await page.route("**/api/individual/scholar/notebook/notes", r => r.abort());
await open(`${R}/notebook`);
await page.unroute("**/api/individual/scholar/notebook/notes");
await page.waitForTimeout(500);
const rec = page.getByTestId("note-draft-recovery");
ok(await rec.isVisible().catch(() => false), "after an interrupted visit, My Notebook offers the unsaved words");
ok((await rec.innerText().catch(() => "")).includes(`ibex${stamp}`), "the recovered words are the learner's own");
await shot("17-recovery");
await rec.getByRole("button", { name: "Restore" }).first().click();
await page.waitForURL("**/study/notebook/**", { timeout: 180_000 });
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 180_000 });
ok((await noteByWords(`ibex${stamp}`)).length === 1, "Restore saves it, once");
ok(/study\/notebook\/[0-9a-f-]{36}/.test(page.url()) && !page.url().includes("ibex"), "its address is the note's id, and never its words");

// ── 5. Patient information ────────────────────────────────────────────────────────────────────────────────────────────────
await open(`${R}/notebook/new`);
ok(await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", null, { timeout: 15_000 }).then(() => true, () => false), "the blank page: the cursor is in the field");
ok((await page.getByTestId("note-title").count()) === 0, "the blank page asks for no title");
await shot("18-blank-page");
await page.keyboard.type(`Patient lynx${stamp} MRN: 12345678`);
await page.waitForFunction(() => document.querySelector('[data-testid="note-save-status"]')?.getAttribute("data-status") === "refused", null, { timeout: 20_000 });
ok(/identify a patient/.test(await page.getByTestId("note-save-status").innerText()), "a patient identifier is refused, and says why");
ok((await noteByWords(`lynx${stamp}`)).length === 0, "nothing identifying reached the database");
await shot("19-patient-warning");
await page.getByTestId("note-field").fill(`Safe now lynx${stamp}`);
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 90_000 });
ok((await noteByWords(`lynx${stamp}`)).length === 1, "taking it out saves the note");

// ── 6. Export and removal ─────────────────────────────────────────────────────────────────────────────────────────────────
await open(`${R}/notebook`);
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.getByTestId("notebook-export").click({ noWaitAfter: true })]);
const file = join(OUT, `export-${VIEW}.tmp.md`);
await dl.saveAs(file);
const md = readFileSync(file, "utf8");
ok(md.includes(`quokka${stamp}`) && md.includes(`zebra${stamp}`), "export holds the learner's notes, free-standing and lesson");
writeFileSync(file, "");
await page.goto(`${BASE}${R}/notebook/${freeId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await settle(page);
await page.getByTestId("note-remove").click();
await page.getByTestId("note-remove-yes").click();
await page.waitForURL("**/study/notebook", { timeout: 180_000 });
await settle(page);
ok((await noteByWords(`quokka${stamp}`)).length === 0, "the learner can remove a note, and it is gone");

// Remove straight after typing: the words waiting to save must not bring the note back.
await open(`${R}/notebook/new`);
await page.getByTestId("note-field").waitFor();
const removedWords = `Do not keep tapir${stamp}`;
words.push(`tapir${stamp}`);
await page.getByTestId("note-field").fill(removedWords);
await page.getByTestId("note-remove").click();
await page.getByTestId("note-remove-yes").click();
await page.waitForURL("**/study/notebook", { timeout: 180_000 });
await settle(page, 3000);
ok((await noteByWords(`tapir${stamp}`)).length === 0, "removed straight after typing: nothing is saved");
ok(await page.evaluate(() => !Object.keys(localStorage).some(x => (localStorage.getItem(x) ?? "").includes("tapir"))), "removed straight after typing: no draft is left on the device");

// CE-02-2 asks for touch targets of at least --cmp-touch-min on a phone. Links inside a sentence are exempt, as WCAG 2.5.8 exempts them.
const smallTargets = () => page.evaluate(() => {
  const min = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cmp-touch-min")) || 44;
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("main a, main button, main select, main input:not([type=hidden]), main textarea, main summary"))) {
    const r = el.getBoundingClientRect();
    if (!el.getClientRects().length || r.width === 0 || r.height >= min) continue;
    if (el.tagName === "A" && el.closest("p, footer")) continue;
    out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).type || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});
// ── CE-02-2: the library's own search, filters, notes and item actions still work beside the Notebook ──────────────────────
await open(`${R}/saved?q=${encodeURIComponent(`zebra${stamp}`)}`);
await noOverflow("library search");
ok((await page.locator("body").innerText()).includes(`zebra${stamp}`), "CE-02: the library's search finds a lesson note written in the box");
const hit = page.locator("li").filter({ hasText: `zebra${stamp}` }).first();
ok((await hit.locator("a").count()) >= 1, "CE-02: a search result has its item actions");
await shot("20-library-search");
if (VIEW === "phone") { const small = await smallTargets(); ok(small.length === 0, `CE-02: library search, touch targets at least 44px (${small.length}: ${small.slice(0, 12).join("; ")})`); }
const mat = (await admin.from("individual_scholar_material").select("id").eq("user_id", userId).eq("file_name", "Growth and Development.pptx").maybeSingle()).data?.id;
await open(`${R}/saved?view=notes&material=${mat}`);
await noOverflow("library notes view");
ok((await page.locator("body").innerText()).includes(`zebra${stamp}`), "CE-02: the material filter keeps a note on that material");
await shot("21-library-notes");
if (VIEW === "phone") { const small = await smallTargets(); ok(small.length === 0, `CE-02: library notes, touch targets at least 44px (${small.length}: ${small.slice(0, 12).join("; ")})`); }
const kept = (await noteByWords(`zebra${stamp}`))[0];
ok(kept?.material_id === mat && !!kept?.session_id && !!kept?.section_label, "CE-02: the note keeps where it came from, its material, lesson and section");
await page.getByText("Write a new note").click();
const libWords = `Library note heron${stamp}`;
words.push(`heron${stamp}`);
const form = page.locator("details").filter({ hasText: "Write a new note" }).first();
await form.locator("select").first().selectOption(mat);
await form.locator("textarea").fill(libWords);
await form.getByRole("button", { name: "Save note" }).click();
await form.getByText("Note saved.").waitFor({ timeout: 90_000 });
let libRows = await noteByWords(`heron${stamp}`);
ok(libRows.length === 1 && libRows[0].target_kind === "material" && !libRows[0].client_key, "CE-02: the library's own note form still writes its own note");
await open(`${R}/saved?view=notes&material=${mat}`);
const libNote = page.locator("div").filter({ hasText: `heron${stamp}` }).filter({ has: page.getByRole("button", { name: /^Edit/ }) }).last();
await libNote.getByRole("button", { name: /^Edit/ }).click();
await page.locator('textarea[id^="edit-"]').fill(`${libWords} edited`);
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForFunction(() => !document.querySelector('[id^="edit-"]'), null, { timeout: 90_000 });
libRows = await noteByWords(`heron${stamp}`);
ok(libRows[0]?.body === `${libWords} edited`, "CE-02: the library's edit still saves, with its check against a changed copy");
const libEdited = page.locator("div").filter({ hasText: `heron${stamp}` }).filter({ has: page.getByRole("button", { name: /^Remove/ }) }).last();
await libEdited.getByRole("button", { name: /^Remove/ }).click();
await libEdited.getByRole("button", { name: "Yes, remove it" }).click();
await page.getByText("Note removed.").waitFor({ timeout: 90_000 });
ok((await noteByWords(`heron${stamp}`)).length === 0, "CE-02: the library's remove still removes");

// ── 7. Privacy over HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────
const anon = await browser.newContext();
const unauth = await anon.request.get(`${BASE}/api/individual/scholar/notebook/notes?session=${SESSION}&step=0`);
ok(unauth.status() === 401, `signed out: the route refuses (${unauth.status()})`);
const anonExport = await anon.request.get(`${BASE}/api/individual/scholar/notebook/export`);
ok(anonExport.status() === 401, `signed out: export refuses (${anonExport.status()})`);
await anon.close();
const other = await page.request.get(`${BASE}/api/individual/scholar/notebook/notes?session=00000000-0000-4000-8000-000000000000&step=0`);
ok(other.status() === 200 && (await other.json()).notes.length === 0, "a session that is not theirs reads nothing");
ok(leaks.length === 0, `end of walk: no note's words left the notes route, other than to My Plan on the learner's approval (${leaks.length}: ${leaks.join(", ")})`);

ok(errors.length === 0, `no server error or page error (${errors.join(" | ").slice(0, 300)})`);
writeFileSync(join(OUT, `walk-${VIEW}.log`), `${lines.join("\n")}\n`);
const failed = lines.filter(l => l.startsWith("FAIL")).length;
console.log(`\n${failed ? "RED" : "GREEN"} [${VIEW}] ${lines.filter(l => l.startsWith("PASS")).length} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
