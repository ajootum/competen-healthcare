// The Revise page as it is on main, for the evidence: heights and a first-screen shot, same fixture learner.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const BASE = "http://127.0.0.1:3204";
const OUT = join(process.cwd(), "docs/evidence/REVISE-WORKSPACE-01");
mkdirSync(join(OUT, "shots"), { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
(async () => {
  const out: Record<string, unknown> = {};
  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 900], [820, 1100], [390, 844]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
    await page.waitForTimeout(1500);
    for (let a = 0; a < 3 && page.url().includes("/login"); a++) {
      await page.getByRole("textbox", { name: /email/i }).fill(field("email"));
      await page.locator("input#password").fill(field("password"));
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).catch(() => {});
    }
    await page.goto(`${BASE}/individual/scholar/study/revise`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForTimeout(8000);
    out[`height_${w}`] = await page.evaluate(() => document.documentElement.scrollHeight);
    out[`sections_${w}`] = await page.locator("main h2").allInnerTexts();
    await page.screenshot({ path: join(OUT, `shots/before-${w}.png`) });
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(OUT, "before.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
})().catch(e => { console.error(String(e).slice(0, 400)); process.exit(1); });
