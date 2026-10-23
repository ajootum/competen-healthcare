/**
 * SCHOLAR LEARNING HARNESS -- the COMPETEN-IND-004 invariants, checked from source and from migration 372.
 *
 *   npx --yes tsx scripts/scholar-learning-harness.ts
 *
 * ⚠ WHAT THIS IS. No database, so it runs before 372 is applied and in CI. It checks the rules a reviewer
 * would otherwise have to remember about the Scholar learning journey:
 *
 *   A  ownership     every Scholar query is keyed on the caller's own user_id, and the upload path is
 *                    built on the server from that id
 *   B  separation    no Scholar file touches the estate learning tables (owner ruling D1), and none reads
 *                    shared clinical content, which has no clinical-review record yet
 *   C  AI gateway    every AI call is generate() with person attribution, behind consent, quota and
 *                    configuration, and audited under an action the quota counts
 *   D  grounding     only checked output is shown or stored, with chunk, model and prompt version
 *   E  honesty       the AI label and the self-directed label are on the surfaces that need them, and
 *                    the correct answer does not reach the browser before the person answers
 *   F  schema        372: RLS on every table with own-row select only, composite ownership keys, the
 *                    attestation NOT NULL, a private bucket whose limits match the code
 *   G  erasure       the owner can delete one material or all of it, objects included
 *
 * ⚠ EVERY KEY CHECK CARRIES A PLANTED-FAILURE CONTROL (section P). The check is run again against a copy
 * of the source with the violation planted, and must FAIL there. A check that cannot fail is worth
 * nothing (CLAUDE.md, Testing), and this repository has recorded vacuous harnesses before.
 *
 * ⚠ IT READS STRIPPED SOURCE, for the reason scripts/individual-foundation-harness.ts gives: these files
 * explain at length the very calls they must not make.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, BUCKET, AI_LABEL, SELF_DIRECTED_LABEL } from "../src/lib/individual/scholar/config";
import { EXPERIENCES } from "../src/lib/individual/experiences";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const posix = (p: string) => p.replace(/\\/g, "/");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(posix(p));
  }
  return out;
}
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const LIB = "src/lib/individual/scholar";
const PAGES = "src/app/individual/(app)/[experience]/(scholar)/study";
const API = "src/app/api/individual/scholar";
const FILES = [...walk(LIB), ...walk(PAGES), ...walk(API)];
type Src = Map<string, string>;
const REAL: Src = new Map(FILES.map(f => [f, strip(readFileSync(f, "utf8"))]));
const MIG_FILE = "supabase/migrations/372-individual-scholar-learning.sql";
const MIG_REAL = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase() : "";

const STORE = `${LIB}/store.ts`;
const GEN = `${LIB}/generation.ts`;
const HTTP = `${LIB}/http.ts`;
const CLIENT = `${PAGES}/_components/client.tsx`;
const SCHOLAR_PAGE = `${PAGES}/_components/question-view.ts`;
const ROUTES = FILES.filter(f => f.startsWith(API) && f.endsWith("route.ts"));
const PAGE_FILES = FILES.filter(f => f.startsWith(PAGES) && f.endsWith("page.tsx"));

// ── THE CHECKS, AS FUNCTIONS OF THE SOURCE, SO SECTION P CAN RUN THEM ON A PLANTED COPY ─────────────

/** A1: every individual_scholar_* statement in the store names the caller's own user_id. */
function unkeyedStatements(src: Src): string[] {
  const s = src.get(STORE) ?? "";
  const bad: string[] = [];
  const re = /admin\.from\("(individual_scholar_[a-z_]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const rest = s.slice(m.index + m[0].length);
    const next = rest.search(/admin\.from\(|;\s*$/m);
    const stmt = rest.slice(0, next < 0 ? undefined : next);
    if (!/\.eq\("user_id", userId\)/.test(stmt) && !/user_id: userId/.test(stmt)) bad.push(`${m[1]}@${m.index}`);
  }
  return bad;
}
const storeStatementCount = (src: Src) => [...(src.get(STORE) ?? "").matchAll(/admin\.from\("individual_scholar_/g)].length;

/** A2: the upload is processed at a path the server builds from the caller's id, never one from the body. */
const uploadPathServerBuilt = (src: Src) => {
  const s = src.get(`${API}/materials/route.ts`) ?? "";
  return /uploadPath\(ctx\.userId, uploadId, declared\)/.test(s) && !/body\??\.path/.test(s);
};

const ESTATE = /from\("(quiz_attempts|knowledge_attempts|cpd_logs|course_enrollments|learning_enrolments|cdp_reinforcement_cards|skill_log_entries|questions|question_banks)"\)/;
const estateOffenders = (src: Src) => [...src].filter(([, s]) => ESTATE.test(s)).map(([f]) => f);
const clinicalOffenders = (src: Src) => [...src].filter(([, s]) => /from\("(clinical_cases|osce_[a-z_]+)"\)/.test(s)).map(([f]) => f);

/** C1: every generate() call carries person attribution, and no Scholar file reaches a vendor SDK. */
const generateUnattributed = (src: Src) => {
  const g = src.get(GEN) ?? "";
  const calls = [...g.matchAll(/await generate\(\{/g)].length;
  const attributed = [...g.matchAll(/attribution: \{ scope: "person" \}/g)].length;
  return calls === 0 || calls !== attributed;
};
const vendorImports = (src: Src) => [...src].filter(([, s]) => /from "(@anthropic-ai\/sdk|openai|@google\/genai)"/.test(s)).map(([f]) => f);
const generateOutsideGen = (src: Src) => [...src].filter(([f, s]) => f !== GEN && /\bgenerate\(\{/.test(s)).map(([f]) => f);

/** C2: each AI route runs aiPreflight (consent, quota, configuration) BEFORE the AI call. */
function preflightOrder(src: Src): string[] {
  const bad: string[] = [];
  for (const [file, call] of [[`${API}/explain/route.ts`, "runExplain("], [`${API}/questions/route.ts`, "runQuestions("]] as const) {
    const s = src.get(file) ?? "";
    const p = s.indexOf("await aiPreflight(ctx)"), c = s.indexOf(call);
    if (p < 0 || c < 0 || p > c) bad.push(file);
  }
  return bad;
}
const preflightChecksConsentFirst = (src: Src) => {
  const s = src.get(HTTP) ?? "";
  const consent = s.indexOf("readConsent("), quota = s.indexOf("checkAiQuota(");
  return consent >= 0 && quota > consent && /if \(!consent\.data\.granted\)/.test(s) && /if \(!consent\.ok\)/.test(s);
};

/** C3: every route handler is behind gate 3 for the SCHOLAR experience. */
function unguardedHandlers(src: Src): string[] {
  const bad: string[] = [];
  for (const f of ROUTES) {
    const s = src.get(f) ?? "";
    const handlers = [...s.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
    const guards = [...s.matchAll(/requireIndividualContext\("scholar"\)/g)].length;
    if (handlers === 0 || guards < handlers) bad.push(f);
  }
  return bad;
}

/** D: only checked output is shown or stored. */
const onlyCheckedQuestionsStored = (src: Src) => /drafts: r\.check\.kept/.test(src.get(`${API}/questions/route.ts`) ?? "");
const explanationChecked = (src: Src) => {
  const g = src.get(GEN) ?? "", r = src.get(`${API}/explain/route.ts`) ?? "";
  return /check: checkExplanation\(r\.text/.test(g) && /groundingViolations\(prose/.test(g)
    && /if \(!r\.check\.ok\)/.test(r) && /answer: r\.check\.text/.test(r) && !/answer: r\.text/.test(r);
};
const explanationNotStored = (src: Src) => {
  const r = src.get(`${API}/explain/route.ts`) ?? "";
  return !/\.(insert|upsert|update)\(/.test(r.replace(/from\("audit_log"\)\.insert/g, "")) && !/insertQuestions|recordAttempt/.test(r);
};
const provenanceStored = (src: Src) => {
  const s = src.get(STORE) ?? "";
  return /chunk_id: input\.passage\.chunkId/.test(s) && /model: input\.model/.test(s) && /prompt_version: input\.promptVersion/.test(s)
    && /source_quote: d\.sourceQuote/.test(s);
};

/** Owner review P0.1: the quality layer and the blind check both stand between generation and storage. */
const qualityWired = (src: Src) => {
  const g = src.get(GEN) ?? "";
  const q = src.get(`${LIB}/question-quality.ts`) ?? "";
  return /const problems = qualityProblems\(draft, passage\.content\);/.test(g) && /if \(problems\.length\)/.test(g)
    && /const outcome = applyVerification\(check\.kept, v\.text\);/.test(g) && /kept = outcome\.kept;/.test(g)
    && /unsupportedTerms\(o, passage\)/.test(q) && /supported\.length === 1 && supported\[0\] === d\.correctIndex/.test(q)
    && onlyCheckedQuestionsStored(src);
};
/** Owner review P0.2: the source-derived notice, where answers are read. */
const sourceNoticeCount = (src: Src) => [...(src.get(CLIENT) ?? "").matchAll(/<SourceNotice\b/g)].length;
/** Owner review P0.3: "mastery" on any Scholar screen. The SM-2 engine's stored state value "mastered" is allowed. */
const masteryWords = (src: Src) => [...src].filter(([f]) => f.startsWith(PAGES) || f === CLIENT)
  .filter(([, s]) => /master(y|ed)/i.test(s.replace(/["']mastered["']/g, ""))).map(([f]) => f);

/** E: labels, and no answer key in the browser before answering. */
const answerKeyLeaks = (src: Src) => {
  const s = src.get(SCHOLAR_PAGE) ?? "";
  const at = s.indexOf("export function questionView");
  const body = at < 0 ? "" : s.slice(at);
  return body.length < 50 || /correctIndex|rationale|sourceQuote/.test(body);
};

/** F: the schema. */
const SCHOLAR_TABLES = ["consent", "material", "chunk", "question", "attempt", "card"].map(t => `individual_scholar_${t}`);
const tablesWithoutRls = (mig: string) => SCHOLAR_TABLES.filter(t =>
  !mig.includes(`alter table ${t} enable row level security`) || !new RegExp(`create policy ${t}_read_own on ${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(mig));
const writePolicies = (mig: string) => /for (insert|update|delete|all)\b/.test(mig);

function main() {
  console.log("SCHOLAR LEARNING HARNESS (COMPETEN-IND-004)\n");

  // ── 0. CONTROLS ─────────────────────────────────────────────────────────────────────────────────
  ok("0a. the Scholar source was found (store, generation, routes, pages, migration 372)",
    [STORE, GEN, HTTP, CLIENT, SCHOLAR_PAGE].every(f => REAL.has(f)) && ROUTES.length >= 8 && PAGE_FILES.length >= 5,
    `routes=${ROUTES.length} pages=${PAGE_FILES.length}`);
  ok("0b. ⚠ the strip did not empty the store -- its statements are counted", storeStatementCount(REAL) >= 25, String(storeStatementCount(REAL)));
  ok("0c. ⚠ and it does remove comments -- the store's own warning about estate tables is gone",
    !/quiz_attempts/.test(REAL.get(STORE) ?? "x quiz_attempts") && /quiz_attempts/.test(readFileSync(STORE, "utf8")));

  // ── A. OWNERSHIP ────────────────────────────────────────────────────────────────────────────────
  ok("A1. every individual_scholar_* statement in the store is keyed on the caller's own user_id", unkeyedStatements(REAL).length === 0, unkeyedStatements(REAL).join(", "));
  ok("A2. the upload is processed at a path built on the server from the caller's id, never one from the request", uploadPathServerBuilt(REAL));
  ok("A3. no Scholar route takes a user id from the request body",
    !ROUTES.some(f => /body\??\.(userId|user_id|ownerId)/.test(REAL.get(f) ?? "")));
  ok("A4. the store is the only Scholar write site (the foundation harness 2a allows it, and only it)",
    FILES.filter(f => f !== STORE && /from\("individual_scholar_[a-z_]+"\)/.test(REAL.get(f) ?? "")).length === 0);

  // ── B. SEPARATION ───────────────────────────────────────────────────────────────────────────────
  ok("B1. D1: no Scholar file touches an estate learning table", estateOffenders(REAL).length === 0, estateOffenders(REAL).join(", "));
  ok("B2. no Scholar file reads shared clinical content (no clinical-review record exists)", clinicalOffenders(REAL).length === 0, clinicalOffenders(REAL).join(", "));
  ok("B3. Apply shows the governed state for reviewed clinical cases, in a section apart from the person's own scenarios",
    /Clinically reviewed cases/.test(REAL.get(`${PAGES}/apply/page.tsx`) ?? "") && /Not available yet/.test(REAL.get(`${PAGES}/apply/page.tsx`) ?? "")
    && /Your practice scenarios/.test(REAL.get(`${PAGES}/apply/page.tsx`) ?? ""));
  ok("B4. SM-2 is imported from the estate engine, not copied",
    /import \{ sm2 \} from "@\/lib\/delivery\/reinforcement"/.test(REAL.get(STORE) ?? "") && !FILES.some(f => /function sm2\b/.test(REAL.get(f) ?? "")));

  // ── C. THE AI GATEWAY ───────────────────────────────────────────────────────────────────────────
  ok("C1. every generate() call carries attribution { scope: \"person\" }", !generateUnattributed(REAL));
  ok("C2. only generation.ts calls generate(), and no Scholar file imports a vendor SDK",
    generateOutsideGen(REAL).length === 0 && vendorImports(REAL).length === 0, [...generateOutsideGen(REAL), ...vendorImports(REAL)].join(", "));
  ok("C3. every AI route runs the preflight (consent, quota, configuration) BEFORE the AI call", preflightOrder(REAL).length === 0, preflightOrder(REAL).join(", "));
  ok("C4. the preflight checks consent first, and an unreadable consent is a refusal", preflightChecksConsentFirst(REAL));
  const quota = strip(readFileSync("src/lib/ai/quota.ts", "utf8"));
  ok("C5. Scholar AI calls are audited under an action the hourly quota counts",
    /SCHOLAR_AI_AUDIT_ACTION = "ai_assistant_query"/.test(REAL.get(HTTP) ?? "") && /"ai_assistant_query"/.test(quota)
    && [`${API}/explain/route.ts`, `${API}/questions/route.ts`].every(f => /audit\(ctx, SCHOLAR_AI_AUDIT_ACTION/.test(REAL.get(f) ?? "")));
  ok("C6. every Scholar route handler is behind requireIndividualContext(\"scholar\")", unguardedHandlers(REAL).length === 0, unguardedHandlers(REAL).join(", "));
  // The release gate, gate 3, live, D2 terms and the registry check all live in the foundation's
  // experienceModulePage. The foundation harness (7d, 7e) pins what that helper does.
  ok("C7. every My Learning page takes its context from experienceModulePage(..., \"study\"), and only Scholar lists study",
    PAGE_FILES.every(f => /await experienceModulePage\([^,]+, "study"\)/.test(REAL.get(f) ?? ""))
    && !PAGE_FILES.some(f => /requireIndividualContext|resolveIndividualShell|createAdminClient/.test(REAL.get(f) ?? ""))
    && EXPERIENCES.scholar.modules.some(m => m.segment === "study") && !EXPERIENCES.professional.modules.some(m => m.segment === "study"));

  // ── D. GROUNDING AND PROVENANCE ─────────────────────────────────────────────────────────────────
  ok("D1. only questions that passed the checks are stored", onlyCheckedQuestionsStored(REAL));
  ok("D2. an explanation is shown only after the grounding check, and the raw model text never is", explanationChecked(REAL));
  ok("D3. D10: explanations are not stored -- the explain route writes nothing but its audit row", explanationNotStored(REAL));
  ok("D4. every stored question records its chunk, quoted source, model and prompt version", provenanceStored(REAL));
  ok("D5. the grounding check is the Practice verifyGrounded, not a new one",
    /import \{ verifyGrounded, type PhrasingViolation \} from "@\/lib\/practice\/document-phrasing"/.test(REAL.get(GEN) ?? ""));
  ok("D6. no passage found means no AI call (explain answers 'not in your notes' first)",
    (() => { const s = REAL.get(`${API}/explain/route.ts`) ?? ""; const nf = s.indexOf("notInNotes: true"); return nf >= 0 && nf < s.indexOf("aiPreflight(ctx)"); })());

  // ── E. HONESTY ON THE SCREEN ────────────────────────────────────────────────────────────────────
  ok("E1. the AI label is the configured one, and the client shows it on explanations and questions",
    AI_LABEL === "AI-generated from your notes, not clinically reviewed"
    && /<AiBadge \/>/.test(REAL.get(CLIENT) ?? "") && /\{AI_LABEL\} ·/.test(REAL.get(CLIENT) ?? ""));
  ok("E2. Progress carries the self-directed label, and says nothing is verified",
    /verified/i.test(SELF_DIRECTED_LABEL) && /\{SELF_DIRECTED_LABEL\}/.test(REAL.get(`${PAGES}/progress/page.tsx`) ?? ""));
  ok("E3. the correct answer, rationale and source are not sent to the browser before the person answers", !answerKeyLeaks(REAL));
  ok("E4. upload shows the patient-data warning and requires the attestation, and the server re-checks it",
    /\{PII_WARNING\}/.test(REAL.get(CLIENT) ?? "") && /piiAttested !== true/.test(REAL.get(`${API}/uploads/route.ts`) ?? "")
    && /piiAttested !== true/.test(REAL.get(`${API}/materials/route.ts`) ?? ""));
  ok("E5. the server runs the patient-identifier check before anything is stored",
    (() => { const s = REAL.get(`${API}/materials/route.ts`) ?? ""; const c = s.indexOf("findPatientIdentifiers("); return c >= 0 && c < s.indexOf("createMaterial("); })());

  // A server page can render a client component, but it cannot CALL a plain function exported from a
  // "use client" module -- Next throws at request time (found on staging: Revise called sourceHref).
  const clientCalls = (src: Src) => PAGE_FILES.flatMap(f => [...(src.get(f) ?? "").matchAll(/import \{([^}]*)\} from "[./]*_components\/client"/g)]
    .flatMap(m => m[1].split(",").map(s => s.trim()).filter(n => n && !/^type\s/.test(n) && !/^[A-Z]/.test(n)).map(n => `${f}: ${n}`)));
  ok("E6. server pages import only components and types from the \"use client\" module, never a function to call",
    clientCalls(REAL).length === 0, clientCalls(REAL).join(", "));

  // ── R. OWNER REVIEW P0 (2026-10-23) ────────────────────────────────────────────────────────────
  ok("R1. P0.1: every generated question passes the deterministic quality layer AND a blind verification before it can be stored",
    qualityWired(REAL));
  ok("R2. P0.2: the source-derived notice is shown with explanations, answer feedback and revision answers, and marking says 'against your notes'",
    sourceNoticeCount(REAL) >= 3 && /\{MARKED_AGAINST_NOTES\}/.test(REAL.get(CLIENT) ?? ""));
  ok("R3. P0.3: no Scholar screen calls practice accuracy 'mastery'", masteryWords(REAL).length === 0, masteryWords(REAL).join(", "));
  ok("R4. P0.4: the AI prompts carry only passages and the question -- no name, email or other profile data",
    !/profile|fullName|email|full_name/.test(REAL.get(GEN) ?? "x") && !/profile|fullName|email|full_name/.test(REAL.get(`${LIB}/question-quality.ts`) ?? "x"));
  ok("R5. P0.5: a personal practice case is labelled as such on its card",
    /q\.kind === "case" && \(/.test(REAL.get(CLIENT) ?? "") && /\{PERSONAL_CASE_LABEL\}/.test(REAL.get(CLIENT) ?? ""));

  // ── F. MIGRATION 372 ────────────────────────────────────────────────────────────────────────────
  // ⚠ 372 IS COMMITTED ONLY ONCE THE OWNER HAS APPLIED IT (CLAUDE.md, Database), so a checkout may not
  // have it yet. Then F1-F7, G3 and P10 are NOT RUN and the harness says so on every run -- it does not
  // count them as passed. With the file present (this worktree, and every checkout after it lands) they run.
  if (!MIG_REAL) console.log(`  NOTE  ${MIG_FILE} is not in this checkout -- schema checks F1-F7, G3 and P10 NOT RUN`);
  if (MIG_REAL) {
  ok("F1. D6: RLS on every Scholar table, each with an own-row select policy", tablesWithoutRls(MIG_REAL).length === 0, tablesWithoutRls(MIG_REAL).join(", "));
  ok("F2. D6: no insert, update, delete or all policy -- writes are service-role only", !writePolicies(MIG_REAL));
  ok("F3. ownership is in the schema: composite (id, user_id) foreign keys on every child table",
    ["chunk_material_fk", "question_material_fk", "question_chunk_fk", "attempt_question_fk", "card_question_fk", "card_material_fk"]
      .every(k => MIG_REAL.includes(`individual_scholar_${k} foreign key`)));
  ok("F4. a material cannot be stored without the patient-data attestation", /pii_attested_at timestamptz not null/.test(MIG_REAL));
  ok("F5. the bucket is private and its size and type limits match the code",
    MIG_REAL.includes(`'${BUCKET}', '${BUCKET}', false, ${MAX_UPLOAD_BYTES}`) && ALLOWED_MIME.every(m => MIG_REAL.includes(`'${m}'`))
    && MIG_REAL.includes(`byte_size <= ${MAX_UPLOAD_BYTES}`));
  // String literals out first: the table comments NAME the estate tables in order to say they are not used.
  const migDdl = MIG_REAL.replace(/'(?:[^']|'')*'/g, "''");
  ok("F6. 372 creates no function and touches no estate table", !/create (or replace )?function|plpgsql|\$\$/.test(migDdl)
    && !/\b(quiz_attempts|knowledge_attempts|cdp_reinforcement_cards|cpd_logs|clinical_cases)\b/.test(migDdl)
    && /\bquiz_attempts\b/.test(MIG_REAL));
  ok("F7. 372 is independent of 370 and 373 (no individual_membership or individual_entitlement reference)",
    !/individual_membership|individual_entitlement|individual_live_entitlement/.test(MIG_REAL));
  }

  // ── G. ERASURE ──────────────────────────────────────────────────────────────────────────────────
  const store = REAL.get(STORE) ?? "";
  ok("G1. deleting a material removes its stored object before its row (which cascades)",
    (() => { const b = store.slice(store.indexOf("export async function deleteMaterial"), store.indexOf("export async function eraseAllMaterial"));
      const rm = b.indexOf(".remove("), del = b.indexOf(".delete()"); return rm >= 0 && del > rm; })());
  ok("G2. erasing everything also removes objects never processed (it lists the owner's folder)",
    /storage\.from\(BUCKET\)\.list\(userId/.test(store) && /export async function eraseAllMaterial/.test(store));
  if (MIG_REAL) ok("G3. every child table cascades from its material", (MIG_REAL.match(/references individual_scholar_material\(id, user_id\) on delete cascade/g) ?? []).length === 3);

  // ── P. PLANTED-FAILURE CONTROLS ── each key check, run on a copy with the violation planted ──────
  const plant = (file: string, from: RegExp | string, to: string): Src => {
    const copy = new Map(REAL);
    const before = copy.get(file) ?? "";
    const after = before.replace(from, to);
    if (after === before) throw new Error(`plant did not apply in ${file}: ${String(from)}`);
    copy.set(file, after);
    return copy;
  };
  ok("P1. ⚠ A1 goes red when one store query loses its user_id filter",
    unkeyedStatements(plant(STORE, '.from("individual_scholar_chunk").select("id, ordinal, page_from, page_to, content")\n    .eq("user_id", userId)', '.from("individual_scholar_chunk").select("id, ordinal, page_from, page_to, content")\n    ')).length > 0);
  ok("P2. ⚠ A2 goes red when processing trusts a path from the request body",
    !uploadPathServerBuilt(plant(`${API}/materials/route.ts`, "uploadPath(ctx.userId, uploadId, declared)", "body.path")));
  ok("P3. ⚠ B1 goes red when a Scholar file writes quiz_attempts",
    estateOffenders(plant(STORE, 'admin.from("individual_scholar_attempt")', 'admin.from("quiz_attempts")')).length > 0);
  ok("P4. ⚠ B2 goes red when Apply reads clinical_cases",
    clinicalOffenders(plant(`${PAGES}/apply/page.tsx`, "listQuestions(ctx.admin", 'ctx.admin.from("clinical_cases").select("*"), listQuestions(ctx.admin')).length > 0);
  ok("P5. ⚠ C1 goes red when a generate() call drops its attribution",
    generateUnattributed(plant(GEN, 'attribution: { scope: "person" }, operation: "individual_scholar_explain"', 'operation: "individual_scholar_explain"')));
  ok("P6. ⚠ C3 goes red when the AI call moves above the consent preflight",
    preflightOrder(plant(`${API}/explain/route.ts`, "const pre = await aiPreflight(ctx);", "await runExplain(ctx.userId, question, passages); const pre = await aiPreflight(ctx);")).length > 0);
  ok("P7. ⚠ C6 goes red when a route guards a different experience",
    unguardedHandlers(plant(`${API}/erase/route.ts`, 'requireIndividualContext("scholar")', "requireIndividualContext()")).length > 0);
  ok("P8. ⚠ D1 goes red when the questions route stores unchecked drafts",
    !onlyCheckedQuestionsStored(plant(`${API}/questions/route.ts`, "drafts: r.check.kept", "drafts: r.raw")));
  ok("P9. ⚠ E3 goes red when the answer key is sent with the question",
    answerKeyLeaks(plant(SCHOLAR_PAGE, "model: q.model,", "model: q.model, correctIndex: q.correctIndex,")));
  if (MIG_REAL) ok("P10. ⚠ F1/F2 go red on a missing policy or an added write policy",
    tablesWithoutRls(MIG_REAL.replace("alter table individual_scholar_card enable row level security", "")).length === 1
    && writePolicies(`${MIG_REAL}\ncreate policy x on individual_scholar_card for insert with check (true)`));
  ok("P11. ⚠ R1 goes red when checkQuestions stops applying the quality layer",
    !qualityWired(plant(GEN, "const problems = qualityProblems(draft, passage.content);", "const problems: { reason: string; detail?: string }[] = [];")));
  ok("P12. ⚠ R1 goes red when the blind verification is skipped",
    !qualityWired(plant(GEN, "const outcome = applyVerification(check.kept, v.text);", "const outcome = { kept: check.kept, rejected: [] };")));
  ok("P13. ⚠ R3 goes red when a screen says mastery again",
    masteryWords(plant(`${PAGES}/progress/page.tsx`, "% practice accuracy`", "% mastery`")).length > 0);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
