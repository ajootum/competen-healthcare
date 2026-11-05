// SCHOLAR-REVISE-WORKSPACE-01: the Revise workspace, on staging, fixture learner only. No AI needed: starting by intention is intercepted.
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:3202";
const OUT = join(process.cwd(), "docs/evidence/REVISE-WORKSPACE-01");
mkdirSync(join(OUT, "shots"), { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const findings: string[] = [];
const ok = (c: boolean, w: string) => { const l = `${c ? "PASS" : "FAIL"} ${w}`; findings.push(l); console.log(l); };
const R = "/individual/scholar/study/revise";
const record: Record<string, unknown> = {};

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(1500);
  for (let a = 0; a < 3 && page.url().includes("/login"); a++) {
    await page.getByRole("textbox", { name: /email/i }).fill(field("email"));
    await page.locator("input#password").fill(field("password"));
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).catch(() => {});
  }
  await page.waitForTimeout(3000);
}
async function go(page: Page, path: string) {
  for (let a = 0; a < 4; a++) { try { await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 }); break; } catch { await page.waitForTimeout(4000); } }
  await page.waitForTimeout(6000);
}
const main = (page: Page) => page.locator("main");
const contradiction = (t: string) => /Due today[^\n]{0,40}\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(t) || /Due today[^\n]{0,40}\d{4}-\d{2}-\d{2}/.test(t);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await signIn(page);

  const post = (url: string, body: unknown, method = "POST") => page.evaluate(async ([u, b, m]) => {
    const r = await fetch(u as string, { method: m as string, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }, [url, body, method] as const);

  // ── resume: an unfinished session, from saved questions, no AI ──
  await go(page, R);
  const started = await post("/api/individual/scholar/revision/sessions", { mode: "quick", scope: { kind: "library" }, generate: false, quantity: 3, formats: ["mcq"], difficulty: "any", feedback: "immediate" });
  const sessionId = started.json.session?.id ?? null;
  record.started = { status: started.status, sessionId: !!sessionId };

  await go(page, R);
  const text = await main(page).innerText();
  await page.screenshot({ path: join(OUT, "shots/today-1440.png") });
  ok(!!(await page.locator("[data-revise-first], #queue-h").first().count()), "Today opens on what needs attention");
  ok(/Start here|Nothing needs attention/.test(text), "the first thing says where to start");
  const firstBox = await page.locator("#queue-h").boundingBox();
  ok(!!firstBox && firstBox.y < 500, `the action is near the top of the page (${Math.round(firstBox?.y ?? -1)} px)`);
  const views = await page.locator("nav[aria-label='Revise views'] a").allInnerTexts();
  ok(views.join("|") === "Today|My Priorities|Studied This Month|All Topics|Revision Insights", `the views are the owner's (${views.join(", ")})`);
  const shortcuts = await page.locator("nav[aria-label='Revise shortcuts'] a").allInnerTexts();
  record.shortcuts = shortcuts;
  ok(["Flashcards", "Practice Questions", "Revision History"].every(s => shortcuts.includes(s)), "direct shortcuts stay");
  ok(!contradiction(text), "no Due today beside a later date");
  for (const w of ["Quick Recall", "Deep Understanding", "Clinical Reasoning", "Mixed Challenge"]) ok(text.includes(w), `${w} can be chosen on Today`);
  ok(!text.includes("How your revision is going"), "the detailed statistics are not on Today");
  const about = (await page.locator("[data-revise-queue] h2, [data-revise-item] p:first-of-type").allInnerTexts()).filter(t => /\b(flash)?cards?\b/i.test(t.split("\n")[0]));
  record.cardRows = about;
  ok(about.length <= 1, `the due cards are one row (${about.length})`);
  const more = page.getByRole("link", { name: "See them all" });
  if (await more.count()) {
    const carry = (await page.locator("[data-revise-item='resume']").count()) + 1;
    ok(carry === 3, `unfinished sessions take at most two rows and one gathering the rest (${carry})`);
    await more.click();
    await page.waitForURL(/resume=all/, { timeout: 120_000 });
    await page.waitForTimeout(5000);
    ok((await page.locator("[data-revise-resume-all] li").count()) >= 3, "See them all lists every unfinished session");
    await page.screenshot({ path: join(OUT, "shots/resume-all-1440.png") });
    await go(page, R);
  }
  ok(!/Saved revision sets/.test(text), "saved sets are not on Today");
  if (sessionId) {
    const first = await page.locator("[data-revise-first]").getAttribute("data-revise-first");
    ok(first === "resume", `unfinished revision comes first (${first})`);
    await page.getByRole("link", { name: "Resume" }).first().click();
    await page.waitForURL(/session=/, { timeout: 120_000 });
    ok(page.url().includes("session="), "Resume opens the session");
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(OUT, "shots/resume-1440.png") });
  } else console.log("no session could start from saved questions: resume not exercised", JSON.stringify(started).slice(0, 200));

  // ── due cards in one place ──
  await go(page, `${R}?review=cards`);
  const cards = await main(page).innerText();
  ok(cards.includes("Review cards due") && cards.includes("Back to Today"), "due cards open on their own, with a way back");

  // ── studied this month ──
  await go(page, `${R}?view=month`);
  const month = await main(page).innerText();
  record.month = month.slice(month.indexOf("Studied in"), month.indexOf("Studied in") + 700);
  ok(/Studied in \w+ \d{4}/.test(month), "Studied This Month names the month");
  ok(month.includes("Uploading a material does not count as studying it"), "it says uploads do not count");
  const groups = await page.locator("[data-studied-material]").count();
  record.monthGroups = groups;
  if (groups) { const g = await page.locator("[data-studied-material]").first().innerText(); ok(/Studied /.test(g) && /Uploaded /.test(g), "a studied material shows studied dates apart from its upload date"); }
  ok(!contradiction(month), "no Due today beside a later date there");
  await page.screenshot({ path: join(OUT, "shots/month-1440.png"), fullPage: true });

  // ── all topics ──
  await go(page, `${R}?view=topics`);
  const all = await main(page).innerText();
  const total = await page.locator("[data-catalogue-material]").count();
  record.catalogueShown = total;
  ok(total > 0, `the catalogue lists materials (${total} on the page)`);
  await page.screenshot({ path: join(OUT, "shots/topics-1440.png"), fullPage: true });
  ok(/oldest learning included/.test(all), "it says older learning is included");
  const firstTitle = (await page.locator("[data-catalogue-material] p").first().innerText()).trim();
  const word = firstTitle.split(/\s+/).find(w => w.length > 4) ?? firstTitle;
  await page.getByRole("textbox", { name: /Search your topics/ }).fill(word);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/q=/, { timeout: 120_000 });
  await page.waitForTimeout(5000);
  const hits = await page.locator("[data-catalogue-material]").allInnerTexts();
  ok(hits.length > 0 && hits.every(h => h.toLowerCase().includes(word.toLowerCase())), `search finds "${word}" only (${hits.length})`);
  await go(page, `${R}?view=topics&status=not_revised`);
  const nr = await page.locator("[data-catalogue-material]").allInnerTexts();
  ok(nr.every(t => t.includes("Not revised yet")), `the status filter works (${nr.length})`);
  await go(page, `${R}?view=topics&from=2099-01-01`);
  ok((await main(page).innerText()).includes("Nothing matches"), "a date filter with nothing says so");
  ok(!!(await page.locator("[data-revise-sets]").count()), "saved sets stay reachable");

  // ── choose what, then how ──
  await go(page, `${R}?view=topics`);
  const chip = page.locator("[data-catalogue-material] ul a").first();
  if (await chip.count()) {
    const topic = (await chip.innerText()).trim();
    await chip.click();
    await page.waitForURL(/topic=/, { timeout: 120_000 });
    await page.waitForTimeout(6000);
    ok((await main(page).innerText()).includes(topic), `choosing a topic names it (${topic})`);
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/individual/scholar/revision/sessions", async route => { sent = JSON.parse(route.request().postData() ?? "{}"); await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "stopped by the walk" }) }); });
    await page.locator("[data-intent='deep_understanding']").click();
    await page.waitForTimeout(1500);
    const s = sent as { intent?: string; scope?: { kind?: string; topic?: string } } | null;
    ok(s?.intent === "deep_understanding" && s?.scope?.kind === "topic" && s?.scope?.topic === topic, "an intention starts on the topic chosen");
    await page.unroute("**/api/individual/scholar/revision/sessions");
    await page.screenshot({ path: join(OUT, "shots/choose-how-1440.png") });
  } else console.log("no topics on this learner: chip not exercised");
  const mat = page.locator("a", { hasText: "Revise this" });
  await go(page, `${R}?view=topics`);
  if (await mat.count()) {
    await mat.first().click();
    await page.waitForURL(/material=/, { timeout: 120_000 });
    await page.waitForTimeout(6000);
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/individual/scholar/revision/sessions", async route => { sent = JSON.parse(route.request().postData() ?? "{}"); await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "stopped by the walk" }) }); });
    await page.locator("[data-intent='quick_recall']").click();
    await page.waitForTimeout(1500);
    const s = sent as { scope?: { kind?: string; materialIds?: string[] } } | null;
    ok(s?.scope?.kind === "documents" && s?.scope?.materialIds?.length === 1, "an intention starts on the material chosen");
    await page.unroute("**/api/individual/scholar/revision/sessions");
  }
  await go(page, `${R}?practice=1`);
  ok(!!(await page.locator("#choose-revision").count()), "Practice Questions opens the full choice of what and how");

  // ── priorities: read from My Plan, nothing written. Staging fixture only; the plan it had is put back ──
  const settingsPath = "/api/individual/scholar/plan/settings";
  const readPlan = () => page.evaluate(async u => { const r = await fetch(u); return { status: r.status, json: await r.json().catch(() => ({})) }; }, settingsPath);
  const planEvents = async () => {
    const { SB_URL, SB_KEY } = process.env;
    const head = { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, Prefer: "count=exact", Range: "0-0" };
    const users = await (await fetch(`${SB_URL}/auth/v1/admin/users?per_page=1000`, { headers: head })).json();
    const id = (users.users ?? []).find((u: { email?: string }) => u.email?.toLowerCase() === field("email").toLowerCase())?.id;
    if (!id) return null;
    const r = await fetch(`${SB_URL}/rest/v1/individual_learning_plan_event?user_id=eq.${id}&select=id`, { headers: head });
    return r.headers.get("content-range");
  };
  await go(page, R);
  const original = await readPlan();
  record.planRead = { status: original.status, hadPlan: !!original.json.settings };
  ok(original.status === 200, "the plan can be read");
  const rows = await page.locator("[data-revise-item], [data-revise-first] h2").allInnerTexts();
  record.queueBefore = rows.map(t => t.split("\n")[0]);
  const candidate = (await page.locator("[data-revise-item='retrieval'] p, [data-revise-item='plan'] p").first().innerText().catch(() => "")).trim() || (await page.locator("[data-revise-first] h2").innerText().catch(() => "")).replace(/^Carry on:\s*/, "").trim();
  const priority = candidate.slice(0, 100);
  record.priorityUsed = priority;
  const later = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  const saved = await post(settingsPath, { goalType: "exam", sessionMinutes: 30, daysPerWeek: 5, examDate: later, examLabel: "Walk exam", goal: "Walk goal", priorities: [priority] });
  ok(saved.status < 300, `a plan with a priority saves on staging (${saved.status})`);
  const planBefore = JSON.stringify((await readPlan()).json.settings), eventsBefore = await planEvents();
  await go(page, R);
  const flagged = await main(page).innerText();
  ok(flagged.includes("In your priorities"), `a matching queue row says In your priorities (${priority})`);
  await page.screenshot({ path: join(OUT, "shots/today-priority-1440.png") });
  await go(page, `${R}?view=priorities`);
  const pri = await main(page).innerText();
  record.priorities = pri.slice(pri.indexOf("What you are working towards"), pri.indexOf("What you are working towards") + 400);
  ok(pri.includes("What you are working towards"), "My Priorities reads the plan");
  ok(pri.includes("Walk goal") && pri.includes("Walk exam") && pri.includes("in 20 days"), "it shows the goal, the exam and the days left");
  const topicLink = page.locator("[data-revise-priority-topics] a", { hasText: priority });
  ok(!!(await topicLink.count()), "it shows the priority topic");
  await topicLink.first().click();
  await page.waitForURL(/topic=/, { timeout: 120_000 });
  await page.waitForTimeout(6000);
  ok((await main(page).innerText()).includes(priority), "following a priority topic names it and asks how to revise it");
  {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/individual/scholar/revision/sessions", async route => { sent = JSON.parse(route.request().postData() ?? "{}"); await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "stopped by the walk" }) }); });
    await page.locator("[data-intent='clinical_reasoning']").click();
    await page.waitForTimeout(1500);
    const s = sent as { intent?: string; scope?: { kind?: string; topic?: string } } | null;
    ok(s?.intent === "clinical_reasoning" && s?.scope?.kind === "topic" && s?.scope?.topic === priority, "an intention starts on the priority topic");
    await page.unroute("**/api/individual/scholar/revision/sessions");
    await go(page, `${R}?view=priorities`);
  }
  ok(pri.includes("Coming up in the next 7 days"), "it shows what is coming up");
  await page.screenshot({ path: join(OUT, "shots/priorities-1440.png"), fullPage: true });
  ok(JSON.stringify((await readPlan()).json.settings) === planBefore, "opening Revise leaves the plan settings as they were");
  const eventsAfter = await planEvents();
  record.planEvents = { before: eventsBefore, after: eventsAfter };
  ok(eventsBefore !== null && eventsBefore === eventsAfter, `opening Revise records no plan event (${eventsBefore} then ${eventsAfter})`);
  const restored = original.json.settings
    ? await post(settingsPath, { ...original.json.settings, confirmIncrease: true })
    : await post("/api/individual/scholar/study-plan", null, "DELETE");
  ok(restored.status < 300, `the fixture's plan is put back (${restored.status})`);

  // ── insights, and everything still reachable ──
  await go(page, `${R}?view=insights`);
  const ins = await main(page).innerText();
  for (const w of ["How your revision is going", "Recall over six weeks", "What you keep missing", "Revision by competency"]) ok(ins.includes(w), `Insights keeps ${w}`);
  ok(/not an assessment|none of this is an assessment/i.test(ins), "Insights keeps the formative distinction");
  ok(/Practised, not achieved/.test(ins), "competency revision stays practised, not achieved");
  record.insightsStats = ins.slice(ins.indexOf("Cards due now"), ins.indexOf("Cards due now") + 300);
  await page.screenshot({ path: join(OUT, "shots/insights-1440.png"), fullPage: true });
  for (const [name, path] of [["Flashcards", `${R}/flashcards`], ["Adaptive Exams", `${R}/adaptive`], ["Mistake Notebook", `${R}/mistakes`], ["Revision History", `${R}/flashcards?view=history`], ["My Decks", `${R}/flashcards?view=decks`], ["a session", sessionId ? `${R}?session=${sessionId}` : R]] as const) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForTimeout(3000);
    ok((res?.status() ?? 0) < 400 && !(await main(page).innerText()).includes("could not be read"), `${name} still opens`);
  }
  await go(page, `${R}/flashcards?view=cards`);
  ok(!contradiction(await main(page).innerText()), "the card list has no Due today beside a later date");
  ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(" | ")})`);
  await ctx.close();

  // ── sizes ──
  for (const [w, h, name] of [[820, 1100, "820"], [390, 844, "390"]] as const) {
    const coarse = await chromium.launch({ args: ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"] });
    const c = await coarse.newContext({ viewport: { width: w, height: h } });
    const p = await c.newPage();
    await signIn(p);
    for (const [v, path] of [["today", R], ["month", `${R}?view=month`], ["topics", `${R}?view=topics`], ["priorities", `${R}?view=priorities`], ["insights", `${R}?view=insights`]] as const) {
      await go(p, path);
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${v} at ${name}: no sideways scroll`);
      const nested = await p.evaluate(() => [...document.querySelectorAll("main *")].filter(e => { const s = getComputedStyle(e); return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 4 && e.tagName !== "TEXTAREA"; }).length);
      ok(nested === 0, `${v} at ${name}: nothing scrolls inside the page (${nested})`);
      record[`height_${v}_${name}`] = await p.evaluate(() => document.documentElement.scrollHeight);
      await p.screenshot({ path: join(OUT, `shots/${v}-${name}.png`) });
      if (v === "today") {
        const box = await p.locator("#queue-h").boundingBox();
        ok(!!box && box.y < h, `today at ${name}: where to start is on the first screen (${Math.round(box?.y ?? -1)} px)`);
        const small = await p.locator("nav[aria-label='Revise views'] a, nav[aria-label='Revise shortcuts'] a").evaluateAll(ls => ls.map(l => Math.round(l.getBoundingClientRect().height)).filter(x => x < 44));
        ok(small.length === 0, `today at ${name}: view and shortcut links are at least 44 px on touch (${small.join(",")})`);
      }
    }
    await coarse.close();
  }
  await browser.close();
  writeFileSync(join(OUT, "walk.json"), JSON.stringify(record, null, 2));
  writeFileSync(join(OUT, "walk.txt"), findings.join("\n") + "\n");
  console.log(JSON.stringify(record, null, 1).slice(0, 2600));
  console.log(`${findings.filter(f => f.startsWith("PASS")).length} PASS, ${findings.filter(f => f.startsWith("FAIL")).length} FAIL`);
})().catch(e => { console.error(e); writeFileSync(join(OUT, "walk.txt"), findings.join("\n") + "\n"); process.exit(1); });
