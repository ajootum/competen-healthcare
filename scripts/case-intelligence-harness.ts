/**
 * CASE INTELLIGENCE -- THE RED LINES, STATIC (COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s7-s11, s14, migrations 422-423).
 *
 *   npx tsx scripts/case-intelligence-harness.ts
 *
 * Pure: it reads source and migration text, never a database. The coordinator's red lines, each with a PLANT that
 * must turn the check red (a harness that always passes is worth nothing):
 *
 *   K1  HQ never reads who offered a case: HQ-reachable code reads case_candidate only for id and status, and reads
 *       candidates' content through case_candidate_queue
 *   K2  the queue view itself carries no user and no source reference, and is closed to the browser roles
 *   K3  offering, screening and delivery make no AI call and touch no ledger (no AI import, no ai_ table)
 *   K4  the eligibility gate is deterministic: candidates.ts never reads an AI verdict
 *   K5  the budget owner is never the browser's: the studio route passes no owner, budget or cost, and AI drafting
 *       resolves its owner from the workflow constant case.educator_develop
 *   K6  delivery checks deliverable (published AND approved for the exact version) before offering or loading
 *   K7  the full blueprint never leaves the server: no route or page outside HQ imports loadLibraryCase
 *   K8  the database backstop refuses an eligible candidate with an identifier, and an offer without permission
 *   K9  the workflows are attributed as the owner GO says (platform screening, platform-or-institution educator work,
 *       no AI for a stored replay), and no workflow exists for offering a case
 *  K10  the gate (CLAUDE.md lifecycle state 3): everything that STARTS case work checks the case_library flag, which
 *       is off unless written, and nothing that is a student's privacy right (revoke, withdraw, see own offers) does
 *  K11  one session record for a library play (424): nothing outside src/lib/cases writes case_library_session, so
 *       Scholar's AI feedback and debrief reach it only through recordSessionFeedback and recordSessionDebrief
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(join(ROOT, dir))) {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
};
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };

type Src = Record<string, string>;
const HQ_FILES = [...walk("src/app/super-admin/cases"), ...walk("src/app/api/hq/cases"), "src/lib/cases/studio.ts", "src/lib/cases/analytics.ts", "src/lib/competency/clinical-review-hq.ts"];
const load = (files: string[]): Src => Object.fromEntries(files.map(f => [f, read(f)]));

// K1: every case_candidate read in HQ-reachable code selects only id and status.
function k1(src: Src): string[] {
  const bad: string[] = [];
  for (const [f, t] of Object.entries(src)) {
    for (const m of t.matchAll(/\.from\("case_candidate"\)([\s\S]{0,400}?)(?:;|\n\s*\n)/g)) {
      const sel = /\.select\("([^"]*)"/.exec(m[1]);
      const cols = sel ? sel[1].split(",").map(s => s.trim()).filter(Boolean) : ["*"];
      if (cols.some(c => !["id", "status"].includes(c))) bad.push(`${f}: case_candidate select(${cols.join(", ")})`);
    }
  }
  return bad;
}
// K2: the view's column list.
function k2(sql: string): string[] {
  const v = /create or replace view case_candidate_queue[\s\S]*?as\s+select([\s\S]*?)from case_candidate/i.exec(sql);
  if (!v) return ["no case_candidate_queue view"];
  const bad = ["user_id", "source_key"].filter(c => new RegExp(`\\b${c}\\b`).test(v[1])).map(c => `the view selects ${c}`);
  if (!/security_invoker\s*=\s*true/i.test(sql)) bad.push("the view is not security_invoker");
  if (!/revoke all on case_candidate_queue from public, anon, authenticated/i.test(sql)) bad.push("the view is not revoked from the browser roles");
  return bad;
}
// K3: no AI and no ledger in the C1 and C4 modules.
function k3(src: Src): string[] {
  return Object.entries(src).flatMap(([f, t]) => [
    ...(/from "@\/lib\/ai\//.test(t) ? [`${f} imports AI`] : []),
    ...(/\.from\("ai_|rpc\("ai_/.test(t) ? [`${f} touches the AI ledger`] : []),
  ]);
}
// K4: no AI verdict in the gate.
function k4(t: string): string[] { return /deidentified|aiScreen|aiVerdict|\.verdict\b/i.test(t) ? ["candidates.ts reads an AI verdict"] : []; }
// K5: the studio route and AI drafting.
function k5(route: string, studio: string): string[] {
  const bad: string[] = [];
  for (const k of ["owner", "budget", "cost", "ownerType", "cau", "usd"]) if (new RegExp(`body\\??\\.${k}\\b`).test(route)) bad.push(`the route reads body.${k}`);
  if (!/resolveOwner\(admin, "case\.educator_develop"/.test(studio)) bad.push("AI drafting does not resolve its owner from case.educator_develop");
  return bad;
}
// K6: delivery checks deliverable.
function k6(lib: string): string[] {
  const fn = (name: string) => { const i = lib.indexOf(`export async function ${name}`); return i < 0 ? "" : lib.slice(i, lib.indexOf("\nexport ", i + 10) > 0 ? lib.indexOf("\nexport ", i + 10) : undefined); };
  return ["findLibraryCases", "loadLibraryCase"].filter(n => !/rpc\("case_library_deliverable"/.test(fn(n))).map(n => `${n} does not check case_library_deliverable`);
}
// K7: the full blueprint stays server-side.
function k7(files: Src): string[] {
  return Object.entries(files).filter(([f, t]) => !f.startsWith("src/app/super-admin/") && !f.startsWith("src/app/api/hq/") && !f.startsWith("src/lib/cases/") && /\bloadLibraryCase\b/.test(t)).map(([f]) => `${f} uses loadLibraryCase`);
}
// K8: the database backstop and the permission check, in 423's candidate guard.
function k8(sql: string): string[] {
  const g = /create or replace function public\.case_candidate_guard\(\)[\s\S]*?\$\$;/i.exec(sql)?.[0] ?? "";
  const bad: string[] = [];
  if (!/v_kinds := case_identifier_kinds\(new\.snapshot::text\);\s*if cardinality\(v_kinds\) > 0 then\s*raise exception/i.test(g)) bad.push("no identifier backstop on an eligible offer");
  if (!/if new\.user_id is null or not found or g\.status <> 'granted' then\s*raise exception/i.test(g)) bad.push("no permission check on an offer");
  return bad;
}
// K9: attribution.
function k9(consumption: string): string[] {
  const want: Record<string, string> = { "case.candidate_screen": "platform", "case.promote": "platform", "case.educator_develop": "platform_or_institution", "case.reviewer_assist": "platform_or_institution", "case.replay_stored": "none", "case.private_generate": "individual", "case.live_with_stored": "individual" };
  const bad = Object.entries(want).filter(([w, o]) => !new RegExp(`"${w.replace(".", "\\.")}":\\s*"${o}"`).test(consumption)).map(([w, o]) => `${w} is not ${o}`);
  if (/"case\.(offer|candidate_offer|contribute)"/.test(consumption)) bad.push("a workflow exists for offering a case");
  return bad;
}

// K10: which functions check the flag.
const body = (t: string, name: string) => { const i = t.indexOf(`export async function ${name}`); if (i < 0) return ""; const j = t.indexOf("\nexport ", i + 10); return t.slice(i, j > 0 ? j : undefined); };
function k10(cand: string, lib: string, route: string, pages: Src): string[] {
  const gated = /caseLibraryEnabled\(admin\)/;
  const bad: string[] = [];
  for (const n of ["grantCaseCandidacy", "offerPrivateCase"]) if (!gated.test(body(cand, n))) bad.push(`${n} is not gated`);
  for (const n of ["findLibraryCases", "loadLibraryCase"]) if (!gated.test(body(lib, n))) bad.push(`${n} is not gated`);
  if (!/if \(!\(await caseLibraryEnabled\(ctx\.admin\)\)\) return refuse\(409/.test(route)) bad.push("the studio route is not gated");
  for (const [f, t] of Object.entries(pages)) if (!/caseLibraryEnabled\(ctx\.admin\)/.test(t)) bad.push(`${f} is not gated`);
  for (const n of ["revokeCaseCandidacy", "withdrawCaseCandidate", "myCaseOffers"]) if (/caseLibraryEnabled/.test(body(cand, n))) bad.push(`${n} waits for the gate, but a privacy right never does`);
  return bad;
}
// K11: who writes a library session.
function k11(files: Src): string[] {
  return Object.entries(files).filter(([f, t]) => !f.startsWith("src/lib/cases/") && /\.from\("case_library_session"\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/.test(t)).map(([f]) => `${f} writes case_library_session`);
}
const hq = load(HQ_FILES);
const sql = read("supabase/migrations/423-case-candidates-and-delivery.sql");
const c1c4 = load(["src/lib/cases/candidates.ts", "src/lib/cases/library.ts", "src/lib/cases/screen.ts", "src/lib/cases/policy.ts", "src/lib/cases/blueprint.ts"]);
const route = read("src/app/api/hq/cases/route.ts"), studio = read("src/lib/cases/studio.ts"), lib = read("src/lib/cases/library.ts"), cand = read("src/lib/cases/candidates.ts"), cons = read("src/lib/ai/consumption.ts");
const everyFile = load([...walk("src/app"), ...walk("src/lib")]);

console.log("CASE INTELLIGENCE -- red lines (static)");
const run = (n: string, problems: string[]) => ok(n, problems.length === 0, problems.join("; "));
run("K1. HQ reads case_candidate only for id and status", k1(hq));
run("K2. the queue view has no user or source reference and is closed to anon and authenticated", k2(sql));
run("K3. offering, screening and delivery make no AI call and touch no ledger", k3(c1c4));
run("K4. the eligibility gate reads no AI verdict", k4(cand));
run("K5. the browser never picks the owner, budget or cost, and AI drafting resolves its owner from the workflow", k5(route, studio));
run("K6. delivery checks published AND approved for the exact version", k6(lib));
run("K7. the full blueprint never leaves HQ and the case library modules", k7(everyFile));
run("K8. the database backstop refuses identifiable content and offers without permission", k8(sql));
run("K9. the workflows are attributed as the owner GO says, and offering is not an AI workflow", k9(cons));
const pages = load(["src/app/super-admin/cases/page.tsx", "src/app/super-admin/cases/[caseId]/page.tsx", "src/app/super-admin/cases/publication/page.tsx"]);
run("K10. everything that starts case work is behind the case_library flag, and no privacy right is", k10(cand, lib, route, pages));
run("K11. only the case library writes a library session (one record per play)", k11(everyFile));

// ── Plants: each check must go red on its violation ──
const red = (n: string, problems: string[]) => ok(`P. ${n} goes RED`, problems.length > 0);
red("K1 on an HQ read of user_id", k1({ ...hq, "planted.ts": `admin.from("case_candidate").select("id, user_id, status");\n` }));
red("K1 on an HQ read of the whole row", k1({ ...hq, "planted.ts": `admin.from("case_candidate").select("*");\n` }));
red("K2 on a view naming the student", k2(sql.replace("select id, status, snapshot,", "select id, user_id, status, snapshot,")));
red("K2 on a view open to the browser", k2(sql.replace("revoke all on case_candidate_queue from public, anon, authenticated", "grant select on case_candidate_queue to authenticated")));
red("K3 on AI in delivery", k3({ ...c1c4, "src/lib/cases/library.ts": `import { runOwnedAi } from "@/lib/ai/allowance";\n` + lib }));
red("K3 on a ledger write in an offer", k3({ ...c1c4, "src/lib/cases/candidates.ts": cand + `\nawait admin.rpc("ai_reserve", {});\n` }));
red("K4 on an AI de-identification verdict", k4(cand.replace("const eligible = j.reasons.length === 0;", "const eligible = j.reasons.length === 0 || (args as any).aiScreen?.deidentified === true;")));
red("K5 on a browser-chosen budget", k5(route.replace("str(body.brief, 4000)", "str(body.brief, 4000), budget: body.budget"), studio));
red("K5 on a browser-chosen workflow", k5(route, studio.replace(`resolveOwner(admin, "case.educator_develop"`, `resolveOwner(admin, args.workflow as any`)));
red("K6 on a search without the deliverable check", k6(lib.replace(`const { data: ok, error: dErr } = await admin.rpc("case_library_deliverable", { p_version: v.id });`, "const ok = true, dErr = null;")));
red("K7 on a student route loading the full case", k7({ ...everyFile, "src/app/api/individual/case/route.ts": `import { loadLibraryCase } from "@/lib/cases/library";\n` }));
red("K8 without the backstop", k8(sql.replace(/v_kinds := case_identifier_kinds\(new\.snapshot::text\);\n    if cardinality\(v_kinds\) > 0 then/, "v_kinds := case_identifier_kinds(new.snapshot::text);\n    if false then")));
red("K8 without the permission check", k8(sql.replace("if new.user_id is null or not found or g.status <> 'granted' then", "if false then")));
red("K9 on educator work charged to the student", k9(cons.replace(`"case.educator_develop": "platform_or_institution"`, `"case.educator_develop": "individual"`)));
red("K10 on an ungated offer", k10(cand.replace(/  if \(!\(await caseLibraryEnabled\(admin\)\)\) return \{ ok: false, error: CASE_LIBRARY_OFF \};\n  const status/, "  const status"), lib, route, pages));
red("K10 on an ungated studio route", k10(cand, lib, route.replace("if (!(await caseLibraryEnabled(ctx.admin))) return refuse(409", "if (false) return refuse(409"), pages));
red("K10 on a gated withdrawal", k10(cand.replace("if (!UUID.test(args.userId) || !SOURCE_KEY.test(args.sourceKey ?? \"\")) return { ok: false, error: \"Nothing to withdraw.\" };", "if (!(await caseLibraryEnabled(admin))) return { ok: false, error: CASE_LIBRARY_OFF };"), lib, route, pages));
red("K11 on Scholar keeping its own feedback on a library session", k11({ ...everyFile, "src/lib/individual/scholar/case-feedback.ts": `await admin.from("case_library_session").update({ feedback: [] }).eq("id", id);\n` }));
red("K9 on an offering workflow", k9(cons.replace(`"case.dedupe": "platform",`, `"case.dedupe": "platform",\n  "case.offer": "individual",`)));

console.log(fails.length ? `RED -- ${pass} passed, ${fails.length} failed: ${fails.join(", ")}` : `ALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
