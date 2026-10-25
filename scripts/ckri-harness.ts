/**
 * CKRI -- STATIC HARNESS (COMPETEN-KNOWLEDGE-RESEARCH-01, migrations 440-443).
 *
 *   npx tsx scripts/ckri-harness.ts
 *
 * No credentials, no network. Every check runs twice: on the real sources (must PASS) and on a copy with ONE planted
 * violation (must go RED). A check whose plant does not turn it red is reported as a failure of the check itself.
 * The behaviour of the triggers is proven separately against a disposable database (scripts/ckri-db/test-44x.sql).
 *
 *   K1-1  440: aggregate-only access is the only representable value, the cohort floor is 5, the purpose permission
 *         set has no content-contribution or personal-AI value, a research-study purpose always needs ethics
 *   K1-2  440: independence and authority -- an author cannot activate their purpose, a proposer cannot decide their
 *         project, and both go through ckri_holds_capability
 *   K1-3  440: both trails are written only by their record trigger, append-only, with the cascade path
 *   K1-4  Scholar never reads CKRI participation to decide anything: no Individual file imports lib/knowledge or names
 *         a ckri_ table, except the one research-choices route
 *   K1-5  the research-choices route: one CKRI permission per request, and a withdrawal is never gated
 *   K1-6  the HQ governance route: its capability fixed server-side, then the gate, before any action
 *   K1-7  CKRI library code names no individual_scholar_ table except the person's own AI consent
 *   K1-8  the HQ catalogue lists both capabilities, and governance resolves to govern, not propose
 *   K2-1..4  441: no forbidden column, catalogue sources only, population/floor/no person column/revoked, policy-set disclosure
 *   K3-1..4  442: 422 guard branches unchanged, three facts kept apart, no student reference, needs from reported cells
 *   K4-1..4  443: aggregate-only access, independence, integrity fields, datasets are snapshots
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Src = Map<string, string>;
const F = {
  m440: "supabase/migrations/440-ckri-research-governance.sql",
  m441: "supabase/migrations/441-ckri-aggregate-intelligence.sql",
  m442: "supabase/migrations/442-ckri-educator-knowledge.sql",
  m422: "supabase/migrations/422-clinical-cases-on-clinical-approval.sql",
  m443: "supabase/migrations/443-ckri-research-workspace.sql",
  workspace: "src/lib/knowledge/workspace.ts",
  researchRoute: "src/app/api/hq/knowledge/research/route.ts",
  intelRoute: "src/app/api/hq/knowledge/intelligence/route.ts",
  intel: "src/lib/knowledge/intelligence.ts",
  gov: "src/lib/knowledge/governance.ts",
  rgov: "src/lib/knowledge/research-governance.ts",
  contracts: "src/lib/knowledge/data-contracts.ts",
  choices: "src/app/api/individual/research/route.ts",
  hqGov: "src/app/api/hq/knowledge/governance/route.ts",
  spaces: "src/lib/hq/spaces.ts",
} as const;
type K = keyof typeof F;

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) { const p = join(dir, e).replace(/\\/g, "/"); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(p)) out.push(p); }
  return out;
};
const INDIVIDUAL = [...walk("src/lib/individual"), ...walk("src/app/api/individual"), ...walk("src/app/(individual)"), ...walk("src/app/individual"), ...walk("src/app/scholar")];
const KNOWLEDGE_LIB = walk("src/lib/knowledge").filter(f => !f.endsWith(".test.ts"));

const RAW: Src = new Map([...Object.values(F), ...INDIVIDUAL, ...KNOWLEDGE_LIB].map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const sqlCode = (s: string) => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").toLowerCase();
const tsCode = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const get = (src: Src, k: K) => (k.startsWith("m") ? sqlCode : tsCode)(src.get(F[k]) ?? "");

type R = { ok: boolean; detail: string };
const r = (ok: boolean, detail = ""): R => ({ ok, detail });

const CHECKS: { id: string; check: (s: Src) => R; plant: (s: Src) => Src }[] = [];
const plantIn = (file: string, from: string | RegExp, to: string) => (s: Src): Src => {
  const n = new Map(s); const v = n.get(file) ?? ""; const w = v.replace(from, to);
  if (w === v) throw new Error(`plant did not apply in ${file}: ${String(from)}`);
  n.set(file, w); return n;
};

CHECKS.push({ id: "K1-1 aggregate only, floor 5, permissions closed, study needs ethics", check: s => {
  const m = get(s, "m440");
  const a = /and data_access = 'aggregate_only'/.test(m);
  const floor = /min_cohort between 5 and 1000/.test(m);
  const perms = /permission in \('collective_analytics', 'research_study'\)/g;
  const permCount = (m.match(perms) ?? []).length;
  const noBad = !/'content_contribution'|'personal_ai_learning'|'row_level'/.test(m);
  const ethics = /\(permission <> 'research_study' or requires_ethics\)/.test(m);
  return r(a && floor && permCount === 2 && noBad && ethics, `aggregate=${a} floor=${floor} permissionChecks=${permCount} noBadValues=${noBad} ethics=${ethics}`);
}, plant: plantIn(F.m440, "and data_access = 'aggregate_only'", "and data_access in ('aggregate_only', 'row_level')") });

CHECKS.push({ id: "K1-2 independence and authority in the triggers", check: s => {
  const m = get(s, "m440");
  const purpose = /if new\.activated_by = new\.created_by then\s+raise exception/.test(m) && /ckri_holds_capability\(new\.activated_by, 'hq\.quality\.research\.govern'\)/.test(m);
  const project = /if new\.decided_by = new\.proposed_by then\s+raise exception/.test(m) && /ckri_holds_capability\(new\.decided_by, 'hq\.quality\.research\.govern'\)/.test(m);
  const propose = /ckri_holds_capability\(new\.proposed_by, 'hq\.quality\.research\.propose'\)/.test(m);
  return r(purpose && project && propose, `purpose=${purpose} project=${project} propose=${propose}`);
}, plant: plantIn(F.m440, "if new.decided_by = new.proposed_by then", "if false then") });

CHECKS.push({ id: "K1-3 trails trigger-written, append-only, cascade path", check: s => {
  const m = get(s, "m440");
  const insertOnlyFromTrigger = /if tg_op = 'insert' then\s+if pg_trigger_depth\(\) > 1 then return new; end if;\s+raise exception/.test(m);
  const cascade = /if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then return old; end if;\s+raise exception '% is append-only'/.test(m);
  const both = /ckri_participation_event_guard before insert or update or delete/.test(m) && /ckri_research_project_event_guard before insert or update or delete/.test(m);
  return r(insertOnlyFromTrigger && cascade && both, `insert=${insertOnlyFromTrigger} cascade=${cascade} bothTables=${both}`);
}, plant: plantIn(F.m440, "if pg_trigger_depth() > 1 then return new; end if;", "return new;") });

CHECKS.push({ id: "K1-4 Scholar never reads CKRI to decide anything", check: s => {
  const offenders = INDIVIDUAL.filter(f => f !== F.choices && /@\/lib\/knowledge|from\(\s*["'`]ckri_/.test(tsCode(s.get(f) ?? "")));
  return r(offenders.length === 0 && INDIVIDUAL.length > 50, `${INDIVIDUAL.length} Individual files scanned, offenders: ${offenders.join(", ") || "none"}`);
}, plant: s => { const n = new Map(s); const f = INDIVIDUAL.find(x => x.endsWith("scholar/http.ts"))!; n.set(f, `import { ckriEnabled } from "@/lib/knowledge/governance";\n${n.get(f)}`); return n; } });

CHECKS.push({ id: "K1-5 one permission per request, withdrawal never gated", check: s => {
  const c = get(s, "choices");
  const onlyTwo = /permission !== "collective_analytics" && permission !== "research_study"/.test(c) && !/personal_ai_learning|content_contribution|individual_scholar_consent|case_candidacy/.test(c);
  const gateInsideGrant = /if \(body\.grant\) \{\s+if \(!\(await ckriEnabled\(ctx\.admin\)\)\)/.test(c) && (c.match(/ckriEnabled\(ctx\.admin\)/g) ?? []).length === 2;
  const noticeInsideGrant = /if \(body\.grant\) \{[\s\S]*?participationNotice\(\)[\s\S]*?\n  \}/.test(c);
  return r(onlyTwo && gateInsideGrant && noticeInsideGrant, `onlyTwo=${onlyTwo} gateOnGrantOnly=${gateInsideGrant} noticeOnGrantOnly=${noticeInsideGrant}`);
}, plant: plantIn(F.choices, "  let noticeVersion: string | null = null;\n", "  if (!(await ckriEnabled(ctx.admin))) return NextResponse.json({ error: CKRI_OFF }, { status: 409 });\n  let noticeVersion: string | null = null;\n") });

CHECKS.push({ id: "K1-6 HQ governance route: capability fixed, then gate, before any action", check: s => {
  const c = get(s, "hqGov");
  const i = (re: RegExp) => c.search(re);
  const order = [i(/const capability = /), i(/await hqApiGate\(\[capability\]\)/), i(/await ckriEnabled\(ctx\.admin\)/), i(/switch \(action\)/)];
  const ok = order.every(x => x >= 0) && order.every((x, k) => k === 0 || x > order[k - 1]);
  const noBrowserActor = !/body\.(decidedBy|actor|changedBy|proposedBy|dataAccess)/.test(c);
  return r(ok && noBrowserActor, `order=${order.join(",")} noBrowserActor=${noBrowserActor}`);
}, plant: plantIn(F.hqGov, "  if (!(await ckriEnabled(ctx.admin))) return refuse(409, CKRI_OFF);\n", "") });

CHECKS.push({ id: "K1-7 CKRI library names no raw Scholar table but the person's own consent", check: s => {
  const hits: string[] = [];
  for (const f of KNOWLEDGE_LIB) for (const m of tsCode(s.get(f) ?? "").matchAll(/from\(\s*["'`](individual_scholar_[a-z_]+)/g)) if (!(f === F.gov && m[1] === "individual_scholar_consent")) hits.push(`${f}:${m[1]}`);
  return r(hits.length === 0 && KNOWLEDGE_LIB.length >= 3, `${KNOWLEDGE_LIB.length} files, hits: ${hits.join(", ") || "none"}`);
}, plant: plantIn(F.rgov, "export async function governanceOverview(admin: any) {", "export async function governanceOverview(admin: any) {\n  await admin.from(\"individual_scholar_attempt\").select(\"correct\");") });

CHECKS.push({ id: "K1-8 HQ catalogue and route intent", check: s => {
  const c = s.get(F.spaces) ?? "";
  const caps = /code: "hq\.quality\.research\.govern"/.test(c) && /code: "hq\.quality\.research\.propose"/.test(c);
  const gi = c.indexOf('"/super-admin/research/governance"'), ri = c.indexOf('prefix: "/super-admin/research",');
  const route = gi > 0 && /"\/super-admin\/research\/governance",\s+capability: "hq\.quality\.research\.govern"/.test(c) && (ri < 0 || gi < ri);
  return r(caps && route, `caps=${caps} governanceRoute=${route}`);
}, plant: plantIn(F.spaces, /"\/super-admin\/research\/governance",(\s+)capability: "hq\.quality\.research\.govern"/, "\"/super-admin/research/governance\",$1capability: \"hq.quality.research.propose\"") });

// ── K2 (migration 441) ─────────────────────────────────────────────────────────────────────────────────────
const K2_SOURCES = new Set(["ckri_participation", "ckri_snapshot", "ckri_snapshot_cell", "practice_platform_flags", "individual_scholar_question",
  "case_library_version", "case_library_version_competency", "case_library_session", "ckri_pop", "ckri_acc", "ckri_ev", "ckri_cev", "ckri_agg",
  "public", "pg_class", "pg_policies"]); // the last three: "revoke ... from public" and the verification select, not data reads
const contractSources = () => new Set((RAW.get(F.contracts) ?? "").match(/source: "([a-z_]+)"/g)?.map(x => x.slice(9, -1)) ?? []);
const forbidden = () => ((RAW.get(F.contracts) ?? "").match(/export const FORBIDDEN_COLUMNS = \[([\s\S]*?)\] as const/)?.[1] ?? "").match(/"([a-z_]+)"/g)?.map(x => x.slice(1, -1)) ?? [];

CHECKS.push({ id: "K2-1 the builder reads no forbidden column", check: s => {
  const m = get(s, "m441"); const cols = forbidden();
  const hits = cols.filter(c => new RegExp(`\\b[a-z_]+\\.${c}\\b|->>?\\s*'${c}'`).test(m));
  return r(cols.length >= 20 && hits.length === 0 && m.length > 1000, `${cols.length} forbidden columns, hits: ${hits.join(", ") || "none"}`);
}, plant: plantIn(F.m441, "x.id::text || ':' || c.competency_id::text", "x.reasoning || ':' || c.competency_id::text") });

CHECKS.push({ id: "K2-2 the builder reads only catalogue sources and its own joins", check: s => {
  const m = get(s, "m441"); const ok = contractSources();
  const read = [...m.matchAll(/\b(?:from|join)\s+([a-z_]+)/g)].map(x => x[1]).filter(t => !["lateral", "select"].includes(t));
  const extra = [...new Set(read.filter(t => !ok.has(t) && !K2_SOURCES.has(t)))];
  return r(read.length > 10 && extra.length === 0, `${read.length} reads, outside the catalogue: ${extra.join(", ") || "none"}`);
}, plant: plantIn(F.m441, "from individual_scholar_learning_session l", "from individual_scholar_learning_session l join individual_scholar_chunk ch on ch.user_id = l.user_id") });

CHECKS.push({ id: "K2-3 population, floor, no person column, execute revoked", check: s => {
  const m = get(s, "m441");
  const pop = /where p\.permission = 'collective_analytics' and p\.scope_key = 'all' and p\.status = 'granted'/.test(m);
  const floor = /if p_min is null or p_min < 5 then/.test(m) && /min_cohort between 5 and 1000/.test(m) && /participants is null or participants >= 5/.test(m);
  const cellCols = (m.match(/create table if not exists ckri_snapshot_cell \(([\s\S]*?)\n\);/)?.[1] ?? "");
  const noPerson = cellCols.length > 100 && !/user|person|profile/.test(cellCols);
  const revoked = /revoke all on function public\.ckri_build_snapshot\([^)]*\) from public, anon, authenticated/.test(m);
  const gate = /flag = 'ckri_research' and enabled is true/.test(m);
  return r(pop && floor && noPerson && revoked && gate, `population=${pop} floor=${floor} noPersonColumn=${noPerson} revoked=${revoked} flagInDb=${gate}`);
}, plant: plantIn(F.m441, "  suppressed     boolean not null,", "  suppressed     boolean not null,\n  user_id        uuid,") });

CHECKS.push({ id: "K2-4 disclosure settings come from the published policy, never the request", check: s => {
  const c = get(s, "intelRoute");
  const fromPolicy = /buildSnapshot\(ctx\.admin, ctx\.userId, await loadCkriPolicy\(ctx\.admin\)/.test(c);
  const noRequestSettings = !/body\.(minCohort|min|roundTo|round|complementary|retain|grain|policy)/.test(c);
  return r(fromPolicy && noRequestSettings, `fromPolicy=${fromPolicy} noRequestSettings=${noRequestSettings}`);
}, plant: plantIn(F.intelRoute, "await loadCkriPolicy(ctx.admin)", "{ ...(await loadCkriPolicy(ctx.admin)), minCohort: Number(body.minCohort) }") });

// ── K3 (migration 442) ─────────────────────────────────────────────────────────────────────────────────────
const fnBody = (sql: string, name: string) => { const i = sql.indexOf(`create or replace function public.${name}()`); const j = sql.indexOf("\n$$;", i); return i < 0 || j < 0 ? "" : sql.slice(i, j); };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
CHECKS.push({ id: "K3-1 the replaced 395/422 guards keep 422's competency and case branches unchanged", check: s => {
  const a = (s.get(F.m422) ?? "").replace(/\r\n/g, "\n"), b = (s.get(F.m442) ?? "").replace(/\r\n/g, "\n");
  const c422 = fnBody(a, "clinical_content_version_guard"), c442 = fnBody(b, "clinical_content_version_guard");
  const d422 = fnBody(a, "clinical_review_decision_guard"), d442 = fnBody(b, "clinical_review_decision_guard");
  const cStripped = c442.replace(/  -- A knowledge resource version \(442\)[\s\S]*?    return new;\n  end if;\n/, "");
  const dStripped = d442.replace(/if v_version\.content_kind = 'resource' then[\s\S]*?\n  elsif v_version\.content_kind = 'case' then/, "if v_version.content_kind = 'case' then");
  const okC = c422.length > 500 && cStripped !== c442 && norm(cStripped) === norm(c422);
  const okD = d422.length > 500 && dStripped !== d442 && norm(dStripped) === norm(d422);
  return r(okC && okD, `contentGuard=${okC} decisionGuard=${okD}`);
}, plant: plantIn(F.m442, "raise exception 'clinical_content_version: a case is put forward for review only as a submitted case version';", "raise notice 'case';") });

CHECKS.push({ id: "K3-2 AI draft, educator-reviewed and clinically approved stay three facts", check: s => {
  const m = get(s, "m442");
  const origin = /new\.origin is distinct from old\.origin or new\.ai_provenance is distinct from old\.ai_provenance/.test(m);
  const reviewBound = /educator_reviewed_hash = content_hash\)\)/.test(m) && /if v\.educator_reviewed_hash is distinct from v\.content_hash then/.test(m);
  const editClears = /if new\.content_hash is distinct from old\.content_hash or new\.educator_reviewed_by is distinct from old\.educator_reviewed_by then\s+new\.educator_reviewed_by := null;/.test(m);
  const publish = /if not ckri_knowledge_approved\(v\.id\) then/.test(m) && /ckri_holds_capability\(p_publisher, 'hq\.quality\.knowledge\.publish'\)/.test(m);
  return r(origin && reviewBound && editClears && publish, `originFrozen=${origin} reviewBoundToHash=${reviewBound} editClearsReview=${editClears} publishNeedsApproval=${publish}`);
}, plant: plantIn(F.m442, "    if new.content_hash is distinct from old.content_hash or new.educator_reviewed_by is distinct from old.educator_reviewed_by then", "    if new.educator_reviewed_by is distinct from old.educator_reviewed_by then") });

CHECKS.push({ id: "K3-3 no K3 column can reference a student or their material", check: s => {
  const m = get(s, "m442");
  const tables = [...m.matchAll(/create table if not exists (ckri_[a-z_]+) \(([\s\S]*?)\n\);/g)];
  const bad = tables.flatMap(t => [...t[2].matchAll(/^\s*([a-z_]+)\s/gm)].map(c => c[1]).filter(c => /user|student|material|private|chunk|upload/.test(c)).map(c => `${t[1]}.${c}`));
  const refs = /references (individual_scholar_|case_candidate)/.test(m);
  return r(tables.length === 4 && bad.length === 0 && !refs, `${tables.length} tables, student columns: ${bad.join(", ") || "none"}, references a Scholar table: ${refs}`);
}, plant: plantIn(F.m442, "  need_id     uuid,\n", "  need_id     uuid,\n  source_material_id uuid,\n") });

CHECKS.push({ id: "K3-4 a need comes from one reported cell, its evidence copied by the database", check: s => {
  const m = get(s, "m442");
  const cell = /if not found or v_cell\.suppressed then/.test(m);
  const copied = /new\.evidence := jsonb_build_object\('participants', v_cell\.participants/.test(m) && /new\.raised_by := new\.changed_by;/.test(m);
  return r(cell && copied, `reportedCellOnly=${cell} evidenceCopied=${copied}`);
}, plant: plantIn(F.m442, "if not found or v_cell.suppressed then", "if not found then") });

// ── K4 (migration 443) ─────────────────────────────────────────────────────────────────────────────────────
CHECKS.push({ id: "K4-1 aggregate-only access, agreements for externals, no team before approval, no accounts created", check: s => {
  const m = get(s, "m443"), w = get(s, "workspace");
  const access = /and access = 'aggregate_only'/.test(m) && !/'row_level'|'pseudonymised'|'identifiable'/.test(m);
  const agreement = /\(not external or char_length\(btrim\(coalesce\(agreement_ref, ''\)\)\) >= 5\)/.test(m);
  const beforeApproval = /if v_status not in \('approved', 'recruiting'\) then\s+raise exception 'ckri_research_member: nobody joins/.test(m);
  const noAccounts = !/insert into (profiles|auth\.)/.test(m) && !/from\(["'`](profiles|auth)/.test(w) && !/auth\.admin/.test(w);
  return r(access && agreement && beforeApproval && noAccounts, `aggregateOnly=${access} agreement=${agreement} noTeamBeforeApproval=${beforeApproval} noAccounts=${noAccounts}`);
}, plant: plantIn(F.m443, "     and access = 'aggregate_only'", "     and access in ('aggregate_only', 'row_level')") });

CHECKS.push({ id: "K4-2 reviewers, dataset approvers and publication deciders are independent of the team", check: s => {
  const m = get(s, "m443");
  const team = "ckri_on_team\\(new\\.project_id, new\\.%s, array\\['lead', 'analyst', 'reviewer', 'external_collaborator'\\]\\)";
  const rev = new RegExp(`if ${team.replace("%s", "reviewer_id")} then\\s+raise exception 'ckri_research_review: not independent`).test(m);
  const ds = new RegExp(`or ${team.replace("%s", "approved_by")} then`).test(m);
  const pub = new RegExp(`or ${team.replace("%s", "decided_by")} then`).test(m);
  return r(rev && ds && pub, `review=${rev} dataset=${ds} publication=${pub}`);
}, plant: plantIn(F.m443, "  if ckri_on_team(new.project_id, new.reviewer_id, array['lead', 'analyst', 'reviewer', 'external_collaborator']) then", "  if false then") });

CHECKS.push({ id: "K4-3 integrity: protocol and output fields required, publication needs attestation and endorsement of the exact manuscript", check: s => {
  const m = get(s, "m443");
  const proto = ["population", "selection_criteria", "instruments", "scoring", "missing_data", "statistical_methods", "limitations", "generalisability"].every(k => new RegExp(`kind <> 'protocol' or ckri_keys_present\\(content, array\\[[^\\]]*'${k}'`).test(m));
  const outp = ["population", "selection", "provenance", "instrument_version", "scoring", "missing_data", "uncertainty", "methods", "limitations", "generalisability", "reproducibility"].every(k => new RegExp(`ckri_keys_present\\(integrity, array\\[[^\\]]*'${k}'`).test(m));
  const ai = /\(not uses_ai_marked or coalesce\(integrity ->> 'ai_marked_statement', ''\) ilike '%not validated%'\)/.test(m);
  const pub = /if not new\.integrity_attested then/.test(m) && /r\.decision = 'endorse' and r\.reviewed_hash = d\.content_hash/.test(m);
  return r(proto && outp && ai && pub, `protocol=${proto} output=${outp} aiDeclared=${ai} publication=${pub}`);
}, plant: plantIn(F.m443, "'uncertainty', 'methods'", "'methods'") });

CHECKS.push({ id: "K4-4 a dataset is a snapshot, never rows, and the workspace reads no learner record", check: s => {
  const m = get(s, "m443"), w = get(s, "workspace"), rt = get(s, "researchRoute");
  const snap = /snapshot_id   uuid not null references ckri_snapshot\(id\)/.test(m) && !/individual_scholar_/.test(m);
  const noRows = !/individual_scholar_|case_library_session/.test(w + rt);
  return r(snap && noRows, `datasetIsSnapshot=${snap} noLearnerReads=${noRows}`);
}, plant: plantIn(F.workspace, "export async function approveDataset(", "export async function rowsFor(admin: any) { return admin.from(\"individual_scholar_attempt\").select(\"correct\"); }\nexport async function approveDataset(") });

let pass = 0; const fails: string[] = [];
for (const c of CHECKS) {
  const real = c.check(RAW);
  let planted: R;
  try { planted = c.check(c.plant(RAW)); } catch (e) { planted = { ok: true, detail: `plant error: ${(e as Error).message}` }; }
  const good = real.ok && !planted.ok;
  if (good) pass++; else fails.push(c.id);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${c.id}\n        real: ${real.ok ? "green" : "RED"} (${real.detail})\n        planted: ${planted.ok ? "STILL GREEN" : "red"} (${planted.detail})`);
}
console.log(`\nCKRI harness: ${pass}/${CHECKS.length} checks pass on the real sources AND go red when their violation is planted.`);
if (fails.length) { console.log(`FAILED: ${fails.join("; ")}`); process.exit(1); }
