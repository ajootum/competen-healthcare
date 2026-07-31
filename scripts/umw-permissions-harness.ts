/**
 * UMW-TLS-002 harness — Roles, Permissions & Delegated Administration (migration 166).
 *
 * Two things must hold, and the first is the whole reason this module is built the way it is:
 *
 *   1. THE MATRIX MUST NOT LIE. It is generated from the application's real access gates, so it can only
 *      be trusted if (a) the committed file matches a fresh scan of the code, and (b) the classifier never
 *      turns a gate it failed to parse into "open". Both are asserted here. A stale matrix is worse than
 *      no matrix: it tells a manager a route is locked after someone opened it.
 *   2. SEGREGATION OF DUTY MUST BE COMPUTED, NOT REMEMBERED. Breaches are derived live from the roles
 *      people hold, so removing a role clears the breach and an EXPIRED exception stops excusing it.
 *
 *   npx --yes tsx scripts/umw-permissions-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { classifyGate, roleReaches, findSodBreaches, summarise, type SodRule } from "../src/lib/access/scan";
import { loadAccessGovernance, TENANT_ROLES } from "../src/lib/access/permissions";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const eq = (name: string, got: any, want: any) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const G = { ADMIN_ROLES: ["hospital_admin", "super_admin"], STAFF_ROLES: ["assessor", "educator", "hospital_admin", "super_admin"] };

async function main() {
  console.log("\nUMW-TLS-002 Roles, Permissions & Delegated Administration\n");

  // ── The classifier, as pure functions ──
  console.log("Gate classification (pure)");
  eq("an ALLOWED list that is tested is a role gate",
    classifyGate('const ALLOWED = ["hospital_admin","super_admin"];\nif (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");').kind, "role-list");
  // The assertion that protects against the most dangerous silent failure.
  eq("an ALLOWED list that is NEVER TESTED is not a gate",
    classifyGate('const ALLOWED = ["hospital_admin"];\nreturn <div/>;').kind, "unknown");
  eq("a single-role check is recognised",
    classifyGate('if (!userRoles.includes("super_admin")) { return deny; }').kind, "single-role");
  eq("the older role!== spelling is recognised",
    classifyGate('const { data: p } = await q; if (p?.role !== "super_admin") return forbidden();').kind, "single-role");
  eq("getCaller with isAdmin resolves to the ADMIN_ROLES group",
    JSON.stringify(classifyGate("const c = await getCaller();\nif (!isAdmin(c)) return forbidden();", G).roles),
    JSON.stringify(G.ADMIN_ROLES));
  eq("getCaller with NO role predicate is auth-only, not open",
    classifyGate("const c = await getCaller();\nif (isResponse(c)) return c;\nreturn NextResponse.json({});", G).kind, "auth-only");
  eq("a cron shared secret is machine auth", classifyGate('const secret = process.env.CRON_SECRET;').kind, "service");
  eq("the landlord plane is its own kind",
    classifyGate('const caller = await getLandlordCaller();\nif (!landlordCan(caller, "platform_operations")) return deny;').kind, "platform-role");
  eq("a file with no access check at all is reported as ungated",
    classifyGate("export async function GET() { return NextResponse.json({ ok: true }); }").kind, "none");
  eq("an unresolvable role group is flagged rather than narrowed",
    classifyGate("const c = await getCaller();\nif (!isEducator(c)) return forbidden();", {}).kind, "unknown");
  eq("an office appointment is recorded alongside the role gate",
    classifyGate('const ALLOWED = ["hospital_admin"];\nconst okRole = roles.some(r => ALLOWED.includes(r)) || holdsOfficeAppointment(a);').appointment, true);
  // A route applying different predicates across its verbs reports the WIDEST way in.
  const wide = classifyGate("const c = await getCaller();\nif (!isAdmin(c)) return forbidden();\nif (!isStaff(c)) return forbidden();", G);
  ok("a route with several predicates reports the union, not the narrowest",
    G.STAFF_ROLES.every(r => wide.roles.includes(r)), JSON.stringify(wide.roles));

  console.log("\nAn unreadable gate never reads as access");
  const unknown = classifyGate("something the scanner has never seen but mentions roles", G);
  eq("...its kind is unknown", unknown.kind, "unknown");
  eq("roleReaches answers null, not true", roleReaches(unknown, "nurse"), null);
  eq("...and not false either", roleReaches(unknown, "nurse") === false, false);
  eq("machine auth is reached by no human role", roleReaches({ kind: "service", roles: [], appointment: false, evidence: null }, "super_admin"), false);
  eq("an ungated route is reachable by anyone", roleReaches({ kind: "none", roles: [], appointment: false, evidence: null }, "nurse"), true);

  // ── The committed matrix must match the code ──
  console.log("\nThe matrix is not stale");
  const file = join(process.cwd(), "src/lib/access/matrix.generated.json");
  const before = readFileSync(file, "utf8");
  execFileSync("npx", ["--yes", "tsx", "scripts/gen-access-matrix.ts"], { stdio: "pipe", shell: process.platform === "win32" });
  const after = readFileSync(file, "utf8");
  ok("the committed matrix matches a fresh scan of the code", before === after,
    "run: npx --yes tsx scripts/gen-access-matrix.ts — a gate changed without the matrix being regenerated");

  const entries = JSON.parse(after).entries;
  const s = summarise(entries, TENANT_ROLES);
  ok("every workspace is represented", s.workspaces >= 17, `got ${s.workspaces}`);
  ok("api routes are represented", s.apis >= 250, `got ${s.apis}`);
  ok("most routes classify to a real gate", (s.total - s.unknown) / s.total > 0.95,
    `${s.unknown} unknown of ${s.total}`);
  ok("no entry claims a role reaches it while being unclassified",
    entries.every((e: any) => e.gate.kind !== "unknown" || TENANT_ROLES.every(r => roleReaches(e.gate, r) === null)));
  const um = entries.find((e: any) => e.path === "/unit-manager");
  eq("the unit-manager gate is read correctly", JSON.stringify(um?.gate.roles), JSON.stringify(["hospital_admin", "super_admin"]));
  eq("...and a nurse does not reach it", roleReaches(um.gate, "nurse"), false);
  const hw = entries.find((e: any) => e.path === "/healthcare-worker");
  eq("a nurse reaches the worker workspace", roleReaches(hw.gate, "nurse"), true);

  // ── Segregation of duties, live ──
  console.log("\nSegregation of duties (pure)");
  const rule: SodRule = { id: "r1", code: "SOD-1", label: "Assess and approve", role_a: "assessor", role_b: "hospital_admin", severity: "high", rationale: null, active: true };
  const people = [
    { id: "p1", full_name: "Both", roles: ["assessor", "hospital_admin"] },
    { id: "p2", full_name: "One", roles: ["assessor"] },
  ];
  eq("a person holding both roles breaches the rule", findSodBreaches([rule], people).length, 1);
  eq("...and it is the right person", findSodBreaches([rule], people)[0].subjectName, "Both");
  eq("a person holding one role does not", findSodBreaches([rule], [people[1]]).length, 0);
  eq("removing a role clears the breach immediately",
    findSodBreaches([rule], [{ id: "p1", full_name: "Both", roles: ["assessor"] }]).length, 0);
  eq("an inactive rule is not evaluated", findSodBreaches([{ ...rule, active: false }], people).length, 0);
  const withEx = findSodBreaches([rule], people, [{ rule_id: "r1", subject_id: "p1", reason: "Interim cover", expires_at: "2099-01-01" }]);
  eq("a live exception marks the breach accepted", withEx[0].excepted, true);
  const expired = findSodBreaches([rule], people, [{ rule_id: "r1", subject_id: "p1", reason: "Interim cover", expires_at: "2020-01-01" }]);
  eq("an EXPIRED exception does not excuse it", expired[0].excepted, false);
  eq("...and the expiry is reported so the surface can say why", expired[0].exceptionExpired, true);
  eq("an exception for a DIFFERENT person does not apply",
    findSodBreaches([rule], people, [{ rule_id: "r1", subject_id: "p2", reason: "x", expires_at: null }])[0].excepted, false);

  // ── Live round-trip ──
  console.log("\nLive round-trip (real rows)");
  const { data: staff } = await admin.from("profiles").select("id, full_name, hospital_id, role, roles").not("hospital_id", "is", null).limit(3000);
  const byHospital = new Map<string, any[]>();
  for (const p of staff ?? []) { const k = String(p.hospital_id); if (!byHospital.has(k)) byHospital.set(k, []); byHospital.get(k)!.push(p); }
  const populated = [...byHospital.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!populated) { console.log("  no populated hospital — cannot run live tests"); process.exit(1); }
  const hid = populated[0];
  const subject = populated[1][0];
  console.log(`  ${populated[1].length} people\n`);

  const made: { table: string; ids: string[] }[] = [];
  const track = (t: string, rows: any[]) => made.push({ table: t, ids: rows.map(r => r.id) });
  try {
    const base: any = await loadAccessGovernance(admin, hid, false);
    eq("migration 166 detected", base.provisioned, true);
    ok("the matrix loads from the generated file", base.matrix.total > 100, `got ${base.matrix.total}`);
    ok("role distribution reflects real people", base.people.total > 0);

    // A rule that the chosen person definitely breaches, built from the roles they actually hold.
    const held = (subject.roles?.length ? subject.roles : [subject.role]).filter(Boolean);
    if (held.length >= 2) {
      const { data: r, error } = await admin.from("sod_rules").insert([{
        hospital_id: hid, code: "HX-SOD", label: "HX harness rule", role_a: held[0], role_b: held[1],
        severity: "critical", rationale: "Harness", active: true,
      }]).select("id");
      if (error) throw new Error(`sod_rules: ${error.message}`);
      track("sod_rules", r!);
      const withRule: any = await loadAccessGovernance(admin, hid, false);
      ok("a live rule produces a live breach", withRule.sod.live > base.sod.live,
        `${withRule.sod.live} vs ${base.sod.live}`);
      ok("the breach names the person", withRule.sod.breaches.some((b: any) => b.subjectId === subject.id));
      ok("a critical breach raises a HIGH signal",
        withRule.signals.some((x: any) => x.severity === "high" && /segregation-of-duty/.test(x.text)));

      const { data: ex } = await admin.from("sod_exceptions").insert([{
        hospital_id: hid, rule_id: r![0].id, subject_id: subject.id, subject_name: subject.full_name,
        reason: "HX accepted", expires_at: "2099-01-01",
      }]).select("id");
      track("sod_exceptions", ex ?? []);
      const withEx2: any = await loadAccessGovernance(admin, hid, false);
      // Measured against the SUBJECT, not the total: other people in this hospital may hold the same pair
      // of roles, and their breaches are untouched by an exception granted to one person.
      eq("an accepted breach drops out of the live count", withRule.sod.live - withEx2.sod.live, 1);
      eq("the subject's own breach is the one now accepted",
        withEx2.sod.breaches.find((b: any) => b.subjectId === subject.id)?.excepted, true);
      ok("...and it is still listed rather than hidden", withEx2.sod.excepted > base.sod.excepted);
    } else {
      console.log("  note  the chosen person holds one role, so the live SoD path is covered by the pure tests only");
    }

    // Access review: an undecided item must never count as approved.
    const { data: rev, error: revErr } = await admin.from("access_reviews").insert([{
      hospital_id: hid, name: "HX Quarterly review", scope: "unit", status: "open",
      opened_at: new Date().toISOString(), due_at: new Date(Date.now() - 86400000).toISOString(), owner_name: "HX Owner",
    }]).select("id");
    if (revErr) throw new Error(`access_reviews: ${revErr.message}`);
    track("access_reviews", rev!);
    const { data: its, error: itErr } = await admin.from("access_review_items").insert([
      { review_id: rev![0].id, subject_id: subject.id, subject_name: subject.full_name, access_type: "role", access_ref: "hospital_admin", decision: "retain", decided_by_name: "HX Owner", decided_at: new Date().toISOString() },
      { review_id: rev![0].id, subject_id: subject.id, subject_name: subject.full_name, access_type: "role", access_ref: "assessor", decision: null, decided_by_name: null, decided_at: null },
    ]).select("id");
    if (itErr) throw new Error(`access_review_items: ${itErr.message}`);
    track("access_review_items", its!);

    const withRev: any = await loadAccessGovernance(admin, hid, false);
    const row = withRev.reviews.rows.find((r: any) => r.name === "HX Quarterly review");
    eq("both items are counted", row?.items, 2);
    eq("only the decided one counts as decided", row?.decided, 1);
    eq("an undecided item is NOT counted as retained", row?.retain, 1);
    eq("progress reflects the undecided item", row?.progress, 50);
    eq("a past due date marks the campaign overdue", row?.overdue, true);
    ok("an overdue campaign raises a HIGH signal",
      withRev.signals.some((x: any) => x.severity === "high" && /past their due date/.test(x.text)));

    const NONE = "00000000-0000-0000-0000-000000000000";
    const foreign: any = await loadAccessGovernance(admin, NONE, false);
    eq("another tenant sees no reviews", foreign.reviews.recorded, 0);
    eq("another tenant sees no SoD rules", foreign.sod.rules, 0);
    ok("...but still sees the matrix, which is not tenant data", foreign.matrix.total === base.matrix.total);
  } finally {
    for (const m of [...made].reverse()) if (m.ids.length) await admin.from(m.table).delete().in("id", m.ids);
    const { data: left } = await admin.from("sod_rules").select("id").eq("code", "HX-SOD").limit(1);
    const { data: leftR } = await admin.from("access_reviews").select("id").like("name", "HX %").limit(1);
    ok("harness rows removed", !left?.length && !leftR?.length);
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
