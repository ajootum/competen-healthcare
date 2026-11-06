// SCHOLAR-GUIDE-ME-001: THE COUNTED STAGING TEST. Real code, the real metered runner, the fixture learner's Growth and Development lesson. Nothing is saved: TAUGHT SO FAR is built in memory.
// Own ledger and caps. Staging only. Keys are read here and never printed.
// Usage: npx tsx docs/evidence/SCHOLAR-GUIDE-ME-001/guide-gen.mts <run...>   run = old | teach0 | teach1 | hint1 | hint2 | example | explain | right | wrong | partial
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const REPO = "C:/Users/elish/Documents/Competen/competen-guideme";
const SP = "C:/Users/elish/AppData/Local/Temp/claude/e7cc951866a58dfc/0feb3955-b31d-49b3-9950-3adb8bb92e86/scratchpad";
const FIXTURE = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/guided-fixture.txt";
const CAP_CALLS = 20, CAP_USD = 1.5;
const ledgerFile = `${SP}/guide-ledger.json`, resultsFile = `${SP}/guide-results.json`;
const ledger: { calls: number; usd: number; runs: unknown[] } = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, "utf8")) : { calls: 0, usd: 0, runs: [] };
const results: Record<string, any> = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : {};
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
const ctxMod = await imp("/src/lib/individual/scholar/learn-context.ts");
const learn = await imp("/src/lib/individual/scholar/learn.ts");
const tutor = await imp("/src/lib/individual/scholar/competency-view.ts");
const G = await imp("/src/lib/individual/scholar/guide-me.ts");
const T = await imp("/src/lib/individual/scholar/learn-teaching.ts");
const deeper = await imp("/src/lib/individual/scholar/deeper-format.ts");
const check = await imp("/src/lib/individual/scholar/learn-check.ts");

const SESSION = "3484e65a-ee9c-425a-9b63-b2cca40c898e", STEP = 2; // Lesson 3 of the deck: motor development, reflexes, head control through to walking.
const sess = await store.getLearningSession(admin, userId, SESSION);
const here = sess.data.steps.find((x: { step: number }) => x.step === STEP);
const stepIds: string[] = here.sections.map((x: { chunkId: string }) => x.chunkId);
const passages = (await Promise.all(stepIds.map((id: string) => store.getPassage(admin, userId, id)))).filter(Boolean);
if (!sas.activityState(await sas.getScholarAiStanding(admin, userId), "explain").available) { console.log("STOP: explain not available"); process.exit(2); }
const ctx = { admin, userId, profile: { fullName: null }, live: ["scholar"] } as never;
const topics = await store.topicsOfSections(admin, userId, passages.map((p: { chunkId: string }) => p.chunkId));
const lesson = learn.lessonOutline({ step: STEP, sections: passages.map((p: any) => ({ chunkId: p.chunkId, materialId: p.materialId, ordinal: p.ordinal, pageFrom: p.pageFrom, pageTo: p.pageTo, materialTitle: p.materialTitle, unit: p.unit ?? "page" })) }, topics, new Map(passages.map((p: any) => [p.chunkId, learn.sectionProfile(p.content)])));
const headings = [...new Set(passages.map((p: any) => learn.sectionProfile(p.content).heading).filter(Boolean))] as string[];
const lessonBrief = { title: lesson.title, objective: lesson.objective, sections: headings };
const of = G.guideStepCount(headings.length);
const learnerContext = await tutor.loadTutorContext(admin, userId, passages.map((p: any) => p.chunkId)).catch(() => null);
const saved = await store.listArtefacts(admin, userId, { chunkIds: stepIds, limit: 40 });
const teachRow = saved.data.filter((a: any) => a.action === "teach")[0];
console.log(`lesson "${lesson.title}", ${passages.length} sections, ${headings.length} headings, ${of} steps; saved Teach me ${teachRow ? "found" : "NOT found"}`);
const q0 = () => deeper.parseDeeperAnswer(results.teach0?.saved ?? "")?.questions?.[0]?.text ?? "Why does head control come before walking?";
const ANSWERS: Record<string, string> = {
  right: "",
  partial: "It shows the baby can sense something, but I am not sure what it means.",
  wrong: "It does not really tell you anything. Babies just do these things at random from birth, so there is nothing to reason about and it does not depend on how their nervous system is developing.",
};
const groundOf = (s: number) => G.guideGround(headings, s, of);
for (const name of process.argv.slice(2)) {
  if (ledger.calls + 1 > CAP_CALLS || ledger.usd >= CAP_USD) { console.log(`CAP reached: ${ledger.calls} calls, USD ${ledger.usd}`); break; }
  const earlier = [...(teachRow ? [{ action: "teach", content: teachRow.content, createdAt: teachRow.createdAt }] : []), ...(name !== "teach0" && results.teach0?.saved ? [{ action: "explain", content: results.teach0.saved, createdAt: "2026-11-06T12:00:00Z" }] : [])];
  const taught = ctxMod.taughtSoFarBlock(ctxMod.buildTaughtSoFar(earlier, [], { objective: lesson.objective, focus: lesson.focus }));
  // A model answer for "right": the key points the judge itself gave on the wrong answer, in plain sentences.
  if (name === "right") ANSWERS.right = (results.wrong?.feedback?.keyPoints ?? []).join(" ").replace(/\s*\[[SRE]\d+\]/g, "") || "A model answer could not be read.";
  let args: any, activity = "deeper", prompt = "";
  if (name === "old") { const tr = { action: "guide", hintLevel: 1, attempt: "", question: "" }; prompt = T.teachingPrompt(tr, null); activity = "explain"; args = { action: "guide", question: prompt, teaching: { hintLevel: 1, examEvidence: null } }; }
  else if (name in ANSWERS) { prompt = `Your check question was: ${G.questionPlain?.(q0()) ?? q0().replace(/\s*\[S\d+\]/g, "")}\nMy answer: ${ANSWERS[name]}`; activity = "clarify"; args = { action: "clarify", question: prompt, guidedClarify: true }; }
  else {
    const turn = name.startsWith("teach") ? "teach" : name.startsWith("hint") ? "hint" : name;
    const step = name === "teach1" ? 1 : 0, level = name === "hint2" ? 2 : 1;
    const ask = { turn, step, level, question: turn === "teach" ? "" : q0().replace(/\s*\[S\d+\]/g, "") };
    prompt = G.guidePrompt(ask);
    args = { action: "explain", question: prompt, guide: { turn, step, of, ground: groundOf(step), level } };
  }
  const risk = await http.scholarRisk(admin, userId, { text: prompt, passages, purpose: "education" });
  Object.assign(risk, { intentContext: { surface: "learn", lessonTitle: lesson.title, objective: lesson.objective, materialTopics: [] } });
  const ai = http.scholarAiRunner(ctx, new Request("http://guide-test.local/"), activity, risk, `guide${Date.now()}`);
  let used = 0, rawText: string | null = null;
  const run = async (g: unknown, part: unknown) => { used++; const res = await ai.run(g, part); rawText = (res as { text?: string }).text ?? null; return res; };
  const started = Date.now();
  const r = await gen.runLearn(userId, { passages, references: [], depth: "standard", background: true, history: [], learnerContext, research: [], taught, lesson: lessonBrief, learnerTexts: name in ANSWERS ? [ANSWERS[name]] : [], ...args }, run);
  const ms = Date.now() - started;
  ledger.calls += used;
  let rows: any[] | null = null;
  for (let i = 0; i < 8 && !rows?.length; i++) { await new Promise(res => setTimeout(res, 1500)); ({ data: rows } = await admin.from("plat_ai_requests").select("model, input_tokens, output_tokens, cost_usd").eq("action_id", ai.actionId)); }
  const cost = (rows ?? []).reduce((n: number, x: any) => n + Number(x.cost_usd ?? 0), 0);
  ledger.usd = Number((ledger.usd + cost).toFixed(5));
  const text = r.ok && r.check.ok ? r.check.text : null;
  results[name] = { name, calls: used, ms, usage: rows ?? [], cost_usd: cost, ok: r.ok, error: r.ok ? null : r.error, verdict: r.ok ? r.verdict : null, promptVersion: r.ok ? r.promptVersion : null, model: r.ok ? r.model : null,
    check: r.ok ? { ok: r.check.ok, reason: r.check.ok ? null : r.check.reason, violations: r.check.ok ? null : r.check.violations ?? null, salvaged: r.check.ok ? r.check.salvaged ?? null : null } : null, saved: text, raw: rawText, words: text ? text.split(/\s+/).length : 0, feedback: name in ANSWERS && text ? check.parseCheckFeedback(text) : null };
  (ledger.runs as unknown[]).push({ name, calls: used, cost_usd: cost, ok: r.ok && r.check.ok });
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 1));
  console.log(`${name}: calls ${used}, ${ms} ms, USD ${cost.toFixed(4)}, tokens ${JSON.stringify((rows ?? []).map((x: any) => [x.model, x.input_tokens, x.output_tokens]))}, ok ${r.ok && r.check.ok} ${r.ok && !r.check.ok ? r.check.reason : ""} verdict ${r.ok ? r.verdict : ""} words ${results[name].words} salvaged ${JSON.stringify(r.ok && r.check.ok ? r.check.salvaged?.parts ?? null : null)}; ledger ${ledger.calls} calls, USD ${ledger.usd}`);
}
