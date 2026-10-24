/**
 * CLINICAL-CONTENT APPROVAL -- STATIC HARNESS (owner decision D2, migration 395).
 *
 *   npx tsx scripts/clinical-review-harness.ts
 *
 * No credentials, no network. Each check has a planted violation that must turn it RED.
 *   V1  395: the content hash and snapshot are computed by the trigger, versions and decisions are append-only
 *       with the cascade path, at least one and at most five approvals, the submitter is an author, RLS on, no policy
 *   V2  the decision guard refuses each of: not independent, not authorised (position-based), out of scope, stale
 *   V3  authority goes through positions: approve to the reviewer position (plus HQ home), govern to the quality council
 *   V4  the HQ doors: each route gated first by its own capability, POST only, and neither publishes anything
 *   V5  the route map gives governance its own capability and lists both in the HQ catalogue
 *   V6  approved comes only from clinical review: a catalogue entry cannot make content approved, and the
 *       curation route refuses "approved"
 *   V7  the Holdings AI rule: private formative material is never presented as approved or used to decide
 *   V8  nothing profession-specific is hard-coded in the approval code
 */
import { readFileSync, existsSync } from "node:fs";
import { assembleCatalogue, withClinicalReview } from "../src/lib/competency/foundation";
import { checkStatusChange } from "../src/lib/competency/catalogue-entries";
import { clinicalStatus } from "../src/lib/competency/clinical-review";
import { presentableAsApproved, usableForDecision } from "../src/lib/competency/content-governance";

const F = {
  mig: "supabase/migrations/395-clinical-content-approval.sql",
  lib: "src/lib/competency/clinical-review.ts",
  hq: "src/lib/competency/clinical-review-hq.ts",
  route: "src/app/api/hq/clinical-review/route.ts",
  govRoute: "src/app/api/hq/clinical-review/governance/route.ts",
  page: "src/app/super-admin/clinical-review/page.tsx",
  govPage: "src/app/super-admin/clinical-review/governance/page.tsx",
  spaces: "src/lib/hq/spaces.ts",
  found: "src/lib/competency/foundation.ts",
} as const;
type K = keyof typeof F;
type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const RAW: Src = new Map(Object.values(F).map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const code = (src: Src, k: K) => k === "mig" ? (src.get(F[k]) ?? "").split("\n").filter(l => !l.trim().startsWith("--")).join("\n").toLowerCase()
  : k === "spaces" ? (src.get(F[k]) ?? "") : strip(src.get(F[k]) ?? "");
const HAS_MIG = !!RAW.get(F.mig);

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
type R = { ok: boolean; detail: string };

const checkSchema = (src: Src): R => {
  const m = code(src, "mig");
  const computed = /new\.content_hash := competency_content_hash\(new\.competency_id\);/.test(m) && /new\.content_snapshot := \(/.test(m);
  const appendOnly = (m.match(/if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then\s+return old;/g) ?? []).length >= 2
    && /clinical_content_version is append-only/.test(m) && /clinical_review_decision is append-only/.test(m);
  const counts = /check \(required_approvals between 1 and 5\s+and submitted_by = any\(authored_by\)/.test(m);
  const rls = ["clinical_content_version", "clinical_reviewer_scope", "clinical_review_decision"].every(t => m.includes(`alter table ${t} enable row level security`)) && !/create policy/.test(m);
  const shared = /only competencies of shared frameworks are clinically reviewed here/.test(m);
  return { ok: computed && appendOnly && counts && rls && shared, detail: `computed ${computed}, append-only ${appendOnly}, counts ${counts}, rls ${rls}, shared only ${shared}` };
};
const checkGuard = (src: Src): R => {
  const m = code(src, "mig");
  const g = m.slice(m.indexOf("create or replace function public.clinical_review_decision_guard()"), m.indexOf("drop trigger if exists clinical_review_decision_guard"));
  const independent = /if new\.reviewer_id = v_version\.submitted_by or new\.reviewer_id = any\(v_version\.authored_by\) then\s+raise exception 'clinical_review_decision: not independent/.test(g);
  const authorised = /a\.person_id = new\.reviewer_id\s+and a\.status = 'active'/.test(g) && /pc\.capability_code = 'hq\.quality\.clinical\.approve'\s+and pc\.effective_to is null/.test(g) && /raise exception 'clinical_review_decision: not authorised/.test(g);
  const scoped = /if not clinical_scope_covers\(new\.appointment_id, v_version\.competency_id\) then\s+raise exception 'clinical_review_decision: out of scope/.test(g);
  const current = /if competency_content_hash\(v_version\.competency_id\) is distinct from v_version\.content_hash then\s+raise exception 'clinical_review_decision: stale/.test(g);
  const once = /create unique index if not exists ux_clinical_review_decision_reviewer\s+on clinical_review_decision\(version_id, reviewer_id\);/.test(m);
  return { ok: independent && authorised && scoped && current && once, detail: `independent ${independent}, authorised ${authorised}, scoped ${scoped}, current ${current}, once ${once}` };
};
const checkAuthority = (src: Src): R => {
  const m = code(src, "mig");
  const reviewer = /from \(values \('clinical_content_reviewer'\)\) as p\(code\)\s+cross join \(values \('hq\.quality\.clinical\.approve'\), \('hq\.platform\.home\.view'\)\) as c\(code\)/.test(m);
  const council = /from \(values \('quality_council_member'\)\) as p\(code\)\s+cross join \(values \('hq\.quality\.clinical\.govern'\)\) as c\(code\)/.test(m);
  const noApproveElsewhere = (m.match(/'hq\.quality\.clinical\.approve'\)/g) ?? []).length === 1;
  return { ok: reviewer && council && noApproveElsewhere, detail: `reviewer grants ${reviewer}, council govern ${council}, approve granted once ${noApproveElsewhere}` };
};
const gatedFirst = (s: string, cap: string) => {
  const body = s.slice(s.indexOf("export async function POST"));
  return body.indexOf(`await hqApiGate(["${cap}"])`) > -1 && body.indexOf(`await hqApiGate(["${cap}"])`) === body.indexOf("await ")
    && /if \(isHqRefusal\(ctx\)\) return ctx;/.test(body) && !/export async function (GET|PUT|PATCH|DELETE)/.test(s);
};
const pageGatedFirst = (s: string, cap: string) => { const b = s.slice(s.indexOf("export default async function")); return b.indexOf(`await requireHqCapability("${cap}")`) > -1 && b.indexOf(`await requireHqCapability("${cap}")`) === b.indexOf("await "); };
const checkDoors = (src: Src): R => {
  const r = code(src, "route"), g = code(src, "govRoute"), p = code(src, "page"), gp = code(src, "govPage");
  const gates = gatedFirst(r, "hq.quality.clinical.approve") && gatedFirst(g, "hq.quality.clinical.govern")
    && pageGatedFirst(p, "hq.quality.clinical.approve") && pageGatedFirst(gp, "hq.quality.clinical.govern");
  const noPublish = !/transitionFramework|pub_status/.test(r + g + p + gp);
  const noBypass = !/from\("clinical_review_decision"\)\.(update|delete)|from\("clinical_content_version"\)\.(update|delete)/.test(r + g + code(src, "lib") + code(src, "hq"));
  return { ok: gates && noPublish && noBypass, detail: `gated first ${gates}, never publishes ${noPublish}, no rewrite of reviews ${noBypass}` };
};
const checkRouteMap = (src: Src): R => {
  const s = code(src, "spaces");
  const gov = s.indexOf(`{ prefix: "/super-admin/clinical-review/governance", capability: "hq.quality.clinical.govern" }`);
  const appr = s.indexOf(`{ prefix: "/super-admin/clinical-review",       capability: "hq.quality.clinical.approve" }`);
  const caps = /\{ code: "hq\.quality\.clinical\.approve",\s+space: "quality"\s+\}/.test(s) && /\{ code: "hq\.quality\.clinical\.govern",\s+space: "quality"\s+\}/.test(s);
  return { ok: gov > -1 && appr > gov && caps, detail: `governance at ${gov}, approve at ${appr} (governance must come first), catalogue ${caps}` };
};
const FIX = {
  frameworks: [{ id: "cat", name: "C", code: "C", competency_layer: null, profession_term_id: null }],
  homeFrameworks: [], domains: [{ id: "d", framework_id: "cat", name: "D" }], competencies: [{ id: "a", domain_id: "d", name: "A" }],
  cpus: [], levels: [], terms: [], dependencies: [], equivalencies: [], practices: [],
  entries: [{ catalogue_id: "cat", competency_id: "a", content_status: "approved" }],
};
const checkApprovedOnlyByReview = (assemble: typeof assembleCatalogue, overlay: typeof withClinicalReview, check: typeof checkStatusChange): R => {
  const fromEntry = assemble(FIX as never)[0]?.contentStatus;
  const reviewed = overlay(assemble(FIX as never), new Map([["a", clinicalStatus("h", [{ id: "v", competency_id: "a", content_hash: "h", required_approvals: 1, created_at: "" }], [{ version_id: "v", decision: "approved", created_at: "" }])]]))[0]?.contentStatus;
  const stale = overlay(assemble(FIX as never), new Map([["a", clinicalStatus("h2", [{ id: "v", competency_id: "a", content_hash: "h", required_approvals: 1, created_at: "" }], [{ version_id: "v", decision: "approved", created_at: "" }])]]))[0]?.contentStatus;
  const refused = !check("approved", "Reviewed by the lead nurse").ok;
  return { ok: fromEntry !== "approved" && reviewed === "approved" && stale !== "approved" && refused, detail: `entry gives ${fromEntry}, approved review gives ${reviewed}, stale gives ${stale}, curation refuses approved ${refused}` };
};
const checkAiRule = (present: typeof presentableAsApproved, usable: typeof usableForDecision): R => {
  const ok1 = !present("private_formative", true) && !usable("private_formative", true) && !present("shared_clinical", false) && present("shared_clinical", true) && !usable("formal_assessment", false);
  return { ok: ok1, detail: "private formative must never be approved or decisive, shared and assessment only when approved" };
};
const checkNotProfessionSpecific = (src: Src): R => {
  const bad = (["mig", "lib", "hq", "route", "govRoute"] as K[]).filter(k => /\b(nurs(e|ing)|medic(ine|al doctor)|midwi|pharmac)\w*/i.test(code(src, k)));
  return { ok: bad.length === 0, detail: bad.map(k => F[k]).join(", ") };
};

const plant = (k: K, from: string, to: string): Src => {
  const s = RAW.get(F[k]) ?? ""; const n = s.replace(from, to);
  if (n === s) throw new Error(`plant did not apply in ${F[k]}: ${from.slice(0, 70)}`);
  return new Map([...RAW, [F[k], n]]);
};
const red = (n: string, r: R) => ok(`P. ${n} goes RED`, !r.ok, "the check passed on a planted violation");
const run = (n: string, r: R) => ok(n, r.ok, r.detail);

console.log("CLINICAL REVIEW HARNESS (owner D2, migration 395)\n");
const missing = Object.entries(F).filter(([k, f]) => k !== "mig" && !RAW.get(f)).map(([, f]) => f);
ok("0. every pinned file exists", missing.length === 0, missing.join(", "));
if (HAS_MIG) {
  run("V1. 395: hash and snapshot computed by the trigger, append-only with the cascade path, 1 to 5 approvals, shared only, RLS on", checkSchema(RAW));
  run("V2. the decision guard refuses: not independent, not authorised by position, out of scope, stale -- one decision per reviewer", checkGuard(RAW));
  run("V3. authority through positions: approve to the reviewer position (with HQ home), govern to the quality council", checkAuthority(RAW));
} else console.log(`  PEND  V1-V3. ${F.mig} is not in this checkout`);
run("V4. each HQ door gated first by its own capability, POST only, never publishing or rewriting a review", checkDoors(RAW));
run("V5. the route map gives governance its own capability before approve, and both are in the HQ catalogue", checkRouteMap(RAW));
run("V6. approved comes only from clinical review of the current content, never from a catalogue entry", checkApprovedOnlyByReview(assembleCatalogue, withClinicalReview, checkStatusChange));
run("V7. the Holdings AI rule: private formative material is never approved or decisive", checkAiRule(presentableAsApproved, usableForDecision));
run("V8. nothing profession-specific is hard-coded in the approval code", checkNotProfessionSpecific(RAW));
console.log("");
if (HAS_MIG) {
  red("V1 on a hash the writer sends", checkSchema(plant("mig", "  new.content_hash := competency_content_hash(new.competency_id);\n", "")));
  red("V1 on zero required approvals", checkSchema(plant("mig", "check (required_approvals between 1 and 5", "check (required_approvals between 0 and 5")));
  red("V2 on self-approval", checkGuard(plant("mig", "if new.reviewer_id = v_version.submitted_by or new.reviewer_id = any(v_version.authored_by) then", "if false then")));
  red("V2 on an out-of-scope reviewer", checkGuard(plant("mig", "if not clinical_scope_covers(new.appointment_id, v_version.competency_id) then", "if false then")));
  red("V2 on approving a stale version", checkGuard(plant("mig", "if competency_content_hash(v_version.competency_id) is distinct from v_version.content_hash then", "if false then")));
  red("V2 on a suspended appointment", checkGuard(plant("mig", "and a.status = 'active'\n       and o.is_active", "and o.is_active")));
  red("V3 on approve granted to the council", checkAuthority(plant("mig", "cross join (values ('hq.quality.clinical.govern')) as c(code)", "cross join (values ('hq.quality.clinical.govern'), ('hq.quality.clinical.approve')) as c(code)")));
}
red("V4 on a read before the gate", checkDoors(plant("route", `  const ctx = await hqApiGate(["hq.quality.clinical.approve"]);`, `  await req.text();\n  const ctx = await hqApiGate(["hq.quality.clinical.approve"]);`)));
red("V4 on governance gated by approve", checkDoors(plant("govRoute", `const ctx = await hqApiGate(["hq.quality.clinical.govern"]);`, `const ctx = await hqApiGate(["hq.quality.clinical.approve"]);`)));
red("V4 on a publish from the review door", checkDoors(plant("route", "  if (!r.ok) return refuse(409, r.error);", "  if (!r.ok) return refuse(409, r.error);\n  await ctx.admin.from(\"frameworks\").update({ pub_status: \"published\" });")));
red("V5 on approve before governance", checkRouteMap(plant("spaces", `  { prefix: "/super-admin/clinical-review/governance", capability: "hq.quality.clinical.govern" },\n`, "")));
red("V6 when an entry makes content approved", checkApprovedOnlyByReview(r => assembleCatalogue(r).map(c => ({ ...c, contentStatus: "approved" as const })), withClinicalReview, checkStatusChange));
red("V6 when a stale approval still counts", checkApprovedOnlyByReview(assembleCatalogue, (i, m) => withClinicalReview(i, new Map([...m].map(([k, v]) => [k, { ...v, state: v.state === "stale" ? "approved" as const : v.state }]))), checkStatusChange));
red("V6 when curation accepts approved", checkApprovedOnlyByReview(assembleCatalogue, withClinicalReview, () => ({ ok: true, status: "approved", note: null })));
red("V7 when AI study material counts as approved", checkAiRule(() => true, usableForDecision));
red("V8 on a nursing-only rule", checkNotProfessionSpecific(plant("lib", "export const REVIEWER_POSITION", "const NURSING_ONLY = true;\nexport const REVIEWER_POSITION")));

console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
