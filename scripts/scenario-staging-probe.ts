/**
 * SCHOLAR-CE-2026 CE-05: STAGING-ONLY probe of scenario generation against the LIVE model.
 *
 * WHY. The scenario draft checks were written against canned replies. This runs the REAL path: the learner's real section, the real prompt
 * (generation.ts runRevisionQuestions, kind "scenario"), the real model routing and metering (scholarAiRunner -> runMeteredAi), and the real
 * draft check (revision.ts checkRevisionDraft). For every draft it prints the raw model JSON (truncated), the parsed stages, and the exact
 * verdict: the rule that refused it and the text that tripped it. Nothing is stored: the probe writes no question and records no attempt.
 *
 *   npx tsx scripts/scenario-staging-probe.ts --email learner@example.test --chunk <section id> [--n 3] [--env <dir holding .env.local>]
 *   npx tsx scripts/scenario-staging-probe.ts --email learner@example.test --material-like "Quality Improvement" [--n 2]
 *
 * ⚠ STAGING ONLY. The STAGING_* variables of .env.local are mapped onto the names the app reads (as dev-staging.mjs does), and the target is
 *   judged by the one production predicate (production-guard.ts judgeTarget): production, or a target that cannot be identified, is REFUSED
 *   before anything is read or any model is called. The service key must be the STAGING_ one; the production names are never used.
 * ⚠ READ-ONLY on the database, except what a metered AI call records as it always does (the allowance of the learner it runs as).
 * ⚠ NEVER PRINTS A SECRET: it prints the staging project ref (public), counts, and the learner's section text only.
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { judgeTarget } from "./production-guard";

const arg = (name: string, d?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const N = Math.max(1, Math.min(6, Number(arg("n", "3")) || 3));
const email = arg("email");
const chunkId = arg("chunk");
const materialLike = arg("material-like");
const envDir = resolve(arg("env", join(process.cwd(), "..", "competen-p2")) as string);

function refuse(msg: string): never { console.error(`\n⛔ ${msg}\n`); process.exit(1); }

async function main() {
  if (!email || (!chunkId && !materialLike)) refuse("usage: --email <learner> (--chunk <section id> | --material-like <title fragment>) [--n 3] [--env <dir>]");
  if (!existsSync(join(envDir, ".env.local"))) refuse(`no .env.local in ${envDir} (pass --env <dir>)`);
  createRequire(import.meta.url)("@next/env").loadEnvConfig(envDir);

  // ── the target: STAGING_* only, judged by the one production predicate, before anything else happens ──
  const url = process.env.STAGING_SUPABASE_URL, service = process.env.STAGING_SERVICE_ROLE_KEY, anon = process.env.STAGING_ANON_KEY;
  if (!url || !service) refuse("STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY are required (this probe never uses the production names).");
  const verdict = judgeTarget(url);
  if (!verdict.ok) refuse(`the target is ${verdict.reason}${verdict.ref ? ` (${verdict.ref})` : ""}: this probe runs against staging only.`);
  process.env.NEXT_PUBLIC_SUPABASE_URL = url; // the production names are OVERWRITTEN, never merged
  process.env.SUPABASE_SERVICE_ROLE_KEY = service;
  if (anon) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
  console.log(`STAGING ${verdict.ref} (production is not used by this process)\n`);

  // The app modules read the environment when they load: import them only now that it is staging's.
  const { createClient } = await import("@supabase/supabase-js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createClient(url, service, { auth: { persistSession: false } });
  const store = await import("../src/lib/individual/scholar/store");
  const gen = await import("../src/lib/individual/scholar/generation");
  const http = await import("../src/lib/individual/scholar/http");
  const rev = await import("../src/lib/individual/scholar/revision");
  const scn = await import("../src/lib/individual/scholar/scenario");
  const quality = await import("../src/lib/individual/scholar/question-quality");
  const ctxMod = await import("../src/lib/individual/scholar/question-context");
  const intel = await import("../src/lib/individual/scholar/question-intel");
  const suff = await import("../src/lib/individual/scholar/sufficiency");
  const pol = await import("../src/lib/individual/policy");
  const parseJsonArray = (await import("../src/lib/ai/grounding")).parseJsonArray;

  // ── the learner (read-only) ──
  let userId: string | null = null;
  for (let page = 1; page <= 5 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) refuse(`the learner could not be looked up: ${error.message}`);
    userId = data.users.find((u: { email?: string }) => u.email?.toLowerCase() === email!.toLowerCase())?.id ?? null;
    if (!data.users.length) break;
  }
  if (!userId) refuse("no such learner on staging");

  // ── the section(s) ──
  const sections: { chunkId: string; label: string }[] = [];
  if (chunkId) sections.push({ chunkId, label: chunkId });
  else {
    const mats = await store.listMaterials(admin, userId!);
    if (!mats.ok) refuse("the learner's materials could not be read");
    const found = mats.data.filter(m => m.title.toLowerCase().includes(materialLike!.toLowerCase()));
    console.log(`materials matching "${materialLike}": ${found.map(m => `${m.title} (${m.chunkCount} sections)`).join("; ") || "none"}`);
    for (const m of found.slice(0, 1)) {
      const cs = await store.listChunks(admin, userId!, m.id);
      if (!cs.ok) continue;
      // The section with the most words that talks about a patient or an action is the fairest test of "genuinely clinical"; fall back to the longest.
      const scored = cs.data.map(c => ({ c, r: suff.caseReadiness([c.content], "case_blueprint") })).sort((a, b) => b.c.content.length - a.c.content.length);
      for (const x of scored.slice(0, 2)) sections.push({ chunkId: x.c.id, label: `${m.title} #${x.c.ordinal}` });
    }
  }
  if (!sections.length) refuse("no section to probe");

  const policy = await pol.loadIndividualPolicy(admin);
  const loader = await ctxMod.generationContextLoader(admin, userId!, policy);
  const ctx = { admin, userId, profile: { fullName: null }, live: ["scholar"] } as never;
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} ...[truncated ${s.length - n}]` : s);
  const summary: { section: string; sufficiency: string; kept: number; of: number; reasons: string[] }[] = [];

  for (const sec of sections) {
    const passage = await store.getPassage(admin, userId!, sec.chunkId);
    if (!passage) { console.log(`\n=== ${sec.label}: section not found for this learner`); continue; }
    const ready = suff.caseReadiness([passage.content], "case_blueprint");
    console.log(`\n================ SECTION ${sec.label} (${passage.content.length} characters)`);
    console.log(`source sufficiency (the existing check): ${ready.outcome}; covered ${ready.covered.join(",") || "none"}; missing ${ready.missing.join(",") || "none"}`);
    console.log(`--- section text (truncated) ---\n${cut(passage.content, 1500)}\n`);
    if (ready.outcome === "insufficient" || ready.outcome === "simpler") {
      console.log(`=> the sessions route SKIPS the scenario here with no AI call: "${scn.SCENARIO_INSUFFICIENT_NOTE}"`);
      summary.push({ section: sec.label, sufficiency: ready.outcome, kept: 0, of: 0, reasons: ["skipped_before_ai"] });
      continue;
    }
    let kept = 0; const reasons: string[] = [];
    for (let i = 1; i <= N; i++) {
      const risk = await http.scholarRisk(admin, userId!, { passages: [passage] });
      const ai = http.scholarAiRunner(ctx, new Request("http://probe.local/"), "questions", risk, `probe${Date.now()}x${i}`);
      const raws: string[] = [];
      const run: typeof ai.run = async (g, part) => { const r = await ai.run(g, part); if ((r as { ok: boolean }).ok) raws.push((r as unknown as { text: string }).text); return r; };
      const context = await loader.forSection(passage.chunkId, { difficulty: intel.generationDifficulty(policy.scholarRevisionDifficulty), mode: "notes" });
      console.log(`\n---------- draft ${i} of ${N} (level in the prompt: ${context.level ?? "none, neutral pre-registration scope"})`);
      const t0 = Date.now();
      const r = await gen.runRevisionQuestions(userId!, "scenario", passage, 1, run, { context, existing: new Set(), verifyFormats: policy.scholarVerifyFormats });
      const refusal = ai.refusal();
      console.log(`model calls: ${Object.entries(ai.calls()).map(([k, v]) => `${k}=${v}`).join(" ")}; ${Math.round((Date.now() - t0) / 1000)}s`);
      if (refusal) { console.log(`METERED REFUSAL: ${JSON.stringify(refusal).slice(0, 300)}`); reasons.push("metered_refusal"); continue; }
      if (!r.ok) { console.log(`GENERATION ERROR: ${r.error}`); reasons.push("error"); continue; }
      // Every raw model reply, and for each item in it the verdict of the SAME check the route runs, with the offending text.
      raws.forEach((raw, k) => {
        let jsonNote = "valid JSON";
        try { JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)); } catch (e) { jsonNote = `NOT valid JSON: ${(e as Error).message}`; }
        console.log(`\n[raw reply ${k + 1}] (${raw.length} characters; ${jsonNote})\n${raw.length > 3600 ? `${raw.slice(0, 3000)} ...[middle omitted]... ${raw.slice(-500)}` : raw}`);
        const items = parseJsonArray(raw) ?? [];
        if (!items.length) console.log("=> the reply holds no item (an empty array [] is the model declining, or the reply was not a JSON array)");
        items.forEach((item, j) => {
          const verdictNow = rev.checkRevisionDraft("scenario", item, passage, { difficulty: context.difficulty, references: context.references });
          const parsed = scn.parseScenario((item ?? {}) as Record<string, unknown>);
          console.log(`\n[item ${k + 1}.${j + 1}] VERDICT: ${verdictNow.ok ? "KEPT" : `REFUSED, rule ${verdictNow.reason}`}`);
          if (parsed.sc) {
            const shaped = scn.shapeScenario(parsed.sc, passage.content, new Map());
            console.log(`  stages the parser left out (a fault in a later stage): ${parsed.skipped.join(", ") || "none"}; stages the shaping left out: ${"reason" in shaped ? `draft refused (${shaped.reason})` : shaped.pruned.join("; ") || "none"}`);
            console.log(`  opening: ${parsed.sc.situation}`);
            parsed.sc.stages.forEach((s, n) => console.log(`  stage ${n + 1} [${s.kind} x${s.weight}] reveal: ${s.reveal || "(none)"} | prompt: ${s.prompt} | ${s.options.length ? `options: ${s.options.join(" / ")} | correct: ${s.correct.map(c => s.options[c]).join("; ")}` : `accepted: ${s.accepted.join("; ")}`} | key point: ${s.keyPoint} | source: ${s.source || "(none)"}${s.refs.length ? ` | refs ${s.refs.join(",")}` : ""}`));
          } else {
            console.log(`  not parsed: ${parsed.why}${parsed.detail ? ` (${parsed.detail})` : ""}. Stages as the model wrote them:`);
            const st = (item as { stages?: unknown[] })?.stages;
            (Array.isArray(st) ? st : []).forEach((s, n) => console.log(`   stage ${n + 1}: keys [${Object.keys((s ?? {}) as object).join(",")}] ${cut(JSON.stringify(s), 600)}`));
            if (!Array.isArray(st)) console.log(`   (no stages array; item keys [${Object.keys((item ?? {}) as object).join(",")}])`);
          }
          if (!verdictNow.ok && parsed.sc) {
            // The offending text, from the same pieces the check uses.
            const sc = parsed.sc;
            if (verdictNow.reason === "uncited_stage") sc.stages.forEach((s, n) => {
              const inPassage = !!s.source && passage.content.toLowerCase().replace(/[^a-z0-9]+/g, " ").includes(s.source.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
              console.log(`  stage ${n + 1}: source ${s.source ? (inPassage ? "found in the section" : "NOT found verbatim in the section") : "MISSING"}; answer/key point terms not in its source: ${JSON.stringify(quality.unsupportedTerms([...scn.stageAnswers(s), s.keyPoint].join(" "), s.source))}`);
            });
            if (verdictNow.reason === "ungrounded_reveal") {
              let known = `${sc.situation} ${passage.content}`;
              sc.stages.forEach((s, n) => { if (s.reveal) console.log(`  stage ${n + 1} reveal clinical terms the section does not hold: ${JSON.stringify(scn.clinicalGaps(s.reveal, known))}`); known = `${known} ${s.reveal}`; });
            }
            if (verdictNow.reason === "ungrounded_opening") console.log(`  opening terms not in the section: ${JSON.stringify(quality.unsupportedTerms(sc.situation, passage.content))}`);
            if (verdictNow.reason === "answer_leaked" || verdictNow.reason === "repeated_stage" || verdictNow.reason === "not_a_scenario")
              console.log(`  scenarioFlaw: ${scn.scenarioFlaw(sc)}`);
          }
          if (verdictNow.ok) kept++; else reasons.push(verdictNow.reason);
        });
      });
      console.log(`\nrunRevisionQuestions result: kept ${r.kept.length}, dropped ${JSON.stringify(r.dropped)}`);
      if (r.kept.length) {
        const d = r.kept[0], answer = d.answer as { stages: { reveal: string; prompt: string; kind: string; options?: string[]; correct?: number[]; accepted?: string[]; weight: number; keyPoint: string; source: string }[] };
        console.log(`\n=========== A KEPT SCENARIO IN FULL ===========\nOPENING: ${d.stem}`);
        answer.stages.forEach((s, n) => {
          console.log(`\nSTAGE ${n + 1} (${s.kind}, ${s.weight} mark${s.weight === 1 ? "" : "s"})\n  new information: ${s.reveal || "(none: the opening)"}\n  question: ${s.prompt}`);
          if (s.options?.length) console.log(`  options: ${s.options.map((o, c) => `${"ABCDEF"[c]}. ${o}`).join(" | ")}\n  correct: ${(s.correct ?? []).map(c => "ABCDEF"[c]).join(",")}`);
          else console.log(`  accepted answers: ${(s.accepted ?? []).join("; ")}`);
          console.log(`  key point: ${s.keyPoint}\n  source sentence: "${s.source}"`);
        });
        console.log(`\nrationale: ${d.rationale}\nitem source quote: "${d.sourceQuote}"\n===============================================`);
      }
    }
    summary.push({ section: sec.label, sufficiency: ready.outcome, kept, of: N, reasons });
  }
  console.log("\n================ SUMMARY");
  for (const s of summary) console.log(`${s.section}: sufficiency ${s.sufficiency}; kept ${s.kept} of ${s.of}; verdicts/reasons: ${s.reasons.join(", ") || "-"}`);
}

main().catch(e => { console.error(`probe failed: ${(e as Error).message}`); process.exit(1); });
