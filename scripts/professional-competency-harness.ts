/**
 * PROFESSIONAL COMPETENCIES, SELF-ASSESSMENT AND EVIDENCE HARNESS -- COMPETEN-PROFESSIONAL-COMPETENCY-01, Stage 5
 * (migration 520). Pure/local: reads source and the migration, imports the pure rules. No database, no network.
 *
 *   S  schema: own-row RLS on every 520 table, no write policy, no verified/score/scope column; a self-assessment is
 *      self-reported by construction and append-only; an evidence link names exactly one record by composite key and is
 *      unlinked once, never rewritten or deleted; an entry is catalogue-backed or personal, never both; history by trigger.
 *   F  the four never merge: a self-assessment never reads evidence; the page shows expected, self-assessed, evidence and
 *      verified as four separate panels; "self-reported" travels with every self-assessment.
 *   V  the C5 boundary: no Stage 5 file writes a verification, assessor or decision table; what C5 is handed never
 *      carries a reflection or a personal entry.
 *   P  privacy: reflections are never shareable, never on a Passport link, never sent to AI or for verification.
 *   A  AI: policy-gated through the one Professional helper; saves nothing; a link from AI exists only after the person's
 *      click and records its model and prompt.
 *   L  catalogues: only offered competencies; content not clinically approved is labelled wherever it is shown.
 *   M  production without 520: the 373 record loader never selects a 520 column, and the evidence route saves without it.
 *   H  nothing hard-codes a profession, a country, an assessment method or a scale.
 *
 * Every check is proven able to fail: section X plants one violation per check, in memory, and expects RED.
 *
 *   npx tsx scripts/professional-competency-harness.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY } from "../src/lib/individual/policy";
import { parseSelfAssessment, parseEntry } from "../src/lib/individual/professional/competency-form";
import { COMPETENCY_TABLES, SHAREABLE_KINDS } from "../src/lib/individual/professional/competency-vocabulary";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
type R = { ok: boolean; detail: string };
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
type Sources = Map<string, string>;
const ALL: Sources = new Map(walk("src").map(p => p.replace(/\\/g, "/")).map(f => [f, strip(readFileSync(f, "utf8")).replace(/\r\n/g, "\n")]));
const MIG_FILE = "supabase/migrations/520-individual-professional-competency-portfolio.sql";
const MIG = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase().replace(/\r\n/g, "\n") : "";
const LIB = "src/lib/individual/professional/";
const API = "src/app/api/individual/professional/";
const STORE = LIB + "competency-store.ts", FORM = LIB + "competency-form.ts", VOCAB = LIB + "competency-vocabulary.ts", VERIF = LIB + "competency-verification.ts", SHARE = LIB + "share-competency.ts";
const R_ENTRY = API + "my-competencies/route.ts", R_SELF = API + "self-assessments/route.ts", R_EVID = API + "competency-evidence/route.ts", R_AI = API + "competency-suggestions/route.ts", R_VER = API + "competency-verification/route.ts";
const WORKSPACE = "src/app/individual/_components/professional/competency-workspace.tsx", ASSIST = "src/app/individual/_components/professional/CompetencyAssist.tsx";
const PAGE = "src/app/individual/(app)/[experience]/(professional)/competencies/page.tsx";
const STAGE5_FILES = [STORE, FORM, VOCAB, VERIF, SHARE, R_ENTRY, R_SELF, R_EVID, R_AI, R_VER, WORKSPACE, ASSIST, PAGE];
const TABLES = [...COMPETENCY_TABLES] as string[];
const tableBody = (m: string, t: string) => new RegExp(`create table if not exists ${t} \\(([\\s\\S]*?)\\n\\);`).exec(m)?.[1] ?? "";

// ── S ──
const checkRls = (m: string): R => {
  const bad = TABLES.filter(t => !m.includes(`alter table ${t} enable row level security`) || !new RegExp(`create policy ${t}_read_own on ${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(m));
  const write = /create policy [a-z_]+ on individual_professional_[a-z_]+\s+for (insert|update|delete|all)/.test(m);
  const def = /experience_code text not null default/.test(m);
  return { ok: bad.length === 0 && !write && !def, detail: `${bad.join(",")}${write ? " write-policy" : ""}${def ? " default" : ""}` };
};
const checkColumns = (m: string): R => {
  const blocks = [...m.matchAll(/create table if not exists (individual_professional_[a-z_]+) \(([\s\S]*?)\n\);/g)];
  const bad = blocks.filter(b => /\b(hospital_id|organisation_id|tenant_id|workspace_id|verif[a-z_]*|defici[a-z_]*|score_[a-z_]*|competent[a-z_]*|assessor[a-z_]*)\b/.test(b[2])).map(b => b[1]);
  return { ok: blocks.length === TABLES.length && bad.length === 0, detail: `${blocks.length} tables; ${bad.join(", ")}` };
};
const checkSelfReported = (m: string): R => {
  const only = /add constraint individual_professional_self_assessment_shape check \(\s+basis = 'self_reported'/.test(m) && /basis text not null default 'self_reported'/.test(tableBody(m, "individual_professional_self_assessment"));
  const append = /before update or delete on individual_professional_self_assessment\s+for each row execute function individual_professional_stage5_append_only\(\)/.test(m)
    && /if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then\s+return old;/.test(m);
  return { ok: only && append, detail: `self-reported only ${only}, append-only with cascade ${append}` };
};
const checkLinks = (m: string): R => {
  const one = /\(\(cpd_id is not null\)::int \+ \(learning_record_id is not null\)::int \+ \(evidence_id is not null\)::int\s+\+ \(profile_item_id is not null\)::int \+ \(reflection_id is not null\)::int \+ \(study_achievement_id is not null\)::int\) = 1/.test(m);
  const fks = ["cpd_id, user_id", "learning_record_id, user_id", "evidence_id, user_id", "profile_item_id, user_id", "reflection_id, user_id", "study_achievement_id, user_id"]
    .every(k => m.includes(`foreign key (${k}) references`));
  const entryFks = (m.match(/foreign key \(my_competency_id, user_id\) references individual_professional_my_competency\(id, user_id\)/g) ?? []).length === 4;
  const once = /if old\.unlinked_at is null and new\.unlinked_at is not null\s+and \(to_jsonb\(new\) - 'unlinked_at'\) = \(to_jsonb\(old\) - 'unlinked_at'\) then/.test(m)
    && /raise exception 'individual_professional_competency_evidence keeps its history: unlink instead of deleting'/.test(m);
  const ai = /\(\(source = 'ai'\) = \(model is not null and prompt_version is not null\)\)/.test(m);
  return { ok: one && fks && entryFks && once && ai, detail: `exactly one source ${one}, composite source keys ${fks}, entry keys 4 ${entryFks}, unlink once and no delete ${once}, AI provenance ${ai}` };
};
const checkEntries = (m: string, src: Sources): R => {
  const either = /\(\(kind = 'catalogue'\) = \(framework_id is not null and framework_competency_id is not null\)\)/.test(m);
  const hist = /after insert or update on individual_professional_my_competency\b/.test(m) && /insert into individual_professional_my_competency_history/.test(m);
  const codeWrites = [...src].filter(([, s]) => /from\(\s*"individual_professional_my_competency_history"\s*\)\s*\.(insert|update|upsert|delete)\(/.test(s)).map(([f]) => f);
  return { ok: either && hist && codeWrites.length === 0, detail: `catalogue or personal ${either}, history by trigger ${hist}, code writes history ${codeWrites.join(",")}` };
};

// ── F ──
const checkSelfNeverJudged = (src: Sources, parse: typeof parseSelfAssessment): R => {
  const f = src.get(FORM) ?? "";
  const body = f.slice(f.indexOf("export function parseSelfAssessment"), f.indexOf("export type EvidenceLinkInput"));
  const readsEvidence = /evidence|links|portfolio/i.test(body.replace(/Evidence is not consulted[^\n]*/, ""));
  const route = src.get(R_SELF) ?? "";
  const routeReads = /individual_professional_competency_evidence|loadPortfolio|linkEvidence/.test(route);
  const p = DEFAULT_POLICY.professionalCompetency;
  const any = parse({ levelId: "l" }, { levels: [{ id: "l", scaleId: "s", scaleLabel: null, score: 6, label: "Expert" }], outcomes: [], frameworkVersion: null, policy: p }).ok;
  return { ok: !readsEvidence && !routeReads && any, detail: `parser reads evidence ${readsEvidence}, route reads evidence ${routeReads}, top level accepted without evidence ${any}` };
};
const checkFourPanels = (src: Sources): R => {
  const ws = src.get(WORKSPACE) ?? "";
  const panels = ["ASPECT_TEXT.expected", "ASPECT_TEXT.self", "ASPECT_TEXT.evidence", "ASPECT_TEXT.verified"].every(a => ws.includes(a));
  const label = (ws.match(/SELF_REPORTED/g) ?? []).length >= 2 && /label: SELF_REPORTED/.test(src.get(SHARE) ?? "");
  const verifiedOnlyFromC5 = !/verified/i.test((src.get(STORE) ?? "").replace(/never verif|not verif|C5|Verification/gi, ""));
  return { ok: panels && label && verifiedOnlyFromC5, detail: `four separate panels ${panels}, self-reported label in list, detail and share ${label}, store never claims verified ${verifiedOnlyFromC5}` };
};

// ── V ──
const checkC5Boundary = (src: Sources): R => {
  const writes = STAGE5_FILES.concat(LIB + "share.ts").flatMap(f => [...(src.get(f) ?? "").matchAll(/from\(\s*"([a-z_]+)"\s*\)\s*\.(insert|update|upsert|delete)\(/g)].map(m => `${f}: ${m[1]}`))
    .filter(w => /verif|assess(or|ment)_|decision|appointment|request/.test(w.split(": ")[1]));
  const store = src.get(STORE) ?? "";
  const fn = store.slice(store.indexOf("export async function evidenceForVerification"));
  const noReflection = /if \(!SHAREABLE_KINDS\.includes\(kind\)\) continue;/.test(fn) && !SHAREABLE_KINDS.includes("reflection" as never);
  const catalogueOnly = /if \(!e \|\| e\.kind !== "catalogue" \|\| e\.removed_at\) return null;/.test(fn);
  return { ok: writes.length === 0 && noReflection && catalogueOnly, detail: `verification writes ${writes.join(";")}, never a reflection ${noReflection}, catalogue entries only ${catalogueOnly}` };
};

// ── P ──
const checkPrivacy = (src: Sources): R => {
  const share = src.get(SHARE) ?? "";
  const shareSelect = /from\("individual_professional_self_assessment"\)\.select\("[^"]*reflection/.test(share);
  const shareFilter = /SHAREABLE_KINDS\.includes\(linkKind\(l\)\)/.test(share);
  const ai = src.get(R_AI) ?? "";
  const aiShareableOnly = /\.items\.filter\(i => i\.shareable\)/.test(ai);
  const form = src.get(FORM) ?? "";
  const q = form.slice(form.indexOf("export function aiCompetencyQuestion"), form.indexOf("export type AiMapping"));
  const aiNoReflection = !/reflection(?!_| questions| on)/i.test(q.replace(/never a reflection/gi, ""));
  return { ok: !shareSelect && shareFilter && aiShareableOnly && aiNoReflection, detail: `share reads a reflection ${shareSelect}, share filters to shareable kinds ${shareFilter}, AI sees shareable records only ${aiShareableOnly}, AI question carries no reflection ${aiNoReflection}` };
};

// ── A ──
const checkAi = (src: Sources): R => {
  const r = src.get(R_AI) ?? "";
  const gated = /if \(policy\.ai !== "on"\) return refuse\(/.test(r) && /askProfessionalAssistant\(ctx, req, aiCompetencyQuestion\(/.test(r);
  const savesNothing = !/\.(insert|update|upsert|delete)\(/.test(r.replace(/await audit\([^;]*;/g, ""));
  const a = src.get(ASSIST) ?? "";
  const clickOnly = /onClick=\{\(\) => accept\(i, m\)\}/.test(a) && !/useEffect/.test(a) && /model: out\?\.model, promptVersion: out\?\.promptVersion/.test(a);
  const provenance = /source: ai \? "ai" : "person", model: ai\?\.model \?\? null, prompt_version: ai\?\.promptVersion \?\? null/.test(src.get(STORE) ?? "");
  return { ok: gated && savesNothing && clickOnly && provenance, detail: `gated through the one helper ${gated}, route saves nothing ${savesNothing}, added only on click with provenance ${clickOnly}, provenance stored ${provenance}` };
};

// ── L ──
const checkCatalogues = (src: Sources, parse: typeof parseEntry): R => {
  const p = DEFAULT_POLICY.professionalCompetency;
  const refused = !parse({ competencyId: "11111111-1111-4111-8111-111111111111" }, p, []).ok;
  const ws = src.get(WORKSPACE) ?? "";
  const labelled = (ws.match(/statusNote\(/g) ?? []).length >= 5 && /contentStatus === "approved" \? null/.test(ws);
  const offeredLoad = [R_ENTRY, R_SELF, R_EVID, PAGE].every(f => /loadCatalogueFor\(ctx\.admin, "professional"\)/.test(src.get(f) ?? ""));
  return { ok: refused && labelled && offeredLoad, detail: `unoffered refused ${refused}, unapproved content labelled ${labelled}, every reader uses the offered catalogue ${offeredLoad}` };
};

// ── M ──
const checkWithout520 = (src: Sources): R => {
  const rec = src.get(LIB + "record.ts") ?? "";
  const cols = /EVIDENCE_COLUMNS = "[^"]*(evidence_type|author_name)/.test(rec);
  const ev = src.get(API + "evidence/route.ts") ?? "";
  const tolerant = /return error && !isNotProvisioned\(error\) \?/.test(ev) && ev.indexOf("writeType(ctx, data.id, fields)") > ev.indexOf(".insert({ ...parsed.value");
  const store = src.get(STORE) ?? "";
  const separate = /select\("id, evidence_type_label, author_name"\)[^\n]*\.then\(\(r: any\) => \(r\?\.error \? \[\]/.test(store);
  return { ok: !cols && tolerant && separate, detail: `record loader selects a 520 column ${cols}, evidence saved first and types tolerated ${tolerant}, portfolio reads types apart ${separate}` };
};

// ── H ──
const checkNoHardcoding = (src: Sources): R => {
  const bad = STAGE5_FILES.filter(f => /uganda|\bnurs(e|es|ing)\b|midwi|\bosce\b|dreyfus|benner|novice to expert/i.test(src.get(f) ?? ""));
  return { ok: bad.length === 0 && STAGE5_FILES.every(f => src.has(f)), detail: `${bad.join(", ")}${STAGE5_FILES.filter(f => !src.has(f)).map(f => ` missing ${f}`).join("")}` };
};

function main() {
  console.log("PROFESSIONAL COMPETENCIES, SELF-ASSESSMENT AND EVIDENCE HARNESS (COMPETEN-PROFESSIONAL-COMPETENCY-01 Stage 5)\n");
  const run = (name: string, r: R) => ok(name, r.ok, r.detail);
  ok("0a. the Stage 5 source and migration 520 were found", !!MIG && ALL.has(STORE));
  ok("0b. ⚠ the comment strip kept real code", /\.insert\(/.test(ALL.get(STORE) ?? ""));
  run("S1. own-row SELECT RLS on all five 520 tables, no write policy, no experience_code default", checkRls(MIG));
  run("S2. no verified, assessor, score, scope or deficiency column anywhere 520 adds one", checkColumns(MIG));
  run("S3. a self-assessment is self-reported by construction and append-only, with the cascade path", checkSelfReported(MIG));
  run("S4. an evidence link names exactly one record by composite key, is unlinked once, never rewritten or deleted, and an AI link keeps its provenance", checkLinks(MIG));
  run("S5. an entry is catalogue-backed or personal, never both; its history is the trigger's alone", checkEntries(MIG, ALL));
  run("F1. a self-assessment is never judged by its evidence: neither the parser nor the route reads evidence", checkSelfNeverJudged(ALL, parseSelfAssessment));
  run("F2. expected, self-assessed, evidence and verified are four separate panels; self-reported travels with every self-assessment", checkFourPanels(ALL));
  run("V1. no Stage 5 file writes a verification, assessor or decision; C5 is handed catalogue entries and never a reflection", checkC5Boundary(ALL));
  run("P1. reflections are never on a Passport link and never sent to AI", checkPrivacy(ALL));
  run("A1. AI is gated through the one Professional helper, saves nothing, and a link from it needs the person's click and keeps its provenance", checkAi(ALL));
  run("L1. only offered competencies; content not clinically approved is labelled wherever it is shown", checkCatalogues(ALL, parseEntry));
  run("M1. production without 520: the record loader selects no 520 column and evidence is saved without it", checkWithout520(ALL));
  run("H1. no profession, country, assessment method or scale hard-coded in the Stage 5 code", checkNoHardcoding(ALL));

  console.log("\n  planted-failure controls (in memory, nothing on disk changes):");
  const red = (name: string, r: R) => ok(`X. ${name} goes RED`, !r.ok, r.detail);
  const plant = (f: string, from: string | RegExp, to: string) => { const m = new Map(ALL); m.set(f, (m.get(f) ?? "").replace(from, to)); return m; };
  const add = (f: string, code: string) => { const m = new Map(ALL); m.set(f, `${m.get(f) ?? ""}\n${code}`); return m; };
  red("S1 on a write policy", checkRls(MIG + "\ncreate policy p on individual_professional_self_assessment for insert with check (true)"));
  red("S2 on a verified column", checkColumns(MIG.replace("  development_interest boolean not null default false,", "  development_interest boolean not null default false,\n  verified_level text,")));
  red("S3 on a self-assessment that may claim verification", checkSelfReported(MIG.replace("  basis = 'self_reported'\n", "  basis in ('self_reported', 'verified')\n")));
  red("S4 on a single-column CPD link", checkLinks(MIG.replace("foreign key (cpd_id, user_id) references", "foreign key (cpd_id) references")));
  red("S4 on a link that may be rewritten", checkLinks(MIG.replace("and (to_jsonb(new) - 'unlinked_at') = (to_jsonb(old) - 'unlinked_at') then", "then")));
  red("S5 on code writing the history", checkEntries(MIG, add(STORE, `admin.from("individual_professional_my_competency_history").insert({})`)));
  red("F1 on a self-assessment lowered for want of evidence", checkSelfNeverJudged(plant(FORM, "  const level = ctx.levels.find(l => l.id === b.levelId);", "  const level = ctx.levels.find(l => l.id === b.levelId && (b as any).links);"), parseSelfAssessment));
  red("F1 on a route that reads evidence before saving", checkSelfNeverJudged(add(R_SELF, `await ctx.admin.from("individual_professional_competency_evidence").select("id");`), parseSelfAssessment));
  red("F2 on a merged panel", checkFourPanels(plant(WORKSPACE, "ASPECT_TEXT.verified", "ASPECT_TEXT.evidence")));
  red("V1 on Professional writing a decision", checkC5Boundary(add(STORE, `admin.from("competency_verification_decision").insert({})`)));
  red("V1 on a reflection handed to C5", checkC5Boundary(plant(STORE, "    if (!SHAREABLE_KINDS.includes(kind)) continue;\n", "")));
  red("P1 on a shared self-assessment carrying its reflection", checkPrivacy(plant(SHARE, `.select("my_competency_id, learning_outcome, scale_label, level_label, assessed_at")`, `.select("my_competency_id, learning_outcome, scale_label, level_label, reflection, assessed_at")`)));
  red("P1 on AI seeing every record", checkPrivacy(plant(R_AI, ".items.filter(i => i.shareable)", ".items")));
  red("A1 on an ungated AI route", checkAi(plant(R_AI, `if (policy.ai !== "on") return refuse(`, `if (policy.ai === "never") return refuse(`)));
  red("A1 on a route that saves a suggestion", checkAi(add(R_AI, `await ctx.admin.from("individual_professional_competency_evidence").insert({});`)));
  red("A1 on suggestions added without a click", checkAi(add(ASSIST, "useEffect(() => { void 0; }, []);")));
  red("L1 on unapproved content shown unlabelled", checkCatalogues(plant(WORKSPACE, `contentStatus === "approved" ? null`, `true ? null`), parseEntry));
  red("M1 on the record loader selecting a 520 column", checkWithout520(plant(LIB + "record.ts", 'EVIDENCE_COLUMNS = "id, kind,', 'EVIDENCE_COLUMNS = "id, evidence_type_label, kind,')));
  red("H1 on a hard-coded assessment method", checkNoHardcoding(add(VOCAB, `export const METHOD = "OSCE";`)));

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
