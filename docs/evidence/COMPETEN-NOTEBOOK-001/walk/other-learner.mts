// COMPETEN-NOTEBOOK-001: signed in as the fixture learner, a note of ANOTHER learner on staging stays out of reach. Read-only, except one PATCH sent with a revision no note has,
// so even a broken guard could not change the row. The other learner's words are compared, never printed. Credentials come from WALK_FIXTURE. Keys are read inside.
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
const me = users.find((u: { email?: string }) => u.email === field("email")).id;
const lines0: string[] = [];
const { data: others } = await admin.from("individual_scholar_note").select("id, body, session_id, step, updated_at, revision").neq("user_id", me).neq("kind", "bookmark").not("body", "is", null).order("session_id", { nullsFirst: false }).limit(1);
// Staging held no other learner's note, which would make this prove nothing. So one labelled probe, free-standing, on a competen.test account. It stays: agents do not hard-delete.
let n = others?.[0];
if (!n) {
  const owner = users.find((u: { id: string; email?: string }) => u.id !== me && /@competen.test$/i.test(u.email ?? ""));
  if (!owner) throw new Error("no test account");
  const { data, error } = await admin.from("individual_scholar_note").insert({ user_id: owner.id, kind: "note", target_kind: "free", body: "Isolation probe walrus note, COMPETEN-NOTEBOOK-001, staging only", client_key: crypto.randomUUID() }).select("id, body, session_id, step, updated_at, revision").single();
  if (error) throw new Error("probe not written: " + error.code);
  n = data;
  lines0.push("NOTE [other learner] one labelled probe note written on a competen.test account, because staging held no other learner's note");
}
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
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
const lines: string[] = [...lines0];
let bad = 0;
const ok = (c: boolean, what: string) => { if (!c) bad++; const l = `${c ? "PASS" : "FAIL"} [other learner] ${what}`; lines.push(l); console.log(l); };
const words = String(n.body);
const note = await page.request.get(`${BASE}${R}/notebook/${n.id}`, { timeout: 300_000 });
ok(!(await note.text()).includes(words), `their note's page shows none of their words (${note.status()})`);
if (n.session_id) {
  const r = await page.request.get(`${BASE}/api/individual/scholar/notebook/notes?session=${n.session_id}&step=${n.step ?? 0}`, { timeout: 300_000 });
  ok(!(await r.text()).includes(words), `their lesson's notes hold none of their words (${r.status()})`);
} else lines.push("NOTE [other learner] this note is on no session, so the lesson route was not asked");
const patch = await page.request.patch(`${BASE}/api/individual/scholar/notebook/notes/${n.id}`, { data: { body: "must not land", expectedRevision: 999999, revision: 999999 }, timeout: 300_000 });
ok(patch.status() === 404, `a change to their note is not found (${patch.status()})`);
const del = await page.request.get(`${BASE}/api/individual/scholar/notebook/export`, { timeout: 300_000 });
ok(!(await del.text()).includes(words), `the export holds none of their words (${del.status()})`);
const search = await page.request.get(`${BASE}${R}/notebook?q=${encodeURIComponent(words.split(/\s+/).slice(0, 2).join(" "))}`, { timeout: 300_000 });
ok(!(await search.text()).includes(words), `searching their words finds none of their note (${search.status()})`);
const after = (await admin.from("individual_scholar_note").select("body, updated_at, revision").eq("id", n.id).single()).data;
ok(after.body === n.body && after.updated_at === n.updated_at && after.revision === n.revision, "their note is unchanged");
writeFileSync(process.env.WALK_OUT + "/walk-other-learner.log", lines.join("\n") + "\n");
await browser.close();
process.exit(bad ? 1 : 0);
