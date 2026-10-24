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
 *   K  competencies  COMPETEN-SCHOLAR-01 (387, 388): the catalogue only through its interface, shared and
 *                    published; proposals the model cannot point outside; an append-only correction trail;
 *                    background beyond the notes kept apart; case steps held to the question rules; the
 *                    MVP unchanged where 388 is absent; no profession in code
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
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, BUCKET, AI_LABEL, SELF_DIRECTED_LABEL, CONSENT_FEATURE, CONSENT_NOTICE, CONSENT_NOTICE_VERSION, UPLOAD_ATTESTATION } from "../src/lib/individual/scholar/config";
import { consentDocuments, consentStatus } from "../src/lib/individual/scholar/consent-gate";
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
// Line endings normalised: a Windows checkout (core.autocrlf) has CRLF, and the planted-failure controls match
// multi-line text. Without this the plants silently stop applying on Windows and the run aborts.
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const REAL: Src = new Map(FILES.map(f => [f, strip(read(f))]));
const MIG_FILE = "supabase/migrations/372-individual-scholar-learning.sql";
const MIG_REAL = existsSync(MIG_FILE) ? read(MIG_FILE).replace(/--.*$/gm, "").toLowerCase() : "";
// Migration 375 and the surfaces outside the Scholar tree that show what it holds (s11).
const MIG375_FILE = "supabase/migrations/375-individual-scholar-passport-selection.sql";
const MIG375 = existsSync(MIG375_FILE) ? read(MIG375_FILE).replace(/--.*$/gm, "").toLowerCase() : "";
const VERIFY = "src/app/verify/[token]/page.tsx";
const PASSPORT_PAGE = "src/app/individual/(app)/[experience]/passport/page.tsx";
const OUTSIDE: Src = new Map([VERIFY, PASSPORT_PAGE, "src/lib/individual/passport.ts"].map(f => [f, strip(read(f))]));

const STORE = `${LIB}/store.ts`;
const GEN = `${LIB}/generation.ts`;
const HTTP = `${LIB}/http.ts`;
const CLIENT = `${PAGES}/_components/client.tsx`;
const SCHOLAR_PAGE = `${PAGES}/_components/question-view.ts`;
const ROUTES = FILES.filter(f => f.startsWith(API) && f.endsWith("route.ts"));
const PAGE_FILES = FILES.filter(f => f.startsWith(PAGES) && f.endsWith("page.tsx"));

// ── THE CHECKS, AS FUNCTIONS OF THE SOURCE, SO SECTION P CAN RUN THEM ON A PLANTED COPY ─────────────

/**
 * A1: every individual_scholar_* statement in the store names the caller's own user_id.
 * COMPETEN-SCHOLAR-01 (migration 387): the two programme CONFIGURATION tables have no user_id -- they say which
 * frameworks a programme uses, for everyone -- so they are exempt here, and configOnlyRead holds them to reads.
 */
const CONFIG_TABLES = new Set(["individual_scholar_programme", "individual_scholar_programme_framework"]);
function storeStatements(src: Src): { table: string; at: number; stmt: string }[] {
  const s = src.get(STORE) ?? "";
  const out: { table: string; at: number; stmt: string }[] = [];
  const re = /admin\.from\("(individual_scholar_[a-z_]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const rest = s.slice(m.index + m[0].length);
    const next = rest.search(/admin\.from\(|;\s*$/m);
    out.push({ table: m[1], at: m.index, stmt: rest.slice(0, next < 0 ? undefined : next) });
  }
  return out;
}
function unkeyedStatements(src: Src): string[] {
  return storeStatements(src).filter(x => !CONFIG_TABLES.has(x.table))
    .filter(x => !/\.eq\("user_id", userId\)/.test(x.stmt) && !/user_id: userId/.test(x.stmt)).map(x => `${x.table}@${x.at}`);
}
/** K1: the configuration tables are only ever read by Scholar code, and only active programmes are offered. */
const configWrites = (src: Src) => storeStatements(src).filter(x => CONFIG_TABLES.has(x.table) && /\.(insert|upsert|update|delete)\(/.test(x.stmt)).map(x => `${x.table}@${x.at}`);
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
  // The S2 analysis calls the Holdings mapping engine, which calls generate() with the context Scholar passes.
  // AI-FAIR-USE-01: the generators call through `run` (the metered runner, or generate() when none is given).
  const calls = [...g.matchAll(/await (generate|run)\(\{/g)].length + [...g.matchAll(/return proposeMappings\(\{/g)].length;
  const attributed = [...g.matchAll(/attribution: \{ scope: "person" \}/g)].length;
  return calls === 0 || calls !== attributed;
};
const vendorImports = (src: Src) => [...src].filter(([, s]) => /from "(@anthropic-ai\/sdk|openai|@google\/genai)"/.test(s)).map(([f]) => f);
const generateOutsideGen = (src: Src) => [...src].filter(([f, s]) => f !== GEN && /\bgenerate\(\{/.test(s)).map(([f]) => f);

/** C2: each AI route runs aiPreflight (consent, quota, configuration) BEFORE the AI call. */
function preflightOrder(src: Src): string[] {
  const bad: string[] = [];
  for (const [file, call] of [[`${API}/explain/route.ts`, "runExplain("], [`${API}/questions/route.ts`, "runQuestions("],
    [`${API}/materials/[id]/analyse/route.ts`, "runAnalysis("], [`${API}/cases/route.ts`, "runCase("],
    [`${API}/revision/sessions/route.ts`, "runRevisionQuestions("], [`${API}/revision/answer/route.ts`, "runEvaluate("]] as const) {
    const s = src.get(file) ?? "";
    const p = s.indexOf("await aiPreflight(ctx)"), c = s.indexOf(call);
    if (p < 0 || c < 0 || p > c) bad.push(file);
  }
  return bad;
}
const preflightChecksConsentFirst = (src: Src) => {
  const s = src.get(HTTP) ?? "";
  const consent = s.indexOf("readConsent("), quota = s.indexOf("checkAiQuota(");
  return consent >= 0 && quota > consent && /if \(status !== "on"\)/.test(s) && /if \(!consent\.ok\)/.test(s);
};

/**
 * Owner GO (2026-10-23), consent v3. AI help counts as on only through consentStatus, which needs the
 * CURRENT notice version and the Privacy Notice and Terms of Use published (consent-gate.ts).
 *   legalGateHeld: the preflight asks consentStatus with the published flag, and the consent route refuses a
 *                  grant while the documents are unpublished, before anything is saved.
 *   rawGrantReads: a page or route treating the stored `granted` flag as "on" by itself, which would let a
 *                  v2 grant, or a grant made before the documents were published, keep working.
 */
const legalGateHeld = (src: Src) => {
  const pre = src.get(HTTP) ?? "", route = src.get(`${API}/consent/route.ts`) ?? "";
  const refuse = route.indexOf("if (body.grant && !consentDocuments().published)"), save = route.indexOf("await setConsent(");
  return /consentStatus\(consent\.data, consentDocuments\(\)\.published\)/.test(pre) && refuse >= 0 && save > refuse;
};
const rawGrantReads = (src: Src) => [...src].filter(([f]) => f.startsWith(PAGES) || f.startsWith(API) || f === HTTP)
  .filter(([, s]) => /consent\.data\.granted\b/.test(s.replace(/recorded=\{consent\.data\.granted\}/g, ""))).map(([f]) => f);

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
  // COMPETEN-SCHOLAR-01 S3: the model text is split first (what lies beyond the notes comes off), and the
  // notes-based part is what checkExplanation sees and the route shows.
  return /const split = splitSupplementary\(r\.text\);/.test(g) && /check: checkExplanation\(split\.main, /.test(g) && /groundingViolations\(prose/.test(g)
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

/**
 * Owner consent GO (2026-10-23): contribution and AI-training permissions are SEPARATE and neither exists.
 * No Scholar code may share, submit, contribute or publish a person's material, or ask for or imply a training
 * permission. The notice text itself (config.ts) is the one place these words may appear.
 */
// Sharing constructs, not form submits (type="submit") or the word "published" in the legal-links UI.
const SHARING = /contribut|shared[_ -]?library|learning[_ -]?library|submit\w*(library|review|share)|publish\w*(material|library)|share\w*material|\btrain(ing)?\b|fine[_ -]?tun/i;
const sharingPaths = (src: Src) => [...src].filter(([f]) => f !== `${LIB}/config.ts`)
  .filter(([, s]) => SHARING.test(s)).map(([f]) => f);

/**
 * s11, owner continuation GO 2026-10-23 item 3: Scholar study achievements in the Passport (migration 375).
 *   studyReadsContent: the read that feeds the Passport and /verify selects only ids, kinds and dates --
 *                      never note text, a question, an option, the answer chosen, whether it was right, or
 *                      anything the AI wrote.
 *   verifyReadsLive:   /verify reads the person's choices on every view of a link that carries their own
 *                      records, so a removal reaches live links. Nothing caches it.
 *   includeChecksEarned: a choice is stored only after the store has counted an answer of that kind.
 */
const studyReadsContent = (src: Src) => {
  const s = src.get(STORE) ?? "";
  const body = s.slice(s.indexOf("export async function listPassportChoices"), s.indexOf("export function isUuid"));
  const selects = [...body.matchAll(/\.select\("([^"]*)"\)/g)].map(m => m[1]);
  return body.length < 100 || selects.length < 4 || selects.some(c => /content|stem|options|chosen|correct|rationale|source_quote|model|prompt|title/.test(c));
};
const verifyReadsLive = (out: Src) => {
  const v = out.get(VERIFY) ?? "";
  return /const study = carriesOwn \? await loadStudyAchievements\(admin, share\.nurse_id\) : null;/.test(v)
    && !/unstable_cache|"use cache"|revalidate\s*=/.test(v);
};
const includeChecksEarned = (src: Src) => {
  const s = src.get(STORE) ?? "";
  const body = s.slice(s.indexOf("export async function includeInPassport"), s.indexOf("export async function removeFromPassport"));
  const count = body.indexOf("await answeredFrom("), refuse = body.indexOf('if (answered < 1) return "not_eligible";'), write = body.indexOf(".upsert(");
  return count >= 0 && refuse > count && write > refuse;
};

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

// ── K. COMPETEN-SCHOLAR-01: COMPETENCY-DRIVEN LEARNING (migrations 387, 388) ─────────────────────────
const CAT = `${LIB}/catalogue.ts`;
// COMPETEN-HOLDINGS-SHARED-ENGINES-01: the mapping engine and the grounding verifier are Holdings code.
const ENGINE = "src/lib/competency/mapping.ts";
const GROUND = "src/lib/ai/grounding.ts";
const HOLD: Src = new Map([ENGINE, GROUND].map(f => [f, strip(read(f))]));
/**
 * K15: the engine is product-neutral and stores nothing -- no table read or written, no product or experience
 * named in its code, the AI call made with the caller's context -- and Scholar hands it person attribution,
 * its own operation and its patient-identifier screen.
 */
const engineNeutral = (h: Src, src: Src) => {
  const e = h.get(ENGINE) ?? "", g = src.get(GEN) ?? "";
  return e.length > 500 && !/\.from\(/.test(e) && !/individual|scholar|professional|practice_/i.test(e)
    && /context: args\.context,/.test(e) && /return proposeMappings\(\{[\s\S]*?context: \{ userId, attribution: \{ scope: "person" \}, operation: "individual_scholar_map" \},\s*screen: findPatientIdentifiers,/.test(g);
};
const migText = (f: string) => existsSync(f) ? read(f).replace(/--.*$/gm, "").toLowerCase() : "";
const MIG387_FILE = "supabase/migrations/387-individual-scholar-programme.sql";
const MIG388_FILE = "supabase/migrations/388-individual-scholar-competency-mapping.sql";
const MIG389_FILE = "supabase/migrations/389-individual-scholar-layers-align-s1.sql";
const MIG387 = migText(MIG387_FILE);
const MIG388 = migText(MIG388_FILE);
const MIG389 = migText(MIG389_FILE);
const MIG390_FILE = "supabase/migrations/390-individual-scholar-mapping-provenance.sql";
const MIG390 = migText(MIG390_FILE);
const MIG405 = migText("supabase/migrations/405-individual-scholar-plain-text-materials.sql");
const MIG406 = migText("supabase/migrations/406-individual-scholar-pptx-and-extraction-quality.sql");
const MIG414 = migText("supabase/migrations/414-individual-scholar-learning-history.sql");
const MIG415 = migText("supabase/migrations/415-individual-scholar-learning-artefacts.sql");
/**
 * K25 (AI-FAIR-USE-01 s8 and s7): an artefact can only be private formative (415's CHECK) and goes with its material;
 * the act route returns a saved artefact BEFORE any AI preflight, decides continuity BEFORE the AI call, saves only
 * reusable answers (never conversation), and Scholar reads the standing only through its one adapter.
 */
const artefactsBounded = (src: Src) => {
  const act = src.get(`${API}/learn/act/route.ts`) ?? "";
  const iFind = act.indexOf("await findArtefact("), iCont = act.indexOf("activityState(await getScholarAiStanding("), iPre = act.indexOf("const pre = await aiPreflight(ctx);"), iRun = act.indexOf("await runLearn(");
  return /review_status = 'private_formative'/.test(MIG415) && /references individual_scholar_material\(id, user_id\) on delete cascade/.test(MIG415)
    && iFind > 0 && iCont > iFind && iPre > iCont && iRun > iPre
    && /const storable = isArtefactAction\(action\) && !hasHistory && oneMaterial;/.test(act) && /if \(key\) savedNow = await saveArtefact\(/.test(act)
    && ![...src].some(([f, s]) => f !== `${LIB}/ai-standing.ts` && f !== `${LIB}/http.ts` && /@\/lib\/ai\/allowance/.test(s));
};
/**
 * K26 (AI-FAIR-USE-01 swap): every Scholar AI call goes through the Holdings allowance. Each AI route builds the
 * metered runner with its activity code and passes it to its generator, and returns the refusal before anything else;
 * the generators make no direct generate() call (only the default runner does); the runner sends only Scholar's
 * product, the activity, and a request id from the client's retry key -- never an amount, a policy or a level.
 * D1: each route passes the request's risk subject (scholarRisk), which the runner requires and sends on every call.
 */
const AI_ROUTES: [string, string, RegExp][] = [
  [`${API}/explain/route.ts`, `scholarAiRunner(ctx, req, mode === "tutor" ? "tutor_continue" : mode, await scholarRisk(ctx.admin, ctx.userId, { text: question, passages }))`, /runExplain\([^)]*ai\.run\)/],
  [`${API}/learn/act/route.ts`, `scholarAiRunner(ctx, req, action as LearnAction | "check" | "clarify", await scholarRisk(ctx.admin, ctx.userId, { text: prompt, passages }))`, /runLearn\([\s\S]*?\}, ai\.run\)/],
  [`${API}/questions/route.ts`, `scholarAiRunner(ctx, req, "questions", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }))`, /runQuestions\([^;]*ai\.run\)/],
  [`${API}/cases/route.ts`, `scholarAiRunner(ctx, req, "case_steps", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }))`, /runCase\([^)]*ai\.run\)/],
  [`${API}/materials/[id]/analyse/route.ts`, `scholarAiRunner(ctx, req, "map", await scholarRisk(ctx.admin, ctx.userId, { passages: next.data.map(s => ({ chunkId: s.ref, content: s.text })) }))`, /runAnalysis\([^)]*ai\.run\)/],
  // REVISION-01: a session's new questions (one id per call, `:g1` ...) and a short answer's AI evaluation.
  [`${API}/revision/sessions/route.ts`, "scholarAiRunner(ctx, req, \"questions\", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }), `g${i}`)", /runRevisionQuestions\(ctx\.userId, call\.kind, passage, Math\.max\(call\.count, 3\), ai\.run\)/],
  [`${API}/revision/answer/route.ts`, "scholarAiRunner(ctx, req, \"evaluate\", await scholarRisk(ctx.admin, ctx.userId, { text: `${q.stem}\\n${r.text}`, passages: [passage] }))", /runEvaluate\([^)]*ai\.run\)/],
];
/**
 * K30 (REVISION-01 R2/R4): ANSWERS STAY ON THE SERVER. A question goes to the browser before it is answered only as
 * revisionItemView -- learnerItem, which carries no key, rationale or source quote -- from every revision route and
 * page. The key is revealed only by feedbackView after an answer, or a flashcard's back on reveal.
 */
const REV = `${LIB}/revision.ts`, REV_VIEW = `${LIB}/revision-view.ts`;
const answersServerSide = (src: Src) => {
  const rev = src.get(REV) ?? "", view = src.get(REV_VIEW) ?? "";
  const learner = rev.slice(rev.indexOf("export function learnerItem"), rev.indexOf("export type Response ="));
  // The page's session view only: the review cards below it are the 372 self-review cards, revealed on request as before.
  const page = src.get(`${PAGES}/revise/page.tsx`) ?? "";
  const routes = [src.get(`${API}/revision/sessions/route.ts`) ?? "", src.get(`${API}/revision/sessions/[id]/route.ts`) ?? "",
    page.slice(page.indexOf("if (q.session) {"), page.indexOf("const [policy, materials, sets"))];
  return learner.length > 50 && learner.length < 3000 && !/rationale|sourceQuote|correctIndex/.test(learner)
    && /return \{ \.\.\.learnerItem\(q\), materialId: q\.materialId, materialTitle: q\.materialTitle, chunkId: q\.chunkId, citation: citationOf\(q\), label: REVISION_LABEL \};/.test(view)
    // Every list of items any of them sends is the learner view, none raw.
    && routes.every(s => /items: \S*\.map\(revisionItemView\)|items=\{questions\.map\(revisionItemView\)\}/.test(s)
      && !/\bitems: (?![A-Z]|\S*\.map\(revisionItemView\))/.test(s) && !/\bitems=\{(?!questions\.map\(revisionItemView\))/.test(s))
    && routes.every(s => !/sourceQuote|correctIndex|\.answer\b/.test(s.replace(/feedbackView\([^)]*\)/g, "")));
};
/**
 * K31 (REVISION-01 R4, s10): MARKING SAYS WHAT IT WAS. Every revision question is stored private_formative; code
 * marks every kind it can; a short answer that matches nothing is AI evaluation (with the evaluator recorded) or the
 * student's own judgement -- never marked wrong by default; and the label shown is MARKING_LABEL's for that marking.
 */
const markingHonest = (src: Src) => {
  const rev = src.get(REV) ?? "", store = src.get(STORE) ?? "", ans = src.get(`${API}/revision/answer/route.ts`) ?? "", view = src.get(REV_VIEW) ?? "";
  return /if \(k\.kind === "accepted" && r\.kind === "text"\) return markShortAnswer\(r\.text, k\.answers\) \? \{ correct: true, score: 1, marking: "deterministic" \} : \{ needsJudgement: true \};/.test(rev)
    && /return a && accepted\.some\(x => normaliseAnswer\(x\) === a\) \? true : null;/.test(rev)
    && /review_status: "private_formative"/.test(store) && /evaluator_model: a\.evaluator\?\.model \?\? null/.test(store)
    && /const marking = evaluator \? "ai_evaluation" as const : mark\.marking;/.test(ans)
    && /if \(!evaluator\) return NextResponse\.json\(\{ needsSelfGrade: true, accepted, reason: why, label: MARKING_LABEL\.self_graded \}\);/.test(ans)
    && /markingLabel: MARKING_LABEL\[m\.marking\]/.test(view);
};
/**
 * K32 (REVISION-01 R2, s8): REUSE FIRST, AND NO AI FOR WHAT IS STORED. A session is filled from saved questions before
 * anything is written; only a shortfall in a writing mode is generated, never a section and format already written at
 * this prompt version; a saved set replays with no AI call at all; policy can keep it to saved questions only.
 */
const reuseFirst = (src: Src) => {
  const s = src.get(`${API}/revision/sessions/route.ts`) ?? "", rev = src.get(REV) ?? "";
  const custom = s.slice(s.indexOf("if (mode === \"custom\") {"), s.indexOf("let chunkIds: string[] | null = null;"));
  const fill = s.indexOf("let pick = pickQuestions("), gen = s.indexOf("runRevisionQuestions(");
  return custom.length > 50 && custom.length < 4000 && !/scholarAiRunner|runQuestions|runRevisionQuestions|aiPreflight/.test(custom)
    && fill > -1 && gen > fill && /if \(pick\.shortfall > 0 && GENERATING_MODES\.includes\(mode\) && scopeSections\.length\)/.test(s)
    && /if \(policy\.scholarRevisionGeneration === "saved_only"\)/.test(s)
    && /const plan = planGeneration\(\{ shortfall: pick\.shortfall, chunkIds: scopeSections, formats: kinds, existing \}\);/.test(s)
    && /export const GENERATING_MODES: readonly RevisionMode\[\] = \["today", "quick", "mock", "flashcards"\];/.test(rev)
    && /const fresh = pairs\.filter\(p => !input\.existing\.has\(`\$\{p\.chunkId\}\|\$\{p\.kind\}`\)\);/.test(rev);
};
const meteredEverywhere = (src: Src) => {
  const gen = src.get(GEN) ?? "", http = src.get(`${LIB}/http.ts`) ?? "";
  return AI_ROUTES.every(([f, runner, call]) => { const s = src.get(f) ?? ""; return s.includes(runner) && call.test(s) && /ai\.refusal\(\)/.test(s); })
    && [...gen.matchAll(/\bgenerate\(/g)].length === 1 && /const direct: AiRun = g => generate\(g\);/.test(gen)
    && /runMeteredAi\(ctx\.admin, \{ userId: ctx\.userId, product: "scholar", activity, requestId: part === "main" \? requestId : `\$\{requestId\}:\$\{part\}`, generate: g, risk \}\)/.test(http)
    && /export function scholarAiRunner\(ctx: IndividualContext, req: Request, activity: ScholarAiActivity, risk: RiskContext, callKey\?: string\)/.test(http)
    && /text: \[input\.text \?\? "", \.\.\.input\.passages\.map\(p => p\.content\)\]/.test(http)
    && /export const scholarRequestId = \(ctx: IndividualContext, req: Request\) => requestIdFor\(ctx\.userId, req\.headers\.get\("x-request-id"\)\);/.test(http)
    && /const requestId = callKey \? `\$\{scholarRequestId\(ctx, req\)\}:\$\{callKey\}` : scholarRequestId\(ctx, req\);/.test(http);
};
/**
 * K29 (owner D3, coordinator conditions): Learn's "Continue with your personal assistant" is the ONE Holdings personal
 * AI (runIndividualAssistant, Scholar, Teach Me by default) given the step's own sections as study context. The
 * student's text is screened before anything else, consent and quota run before the call, and its answer is never a
 * Learn answer: it is not saved as an artefact or recorded as a learning event, makes no direct model call, and is
 * shown apart under PERSONAL_AI_LABEL. Ask Scholar stays the grounded Learn `ask` action.
 */
const ASSIST = `${API}/learn/assistant/route.ts`;
const assistantShared = (src: Src) => {
  const r = src.get(ASSIST) ?? "", client = src.get(`${PAGES}/_components/learn-client.tsx`) ?? "", act = src.get(`${API}/learn/act/route.ts`) ?? "";
  const screen = r.indexOf("findPatientIdentifiers(question)"), pre = r.indexOf("await aiPreflight(ctx)"), call = r.indexOf("await runIndividualAssistant(");
  return screen > -1 && pre > screen && call > pre
    && /experience: "scholar", mode, question,/.test(r) && /const mode = body\?\.mode === "ask" \? "ask" : "teach";/.test(r)
    && /const study = await scholarRisk\(ctx\.admin, ctx\.userId, \{ passages \}\);/.test(r) && /, study,\n/.test(r)
    && !/saveArtefact|recordLearningEvent|updateLearningSession|runMeteredAi|scholarAiRunner|generate\(/.test(r)
    && /label: PERSONAL_AI_LABEL/.test(r)
    && /\{PERSONAL_AI_LABEL\}/.test(client) && /setAssist\(/.test(client) && !/setCards\([^;]*assistant/.test(client)
    && !/runIndividualAssistant/.test(act);
};
/**
 * K27 (Stage 3 acceptance, items 3 and 5): the governed reference source is policy, read only through S1, and
 * "clinically approved" comes from ONE rule -- 395's approval of the current content, with the outcome shown part of
 * it. Every place that shows a reference (a new answer, a saved one in Learn, Saved learning) is labelled by that
 * rule as the source is now, and the shared rendering shows approval only on `approved === true`. An AI flag is
 * rendered by the one flag component, under its own heading, in Learn and in Saved learning.
 */
const KINDS = `${PAGES}/_components/learn-kinds.tsx`;
const SAVED = `${PAGES}/saved/page.tsx`;
const LEARN_CLIENT = `${PAGES}/_components/learn-client.tsx`;
const referencesGoverned = (src: Src) => {
  const learn = src.get(`${LIB}/learn.ts`) ?? "", cat = src.get(CAT) ?? "", act = src.get(`${API}/learn/act/route.ts`) ?? "";
  const kinds = src.get(KINDS) ?? "", saved = src.get(SAVED) ?? "", client = src.get(LEARN_CLIENT) ?? "", cfg = src.get(`${LIB}/config.ts`) ?? "";
  const status = learn.slice(learn.indexOf("export function referenceStatus"), learn.indexOf("export async function governedReferences"));
  return /const all = await loadIndividualCatalogue\(admin, ids\);/.test(cat) && /\.filter\(c => meetsMinStatus\(c\.contentStatus, min\)\)/.test(cat)
    && /if \(!policy\.scholarReferenceCollections\.length\) return \{ collections: false, catalogue: programme \};/.test(learn)
    && /\?\? \[\] \};/.test(learn.slice(learn.indexOf("export async function referenceSource")))
    && /if \(!c\) return \{ status: CONTENT_STATUS_LABEL\.unreviewed, approved: false \};/.test(status)
    && /if \(outcome !== null && !c\.outcomes\.includes\(outcome\)\) return \{ status: REFERENCE_CHANGED_LABEL, approved: false \};/.test(status)
    && /approved: c\.contentStatus === "approved" \}/.test(status) && (status.match(/approved: /g) ?? []).length === 4
    && /\.filter\(l => !source\.collections \|\| known\.has\(l\.competencyId\)\)/.test(learn)
    && (learn.match(/\.\.\.referenceStatus\(c, outcome\)/g) ?? []).length === 2
    && /const refSource = await referenceSource\(ctx\.admin, policy, learner\.competencies\);/.test(act)
    && /governedReferences\(ctx\.admin, ctx\.userId, passages\.map\(p => p\.chunkId\), refSource\)/.test(act)
    && /references: relabelReferences\(a\.refs, refSource\)/.test(act) && !/references: a\.refs/.test(act)
    && /<GovernedReferenceList refs=\{relabelReferences\(a\.refs, refSource\)\} \/>/.test(saved)
    && /\{x\.approved === true\s*\?/.test(kinds) && !/approved/.test(kinds.replace(/x\.approved === true|CONTENT_STATUS_LABEL\.approved|approved\?: boolean/g, ""))
    && /export const FLAG_HEADING = "Flagged by AI for you to check";/.test(cfg)
    && [client, saved].every(s => /<AiFlagList flags=\{/.test(s) && /<GovernedReferenceList refs=\{/.test(s) && !/SOURCE_KIND_LABEL\.(flag|reference)/.test(s));
};
/**
 * K28 (Stage 3 acceptance, item 4): an answer withheld as unsupported is said plainly, with next steps from the
 * notes only -- the nearest sections, a rephrase where Ask is offered, "this isn't in your notes", and the background
 * only where policy allows it and it passed its own checks. The withheld text itself is never sent.
 */
const withheldPlain = (src: Src) => {
  const act = src.get(`${API}/learn/act/route.ts`) ?? "", view = src.get(`${LIB}/learn-view.ts`) ?? "";
  const branch = act.slice(act.indexOf("if (!r.check.ok) {"), act.indexOf("const b = r.background;"));
  const fn = view.slice(view.indexOf("export function withheldNext"), view.indexOf("export function offeredActions"));
  return /const next = withheldNext\(\{ reason: r\.check\.reason, detail, sources, askOffered: policy\.scholarLearningActions\.includes\("ask"\), background: r\.background, backgroundAllowed: background \}\);/.test(branch)
    && /withheld: true, reason: r\.check\.reason, message: next\.why, notInNotes: next\.notInNotes, next \}/.test(branch)
    && !/answer:|r\.check\.text|split|r\.flags/.test(branch)
    && /background: input\.backgroundAllowed && b\?\.ok \? \{ text: b\.text, label: SUPPLEMENTARY_LABEL \} : null,/.test(fn)
    && /nearest: input\.sources\.slice\(0, WITHHELD_NEAREST_MAX\)\.map\(s => \(\{ tag: s\.tag, chunkId: s\.chunkId, materialId: s\.materialId, citation: s\.citation \}\)\)/.test(fn)
    && /export const NOT_IN_NOTES_LABEL = "This isn't in your notes\.";/.test(src.get(`${LIB}/config.ts`) ?? "");
};
/**
 * K24 (COMPETEN-SCHOLAR-LEARN-01): Stage 3's boundaries hold in the code.
 *   - 414 has no column that could hold conversation: no answer, question, content, text or note column anywhere.
 *   - An event row is structure only: the store inserts session, step, action and verdict -- nothing the AI said.
 *   - The act route refuses an action the policy has off (403), screens what the student typed for identifiers,
 *     records an event only for what was SHOWN and only when history is on, and never stores a practice question.
 *   - The student's context is never grounding: runLearn checks the notes part against the passages, the
 *     governed references and what the student typed -- the learner context is not in `asked`.
 */
const learnBounded = (src: Src) => {
  const act = src.get(`${API}/learn/act/route.ts`) ?? "", gen = src.get(GEN) ?? "", st = src.get(STORE) ?? "";
  const rec = st.slice(st.indexOf("export async function recordLearningEvent"), st.indexOf("export type LearningEventRow"));
  const run = gen.slice(gen.indexOf("export async function runLearn"), gen.indexOf("S2 framing for the Holdings mapping engine"));
  return MIG414.length > 0 && !/\b(answer|question|content|note|body|transcript|message)\b\s+text/.test(MIG414)
    && /\.insert\(\{ session_id: input\.sessionId, user_id: userId, step: input\.step, action: input\.action, verdict: input\.verdict \}\)/.test(rec)
    && /if \(isLearnAction\(action\) && !policy\.scholarLearningActions\.includes\(action\)\) return NextResponse\.json\(\{[^}]*\}, \{ status: 403 \}\)/.test(act)
    && /findPatientIdentifiers\(t\)/.test(act)
    && /if \(recorded && sessionId && shown && policy\.scholarLearningHistory === "record"\)/.test(act)
    && !/insertQuestions|individual_scholar_question/.test(act)
    && /const asked = \[args\.question, \.\.\.args\.history\.map\(t => t\.text\)\]\.join\("\\n"\);/.test(run) && !/asked[^;]*learnerContext/.test(run)
    && /attribution: \{ scope: "person" \}, operation: "individual_scholar_learn"/.test(run);
};
const MIG413 = migText("supabase/migrations/413-individual-scholar-upload-25mb.sql");
/**
 * K23 (upload limits, owner GO 2026-10-24): the 25 MB ceiling is 413's on BOTH the material CHECK and the bucket,
 * the policy's live value stays 10 MB until HQ raises it, and the upload session (files and combined size) is
 * enforced on the server at BOTH steps -- the slot (an early answer) and processing (the decision, on the bytes).
 */
const uploadLimitsHold = (src: Src) => {
  const up = src.get(`${API}/uploads/route.ts`) ?? "", mat = src.get(`${API}/materials/route.ts`) ?? "", pol = read("src/lib/individual/policy.ts");
  const cfg = src.get(`${LIB}/config.ts`) ?? "";
  return /byte_size <= 26214400/.test(MIG413) && /set file_size_limit = 26214400/.test(MIG413) && /export const MAX_UPLOAD_BYTES = 25 \* 1024 \* 1024;/.test(cfg)
    && /export const DEFAULT_UPLOAD_MB = 10;/.test(cfg) && /key: "scholar_upload_max_mb"[\s\S]*?fallback: DEFAULT_UPLOAD_MB,/.test(pol)
    && /const overSession = sessionRefusal\(rules, recent, size\);/.test(up) && /const overSession = sessionRefusal\(rules, recent, bytes\.byteLength\);/.test(mat)
    && /if \(overSession\) return refuse\(429/.test(mat);
};
/**
 * K20 (Stage 2, Upload): what may be uploaded is Individual policy, enforced at BOTH steps (the slot and the
 * processing), the PDF page limit reaches the extractor, plain text is OFF until HQ turns it on (it needs 405),
 * the panel takes its rules from the server rather than a constant, and every material shows the educational
 * context it was uploaded in.
 */
const uploadGoverned = (src: Src) => {
  const up = src.get(`${API}/uploads/route.ts`) ?? "", mat = src.get(`${API}/materials/route.ts`) ?? "", cl = src.get(CLIENT) ?? "";
  const pol = read("src/lib/individual/policy.ts"), home = src.get(`${PAGES}/page.tsx`) ?? "", mp = src.get(`${PAGES}/[materialId]/page.tsx`) ?? "";
  return /const rules = uploadRules\(policy\);/.test(up) && /\(rules\.mimes as readonly string\[\]\)\.includes\(mime\)/.test(up) && /size > rules\.maxBytes/.test(up)
    && /const rules = uploadRules\(policy\);/.test(mat) && /\(rules\.mimes as readonly string\[\]\)\.includes\(declared\)/.test(mat) && /> rules\.maxBytes/.test(mat)
    && /extractMaterial\(mime, bytes, policy\.scholarPdfMaxPages(, policy\.scholarPptxMaxSlides)?\)/.test(mat)
    && /key: "scholar_upload_formats"[\s\S]*?fallback: \["pdf", "docx"\],/.test(pol)
    && /export function UploadPanel\(\{ rules \}/.test(cl) && !/ALLOWED_MIME|MAX_UPLOAD_BYTES/.test(cl)
    && /contextStamp\(/.test(home) && /contextStamp\(/.test(mp);
};
/**
 * K22 (COMPETEN-SCHOLAR-UPLOAD-01): the upload pipeline's new rules hold in the code.
 *   U1  the real kind is read from the bytes (sniffUpload: a ZIP is opened to tell Word from PowerPoint), and the
 *       same bytes twice are refused BEFORE anything is extracted, pointing at the copy the person has.
 *   U2  how completely the file was read is computed from what extraction produced, stored with the material,
 *       and returned as "partial" or "ready" -- never a bare success.
 *   U3  Scholar opts in to outcome-level mapping, and the R1 absence (no programme, or no usable catalogue) is
 *       said on the material page and the ready page through ONE rule (competencyAbsence).
 *   U5  a student's topic list is screened for patient identifiers before it is kept, and "Start learning" on
 *       the ready page is the EXISTING material page (the Stage 3 hold stands).
 */
const upload01Holds = (src: Src) => {
  const mat = src.get(`${API}/materials/route.ts`) ?? "", gen = src.get(GEN) ?? "", mp = src.get(`${PAGES}/[materialId]/page.tsx`) ?? "";
  const ready = src.get(`${PAGES}/ready/page.tsx`) ?? "", topics = src.get(`${API}/topics/route.ts`) ?? "";
  const dup = mat.indexOf("findDuplicate("), ext = mat.indexOf("extractMaterial(mime");
  return /const sniffed = await sniffUpload\(bytes\);/.test(mat) && /if \(sniffed\.unsafe\) return refuse\(422/.test(mat) && dup > 0 && ext > dup && /status: 409/.test(mat)
    && /const quality = extractionQuality\(mime, extraction\.pages, chunks\);/.test(mat) && /chunks, quality,/.test(mat)
    && /status: summary\.partial \? "partial" : "ready"/.test(mat)
    && /outcomes: true,/.test(gen)
    && /const absence = competencyAbsence\(learner\);/.test(mp) && /absence=\{absence\}/.test(mp) && /competencyAbsence\(learner\)/.test(ready)
    && /findPatientIdentifiers\(t\)/.test(topics)
    // LEARN-01 lifted the Stage 3 hold: Start learning now opens Teach Me in the Learn workspace (owner GO s8).
    && /href=\{experienceHref\("scholar", `study\/learn\?material=\$\{m\.id\}`\)\} className=\{primaryBtn\}/.test(ready);
};
/** K16: 390 makes a person's mapping unable to carry AI provenance -- both directions of the rule, one CHECK, nothing else. */
const mig390Shape = (m: string) => /\(source = 'ai'\) = \(model is not null and prompt_version is not null and confidence is not null\)/.test(m)
  && /\(source = 'ai' or \(model is null and prompt_version is null and confidence is null\)\)/.test(m)
  && (m.match(/^\s*(alter|create|drop|insert|update|delete)\b/gm) ?? []).length === 2;
/** K13: 389 widens both Scholar layer checks to exactly the five S1 layers of 384, and touches nothing else. */
const FIVE = "check (layer in ('foundational', 'profession', 'advanced', 'specialty', 'context'))";
const mig389Shape = (m: string) => (m.split(FIVE).length - 1) === 2
  && /add constraint individual_scholar_programme_framework_layer_check/.test(m) && /add constraint individual_scholar_competency_map_layer_check/.test(m)
  && (m.match(/^\s*(alter|create|drop|insert|update|delete)\b/gm) ?? []).length === 4;

/**
 * K2: ONE GATE, AND IT IS HQ'S. What Scholar offers comes only from S1's loadCatalogueFor(admin, "scholar") --
 * the HQ allowlist for Scholar, already held to shared, active and published -- and a programme only narrows
 * it. Unreadable is a refusal. No Scholar file reads the catalogue tables itself (names for links already
 * made come from Professional's shared-only referenceNames).
 */
const catalogueLeaks = (src: Src): string[] => {
  const c = src.get(CAT) ?? "";
  const bad: string[] = [];
  if (!/import \{ loadCatalogueFor \} from "\.\.\/catalogue";/.test(c) || !/const all = await loadCatalogueFor\(admin, "scholar"\);/.test(c)) bad.push("not read through S1's Scholar allowlist");
  if (!/if \(all === null\) return \{ ok: false \};/.test(c)) bad.push("unreadable not refused");
  if (!/\.filter\(c => config\.has\(c\.catalogue\.id\)\)/.test(c)) bad.push("programme does not narrow");
  bad.push(...[...src].filter(([, s]) => /from\("(frameworks|framework_domains|framework_competencies)"\)/.test(s)).map(([f]) => f));
  return bad;
};
/** K3: the model is shown tags, never an id, and a proposal's id comes only from the catalogue entry its tag names. */
const idsReachModel = (h: Src) => {
  const m = h.get(ENGINE) ?? "";
  const body = m.slice(m.indexOf("export function mappingUserPrompt"), m.indexOf("const contentWords"));
  return body.length < 50 || /\.(id|competencyId|ref)\b|frameworkId/.test(body) || !/const comp = candidates\[ci\];/.test(m) || !/competencyId: comp\.competencyId/.test(m);
};
/**
 * K17 (COMPETEN-SCHOLAR-01 P0): ONE computation. S5's coverage reads S2's ACCEPTED links (never a proposal) and the
 * learner's PROGRAMME catalogue -- the same denominator and the same rule as progress by competency -- and the
 * progress page passes that coverage to the competency section instead of totalling its own.
 */
const coverageUnified = (src: Src) => {
  const cs = src.get(`${LIB}/competency-sources.ts`) ?? "", st = src.get(STORE) ?? "", pg = src.get(`${PAGES}/progress/page.tsx`) ?? "";
  const fn = st.slice(st.indexOf("export async function acceptedQuestionCompetencies"), st.indexOf("export async function competencyProgressRows"));
  return /catalogue: SCHOLAR_PROGRAMME_CATALOGUE,\s*mappings: S2_MAPPINGS,/.test(cs)
    && /mappingsFor: \(admin: any, userId: string, questionIds: readonly string\[\]\) => acceptedQuestionCompetencies\(/.test(cs)
    && /scholarCatalogue\(admin\)\.forProgramme\(p\.data\)/.test(cs)
    && /\.filter\(m => m\.state === "accepted"\)/.test(fn) && !/"proposed"/.test(fn)
    && /coverage=\{li\?\.ok \? li\.data\.coverage : null\}/.test(pg);
};
/**
 * K18 (COMPETEN-SCHOLAR-01 P1, Personal AI): the tutor's view of the student is assembled per request from the
 * caller's own rows, given to the TUTOR only, never used as grounding (the check sees the question and the
 * conversation, not the context), and carries no profile data.
 */
const tutorContextBounded = (src: Src) => {
  const g = src.get(GEN) ?? "", r = src.get(`${API}/explain/route.ts`) ?? "", lc = src.get(`${LIB}/learner-context.ts`) ?? "";
  const v = src.get(`${LIB}/competency-view.ts`) ?? "";
  const loader = v.slice(v.indexOf("export async function loadTutorContext"));
  return /user: modeUserPrompt\(question, passages, history, mode === "tutor" \? learnerContext : null\),/.test(g)
    && /const asked = \[question, \.\.\.history\.map\(t => t\.text\)\]\.join\("\\n"\);/.test(g) && !/asked[^;]*learnerContext/.test(g)
    && /loadTutorContext\(ctx\.admin, ctx\.userId, passages\.map\(p => p\.chunkId\)\)/.test(r)
    && loader.length > 100 && !/profile|fullName|full_name|email/i.test(lc + loader);
};
/**
 * K19 (owner ruling 2026-10-24): content status is LABELLED, never hidden silently. The projection applies the
 * policy floor (scholar_catalogue_min_status) through meetsMinStatus and COUNTS what it holds back; the status tag
 * is shown on links, progress rows, the tutor and the case player; a held-back count is said on the page.
 */
const contentStatusLabelled = (src: Src) => {
  const c = src.get(CAT) ?? "", cc = src.get(`${PAGES}/_components/competency-client.tsx`) ?? "", cl = src.get(CLIENT) ?? "";
  const pg = src.get(`${PAGES}/progress/page.tsx`) ?? "", mp = src.get(`${PAGES}/[materialId]/page.tsx`) ?? "";
  return /const min = \(await loadIndividualPolicy\(admin\)\)\.scholarCatalogueMinStatus;/.test(c)
    && /const kept = rows\.filter\(c => meetsMinStatus\(c\.contentStatus, min\)\);/.test(c) && /belowFloor: rows\.length - kept\.length/.test(c)
    && /<ContentStatusTag status=\{m\.contentStatus\} \/>/.test(cc) && /<ContentStatusTag status=\{competency\.contentStatus\} \/>/.test(cc)
    && /<ContentStatusTag status=\{l\.contentStatus\} \/>/.test(cl) && /<ContentStatusTag status=\{r\.contentStatus\} \/>/.test(pg)
    && /learner\.belowFloor > 0/.test(mp) && /learner\.belowFloor > 0/.test(pg);
};
/** K4: no Scholar code edits or deletes a mapping or a decision, and every upsert onto them leaves existing rows alone. */
const trailEdits = (src: Src) => storeStatements(src)
  .filter(x => /^individual_scholar_(competency_decision|competency_map|chunk_analysis)$/.test(x.table))
  .filter(x => /\.(update|delete)\(/.test(x.stmt) || (/\.upsert\(/.test(x.stmt) && !/ignoreDuplicates: true/.test(x.stmt)))
  .map(x => `${x.table}@${x.at}`);
/** K5: what lies beyond the notes is split off before the check, checked on its own, and shown apart under its label. */
const supplementaryApart = (src: Src) => {
  const g = src.get(GEN) ?? "", r = src.get(`${API}/explain/route.ts`) ?? "", c = src.get(CLIENT) ?? "";
  return /supplementary: split\.extra === null \? null : checkSupplementary\(split\.extra, mode\)/.test(g)
    && /label: SUPPLEMENTARY_LABEL/.test(r) && /SUPPLEMENTARY_WITHHELD\[/.test(r) && !/answer: [^,\n]*supplementary/.test(r)
    && /<SourceNotice \/><\/div>\s*<BeyondNotes s=\{item\.supplementary\} \/>/.test(c) && /Beyond your notes/.test(c);
};
/** K6: every step of a case is held to the single-question rules, the blind verification included. */
const caseStepsChecked = (src: Src) => {
  const g = src.get(GEN) ?? "";
  const body = g.slice(g.indexOf("export async function runCase"), g.indexOf("export async function runQuestions"));
  return /const check = checkQuestions\(JSON\.stringify\(parsed\.steps\), passage, CASE_MAX_STEPS, CASE_MAX_STEPS\);/.test(body)
    && /const verified = applyVerification\(check\.kept, v\.text\);/.test(body) && /steps = verified\.kept;/.test(body)
    && /verified\.kept\.length >= CASE_MIN_STEPS/.test(body) && /drafts: r\.steps/.test(src.get(`${API}/cases/route.ts`) ?? "");
};
/** K7: the MVP keeps working without 388 -- its columns are never selected with the 372 ones, and written only when set. */
const failsClosed = (src: Src) => {
  const s = src.get(STORE) ?? "";
  const cols = /const QUESTION_COLS = "([^"]*)"/.exec(s)?.[1] ?? "competency_id";
  return !/competency_id|case_/.test(cols)
    && /\.\.\.\(input\.competencyId \? \{ competency_id: input\.competencyId \} : \{\}\)/.test(s)
    && /\.\.\.\(input\.caseId \? \{ case_id: input\.caseId, case_step: i \+ 1/.test(s)
    && /async function questionExtras[\s\S]*?if \(error\) return new Map\(\);/.test(s);
};
/** K8: a link the person adds names a competency the catalogue offers their programme, checked before it is written. */
const addChecksCatalogue = (src: Src) => {
  const r = src.get(`${API}/mappings/route.ts`) ?? "";
  const find = r.indexOf("cat.data.find(c => c.id === body.competencyId)"), write = r.indexOf("await addMapping(");
  return find >= 0 && write > find && /competencyId: competency\.id, layer: competency\.layer/.test(r);
};
/** K10: the schema of 387 and 388. */
const mig387Shape = (m: string) =>
  ["individual_scholar_programme", "individual_scholar_programme_framework", "individual_scholar_learner"].every(t => m.includes(`alter table ${t} enable row level security`))
  && !/create policy \w+ on individual_scholar_programme(_framework)?\b/.test(m)
  && /create policy individual_scholar_learner_read_own on individual_scholar_learner\s+for select using \(auth\.uid\(\) = user_id\)/.test(m)
  && /framework_id\s+uuid not null references frameworks\(id\)/.test(m) && /check \(layer in \('foundational', 'profession', 'specialty'\)\)/.test(m)
  && !/for (insert|update|delete|all)\b/.test(m) && !/create (or replace )?function|plpgsql|\$\$/.test(m);
const mig388Shape = (m: string) =>
  ["chunk_analysis", "competency_map", "competency_decision"].every(t =>
    m.includes(`alter table individual_scholar_${t} enable row level security`)
    && new RegExp(`create policy individual_scholar_${t}_read_own on individual_scholar_${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(m))
  && !/for (insert|update|delete|all)\b/.test(m)
  && /if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then/.test(m) && /before update or delete on individual_scholar_competency_decision/.test(m)
  && /competency_id\s+uuid not null references framework_competencies\(id\)/.test(m)
  && /foreign key \(map_id, user_id\)\s+references individual_scholar_competency_map\(id, user_id\) on delete cascade/.test(m)
  && /check \(\(source = 'ai'\) = \(model is not null and prompt_version is not null and confidence is not null\)/.test(m)
  && /\(case_id is null\) = \(case_step is null\)/.test(m) && /\(case_id is null or kind = 'case'\)/.test(m);
/** K9: no Scholar code names a profession. A new profession is configuration rows (387), never code. */
const professionNamed = (src: Src) => [...src].filter(([f]) => f !== `${LIB}/test-documents.ts`)
  .filter(([, s]) => /\b(nurs(e|es|ing)|midwi(fe|fery|ves)|pharmac(y|ist)|physiotherap)/i.test(s)).map(([f]) => f);

/** Every applicable document published (version and URL), with overrides. Test values only, never a real URL. */
const legalEnv = (over: Record<string, string>) => ({
  ...Object.fromEntries(["COMPETEN_HOLDINGS", "SCHOLAR_OPERATOR"].flatMap(e => ["TERMS", "PRIVACY"].flatMap(d => [
    [`INDIVIDUAL_LEGAL_${e}_${d}_VERSION`, "test-1"], [`INDIVIDUAL_LEGAL_${e}_${d}_URL`, "https://example.test/doc"]]))),
  ...over,
});

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
    && [`${API}/explain/route.ts`, `${API}/questions/route.ts`, `${API}/materials/[id]/analyse/route.ts`, `${API}/cases/route.ts`]
      .every(f => /audit\(ctx, SCHOLAR_AI_AUDIT_ACTION/.test(REAL.get(f) ?? "")));
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
  ok("D5. the grounding check is the Practice verifyGrounded, lifted to Holdings unchanged, not a new one",
    /from "@\/lib\/ai\/grounding"/.test(REAL.get(GEN) ?? "") && /export function verifyGrounded\(/.test(HOLD.get(GROUND) ?? "")
    && /export \{ verifyGrounded, ASSERTION_MARKERS, type PhrasingViolation \} from "@\/lib\/ai\/grounding";/.test(read("src/lib/practice/document-phrasing.ts"))
    && !/export function verifyGrounded/.test(read("src/lib/practice/document-phrasing.ts")));
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
  // ── S. OWNER CONSENT GO (2026-10-23) ───────────────────────────────────────────────────────────
  ok("S1. no Scholar code shares, submits, contributes or publishes a person's material, or mentions training (outside the notice text)",
    sharingPaths(REAL).length === 0, sharingPaths(REAL).join(", "));
  ok("S2. the only consent Scholar asks for is AI processing: one feature value in code and in the schema, so no training permission exists",
    CONSENT_FEATURE === "ai_processing_uploads" && (!MIG_REAL || /check \(feature in \('ai_processing_uploads'\)\)/.test(MIG_REAL)));
  ok("S3. the consent notice is v3: no contribution sentence, the plain no-sharing/no-training statement, Terms of Use, feedback scoped to practice questions, the How-it-works list, and its version recorded with each grant",
    CONSENT_NOTICE_VERSION === "scholar-ai-uploads-notice-v3"
    && !CONSENT_NOTICE.paragraphs.some(p => /contribut|library|submi/i.test(p))
    && CONSENT_NOTICE.paragraphs.some(p => p.includes("Your private uploads are not shared with other learners, and Competen does not use them to train AI models."))
    && CONSENT_NOTICE.paragraphs[0].includes("feedback on practice questions drawn from your notes")
    && CONSENT_NOTICE.review.includes("Terms of Use") && ![...REAL.values()].some(s => /Terms of Service/.test(s))
    && CONSENT_NOTICE.howItWorks.length === 4 && /CONSENT_NOTICE\.howItWorks\.map/.test(REAL.get(CLIENT) ?? "")
    && CONSENT_NOTICE.statement.startsWith("I understand how AI-assisted learning works")
    && /notice_version: CONSENT_NOTICE_VERSION/.test(REAL.get(STORE) ?? ""));
  ok("S4. the agreement is its own click on the stated consent, and withdrawal is one click",
    /disabled=\{busy \|\| !agreed\} onClick=\{\(\) => set\(true\)\}/.test(REAL.get(CLIENT) ?? "") && /\{CONSENT_NOTICE\.statement\}/.test(REAL.get(CLIENT) ?? "")
    && /onClick=\{\(\) => set\(false\)\}>\{busy \? "Saving…" : "Turn off"\}/.test(REAL.get(CLIENT) ?? ""));
  ok("S5. AI help cannot be turned on, or used, until every applicable Privacy Notice and Terms of Use has a version and a URL",
    legalGateHeld(REAL)
    && consentStatus({ granted: true, noticeVersion: CONSENT_NOTICE_VERSION }, false) === "awaiting_legal"
    && !consentDocuments({}).published
    && !consentDocuments(legalEnv({ INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_URL: "" })).published
    && consentDocuments(legalEnv({})).published);
  ok("S6. a grant to an earlier notice is kept but does not count: the person is asked again, and no page or route reads the raw grant as 'on'",
    consentStatus({ granted: true, noticeVersion: "scholar-ai-uploads-notice-v2" }, true) === "outdated"
    && consentStatus({ granted: true, noticeVersion: CONSENT_NOTICE_VERSION }, true) === "on"
    && consentStatus({ granted: false, noticeVersion: CONSENT_NOTICE_VERSION }, true) === "off"
    && rawGrantReads(REAL).length === 0, rawGrantReads(REAL).join(", "));
  ok("S7. the upload attestation covers patient information AND permission to use the material, on screen and in both refusals",
    /no identifiable patient information/.test(UPLOAD_ATTESTATION) && /permission to upload and use it/.test(UPLOAD_ATTESTATION)
    && /\{UPLOAD_ATTESTATION\}/.test(REAL.get(CLIENT) ?? "")
    && [`${API}/uploads/route.ts`, `${API}/materials/route.ts`].every(f => /\{ error: UPLOAD_ATTESTATION_REQUIRED \}/.test(REAL.get(f) ?? "")));
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
  // Stage 2: plain text is 405's, so the formats the code knows are checked against 372 and 405 together.
  // The size ceiling is 413's since the owner raised it (2026-10-24): 372 still creates the bucket private at 10 MB.
  ok("F5. the bucket is private and its size and type limits match the code (372, plus 405 for plain text, 406 for PowerPoint, 413 for 25 MB)",
    MIG_REAL.includes(`'${BUCKET}', '${BUCKET}', false, 10485760`) && ALLOWED_MIME.every(m => MIG_REAL.includes(`'${m}'`) || MIG405.includes(`'${m}'`) || MIG406.includes(`'${m}'`))
    && MIG_REAL.includes("byte_size <= 10485760") && MIG413.includes(`byte_size <= ${MAX_UPLOAD_BYTES}`) && MIG413.includes(`file_size_limit = ${MAX_UPLOAD_BYTES}`)
    && (!MIG405 || /update storage\.buckets[\s\S]*'text\/plain'[\s\S]*where id = 'individual-scholar-materials'/.test(MIG405))
    && (!MIG406 || /update storage\.buckets[\s\S]*presentationml\.presentation'[\s\S]*where id = 'individual-scholar-materials'/.test(MIG406)));
  // String literals out first: the table comments NAME the estate tables in order to say they are not used.
  const migDdl = MIG_REAL.replace(/'(?:[^']|'')*'/g, "''");
  ok("F6. 372 creates no function and touches no estate table", !/create (or replace )?function|plpgsql|\$\$/.test(migDdl)
    && !/\b(quiz_attempts|knowledge_attempts|cdp_reinforcement_cards|cpd_logs|clinical_cases)\b/.test(migDdl)
    && /\bquiz_attempts\b/.test(MIG_REAL));
  ok("F7. 372 is independent of 370 and 373 (no individual_membership or individual_entitlement reference)",
    !/individual_membership|individual_entitlement|individual_live_entitlement/.test(MIG_REAL));
  }

  // ── V. PASSPORT STUDY ACHIEVEMENTS (s11, migration 375) ─────────────────────────────────────────
  ok("V1. the Passport and /verify read only which question was answered and when -- no notes, questions, answers or AI output",
    !studyReadsContent(REAL));
  ok("V2. /verify reads the person's choices on every view of a link carrying their own records, uncached, so a removal reaches live links",
    verifyReadsLive(OUTSIDE));
  ok("V3. a choice is stored only after the store counted an answer of that kind (opt-in to an earned achievement)", includeChecksEarned(REAL));
  ok("V4. self-directed study is labelled as such on the Passport page and on /verify, from one label",
    /self_directed: "Self-directed study, not a verified competency"/.test(OUTSIDE.get("src/lib/individual/passport.ts") ?? "")
    && /EVIDENCE_LABEL\.self_directed/.test(OUTSIDE.get(PASSPORT_PAGE) ?? "") && /EVIDENCE_LABEL\.self_directed/.test(OUTSIDE.get(VERIFY) ?? ""));
  if (!MIG375) console.log(`  NOTE  ${MIG375_FILE} is not in this checkout -- schema check V5 and P19 NOT RUN`);
  if (MIG375) ok("V5. 375: RLS with own-row select only, no write policy, the composite key to the owner's material with cascade, two achievement kinds, a checked label, no function",
    /alter table individual_scholar_passport_item enable row level security/.test(MIG375)
    && /create policy individual_scholar_passport_item_read_own on individual_scholar_passport_item\s+for select using \(auth\.uid\(\) = user_id\)/.test(MIG375)
    && !/for (insert|update|delete|all)\b/.test(MIG375)
    && /foreign key \(material_id, user_id\)\s+references individual_scholar_material\(id, user_id\) on delete cascade/.test(MIG375)
    && /check \(achievement in \('practice_questions', 'practice_scenarios'\)\)/.test(MIG375)
    && /check \(label = btrim\(label\) and char_length\(label\) between 1 and 120\)/.test(MIG375)
    && !/create (or replace )?function|plpgsql|\$\$/.test(MIG375));

  // ── G. ERASURE ──────────────────────────────────────────────────────────────────────────────────
  const store = REAL.get(STORE) ?? "";
  ok("G1. deleting a material removes its stored object before its row (which cascades)",
    (() => { const b = store.slice(store.indexOf("export async function deleteMaterial"), store.indexOf("export async function eraseAllMaterial"));
      const rm = b.indexOf(".remove("), del = b.indexOf(".delete()"); return rm >= 0 && del > rm; })());
  ok("G2. erasing everything also removes objects never processed (it lists the owner's folder)",
    /storage\.from\(BUCKET\)\.list\(userId/.test(store) && /export async function eraseAllMaterial/.test(store));
  if (MIG_REAL) ok("G3. every child table cascades from its material", (MIG_REAL.match(/references individual_scholar_material\(id, user_id\) on delete cascade/g) ?? []).length === 3);

  // ── K. COMPETEN-SCHOLAR-01: COMPETENCY-DRIVEN LEARNING ─────────────────────────────────────────────
  ok("K1. programme configuration is only ever read by Scholar code (no user_id, and no write path)", configWrites(REAL).length === 0, configWrites(REAL).join(", "));
  ok("K2. competencies come only through the catalogue interface: shared, active and published frameworks, nothing read around it",
    catalogueLeaks(REAL).length === 0, catalogueLeaks(REAL).join(", "));
  ok("K3. the model sees competency tags, never ids, and a stored proposal names only a competency the catalogue offered", !idsReachModel(HOLD));
  ok("K17. one computation: coverage reads S2's accepted links and the learner's programme catalogue, and the competency section shows that coverage",
    coverageUnified(REAL));
  ok("K18. Personal AI: the tutor's view of the student is built per request from the caller's own rows, goes to the tutor only, is never grounding, and holds no profile data",
    tutorContextBounded(REAL));
  ok("K19. content status is labelled on links, progress rows, the tutor and cases, the policy floor is applied and what it holds back is said -- never hidden silently",
    contentStatusLabelled(REAL));
  ok("K20. Stage 2: formats, size and pages are Individual policy, enforced at both upload steps; plain text is off until HQ enables it; the panel reads the server's rules; every material shows its educational context",
    uploadGoverned(REAL));
  ok("K25. AI-FAIR-USE-01: artefacts are private formative and go with their material; a saved answer is returned before any AI, continuity is decided before the call, only reusable answers are saved, and the standing has one adapter",
    artefactsBounded(REAL));
  ok("K26. AI-FAIR-USE-01 swap: every Scholar AI route runs through the metered runner with its activity code and returns a refusal first; generators make no direct generate() call; the runner sends no amount, policy or level",
    meteredEverywhere(REAL));
  ok("K29. D3: Learn's personal-assistant entry is the shared Holdings assistant on the step's sections, screened and preflighted first, never saved or recorded as Learn, shown apart under its own label",
    assistantShared(REAL));
  ok("K27. Stage 3 items 3 and 5: governed references come from policy through S1; 'clinically approved' only by the one rule (395, current content, outcome held), everywhere a reference is shown; AI flags rendered apart under their own heading",
    referencesGoverned(REAL));
  ok("K28. Stage 3 item 4: an unsupported answer is withheld with the plain reason and notes-only next steps; the withheld text is never sent; background only where policy allows and it passed its checks",
    withheldPlain(REAL));
  ok("K30. REVISION-01: a question reaches the browser before it is answered only as the learner view -- no key, rationale or source quote",
    answersServerSide(REAL));
  ok("K31. REVISION-01: revision questions are private formative; code marks what it can; an unmatched short answer is labelled AI evaluation or the student's own judgement, never wrong by default",
    markingHonest(REAL));
  ok("K32. REVISION-01: reuse first -- a shortfall only is written, never a section and format already written; a saved set replays with no AI; policy can keep to saved questions",
    reuseFirst(REAL));
  ok("K24. LEARN-01: history holds no conversation, the act route keeps to policy, screens input, records only what was shown, stores no practice question, and the student's context is never grounding",
    learnBounded(REAL));
  ok("K23. upload limits: 413 raises the CHECK and the bucket to 25 MB, the live value stays 10 MB until HQ raises it, and the session is enforced on the server at both steps",
    uploadLimitsHold(REAL));
  ok("K22. UPLOAD-01: the real kind is read from the bytes, a duplicate is refused before extraction, read quality is stored and returned (partial is never a bare success), outcomes are opted in, the no-catalogue absence is said through one rule, student topics are screened, and Start learning opens Teach Me (LEARN-01)",
    upload01Holds(REAL));
  ok("K15. the mapping engine is Holdings code: product-neutral, storing nothing, using the caller's attribution -- Scholar supplies person attribution and its identifier screen",
    engineNeutral(HOLD, REAL));
  ok("K4. proposals, concepts and decisions are never edited or deleted by code -- a correction is a new decision row", trailEdits(REAL).length === 0, trailEdits(REAL).join(", "));
  ok("K5. background beyond the notes is split off before the check, checked on its own, and shown apart under its own label", supplementaryApart(REAL));
  ok("K6. every step of a practice case passes the question checks and the blind verification, or the case is not stored", caseStepsChecked(REAL));
  ok("K7. fails closed without 388: the MVP question read and insert are unchanged unless there is a competency or a case", failsClosed(REAL));
  ok("K8. a competency the person links is checked against their programme's catalogue before it is written", addChecksCatalogue(REAL));
  ok("K9. no Scholar code names a profession -- a new one is configuration rows", professionNamed(REAL).length === 0, professionNamed(REAL).join(", "));
  ok("K11. labels: a case says it is a practice scenario and AI-written, suggested links say they are suggestions, progress by competency says it is not an assessment",
    /\{PERSONAL_CASE_LABEL\}/.test(REAL.get(`${PAGES}/_components/competency-client.tsx`) ?? "") && /\{AI_LABEL\}/.test(REAL.get(`${PAGES}/_components/competency-client.tsx`) ?? "")
    && /\{MAPPING_LABEL\}/.test(REAL.get(`${PAGES}/_components/competency-client.tsx`) ?? "")
    && /not an assessment of competence/.test(REAL.get(`${PAGES}/progress/page.tsx`) ?? ""));
  ok("K12. every new AI call is audited, attributed and behind the preflight (C1, C3, C5 cover analyse and cases)",
    [`${API}/materials/[id]/analyse/route.ts`, `${API}/cases/route.ts`].every(f => REAL.has(f)) && /operation: "individual_scholar_map"/.test(REAL.get(GEN) ?? ""));
  if (!MIG389) console.log(`  NOTE  ${MIG389_FILE} is not in this checkout -- schema check K13 and P31 NOT RUN`);
  if (!MIG390) console.log(`  NOTE  ${MIG390_FILE} is not in this checkout -- schema check K16 and P33 NOT RUN`);
  if (MIG390) ok("K16. 390: a mapping made by a person carries no model, prompt version or confidence -- the rule 388 stated, now in the schema", mig390Shape(MIG390));
  if (MIG389) ok("K13. 389 widens the two Scholar layer checks to exactly the five S1 layers, and changes nothing else", mig389Shape(MIG389));
  ok("K14. the layer a mapping stores is the catalogue's own (S1), and the code knows the same five layers as 384",
    /export const LAYERS = COMPETENCY_LAYERS;/.test(REAL.get(CAT) ?? "") && /layer: competency\.layer/.test(REAL.get(`${API}/mappings/route.ts`) ?? "")
    && /layer: comp\.layer/.test(HOLD.get(ENGINE) ?? ""));
  if (!MIG387 || !MIG388) console.log(`  NOTE  ${!MIG387 ? MIG387_FILE : MIG388_FILE} is not in this checkout -- schema check K10 and P30 NOT RUN`);
  if (MIG387 && MIG388) ok("K10. 387/388: configuration service-role only, own-row read on personal rows, no write policy, typed catalogue keys, an append-only trail that cascade can still remove, AI provenance, and case steps only on case questions",
    mig387Shape(MIG387) && mig388Shape(MIG388));

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
  ok("P17. ⚠ V1 goes red when the Passport read starts selecting a question's text",
    studyReadsContent(plant(STORE, '.select("id, material_id, kind")\n    .eq("user_id", userId).in("material_id", materialIds)', '.select("id, material_id, kind, stem")\n    .eq("user_id", userId).in("material_id", materialIds)')));
  ok("P18. ⚠ V2 goes red when /verify stops reading the choices at render time",
    (() => { const copy = new Map(OUTSIDE); copy.set(VERIFY, (copy.get(VERIFY) ?? "").replace("carriesOwn ? await loadStudyAchievements(admin, share.nurse_id) : null", "null")); return !verifyReadsLive(copy); })());
  ok("P20. ⚠ V3 goes red when a choice is stored before the answers are counted",
    !includeChecksEarned(plant(STORE, 'if (answered < 1) return "not_eligible";', "")));
  if (MIG375) ok("P19. ⚠ V5 goes red on an added write policy",
    /for (insert|update|delete|all)\b/.test(`${MIG375}\ncreate policy x on individual_scholar_passport_item for insert with check (true)`));
  if (MIG_REAL) ok("P10. ⚠ F1/F2 go red on a missing policy or an added write policy",
    tablesWithoutRls(MIG_REAL.replace("alter table individual_scholar_card enable row level security", "")).length === 1
    && writePolicies(`${MIG_REAL}\ncreate policy x on individual_scholar_card for insert with check (true)`));
  ok("P11. ⚠ R1 goes red when checkQuestions stops applying the quality layer",
    !qualityWired(plant(GEN, "const problems = qualityProblems(draft, passage.content);", "const problems: { reason: string; detail?: string }[] = [];")));
  ok("P12. ⚠ R1 goes red when the blind verification is skipped",
    !qualityWired(plant(GEN, "const outcome = applyVerification(check.kept, v.text);", "const outcome = { kept: check.kept, rejected: [] };")));
  ok("P14. ⚠ S1 goes red when a route starts submitting material to a shared library",
    sharingPaths(plant(STORE, "export function isUuid", "export async function submitToSharedLibrary() { return null; }\nexport function isUuid")).length > 0);
  ok("P15. ⚠ S5 goes red when the consent route saves a grant without checking the documents are published",
    !legalGateHeld(plant(`${API}/consent/route.ts`, "if (body.grant && !consentDocuments().published)", "if (false)")));
  ok("P16. ⚠ S6 goes red when a page treats the stored grant as 'on' again",
    rawGrantReads(plant(`${PAGES}/[materialId]/page.tsx`, 'const consentOn = status === "on";', "const consentOn = consent.ok && consent.data.granted;")).length > 0);
  ok("P13. ⚠ R3 goes red when a screen says mastery again",
    masteryWords(plant(`${PAGES}/progress/page.tsx`, "% practice accuracy`", "% mastery`")).length > 0);

  // COMPETEN-SCHOLAR-01
  ok("P21. ⚠ K1 goes red when Scholar code writes programme configuration",
    configWrites(plant(STORE, "export function isUuid", 'export async function x(admin: Admin) { await admin.from("individual_scholar_programme").insert({ code: "x" }); }\nexport function isUuid')).length > 0);
  ok("P22. ⚠ K2 goes red when Scholar reads another experience's allowlist, stops narrowing to the programme, or a page reads competencies around the catalogue",
    catalogueLeaks(plant(CAT, 'loadCatalogueFor(admin, "scholar")', 'loadCatalogueFor(admin, "professional")')).length > 0
    && catalogueLeaks(plant(CAT, ".filter(c => config.has(c.catalogue.id))", ".filter(() => true)")).length > 0
    && catalogueLeaks(plant(`${PAGES}/progress/page.tsx`, "const learner = rows.ok", 'const leak = ctx.admin.from("framework_competencies").select("*");\n  const learner = rows.ok')).length > 0);
  ok("P23. ⚠ K3 goes red when the prompt shows the model competency ids",
    idsReachModel(new Map([...HOLD, [ENGINE, (HOLD.get(ENGINE) ?? "").replace("[${candidateTag(i)}]", "[${c.competencyId}]")]])));
  ok("P34. ⚠ K17 goes red when coverage counts proposed links, or the section totals its own",
    !coverageUnified(plant(STORE, '.filter(m => m.state === "accepted").map(m => `${m.chunkId}|${m.competencyId}`));\n  return {\n    ok: true,\n    value: ((data ?? []) as any[]).filter(r => accepted', '.filter(m => m.state !== "rejected").map(m => `${m.chunkId}|${m.competencyId}`));\n  return {\n    ok: true,\n    value: ((data ?? []) as any[]).filter(r => accepted'))
    && !coverageUnified(plant(`${PAGES}/progress/page.tsx`, "coverage={li?.ok ? li.data.coverage : null}", "coverage={null}")));
  ok("P35. ⚠ K18 goes red when the context becomes grounding, reaches every mode, or names the person",
    !tutorContextBounded(plant(GEN, 'const asked = [question, ...history.map(t => t.text)].join("\\n");', 'const asked = [question, ...history.map(t => t.text), learnerContext ?? ""].join("\\n");'))
    && !tutorContextBounded(plant(GEN, 'mode === "tutor" ? learnerContext : null),', "learnerContext),"))
    && !tutorContextBounded(plant(`${LIB}/learner-context.ts`, "export const NEEDS_PRACTICE_BELOW", "export const who = (p: { fullName: string }) => p.fullName;\nexport const NEEDS_PRACTICE_BELOW")));
  ok("P36. ⚠ K19 goes red when the floor is ignored, a progress row loses its label, or held-back content goes unsaid",
    !contentStatusLabelled(plant(CAT, "const kept = rows.filter(c => meetsMinStatus(c.contentStatus, min));", "const kept = rows;"))
    && !contentStatusLabelled(plant(`${PAGES}/progress/page.tsx`, "<ContentStatusTag status={r.contentStatus} />", ""))
    && !contentStatusLabelled(plant(`${PAGES}/[materialId]/page.tsx`, "learner.belowFloor > 0", "false")));
  ok("P37. ⚠ K20 goes red when processing stops re-checking the format, or a material stops showing its context",
    !uploadGoverned(plant(`${API}/materials/route.ts`, "(rules.mimes as readonly string[]).includes(declared)", "true"))
    && !uploadGoverned(plant(`${PAGES}/[materialId]/page.tsx`, "contextStamp(", "(() => null)(")));
  ok("P42. ⚠ K25 goes red when the AI runs before the saved answer is looked up, or conversation becomes an artefact",
    !artefactsBounded(plant(`${API}/learn/act/route.ts`, "const pre = await aiPreflight(ctx);", "const pre0 = 0;"))
    && !artefactsBounded(plant(`${API}/learn/act/route.ts`, "const storable = isArtefactAction(action) && !hasHistory && oneMaterial;", "const storable = !hasHistory && oneMaterial;")));
  ok("P46. ⚠ K26 goes red when a route drops the risk subject, or the runner stops sending it",
    !meteredEverywhere(plant(`${API}/cases/route.ts`, `"case_steps", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }))`, `"case_steps", {})`))
    && !meteredEverywhere(plant(`${LIB}/http.ts`, "generate: g, risk })", "generate: g })")));
  ok("P47. ⚠ K29 goes red when the screen moves after the call, the answer is saved as an artefact, or the label goes",
    !assistantShared(plant(ASSIST, "if (findPatientIdentifiers(question).length)", "if (false)"))
    && !assistantShared(plant(ASSIST, "  const study = await scholarRisk(", "  await saveArtefact(ctx.admin, ctx.userId, {} as never);\n  const study = await scholarRisk("))
    && !assistantShared(plant(ASSIST, "label: PERSONAL_AI_LABEL", "label: null")));
  ok("P48. ⚠ K30 goes red when the learner view carries the rationale, or a route sends a raw question",
    !answersServerSide(plant(REV, "  const base = { id: q.id, kind: q.kind, stem: q.stem,", "  const base = { id: q.id, kind: q.kind, rationale: q.rationale, stem: q.stem,"))
    && !answersServerSide(plant(`${API}/revision/sessions/route.ts`, "items: ordered.map(revisionItemView), generated, reused", "items: ordered, generated, reused")));
  ok("P49. ⚠ K31 goes red when an unmatched short answer is marked wrong, or AI evaluation is recorded as code",
    !markingHonest(plant(REV, ": { needsJudgement: true };", ": { correct: false, score: 0, marking: \"deterministic\" };"))
    && !markingHonest(plant(`${API}/revision/answer/route.ts`, "const marking = evaluator ? \"ai_evaluation\" as const : mark.marking;", "const marking = mark.marking;")));
  ok("P50. ⚠ K32 goes red when a saved set calls AI, or spaced review writes new questions",
    !reuseFirst(plant(`${API}/revision/sessions/route.ts`, "    await touchRevisionSet(ctx.admin, ctx.userId, set.id);", "    await touchRevisionSet(ctx.admin, ctx.userId, set.id);\n    await aiPreflight(ctx);"))
    && !reuseFirst(plant(REV, "[\"today\", \"quick\", \"mock\", \"flashcards\"];", "[\"today\", \"quick\", \"mock\", \"flashcards\", \"spaced\"];")));
  ok("P43. ⚠ K26 goes red when a route stops passing the runner, or a generator calls generate() directly",
    !meteredEverywhere(plant(`${API}/questions/route.ts`, ".scholarQuestionsPerRequest, ai.run)", ".scholarQuestionsPerRequest)"))
    && !meteredEverywhere(plant(GEN, "    const r = await run({\n      system: QUESTION_SYSTEM[kind],", "    const r = await generate({\n      system: QUESTION_SYSTEM[kind],")));
  ok("P44. ⚠ K27 goes red when a draft counts as approved, a saved answer keeps its saved label, or the rendering trusts a status string",
    !referencesGoverned(plant(`${LIB}/learn.ts`, 'approved: c.contentStatus === "approved" }', 'approved: c.contentStatus !== "unreviewed" }'))
    && !referencesGoverned(plant(`${API}/learn/act/route.ts`, "references: relabelReferences(a.refs, refSource)", "references: a.refs"))
    && !referencesGoverned(plant(KINDS, "{x.approved === true", "{x.status === CONTENT_STATUS_LABEL.approved"))
    && !referencesGoverned(plant(`${LIB}/learn.ts`, ".filter(l => !source.collections || known.has(l.competencyId))", "")));
  ok("P45. ⚠ K28 goes red when the withheld text is sent, or background is offered where policy does not allow it",
    !withheldPlain(plant(`${API}/learn/act/route.ts`, "message: next.why, notInNotes: next.notInNotes, next }", "message: next.why, notInNotes: next.notInNotes, next, answer: r.check }"))
    && !withheldPlain(plant(`${LIB}/learn-view.ts`, "background: input.backgroundAllowed && b?.ok ?", "background: b?.ok ?")));
  ok("P41. ⚠ K24 goes red when the policy gate goes, an event is recorded before it is shown, or the context becomes grounding",
    !learnBounded(plant(`${API}/learn/act/route.ts`, "if (isLearnAction(action) && !policy.scholarLearningActions.includes(action))", "if (false)"))
    && !learnBounded(plant(`${API}/learn/act/route.ts`, "if (recorded && sessionId && shown && policy.scholarLearningHistory === \"record\")", "if (recorded && sessionId)"))
    && !learnBounded(plant(GEN, "const asked = [args.question, ...args.history.map(t => t.text)].join(\"\\n\");", "const asked = [args.question, ...args.history.map(t => t.text), args.learnerContext ?? \"\"].join(\"\\n\");")));
  ok("P40. ⚠ K23 goes red when processing stops deciding the session, or the default jumps to the ceiling",
    !uploadLimitsHold(plant(`${API}/materials/route.ts`, "if (overSession) return refuse(429", "if (false) return refuse(429"))
    && !uploadLimitsHold(new Map([...REAL, [`${LIB}/config.ts`, (REAL.get(`${LIB}/config.ts`) ?? "").replace("export const DEFAULT_UPLOAD_MB = 10;", "export const DEFAULT_UPLOAD_MB = 25;")]])));
  ok("P39. ⚠ K22 goes red when the duplicate check moves after extraction, partial is reported as ready, or the no-catalogue absence goes unsaid",
    !upload01Holds(plant(`${API}/materials/route.ts`, 'status: summary.partial ? "partial" : "ready"', 'status: "ready"'))
    && !upload01Holds(plant(`${API}/materials/route.ts`, "if (sniffed.unsafe) return refuse(422", "if (false) return refuse(422"))
    && !upload01Holds(plant(`${PAGES}/[materialId]/page.tsx`, "const absence = competencyAbsence(learner);", "const absence = null;"))
    && !upload01Holds(plant(`${API}/topics/route.ts`, "findPatientIdentifiers(t)", "[]"))
    && !upload01Holds(plant(GEN, "outcomes: true,", "outcomes: false,")));
  ok("P32. ⚠ K15 goes red when the engine reads a table or names a product",
    !engineNeutral(new Map([...HOLD, [ENGINE, (HOLD.get(ENGINE) ?? "") + '\nconst x = (a: any) => a.from("individual_scholar_chunk");']]), REAL)
    && !engineNeutral(HOLD, plant(GEN, "screen: findPatientIdentifiers,", "")));
  ok("P24. ⚠ K4 goes red when a decision is updated instead of appended",
    trailEdits(plant(STORE, ".insert({ user_id: userId, map_id: mapId, decision,", ".update({ user_id: userId, map_id: mapId, decision,")).length > 0);
  ok("P25. ⚠ K5 goes red when the notes check is given the unsplit text, or the background is shown without its box",
    !explanationChecked(plant(GEN, "check: checkExplanation(split.main, asked, passages)", "check: checkExplanation(r.text, asked, passages)"))
    && !supplementaryApart(plant(CLIENT, "<BeyondNotes s={item.supplementary} />", "")));
  ok("P26. ⚠ K6 goes red when case steps skip the blind verification",
    !caseStepsChecked(plant(GEN, "const verified = applyVerification(check.kept, v.text);", "const verified = { kept: check.kept, rejected: [] };")));
  ok("P27. ⚠ K7 goes red when the MVP question read starts selecting a 388 column",
    !failsClosed(plant(STORE, 'const QUESTION_COLS = "id, material_id,', 'const QUESTION_COLS = "id, competency_id, material_id,')));
  ok("P28. ⚠ K8 goes red when the link route trusts the competency id from the body",
    !addChecksCatalogue(plant(`${API}/mappings/route.ts`, "competencyId: competency.id, layer: competency.layer", "competencyId: body.competencyId, layer: competency.layer")));
  ok("P29. ⚠ K9 goes red when code names a profession",
    professionNamed(plant(CAT, "export const LAYERS", 'export const DEFAULT_PROFESSION = "Nursing";\nexport const LAYERS')).length > 0);
  if (MIG390) ok("P33. ⚠ K16 goes red when 390 enforces only the AI direction again",
    !mig390Shape(MIG390.replace("and (source = 'ai' or (model is null and prompt_version is null and confidence is null))", "")));
  if (MIG389) ok("P31. ⚠ K13 goes red when 389 drops a layer or touches another table",
    !mig389Shape(MIG389.replace("'advanced', 'specialty'", "'specialty'")) && !mig389Shape(`${MIG389}\nalter table individual_scholar_question drop column case_title`));
  if (MIG387 && MIG388) ok("P30. ⚠ K10 goes red when the trail loses its cascade allowance, or configuration gains a policy",
    !mig388Shape(MIG388.replace("pg_trigger_depth() > 1", "false"))
    && !mig387Shape(`${MIG387}\ncreate policy x on individual_scholar_programme for select using (true)`));

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
