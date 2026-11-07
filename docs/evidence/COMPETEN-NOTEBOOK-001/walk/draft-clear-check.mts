// COMPETEN-NOTEBOOK-001, owner 6 Nov 2026: drafts leave browser storage on every way out, saved notes stay on the server, and a learner's own draft still recovers.
// Fixture learner on a STAGING-pointed dev server. Credentials come from WALK_FIXTURE. Keys are read inside. Neither is printed.
//
// One real account is available, so "another account" is proved from the storage side: the drafts of a different user id are on the device when the fixture learner signs in
// through the real sign-in form. It is not two people signing in one after the other.
import { chromium, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3206";
const R = "/individual/scholar/study";
const NOTES = "**/api/individual/scholar/notebook/notes";
const PREFIX = "cmp-scholar-note-draft:v1:";
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const req = createRequire(process.cwd() + "/package.json");
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = req("@supabase/supabase-js").createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId: string = users.find((u: { email?: string }) => u.email === field("email")).id;
const OTHER = users.find((u: { id: string; email?: string }) => u.id !== userId && /@competen\.test$/i.test(u.email ?? ""))?.id as string;
if (!OTHER) throw new Error("no test account");
const stamp = String(Date.now());

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(90_000);

const lines: string[] = [];
let bad = 0;
const ok = (c: boolean, what: string) => { if (!c) bad++; const l = `${c ? "PASS" : "FAIL"} [drafts] ${what}`; lines.push(l); console.log(l); };

const signIn = async (p: Page = page) => {
  let done = false;
  for (let i = 0; i < 3 && !done; i++) {
    await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
    await p.waitForTimeout(2500);
    await p.getByRole("textbox", { name: /email/i }).fill(field("email"));
    await p.locator("input#password").fill(field("password"));
    await p.getByRole("button", { name: /sign in/i }).click();
    done = await p.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 90_000 }).then(() => true, () => false);
  }
  if (!done) throw new Error("could not sign in");
};
const drafts = (p: Page = page) => p.evaluate(pre => Object.keys(localStorage).filter(k => k.startsWith(pre)).map(k => ({ key: k, text: localStorage.getItem(k) ?? "" })), PREFIX);
const openNew = async (p: Page = page) => {
  await p.goto(`${BASE}${R}/notebook/new`, { waitUntil: "networkidle", timeout: 300_000 });
  await p.waitForFunction(() => { const b = document.querySelector('[data-testid="note-field"]'); return !!b && Object.keys(b).some(k => k.startsWith("__reactProps")); }, null, { timeout: 120_000 });
};
/** Words that cannot reach the server, so they sit in a draft. The connection stays lost until online(), so saving on the way out of the page cannot reach it either. */
const writeOffline = async (words: string, p: Page = page) => {
  await p.route(NOTES, r => r.abort());
  await openNew(p);
  await p.getByTestId("note-field").fill(words);
  await p.waitForTimeout(1200);
};
const online = (p: Page = page) => p.unroute(NOTES);
const rows = async (w: string) => (await admin.from("individual_scholar_note").select("id, body").eq("user_id", userId).ilike("body", `%${w}%`)).data ?? [];
const signOutButton = async () => {
  await page.goto(`${BASE}/individual/scholar/settings`, { waitUntil: "networkidle", timeout: 300_000 });
  const b = page.getByRole("button", { name: "Sign out" }).first();
  await page.waitForFunction(() => { const x = [...document.querySelectorAll("button")].find(e => e.textContent?.trim() === "Sign out"); return !!x && Object.keys(x).some(k => k.startsWith("__reactProps")); }, null, { timeout: 120_000 });
  return b;
};

await signIn();

// (c) A saved note first: it must outlive everything below.
const savedWord = `keepsaved${stamp}`;
await openNew();
await page.getByTestId("note-field").fill(`A saved thought ${savedWord}`);
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor();
ok((await rows(savedWord)).length === 1, "a note is saved on the server before any of this");

// (d) Same learner, lost connection: the draft survives a reload and recovers.
const lostWord = `lostline${stamp}`;
await writeOffline(`Written with no connection ${lostWord}`);
ok((await drafts()).some(d => d.text.includes(lostWord)), "lost connection: the words are in a draft on this device");
await page.goto(`${BASE}${R}/notebook`, { waitUntil: "networkidle", timeout: 300_000 });
await page.waitForTimeout(2500);
ok((await drafts()).some(d => d.text.includes(lostWord)), "the same learner, on the next page: the draft is still there");
await online();
const rec = page.getByTestId("note-draft-recovery").locator("li, div").filter({ hasText: lostWord }).last();
await rec.getByRole("button", { name: "Restore" }).click();
await page.getByTestId("note-field").waitFor();
await page.getByTestId("note-field").fill(`Written with no connection ${lostWord} and recovered`);
await page.locator('[data-testid="note-save-status"][data-status="saved"]').waitFor();
ok((await rows(lostWord))[0]?.body?.includes("recovered") === true, "recovered and saved on the server");
ok(!(await drafts()).some(d => d.text.includes(lostWord)), "and the draft is gone once saved");

// (a) Pressing sign out, with a plain draft and a refused identifier on the device.
const plainWord = `plaindraft${stamp}`;
await writeOffline(`Not yet saved ${plainWord}`);
const refusedWord = `MRN 7${stamp.slice(-6)}`;
await openNew();
await online();
await page.getByTestId("note-field").fill(refusedWord);
await page.locator('[data-testid="note-save-status"][data-status="refused"]').waitFor();
const before = await drafts();
ok(before.some(d => d.text.includes(plainWord)) && before.some(d => d.text.includes(refusedWord)), "before signing out: a draft and refused identifier text are both on the device");
// A second tab still open on a note: signing out in the first closes it here too.
const tab = await ctx.newPage();
tab.setDefaultTimeout(90_000);
const tabWord = `secondtab${stamp}`;
await openNew(tab);
// A save on leaving a page can slip past the test's lost connection, as it would past a real one coming back. So: what clearing itself does to the server, counted either side.
const notesBefore = (await admin.from("individual_scholar_note").select("id", { count: "exact", head: true }).eq("user_id", userId)).count;
await (await signOutButton()).click();
await page.waitForURL(u => !u.pathname.includes("/settings"), { timeout: 180_000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2000);
ok((await drafts()).length === 0, "after pressing sign out: no draft is left in browser storage");
const leftover = await page.evaluate(() => JSON.stringify({ ...localStorage }));
ok(!leftover.includes(refusedWord) && !leftover.includes(plainWord), "and none of those words are anywhere in browser storage");
await tab.getByTestId("note-field").fill(`Still typing in the other tab ${tabWord}`).catch(() => {});
await tab.waitForTimeout(2500);
ok(!(await drafts(tab)).some(d => d.text.includes(tabWord)), "a second tab left open keeps no draft after the sign-out");
await tab.close();
ok((await rows(savedWord)).length === 1 && (await rows(lostWord)).length === 1, "saved notes are still on the server after sign-out");
const notesAfter = (await admin.from("individual_scholar_note").select("id", { count: "exact", head: true }).eq("user_id", userId)).count;
ok(notesAfter === notesBefore, `signing out neither added nor removed a note on the server (${notesBefore} before, ${notesAfter} after)`);

// A session that ends with no sign-out at all: the next page clears them.
await signIn();
const endedWord = `sessionended${stamp}`;
await writeOffline(`Not yet saved ${endedWord}`);
ok((await drafts()).some(d => d.text.includes(endedWord)), "before the session ends: the draft is on the device");
await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
await online();
await page.waitForTimeout(3000);
ok((await drafts()).length === 0, "a session that ended with no sign-out: the next page clears the drafts");
ok((await rows(endedWord)).length === 0, "and words that never reached the server were not saved by clearing them");

// (b) Another account's drafts on the device when this learner signs in, sign-out never having run.
await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
await page.waitForTimeout(2500);
const planted = `${PREFIX}${OTHER}:${crypto.randomUUID()}`;
await page.evaluate(([k, w]) => localStorage.setItem(k, JSON.stringify({ body: w, savedAt: Date.now() })), [planted, `Another account's words otherlearner${stamp}`]);
await page.getByRole("textbox", { name: /email/i }).fill(field("email"));
await page.locator("input#password").fill(field("password"));
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 180_000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(3000);
ok(!(await drafts()).some(d => d.key === planted), "another account: its draft is gone once this learner is signed in");
await page.goto(`${BASE}${R}/notebook`, { waitUntil: "networkidle", timeout: 300_000 });
ok(!(await page.locator("body").innerText()).includes(`otherlearner${stamp}`), "and nothing of it can be seen or restored");
ok((await rows(savedWord)).length === 1, "and this learner's saved notes are all still there");

writeFileSync(process.env.WALK_OUT + "/walk-draft-clear-check.log", lines.join("\n") + "\n");
await browser.close();
process.exit(bad ? 1 : 0);
