// CE-02-2: the library's touch targets on a phone, measured after the one fix the phone walk asked for. The whole walk is not rerun for a class on one link.
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
const { data: rows } = await admin.from("individual_scholar_note").select("body, material_id").eq("user_id", userId).ilike("body", "%zebra%").order("created_at", { ascending: false }).limit(1);
const word = /zebra\w+/.exec(rows[0].body)![0];
const mat = rows[0].material_id;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
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
const small = () => page.evaluate(() => {
  const min = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cmp-touch-min")) || 44;
  const out: string[] = [];
  let seen = 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("main a, main button, main select, main input:not([type=hidden]), main textarea, main summary"))) {
    const r = el.getBoundingClientRect();
    if (!el.getClientRects().length || r.width === 0) continue;
    seen++;
    if (r.height >= min) continue;
    if (el.tagName === "A" && el.closest("p, footer")) continue;
    out.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.innerText || "").trim().slice(0, 30)}"`);
  }
  return { seen, out };
});
const lines: string[] = [];
let bad = 0;
for (const [name, path] of [["library search", `${R}/saved?q=${encodeURIComponent(word)}`], ["library notes", `${R}/saved?view=notes&material=${mat}`]] as const) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(2500);
  const r = await small();
  const pass = r.seen > 0 && r.out.length === 0;
  if (!pass) bad++;
  const l = `${pass ? "PASS" : "FAIL"} [phone] CE-02: ${name}, ${r.seen} controls measured, under 44px: ${r.out.length ? r.out.join("; ") : "none"}`;
  lines.push(l); console.log(l);
}
writeFileSync(process.env.WALK_OUT + "/walk-touch-check.log", lines.join("\n") + "\n");
await browser.close();
process.exit(bad ? 1 : 0);
