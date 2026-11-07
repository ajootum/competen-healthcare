// COMPETEN-NOTEBOOK-001: the four corrections from the second read of the topic link, in the browser, as the fixture learner on staging. The whole walk is not rerun for them.
// Credentials come from WALK_FIXTURE. Keys are read inside. Neither is printed.
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3206";
const R = "/individual/scholar/study";
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const req = createRequire(process.cwd() + "/package.json");
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = req("@supabase/supabase-js").createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId = users.find((u: { email?: string }) => u.email === field("email")).id;
const stamp = String(Date.now());
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.setDefaultTimeout(90_000);
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
const lines: string[] = [];
let bad = 0;
const ok = (c: boolean, what: string) => { if (!c) bad++; const l = `${c ? "PASS" : "FAIL"} [topic link] ${what}`; lines.push(l); console.log(l); };
const rowOf = async (w: string) => (await admin.from("individual_scholar_note").select("id, target_kind, topic").eq("user_id", userId).ilike("body", `%${w}%`)).data ?? [];
const status = (s: string) => page.locator(`[data-testid="note-save-status"][data-status="${s}"]`).waitFor({ timeout: 90_000 });
const openNew = async () => {
  await page.goto(`${BASE}${R}/notebook/new`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="note-field"]'); return !!b && Object.keys(b).some(k => k.startsWith("__reactProps")); }, null, { timeout: 120_000 });
};
const setTopic = async (t: string) => {
  await page.getByTestId("note-link-open").click();
  await page.getByTestId("note-link-topic").check();
  await page.getByTestId("note-link-topic-input").fill(t);
  await page.getByTestId("note-link-apply").click();
  await page.waitForTimeout(800);
};
const w = `corrections${stamp}`;
const A = `Alpha ${stamp}`, B = `Beta ${stamp}`, BAD = "MRN 1234567";

await openNew();
await page.getByTestId("note-field").fill(`A thought ${w}`);
await status("saved");
await setTopic(A);
await status("saved");
ok((await rowOf(w))[0]?.topic === A, "the first topic saves");

await setTopic(BAD);
await status("refused");
ok((await rowOf(w))[0]?.topic === A, "an identifier as a topic is refused, and the note keeps its topic");
await setTopic(A);
await status("saved");
ok((await rowOf(w))[0]?.topic === A && !(await page.getByTestId("note-save-status").innerText()).includes("identify"), "going back to the earlier topic clears the refusal");

await setTopic(BAD);
await status("refused");
await setTopic(B);
await status("saved");
ok((await rowOf(w))[0]?.topic === B, "correcting a refused topic saves, with no change to the words");

await setTopic(A);
await status("saved");
await setTopic(B);
await status("saved");
ok((await rowOf(w))[0]?.topic === B, "topic B, then A, then B again ends on B");

await page.goto(`${BASE}${R}/notebook/${(await rowOf(w))[0].id}`, { waitUntil: "networkidle", timeout: 300_000 });
const back = page.getByTestId("note-back-to-lesson");
ok((await back.innerText()).includes("Notes on this topic") && (await back.getAttribute("href") ?? "").includes("/notebook?topic="), "the note opens its topic's notes in My Notebook");
await back.click();
await page.waitForURL("**/notebook?topic=**");
ok((await page.locator(`[data-note-id="${(await rowOf(w))[0].id}"]`).count()) === 1, "and that page holds this note");

// A restored draft shows the link it will save.
const dw = `draftcheck${stamp}`, DT = `Gamma ${stamp}`;
await page.route("**/api/individual/scholar/notebook/notes", r => r.abort());
await openNew();
await page.getByTestId("note-field").fill(`A thought ${dw}`);
await page.waitForTimeout(1000);
await setTopic(DT);
await page.waitForTimeout(1000);
await page.unroute("**/api/individual/scholar/notebook/notes");
ok((await rowOf(dw)).length === 0, "offline: nothing saved yet");
await page.goto(`${BASE}${R}/notebook`, { waitUntil: "networkidle", timeout: 300_000 });
const rec = page.getByTestId("note-draft-recovery").locator("li, div").filter({ hasText: dw }).last();
await rec.getByRole("button", { name: "Restore" }).click();
await page.getByTestId("note-links").waitFor();
ok((await page.getByTestId("note-links").innerText()).includes(`Topic: ${DT}`), "a restored draft says the topic it will save");
await status("saved").catch(() => {});
await page.getByTestId("note-field").fill(`A thought ${dw} continued`);
await status("saved");
const dr = (await rowOf(dw))[0];
ok(dr?.target_kind === "topic" && dr?.topic === DT, "and it saves on that topic");

writeFileSync(process.env.WALK_OUT + "/walk-topic-link-check.log", lines.join("\n") + "\n");
await browser.close();
process.exit(bad ? 1 : 0);
