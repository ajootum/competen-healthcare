// COMPETEN-NOTEBOOK-001: with policy scholar_personal_notebook off (the default), nothing is offered and nothing is written. STAGING only.
// Turns the key off on staging, checks, and turns it back on. Credentials from WALK_FIXTURE, keys read inside this script, neither printed.
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://localhost:3206";
const OUT = process.env.WALK_OUT ?? join(process.cwd(), "docs/evidence/COMPETEN-NOTEBOOK-001/walk");
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const lines: string[] = [];
const ok = (c: boolean, what: string) => { const l = `${c ? "PASS" : "FAIL"} [key off] ${what}`; lines.push(l); console.log(l); };
const req = createRequire(join(process.cwd(), "package.json"));
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = req("@supabase/supabase-js").createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const setKey = (value: "on" | "off") => admin.from("workspace_config_overrides").update({ published: { value }, draft: { value } }).eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", "individual.policy.scholar_personal_notebook");

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const R = "/individual/scholar/study";
try {
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
  const { error } = await setKey("off");
  if (error) throw new Error("could not turn the key off");
  await page.waitForTimeout(1000);
  await page.goto(`${BASE}/individual/scholar`, { waitUntil: "networkidle", timeout: 300_000 });
  ok((await page.getByTestId("quick-note-button").count()) === 0, "no Quick Note on Home");
  ok((await page.getByRole("link", { name: "My Notebook" }).count()) === 0, "no My Notebook in the navigation");
  const { data: note } = await admin.from("individual_scholar_learning_session").select("id").eq("title", "Growth and Development").limit(1).maybeSingle();
  await page.goto(`${BASE}${R}/learn?session=${note?.id}`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(4000);
  ok((await page.getByTestId("my-ideas-box").count()) === 0, "no My Ideas & Notes in the lesson");
  ok((await page.locator(".cmp-learn-ideas").count()) === 0, "nothing amber in the lesson");
  await page.goto(`${BASE}${R}/notebook`, { waitUntil: "networkidle", timeout: 300_000 });
  ok((await page.getByText("My Notebook is not available here yet").count()) === 1, "the page says it is not available");
  const key = "99999999-9999-4999-8999-999999999999";
  const post = await page.request.post(`${BASE}/api/individual/scholar/notebook/notes`, { data: { clientKey: key, body: "key off probe" } });
  ok(post.status() === 403, `saving is refused (${post.status()})`);
  const exp = await page.request.get(`${BASE}/api/individual/scholar/notebook/export`);
  ok(exp.status() === 403, `export is refused (${exp.status()})`);
  ok(((await admin.from("individual_scholar_note").select("id").eq("client_key", key)).data ?? []).length === 0, "nothing was written");
} finally {
  await setKey("on");
  await browser.close();
}
writeFileSync(join(OUT, "walk-key-off.log"), `${lines.join("\n")}\n`);
process.exit(lines.some(l => l.startsWith("FAIL")) ? 1 : 0);
