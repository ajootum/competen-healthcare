// SCHOLAR-GO-DEEPER-001: THE COUNTED STAGING TEST. Real code, the real metered runner, the fixture learner's Growth and Development lesson, its saved Teach me.
// Nothing here is saved as a learner's teaching: each round is built on TAUGHT SO FAR in memory, so the fixture stays as it was and the browser walk starts clean.
// Own ledger and caps. Staging only (refuses anything else). Keys are read here and never printed.
// Usage: npx tsx docs/evidence/SCHOLAR-GO-DEEPER-001/go-deeper-gen.mts <lesson step or "first"> <run...>   run = v2 | understand | explore | advanced | explore2 | advanced2 | reuse
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const REPO = "C:/Users/elish/Documents/Competen/competen-godeeper";
const SP = "C:/Users/elish/AppData/Local/Temp/claude/e7cc951866a58dfc/0feb3955-b31d-49b3-9950-3adb8bb92e86/scratchpad";
const OUT = `${REPO}/docs/evidence/SCHOLAR-GO-DEEPER-001`;
const FIXTURE = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/guided-fixture.txt";
const CAP_CALLS = 24, CAP_USD = 2.5;
const ledgerFile = `${SP}/go-deeper-ledger.json`;
const ledger: { calls: number; usd: number; runs: unknown[] } = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, "utf8")) : { calls: 0, usd: 0, runs: [] };
const imp = (p: string) => import(pathToFileURL(REPO + p).href);
const req = createRequire(REPO + "/package.json");
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!, service = process.env.STAGING_SERVICE_ROLE_KEY!, anon = process.env.STAGING_ANON_KEY;
if (!url || !service || !url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const { judgeTarget } = await imp("/scripts/production-guard.ts");
if (!judgeTarget(url).ok) throw new Error("guard refused");
process.env.NEXT_PUBLIC_SUPABASE_URL = url; process.env.SUPABASE_SERVICE_ROLE_KEY = service; if (anon) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
const admin = req("@supabase/supabase-js").createClient(url, service, { auth: { persistSession: false } });
const email = fs.readFileSync(FIXTURE, "utf8").split(/\r?\n/).find(l => l.startsWith("email="))!.slice(6).trim();
const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId = users.find((u: { email?: string }) => u.email === email)?.id;
if (!userId) throw new Error("no fixture learner");

const store = await imp("/src/lib/individual/scholar/store.ts");
const gen = await imp("/src/lib/individual/scholar/generation.ts");
const http = await imp("/src/lib/individual/scholar/http.ts");
const sas = await imp("/src/lib/individual/scholar/ai-standing.ts");
const pol = await imp("/src/lib/individual/policy.ts");
const ctxMod = await imp("/src/lib/individual/scholar/learn-context.ts");
const learn = await imp("/src/lib/individual/scholar/learn.ts");
const tutor = await imp("/src/lib/individual/scholar/competency-view.ts");
const deeper = await imp("/src/lib/individual/scholar/deeper-format.ts");

const MATERIAL = "087a0754-5573-450e-a73c-1d40b4584bf3";
const SESSION = "3484e65a-ee9c-425a-9b63-b2cca40c898e", STEP = 2; // Lesson 3 of the deck: motor development, reflexes, head control through to walking.
const sess = await store.getLearningSession(admin, userId, SESSION);
const here = sess.data.steps.find((x: { step: number }) => x.step === STEP);
const stepIds: string[] = here.sections.map((x: { chunkId: string }) => x.chunkId);
const passages = (await Promise.all(stepIds.map((id: string) => store.getPassage(admin, userId, id)))).filter(Boolean);
const policy = await pol.loadIndividualPolicy(admin);
const whole = await sas.getScholarAiStanding(admin, userId);
const st = sas.activityState(whole, "deeper");
if (!st.available) { console.log("STOP: deeper not available for the fixture", st); process.exit(2); }
const ctx = { admin, userId, profile: { fullName: null }, live: ["scholar"] } as never;
const topics = await store.topicsOfSections(admin, userId, passages.map((p: { chunkId: string }) => p.chunkId));
const lesson = learn.lessonOutline({ step: 0, sections: passages.map((p: any) => ({ chunkId: p.chunkId, materialId: p.materialId, ordinal: p.ordinal, pageFrom: p.pageFrom, pageTo: p.pageTo, materialTitle: p.materialTitle, unit: p.unit ?? "page" })) }, topics, new Map(passages.map((p: any) => [p.chunkId, learn.sectionProfile(p.content)])));
const lessonBrief = { title: lesson.title, objective: lesson.objective, sections: [...new Set(passages.map((p: any) => learn.sectionProfile(p.content).heading).filter(Boolean))] };
console.log(`lesson "${lesson.title}", ${passages.length} sections, ${passages.reduce((n: number, p: any) => n + p.content.length, 0)} chars`);
const learnerContext = await tutor.loadTutorContext(admin, userId, passages.map((p: any) => p.chunkId)).catch(() => null);

const results: Record<string, unknown> = JSON.parse(fs.existsSync(`${SP}/go-deeper-results.json`) ? fs.readFileSync(`${SP}/go-deeper-results.json`, "utf8") : "{}");
const teachSaved = (results.teach as { saved?: string } | undefined)?.saved ?? null;
const earlier: { action: string; content: string; createdAt: string }[] = teachSaved ? [{ action: "teach", content: teachSaved, createdAt: "2026-11-06T11:00:00Z" }] : [];
const RUNS: Record<string, { structured: boolean; depth: "brief" | "standard" | "detailed"; after?: string; action?: "teach"; research?: boolean }> = {
  teach: { structured: false, depth: "standard", action: "teach" }, v2: { structured: false, depth: "standard" }, understand: { structured: true, depth: "brief" }, explore: { structured: true, depth: "standard" }, advanced: { structured: true, depth: "detailed" },
  research: { structured: true, depth: "standard", research: true },
  explore2: { structured: true, depth: "standard", after: "explore" }, advanced2: { structured: true, depth: "detailed", after: "explore" },
};
for (const name of process.argv.slice(2)) {
  const spec = RUNS[name];
  if (!spec) throw new Error(`unknown run ${name}`);
  if (ledger.calls + 1 > CAP_CALLS || ledger.usd >= CAP_USD) { console.log(`CAP reached: ${ledger.calls} calls, USD ${ledger.usd}`); break; }
  const prior = spec.after ? [(results[spec.after] as { saved: string }).saved].map(c => ({ action: "deeper", content: c, createdAt: "2026-11-06T12:00:00Z" })) : [];
  const t = ctxMod.buildTaughtSoFar([...earlier, ...prior], [], { objective: lesson.objective, focus: lesson.focus });
  const taught = spec.action === "teach" ? null : ctxMod.taughtSoFarBlock(t);
  if (!spec.action && !taught) throw new Error("run teach first");
  const prompt = spec.action === "teach" ? "Teach me this step." : "Help me understand this in more depth.";
  const risk = await http.scholarRisk(admin, userId, { text: prompt, passages, purpose: "education" });
  Object.assign(risk, { intentContext: { surface: "learn", lessonTitle: lesson.title, objective: lesson.objective, materialTopics: [] } });
  const ai = http.scholarAiRunner(ctx, new Request("http://go-deeper-test.local/"), "deeper", risk, `godeeper${Date.now()}`);
  let used = 0;
  let rawText: string | null = null;
  const run = async (g: unknown, part: unknown) => { used++; const res = await ai.run(g, part); rawText = (res as { text?: string }).text ?? null; return res; };
  const started = Date.now();
  const r = await gen.runLearn(userId, { action: spec.action ?? "deeper", question: prompt, passages, references: [], depth: spec.depth, background: true, history: [], learnerContext,
    // A STAND-IN, written for this test and labelled so: it proves the round and the research part work together. Not a real paper and never shown to a learner. Real evidence is SCHOLAR-RESEARCH-TEACH-001's.
    research: spec.research ? [{ tag: "E1", title: "TEST STAND-IN, not a real paper: maturation of motor control in infancy", journal: "Test fixture", year: 2020, abstract: "This stand-in abstract states that voluntary head control in infants was observed to emerge before independent walking, and that the order was more consistent than the timing between infants. It reports that the fading of some early reflexes coincided with growing voluntary control, and cautions that the observations were limited and could not establish cause." }] : [], taught, lesson: lessonBrief, learnerTexts: [], deeperStructured: spec.structured }, run);
  const ms = Date.now() - started;
  ledger.calls += used;
  const refusal = ai.refusal?.();
  let rows: any[] | null = null;
  for (let i = 0; i < 8 && !rows?.length; i++) { await new Promise(res => setTimeout(res, 1500)); ({ data: rows } = await admin.from("plat_ai_requests").select("model, input_tokens, output_tokens, cost_usd, status").eq("action_id", ai.actionId)); }
  const cost = (rows ?? []).reduce((n: number, x: { cost_usd: number | null }) => n + Number(x.cost_usd ?? 0), 0);
  ledger.usd = Number((ledger.usd + cost).toFixed(5));
  const saved = r.ok && r.check.ok ? r.check.text : null;
  if (spec.action === "teach" && saved) earlier.push({ action: "teach", content: saved, createdAt: "2026-11-06T11:00:00Z" });
  const parts = saved ? deeper.parseDeeperAnswer(saved) : null;
  const rec = {
    name, structured: spec.structured, depth: spec.depth, after: spec.after ?? null, calls: used, ms, usage: rows ?? [], cost_usd: cost, refusal: refusal ?? null,
    ok: r.ok, error: r.ok ? null : r.error, promptVersion: r.ok ? r.promptVersion : null, model: r.ok ? r.model : null, depthReached: r.ok ? r.depthReached ?? null : null,
    check: r.ok ? { ok: r.check.ok, reason: r.check.ok ? null : r.check.reason, violations: r.check.ok ? null : r.check.violations ?? null, salvaged: r.check.ok ? r.check.salvaged ?? null : null, cited: r.check.ok ? r.check.cited : null } : null,
    background: r.ok ? r.background : null, flags: r.ok ? r.flags : null, research: r.ok ? r.research : null,
    words: saved ? saved.split(/\s+/).length : 0,
    sections: parts ? parts.sections.map((s: { kind: string; source: string; title: string; blocks: { t: string }[] }) => ({ kind: s.kind, source: s.source, title: s.title, blocks: s.blocks.map(b => b.t) })) : null,
    saved, raw: rawText,
  };
  results[name] = rec;
  (ledger.runs as unknown[]).push({ name, calls: used, cost_usd: cost, ok: rec.check?.ok ?? false });
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
  fs.writeFileSync(`${SP}/go-deeper-results.json`, JSON.stringify(results, null, 1));
  console.log(`${name}: calls ${used}, ${ms} ms, USD ${cost.toFixed(4)}, tokens ${JSON.stringify((rows ?? []).map((x: any) => [x.model, x.input_tokens, x.output_tokens]))}, ok ${rec.check?.ok} ${rec.check?.reason ?? ""} words ${rec.words}, salvaged ${JSON.stringify(rec.check?.salvaged?.parts ?? null)}, sections ${JSON.stringify(rec.sections?.map((s: any) => `${s.kind}/${s.source}`))}; ledger ${ledger.calls} calls, USD ${ledger.usd}`);
}
fs.mkdirSync(OUT, { recursive: true });
