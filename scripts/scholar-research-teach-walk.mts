// SCHOLAR-RESEARCH-TEACH-001 P1: browser walk on the STAGING-pointed dev server, as the synthetic fixture learner, on the Growth and
// Development session. Credentials are read from the fixture file (WALK_FIXTURE) and never printed. It asks for a fresh Teach Me once
// (one lesson, two model calls), then reopens it to prove the saved lesson needs no AI and no search. Screenshots go to OUT.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://localhost:3100";
const MATERIAL = process.env.WALK_MATERIAL!;
const OUT = process.env.OUT ?? "docs/evidence/SCHOLAR-RESEARCH-TEACH-001/shots";
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
let SESSION = "", LESSON = "";
const AXE = readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");
const log: string[] = [];
const ok = (c: boolean, w: string) => { const l = `${c ? "PASS" : "FAIL"} ${w}`; log.push(l); console.log(l); };
const info = (w: string) => { const l = `INFO ${w}`; log.push(l); console.log(l); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
page.on("response", r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
await page.waitForTimeout(1500);
// A first dev compile can lose the first attempt: the form fills before it is live.
for (let attempt = 1; ; attempt++) {
  // The dev server can answer 500 while it recompiles: load the page again rather than wait on a broken one.
  for (let tries = 0; tries < 6 && !(await page.getByRole("textbox", { name: /email/i }).waitFor({ timeout: 40_000 }).then(() => true, () => false)); tries++) await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.getByRole("textbox", { name: /email/i }).fill(field("email"));
  await page.locator("input#password").fill(field("password"));
  await page.getByRole("button", { name: /sign in/i }).click();
  const left = await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).then(() => true, () => false);
  if (left) break;
  if (attempt >= 3) throw new Error("sign-in did not complete");
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
}
info("signed in as the fixture learner");

const opened: Record<string, unknown>[] = [];
page.on("response", async r => { if (r.url().includes("/learn/act") && r.request().method() === "POST") { const body = r.request().postDataJSON(); const json = await r.json().catch(() => null); if (json) opened.push({ open: body?.open === true, fresh: body?.fresh === true, cached: json.cached, promptVersion: json.provenance?.promptVersion, step: json.step, research: json.research ? { integrated: json.research.integrated, refs: json.research.references?.length, message: json.research.message } : null }); } });

// API calls go through the browser context's own cookies, so a dev recompile that reloads the page cannot cut one short.
const api = async (path: string, method: "POST" | "PATCH", data: unknown) => { const r = await ctx.request.fetch(`${BASE}${path}`, { method, data, timeout: 200_000 }); return { status: r.status(), json: await r.json().catch(() => ({})) as Record<string, any> }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
// A session on the whole document, as the learner starts one from their Library. No AI.
const made = await api("/api/individual/scholar/learn/sessions", "POST", { scope: JSON.parse(process.env.WALK_SCOPE ?? "null") ?? { kind: "document", materialId: MATERIAL } });
info(`session: status ${made.status}, ${made.json.resumed ? "resumed" : "new"}, ${made.json.error ?? ""}`);
SESSION = made.json.session?.id; LESSON = `${BASE}/individual/scholar/study/learn?session=${SESSION}`;
await page.goto(LESSON, { waitUntil: "domcontentloaded", timeout: 300_000 });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
await page.waitForTimeout(12_000);
info(`first requests: ${JSON.stringify(opened.slice(0, 3))}`);
await page.screenshot({ path: join(OUT, "1-saved-notes-lesson.png") });
const before = opened.find(o => o.cached === true);
if (before) ok(/External research was not included/.test(await page.locator("body").innerText()), "a lesson saved before the switch opens with no AI and says research is not in it");
else info("no lesson saved before the switch on this session");

// One fresh lesson, asked for the way the page asks. Timed.
// The lesson that holds these slides, found by opening each step: an open never calls the AI. Then the learner's own move to it.
const found: { step: number; title: string | null }[] = [];
for (let n = 0; n <= 12; n++) {
  const j = (await api("/api/individual/scholar/learn/act", "POST", { action: "teach", sessionId: SESSION, step: n, open: true })).json;
  if (j.step !== n) continue;
  found.push({ step: n, title: j.lesson?.title ?? null });
}
info(`steps: ${JSON.stringify(found)}`);
const target = found[Number(process.env.WALK_STEP_INDEX ?? 0)];
if (!target) throw new Error("no lesson on these slides in this session");
const step = target.step;
await api(`/api/individual/scholar/learn/sessions/${SESSION}`, "PATCH", { currentStep: step });
if (process.env.WALK_SKIP_FRESH !== "1") {
const started = Date.now();
const asked = await api("/api/individual/scholar/learn/act", "POST", { action: "teach", sessionId: SESSION, step, fresh: true });
const fresh = { status: asked.status, ...asked.json } as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ms = Date.now() - started;
info(`fresh Teach Me: status ${fresh.status}, ${ms} ms, model ${fresh.provenance?.model}, version ${fresh.provenance?.promptVersion}, error ${fresh.error}`);
ok(fresh.status === 200 && !!fresh.answer && /\[E\d+\]/.test(fresh.answer) && /\[S\d+\]/.test(fresh.answer), "the route teaches from the notes and the evidence together");
ok(!!fresh.research?.integrated && fresh.research.references.every((r: { pmid: string | null; accessed?: string }) => !!r.pmid && r.accessed === "abstract"), "every reference has a PMID and says only its abstract was read");
ok(fresh.research?.query === null, "the reply carries no query");
writeFileSync(join(OUT, "..", "route-lesson.md"), fresh.answer ?? "");
writeFileSync(join(OUT, "..", "route-references.json"), JSON.stringify(fresh.research?.references ?? [], null, 1));

}

// Reopen: saved, no AI, no search. The page must render all three sources and the two categories.
opened.length = 0;
await page.goto(LESSON, { waitUntil: "domcontentloaded", timeout: 300_000 });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
info("lesson page loaded");
// The page opens at the session's current lesson; the learner moves to the lesson by its own row.
// A click before the page is live is lost: wait for its own first request.
for (let i = 0; i < 90 && !opened.length; i++) await page.waitForTimeout(2000);
await page.waitForTimeout(3000);
if (process.env.WALK_NO_MOVE !== "1") await page.getByText(/^1\.\s*Critical sensitive periods/).first().click({ timeout: 120_000 });
await page.waitForTimeout(15_000);
info(`requests: ${JSON.stringify(opened)}`);
const summary = page.locator("summary").filter({ hasText: "Scientific evidence and references" }).first();
await summary.waitFor({ timeout: 90_000 });
await page.waitForTimeout(1500);
ok(opened.some(o => o.open === true && o.cached === true && String(o.promptVersion).includes("research-teach")) && !opened.some(o => o.open === false && o.cached === false), "reopening is served from what was saved: open only, no generation");
const reading = page.locator(".cmp-reading").filter({ has: page.locator('a[href^="#evidence-E"]') }).first();
const text = await reading.innerText();
// [S n] is the app's own citation chip, written that way on purpose. The two new tags must not show as raw text.
ok(!/\[E\d+\]|\[AI\]/.test(text), "no raw [E n] or [AI] tag shows in the lesson");
ok(await reading.locator('a[href^="#evidence-E"]').count() > 0, "research citations are links to their reference");
ok(/AI/.test(text), "Scholar's own sentences carry their AI label");
info(`lesson on the page: ${text.split(/\s+/).length} words`);
await reading.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(OUT, "2-lesson-with-evidence.png") });
await summary.click();
await page.waitForTimeout(400);
ok(await page.getByRole("heading", { name: "My notes" }).count() > 0 && await page.getByRole("heading", { name: "Research" }).count() > 0, "the references are in two categories: My notes and Research");
ok(/Abstract reviewed, not the full text/.test(await page.locator("body").innerText()), "says only abstracts were reviewed");
ok(/subject terms only/.test(await page.locator("body").innerText()), "tells the learner only subject terms are sent");
await summary.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(OUT, "3-references-open.png") });

await page.addScriptTag({ content: AXE });
const details = page.locator("details").filter({ hasText: "Scientific evidence and references" }).first();
const a11y = await details.evaluate(async el => { const r = await (window as unknown as { axe: { run: (e: Element, o: unknown) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe.run(el, { runOnly: ["wcag2a", "wcag2aa"] }); return r.violations.map(v => `${v.id}:${v.impact}`); });
ok(a11y.length === 0, `axe on the references section: ${a11y.join(", ") || "no violations"}`);

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
const p2 = await phone.newPage();
await p2.goto(LESSON, { waitUntil: "domcontentloaded", timeout: 300_000 });
await p2.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
if (process.env.WALK_NO_MOVE !== "1") { await p2.waitForTimeout(25_000); await p2.getByText(/^1\.\s*Critical sensitive periods/).first().click({ timeout: 120_000 }).catch(() => {}); }
const s2 = p2.locator("summary").filter({ hasText: "Scientific evidence and references" }).first();
await s2.waitFor({ timeout: 180_000 });
await s2.click();
await s2.scrollIntoViewIfNeeded();
await p2.waitForTimeout(400);
ok(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll on a phone");
await p2.screenshot({ path: join(OUT, "4-phone-references.png") });

ok(errors.length === 0, `no page errors or 5xx: ${errors.join(" | ") || "none"}`);
writeFileSync(join(OUT, "..", "walk.txt"), `${log.join("\n")}\n`);
await browser.close();
