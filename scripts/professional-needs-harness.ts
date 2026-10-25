/**
 * PROFESSIONAL DEVELOPMENT NEEDS HARNESS -- COMPETEN-PROFESSIONAL-NEEDS-01, Professional Stage 2 (migration 470).
 * Pure/local: reads source and the migration, imports the pure rules. No database, no network.
 *
 *   S  schema: own-row RLS on every 470 table, no write policy, no scope/verified/deficiency column; stage and
 *      status kept in step both ways; history written by trigger, append-only with the cascade path; a competency
 *      link only ever unlinked once; suggestions need a basis; cross-person references unrepresentable.
 *   F  form and lifecycle: only the title is required; stages are free (no sequence), reopening follows the policy.
 *   P  privacy: reflections are read only by the needs store, never by AI grounding, Passport, share or plans; AI on
 *      a reflection only through the authorised, policy-gated action.
 *   A  suggestions: AI and rule suggestions are stored as suggestions and become needs only on "accepted"; every one
 *      has a basis; rules read only the person's aspirations and expiry dates.
 *   C  competencies and learning: links only to offered competencies, policy-gated; learning discovery only through
 *      the Learning catalogue, never enrolment or purchase.
 *   M  MVP compatibility: the MVP needs path and section are kept for when 470 is absent.
 *   H  nothing hard-codes a profession or a country.
 *
 * Every check is proven able to fail: section X plants one violation per check, in memory, and expects RED.
 *
 *   npx tsx scripts/professional-needs-harness.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY } from "../src/lib/individual/policy";
import { NEED_STAGES } from "../src/lib/individual/professional/needs-vocabulary";
import { checkStageChange, parseAiSuggestions, parseNeedForm } from "../src/lib/individual/professional/needs-form";
import { ruleSuggestions } from "../src/lib/individual/professional/needs-store";

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
const MIG_FILE = "supabase/migrations/470-individual-professional-development-needs.sql";
const MIG = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase().replace(/\r\n/g, "\n") : "";
const STORE = "src/lib/individual/professional/needs-store.ts";
const SUGGEST_ROUTE = "src/app/api/individual/professional/need-suggestions/route.ts";
const REFL_ROUTE = "src/app/api/individual/professional/reflections/route.ts";
const LINKS_ROUTE = "src/app/api/individual/professional/need-links/route.ts";
const NEEDS_ROUTE = "src/app/api/individual/professional/needs/route.ts";
const WORKSPACE = "src/app/individual/_components/professional/needs-workspace.tsx";
const PAGE = "src/app/individual/(app)/[experience]/(professional)/development/page.tsx";
const TABLES = ["individual_professional_reflection", "individual_professional_need_history", "individual_professional_need_competency", "individual_professional_goal_need", "individual_professional_need_suggestion"];
const STAGE2_FILES = [STORE, SUGGEST_ROUTE, REFL_ROUTE, LINKS_ROUTE, WORKSPACE, "src/lib/individual/professional/needs-form.ts", "src/lib/individual/professional/needs-vocabulary.ts",
  "src/lib/individual/professional/needs-ai.ts", "src/app/individual/_components/professional/NeedSuggestions.tsx"];

// ── S ──
const checkRls = (m: string): R => {
  const bad = TABLES.filter(t => !m.includes(`alter table ${t} enable row level security`) || !new RegExp(`create policy ${t}_read_own on ${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(m));
  const write = /create policy [a-z_]+ on individual_professional_[a-z_]+\s+for (insert|update|delete|all)/.test(m);
  const def = /experience_code text not null default/.test(m);
  return { ok: bad.length === 0 && !write && !def, detail: `${bad.join(",")}${write ? " write-policy" : ""}${def ? " default" : ""}` };
};
const checkColumns = (m: string): R => {
  const blocks = [...m.matchAll(/create table if not exists (individual_professional_[a-z_]+) \(([\s\S]*?)\n\);/g)];
  const bad = blocks.filter(b => /\b(hospital_id|organisation_id|tenant_id|workspace_id|verif[a-z_]*|defici[a-z_]*|incompeten[a-z_]*)\b/.test(b[2])).map(b => b[1]);
  const added = [...m.matchAll(/alter table individual_professional_need add column if not exists ([a-z_]+)/g)].map(x => x[1]).filter(c => /verif|defici|hospital|organisation_id|score/.test(c));
  return { ok: blocks.length === TABLES.length && bad.length === 0 && added.length === 0, detail: `${blocks.length} tables; ${[...bad, ...added].join(", ")}` };
};
const checkStageSync = (m: string): R => {
  const list = NEED_STAGES.every(s => m.includes(`'${s}'`));
  const check = /add constraint individual_professional_need_stage_status check \(\s+stage_code is null or status = case when stage_code = 'addressed' then 'met'\s+when stage_code in \('deferred', 'retired'\) then 'closed'\s+else 'open' end/.test(m);
  const fromStatus = /elsif new\.status is distinct from old\.status then\s+new\.stage_code := case new\.status when 'met' then 'addressed'/.test(m);
  const toStatus = /new\.status := case when new\.stage_code = 'addressed' then 'met'/.test(m) && /before insert or update on individual_professional_need\b/.test(m);
  return { ok: list && check && fromStatus && toStatus, detail: `stages ${list}, check ${check}, MVP status moves the stage ${fromStatus}, stage moves the status ${toStatus}` };
};
const checkHistory = (m: string, src: Sources): R => {
  const trigger = /after insert or update on individual_professional_need\b/.test(m) && /insert into individual_professional_need_history/.test(m);
  const append = /before update or delete on individual_professional_need_history/.test(m) && /if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then\s+return old;/.test(m);
  const codeWrites = [...src].filter(([, s]) => /from\(\s*"individual_professional_need_history"\s*\)\s*\.(insert|update|upsert|delete)\(/.test(s)).map(([f]) => f);
  return { ok: trigger && append && codeWrites.length === 0, detail: `trigger-written ${trigger}, append-only with cascade ${append}, code writes ${codeWrites.join(",")}` };
};
const checkLinkGuard = (m: string): R => {
  const once = /if old\.unlinked_at is null and new\.unlinked_at is not null/.test(m);
  const noDelete = /if tg_op = 'delete' then\s+if pg_trigger_depth\(\) > 1 then\s+return old;\s+end if;\s+raise exception 'individual_professional_need_competency keeps its history/.test(m);
  // All three need references (history, competency link, goal link) are composite, not just one of them.
  const fk = (m.match(/foreign key \(need_id, user_id\) references individual_professional_need\(id, user_id\)/g) ?? []).length === 3 && /foreign key \(goal_id, user_id\) references individual_professional_goal\(id, user_id\)/.test(m)
    && /foreign key \(reflection_id, user_id\) references individual_professional_reflection\(id, user_id\)/.test(m) && /foreign key \(accepted_need_id, user_id\) references individual_professional_need\(id, user_id\)/.test(m);
  const version = /framework_version text,/.test(m);
  return { ok: once && noDelete && fk && version, detail: `unlink once ${once}, no delete ${noDelete}, composite keys ${fk}, version kept ${version}` };
};
const checkSuggestionShape = (m: string): R => {
  const basis = /char_length\(btrim\(basis\)\) between 3 and 1000/.test(m);
  const decided = /\(\(status = 'suggested'\) = \(decided_at is null\)\)/.test(m);
  const sources = /source in \('ai', 'rule'\)/.test(m);
  return { ok: basis && decided && sources, detail: `basis ${basis}, decided-at ${decided}, sources ${sources}` };
};

// ── F ──
const checkOnlyTitle = (src: Sources): R => {
  const p = DEFAULT_POLICY.professionalNeeds;
  const parsed = parseNeedForm({ title: "Recognising deterioration in infants" }, p);
  const noTitle = parseNeedForm({ why: "x" }, p);
  const ws = src.get(WORKSPACE) ?? "";
  const fieldsFn = ws.slice(ws.indexOf("export function NeedFields"), ws.indexOf("export function NeedsOverview"));
  const requiredCount = (fieldsFn.match(/\brequired\b/g) ?? []).length;
  return { ok: parsed.ok && !noTitle.ok && requiredCount === 1, detail: `title only ${parsed.ok}, no title refused ${!noTitle.ok}, required inputs ${requiredCount}` };
};
const checkFreeStages = (fn: typeof checkStageChange): R => {
  const base = DEFAULT_POLICY.professionalNeeds;
  const jump = fn("identified", "addressed", base).ok && fn("exploring", "identified", base).ok;
  const reopenOn = fn("addressed", "exploring", base).ok;
  const reopenOff = !fn("addressed", "exploring", { ...base, reopen: "off" }).ok && fn("addressed", "retired", { ...base, reopen: "off" }).ok;
  const unknown = !fn("identified", "done", base).ok;
  return { ok: jump && reopenOn && reopenOff && unknown, detail: `free order ${jump}, reopen on ${reopenOn}, reopen off ${reopenOff}, unknown refused ${unknown}` };
};

// ── P ──
const checkReflectionPrivacy = (src: Sources): R => {
  const readers = [...src].filter(([, s]) => /from\(\s*"individual_professional_reflection"\s*\)/.test(s)).map(([f]) => f);
  const grounding = ["src/lib/individual/personal-ai.ts", "src/lib/individual/professional/profile-ai.ts", "src/lib/individual/professional/assistant.ts", "src/lib/individual/passport.ts",
    "src/lib/individual/professional/passport-records.ts", "src/lib/individual/professional/share.ts", "src/lib/individual/professional/share-profile.ts", "src/app/verify/[token]/page.tsx"]
    .filter(f => /reflection_id|individual_professional_reflection|reflectionOf|loadNeedsWorkspace/.test(src.get(f) ?? ""));
  const r = src.get(REFL_ROUTE) ?? "";
  const gated = /if \(policy\.reflectionAi !== "on"\) return refuse\(/.test(r) && /const r = await reflectionOf\(ctx\.admin, ctx\.userId, fields\.id\);/.test(r);
  return { ok: readers.length === 1 && readers[0] === STORE && grounding.length === 0 && gated, detail: `readers ${readers.join(",")}, grounding/share touches ${grounding.join(",")}, AI action gated to one own reflection ${gated}` };
};

// ── A ──
const checkSuggestionsAccepted = (src: Sources, parse: typeof parseAiSuggestions, rules: typeof ruleSuggestions): R => {
  const r = src.get(SUGGEST_ROUTE) ?? "";
  const creates = [...r.matchAll(/await createNeed\(/g)].map(m => m.index ?? 0);
  const onlyAccepted = creates.length === 2 && creates.every(i => /if \(decision === "accepted"\) \{\s*$/.test(r.slice(Math.max(0, i - 200), i).trimEnd() + " ") || /if \(decision === "accepted"\) \{[^}]*$/.test(r.slice(Math.max(0, i - 200), i)));
  const gated = /if \(policy\.aiSuggestions !== "on"\) return refuse\(/.test(r) && /saveAiSuggestions\(/.test(r);
  const parsed = parse("Here you go:\n- Leading handover :: your aspiration to lead\n- no basis here\n* Teaching students :: you listed education as an interest\nThanks");
  const parseOk = parsed.length === 2 && parsed.every(p => p.basis.length >= 3);
  const today = "2026-10-25";
  const none = rules({ items: [{ id: "a", section: "employment", title: "Ward nurse", expires_on: null, superseded_at: null, withdrawn_at: null }], needs: [], decided: [], today, windowDays: 90 });
  const asp = rules({ items: [{ id: "b", section: "aspiration", title: "Become a nurse educator", expires_on: null, superseded_at: null, withdrawn_at: null }], needs: [], decided: [], today, windowDays: 90 });
  const dismissed = rules({ items: [{ id: "b", section: "aspiration", title: "x y z", expires_on: null, superseded_at: null, withdrawn_at: null }], needs: [], decided: [{ rule_key: "aspiration:b", status: "dismissed", decided_at: "2026-01-01T00:00:00Z" }], today, windowDays: 90 });
  const deferredBack = rules({ items: [{ id: "b", section: "aspiration", title: "x y z", expires_on: null, superseded_at: null, withdrawn_at: null }], needs: [], decided: [{ rule_key: "aspiration:b", status: "deferred", decided_at: "2026-01-01T00:00:00Z" }], today, windowDays: 90 });
  const rulesOk = none.length === 0 && asp.length === 1 && /aspiration/.test(asp[0].basis) && dismissed.length === 0 && deferredBack.length === 1;
  return { ok: onlyAccepted && gated && parseOk && rulesOk, detail: `needs only on accepted ${onlyAccepted}, AI gated and stored as suggestions ${gated}, parse needs a basis ${parseOk}, rules ${rulesOk}` };
};

// ── C ──
const checkCompetencyAndLearning = (src: Sources): R => {
  const store = src.get(STORE) ?? "";
  const links = src.get(LINKS_ROUTE) ?? "";
  const offeredOnly = /const c = offered\.find\(x => x\.competencyId === competencyId\);\s+if \(!c\) return \{ ok: false/.test(store) && /loadCatalogueFor\(ctx\.admin, "professional"\)/.test(links);
  const gated = /professionalNeeds\.competencyLinks !== "offered"\) return refuse\(/.test(links);
  const page = src.get(PAGE) ?? "";
  const discovery = /publishedCatalogue\(ctx\.admin, \{ competencyId: id \}\)/.test(page) && /np\.learning === "on" && learning\.enabled/.test(page);
  const noCommerce = STAGE2_FILES.concat(PAGE).every(f => !/\benrol\(|grantCourseAccess|checkout|purchase\(/.test(src.get(f) ?? ""));
  return { ok: offeredOnly && gated && discovery && noCommerce, detail: `offered only ${offeredOnly}, policy-gated ${gated}, catalogue discovery gated ${discovery}, no enrol or purchase ${noCommerce}` };
};

// ── M ──
const checkMvpKept = (src: Sources): R => {
  const route = src.get(NEEDS_ROUTE) ?? "";
  const page = src.get(PAGE) ?? "";
  const legacy = /if \(fields\.stage2 === true \|\| fields\.stage2 === "true"\) \{/.test(route) && /const parsed = parseNeed\(fields\);/.test(route) && /const status = parseNeedStatus\(fields\.status\);/.test(route);
  const section = /\{!stage2 && <Section id="needs-h" title="Development needs"/.test(page) && /const stage2 = ws\.provisioned && ws\.needs !== null;/.test(page);
  return { ok: legacy && section, detail: `MVP route path ${legacy}, MVP section when 470 absent ${section}` };
};

// ── H ──
const checkNoHardcoding = (src: Sources): R => {
  const bad = STAGE2_FILES.filter(f => /uganda|\bnurs(e|es|ing)\b|paediatric|pediatric/i.test(src.get(f) ?? ""));
  return { ok: bad.length === 0 && STAGE2_FILES.every(f => src.has(f)), detail: bad.join(", ") };
};

function main() {
  console.log("PROFESSIONAL DEVELOPMENT NEEDS HARNESS (COMPETEN-PROFESSIONAL-NEEDS-01 Stage 2)\n");
  const run = (name: string, r: R) => ok(name, r.ok, r.detail);
  ok("0a. the Stage 2 source and migration 470 were found", !!MIG && ALL.has(STORE));
  ok("0b. ⚠ the comment strip kept real code", /\.insert\(/.test(ALL.get(STORE) ?? ""));
  run("S1. own-row SELECT RLS on all five 470 tables, no write policy, no experience_code default", checkRls(MIG));
  run("S2. no scope, verified, deficiency or score column anywhere 470 adds one", checkColumns(MIG));
  run("S3. stage and status agree, kept in step by trigger both ways (stage moves status, the MVP status moves the stage)", checkStageSync(MIG));
  run("S4. need history: written by trigger, append-only with the cascade path, never written by code", checkHistory(MIG, ALL));
  run("S5. a competency link keeps its framework version and is only ever unlinked once; every cross-person reference is a composite key", checkLinkGuard(MIG));
  run("S6. a suggestion needs a basis, a source and a decision time when decided", checkSuggestionShape(MIG));
  run("F1. only the title is required: on the form and in the parser", checkOnlyTitle(ALL));
  run("F2. stages in any order; reopening follows the policy; unknown stages refused", checkFreeStages(checkStageChange));
  run("P1. reflections: read only by the needs store, in no AI grounding, Passport, share or /verify; AI only through the gated action on one own reflection", checkReflectionPrivacy(ALL));
  run("A1. suggestions become needs only when accepted, AI ones are policy-gated and stored as suggestions, each has a basis, rules read only aspirations and expiry dates", checkSuggestionsAccepted(ALL, parseAiSuggestions, ruleSuggestions));
  run("C1. competency links only to offered competencies, policy-gated; learning discovery through the catalogue only, never enrolment or purchase", checkCompetencyAndLearning(ALL));
  run("M1. the MVP needs path and section are kept for when 470 is absent", checkMvpKept(ALL));
  run("H1. no profession or country hard-coded in the Stage 2 code", checkNoHardcoding(ALL));

  console.log("\n  planted-failure controls (in memory, nothing on disk changes):");
  const red = (name: string, r: R) => ok(`X. ${name} goes RED`, !r.ok, r.detail);
  const plant = (f: string, from: string | RegExp, to: string) => { const m = new Map(ALL); m.set(f, (m.get(f) ?? "").replace(from, to)); return m; };
  const add = (f: string, code: string) => { const m = new Map(ALL); m.set(f, `${m.get(f) ?? ""}\n${code}`); return m; };
  red("S1 on a write policy", checkRls(MIG + "\ncreate policy p on individual_professional_reflection for insert with check (true)"));
  red("S2 on a deficiency column", checkColumns(MIG + "\nalter table individual_professional_need add column if not exists deficiency_score int"));
  red("S3 without the MVP status branch", checkStageSync(MIG.replace("elsif new.status is distinct from old.status then", "elsif false then")));
  red("S4 on code writing the history", checkHistory(MIG, add(STORE, `admin.from("individual_professional_need_history").insert({})`)));
  red("S4 without the cascade path", checkHistory(MIG.replace("if tg_op = 'delete' and pg_trigger_depth() > 1 then", "if false then"), ALL));
  red("S5 on a single-column need link", checkLinkGuard(MIG.replace("foreign key (need_id, user_id) references individual_professional_need(id, user_id)", "foreign key (need_id) references individual_professional_need(id)")));
  red("S6 on a suggestion with no basis rule", checkSuggestionShape(MIG.replace("char_length(btrim(basis)) between 3 and 1000", "true")));
  red("F1 on a second required field", checkOnlyTitle(plant(WORKSPACE, `<input id={id("context")} name="context"`, `<input required id={id("context")} name="context"`)));
  red("F2 on an enforced sequence", checkFreeStages(((from: string | null, to: unknown, p: Parameters<typeof checkStageChange>[2]) => (from === "identified" && to === "addressed" ? { ok: false, error: "x" } : checkStageChange(from, to, p))) as typeof checkStageChange));
  red("P1 on reflections read by the Passport", checkReflectionPrivacy(add("src/lib/individual/passport.ts", `admin.from("individual_professional_reflection").select("body")`)));
  red("P1 on an ungated reflection summary", checkReflectionPrivacy(plant(REFL_ROUTE, `if (policy.reflectionAi !== "on") return refuse(`, `if (false) return refuse(`)));
  red("A1 on a suggestion that becomes a need on generation", checkSuggestionsAccepted(add(SUGGEST_ROUTE, "await createNeed(ctx.admin, ctx.userId, { title: items[0].title });"), parseAiSuggestions, ruleSuggestions));
  red("A1 on AI suggestions without a basis", checkSuggestionsAccepted(ALL, ((a: string) => a.split("\n").filter(Boolean).map(t => ({ title: t, basis: "" }))) as typeof parseAiSuggestions, ruleSuggestions));
  red("A1 on a rule that infers from evidence", checkSuggestionsAccepted(ALL, parseAiSuggestions, ((i: Parameters<typeof ruleSuggestions>[0]) => [...ruleSuggestions(i), { key: "evidence:x", title: "Fix your gap", basis: "No evidence recorded", aspirationItemId: null }]) as typeof ruleSuggestions));
  red("C1 on a link to any competency", checkCompetencyAndLearning(plant(STORE, "const c = offered.find(x => x.competencyId === competencyId);\n  if (!c) return { ok: false", "const c = offered[0];\n  if (false) return { ok: false")));
  red("C1 on enrolment from a need", checkCompetencyAndLearning(add(WORKSPACE, "await enrol(admin, userId, id);")));
  red("M1 on a page that drops the MVP section", checkMvpKept(plant(PAGE, `{!stage2 && <Section id="needs-h" title="Development needs"`, `{false && <Section id="needs-h" title="Old"`)));
  red("H1 on a hard-coded profession", checkNoHardcoding(add(STORE, `const DEFAULT = "nursing";`)));

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
