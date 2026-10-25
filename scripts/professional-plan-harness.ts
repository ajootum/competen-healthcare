/**
 * PROFESSIONAL DEVELOPMENT PLANNING HARNESS -- COMPETEN-PROFESSIONAL-PLAN-01, Professional Stage 3 (migration 480).
 * Pure/local: reads source and the migration, imports the pure rules. No database, no network.
 *
 *   S  schema: own-row RLS on every 480 table, no write policy, no scope/verified/score column; the Stage 3/4 contract
 *      (an activity stores no completion, hours, credits, evidence or actual dates; completed only with a CPD entry or
 *      learning record; one activity per record; completed never outlives the record); goal and activity history
 *      written by trigger, append-only with the cascade path; every cross-person reference a composite key; links
 *      unlinked once, never deleted; reviews append-only.
 *   F  form and lifecycle: only the description is required; statuses in any order; reopening follows the policy;
 *      addressed is the person's judgement (done) and nothing verifies.
 *   C  the contract in code: plan code never writes a CPD entry, a learning record or any Learning table; completed is
 *      set only where a record is attached; the three Stage 4 exports exist.
 *   L  learning and competencies: discovery through the Learning catalogue only, policy-gated, never enrolment or
 *      purchase; competency links only to offered competencies, policy-gated.
 *   P  privacy: plans are read only by Professional code, never by AI grounding, Passport, share or /verify; plan AI
 *      never sends reflections and saves nothing.
 *   M  MVP compatibility: the MVP goals path and plan section are kept for when 480 is absent.
 *   H  nothing hard-codes a profession or a country.
 *
 * Every check is proven able to fail: section X plants one violation per check, in memory, and expects RED.
 *
 *   npx tsx scripts/professional-plan-harness.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY } from "../src/lib/individual/policy";
import { checkGoalStatusChange, parseActivityForm, parseGoalForm, parseReview } from "../src/lib/individual/professional/plan-form";
import { PLAN_TABLES } from "../src/lib/individual/professional/plan-vocabulary";

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
const MIG_FILE = "supabase/migrations/480-individual-professional-development-plan.sql";
const MIG = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase().replace(/\r\n/g, "\n") : "";
const STORE = "src/lib/individual/professional/plan-store.ts";
const FORM = "src/lib/individual/professional/plan-form.ts";
const VOCAB = "src/lib/individual/professional/plan-vocabulary.ts";
const API = "src/app/api/individual/professional/";
const ACTIVITIES = API + "activities/route.ts", LINKS = API + "plan-links/route.ts", MILESTONES = API + "milestones/route.ts";
const REVIEWS = API + "goal-reviews/route.ts", SUGGEST = API + "plan-suggestions/route.ts", GOALS = API + "goals/route.ts";
const WORKSPACE = "src/app/individual/_components/professional/plan-workspace.tsx";
const ASSIST = "src/app/individual/_components/professional/PlanAssist.tsx";
const PAGE = "src/app/individual/(app)/[experience]/(professional)/development/page.tsx";
const STAGE3_FILES = [STORE, FORM, VOCAB, ACTIVITIES, LINKS, MILESTONES, REVIEWS, SUGGEST, WORKSPACE, ASSIST];
const TABLES = [...PLAN_TABLES] as string[];
const PLAN_TABLE_RE = /individual_professional_(goal_history|activity|activity_goal|activity_history|milestone|plan_competency|goal_evidence|goal_review)\b/;
const isProfessionalCode = (f: string) => /^src\/(lib\/individual\/professional|app\/api\/individual\/professional|app\/individual\/_components\/professional|app\/individual\/\(app\)\/\[experience\]\/\(professional\))\//.test(f);

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
  const bad = blocks.filter(b => /\b(hospital_id|organisation_id|tenant_id|workspace_id|verif[a-z_]*|defici[a-z_]*|score[a-z_]*)\b/.test(b[2])).map(b => b[1]);
  const added = [...m.matchAll(/alter table individual_professional_goal add column if not exists ([a-z_]+)/g)].map(x => x[1]).filter(c => /verif|defici|hospital|organisation_id|score|certif/.test(c));
  return { ok: blocks.length === TABLES.length && bad.length === 0 && added.length === 0, detail: `${blocks.length} tables; ${[...bad, ...added].join(", ")}` };
};
const checkContract = (m: string): R => {
  const act = tableBody(m, "individual_professional_activity");
  const stores = /\b(hours|cpd_points|credits?|evidence_class|completed_at|completed_on|actual_start|actual_end|certificate[a-z_]*)\b/.test(act);
  const completedNeedsRecord = /\(status <> 'completed' or cpd_id is not null or learning_record_id is not null\)/.test(m);
  const onePerRecord = /create unique index if not exists ux_individual_professional_activity_cpd\s+on individual_professional_activity\(cpd_id\)/.test(m)
    && /create unique index if not exists ux_individual_professional_activity_record\s+on individual_professional_activity\(learning_record_id\)/.test(m);
  const cleared = /if new\.status = 'completed' and new\.cpd_id is null and new\.learning_record_id is null\s+and \(old\.cpd_id is not null or old\.learning_record_id is not null\) then\s+new\.status := 'planned';/.test(m)
    && /before update on individual_professional_activity\s+for each row execute function individual_professional_activity_record_cleared\(\)/.test(m);
  const evidenceNoRecords = !/\b(cpd_id|learning_record_id)\b/.test(tableBody(m, "individual_professional_goal_evidence"));
  return { ok: act.length > 0 && !stores && completedNeedsRecord && onePerRecord && cleared && evidenceNoRecords,
    detail: `no completion/hours/evidence/actual dates ${!stores}, completed needs a record ${completedNeedsRecord}, one activity per record ${onePerRecord}, completed cleared with the record ${cleared}, CPD reaches a goal only through an activity ${evidenceNoRecords}` };
};
const checkHistory = (m: string, src: Sources): R => {
  const goal = /after insert or update on individual_professional_goal\b/.test(m) && /insert into individual_professional_goal_history/.test(m);
  const act = /after insert or update on individual_professional_activity\b/.test(m) && /insert into individual_professional_activity_history/.test(m);
  const append = ["goal_history", "activity_history", "goal_review"].every(t => new RegExp(`before update or delete on individual_professional_${t}\\s+for each row execute function individual_professional_stage3_append_only\\(\\)`).test(m))
    && /if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then\s+return old;/.test(m);
  const codeWrites = [...src].filter(([, s]) => /from\(\s*"individual_professional_(goal|activity)_history"\s*\)\s*\.(insert|update|upsert|delete)\(/.test(s)).map(([f]) => f);
  const reviewWrites = [...src].filter(([, s]) => /from\(\s*"individual_professional_goal_review"\s*\)\s*\.(update|upsert|delete)\(/.test(s)).map(([f]) => f);
  return { ok: goal && act && append && codeWrites.length === 0 && reviewWrites.length === 0,
    detail: `goal history ${goal}, activity history ${act}, append-only with cascade ${append}, code writes history ${codeWrites.join(",")}, review rewrites ${reviewWrites.join(",")}` };
};
const checkComposite = (m: string): R => {
  const goalRefs = (m.match(/foreign key \(goal_id, user_id\) references individual_professional_goal\(id, user_id\)/g) ?? []).length;
  const actRefs = (m.match(/foreign key \(activity_id, user_id\) references individual_professional_activity\(id, user_id\)/g) ?? []).length;
  const others = [/foreign key \(learning_record_id, user_id\) references learning_record\(id, user_id\)/, /foreign key \(cpd_id, user_id\) references individual_professional_cpd\(id, user_id\)/,
    /foreign key \(depends_on_activity_id, user_id\) references individual_professional_activity\(id, user_id\)/, /foreign key \(evidence_id, user_id\) references individual_professional_evidence\(id, user_id\)/,
    /foreign key \(reflection_id, user_id\) references individual_professional_reflection\(id, user_id\)/, /foreign key \(aspiration_item_id, user_id\) references individual_professional_profile_item\(id, user_id\)/]
    .filter(re => !re.test(m)).length;
  // goal: history, activity_goal, milestone, plan_competency, goal_evidence, review = 6. activity: activity_goal, history, plan_competency = 3.
  return { ok: goalRefs === 6 && actRefs === 3 && others === 0, detail: `goal refs ${goalRefs}/6, activity refs ${actRefs}/3, other composite refs missing ${others}` };
};
const checkLinks = (m: string): R => {
  const once = /if old\.unlinked_at is null and new\.unlinked_at is not null\s+and \(to_jsonb\(new\) - 'unlinked_at'\) = \(to_jsonb\(old\) - 'unlinked_at'\) then/.test(m);
  const guarded = ["plan_competency", "goal_evidence"].every(t => new RegExp(`before update or delete on individual_professional_${t}\\s+for each row execute function individual_professional_stage3_link_guard\\(\\)`).test(m));
  const version = /framework_version text,/.test(tableBody(m, "individual_professional_plan_competency"));
  const decisions = /decision in \('continue', 'revise', 'reprioritise', 'addressed', 'deferred', 'retired', 'reopened'\)/.test(m);
  return { ok: once && guarded && version && decisions, detail: `unlink once ${once}, both guarded ${guarded}, version kept ${version}, review decisions ${decisions}` };
};

// ── F ──
const checkOnlyTitle = (src: Sources): R => {
  const p = DEFAULT_POLICY.professionalPlan;
  const parsed = parseGoalForm({ title: "ECG interpretation" }, p);
  const noTitle = parseGoalForm({ outcome: "x" }, p);
  const ws = src.get(WORKSPACE) ?? "";
  const fieldsFn = ws.slice(ws.indexOf("export function GoalFields"), ws.indexOf("export function PlanOverview"));
  const requiredCount = (fieldsFn.match(/\brequired\b/g) ?? []).length;
  return { ok: parsed.ok && !!parsed.ok && parsed.value.target_date === null && !noTitle.ok && requiredCount === 1, detail: `description only ${parsed.ok}, no description refused ${!noTitle.ok}, required inputs ${requiredCount}` };
};
const checkLifecycle = (fn: typeof checkGoalStatusChange, review: typeof parseReview): R => {
  const base = DEFAULT_POLICY.professionalPlan;
  const free = fn("planned", "done", base).ok && fn("deferred", "planned", base).ok && fn("in_progress", "deferred", base).ok;
  const reopen = fn("done", "in_progress", base).ok && !fn("done", "in_progress", { ...base, reopen: "off" }).ok;
  const unknown = !fn("planned", "verified", base).ok && !fn("planned", "certified", base).ok;
  const a = review({ decision: "addressed" }, "in_progress", base);
  const addressed = a.ok && a.value.status === "done" && !review({ decision: "certified" }, "in_progress", base).ok;
  return { ok: free && reopen && unknown && addressed, detail: `any order ${free}, reopen rule ${reopen}, no verified status ${unknown}, addressed is done and nothing more ${addressed}` };
};
const checkNoCompletedByHand = (parse: typeof parseActivityForm): R => {
  const p = DEFAULT_POLICY.professionalPlan;
  const refused = !parse({ title: "Mentor sessions", status: "completed" }, p).ok;
  const r = parse({ title: "Mentor sessions", hours: 3, evidence_class: "verified", actual_end: "2026-10-01" }, p);
  const ignores = r.ok && !("hours" in r.value) && !("evidence_class" in r.value) && !("actual_end" in r.value);
  return { ok: refused && ignores, detail: `completed refused ${refused}, hours/evidence/actual dates never read ${ignores}` };
};

// ── C ──
const checkContractInCode = (src: Sources): R => {
  const recordWrites = STAGE3_FILES.filter(f => /from\(\s*"(individual_professional_cpd|learning_[a-z_]+|individual_professional_evidence|individual_professional_reflection)"\s*\)\s*\.(insert|update|upsert|delete)\(/.test(src.get(f) ?? ""));
  const store = src.get(STORE) ?? "";
  const completedAt = [...store.matchAll(/status: "completed"/g)].map(m => {
    const before = store.slice(0, m.index ?? 0);
    return before.lastIndexOf("export async function attachRecordToActivity") > before.lastIndexOf("export async function linkCpdToGoal") ? "attach"
      : before.lastIndexOf("export async function linkCpdToGoal") > before.lastIndexOf("export async function attachRecordToActivity") ? "link" : "other";
  });
  const onlyWithRecord = completedAt.length === 2 && completedAt.includes("attach") && completedAt.includes("link");
  const exports = ["linkCpdToGoal", "attachRecordToActivity", "goalsForRecord"].every(n => new RegExp(`export async function ${n}\\(`).test(store));
  const noHours = !/\b(hours|cpd_points|credits)\s*:/.test(store);
  return { ok: recordWrites.length === 0 && onlyWithRecord && exports && noHours,
    detail: `writes a record of what happened ${recordWrites.join(",")}, completed set only with a record ${onlyWithRecord} (${completedAt.join(",")}), Stage 4 exports ${exports}, no hours written ${noHours}` };
};

// ── L ──
const checkLearningAndCompetencies = (src: Sources): R => {
  const page = src.get(PAGE) ?? "";
  const discovery = /if \(goal && pp\.learning !== "off" && learning\.enabled\) \{/.test(page) && /publishedCatalogue\(ctx\.admin, \{ competencyId: id \}\)/.test(page);
  const noCommerce = STAGE3_FILES.concat(PAGE).every(f => !/\benrol\(|grantCourseAccess|checkout|purchase\(|stripe/i.test(src.get(f) ?? ""));
  const store = src.get(STORE) ?? "";
  const offeredOnly = /const c = offered\.find\(x => x\.competencyId === competencyId\);\s+if \(!c\) return \{ ok: false/.test(store) && /loadCatalogueFor\(ctx\.admin, "professional"\)/.test(src.get(LINKS) ?? "");
  const gated = /professionalPlan\.competencyLinks !== "offered"\) return refuse\(/.test(src.get(LINKS) ?? "");
  return { ok: discovery && noCommerce && offeredOnly && gated, detail: `catalogue discovery gated ${discovery}, no enrol or purchase ${noCommerce}, offered competencies only ${offeredOnly}, links policy-gated ${gated}` };
};

// ── P ──
const checkPlanPrivacy = (src: Sources): R => {
  const readers = [...src].filter(([f, s]) => PLAN_TABLE_RE.test(s) && /from\(\s*"individual_professional_/.test(s) && !isProfessionalCode(f)).map(([f]) => f);
  const grounding = ["src/lib/individual/personal-ai.ts", "src/lib/individual/professional/assistant.ts", "src/lib/individual/professional/profile-ai.ts", "src/lib/individual/passport.ts",
    "src/lib/individual/professional/passport-records.ts", "src/lib/individual/professional/share.ts", "src/lib/individual/professional/share-profile.ts", "src/app/verify/[token]/page.tsx"]
    .filter(f => PLAN_TABLE_RE.test(src.get(f) ?? "") || /loadPlanWorkspace|plan-store/.test(src.get(f) ?? ""));
  const reflRead = STAGE3_FILES.filter(f => /from\(\s*"individual_professional_reflection"\s*\)/.test(src.get(f) ?? ""));
  return { ok: readers.length === 0 && grounding.length === 0 && reflRead.length === 0,
    detail: `plan tables read outside Professional ${readers.join(",")}, in grounding/Passport/share ${grounding.join(",")}, plan code reading reflections ${reflRead.join(",")}` };
};
const checkPlanAi = (src: Sources): R => {
  const r = src.get(SUGGEST) ?? "";
  const gated = /professionalPlan\.ai !== "on"\) return refuse\(/.test(r) && /askProfessionalAssistant\(ctx, req, aiPlanQuestion\(kind, goal\)\)/.test(r);
  const savesNothing = !/\.(insert|update|upsert|delete)\(/.test(r.replace(/await audit\([^;]*;/g, ""));
  const goalOnly = /\.select\("id, title, intended_outcome"\)/.test(r) && !/reflection/i.test((src.get(FORM) ?? "").slice((src.get(FORM) ?? "").indexOf("export function aiPlanQuestion"), (src.get(FORM) ?? "").indexOf("export function parseAiPlanLines")));
  const acceptOnly = /onAccept=\{\(\) => accept\(/.test(src.get(ASSIST) ?? "") && !/useEffect/.test(src.get(ASSIST) ?? "");
  return { ok: gated && savesNothing && goalOnly && acceptOnly, detail: `policy-gated through the one Professional AI helper ${gated}, the route saves nothing ${savesNothing}, only the goal's own words are sent ${goalOnly}, added only on the person's click ${acceptOnly}` };
};

// ── M ──
const checkMvpKept = (src: Sources): R => {
  const route = src.get(GOALS) ?? "";
  const page = src.get(PAGE) ?? "";
  const legacy = /if \(isStage3\(fields\)\) \{/.test(route) && /const parsed = parseGoal\(fields\);/.test(route) && /const status = parseGoalStatus\(fields\.status\);/.test(route);
  const section = /\{!stage3 && <Section id="plan-h" title="Learning plan"/.test(page) && /const stage3 = pw\.provisioned && pw\.goals !== null;/.test(page);
  return { ok: legacy && section, detail: `MVP route path ${legacy}, MVP section when 480 absent ${section}` };
};

// ── H ──
const checkNoHardcoding = (src: Sources): R => {
  const bad = STAGE3_FILES.filter(f => /uganda|\bnurs(e|es|ing)\b|paediatric|pediatric|midwi/i.test(src.get(f) ?? ""));
  return { ok: bad.length === 0 && STAGE3_FILES.every(f => src.has(f)), detail: `${bad.join(", ")}${STAGE3_FILES.filter(f => !src.has(f)).map(f => ` missing ${f}`).join("")}` };
};

function main() {
  console.log("PROFESSIONAL DEVELOPMENT PLANNING HARNESS (COMPETEN-PROFESSIONAL-PLAN-01 Stage 3)\n");
  const run = (name: string, r: R) => ok(name, r.ok, r.detail);
  ok("0a. the Stage 3 source and migration 480 were found", !!MIG && ALL.has(STORE));
  ok("0b. ⚠ the comment strip kept real code", /\.insert\(/.test(ALL.get(STORE) ?? ""));
  run("S1. own-row SELECT RLS on all eight 480 tables, no write policy, no experience_code default", checkRls(MIG));
  run("S2. no scope, verified, deficiency or score column anywhere 480 adds one", checkColumns(MIG));
  run("S3. the Stage 3/4 contract in the schema: no completion, hours or evidence on an activity; completed only with a record; one activity per record; completed cleared with its record", checkContract(MIG));
  run("S4. goal and activity history written by trigger; trails and reviews append-only with the cascade path; code never writes history", checkHistory(MIG, ALL));
  run("S5. every cross-person reference is a composite (id, user_id) key", checkComposite(MIG));
  run("S6. competency and evidence links unlinked once, never deleted; versions kept; review decisions fixed", checkLinks(MIG));
  run("F1. only the description is required: on the form and in the parser; no target date needed", checkOnlyTitle(ALL));
  run("F2. statuses in any order; reopening follows the policy; addressed is done and verifies nothing", checkLifecycle(checkGoalStatusChange, parseReview));
  run("F3. completed is never typed in; hours, evidence class and actual dates are never read from a form", checkNoCompletedByHand(parseActivityForm));
  run("C1. plan code writes no CPD entry, learning record, evidence or reflection; completed is set only with a record; the Stage 4 exports exist", checkContractInCode(ALL));
  run("L1. learning discovery through the catalogue only, policy-gated, never enrolment or purchase; competency links offered-only and gated", checkLearningAndCompetencies(ALL));
  run("P1. plans are read only by Professional code, never by AI grounding, Passport, share or /verify; plan code never reads reflections", checkPlanPrivacy(ALL));
  run("P2. plan AI: policy-gated through the one Professional helper, sends only the goal, saves nothing, adds only on the person's click", checkPlanAi(ALL));
  run("M1. the MVP goals path and plan section are kept for when 480 is absent", checkMvpKept(ALL));
  run("H1. no profession or country hard-coded in the Stage 3 code", checkNoHardcoding(ALL));

  console.log("\n  planted-failure controls (in memory, nothing on disk changes):");
  const red = (name: string, r: R) => ok(`X. ${name} goes RED`, !r.ok, r.detail);
  const plant = (f: string, from: string | RegExp, to: string) => { const m = new Map(ALL); m.set(f, (m.get(f) ?? "").replace(from, to)); return m; };
  const add = (f: string, code: string) => { const m = new Map(ALL); m.set(f, `${m.get(f) ?? ""}\n${code}`); return m; };
  red("S1 on a write policy", checkRls(MIG + "\ncreate policy p on individual_professional_activity for insert with check (true)"));
  red("S2 on a score column", checkColumns(MIG + "\nalter table individual_professional_goal add column if not exists goal_score int"));
  red("S3 on hours stored on an activity", checkContract(MIG.replace("  planned_end date,\n  provider text,", "  planned_end date,\n  hours numeric,\n  provider text,")));
  red("S3 on completed without a record", checkContract(MIG.replace("(status <> 'completed' or cpd_id is not null or learning_record_id is not null)", "true")));
  red("S3 on CPD as direct goal evidence", checkContract(MIG.replace("  goal_id uuid not null,\n  evidence_id uuid,", "  goal_id uuid not null,\n  cpd_id uuid,\n  evidence_id uuid,")));
  red("S4 on code writing the goal history", checkHistory(MIG, add(STORE, `admin.from("individual_professional_goal_history").insert({})`)));
  red("S4 on a review rewritten", checkHistory(MIG, add(STORE, `admin.from("individual_professional_goal_review").update({})`)));
  red("S5 on a single-column learning record link", checkComposite(MIG.replace("foreign key (learning_record_id, user_id) references learning_record(id, user_id)", "foreign key (learning_record_id) references learning_record(id)")));
  red("S5 on one single-column goal link of six", checkComposite(MIG.replace("foreign key (goal_id, user_id) references individual_professional_goal(id, user_id)", "foreign key (goal_id) references individual_professional_goal(id)")));
  red("S6 on a link that may be rewritten", checkLinks(MIG.replace("and (to_jsonb(new) - 'unlinked_at') = (to_jsonb(old) - 'unlinked_at') then", "then")));
  red("F1 on a second required field", checkOnlyTitle(plant(WORKSPACE, `<textarea id={id("outcome")} name="outcome"`, `<textarea required id={id("outcome")} name="outcome"`)));
  red("F2 on a review that certifies", checkLifecycle(checkGoalStatusChange, ((b: Record<string, unknown>, s: string, p: Parameters<typeof parseReview>[2]) => b.decision === "certified" ? { ok: true, value: { columns: {}, decision: "addressed", status: "done", priority: null } } : parseReview(b, s, p)) as typeof parseReview));
  red("F3 on completed accepted from a form", checkNoCompletedByHand(((b: Record<string, unknown>, p: Parameters<typeof parseActivityForm>[1], partial?: boolean) => b.status === "completed" ? { ok: true, value: { title: "x", status: "completed" } } : parseActivityForm(b, p, partial)) as typeof parseActivityForm));
  red("C1 on plan code writing a CPD entry", checkContractInCode(add(STORE, `admin.from("individual_professional_cpd").insert({ title: "x" })`)));
  red("C1 on completed set without a record", checkContractInCode(plant(STORE, `const { data, error } = await admin.from("individual_professional_activity").insert({ ...cols, user_id: userId, experience_code: ORIGIN })`, `const { data, error } = await admin.from("individual_professional_activity").insert({ ...cols, status: "completed", user_id: userId, experience_code: ORIGIN })`)));
  red("C1 on a missing Stage 4 export", checkContractInCode(plant(STORE, "export async function goalsForRecord(", "async function goalsForRecord(")));
  red("L1 on enrolment from a goal", checkLearningAndCompetencies(add(WORKSPACE, "await enrol(admin, userId, id);")));
  red("L1 on a link to any competency", checkLearningAndCompetencies(plant(STORE, "const c = offered.find(x => x.competencyId === competencyId);\n  if (!c) return { ok: false", "const c = offered[0];\n  if (false) return { ok: false")));
  red("P1 on the Passport reading plans", checkPlanPrivacy(add("src/lib/individual/passport.ts", `admin.from("individual_professional_goal_review").select("learned")`)));
  red("P1 on plan code reading reflections", checkPlanPrivacy(add(STORE, `admin.from("individual_professional_reflection").select("body")`)));
  red("P2 on an ungated plan AI", checkPlanAi(plant(SUGGEST, `professionalPlan.ai !== "on") return refuse(`, `professionalPlan.ai === "never") return refuse(`)));
  red("P2 on a route that saves suggestions", checkPlanAi(add(SUGGEST, `await ctx.admin.from("individual_professional_activity").insert(items);`)));
  red("P2 on suggestions added without a click", checkPlanAi(add(ASSIST, "useEffect(() => { void 0; }, []);")));
  red("M1 on a page that drops the MVP plan", checkMvpKept(plant(PAGE, `{!stage3 && <Section id="plan-h" title="Learning plan"`, `{false && <Section id="plan-h" title="Old"`)));
  red("H1 on a hard-coded country", checkNoHardcoding(add(VOCAB, `export const COUNTRY = "Uganda";`)));

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
