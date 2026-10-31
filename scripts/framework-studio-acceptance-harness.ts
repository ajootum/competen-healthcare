/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FRAMEWORK-DESIGN-STUDIO-02 -- STAGING ACCEPTANCE over HTTP (STAGING ONLY). Real database, real routes, one pass each.
 *
 *   cd competen-p2   (holds the staging .env.local; the dev server at BASE_URL points at the same staging project)
 *   $env:NODE_PATH = "<competen-p2>\node_modules;<competen-fds2a>\node_modules"
 *   npx.cmd tsx ..\competen-fds2a\scripts\framework-studio-acceptance-harness.ts
 *
 * Needs staging migrations 750, 751, 752, 760, 761, 770, 771 and a dev server (BASE_URL, default http://localhost:3100)
 * serving this branch. It asserts only what unit tests cannot: the routes against the real triggers.
 *
 *   A1  draft framework: create / edit / retire / restore / move a criterion; the hash moves on substantive edits only
 *   A2  Areas: two Areas, domains assigned, a competency moved to another domain (live in a draft, hash unchanged)
 *   A3  spreadsheet: template; dry-run with one bad row (row-numbered error); good CSV appended, existing untouched
 *   A4  compare: draft against its last published version; revision against published
 *   A5  published governed framework: revision cycle (content edit, new competency, criterion retire, domain rename)
 *   A6  a refused publication applies nothing
 *   A7  organisational move on a published framework: layout draft, applied at publication
 *
 * Fixtures (kept, synthetic, *@competen.test): an author (Competency Author), a clinical reviewer, an independent
 * publisher (Quality Council Member), each with its real appointment; the author's sign-in and the Studio URLs of one
 * draft and one published framework with an OPEN revision go to the scratchpad file named below (never stdout).
 * Frameworks carry a per-run code; they are left in place for the browser check (STAGING_ONLY, never deleted here).
 * Writes docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/acceptance-2026-10-31.md.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin as stagingAdmin, ensureUser, newPassword } from "./fds-browser-fixture";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { assertSafeTarget } from "./production-guard";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";
import { transitionFramework } from "../src/lib/competency/framework-lifecycle";
import { decidePublication } from "../src/lib/competency/framework-publication";
import { loadIndividualCatalogue } from "../src/lib/competency/foundation";
import { SHEET_COLUMNS, toCsv } from "../src/lib/competency/framework-sheet";

assertSafeTarget(process.env.STAGING_SUPABASE_URL ?? "", "STAGING_SUPABASE_URL");
// The staging service-role client (STAGING_SERVICE_ROLE_KEY), made by the fixture after its production guard.
const admin: SupabaseClient & any = stagingAdmin;
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "C:\\Users\\elish\\AppData\\Local\\Temp\\claude\\C--Users-elish-Documents-Competen\\a8637d9f-8e17-4384-a425-178c29a6d626\\scratchpad\\fds2-fixture.txt";
const DOC = resolve(__dirname, "..", "docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/acceptance-2026-10-31.md");
const STUDIO = `${BASE}/super-admin/competencies/authoring`;
const RUN = Date.now().toString(36).toUpperCase();
const code = (s: string) => `FDS2A-${RUN}-${s}`;

const WHO = {
  author: { email: "harness-fds2-author@competen.test", name: "FDS2 acceptance author (synthetic, staging)", role: "competency_author" },
  reviewer: { email: "harness-fds2-reviewer@competen.test", name: "FDS2 acceptance clinical reviewer (synthetic, staging)", role: "clinical_content_reviewer" },
  publisher: { email: "harness-fds2-publisher@competen.test", name: "FDS2 acceptance publisher (synthetic, staging)", role: "quality_council_member" },
} as const;

// ── results ────────────────────────────────────────────────────────────────────────────────────
const results: { id: string; check: string; ok: boolean; evidence: string }[] = [];
function check(id: string, name: string, cond: boolean, evidence = "") {
  results.push({ id, check: name, ok: !!cond, evidence });
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${id}. ${name}${cond ? "" : ` -- ${evidence}`}`);
}
const j = (v: unknown) => JSON.stringify(v);
const short = (v: unknown, n = 220) => { const s = typeof v === "string" ? v : j(v); return s.length > n ? `${s.slice(0, n)}...` : s; };

// ── HTTP ───────────────────────────────────────────────────────────────────────────────────────
type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(jar: Jar, res: Response) {
  for (const c of (res.headers as any).getSetCookie?.() ?? []) {
    const [pair] = c.split(";"); const i = pair.indexOf("=");
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
}
const rid = () => `fds2a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
async function send(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar), "x-request-id": rid() }, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(jar, res);
  const text = await res.text();
  let json: any = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "" };
}
async function signIn(email: string, password: string): Promise<Jar> {
  const jar: Jar = new Map();
  const r = await send("POST", "/api/auth/login", { email, password }, jar);
  if (r.status !== 200) throw new Error(`sign-in of ${email} failed (${r.status})`);
  return jar;
}

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────
function savedPassword(): string | null {
  if (!existsSync(OUT)) return null;
  return /^password: (.+)$/m.exec(readFileSync(OUT, "utf8"))?.[1]?.trim() ?? null;
}
async function platformMember(userId: string) {
  const pm = (await admin.from("platform_membership").select("id, status").eq("user_id", userId).maybeSingle()).data;
  if (!pm) {
    const r = await admin.from("platform_membership").insert({ user_id: userId, status: "active", source: "admin_grant", note: "FDS-02 acceptance fixture. Staging only." });
    if (r.error) throw new Error(`platform_membership: ${r.error.message}`);
  } else if (pm.status !== "active") await admin.from("platform_membership").update({ status: "active" }).eq("id", pm.id);
}
async function appoint(personId: string, name: string, role: string, officeId: string, owner: string | null): Promise<string> {
  const have = ((await admin.from("ogs_office_appointments").select("id, status").eq("person_id", personId).eq("role", role)).data ?? []).find((a: any) => a.status === "active");
  if (have) return have.id;
  const a = await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(owner), office_id: officeId, person_id: personId, person_name: name, role, status: "active" }).select("id").single();
  if (a.error) throw new Error(`the ${role} appointment failed: ${a.error.message}`);
  return a.data.id;
}

type Comp = { id: string; code: string; name: string; domainId: string; skills: string[] };
/** domains: [{ name, comps: [{ key, name, n criteria per component }] }]. Competencies carry a code and standard risk. */
async function buildFramework(opts: { code: string; name: string; layer: string | null }, domains: { name: string; comps: { key: string; name: string }[] }[], comps: [string, string]) {
  const fw = await admin.from("frameworks").insert({ name: opts.name, code: opts.code, description: "FDS-02 acceptance fixture. Synthetic, staging only.",
    library: "core", hospital_id: null, scope: "master", is_active: true, pub_status: "draft", competency_layer: opts.layer }).select("id").single();
  if (fw.error) throw new Error(`framework ${opts.code}: ${fw.error.message}`);
  const out = { id: fw.data.id as string, domains: [] as { id: string; name: string }[], comps: new Map<string, Comp>() };
  for (const [di, d] of domains.entries()) {
    const dom = await admin.from("framework_domains").insert({ framework_id: out.id, name: d.name, sort_order: di }).select("id").single();
    if (dom.error) throw new Error(dom.error.message);
    out.domains.push({ id: dom.data.id, name: d.name });
    for (const [ci, c] of d.comps.entries()) {
      const cc = code(c.key);
      const row = await admin.from("framework_competencies").insert({ domain_id: dom.data.id, code: cc, name: c.name, description: `${c.name}: fixture description.`, risk_category: "standard", sort_order: ci }).select("id").single();
      if (row.error) throw new Error(`competency ${cc}: ${row.error.message}`);
      const rows = [
        ...[1, 2, 3].map(n => ({ name: `${c.name}: performs step ${n}`, component_code: comps[0] })),
        ...[1, 2].map(n => ({ name: `${c.name}: explains reason ${n}`, component_code: comps[1] })),
      ].map((r, i) => ({ competency_id: row.data.id, ...r, sort_order: i }));
      const s = await admin.from("competency_skills").insert(rows).select("id, sort_order");
      if (s.error) throw new Error(s.error.message);
      out.comps.set(c.key, { id: row.data.id, code: cc, name: c.name, domainId: dom.data.id, skills: [...s.data].sort((a: any, b: any) => a.sort_order - b.sort_order).map((x: any) => x.id) });
    }
  }
  return out;
}

// ── database reads ─────────────────────────────────────────────────────────────────────────────
const hashOf = async (id: string): Promise<string | null> => (await admin.rpc("competency_content_hashes", { p_ids: [id] })).data?.[0]?.content_hash ?? null;
const bySort = (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id));
async function tree(fwId: string) {
  const { data, error } = await admin.from("framework_domains").select("id, name, sort_order, area_id, framework_competencies(id, code, name, description, sort_order, learning_outcomes, competency_skills(id, name, sort_order, component_code, is_active))").eq("framework_id", fwId);
  if (error) throw new Error(error.message);
  return [...data].sort(bySort).map((d: any) => ({ ...d, framework_competencies: [...d.framework_competencies].sort(bySort).map((c: any) => ({ ...c, competency_skills: [...c.competency_skills].sort(bySort) })) }));
}
const allComps = (t: any[]) => t.flatMap(d => d.framework_competencies);
const fwRow = async (id: string) => (await admin.from("frameworks").select("id, name, pub_status, version_num, version_major, version_minor, version_revision").eq("id", id).single()).data;
const versions = async (id: string) => ((await admin.from("framework_versions").select("version_num, snapshot, published_by_name").eq("framework_id", id).order("version_num")).data ?? []) as any[];
const learnerRead = async (fwId: string) => j(((await loadIndividualCatalogue(admin, [fwId])) ?? []).slice().sort((a: any, b: any) => String(a.competencyId).localeCompare(String(b.competencyId))));

async function main() {
  console.log(`FRAMEWORK STUDIO 02 ACCEPTANCE -- run ${RUN}, server ${BASE}\n`);
  const login = await fetch(`${BASE}/login`, { redirect: "manual" }).then(r => r.status).catch(() => 0);
  if (!login) throw new Error(`the dev server at ${BASE} is not reachable`);
  for (const t of ["framework_areas", "framework_revision", "framework_revision_domain"]) {
    const p = await admin.from(t).select("*").limit(0);
    if (p.error) throw new Error(`staging lacks ${t} (${p.error.message}): migrations 760/770/771 are required`);
  }
  const owner = await fixtureOwnerId(admin);
  const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
    ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  if (!office) throw new Error("staging has no active HQ office to appoint to");
  const comps = ((await admin.from("competency_assessment_component").select("code, is_active, sort_order").order("sort_order")).data ?? []).filter((c: any) => c.is_active !== false).map((c: any) => c.code as string);
  if (comps.length < 2) throw new Error("fewer than two active assessment components");
  const [C1, C2] = [comps[0], comps[1]];

  // people: the author's password is kept across runs; the other two are reset each run (never printed).
  const pw = { author: savedPassword() ?? newPassword(), reviewer: newPassword(), publisher: newPassword() };
  const ids: Record<string, string> = {};
  for (const k of Object.keys(WHO) as (keyof typeof WHO)[]) {
    const u = await ensureUser(WHO[k], pw[k]);
    ids[k] = u.id;
    await platformMember(u.id);
  }
  const apptId = { author: await appoint(ids.author, WHO.author.name, WHO.author.role, office.id, owner), reviewer: await appoint(ids.reviewer, WHO.reviewer.name, WHO.reviewer.role, office.id, owner),
    publisher: await appoint(ids.publisher, WHO.publisher.name, WHO.publisher.role, office.id, owner) };
  const A = await signIn(WHO.author.email, pw.author), R = await signIn(WHO.reviewer.email, pw.reviewer), P = await signIn(WHO.publisher.email, pw.publisher);
  const authoring = (jar: Jar, body: any) => send("POST", "/api/hq/competency/authoring", body, jar);

  // ═══ A1 -- draft framework: criteria ═══════════════════════════════════════════════════════════
  console.log("A1 draft framework");
  const D = await buildFramework({ code: code("DRAFT"), name: `FDS2 acceptance draft ${RUN}`, layer: "foundational" },
    [{ name: "FDS2 draft domain A", comps: [{ key: "D1", name: "Hand hygiene" }, { key: "D2", name: "Vital signs" }, { key: "D3", name: "Medication safety" }] },
     { name: "FDS2 draft domain B", comps: [{ key: "D4", name: "Wound care" }] },
     { name: "FDS2 draft domain C", comps: [{ key: "D5", name: "Patient handover" }] }], [C1, C2]);
  const d1 = D.comps.get("D1")!;
  const h0 = await hashOf(d1.id);
  const cr = await authoring(A, { action: "create_criterion", competencyId: d1.id, component: C1, text: "Checks the patient identity band before care" });
  const newCrit = cr.json.id as string;
  const h1 = await hashOf(d1.id);
  check("A1.1", "create_criterion: 201 and the competency hash changes", cr.status === 201 && !!newCrit && h1 !== h0, `status ${cr.status}; ${short(cr.json)}`);
  const up = await authoring(A, { action: "update_criterion", criterionId: newCrit, text: "Checks the patient identity band and allergy alert before care" });
  const h2 = await hashOf(d1.id);
  check("A1.2", "update_criterion text: ok and the hash changes", up.status === 200 && up.json.ok && h2 !== h1, `status ${up.status}; ${short(up.json)}`);
  const sr = await authoring(A, { action: "update_criterion", criterionId: newCrit, sourceRef: "Ward policy 4.2" });
  const h2b = await hashOf(d1.id);
  check("A1.3", "update_criterion source reference only: ok and the hash does NOT change (outside the fingerprint)", sr.status === 200 && h2b === h2, `status ${sr.status}; ${short(sr.json)}`);
  const rt = await authoring(A, { action: "retire_criterion", criterionId: newCrit });
  const h3 = await hashOf(d1.id);
  const retiredRow = (await admin.from("competency_skills").select("is_active").eq("id", newCrit).single()).data;
  check("A1.4", "retire_criterion: ok, is_active false (never deleted), hash changes (761)", rt.status === 200 && retiredRow?.is_active === false && h3 !== h2, `status ${rt.status}; ${short(rt.json)}; is_active ${retiredRow?.is_active}`);
  const rs = await authoring(A, { action: "restore_criterion", criterionId: newCrit });
  const h4 = await hashOf(d1.id);
  check("A1.5", "restore_criterion: ok and the hash returns to its earlier value", rs.status === 200 && h4 === h2, `status ${rs.status}; ${short(rs.json)}`);
  const orderBefore = (await admin.from("competency_skills").select("id").eq("competency_id", d1.id).eq("component_code", C1).order("sort_order")).data?.map((x: any) => x.id) ?? [];
  const mv = await authoring(A, { action: "move_criterion", criterionId: d1.skills[0], position: 2 });
  const orderAfter = (await admin.from("competency_skills").select("id").eq("competency_id", d1.id).eq("component_code", C1).order("sort_order")).data?.map((x: any) => x.id) ?? [];
  const h5 = await hashOf(d1.id);
  check("A1.6", "move_criterion within its section (reorder): organisational, hash UNCHANGED, order changed", mv.status === 200 && mv.json.kind === "reorder" && mv.json.substantive === false && h5 === h4 && j(orderBefore) !== j(orderAfter),
    `status ${mv.status}; ${short(mv.json)}; hash same ${h5 === h4}; order changed ${j(orderBefore) !== j(orderAfter)}`);
  const ms = await authoring(A, { action: "move_criterion", criterionId: d1.skills[2], component: C2 });
  const h6 = await hashOf(d1.id);
  const moved = (await admin.from("competency_skills").select("component_code").eq("id", d1.skills[2]).single()).data;
  check("A1.7", "move_criterion to another section: substantive, hash changes", ms.status === 200 && ms.json.substantive === true && moved?.component_code === C2 && h6 !== h5, `status ${ms.status}; ${short(ms.json)}; section ${moved?.component_code}`);
  const row1 = (await admin.from("framework_competencies").select("code, name, description").eq("id", d1.id).single()).data;
  const uc = await authoring(A, { action: "update_competency", competencyId: d1.id, code: row1.code, name: row1.name, description: `${row1.description} Revised wording.`, riskCategory: "standard", learningOutcomes: [] });
  const h7 = await hashOf(d1.id);
  check("A1.8", "update_competency description: ok and the hash changes", uc.status === 200 && h7 !== h6, `status ${uc.status}; ${short(uc.json)}`);

  // ═══ A2 -- Areas ══════════════════════════════════════════════════════════════════════════════
  console.log("A2 Areas");
  const a1 = await authoring(A, { action: "create_area", frameworkId: D.id, name: "Clinical Practice" });
  const a2 = await authoring(A, { action: "create_area", frameworkId: D.id, name: "Professional Practice" });
  const areas = ((await admin.from("framework_areas").select("id, name").eq("framework_id", D.id)).data ?? []) as any[];
  check("A2.1", "create two Areas on a never-published draft: 201, mode direct, both rows exist", a1.status === 201 && a2.status === 201 && a1.json.mode === "direct" && a2.json.mode === "direct" && areas.length === 2, `${a1.status}/${a2.status}; ${short(a1.json)}; rows ${areas.length}`);
  const [domA, domB, domC] = D.domains;
  const sd = await Promise.all([[domA, a1.json.id], [domB, a1.json.id], [domC, a2.json.id]].map(([d, area]: any) => authoring(A, { action: "set_domain_area", frameworkId: D.id, domainId: d.id, areaId: area })));
  const doms = ((await admin.from("framework_domains").select("id, area_id").eq("framework_id", D.id)).data ?? []) as any[];
  const areaOf = (id: string) => doms.find(d => d.id === id)?.area_id;
  check("A2.2", "set_domain_area x3: direct, A and B in Clinical Practice, C in Professional Practice", sd.every(r => r.status === 200 && r.json.mode === "direct") && areaOf(domA.id) === a1.json.id && areaOf(domB.id) === a1.json.id && areaOf(domC.id) === a2.json.id,
    `${sd.map(r => r.status).join(",")}; ${short(doms)}`);
  const d4 = D.comps.get("D4")!;
  const hd4 = await hashOf(d4.id);
  const mc = await authoring(A, { action: "move_competency_domain", frameworkId: D.id, competencyId: d4.id, domainId: domC.id });
  const after = (await admin.from("framework_competencies").select("id, domain_id").eq("id", d4.id).single()).data;
  check("A2.3", "move_competency_domain on a draft: live (mode direct), same id, new domain, hash UNCHANGED", mc.status === 200 && mc.json.mode === "direct" && after?.id === d4.id && after?.domain_id === domC.id && (await hashOf(d4.id)) === hd4, `status ${mc.status}; ${short(mc.json)}; domain moved ${after?.domain_id === domC.id}`);

  // ═══ A3 -- spreadsheet ════════════════════════════════════════════════════════════════════════
  console.log("A3 spreadsheet");
  const tpl = await fetch(`${BASE}/api/hq/competency/authoring/sheet`, { headers: { Cookie: cookieHeader(A) } });
  const tplText = await tpl.text();
  const headerRow = tplText.split(/\r?\n/)[0];
  check("A3.1", "template GET: 200 CSV download with every sheet column", tpl.status === 200 && /text\/csv/.test(tpl.headers.get("content-type") ?? "") && SHEET_COLUMNS.every(c => headerRow.includes(c)), `status ${tpl.status}; ${headerRow}`);
  const row = (o: Record<string, string>) => SHEET_COLUMNS.map(c => o[c] ?? "");
  const base = (k: string, name: string, domain: string) => ({ framework_code: D.id && code("DRAFT"), domain, competency_code: code(k), competency_name: name, description: `${name}: from the sheet.`, risk_category: "standard" });
  const s1 = base("S1", "Sheet competency one", "FDS2 draft domain A"), s2 = base("S2", "Sheet competency two", "FDS2 sheet domain");
  const goodCsv = toCsv([[...SHEET_COLUMNS],
    row({ ...s1, component: C1, criterion_code: "S1-1", criterion_text: "Sheet criterion one for S1" }),
    row({ ...s1, component: C2, criterion_code: "S1-2", criterion_text: "Sheet criterion two for S1" }),
    row({ ...s2, component: C1, criterion_code: "S2-1", criterion_text: "Sheet criterion one for S2" }),
    row({ ...s2, component: C2, criterion_code: "S2-2", criterion_text: "Sheet criterion two for S2" })]);
  const badCsv = toCsv([[...SHEET_COLUMNS],
    row({ ...s1, component: C1, criterion_code: "S1-1", criterion_text: "Sheet criterion one for S1" }),
    row({ ...s1, component: C2, criterion_code: "S1-2", criterion_text: "Sheet criterion two for S1" }),
    row({ ...s2, component: "no_such_component", criterion_code: "S2-1", criterion_text: "Sheet criterion one for S2" })]);
  const before = await tree(D.id);
  const beforeKey = j(await Promise.all(allComps(before).map(async (c: any) => [c.id, c.name, c.competency_skills.map((s: any) => [s.id, s.name, s.is_active]), await hashOf(c.id)])));
  const dry1 = await send("POST", "/api/hq/competency/authoring/sheet", { csv: badCsv, frameworkCode: code("DRAFT"), dryRun: true }, A);
  const rowErr = (dry1.json.errors ?? []).find((e: any) => e.row === 4 && e.column === "component");
  const afterDry = allComps(await tree(D.id)).length;
  check("A3.2", "dry-run with one bad row: 200, a row-numbered error (row 4, column component), nothing written", dry1.status === 200 && !!rowErr && afterDry === allComps(before).length, `status ${dry1.status}; ${short(dry1.json.errors)}`);
  const bad2 = await send("POST", "/api/hq/competency/authoring/sheet", { csv: badCsv, frameworkCode: code("DRAFT"), dryRun: false }, A);
  check("A3.3", "importing the bad sheet (dryRun false) is refused 422 and writes nothing", bad2.status === 422 && allComps(await tree(D.id)).length === allComps(before).length, `status ${bad2.status}; ${short(bad2.json)}`);
  const dry2 = await send("POST", "/api/hq/competency/authoring/sheet", { csv: goodCsv, frameworkCode: code("DRAFT"), dryRun: true }, A);
  check("A3.4", "dry-run of the good sheet: no errors, 2 competencies and 4 criteria to add, one new domain", dry2.status === 200 && (dry2.json.errors ?? []).length === 0 && dry2.json.adds?.competencies?.length === 2 && dry2.json.adds?.criteria?.total === 4 && (dry2.json.adds?.domains ?? []).length === 1,
    `status ${dry2.status}; ${short({ adds: { competencies: dry2.json.adds?.competencies?.length, criteria: dry2.json.adds?.criteria, domains: dry2.json.adds?.domains }, errors: dry2.json.errors })}`);
  const imp = await send("POST", "/api/hq/competency/authoring/sheet", { csv: goodCsv, frameworkCode: code("DRAFT"), dryRun: false }, A);
  const afterTree = await tree(D.id);
  const afterComps = allComps(afterTree);
  const addedComps = afterComps.filter((c: any) => !allComps(before).some((b: any) => b.id === c.id));
  const addedCrits = addedComps.reduce((n: number, c: any) => n + c.competency_skills.length, 0);
  const afterKey = j(await Promise.all(allComps(before).map(async (c: any) => { const n = afterComps.find((x: any) => x.id === c.id); return [n.id, n.name, n.competency_skills.map((s: any) => [s.id, s.name, s.is_active]), await hashOf(n.id)]; })));
  check("A3.5", "append import: 201, 2 competencies and 4 criteria added, every existing competency and criterion untouched (ids, text, hash)", imp.status === 201 && addedComps.length === 2 && addedCrits === 4 && afterKey === beforeKey,
    `status ${imp.status}; ${short(imp.json)}; added ${addedComps.length} competencies, ${addedCrits} criteria; existing unchanged ${afterKey === beforeKey}`);

  // ═══ A4 -- compare ═══════════════════════════════════════════════════════════════════════════
  console.log("A4 compare");
  const none = await authoring(A, { action: "compare_published", frameworkId: D.id });
  check("A4.1", "compare_published on a never-published draft: status no_published_version", none.status === 200 && none.json.status === "no_published_version", `status ${none.status}; ${short(none.json)}`);
  const F = await buildFramework({ code: code("CMP"), name: `FDS2 acceptance compare ${RUN}`, layer: null },
    [{ name: "FDS2 compare domain A", comps: [{ key: "K1", name: "Infection control" }, { key: "K2", name: "Pain assessment" }] }, { name: "FDS2 compare domain B", comps: [{ key: "K3", name: "Consent" }] }], [C1, C2]);
  const pubA = await transitionFramework(admin, F.id, "publish", { id: ids.publisher, name: WHO.publisher.name });
  const revA = await transitionFramework(admin, F.id, "revert", { id: ids.author, name: WHO.author.name });
  const pubVersions = await versions(F.id);
  check("A4.0", "fixture: a framework published once (version snapshot) and returned to draft", pubA.ok && revA.ok && pubVersions.length === 1 && (await fwRow(F.id)).pub_status === "draft", `${short(pubA)} ${short(revA)}; versions ${pubVersions.length}`);
  const k1 = F.comps.get("K1")!, k3 = F.comps.get("K3")!, k2 = F.comps.get("K2")!;
  const rowK1 = (await admin.from("framework_competencies").select("code, name, description").eq("id", k1.id).single()).data;
  const e1 = await authoring(A, { action: "update_competency", competencyId: k1.id, code: rowK1.code, name: `${rowK1.name} (renamed)`, description: rowK1.description, riskCategory: "standard", learningOutcomes: [] });
  const e2 = await authoring(A, { action: "create_criterion", competencyId: k1.id, component: C1, text: "Applies the five moments of hand hygiene" });
  const e3 = await authoring(A, { action: "retire_criterion", criterionId: k2.skills[0] });
  const e4 = await authoring(A, { action: "move_competency_domain", frameworkId: F.id, competencyId: k3.id, domainId: F.domains[0].id });
  const cmp = await authoring(A, { action: "compare_published", frameworkId: F.id });
  const dc = cmp.json.diff?.competencies;
  const changed = dc?.changed ?? [];
  const k1c = changed.find((c: any) => c.id === k1.id || c.code === k1.code || /Infection control/.test(c.name ?? ""));
  const k2c = changed.find((c: any) => c.id === k2.id || c.code === k2.code || /Pain assessment/.test(c.name ?? ""));
  check("A4.2", "compare_published on the edited draft: compared, shows the rename, the added criterion, the retired criterion and the competency move",
    [e1, e2, e3, e4].every(r => r.status === 200 || r.status === 201) && cmp.json.status === "compared" && !!k1c && !!k2c && cmp.json.version?.num === 1 && cmp.json.diff?.unchanged !== true,
    `edits ${[e1, e2, e3, e4].map(r => r.status).join(",")}; ${short({ status: cmp.json.status, version: cmp.json.version, counts: cmp.json.diff?.counts, changed: changed.map((c: any) => ({ n: c.name ?? c.code, f: (c.fields ?? []).map((x: any) => x.field), c: c.criteria && Object.fromEntries(Object.entries(c.criteria).map(([k, v]: any) => [k, v?.length ?? v])), md: c.movedDomain })) }, 700)}`);

  // ═══ governed framework: setup through the real governance path ═══════════════════════════════
  console.log("Governed framework setup (author -> clinical review -> independent publication)");
  const G = await buildFramework({ code: code("GOV"), name: `FDS2 acceptance published ${RUN}`, layer: "foundational" },
    [{ name: "FDS2 gov domain A", comps: [{ key: "G1", name: "Airway management" }, { key: "G2", name: "Fluid balance" }] }, { name: "FDS2 gov domain B", comps: [{ key: "G3", name: "Pressure care" }] }], [C1, C2]);
  const scope = await admin.from("clinical_reviewer_scope").insert({ granted_by: owner, appointment_id: apptId.reviewer, scope_kind: "framework", scope_ref: G.id });
  if (scope.error) throw new Error(`reviewer scope: ${scope.error.message}`);
  const approveAll = async (versionIds: string[]) => {
    const out = [];
    for (const v of versionIds) out.push(await send("POST", "/api/hq/clinical-review", { versionId: v, appointmentId: apptId.reviewer, decision: "approved", comment: "FDS-02 acceptance" }, R));
    return out;
  };
  const subs = [];
  for (const c of G.comps.values()) subs.push(await authoring(A, { action: "submit_review", competencyId: c.id }));
  const appr = await approveAll(subs.map(s => s.json.versionId).filter(Boolean));
  const sub1 = await send("POST", "/api/hq/competency/publication", { action: "submit", frameworkId: G.id }, A);
  const pub1 = await send("POST", "/api/hq/competency/publication", { action: "decide", frameworkId: G.id, decision: "publish" }, P);
  const gRow = await fwRow(G.id);
  const setupOk = subs.every(s => s.status === 201) && appr.every(r => r.status === 200) && sub1.status === 200 && pub1.status === 200 && gRow.pub_status === "published" && gRow.version_num === 1;
  check("A5.0", "setup: 3 competencies put forward, approved by the reviewer, framework put forward by the author and published by the independent publisher (version 1)", setupOk,
    `submit ${subs.map(s => s.status)}; approve ${appr.map(r => r.status)}; publication submit ${sub1.status} ${short(sub1.json)}; decide ${pub1.status} ${short(pub1.json)}; ${short(gRow)}`);
  if (!setupOk) throw new Error("governed setup failed; A5-A7 cannot run");

  // ═══ A5 -- revision cycle ═════════════════════════════════════════════════════════════════════
  console.log("A5 revision cycle");
  const [g1, g2, g3] = ["G1", "G2", "G3"].map(k => G.comps.get(k)!);
  const [gDomA, gDomB] = G.domains;
  const liveBefore = j(await tree(G.id)), learnerBefore = await learnerRead(G.id);
  const hashesBefore = j(await Promise.all([g1, g2, g3].map(c => hashOf(c.id))));
  const skillIdsBefore = new Set(allComps(await tree(G.id)).flatMap((c: any) => c.competency_skills.map((s: any) => s.id)));
  const compIdsBefore = [g1.id, g2.id, g3.id];
  const rowG1 = (await admin.from("framework_competencies").select("code, name, description").eq("id", g1.id).single()).data;
  const r1 = await authoring(A, { action: "update_competency", competencyId: g1.id, code: rowG1.code, name: `${rowG1.name} (revised)`, description: `${rowG1.description} Revised for the new protocol.`, riskCategory: "standard", learningOutcomes: [] });
  const NEWCODE = code("G4");
  const r2 = await authoring(A, { action: "create_competency", domainId: gDomA.id, code: NEWCODE, name: "Oxygen therapy", description: "New competency added in the revision.", riskCategory: "standard", learningOutcomes: [] });
  const newId = r2.json.id as string;
  const r3 = await authoring(A, { action: "create_criterion", competencyId: newId, component: C1, text: "Selects the correct oxygen delivery device" });
  const r3b = await authoring(A, { action: "create_criterion", competencyId: newId, component: C2, text: "Explains the target saturation range" });
  const r4 = await authoring(A, { action: "retire_criterion", criterionId: g2.skills[0] });
  const r5 = await authoring(A, { action: "rename_domain", domainId: gDomB.id, name: "FDS2 gov domain B (renamed)" });
  const modes = [r1, r2, r3, r3b, r4, r5].map(r => r.json.mode);
  check("A5.1", "content edit, new competency (+2 criteria), criterion retire and domain rename each answer mode revision (2xx)", [r1, r2, r3, r3b, r4, r5].every(r => r.status === 200 || r.status === 201) && modes.every(m => m === "revision") && !!newId,
    `${[r1, r2, r3, r3b, r4, r5].map(r => r.status).join(",")}; modes ${modes.join(",")}; ${short(r2.json)}`);
  const liveMid = j(await tree(G.id)), learnerMid = await learnerRead(G.id);
  const hashesMid = j(await Promise.all([g1, g2, g3].map(c => hashOf(c.id))));
  const newLive = await admin.from("framework_competencies").select("id").eq("id", newId).maybeSingle();
  check("A5.2", "while the revision is open the live tree, the competency hashes and the learner-facing catalogue read are byte-identical", liveMid === liveBefore && learnerMid === learnerBefore && hashesMid === hashesBefore && !newLive.data,
    `live same ${liveMid === liveBefore}; learner same ${learnerMid === learnerBefore}; hashes same ${hashesMid === hashesBefore}; new competency live ${!!newLive.data}`);
  const rv = await authoring(A, { action: "revision_view", frameworkId: G.id });
  const rvc = (rv.json.revision?.competencies ?? []) as any[];
  const proposedHashes = new Map(rvc.map(c => [c.id, c.proposedHash]));
  check("A5.3", "revision_view: open revision lists G1 changed, G2 changed, the new competency isNew with 2 criteria, and the renamed domain",
    rv.status === 200 && !!rv.json.revision && rvc.find(c => c.id === g1.id)?.changed === true && rvc.find(c => c.id === g2.id)?.changed === true && rvc.find(c => c.id === newId)?.isNew === true && rvc.find(c => c.id === newId)?.criteria?.length === 2
      && (rv.json.revision.domains ?? []).some((d: any) => d.id === gDomB.id && /renamed/.test(d.name)),
    `status ${rv.status}; ${short(rvc.map(c => ({ id: c.id === newId ? "NEW" : c.code, changed: c.changed, isNew: c.isNew, n: c.criteria?.length })))}`);
  const cmpR = await authoring(A, { action: "compare_revision", frameworkId: G.id });
  const dr = cmpR.json.diff;
  check("A4.3", "compare_revision: compared; shows the rename (competency and domain), the new competency and the retired criterion",
    cmpR.status === 200 && cmpR.json.status === "compared" && (dr?.competencies?.added ?? []).length >= 1 && (dr?.competencies?.changed ?? []).length >= 2 && (dr?.domains?.renamed ?? []).length >= 1,
    `status ${cmpR.status}; ${short({ counts: dr?.counts, added: (dr?.competencies?.added ?? []).length, changed: (dr?.competencies?.changed ?? []).length, domainsRenamed: dr?.domains?.renamed })}`);
  // put forward for clinical review (the proposed content)
  const prev = await authoring(A, { action: "review_preview", frameworkId: G.id, scope: { kind: "framework" }, revision: true });
  const eligible = (prev.json.items ?? []).filter((i: any) => i.eligibility === "eligible");
  const subm = await authoring(A, { action: "review_submit", frameworkId: G.id, revision: true, items: eligible.map((i: any) => ({ competencyId: i.competencyId, hash: i.hash })) });
  const versionIds = (subm.json.results ?? []).filter((x: any) => x.outcome === "submitted").map((x: any) => x.versionId);
  check("A5.4", "review_preview / review_submit (revision): the 3 changed or new competencies are put forward at their PROPOSED hash; the unchanged one is not", prev.status === 200 && eligible.length === 3 && subm.status === 200 && versionIds.length === 3
    && eligible.every((i: any) => i.hash === proposedHashes.get(i.competencyId)), `preview ${prev.status} eligible ${eligible.length}; submit ${subm.status} ${short(subm.json.counts)}; ${short((prev.json.items ?? []).map((i: any) => [i.code, i.eligibility]))}`);
  // the author cannot approve
  const selfApprove = await send("POST", "/api/hq/clinical-review", { versionId: versionIds[0], appointmentId: apptId.reviewer, decision: "approved" }, A);
  const selfPublish = await send("POST", "/api/hq/competency/publication", { action: "decide", frameworkId: G.id, decision: "publish", changeKind: "major" }, A);
  check("A5.5", "the author cannot approve (clinical-review refused 403) and cannot publish (publication decide refused 403)", selfApprove.status === 403 && selfPublish.status === 403, `approve ${selfApprove.status} ${short(selfApprove.json)}; publish ${selfPublish.status} ${short(selfPublish.json)}`);
  const apr = await approveAll(versionIds);
  check("A5.6", "the clinical reviewer approves each proposed version (including the new competency, which is not live yet)", apr.length === 3 && apr.every(r => r.status === 200), apr.map(r => `${r.status} ${short(r.json, 120)}`).join(" | "));
  const sub2 = await send("POST", "/api/hq/competency/publication", { action: "submit", frameworkId: G.id, note: "FDS-02 acceptance revision" }, A);
  const pub2 = await send("POST", "/api/hq/competency/publication", { action: "decide", frameworkId: G.id, decision: "publish", changeKind: "major" }, P);
  check("A5.7", "the author puts the revision forward; the independent publisher publishes it (revisionApplied)", sub2.status === 200 && pub2.status === 200 && pub2.json.revisionApplied === true && pub2.json.status === "published", `submit ${sub2.status}; decide ${pub2.status} ${short(pub2.json)}`);
  const post = await tree(G.id), postComps = allComps(post);
  const nc = postComps.find((c: any) => c.id === newId);
  const pg1 = postComps.find((c: any) => c.id === g1.id), pg2 = postComps.find((c: any) => c.id === g2.id);
  const retired = pg2?.competency_skills.find((s: any) => s.id === g2.skills[0]);
  const renamed = post.find((d: any) => d.id === gDomB.id);
  const hashNow = new Map(await Promise.all([g1, g2, nc ? { id: newId } : { id: newId }].map(async (c: any) => [c.id, await hashOf(c.id)] as const)));
  check("A5.8", "live now equals the revision: G1 reworded, new competency live under the id the API returned (2 criteria), the criterion retired, the domain renamed, hashes equal the proposed hashes",
    /\(revised\)/.test(pg1?.name ?? "") && !!nc && nc.domain_id === undefined && nc.competency_skills.length === 2 && retired?.is_active === false && /renamed/.test(renamed?.name ?? "")
      && hashNow.get(g1.id) === proposedHashes.get(g1.id) && hashNow.get(g2.id) === proposedHashes.get(g2.id) && hashNow.get(newId) === proposedHashes.get(newId),
    `g1 "${pg1?.name}"; new ${!!nc} criteria ${nc?.competency_skills.length}; retired is_active ${retired?.is_active}; domain "${renamed?.name}"; hashes equal ${hashNow.get(g1.id) === proposedHashes.get(g1.id)}/${hashNow.get(g2.id) === proposedHashes.get(g2.id)}/${hashNow.get(newId) === proposedHashes.get(newId)}`);
  const idsKept = compIdsBefore.every(id => postComps.some((c: any) => c.id === id)) && [...skillIdsBefore].every(id => postComps.some((c: any) => c.competency_skills.some((s: any) => s.id === id))) && post.some((d: any) => d.id === gDomA.id) && !!renamed;
  check("A5.9", "ids are stable: every competency, criterion and domain id from before the revision still exists", idsKept, `competencies ${compIdsBefore.length}, criteria ${skillIdsBefore.size} all present: ${idsKept}`);
  const vs = await versions(G.id), v2 = vs.find(v => v.version_num === 2);
  const snapComps = (v2?.snapshot?.framework_domains ?? []).flatMap((d: any) => d.framework_competencies ?? []);
  check("A5.10", "framework_versions: a version 2 snapshot is recorded (label 2.0.0, publisher named) carrying the new competency, its approvals and the renamed domain", vs.length === 2 && !!v2 && v2.snapshot?.version_label === "2.0.0" && snapComps.some((c: any) => c.id === newId)
    && !!v2.snapshot?.clinical_approvals?.[newId]?.clinical_version_id && (v2.snapshot?.framework_domains ?? []).some((d: any) => /renamed/.test(d.name)) && v2.published_by_name === WHO.publisher.name,
    `versions ${vs.map(v => v.version_num)}; label ${v2?.snapshot?.version_label}; in snapshot ${snapComps.some((c: any) => c.id === newId)}; by ${v2?.published_by_name}`);
  const learnerAfter = await learnerRead(G.id);
  const rv2 = await authoring(A, { action: "revision_view", frameworkId: G.id });
  check("A5.11", "after publication the revision is closed and the learner-facing read now carries the new competency", rv2.json.revision === null && learnerAfter !== learnerBefore && learnerAfter.includes(newId), `revision ${short(rv2.json)}; learner changed ${learnerAfter !== learnerBefore}`);

  // ═══ A7 -- organisational move on a published framework ═══════════════════════════════════════
  console.log("A7 organisational move");
  const hg2 = await hashOf(g2.id), learner7 = await learnerRead(G.id);
  const mvP = await authoring(A, { action: "move_competency_domain", frameworkId: G.id, competencyId: g2.id, domainId: gDomB.id });
  const stillA = (await admin.from("framework_competencies").select("domain_id").eq("id", g2.id).single()).data;
  const layoutRow = (await admin.from("frameworks").select("layout_draft").eq("id", G.id).single()).data;
  check("A7.1", "move_competency_domain on the published framework: mode draft, layout pending, live domain, hash and learner read unchanged", mvP.status === 200 && mvP.json.mode === "draft" && mvP.json.layoutPending === true && stillA?.domain_id === gDomA.id
    && (await hashOf(g2.id)) === hg2 && (await learnerRead(G.id)) === learner7 && !!layoutRow?.layout_draft, `status ${mvP.status}; ${short(mvP.json)}; live domain unchanged ${stillA?.domain_id === gDomA.id}`);
  const sub3 = await send("POST", "/api/hq/competency/publication", { action: "submit", frameworkId: G.id, note: "FDS-02 acceptance layout" }, A);
  const pub3 = await send("POST", "/api/hq/competency/publication", { action: "decide", frameworkId: G.id, decision: "publish", changeKind: "revision" }, P);
  const movedNow = (await admin.from("framework_competencies").select("id, domain_id").eq("id", g2.id).single()).data;
  const layoutAfter = (await admin.from("frameworks").select("layout_draft").eq("id", G.id).single()).data;
  const vs3 = await versions(G.id);
  check("A7.2", "the independent publisher publishes: layoutApplied, same competency id now under the other domain, hash unchanged, layout draft cleared, version 3 recorded", sub3.status === 200 && pub3.status === 200 && pub3.json.layoutApplied === true && movedNow?.id === g2.id && movedNow?.domain_id === gDomB.id
    && (await hashOf(g2.id)) === hg2 && !layoutAfter?.layout_draft && vs3.length === 3, `submit ${sub3.status}; decide ${pub3.status} ${short(pub3.json)}; domain ${movedNow?.domain_id === gDomB.id}; versions ${vs3.length}`);

  // ═══ A6 -- a refused publication applies nothing; and a publisher who is the author ═══════════
  console.log("A6 refused publication");
  const wording = `${rowG1.description} Second revision wording, not yet reviewed.`;
  const rowNow = (await admin.from("framework_competencies").select("code, name, description").eq("id", g1.id).single()).data;
  const e6 = await authoring(A, { action: "update_competency", competencyId: g1.id, code: rowNow.code, name: rowNow.name, description: wording, riskCategory: "standard", learningOutcomes: [] });
  const liveBefore6 = j(await tree(G.id)), learner6 = await learnerRead(G.id), fw6 = await fwRow(G.id), ver6 = (await versions(G.id)).length;
  const sub4 = await send("POST", "/api/hq/competency/publication", { action: "submit", frameworkId: G.id, note: "FDS-02 acceptance: no clinical approval yet" }, A);
  const pub4 = await send("POST", "/api/hq/competency/publication", { action: "decide", frameworkId: G.id, decision: "publish", changeKind: "minor" }, P);
  const fw6b = await fwRow(G.id), rev6 = await authoring(A, { action: "revision_view", frameworkId: G.id });
  check("A6.1", "publication without clinical approval of the revision is refused (409, the 466 reason) and applies nothing: live tree, learner read, status, version number and version count unchanged; the revision stays open",
    e6.status === 200 && e6.json.mode === "revision" && sub4.status === 200 && pub4.status === 409 && /clinically approved/i.test(pub4.json.error ?? "") && j(await tree(G.id)) === liveBefore6 && (await learnerRead(G.id)) === learner6
      && fw6b.pub_status === "published" && fw6b.version_num === fw6.version_num && fw6b.version_major === fw6.version_major && fw6b.version_minor === fw6.version_minor && (await versions(G.id)).length === ver6 && !!rev6.json.revision,
    `edit ${e6.status} ${e6.json.mode}; submit ${sub4.status}; decide ${pub4.status} ${short(pub4.json.error)}; version ${fw6b.version_num}/${fw6.version_num}; versions ${(await versions(G.id)).length}/${ver6}; revision open ${!!rev6.json.revision}`);
  const asAuthor = await send("POST", "/api/hq/competency/publication", { action: "decide", frameworkId: G.id, decision: "publish", changeKind: "minor" }, A);
  const asAuthorLib = await decidePublication(admin, { userId: ids.author, name: WHO.author.name }, { frameworkId: G.id, decision: "publish", changeKind: "minor" });
  const fw6c = await fwRow(G.id);
  check("A5.12", "a second publisher-is-author attempt is refused both at the route (403) and by the publication rules (the author put it forward and contributed); nothing published",
    asAuthor.status === 403 && !asAuthorLib.ok && asAuthorLib.status === 403 && fw6c.version_num === fw6.version_num && (await versions(G.id)).length === ver6,
    `route ${asAuthor.status}; rules ${asAuthorLib.ok ? "ACCEPTED" : `${asAuthorLib.status} ${short(asAuthorLib.error, 120)}`}`);

  // ═══ kept fixture ═════════════════════════════════════════════════════════════════════════════
  writeFileSync(OUT, [
    `email: ${WHO.author.email}`,
    `password: ${pw.author}`,
    `login: ${BASE}/login`,
    `draft framework: ${STUDIO}/${D.id}`,
    `published framework (OPEN revision): ${STUDIO}/${G.id}`,
    `compare-with-published draft (was published, returned to draft, edited): ${STUDIO}/${F.id}`,
    `positions: ${WHO.author.role}`,
    `run: ${RUN}`,
    "",
  ].join("\n"));
  await writeRecord({ run: RUN, draft: D.id, published: G.id, compare: F.id });
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; FAILED: ${failed.map(f => f.id).join(", ")}` : ""}`);
  console.log(`fixture details in ${OUT}; record ${DOC}`);
  process.exit(failed.length ? 1 : 0);
}

async function writeRecord(f: { run: string; draft: string; published: string; compare: string }) {
  let sha = "unknown";
  try { sha = execSync("git rev-parse --short HEAD", { cwd: resolve(__dirname, "..") }).toString().trim(); } catch { /* not a checkout */ }
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [
    "# FRAMEWORK-DESIGN-STUDIO-02: staging acceptance, 31 Oct 2026",
    "",
    `Harness: \`scripts/framework-studio-acceptance-harness.ts\` (run ${f.run}), over HTTP against the dev server (${BASE}) pointed at STAGING, serving \`${sha}\` of \`hq/framework-studio-02a\`.`,
    "Staging migrations in force: 750, 751, 752, 760, 761, 770, 771. Production has none of 760-771.",
    "Real database, real routes. Roles are real HQ appointments: Competency Author, Clinical Content Reviewer (framework scope), Quality Council Member (independent publisher). One pass each.",
    "",
    `Result: **${results.filter(r => r.ok).length}/${results.length} passed.**`,
    "",
    "| Check | Result | What was asserted | Evidence |",
    "|---|---|---|---|",
    ...results.map(r => `| ${r.id} | ${r.ok ? "PASS" : "FAIL"} | ${esc(r.check)} | ${esc(short(r.evidence, 400))} |`),
    "",
    "## Fixtures kept for the browser check (synthetic, staging, not removed)",
    `- Draft framework: ${STUDIO}/${f.draft}`,
    `- Published framework with an OPEN revision: ${STUDIO}/${f.published}`,
    `- Draft that was published once and edited since (Compare with published): ${STUDIO}/${f.compare}`,
    "- Author sign-in: scratchpad file fds2-fixture.txt (credentials never printed). The reviewer and publisher passwords are reset each run and not kept.",
    "",
    "## Notes",
    "- A4 is covered twice: compare_published needs a draft that has a published version, so the fixture publishes a framework once and returns it to draft; compare_revision covers a revision against the live version (A4.3).",
    "- A5.12 runs the author as publisher twice: through the route (the publish capability gate) and through decidePublication (the independence rules, 640), both on a revision that was put forward by the author.",
    "- A6.1 leaves that revision open and unreviewed on purpose; it is the open revision the browser fixture shows.",
    "",
  ];
  writeFileSync(DOC, lines.join("\r\n"));
}

main().catch(async e => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
