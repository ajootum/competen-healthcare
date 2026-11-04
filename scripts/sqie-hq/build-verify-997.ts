// Builds docs/evidence/SQIE-HQ/VERIFY-997.sql from the REAL application validator (library-format.ts validateLibraryQuestion)
// and copy builder (libraryCopyOf), so the database check is tested against exactly what HQ saves and Scholar copies.
//   npx tsx scripts/sqie-hq/build-verify-997.ts
// Pure: reads nothing, writes the one SQL file. SQIE-CLOSE-2026-11 WS-E (migration 997).
import { writeFileSync } from "node:fs";
import { libraryCopyOf, validateLibraryQuestion } from "@/lib/individual/scholar/library-format";
import { questionContentFromFields } from "@/lib/knowledge/question-format";

const ok = (label: string, raw: Record<string, unknown>) => {
  const v = validateLibraryQuestion(raw);
  if (!v.ok) throw new Error(`${label}: ${v.error}`);
  return { label, content: v.content };
};
const base = { stem: "A patient weighs 70 kg. Calculate the dose of 1.5 mg/kg.", rationale: "70 kg x 1.5 mg/kg = 105 mg.", options: [] };

const samples = [
  ok("calculation, exact", { ...base, format: "calculation", answerKey: { value: 105, unit: "mg" }, marking: "deterministic" }),
  ok("calculation, every field", questionContentFromFields({
    format: "calculation", stem: "Run 500 mL over 4 hours. Calculate the rate in mL/h to one decimal place.", rationale: "500 / 4 = 125.0 mL/h.",
    calc: { value: "125", unit: "mL/h", equivalentUnits: "", roundingMode: "decimal_places", places: "1", toleranceKind: "percent", toleranceAmount: "5", safetyCritical: true, working: "500 mL / 4 h = 125.0 mL/h", unsafe: "1250 mL/h" },
  })),
  ok("calculation, equivalent units", { ...base, format: "calculation", answerKey: { value: 0.105, unit: "g", equivalentUnits: ["mg"] }, marking: "deterministic" }),
  ok("short with safety markers", { format: "short", stem: "Name the first action for a patient with no pulse.", rationale: "Start chest compressions and call for help.", options: [],
    answerKey: { accepted: ["Start chest compressions"], safetyCritical: true, unsafe: ["Wait and reassess"] }, marking: "deterministic" }),
  ok("extended with safety-critical key points", { format: "extended", stem: "Explain how you would assess a deteriorating adult using ABCDE.", options: [], marking: "rubric_ai_formative",
    rationale: "A structured ABCDE assessment finds and treats the most life-threatening problem first.",
    rubric: { level: "application", keyPoints: ["Airway first", "Breathing and oxygen", "Escalate early"], misconceptions: [] },
    answerKey: { modelAnswer: "Assess airway, breathing, circulation, disability and exposure in turn, treating as you go, and escalate early.", marks: 3, safetyCriticalPoints: [0, 2], unsafe: ["Leave the patient to fetch help"] } }),
  ok("structured: answer and justify", { format: "structured", stem: "A patient has SpO2 86% on room air and is breathless.", rationale: "Hypoxaemia needs oxygen titrated to target.", options: [], marking: "deterministic",
    answerKey: { variant: "answer_justify", parts: [
      { prompt: "What do you do first?", marks: 1, accepted: ["Give oxygen"], role: "answer", options: ["Give oxygen", "Give paracetamol"], correct: 0, safetyCritical: true, unsafe: ["Give paracetamol"] },
      { prompt: "Justify your choice.", marks: 3, accepted: ["Hypoxaemia is life-threatening"], role: "justify", criteria: [{ text: "Names hypoxaemia", weight: 2, safetyCritical: true }, { text: "Gives a target range", weight: 1 }] },
    ] } }),
  ok("structured: interpretation with findings", { format: "structured", stem: "Interpret these observations of an adult on a ward.", rationale: "Several NEWS2 parameters are abnormal.", options: [], marking: "deterministic",
    answerKey: { variant: "interpretation", findings: [{ label: "Respiratory rate", value: 26, unit: "/min" }, { label: "SpO2", value: "91", unit: "%" }], parts: [
      { prompt: "What do the findings suggest?", marks: 2, accepted: ["Respiratory compromise"], role: "interpret", criteria: [{ text: "Identifies tachypnoea", weight: 1 }] },
      { prompt: "What do you do?", marks: 2, accepted: ["Escalate"], role: "answer" },
    ] } }),
];

const bad: { label: string; content: Record<string, unknown> }[] = [
  { label: "calculation value as a string", content: { ...samples[0].content, answerKey: { ...(samples[0].content.answerKey as object), value: "105" } } },
  { label: "calculation without accepted", content: { ...samples[0].content, answerKey: { format: "calculation", value: 105, unit: "mg" } } },
  { label: "calculation tolerance over 10 percent", content: { ...samples[0].content, answerKey: { ...(samples[0].content.answerKey as object), tolerance: { kind: "percent", amount: 20 } } } },
  { label: "calculation rounding 7 places", content: { ...samples[0].content, answerKey: { ...(samples[0].content.answerKey as object), rounding: { mode: "decimal_places", places: 7 } } } },
  { label: "calculation marked by the learner", content: { ...samples[0].content, marking: "self" } },
  { label: "calculation with options", content: { ...samples[0].content, options: ["105 mg", "10.5 mg"] } },
  { label: "short with unsafe as a string", content: { ...samples[3].content, answerKey: { accepted: ["Start chest compressions"], unsafe: "Wait" } } },
  { label: "short with safetyCritical as a string", content: { ...samples[3].content, answerKey: { accepted: ["Start chest compressions"], safetyCritical: "yes" } } },
  { label: "structured part with an unknown role", content: { ...samples[5].content, answerKey: { parts: [{ prompt: "What first?", marks: 1, accepted: ["x"], role: "guess" }, { prompt: "Why so?", marks: 1, accepted: ["y"] }] } } },
  { label: "structured with an unknown variant", content: { ...samples[5].content, answerKey: { ...(samples[5].content.answerKey as object), variant: "essay" } } },
  { label: "structured with 13 findings", content: { ...samples[6].content, answerKey: { ...(samples[6].content.answerKey as object), findings: Array.from({ length: 13 }, (_, i) => ({ label: `F${i}`, value: "1" })) } } },
  { label: "structured part with one option", content: { ...samples[5].content, answerKey: { parts: [{ prompt: "What first?", marks: 1, accepted: ["x"], options: ["x"], correct: 0 }, { prompt: "Why so?", marks: 1, accepted: ["y"] }] } } },
];
// The application refuses each bad shape too, except two it NORMALISES before saving (a numeric string becomes a number, options are dropped, a
// missing accepted answer is built from value and unit): those stored shapes can only reach the database by another writer.
const NORMALISED = new Set(["calculation value as a string", "calculation without accepted", "calculation with options"]);
for (const b of bad) if (validateLibraryQuestion(b.content).ok !== NORMALISED.has(b.label)) throw new Error(`the app and the plan disagree on: ${b.label}`);

const lit = (x: unknown) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;
const calc = samples[1].content;
const copy = libraryCopyOf(calc)!;
const sql = `-- VERIFY-997 (strict). GENERATED by scripts/sqie-hq/build-verify-997.ts from the application validator: do not edit by hand.
-- Run on STAGING after 997. One block that ALWAYS raises, so nothing planted is kept:
--   "VERIFY-997 PASS pass=N"  every check held (reported by the runner as a rolled-back error: nothing changed)
--   "VERIFY-997 FAIL ..."     the first check that did not hold
do $$
declare
  n int := 0;
  bad int;
  v_actor uuid; v_appt uuid; v_res uuid; v_ver uuid; v_ccv uuid; v_mat uuid; v_chunk uuid; v_learner uuid; v_hash text;
  c_calc jsonb := ${lit(calc)};
  c_copy_answer jsonb := ${lit(copy.answer)};
begin
  if position('calculation' in pg_get_functiondef('ckri_question_format_ok'::regproc)) = 0 then raise exception 'VERIFY-997 FAIL format check has no calculation'; end if; n := n + 1;
  if position('''calculation''' in pg_get_functiondef('individual_scholar_question_library_guard'::regproc)) = 0 then raise exception 'VERIFY-997 FAIL copy guard does not map calculation'; end if; n := n + 1;
  -- every stored revision question still passes (the pilot drafts and every walk item included)
  select count(*) into bad from ckri_knowledge_version v join ckri_knowledge_resource r on r.id = v.resource_id
   where r.kind = 'revision_question' and not coalesce(ckri_knowledge_content_ok('revision_question', v.content), false);
  if bad <> 0 then raise exception 'VERIFY-997 FAIL % stored revision question(s) no longer pass', bad; end if; n := n + 1;
${samples.map(x => `  if not coalesce(ckri_knowledge_content_ok('revision_question', ${lit(x.content)}), false) then raise exception 'VERIFY-997 FAIL refused: ${x.label}'; end if; n := n + 1;`).join("\n")}
${bad.map(x => `  if coalesce(ckri_knowledge_content_ok('revision_question', ${lit(x.content)}), false) then raise exception 'VERIFY-997 FAIL accepted: ${x.label}'; end if; n := n + 1;`).join("\n")}

  -- planted: a published, clinically approved calculation version. The 442 authority and state guards and the 395 decision
  -- guards are disabled INSIDE this transaction only. The library-copy guard stays ENABLED: it is what is tested.
  alter table ckri_knowledge_resource disable trigger ckri_knowledge_resource_guard;
  alter table ckri_knowledge_version disable trigger user;
  alter table clinical_content_version disable trigger user;
  alter table clinical_review_decision disable trigger user;
  select id into v_actor from profiles order by created_at limit 1;
  select id into v_appt from ogs_office_appointments order by created_at limit 1;
  insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-997-calc', 'revision_question', 'VERIFY 997 calculation', v_actor) returning id into v_res;
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by, state, content_hash, educator_reviewed_by, educator_reviewed_hash, educator_reviewed_at, submitted_by, submitted_at, published_by, published_at)
    values (v_res, 1, c_calc, 'educator', array[v_actor], 'published', 'verify-997', v_actor, 'verify-997', now(), v_actor, now(), v_actor, now()) returning id, content_hash into v_ver, v_hash;
  insert into clinical_content_version (content_kind, knowledge_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals)
    values ('resource', v_ver, v_hash, c_calc, array[v_actor], v_actor, 1) returning id into v_ccv;
  insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v_ccv, v_actor, v_appt, 'approved');
  if not ckri_knowledge_approved(v_ver) then raise exception 'VERIFY-997 FAIL planted version not approved'; end if;
  select c.user_id, c.material_id, c.id into v_learner, v_mat, v_chunk from individual_scholar_chunk c order by c.user_id, c.id limit 1;
  delete from individual_scholar_question where user_id = v_learner and library_version_id = v_ver;
  -- the exact copy (libraryCopyOf): kind short, answer = answerKey + marking
  insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version,
      review_status, library_resource_id, library_version_id, answer)
    values (v_learner, v_mat, v_chunk, 'short', c_calc ->> 'stem', '[]'::jsonb, null, c_calc ->> 'rationale', '', 'competen-library', 'competen-library', 'library:v1',
      'library_approved', v_res, v_ver, c_copy_answer);
  n := n + 1;
  delete from individual_scholar_question where user_id = v_learner and library_version_id = v_ver;
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version,
        review_status, library_resource_id, library_version_id, answer)
      values (v_learner, v_mat, v_chunk, 'short', c_calc ->> 'stem', '[]'::jsonb, null, c_calc ->> 'rationale', '', 'competen-library', 'competen-library', 'library:v1',
        'library_approved', v_res, v_ver, jsonb_set(c_copy_answer, '{value}', '1250'));
    raise exception 'VERIFY-997 FAIL a copy with another value was stored';
  exception when others then
    if sqlerrm like 'VERIFY-997 FAIL%' then raise; end if;
    if sqlerrm not like '%stored exactly as published%' then raise exception 'VERIFY-997 FAIL wrong refusal (value): %', sqlerrm; end if;
  end; n := n + 1;
  begin
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version,
        review_status, library_resource_id, library_version_id, answer)
      values (v_learner, v_mat, v_chunk, 'short', c_calc ->> 'stem', '[]'::jsonb, null, c_calc ->> 'rationale', '', 'competen-library', 'competen-library', 'library:v1',
        'library_approved', v_res, v_ver, c_copy_answer - 'safetyCritical');
    raise exception 'VERIFY-997 FAIL a copy without its safety marker was stored';
  exception when others then
    if sqlerrm like 'VERIFY-997 FAIL%' then raise; end if;
    if sqlerrm not like '%stored exactly as published%' then raise exception 'VERIFY-997 FAIL wrong refusal (safety): %', sqlerrm; end if;
  end; n := n + 1;

  raise exception 'VERIFY-997 PASS pass=%', n;
end $$;
`;
writeFileSync("docs/evidence/SQIE-HQ/VERIFY-997.sql", sql.replace(/\r/g, ""));
console.log(`VERIFY-997.sql written: ${samples.length} accepted samples, ${bad.length} refused samples`);
