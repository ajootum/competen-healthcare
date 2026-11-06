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
page.on("request", r => {
  const b = r.postData() ?? "";
  if (!b || r.url().includes("/api/individual/scholar/notebook/")) return;
  for (const w of words) if (b.includes(w)) leaks.push(`${r.method()} ${r.url().slice(0, 100)}`);
});

const shot = (name: string) => page.screenshot({ path: join(OUT, "shots", `${VIEW}-${name}.png`) });
const settle = async (p: Page, ms = 600) => { await p.waitForLoadState("networkidle", { timeout: 90_000 }).catch(() => {}); await p.waitForTimeout(ms); };
const open = async (path: string) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
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
await page.waitForURL(/[?&]q=/, { timeout: 60_000 });
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
await page.waitForFunction(() => (document.querySelector('[data-testid="note-link-step"]') as HTMLSelectElement | null)?.options.length! > 1, null, { timeout: 90_000 });
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

// ── 3. The lesson: a note midway through a section ────────────────────────────────────────────────────────────────────────
await open(`${R}/learn?session=${SESSION}`);
await page.waitForTimeout(1500);
// The lesson's own notes may start closed, one click away, when saved teaching is on the page.
const revealNotes = async () => {
  await page.locator('[data-testid="my-ideas-box"]').first().waitFor({ state: "attached", timeout: 90_000 });
  // Saved teaching and the saved reading place arrive after the notes. A learner sees them settle, then reads.
  await settle(page, 4000);
  const closed = page.locator('details:not([open]):has([data-testid="my-ideas-box"]) > summary').first();
  if (await closed.count()) await closed.click();
  await page.waitForTimeout(300);
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
await page.goto(`${BASE}${R}/notebook/${noteOne}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await settle(page);
ok((await page.getByTestId("note-back-to-lesson").count()) === 1, "the note offers the way back to its lesson");
const placeBefore = (await admin.from("individual_scholar_learning_position").select("card_id").eq("user_id", userId).eq("session_id", SESSION).maybeSingle()).data?.card_id ?? null;
await page.getByTestId("note-back-to-lesson").click();
await page.waitForURL(`**/study/learn?session=${SESSION}**`, { timeout: 120_000 });
await settle(page, 4000);
const placeAfter = (await admin.from("individual_scholar_learning_position").select("card_id").eq("user_id", userId).eq("session_id", SESSION).maybeSingle()).data?.card_id ?? null;
ok(placeAfter === placeBefore, `back at the lesson, its saved reading place is unchanged (${placeBefore})`);
note(`reopened at scrollY ${await page.evaluate(() => Math.round(window.scrollY))}`);
await shot("15b-back-at-lesson");
// "Go to this section" opens that note's own box.
await page.goto(`${BASE}${R}/learn?session=${SESSION}#ideas-0-${(await noteByWords(`zebra${stamp}`))[0]?.section_anchor}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await settle(page, 5000);
{
  const closed = page.locator('details:not([open]):has([data-testid="my-ideas-box"]) > summary').first();
  if (await closed.count()) await closed.click();
  await page.waitForTimeout(800);
}
ok(await page.locator('[data-testid="my-ideas-box"] button[aria-expanded="true"]').first().isVisible().catch(() => false), "a link to a section opens that note's box");

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
await page.waitForURL("**/study/notebook/**", { timeout: 60_000 });
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor({ timeout: 60_000 });
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
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByTestId("notebook-export").click()]);
const file = join(OUT, `export-${VIEW}.tmp.md`);
await dl.saveAs(file);
const md = readFileSync(file, "utf8");
ok(md.includes(`quokka${stamp}`) && md.includes(`zebra${stamp}`), "export holds the learner's notes, free-standing and lesson");
writeFileSync(file, "");
await page.goto(`${BASE}${R}/notebook/${freeId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await settle(page);
await page.getByTestId("note-remove").click();
await page.getByTestId("note-remove-yes").click();
await page.waitForURL("**/study/notebook", { timeout: 60_000 });
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
await page.waitForURL("**/study/notebook", { timeout: 60_000 });
await settle(page, 3000);
ok((await noteByWords(`tapir${stamp}`)).length === 0, "removed straight after typing: nothing is saved");
ok(await page.evaluate(() => !Object.keys(localStorage).some(x => (localStorage.getItem(x) ?? "").includes("tapir"))), "removed straight after typing: no draft is left on the device");

// ── 7. Privacy over HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────
const anon = await browser.newContext();
const unauth = await anon.request.get(`${BASE}/api/individual/scholar/notebook/notes?session=${SESSION}&step=0`);
ok(unauth.status() === 401, `signed out: the route refuses (${unauth.status()})`);
const anonExport = await anon.request.get(`${BASE}/api/individual/scholar/notebook/export`);
ok(anonExport.status() === 401, `signed out: export refuses (${anonExport.status()})`);
await anon.close();
const other = await page.request.get(`${BASE}/api/individual/scholar/notebook/notes?session=00000000-0000-4000-8000-000000000000&step=0`);
ok(other.status() === 200 && (await other.json()).notes.length === 0, "a session that is not theirs reads nothing");
ok(leaks.length === 0, `end of walk: no note's words left the notes route, unless the learner pressed Ask (${leaks.length})`);

ok(errors.length === 0, `no server error or page error (${errors.join(" | ").slice(0, 300)})`);
writeFileSync(join(OUT, `walk-${VIEW}.log`), `${lines.join("\n")}\n`);
const failed = lines.filter(l => l.startsWith("FAIL")).length;
console.log(`\n${failed ? "RED" : "GREEN"} [${VIEW}] ${lines.filter(l => l.startsWith("PASS")).length} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
