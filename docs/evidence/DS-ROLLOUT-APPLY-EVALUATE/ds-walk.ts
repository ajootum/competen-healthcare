// DS rollout (Apply + Evaluate): screenshots and checks on a STAGING-pointed dev server as the fixture learner.
// Credentials are read from WALK_FIXTURE and never printed. Usage: WALK_BASE=... WALK_TAG=before|after WALK_FIXTURE=... npx tsx .tmp-walk/ds-walk.ts
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:3192";
const TAG = process.env.WALK_TAG ?? "after";
const OUT = join(process.cwd(), "docs/evidence/DS-ROLLOUT-APPLY-EVALUATE/shots");
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const EMAIL = field("email"), PASSWORD = field("password");
if (!EMAIL || !PASSWORD) { console.error("fixture file lacks email=/password="); process.exit(1); }
const AXE = readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");

const findings: string[] = [];
const ok = (cond: boolean, what: string) => { const l = `${cond ? "PASS" : "FAIL"} ${what}`; findings.push(l); console.log(l); };
const consoleErrors: string[] = []; const failed: string[] = [];
function watch(page: Page, tag: string) {
  page.on("console", m => { if (m.type() === "error" && !/Content Security Policy|upgrade-insecure|status of 409|Encountered a script tag/i.test(m.text())) consoleErrors.push(`${tag}: ${m.text().slice(0, 220)}`); });
  page.on("pageerror", e => consoleErrors.push(`${tag} pageerror: ${String(e).slice(0, 220)}`));
  page.on("response", r => { if (r.status() >= 500) failed.push(`${tag} ${r.status()} ${r.url()}`); });
}

let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
async function signIn(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(1500);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByRole("textbox", { name: /email/i }).waitFor({ timeout: 300_000 });
    await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
    await page.locator("input#password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    const left = await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).then(() => true, () => false);
    console.log(`sign-in attempt ${attempt}: ${left ? "ok" : "still on /login"}`);
    if (left) { cookies = await ctx.cookies(); await ctx.close(); return; }
    await page.waitForTimeout(4000);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  }
  throw new Error("sign-in did not complete");
}

const VIEWS = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "820", width: 820, height: 1180, mobile: true },
  { name: "390", width: 390, height: 844, mobile: true },
];

async function shoot(browser: Browser, path: string, label: string, waitFor: string) {
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.mobile, hasTouch: v.mobile, reducedMotion: "reduce" });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    watch(page, `${label}@${v.name}`);
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
    await page.getByRole("heading", { name: waitFor, exact: true }).first().waitFor({ timeout: 300_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${TAG}-${label}-${v.name}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 1, `${label} ${v.name}: no horizontal overflow (${overflow}px)`);
    await page.addScriptTag({ content: AXE });
    const ax = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (window as any).axe.run(document.querySelector("main") ?? document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      return r.violations.map((x: { id: string; nodes: unknown[] }) => `${x.id}(${x.nodes.length})`);
    });
    ok(ax.length === 0, `${label} ${v.name}: axe ${ax.length ? ax.join(", ") : "0 violations"}`);
    if (v.mobile) {
      const small = await page.evaluate(() => [...document.querySelectorAll("main button, main a[class*='rounded']")].filter(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).map(e => (e.textContent ?? "").trim().slice(0, 30)).slice(0, 6));
      ok(small.length === 0, `${label} ${v.name}: touch targets >= 44px${small.length ? ` (small: ${small.join(" | ")})` : ""}`);
    }
    if (v.name === "1440" && label === "apply") {
      const caseHref = await page.locator("a[href*='study/apply/case']").first().getAttribute("href").catch(() => null);
      if (caseHref) caseLink = caseHref;
    }
    await ctx.close();
  }
}
let caseLink: string | null = null;

(async () => {
  const browser = await chromium.launch();
  await signIn(browser);
  await shoot(browser, "/individual/scholar/study/apply", "apply", "Clinical reasoning");
  await shoot(browser, "/individual/scholar/study/evaluate", "evaluate", "Evaluate my understanding");
  if (caseLink) await shoot(browser, caseLink, "case", "Findings so far");
  else findings.push("INFO no stored case in the fixture's Your cases list: the case page was not shot");
  ok(consoleErrors.length === 0, `console errors: ${consoleErrors.length}${consoleErrors.length ? ` -- ${consoleErrors.slice(0, 4).join(" | ")}` : ""}`);
  ok(failed.length === 0, `5xx responses: ${failed.length}${failed.length ? ` -- ${failed.slice(0, 4).join(" | ")}` : ""}`);
  writeFileSync(join(OUT, `../walk-${TAG}.txt`), findings.join("\n") + "\n");
  await browser.close();
  console.log(`${findings.filter(f => f.startsWith("PASS")).length} PASS, ${findings.filter(f => f.startsWith("FAIL")).length} FAIL`);
})().catch(e => { console.error(e); process.exit(1); });
