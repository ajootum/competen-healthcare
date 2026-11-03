/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-AI-COST-CONFIG-01 -- the focused evidence runs for the owner's cost decisions. STAGING ONLY.
 *
 *   npx tsx scripts/ai-cost-eval.ts --out docs/evidence/SCHOLAR-INDEPENDENT/p3-eval-<date>.json      calls the models
 *   npx tsx scripts/ai-cost-eval.ts --record docs/evidence/SCHOLAR-INDEPENDENT/p3-eval-<date>.json   records an evaluation run (419)
 *
 * 1. MAP: the production mapping generator (runAnalysis: prompt, shortlist, checks, identifier screen) over the REAL sections of
 *    three staging materials with the catalogue of the nursing programme, once on the current model (Sonnet) and once on Haiku,
 *    with the model pinned through the gateway. Compared per section: the competencies each proposes, agreement, abstention,
 *    confidence, rationale and identifier drops, outcome naming. Nothing is saved to the learner's mappings.
 * 2. FLASHCARDS: the production card generator (runQuestions kind flashcard, with its checks) on six real sections, on Haiku,
 *    Sonnet and Opus: kept / dropped and why, tokens, cost.
 * 3. QUESTIONS (mcq): the same six sections on Sonnet and Opus, with the blind verification pinned to the same model.
 * The rubric screens; a clinician decides. It never writes ai_model_eligibility: --record writes an evaluation run with its
 * results and proposals, exactly as run-activity-evaluation.ts does, so an eligibility row can cite it.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
if (!/ezhvpgtcqcdsgylrxgdb/.test(url) || !key) { console.error("REFUSING: STAGING_SUPABASE_URL is not the staging project."); process.exit(1); }
process.env.NEXT_PUBLIC_SUPABASE_URL = url; process.env.SUPABASE_SERVICE_ROLE_KEY = key; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.STAGING_ANON_KEY ?? "";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const MODELS = { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-4-6", opus: "claude-opus-4-8" } as const;
const MATERIALS = [
  { id: "5327bda5-add2-4dfd-86c3-b9bec6eca907", title: "Essential Nursing Care of the Critically Ill (PPTX, 75 slides)" },
  { id: "404b9a70-143d-4384-b3e6-11b50c53a1ed", title: "Quality Improvement Science and Methods (PPTX, 49 slides)" },
  { id: "8e842731-6563-49c3-a5b7-9bf076ade5d8", title: "recognising-deterioration-notes (1 section)" },
];
const BED_BATH = ["c862bd96-994a-4a8c-b0ba-92d310879e22", "00af06f8-b910-4ad9-9b22-b5ac8ce1eb76", "c80eeb21-2d98-4a71-848d-a205b6cadf7c", "deb6e4bb-674f-424f-951b-4f5de07544cb", "965d7f9b-67ec-459a-9261-b9c37579b996", "2a9671fe-8ba3-4d5f-942a-41f9d12d3150"];
const PROGRAMME = "nursing-ug-diploma";
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const admin: any = createClient(url, key, { auth: { persistSession: false } });

async function run(out: string) {
  const { generate } = await import("../src/lib/ai/client");
  const { estimateCost } = await import("../src/lib/ai/gateway");
  const { runAnalysis, runQuestions, runRevisionQuestions } = await import("../src/lib/individual/scholar/generation");
  const { SUBJECTS_PER_CALL } = await import("../src/lib/competency/mapping");
  const { scholarCatalogue } = await import("../src/lib/individual/scholar/catalogue");
  const { loadProgramme, listChunks, getPassage } = await import("../src/lib/individual/scholar/store");
  const { data: owner } = await admin.from("individual_scholar_material").select("user_id").eq("id", MATERIALS[0].id).single();
  const userId: string = owner.user_id;
  const programme = await loadProgramme(admin, PROGRAMME);
  if (!programme.ok || !programme.data) throw new Error("programme not found");
  const cat = await scholarCatalogue(admin).forProgramme(programme.data);
  if (!cat.ok || !cat.data.length) throw new Error("no catalogue for the programme on staging");
  console.log(`catalogue: ${cat.data.length} competencies for ${PROGRAMME}`);
  const usage: { task: string; model: string; input: number; output: number; cost: number }[] = [];
  const pinned = (model: string, task: string) => async (g: any) => {
    const r = await generate({ ...g, route: { provider: "anthropic", model }, context: { ...(g.context ?? {}), operation: `eval_${task}` } });
    if (!r.ok) console.error(`generate failed (${task}, ${model}): ${JSON.stringify(r).slice(0, 200)} | keys ${Object.keys(g).join(",")} | system ${typeof g.system} ${String(g.system ?? "").length} | user ${String(g.user ?? "").length} | tier ${g.tier} | cacheSystem ${g.cacheSystem}`);
    const u = (r as any).usage ?? null;
    usage.push({ task, model, input: u?.input ?? 0, output: u?.output ?? 0, cost: estimateCost(model, u?.input ?? 0, u?.output ?? 0) ?? 0 });
    return r;
  };
  const rows: any[] = [];
  const cardsOnly = process.argv.includes("--cards-only");
  const prior = cardsOnly ? JSON.parse(readFileSync(out, "utf8")) : null;
  // 1. MAP
  const map: any[] = prior ? prior.map : [];
  if (prior) usage.push(...prior.usage.filter((u: any) => u.task === "map"));
  for (const m of prior ? [] : MATERIALS) {
    const chunks = await listChunks(admin, userId, m.id);
    if (!chunks.ok) throw new Error(`chunks of ${m.id}`);
    const subjects = chunks.data.map(c => ({ ref: c.id, text: c.content }));
    for (let b = 0; b < subjects.length; b += SUBJECTS_PER_CALL) {
      const batch = subjects.slice(b, b + SUBJECTS_PER_CALL);
      const per: Record<string, any> = {};
      for (const [name, model] of [["sonnet", MODELS.sonnet], ["haiku", MODELS.haiku]] as const) {
        const before = usage.length;
        const r = await runAnalysis(userId, batch, cat.data as any, pinned(model, "map"));
        const spent = usage.slice(before);
        per[name] = r.ok ? { ok: true, shown: r.shown, subjects: r.check.subjects, dropped: r.check.dropped, cost: spent.reduce((n, u) => n + u.cost, 0), input: spent.reduce((n, u) => n + u.input, 0), output: spent.reduce((n, u) => n + u.output, 0) }
          : { ok: false, error: r.error, cost: spent.reduce((n, u) => n + u.cost, 0) };
      }
      map.push({ material: m.title, batch: b / SUBJECTS_PER_CALL + 1, sections: batch.map(s => s.ref), sonnet: per.sonnet, haiku: per.haiku });
      process.stdout.write(`map ${m.title.slice(0, 20)} batch ${b / SUBJECTS_PER_CALL + 1}: sonnet ${per.sonnet.ok ? per.sonnet.subjects.length : "x"} haiku ${per.haiku.ok ? per.haiku.subjects.length : "x"}\n`);
    }
  }
  // 2 + 3. FLASHCARDS and MCQ on the bed-bath sections
  const cards: any[] = [];
  for (const id of BED_BATH) {
    const passage = await getPassage(admin, userId, id);
    if (!passage) continue;
    for (const [kind, models] of (cardsOnly ? [["flashcard", ["haiku", "sonnet", "opus"]]] : [["flashcard", ["haiku", "sonnet", "opus"]], ["mcq", ["sonnet", "opus"]]]) as any) {
      for (const name of models as ("haiku" | "sonnet" | "opus")[]) {
        const before = usage.length;
        // The production generators: cards are written by runRevisionQuestions (the revision session route), mcq by runQuestions (the questions route).
        const r: any = kind === "flashcard"
          ? await runRevisionQuestions(userId, "flashcard", passage, 3, pinned(MODELS[name], kind), { verifyFormats: ["mcq", "case", "mrq", "short"] })
          : await runQuestions(userId, kind as any, passage, 3, pinned(MODELS[name], kind), { verifyFormats: ["mcq", "case", "mrq", "short"] });
        const spent = usage.slice(before);
        const kept: any[] = r.ok ? (kind === "flashcard" ? r.kept : r.check.kept) : [];
        const dropped: string[] = r.ok ? (kind === "flashcard" ? r.dropped : r.check.dropped.map((d: any) => d.reason)) : [`error:${r.error}`];
        cards.push({ chunkId: id, kind, model: name, ok: r.ok, kept: kept.length, dropped, calls: spent.length,
          cost: spent.reduce((n, u) => n + u.cost, 0), input: spent.reduce((n, u) => n + u.input, 0), output: spent.reduce((n, u) => n + u.output, 0), sample: kept.slice(0, 2).map((k: any) => ({ stem: k.stem ?? k.front, answer: k.answer ?? k.back ?? k.options })) });
        process.stdout.write(`${kind} ${name} ${id.slice(0, 8)}: kept ${r.ok ? kept.length : "x"}
`);
      }
    }
  }
  rows.push(...cards);
  const allCards = prior ? [...prior.cards.filter((c: any) => c.kind !== "flashcard"), ...cards] : cards;
  if (prior) usage.push(...prior.usage.filter((u: any) => u.task === "mcq"));
  const ev = { evalSetVersion: "SCHOLAR-AI-COST-CONFIG-01-v1", ranAt: prior?.ranAt ?? new Date().toISOString(), cardsRanAt: new Date().toISOString(), programme: PROGRAMME, catalogue: cat.data.length, map, cards: allCards, usage };
  writeFileSync(out, JSON.stringify(ev, null, 1));
  const total = usage.reduce((n, u) => n + u.cost, 0);
  console.log(`Evidence written to ${out}. ${usage.length} calls, USD ${total.toFixed(4)}. Nothing written to the database but the gateway's own request rows.`);
}

/** Pure. Per-section comparison of two models' mapping proposals. */
export function compareMap(map: any[]) {
  const per: any[] = [];
  for (const b of map) {
    if (!b.sonnet.ok || !b.haiku.ok) { per.push({ batch: `${b.material} #${b.batch}`, error: true }); continue; }
    const s = new Map(b.sonnet.subjects.map((x: any) => [x.ref, x])), h = new Map(b.haiku.subjects.map((x: any) => [x.ref, x]));
    for (const ref of b.sections) {
      const a: any = s.get(ref), c: any = h.get(ref);
      const ids = (x: any) => new Set<string>((x?.proposals ?? []).map((p: any) => p.competencyId));
      const A = ids(a), C = ids(c);
      const inter = [...A].filter(x => C.has(x)).length, union = new Set([...A, ...C]).size;
      per.push({ material: b.material, ref, sonnet: [...A].length, haiku: [...C].length, agree: inter, jaccard: union ? inter / union : (A.size === 0 && C.size === 0 ? 1 : 0),
        sonnetConf: avg((a?.proposals ?? []).map((p: any) => p.confidence)), haikuConf: avg((c?.proposals ?? []).map((p: any) => p.confidence)),
        sonnetOutcomes: (a?.proposals ?? []).filter((p: any) => p.outcome).length, haikuOutcomes: (c?.proposals ?? []).filter((p: any) => p.outcome).length });
    }
  }
  const drops = (k: "sonnet" | "haiku") => map.flatMap(b => (b[k]?.dropped ?? []).map((d: any) => d.reason));
  const count = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
  const ok = per.filter(p => !p.error);
  return {
    sections: ok.length,
    bothAbstain: ok.filter(p => p.sonnet === 0 && p.haiku === 0).length, sonnetOnlyAbstain: ok.filter(p => p.sonnet === 0 && p.haiku > 0).length, haikuOnlyAbstain: ok.filter(p => p.haiku === 0 && p.sonnet > 0).length,
    meanJaccard: avg(ok.map(p => p.jaccard)), exactAgreement: ok.filter(p => p.jaccard === 1).length, disagreement: ok.filter(p => p.jaccard === 0 && (p.sonnet > 0 || p.haiku > 0)).length,
    proposals: { sonnet: ok.reduce((n, p) => n + p.sonnet, 0), haiku: ok.reduce((n, p) => n + p.haiku, 0) },
    meanConfidence: { sonnet: avg(ok.map(p => p.sonnetConf).filter((x): x is number => x !== null)), haiku: avg(ok.map(p => p.haikuConf).filter((x): x is number => x !== null)) },
    outcomesNamed: { sonnet: ok.reduce((n, p) => n + p.sonnetOutcomes, 0), haiku: ok.reduce((n, p) => n + p.haikuOutcomes, 0) },
    drops: { sonnet: count(drops("sonnet")), haiku: count(drops("haiku")) },
    cost: { sonnet: map.reduce((n, b) => n + (b.sonnet?.cost ?? 0), 0), haiku: map.reduce((n, b) => n + (b.haiku?.cost ?? 0), 0) },
    tokens: { sonnet: map.reduce((n, b) => n + (b.sonnet?.input ?? 0) + (b.sonnet?.output ?? 0), 0), haiku: map.reduce((n, b) => n + (b.haiku?.input ?? 0) + (b.haiku?.output ?? 0), 0) },
    per,
  };
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function record(file: string) {
  const ev = JSON.parse(readFileSync(file, "utf8"));
  const cmp = compareMap(ev.map);
  const cardsBy = (kind: string, model: string) => ev.cards.filter((c: any) => c.kind === kind && c.model === model);
  const sum = (xs: any[], k: string) => xs.reduce((n, x) => n + (x[k] ?? 0), 0);
  const { data: runRow, error } = await admin.from("ai_model_evaluation_run").insert({ eval_set_version: ev.evalSetVersion, label: `SCHOLAR-AI-COST-CONFIG-01 map / flashcards / mcq ${ev.ranAt.slice(0, 10)}`,
    note: `map: production runAnalysis over ${cmp.sections} real sections of three staging materials, Sonnet vs Haiku, catalogue ${ev.programme} (${ev.catalogue}); flashcards: runQuestions on six bed-bath sections, Haiku / Sonnet / Opus; mcq: Sonnet / Opus with the blind verification pinned. Evidence file ${file}. The rubric screens; a clinician decides.` }).select("id").single();
  if (error) throw new Error(error.message);
  const results: any[] = [];
  for (const name of ["sonnet", "haiku"]) {
    const n = name as "sonnet" | "haiku";
    results.push({ run_id: runRow.id, item_code: `map.${name}`, task: "map", risk_tier: "clinical_educational", provider: "anthropic", model_requested: name === "sonnet" ? MODELS.sonnet : MODELS.haiku, model_returned: null,
      input_tokens: cmp.tokens[n], output_tokens: 0, cost_usd: cmp.cost[n], price_id: null, latency_ms: null, status: "ok", output: null,
      rubric: { sections: cmp.sections, proposals: cmp.proposals[n], meanConfidence: cmp.meanConfidence[n], outcomesNamed: cmp.outcomesNamed[n], drops: cmp.drops[n], agreementWithSonnet: name === "haiku" ? { meanJaccard: cmp.meanJaccard, exact: cmp.exactAgreement, disagreement: cmp.disagreement, haikuOnlyAbstain: cmp.haikuOnlyAbstain, sonnetOnlyAbstain: cmp.sonnetOnlyAbstain } : null },
      score: name === "haiku" ? Number((cmp.meanJaccard ?? 0).toFixed(2)) : 1, passed: name === "sonnet" ? true : (cmp.meanJaccard ?? 0) >= 0.6 && (cmp.drops.haiku.unknown_competency ?? 0) === 0 && (cmp.drops.haiku.identifier ?? 0) === 0 });
  }
  for (const [kind, models] of [["flashcard", ["haiku", "sonnet", "opus"]], ["mcq", ["sonnet", "opus"]]] as const) for (const name of models) {
    const xs = cardsBy(kind, name);
    const dropped = xs.flatMap((x: any) => x.dropped);
    results.push({ run_id: runRow.id, item_code: `${kind}.${name}`, task: kind === "flashcard" ? "flashcards" : "questions", risk_tier: "clinical_educational", provider: "anthropic", model_requested: MODELS[name], model_returned: null,
      input_tokens: sum(xs, "input"), output_tokens: sum(xs, "output"), cost_usd: sum(xs, "cost"), price_id: null, latency_ms: null, status: xs.every((x: any) => x.ok) ? "ok" : "error", output: JSON.stringify(xs.map((x: any) => x.sample)).slice(0, 8000),
      rubric: { sections: xs.length, kept: sum(xs, "kept"), dropped: dropped.length, reasons: dropped.reduce((m: Record<string, number>, r: string) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {}), calls: sum(xs, "calls") },
      score: xs.length ? Number((sum(xs, "kept") / (sum(xs, "kept") + dropped.length || 1)).toFixed(2)) : 0, passed: xs.every((x: any) => x.ok) && sum(xs, "kept") > 0 && !dropped.some((r: string) => r === "identifier") });
  }
  const res = await admin.from("ai_model_evaluation_result").insert(results);
  if (res.error) throw new Error(res.error.message);
  const haikuMap = results.find(r => r.item_code === "map.haiku");
  const proposals = [
    { run_id: runRow.id, product: "scholar", activity: "map", provider: "anthropic", model_prefix: MODELS.haiku, proposed_max_risk_tier: haikuMap.passed ? "clinical_educational" : null, rationale: `Haiku vs Sonnet on ${cmp.sections} real sections: mean Jaccard ${(cmp.meanJaccard ?? 0).toFixed(2)}, exact ${cmp.exactAgreement}, disagreement ${cmp.disagreement}; drops ${JSON.stringify(cmp.drops.haiku)}. ${haikuMap.passed ? "Proposed for clinical educational; a clinician decides." : "NOT proposed: below the agreement threshold or an identifier/unknown-competency drop."}` },
    ...(["haiku", "sonnet"] as const).map(name => { const r = results.find(x => x.item_code === `flashcard.${name}`); return { run_id: runRow.id, product: "scholar", activity: "flashcards", provider: "anthropic", model_prefix: MODELS[name], proposed_max_risk_tier: r.passed ? "clinical_educational" : null, rationale: `Flashcards on six bed-bath sections: kept ${r.rubric.kept}, dropped ${r.rubric.dropped} ${JSON.stringify(r.rubric.reasons)}, USD ${Number(r.cost_usd).toFixed(4)}. ${r.passed ? "Proposed; a clinician decides." : "NOT proposed."}` }; }),
    (() => { const r = results.find(x => x.item_code === "mcq.sonnet"); return { run_id: runRow.id, product: "scholar", activity: "questions", provider: "anthropic", model_prefix: MODELS.sonnet, proposed_max_risk_tier: r.passed ? "clinical_educational" : null, rationale: `mcq on six bed-bath sections with the blind check on Sonnet: kept ${r.rubric.kept}, dropped ${r.rubric.dropped} ${JSON.stringify(r.rubric.reasons)}. Read with the D5-v2 safety rubric result (run 6c2c8067: Sonnet 1/3, two safety failures); this run alone is not safety evidence.` }; })(),
  ];
  const pr = await admin.from("ai_model_evaluation_proposal").insert(proposals);
  if (pr.error) throw new Error(pr.error.message);
  console.log(`Recorded run ${runRow.id}: ${results.length} results, ${proposals.length} proposals. No eligibility written.`);
  console.log(JSON.stringify({ map: { ...cmp, per: undefined }, cards: results.filter(r => r.task !== "map").map(r => ({ item: r.item_code, kept: r.rubric.kept, dropped: r.rubric.dropped, reasons: r.rubric.reasons, cost: r.cost_usd, passed: r.passed })) }, null, 1));
}

const out = arg("out"), rec = arg("record");
(out ? run(out) : rec ? record(rec) : Promise.reject(new Error("Pass --out <file> or --record <file>."))).catch(e => { console.error(e.message ?? e); process.exit(1); });
