/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SQIE PILOT QUESTION LIBRARY BATCH -- loader and checks. SQIE-CLOSE-2026-11 owner decisions of 4 Nov 2026, items 2 and 3.
 *
 * Loads the 60 pilot nursing questions in sqie-pilot-batch-v1.json into the governed CKRI Question Library (migration 442,
 * revision_question, formats of 800) as DRAFTS ONLY. It never reviews, submits, approves or publishes anything.
 *
 * THE AUTHORING PATH. Every question's content is built by the HQ educator form path (question-format.ts
 * questionContentFromFields) and checked by the validator HQ and Scholar share (educator.ts checkedContent, which calls
 * library-format.ts validateLibraryQuestion). The rows are written exactly as educator.ts createResource writes them
 * (ckri_knowledge_resource, then version 1 in ckri_knowledge_version), so every 442 database guard runs: the author must
 * hold hq.learning.ckri.educator, a version starts as a draft, the shape is checked by ckri_knowledge_content_ok, and
 * the hash is computed by the database. The one difference from the HQ form is the provenance, which is the truth:
 * origin ai_draft with ai_provenance (the 442 CHECK requires the pair), because the drafts were AI-assisted. The
 * competency link goes through educator.ts setCompetencies (frozen by 442 at submission).
 *
 * WHAT RIDES IN THE CONTENT besides the question. Programme, qualification level, difficulty, misconception tags, the
 * cited references, the source verification state ("source not verified" for every item until a reviewer checks the key
 * against the cited text), a DRAFT competency mapping with framework-version provenance (never validated evidence), and
 * for calculations the inputs, formula, unit and rounding rule (tolerance 0). 442 and 800 check only the keys they name,
 * so these are stored, hashed and therefore part of what an independent clinical reviewer approves. Learners never see
 * them: libraryCopyOf (the learner copy and the 800 guard) reads only the question, key, rubric and marking rule.
 *
 * TARGETS. Staging by default. Production is refused unless the environment carries COMPETEN_PRODUCTION_WRITE_GO (a
 * named owner GO) AND --target production is given: the production load is a separate owner act.
 *
 *   npx tsx scripts/sqie-pilot/load-sqie-pilot-batch.ts --check                       offline: validate the batch, no I/O
 *   npx tsx scripts/sqie-pilot/load-sqie-pilot-batch.ts --load --author <uuid>        write the 60 drafts (idempotent by code)
 *   npx tsx scripts/sqie-pilot/load-sqie-pilot-batch.ts --verify --publisher <uuid>   prove: drafts only, nothing served,
 *                                                                                      publication and Scholar reuse refused,
 *                                                                                      the HQ catalogue lists them
 *   --env-dir <dir>   where .env.local is read from (default: the current directory)
 *   --out <file>      verify: write the evidence JSON here
 *
 * Env: STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE_KEY, and for the database gate check STAGING_DB_URL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { checkedContent, publishVersion, setCompetencies } from "@/lib/knowledge/educator";
import { libraryCopyOf, validateLibraryQuestion } from "@/lib/individual/scholar/library-format";
import { loadLibraryQuestions, servableLibraryVersions } from "@/lib/individual/scholar/library-questions";
import { loadCatalogue } from "@/lib/knowledge/question-catalogue";
import { sourceRefusal } from "@/lib/knowledge/question-source";
import { judgeDbTarget, judgeTarget } from "../production-guard";

const HERE = dirname(fileURLToPath(import.meta.url));
const BATCH_FILE = join(HERE, "sqie-pilot-batch-v1.json");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] ?? null : null; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AREAS = { respiratory: "Respiratory assessment", cardiovascular: "Cardiovascular assessment", abcde: "ABCDE and deterioration", reasoning: "Clinical reasoning and prioritisation", medication: "Medication safety" } as const;
export const TYPES = ["single_best", "multiple_response", "short", "structured", "case", "sequence", "calculation", "calculation_structured", "extended"] as const;
const TYPE_FORMAT: Record<string, string> = { single_best: "mcq", multiple_response: "mrq", short: "short", structured: "structured", case: "structured", sequence: "sequence", calculation: "short", calculation_structured: "structured", extended: "extended" };
const DIFFICULTIES = ["introductory", "intermediate", "advanced"];

type Batch = { batch: string; programme: any; framework: any; provenance: any; references: Record<string, { kind: string; citation: string }>; questions: any[] };
export const loadBatch = (): Batch => JSON.parse(readFileSync(BATCH_FILE, "utf8"));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** The leading number of an accepted answer ("62.5 mL/hour" -> 62.5), or null. */
const leadingNumber = (s: string): number | null => { const m = s.replace(/,(?=\d{3}\b)/g, "").match(/^\s*(-?\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };
const WORDS: Record<string, number> = { two: 2, five: 5, eight: 8, nine: 9, eleven: 11 };
const numberOf = (s: string): number | null => leadingNumber(s) ?? WORDS[s.trim().split(/\s+/)[0]?.toLowerCase() ?? ""] ?? null;

/** Pure. The formula of a calculation evaluated on its inputs (names only, arithmetic only). */
function evaluate(formula: string, inputs: Record<string, number>): number {
  if (!/^[a-z_0-9\s+\-*/().]+$/i.test(formula)) throw new Error(`formula has characters outside arithmetic: ${formula}`);
  const names = Object.keys(inputs);
  const unknown = (formula.match(/[a-z_][a-z_0-9]*/gi) ?? []).filter(n => !names.includes(n));
  if (unknown.length) throw new Error(`formula names unknown inputs: ${unknown.join(", ")}`);
  return Function(...names, `return (${formula});`)(...names.map(n => inputs[n]));
}
const roundTo = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Pure. The rubric objective is the mapped learning objective (the competency skill text, at most 300 characters). */
const fieldsOf = (q: any) => ({ ...q.fields, rubric: { ...(q.fields.rubric ?? {}), objective: q.competency.objective } });

/** Pure. The words of the key of a question, to look for in its stem (an answer leaking into the stem). */
function keyTexts(content: any): string[] {
  const k = content.answerKey ?? {};
  switch (content.format ?? "mcq") {
    case "mcq": return [content.options[content.correct_index]];
    case "mrq": return (k.correct ?? []).map((i: number) => content.options[i]);
    case "short": return k.accepted ?? [];
    case "structured": return (k.parts ?? []).flatMap((p: any) => p.accepted);
    case "extended": return [];
    default: return [];
  }
}

export type CheckResult = { errors: string[]; warnings: string[]; byArea: Record<string, number>; byType: Record<string, number>; byFormat: Record<string, number>; byDifficulty: Record<string, number>; sourceNotVerified: string[] };

/** Pure (reads only the batch file). Every rule the batch must meet before anything is written. */
export function checkBatch(b: Batch = loadBatch()): CheckResult {
  const errors: string[] = [], warnings: string[] = [];
  const byArea: Record<string, number> = {}, byType: Record<string, number> = {}, byFormat: Record<string, number> = {}, byDifficulty: Record<string, number> = {};
  const codes = new Set<string>(), stems = new Set<string>();
  if (b.questions.length !== 60) errors.push(`expected 60 questions, found ${b.questions.length}`);
  for (const q of b.questions) {
    const at = q.code ?? "(no code)";
    const e = (m: string) => errors.push(`${at}: ${m}`);
    if (!/^sqie-pilot-[a-z]+-\d{2}$/.test(q.code ?? "") || !/^[a-z][a-z0-9_-]{2,60}$/.test(q.code)) e("code must be sqie-pilot-<area>-NN and a valid 442 code");
    if (codes.has(q.code)) e("duplicate code"); codes.add(q.code);
    if (!(q.area in AREAS)) e(`unknown area ${q.area}`);
    if (!(TYPES as readonly string[]).includes(q.type)) e(`unknown type ${q.type}`);
    if (TYPE_FORMAT[q.type] !== q.fields?.format) e(`type ${q.type} must use format ${TYPE_FORMAT[q.type]}, not ${q.fields?.format}`);
    if (!DIFFICULTIES.includes(q.difficulty)) e(`difficulty must be one of ${DIFFICULTIES.join(", ")}`);
    if (typeof q.title !== "string" || q.title.trim().length < 2 || q.title.length > 200) e("title 2-200 characters");
    if (!/^(NUR-CCF-\d{3}|PP-\d{2})$/.test(q.competency?.code ?? "")) e("competency code must be an NUR-CCF competency code");
    if (typeof q.competency?.objective !== "string" || !q.competency.objective.trim() || q.competency.objective.length > 300) e("learning objective (the competency skill text) is required, at most 300 characters");
    if (!Array.isArray(q.misconception_tags) || !q.misconception_tags.length || q.misconception_tags.some((t: string) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t))) e("misconception_tags: at least one kebab-case tag");
    if (!Array.isArray(q.references) || !q.references.length) e("at least one reference");
    for (const r of q.references ?? []) {
      if (!b.references[r.id]) e(`reference ${r.id} is not in the batch reference list`);
      if (typeof r.supports !== "string" || r.supports.trim().length < 10) e(`reference ${r.id}: say what in it supports the key`);
    }
    if (q.fields?.source?.kind !== "own_writing") e("rights declaration must be own_writing (original wording, facts drawn from the cited sources)");
    if (!q.fields?.rubric?.misconceptions?.length) e("rubric misconceptions required");

    const checked = checkedContent("revision_question", fieldsOf(q));
    if (!checked.ok) { e(`library validator refused it: ${checked.error}`); continue; }
    const content = checked.content as any;
    const why = sourceRefusal(content);
    if (why) e(`source declaration refused: ${why}`);
    if (!libraryCopyOf(content)) e("no learner copy can be built from it");
    if (content.format !== q.fields.format) e(`stored format ${content.format} is not ${q.fields.format}`);
    if (!content.rubric) e("rubric was dropped by the validator");

    // the answer must not be given away by the stem
    const stem = norm(content.stem);
    for (const t of keyTexts(content)) {
      const n = norm(String(t ?? ""));
      if (n.length >= 4 && stem.includes(n)) e(`the stem contains the key "${t}"`);
    }
    if (stems.has(stem)) e("duplicate stem"); stems.add(stem);
    if (content.format === "mcq" && new Set(content.options.map(norm)).size !== 4) e("mcq options must differ");

    // calculations: exact matching, units required, the key recomputed from the inputs (the second dose check)
    if (q.type === "calculation" || q.type === "calculation_structured" || q.calculation) {
      const c = q.calculation;
      if (!c) { e("a calculation needs its calculation block"); continue; }
      if (c.tolerance?.absolute !== 0 || c.tolerance?.percent !== 0) e("tolerance must be 0 (owner decision item 1: exact matching)");
      if (c.unit_required !== true || typeof c.unit !== "string" || !c.unit) e("unit is required");
      if (typeof c.rounding !== "string" || !Number.isInteger(c.decimals)) e("rounding rule and decimals required");
      let value: number | null = null;
      try { value = roundTo(evaluate(c.formula, c.inputs), c.decimals); } catch (x: any) { e(`formula: ${x.message}`); }
      if (value !== null && value !== c.value) e(`recomputed ${value} from the inputs, but the batch says ${c.value}`);
      const unitWord = norm(c.unit).split(" ")[0];
      const accepted: string[] = q.type === "calculation" ? content.answerKey.accepted
        : q.type === "calculation_structured" ? content.answerKey.parts.find((p: any) => p.accepted.some((a: string) => leadingNumber(a) === c.value))?.accepted ?? []
        : [];
      if ((q.type === "calculation" || q.type === "calculation_structured") && !accepted.length) e("no accepted answer carries the computed value");
      for (const a of accepted) {
        if (numberOf(a) !== c.value) e(`accepted answer "${a}" is not the computed value ${c.value}`);
        if (!/[a-z]/i.test(a.replace(/^\s*-?\d+(?:\.\d+)?/, "")) || (unitWord !== "mmhg" && !norm(a).includes(unitWord.slice(0, 2)) && !/millilitres|tabs?|dpm/.test(a.toLowerCase()))) e(`accepted answer "${a}" does not carry the unit ${c.unit}`);
        if (/^\s*[+-]/.test(a)) e(`accepted answer "${a}" relies on a sign, which the marker's normaliser removes: write the sign in words`);
      }
      if (c.parts) for (const [part, v] of Object.entries(c.parts as Record<string, number>)) {
        const p = content.answerKey.parts?.[part.charCodeAt(0) - 97];
        if (!p) { e(`calculation part ${part} has no question part`); continue; }
        if (!p.accepted.some((a: string) => numberOf(a) === v)) e(`part ${part}: no accepted answer is ${v}`);
      }
    }
    // structured parts that are numbers (NEWS2 totals) must agree with each other
    if (content.format === "structured") for (const p of content.answerKey.parts) {
      const nums = p.accepted.map(numberOf).filter((n: number | null) => n !== null);
      if (nums.length && new Set(nums).size > 1) e(`part "${p.prompt.slice(0, 30)}": accepted answers disagree on the number`);
    }
    if (!q.fields.stem.trim().endsWith("?") && !["structured", "sequence"].includes(content.format) && !/\.$/.test(q.fields.stem.trim())) warnings.push(`${at}: stem has no closing punctuation`);

    byArea[q.area] = (byArea[q.area] ?? 0) + 1;
    byType[q.type] = (byType[q.type] ?? 0) + 1;
    byFormat[content.format] = (byFormat[content.format] ?? 0) + 1;
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
  }
  for (const a of Object.keys(AREAS)) if ((byArea[a] ?? 0) !== 12) errors.push(`area ${a}: ${byArea[a] ?? 0} questions, expected 12`);
  for (const f of ["mcq", "mrq", "short", "structured", "sequence"]) if (!byFormat[f]) errors.push(`no ${f} question in the mix`);
  if (!byType.case || !byType.calculation) errors.push("the mix needs case and calculation questions");
  // Every question is "source not verified": no Competen source registry holds these guidelines yet, and no one has
  // checked a key against the cited text. The reviewer's verification is what changes it, never this script.
  return { errors, warnings, byArea, byType, byFormat, byDifficulty, sourceNotVerified: b.questions.map(q => q.code) };
}

/** Pure. The stored content: the validated question plus the batch metadata. */
export function contentFor(b: Batch, q: any, mapping: Record<string, unknown>): Record<string, unknown> {
  const checked = checkedContent("revision_question", fieldsOf(q));
  if (!checked.ok) throw new Error(`${q.code}: ${checked.error}`);
  const out: Record<string, unknown> = {
    ...checked.content,
    pilot_batch: b.batch,
    programme_code: b.programme.code, programme_label: b.programme.label,
    qualification_level: b.programme.qualification_level, qualification_label: b.programme.qualification_label,
    difficulty: q.difficulty, topic: (AREAS as Record<string, string>)[q.area], question_type: q.type,
    misconception_tags: q.misconception_tags,
    references: q.references.map((r: any) => ({ id: r.id, kind: b.references[r.id].kind, citation: b.references[r.id].citation, supports: r.supports })),
    source_verification: { status: "not_verified", label: "source not verified", note: "Cited sources are named public guidelines and textbooks. None is held in a Competen source registry and no reviewer has yet checked the key against the cited text. Verify before submission." },
    competency_mapping: mapping,
    ...(q.calculation ? { calculation: { ...q.calculation, matching: "exact" } } : {}),
  };
  // the metadata is invisible to learners and does not change what Scholar would copy
  const v = validateLibraryQuestion(out);
  if (!v.ok) throw new Error(`${q.code}: the stored content no longer validates: ${v.error}`);
  if (JSON.stringify(libraryCopyOf(out)) !== JSON.stringify(libraryCopyOf(checked.content))) throw new Error(`${q.code}: metadata changed the learner copy`);
  if (Buffer.byteLength(JSON.stringify(out)) > 30000) throw new Error(`${q.code}: content too large for 442`);
  return out;
}

function target() {
  loadEnvConfig(opt("--env-dir") ?? process.cwd());
  const production = opt("--target") === "production";
  const url = production ? process.env.NEXT_PUBLIC_SUPABASE_URL : process.env.STAGING_SUPABASE_URL;
  const key = production ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.STAGING_SERVICE_ROLE_KEY;
  const verdict = judgeTarget(url);
  if (!verdict.ok && verdict.reason === "UNIDENTIFIABLE") throw new Error("REFUSING: the Supabase URL does not identify a project.");
  if (!verdict.ok && verdict.reason === "PRODUCTION" && !(production && (process.env.COMPETEN_PRODUCTION_WRITE_GO ?? "").trim()))
    throw new Error("REFUSING: production. The production load needs a named owner GO (COMPETEN_PRODUCTION_WRITE_GO) and --target production.");
  if (production && verdict.ok) throw new Error("REFUSING: --target production but the URL is not production.");
  if (!key) throw new Error("missing service role key");
  return { admin: createClient(url!, key, { auth: { persistSession: false } }), ref: verdict.ref, production };
}

async function resolveFramework(admin: any, b: Batch) {
  const fw = await admin.from("frameworks").select("id, code, name, version_major, version_minor, version_revision, version_num, pub_status").eq("code", b.framework.code).is("hospital_id", null).limit(1).maybeSingle();
  if (fw.error || !fw.data) throw new Error(`framework ${b.framework.code} not found: ${fw.error?.message ?? "absent"}`);
  const doms = await admin.from("framework_domains").select("id").eq("framework_id", fw.data.id);
  const comps = await admin.from("framework_competencies").select("id, code, name, domain_id").in("domain_id", (doms.data ?? []).map((d: any) => d.id));
  const skills = await admin.from("competency_skills").select("id, competency_id, name").in("competency_id", (comps.data ?? []).map((c: any) => c.id)).limit(5000);
  if (comps.error || skills.error) throw new Error("competencies unreadable");
  return { fw: fw.data, comps: comps.data as any[], skills: skills.data as any[] };
}

function mappingFor(q: any, f: Awaited<ReturnType<typeof resolveFramework>>) {
  const c = f.comps.find(x => x.code === q.competency.code);
  if (!c) throw new Error(`${q.code}: competency ${q.competency.code} is not in ${f.fw.code}`);
  const skill = f.skills.find(s => s.competency_id === c.id && s.name === q.competency.objective);
  if (!skill) throw new Error(`${q.code}: the learning objective is not a skill of ${c.code} (exact text)`);
  return {
    competencyId: c.id as string,
    mapping: {
      status: "draft", validated: false, mapped_by: "ai_draft", note: "Draft mapping awaiting clinical review and publication. Not validated competency evidence. Question performance never establishes verified competence or a Benner stage.",
      framework_code: f.fw.code, framework_id: f.fw.id, framework_name: f.fw.name,
      framework_version: `${f.fw.version_major}.${f.fw.version_minor}.${f.fw.version_revision}`, framework_version_num: f.fw.version_num, framework_pub_status_at_mapping: f.fw.pub_status,
      competency_id: c.id, competency_code: c.code, competency_name: c.name,
      learning_objective: skill.name, learning_objective_id: skill.id, learning_objective_source: "competency_skills",
    },
  };
}

async function load() {
  const author = opt("--author");
  if (!author || !UUID.test(author)) throw new Error("--author <uuid> is required (a person holding hq.learning.ckri.educator)");
  const b = loadBatch();
  const chk = checkBatch(b);
  if (chk.errors.length) throw new Error(`the batch does not pass --check:\n${chk.errors.join("\n")}`);
  const { admin, ref } = target();
  console.log(`target ${ref}. author ${author}. ${b.questions.length} questions, drafts only.`);
  const f = await resolveFramework(admin, b);
  console.log(`framework ${f.fw.code} ${f.fw.version_major}.${f.fw.version_minor}.${f.fw.version_revision} (version_num ${f.fw.version_num}, ${f.fw.pub_status}), ${f.comps.length} competencies`);
  const prepared = b.questions.map(q => { const m = mappingFor(q, f); return { q, ...m, content: contentFor(b, q, m.mapping) }; });
  const holds = await admin.rpc("ckri_holds_capability", { p_person: author, p_capability: "hq.learning.ckri.educator" });
  console.log(`author holds hq.learning.ckri.educator: ${holds.error ? `unreadable (${holds.error.message})` : holds.data}`);
  if (flag("--dry-run")) {
    const existing = await admin.from("ckri_knowledge_resource").select("code").in("code", prepared.map(p => p.q.code));
    console.log(`dry run: all ${prepared.length} mappings resolved to ${f.fw.code} competencies and skills, contents built and validated; ${existing.data?.length ?? 0} codes already present. Nothing written.`);
    return;
  }
  if (holds.data === false) throw new Error("REFUSING: the author does not hold hq.learning.ckri.educator, so 442 would refuse every draft.");
  let created = 0, skipped = 0;
  for (const p of prepared) {
    const have = await admin.from("ckri_knowledge_resource").select("id").eq("code", p.q.code).maybeSingle();
    if (have.data) { skipped++; console.log(`  skip  ${p.q.code} (exists)`); continue; }
    // educator.ts createResource, with the true provenance (origin ai_draft + ai_provenance, as the 442 CHECK pairs them)
    const res = await admin.from("ckri_knowledge_resource").insert({ code: p.q.code, kind: "revision_question", title: p.q.title, created_by: author }).select("id").single();
    if (res.error) throw new Error(`${p.q.code}: resource refused: ${res.error.message}`);
    const ai_provenance = { ...b.provenance, batch: b.batch, model: b.provenance.model, prompt_version: b.provenance.prompt_version };
    const ver = await admin.from("ckri_knowledge_version").insert({ resource_id: res.data.id, version_no: 1, content: p.content, origin: "ai_draft", ai_provenance, authored_by: [author] }).select("id, state").single();
    if (ver.error) { await admin.from("ckri_knowledge_resource").update({ status: "retired" }).eq("id", res.data.id); throw new Error(`${p.q.code}: version refused: ${ver.error.message}`); }
    const link = await setCompetencies(admin, ver.data.id, [p.competencyId]);
    if (!link.ok) throw new Error(`${p.q.code}: competency link refused: ${link.error}`);
    created++;
    console.log(`  draft ${p.q.code} -> version ${ver.data.id} (${ver.data.state})`);
  }
  console.log(`done: ${created} created, ${skipped} already present. Nothing submitted, reviewed, approved or published.`);
}

async function verify() {
  const publisher = opt("--publisher");
  if (!publisher || !UUID.test(publisher)) throw new Error("--publisher <uuid> is required (a person holding hq.quality.knowledge.publish, to prove publication is refused)");
  const b = loadBatch();
  const { admin, ref } = target();
  const codes = b.questions.map(q => q.code);
  const out: Record<string, any> = { target: ref, at: new Date().toISOString(), batch: b.batch };
  let fail = 0;
  const pass = (name: string, ok: boolean, detail: unknown) => { out[name] = { ok, detail }; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); if (!ok) fail++; };

  const res = await admin.from("ckri_knowledge_resource").select("id, code, kind, status, created_by").in("code", codes);
  const rids = (res.data ?? []).map((r: any) => r.id);
  const vers = rids.length ? await admin.from("ckri_knowledge_version").select("id, resource_id, version_no, state, origin, ai_provenance, submitted_at, published_at, published_by, content").in("resource_id", rids) : { data: [] as any[] };
  const vs = (vers.data ?? []) as any[];
  pass("1 loaded: 60 revision_question resources, one version each", res.data?.length === 60 && vs.length === 60 && res.data.every((r: any) => r.kind === "revision_question" && r.status === "active"), `${res.data?.length ?? 0} resources, ${vs.length} versions`);
  pass("2 none published: every version is a draft, never submitted or published", vs.every(v => v.state === "draft" && !v.submitted_at && !v.published_at && !v.published_by), Object.fromEntries([...new Set(vs.map(v => v.state))].map(s => [s, vs.filter(v => v.state === s).length])));
  pass("3 provenance: origin ai_draft with model and prompt version", vs.every(v => v.origin === "ai_draft" && v.ai_provenance?.model && v.ai_provenance?.prompt_version), [...new Set(vs.map(v => `${v.origin}/${v.ai_provenance?.model}/${v.ai_provenance?.prompt_version}`))]);
  pass("4 mapping is draft with framework-version provenance, never validated", vs.every(v => v.content?.competency_mapping?.status === "draft" && v.content.competency_mapping.validated === false && v.content.competency_mapping.framework_version && v.content.competency_mapping.competency_code), [...new Set(vs.map(v => `${v.content?.competency_mapping?.framework_code} ${v.content?.competency_mapping?.framework_version} (${v.content?.competency_mapping?.framework_pub_status_at_mapping})`))]);
  pass("5 every version marked 'source not verified'", vs.every(v => v.content?.source_verification?.status === "not_verified"), `${vs.filter(v => v.content?.source_verification?.status === "not_verified").length} of ${vs.length}`);
  const links = vs.length ? await admin.from("ckri_knowledge_version_competency").select("version_id, competency_id").in("version_id", vs.map(v => v.id)) : { data: [] as any[] };
  pass("6 one competency link per version (442 table, frozen at submission)", (links.data ?? []).length === 60, `${(links.data ?? []).length} links`);
  const counts: Record<string, Record<string, number>> = { area: {}, type: {}, format: {}, difficulty: {} };
  for (const v of vs) { const c = v.content; const q = b.questions.find(x => x.code === res.data!.find((r: any) => r.id === v.resource_id)!.code)!; counts.area[q.area] = (counts.area[q.area] ?? 0) + 1; counts.type[c.question_type] = (counts.type[c.question_type] ?? 0) + 1; counts.format[c.format ?? "mcq"] = (counts.format[c.format ?? "mcq"] ?? 0) + 1; counts.difficulty[c.difficulty] = (counts.difficulty[c.difficulty] ?? 0) + 1; }
  out.counts = counts;

  // the approval gate: nothing is clinically approved, Scholar offers none, publication is refused
  const approved = await Promise.all(vs.map(v => admin.rpc("ckri_knowledge_approved", { p_version: v.id }).then((r: any) => r.data === true)));
  pass("7 gate: ckri_knowledge_approved is false for every version", approved.every(a => !a), `${approved.filter(Boolean).length} approved`);
  const offered = await loadLibraryQuestions(admin, [...new Set((links.data ?? []).map((l: any) => l.competency_id))]);
  const ours = new Set(vs.map(v => v.id));
  pass("8 gate: Scholar loadLibraryQuestions offers none of them", !offered.some(o => ours.has(o.versionId)), `${offered.filter(o => ours.has(o.versionId)).length} offered`);
  const servable = await servableLibraryVersions(admin, vs.map(v => v.id));
  pass("9 gate: Scholar servableLibraryVersions serves none of them", servable.size === 0, `${servable.size} servable`);
  const pub = await publishVersion(admin, publisher, vs[0].id);
  pass("10 gate: publication by an authorised publisher is refused for a draft", !pub.ok, pub.ok ? "PUBLISHED (unexpected)" : pub.error);
  const after = await admin.from("ckri_knowledge_version").select("state").eq("id", vs[0].id).single();
  pass("10b the refused version is still a draft", after.data?.state === "draft", after.data?.state ?? "unreadable");

  // the 800 database guard: a learner copy of a draft is refused (inside a transaction that is always rolled back)
  out["11 gate: the 800 guard refuses a Scholar library copy of a draft"] = await dbGuardCheck(vs[0], pass);

  const cat = await loadCatalogue(admin);
  const listed = (cat?.items ?? []).filter(i => codes.includes(i.code));
  pass("12 HQ catalogue (loadCatalogue, the /super-admin/research/questions read model) lists all 60 as Draft", listed.length === 60 && listed.every(i => i.latest.status === "draft" && i.latest.origin === "ai_draft" && !i.served), `${listed.length} listed; statuses ${JSON.stringify(Object.fromEntries([...new Set(listed.map(i => i.latest.status))].map(s => [s, listed.filter(i => i.latest.status === s).length])))}; served ${listed.filter(i => i.served).length}`);
  out.catalogue_sample = listed.slice(0, 3).map(i => ({ code: i.code, title: i.title, status: i.latest.status, format: i.latest.formatLabel, competencies: i.competencyIds.map(id => cat!.competencyNames.get(id) ?? id) }));
  out.version_ids = Object.fromEntries(vs.map(v => [res.data!.find((r: any) => r.id === v.resource_id)!.code, v.id]));
  const file = opt("--out");
  if (file) writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
  if (fail) process.exitCode = 1;
}

async function dbGuardCheck(v: any, pass: (n: string, ok: boolean, d: unknown) => void) {
  const conn = process.env.STAGING_DB_URL;
  const verdict = judgeDbTarget(conn);
  if (!verdict.ok) { pass("11 gate: the 800 guard refuses a Scholar library copy of a draft", false, `database target refused: ${verdict.reason}`); return; }
  const { Client } = await import("pg");
  const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    const host = await c.query("select ch.id as chunk_id, ch.material_id, m.user_id from individual_scholar_chunk ch join individual_scholar_material m on m.id = ch.material_id limit 1");
    if (!host.rows.length) { pass("11 gate: the 800 guard refuses a Scholar library copy of a draft", false, "no staging learner material to attach a test copy to"); return; }
    const copy = libraryCopyOf(v.content)!;
    let refused: string | null = null;
    try {
      await c.query("savepoint s");
      await c.query(
        `insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version, answer, review_status, library_resource_id, library_version_id)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'library', 'competen-library', 'competen-library', 'library', $9::jsonb, 'library_approved', $10, $11)`,
        [host.rows[0].user_id, host.rows[0].material_id, host.rows[0].chunk_id, copy.kind, copy.stem, JSON.stringify(copy.options), copy.correctIndex, copy.rationale, copy.answer ? JSON.stringify(copy.answer) : null, v.resource_id, v.id]);
    } catch (x: any) { refused = x.message; }
    pass("11 gate: the 800 guard refuses a Scholar library copy of a draft", !!refused && /published version|clinically approved/.test(refused), refused ?? "ACCEPTED (unexpected)");
    return refused;
  } finally { await c.query("rollback").catch(() => {}); await c.end(); }
}

async function main() {
  if (flag("--check")) {
    const r = checkBatch();
    console.log(JSON.stringify({ byArea: r.byArea, byType: r.byType, byFormat: r.byFormat, byDifficulty: r.byDifficulty, sourceNotVerified: r.sourceNotVerified.length }, null, 2));
    for (const w of r.warnings) console.log(`  warn  ${w}`);
    for (const e of r.errors) console.log(`  ERROR ${e}`);
    console.log(r.errors.length ? `\n${r.errors.length} error(s)` : "\nbatch passes every check");
    if (r.errors.length) process.exitCode = 1;
    return;
  }
  if (flag("--load")) return load();
  if (flag("--verify")) return verify();
  console.log("usage: --check | --load --author <uuid> | --verify --publisher <uuid> [--env-dir <dir>] [--out <file>]");
}

main().catch(e => { console.error(e.message ?? e); process.exitCode = 1; });
