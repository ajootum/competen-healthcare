// SCHOLAR-ASK-SOURCES-01: per-question sources, on staging, fixture learner only. A few real AI calls and research searches.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WALK_BASE ?? "http://127.0.0.1:3202";
const OUT = join(process.cwd(), "docs/evidence/ASK-SOURCES-01");
mkdirSync(join(OUT, "shots"), { recursive: true });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const field = (k: string) => fixture.split(/\r?\n/).find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const findings: string[] = [];
const ok = (c: boolean, w: string) => { const l = `${c ? "PASS" : "FAIL"} ${w}`; findings.push(l); console.log(l); };
const LIB = "/individual/scholar/study";
const Q = process.env.WALK_Q ?? "Why should critically ill patients be assessed on a continuing basis?";
const RQ = process.env.WALK_RES_Q ?? Q;
const record: Record<string, unknown> = {};

async function signIn(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300_000 });
  await page.waitForTimeout(1500);
  for (let a = 0; a < 3 && page.url().includes("/login"); a++) {
    await page.getByRole("textbox", { name: /email/i }).fill(field("email"));
    await page.locator("input#password").fill(field("password"));
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 120_000 }).catch(() => {});
  }
  await page.waitForTimeout(4000);
}
async function open(page: import("@playwright/test").Page) {
  for (let a = 0; a < 4; a++) { try { await page.goto(`${BASE}${LIB}`, { waitUntil: "domcontentloaded", timeout: 300_000 }); break; } catch { await page.waitForTimeout(5000); } }
  await page.waitForTimeout(7000);
}
const panel = (page: import("@playwright/test").Page) => page.locator("section[aria-labelledby='explain-h']");
const chip = (page: import("@playwright/test").Page, name: RegExp) => panel(page).locator("label").filter({ hasText: name });

async function ask(page: import("@playwright/test").Page, q: string, opts: { chips?: RegExp[]; mode?: string; before?: () => Promise<void> } = {}) {
  await panel(page).locator("textarea").fill(q);
  for (const c of opts.chips ?? []) await chip(page, c).first().click();
  if (opts.before) await opts.before();
  if (opts.mode) await panel(page).locator("label").filter({ hasText: new RegExp(`^${opts.mode}$`) }).click();
  const sent = page.waitForRequest(r => /\/api\/individual\/scholar\/explain/.test(r.url()) && r.method() === "POST", { timeout: 60_000 });
  const reply = page.waitForResponse(r => /\/api\/individual\/scholar\/explain/.test(r.url()) && r.request().method() === "POST", { timeout: 240_000 });
  await panel(page).locator("button[type=submit]").click();
  const req = await sent;
  const res = await reply;
  const json = await res.json().catch(() => ({}));
  await page.waitForTimeout(1500);
  return { url: new URL(req.url()).pathname, body: JSON.parse(req.postData() ?? "{}"), status: res.status(), json };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page);
  await open(page);
  await page.waitForFunction(() => !!document.querySelector("section[aria-labelledby='explain-h'] textarea"), null, { timeout: 120_000 });

  const chips = await panel(page).locator("fieldset").first().locator("label").allInnerTexts();
  console.log("offered:", chips.join(" | "));
  const offered = (n: RegExp) => chips.some(c => n.test(c));
  ok(offered(/My learning materials/), "my learning materials is offered");
  ok(!offered(/Web/i), "web sources are not offered, because Ask has no web path");
  const hasSaved = offered(/saved learning/), hasLibrary = offered(/Competen Library/), hasResearch = offered(/Research literature/);
  console.log({ hasSaved, hasLibrary, hasResearch });
  ok(hasSaved, "my saved learning is offered");
  ok(process.env.WALK_LIBRARY === "on" ? hasLibrary : !hasLibrary, process.env.WALK_LIBRARY === "on" ? "Competen Library is offered" : "Competen Library is hidden from a learner who can reach no approved content");
  ok(hasResearch, "research literature is offered");
  await panel(page).screenshot({ path: join(OUT, "shots/selector-1440.png") });

  // 1. Default: notes only, the existing route, the same answer shape.
  const notes = await ask(page, Q);
  record.notes = { url: notes.url, sources: (notes.json.sources ?? []).length, answer: String(notes.json.answer ?? notes.json.message).slice(0, 300) };
  ok(notes.url === "/api/individual/scholar/explain", "materials alone goes to the existing explain route");
  ok(!("sources" in notes.body), "the default request names no sources, so it is the existing request");
  ok(!!notes.json.answer && (notes.json.sources ?? []).length > 0, "the default answers with citations");
  ok((await panel(page).innerText()).includes("What Scholar searched"), "the answer says what was searched");
  ok((await panel(page).innerText()).includes("My learning materials: searched and used"), "materials are reported as searched and used");
  await panel(page).screenshot({ path: join(OUT, "shots/default-answer-1440.png") });

  // 2. A specific material.
  const material = await page.evaluate(() => document.querySelector("a[href*='/study/'][href$='']")?.getAttribute("href"));
  void material;
  const specific = await ask(page, Q, { before: async () => {
    await panel(page).getByLabel("Materials I choose").check();
    await panel(page).locator("ul input[type=checkbox]").first().check();
  } });
  ok(Array.isArray(specific.body.materialIds) && specific.body.materialIds.length === 1, "a chosen material is sent on its own");
  const allowed = new Set([specific.body.materialIds[0]]);
  ok((specific.json.sources ?? []).every((s: { materialId: string }) => allowed.has(s.materialId)), "the answer cites only the chosen material");
  record.specific = { sources: (specific.json.sources ?? []).length, message: specific.json.message ?? null };
  await open(page);

  // The choice is per question: it went back after the last question.
  ok(await chip(page, /My learning materials/).first().locator("input").isChecked(), "a fresh question starts on my materials");

  // 3. Combined, with research: each source apart, found told from read.
  if (hasResearch) {
    const both = await ask(page, RQ, { chips: [/Research literature/] });
    record.combined = { url: both.url, status: both.status, sent: both.body.sources, searched: both.json.searched, answer: String(both.json.answer ?? "").slice(0, 300), research: both.json.research && { text: both.json.research.text?.slice(0, 400) ?? null, withheld: both.json.research.withheld, used: both.json.research.used?.length, found: both.json.research.found?.length } };
    ok(both.url === "/api/individual/scholar/explain/across", "materials plus research goes to the new route");
    ok(JSON.stringify(both.body.sources) === JSON.stringify(["materials", "research"]), "both chosen sources are sent");
    ok((both.json.searched ?? []).map((s: { source: string }) => s.source).join() === "materials,research", "both are reported as searched");
    const main = String(both.json.answer ?? "");
    ok(!/PART (ONE|TWO)/i.test(main), "the name of a part is never shown");
    ok(!main || !/\[[CE]\d+\]/.test(main), "the materials answer holds no research citation");
    const rtext = String(both.json.research?.text ?? "");
    ok(!rtext || !/\[[SC]\d+\]/.test(rtext), "the research part holds no materials citation");
    const used = both.json.research?.used ?? [];
    ok(used.every((u: { tag: string | null }) => /^E\d+$/.test(u.tag ?? "")), "research sources used carry [E n]");
    ok(!rtext || [...rtext.matchAll(/\[E(\d+)\]/g)].every(m => used.some((u: { tag: string }) => u.tag === `E${m[1]}`)), "every [E n] in the text has its reference");
    const text = await panel(page).innerText();
    ok(!!rtext, "the combined answer has a research part");
    ok(used.length > 0, "at least one source is listed as used");
    ok(/full text not read/i.test(text), "research is labelled as abstracts, full text not read");
    if ((both.json.research?.found ?? []).length) ok(text.includes("Found, not used as evidence"), "sources only found are listed apart from evidence");
    await panel(page).screenshot({ path: join(OUT, "shots/combined-research-1440.png") });
    await open(page);

    // 4. Research alone, and a mode.
    const alone = await ask(page, RQ, { chips: [/Research literature/, /My learning materials/], mode: "Summarise" });
    record.researchAlone = { sent: alone.body.sources, mode: alone.body.mode, searched: alone.json.searched, version: alone.json.provenance?.promptVersion ?? null, text: alone.json.research?.text?.slice(0, 300) ?? null, withheld: alone.json.research?.withheld ?? null };
    ok(JSON.stringify(alone.body.sources) === JSON.stringify(["research"]), "research alone can be chosen");
    ok(alone.body.mode === "summary", "Summarise is kept across sources");
    ok(!alone.json.answer, "research alone shows no notes answer");
    ok(!!alone.json.research?.text, "research alone gives a cited research answer");
    await panel(page).screenshot({ path: join(OUT, "shots/research-alone-1440.png") });
    ok(!alone.body.materialIds, "no material is sent when materials are not chosen");
    ok(!alone.json.provenance || String(alone.json.provenance.promptVersion).includes("summary"), "the record names the mode");
    await open(page);
  } else console.log("research is not operational here: not exercised");

  // 5. Saved learning.
  if (hasSaved) {
    const saved = await ask(page, "critically ill patients", { chips: [/saved learning/, /My learning materials/] });
    record.saved = { sent: saved.body.sources, searched: saved.json.searched, answer: String(saved.json.answer ?? "").slice(0, 300), sources: (saved.json.sources ?? []).map((s: { citation: string; origin: string; savedPath: string }) => ({ citation: s.citation, origin: s.origin, savedPath: s.savedPath })), message: saved.json.message ?? null };
    ok(JSON.stringify(saved.body.sources) === JSON.stringify(["saved"]), "saved learning alone can be chosen");
    ok((saved.json.searched ?? [])[0]?.source === "saved", "saved learning is reported as searched");
    ok((saved.json.sources ?? []).every((s: { origin: string }) => s.origin === "saved"), "what it cites is marked as saved learning");
    await panel(page).screenshot({ path: join(OUT, "shots/saved-1440.png") });
    await open(page);
  }

  // 6. Competen Library, with materials.
  if (hasLibrary) {
    const lib = await ask(page, process.env.WALK_LIB_Q ?? Q, { chips: [/Competen Library/] });
    record.library = { sent: lib.body.sources, searched: lib.json.searched, library: lib.json.library ?? null, answer: String(lib.json.answer ?? "").slice(0, 200) };
    ok((lib.json.searched ?? []).some((s: { source: string }) => s.source === "library"), "Competen Library is reported as searched");
    ok(!/PART (ONE|TWO)/i.test(String(lib.json.answer ?? "")), "the name of a part is never shown here either");
    ok(!lib.json.library || (lib.json.library.items ?? []).length > 0, "library entries are listed as they stand");
    await panel(page).screenshot({ path: join(OUT, "shots/library-1440.png") });
    await open(page);
  }

  // 6b. How library entries look. Staging can reach none (its frameworks are unpublished), so this reply is STUBBED: it checks the layout only.
  if (!hasLibrary && hasResearch) {
    await page.route("**/api/individual/scholar/explain/across", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      notInNotes: true, searched: [{ source: "research", state: "no_match", count: 0, note: null }, { source: "library", state: "listed", count: 1, note: null }],
      library: { label: "Approved Competen Library entries that match your question. These are competency titles and outcomes, not teaching text, so Scholar lists them and does not write from them.", items: [{ title: "Oxygen therapy", code: "RS-1", outcome: "Stub outcome for layout only", status: "Clinically approved", kind: "competency" }] },
    }) }));
    await ask(page, "Layout check only", { chips: [/Research literature/] });
    const t = await panel(page).innerText();
    ok(/in competen library/i.test(t) && t.includes("Clinically approved"), "library entries show apart, with their status (layout only, stubbed reply)");
    ok(t.includes("Competen Library: searched, matching entries listed"), "library entries are reported as listed, not used (layout only, stubbed reply)");
    await panel(page).screenshot({ path: join(OUT, "shots/library-layout-stub-1440.png") });
    await page.unroute("**/api/individual/scholar/explain/across");
    await open(page);
  }

  // 7. Permissions: the route answers only for the caller's own, and only sources that are offered.
  const post = (body: unknown) => page.evaluate(async b => {
    const r = await fetch("/api/individual/scholar/explain/across", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }, body);
  const web = await post({ question: "sepsis care", sources: ["web"] });
  ok(web.status === 200 && web.json.searched?.[0]?.state === "not_run", `web asked for by hand is reported as not searched (${web.status})`);
  const foreign = await post({ question: Q, sources: ["materials", "saved"], materialIds: ["00000000-0000-4000-8000-000000000000"] });
  ok((foreign.json.sources ?? []).every((s: { origin: string }) => s.origin === "saved"), "a material that is not the learner's gives nothing from it");
  const patient = await post({ question: "Why did John Smith, NHS number 943 476 5919, deteriorate?", sources: ["research"] });
  ok(patient.status === 422, `a question that identifies a patient is refused before any search (${patient.status})`);
  const none = await post({ question: Q, sources: [] });
  ok(none.status === 400, "no source is refused");
  const anon = await browser.newContext();
  const out = await anon.request.post(`${BASE}/api/individual/scholar/explain/across`, { data: { question: Q, sources: ["research"] }, maxRedirects: 0 });
  ok([401, 307].includes(out.status()), `signed out is refused (${out.status()})`);
  await anon.close();

  // 8. Search history keeps the choice.
  await page.goto(`${BASE}${LIB}/saved/searches`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForTimeout(7000);
  const hist = await page.locator("main").innerText();
  ok(/Searched: My learning materials, Research literature/.test(hist), "search history shows the sources chosen with the question");
  ok(/Searched: Research literature(?!,)/.test(hist), "the same words asked of other sources are their own entry");
  ok(hist.includes("Answer not kept"), "the row still says the answer is not kept");
  await page.screenshot({ path: join(OUT, "shots/history-1440.png") });
  await ctx.close();

  // 9. A phone: wraps, and touch targets.
  const phone = await chromium.launch({ args: ["--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"] });
  const pc = await phone.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await pc.newPage();
  await signIn(pp);
  await open(pp);
  await pp.waitForFunction(() => !!document.querySelector("section[aria-labelledby='explain-h'] textarea"), null, { timeout: 120_000 });
  const sizes = await panel(pp).locator("fieldset").first().locator("label").evaluateAll(ls => ls.map(l => { const r = l.getBoundingClientRect(); return { h: Math.round(r.height), right: Math.round(r.right) }; }));
  ok(sizes.every(s => s.h >= 44), `each source is at least 44 px tall on touch (${sizes.map(s => s.h).join(", ")})`);
  ok(sizes.every(s => s.right <= 390), "nothing runs off a 390 px screen");
  ok(await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the page does not scroll sideways");
  await panel(pp).screenshot({ path: join(OUT, "shots/selector-390.png") });
  await phone.close();
  await browser.close();

  writeFileSync(join(OUT, "walk.json"), JSON.stringify(record, null, 2));
  writeFileSync(join(OUT, "walk.txt"), findings.join("\n") + "\n");
  console.log(JSON.stringify(record, null, 1).slice(0, 3500));
  console.log(`${findings.filter(f => f.startsWith("PASS")).length} PASS, ${findings.filter(f => f.startsWith("FAIL")).length} FAIL`);
})().catch(e => { console.error(e); process.exit(1); });
