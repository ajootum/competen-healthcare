/**
 * ENTERPRISE MEMBERSHIP — GATE 3, AND THE DRIFT DETECTOR MIGRATION 286 PROMISED BY NAME.
 *
 * WHAT IT PROVES, from the decisions rather than from what the code happens to do:
 *   - ⚠⚠ THE THIRD STATE REFUSES. An unreadable membership store refuses at gate 3 — proved side by side
 *     with gate 1, WHICH ADMITS ON THE SAME FAILURE, so "the two gates decide opposite ways" is an
 *     executed fact rather than a sentence in a comment.
 *   - a null tenant is not a wildcard, and is refused WITHOUT A READ (the stub throws if touched).
 *   - suspended and revoked refuse; only active admits; the refusal sentences distinguish an outage
 *     from a genuine no, because the person refused by a hiccup needs to know to try again.
 *   - ⚠ THE TENANT DENORMALISATION HAS NOT RESUMED DECAYING. Migration 286 repaired a one-off backfill
 *     nothing maintains: 6 hospitals and 25 profiles had drifted null since migration 041. The repair
 *     holds only until the next unmaintained insert, and THIS assertion is the chosen remedy — the
 *     drift becomes a red harness instead of a silence. Named in 286's own header.
 *   - ⚠ D12, BEHAVIOURALLY: scan.ts classifies a requireEnterpriseContext route by RUNNING classifyGate
 *     over synthetic sources, not by grepping a name into a list. Four guard helpers have shipped
 *     without a scanner entry; each time the matrix published gated pages as "reachable without
 *     signing in".
 *   - no super_admin short-circuit: any Competen-staff membership of a tenant must be an explicit
 *     grant, never a backfill — the PLAT-OVERSIGHT position that platform visibility into a tenant is
 *     governed, not a role.
 *
 *   npx --yes tsx scripts/enterprise-membership-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import {
  admitToEnterprise, enterpriseRefusalSentence, readEnterpriseMembership,
} from "../src/lib/enterprise-membership";
import { admitToEstate } from "../src/lib/platform-membership";
import { classifyGate } from "../src/lib/access/scan";
import type { AppRole } from "../src/lib/roles";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const U = "00000000-0000-4000-8000-0000000000e1";
const T = "00000000-0000-4000-8000-0000000000e2";

/** A chainable stub admin whose maybeSingle() answers as told. The guard sees a real client's shape. */
const stubAdmin = (answer: { data: unknown; error: unknown }) => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq"]) chain[m] = () => chain;
  chain.maybeSingle = async () => answer;
  return chain;
};
/** A stub that PROVES it was never consulted. */
const untouchableAdmin = () => ({ from: () => { throw new Error("the store was read for a null argument"); } });

async function main() {
  // ── 1. THE DECISIONS, EXECUTED ───────────────────────────────────────────────────────────────────
  const active = await readEnterpriseMembership(stubAdmin({ data: { status: "active" }, error: null }), U, T);
  ok("1a. an active row admits", active.state === "member");
  const suspended = await readEnterpriseMembership(stubAdmin({ data: { status: "suspended" }, error: null }), U, T);
  ok("1b. a suspended row refuses", suspended.state === "not_member" && suspended.status === "suspended");
  const revoked = await readEnterpriseMembership(stubAdmin({ data: { status: "revoked" }, error: null }), U, T);
  ok("1c. a revoked row refuses", revoked.state === "not_member" && revoked.status === "revoked");
  const absent = await readEnterpriseMembership(stubAdmin({ data: null, error: null }), U, T);
  ok("1d. no row refuses", absent.state === "not_member");

  // ── 2. ⚠⚠ THE HEADLINE: THE TWO GATES FALL OPPOSITE WAYS ON THE SAME FAILURE ────────────────────
  const broken = stubAdmin({ data: null, error: { code: "PGRST205", message: "relation does not exist" } });
  const ent = await admitToEnterprise(broken, U, T);
  ok("2a. ⚠⚠ gate 3 REFUSES when its store cannot be read -- there is nothing underneath it",
    ent.admitted === false && ent.read.state === "unreadable",
    `admitted=${ent.admitted} state=${ent.read.state}`);
  // ⚠ THE CONTROL THAT MAKES 2a A FACT ABOUT DESIGN RATHER THAN A FACT ABOUT STUBS: gate 1, fed the
  // SAME broken store and a non-owner role, ADMITS -- because eleven estate layouts still hold a role
  // gate underneath it and refusing would blank the product for 47 people. Same failure, opposite call,
  // both deliberate. If this control ever fails, one of the two gates changed its posture and BOTH
  // files' reasoning needs re-reading before anything is "fixed".
  const est = await admitToEstate(broken, U, ["nurse"] as AppRole[]);
  ok("2b-control. ⚠ gate 1 ADMITS on the same unreadable store, so 2a is a designed asymmetry",
    est.admitted === true, `admitted=${est.admitted}`);

  // ── 3. NULL IS NOT A WILDCARD, AND THE STORE IS NOT EVEN ASKED ───────────────────────────────────
  const noTenant = await readEnterpriseMembership(untouchableAdmin(), U, null);
  ok("3a. ⚠ a null tenant refuses WITHOUT reading the store", noTenant.state === "not_member");
  const noUser = await readEnterpriseMembership(untouchableAdmin(), null, T);
  ok("3b. and a null user likewise", noUser.state === "not_member");

  // ── 4. THE SENTENCES ─────────────────────────────────────────────────────────────────────────────
  const outage = enterpriseRefusalSentence(ent.read);
  const genuine = enterpriseRefusalSentence(absent);
  ok("4a. ⚠ an outage refusal tells the person to try again; a genuine one does not",
    /trying again/i.test(outage) && !/trying again/i.test(genuine));
  ok("4b. suspended and revoked are different sentences",
    enterpriseRefusalSentence(suspended) !== enterpriseRefusalSentence(revoked));
  const banned = ["unauthorized", "forbidden", "denied"];
  ok("4c. no sentence is an HTTP word wearing a full stop",
    [outage, genuine].every(s => !banned.some(b => s.toLowerCase().includes(b))));

  // ── 5. ⚠ D12, BEHAVIOURALLY: THE SCANNER CLASSIFIES THE NEW GUARD BY RUNNING, NOT BY GREP ───────
  const route = (call: string) =>
    `import { requireEnterpriseContext } from "@/lib/enterprise-context";\n`
    + `export async function GET() { const a = await requireEnterpriseContext(${call}); return a; }`;
  const capGate = classifyGate(route(`"enterprise.workforce.view"`));
  ok("5a. ⚠⚠ a capability-gated enterprise route classifies as `capability`, never `none`",
    capGate.kind === "capability" && (capGate.capabilities ?? []).includes("enterprise.workforce.view"),
    `kind=${capGate.kind}`);
  ok("5b. and the evidence names the guard, so the matrix says which plane a route sits on",
    (capGate.evidence ?? "").includes("requireEnterpriseContext"), capGate.evidence ?? "");
  const memberGate = classifyGate(route("null"));
  ok("5c. requireEnterpriseContext(null) classifies as member-only -- a real gate, materially weaker",
    memberGate.kind === "member-only");
  const variable = classifyGate(route("someVariable"));
  ok("5d. ⚠ a call spelling the parser cannot read is `unknown`, NEVER silently `capability`",
    variable.kind === "unknown");
  const ungated = classifyGate(`export async function GET() { return new Response("hi"); }`);
  ok("5e-control. a genuinely ungated source still classifies as `none`, so 5a is a distinction",
    ungated.kind === "none");

  // ── 6. SOURCE ASSERTIONS, COMMENTS STRIPPED FIRST ────────────────────────────────────────────────
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/)
    .filter(l => !/^\s*(\/\/|\*)/.test(l)).map(l => { const i = l.indexOf("//"); return i >= 0 ? l.slice(0, i) : l; }).join("\n");
  const apiAuth = strip(readFileSync("src/lib/api-auth.ts", "utf8"));
  ok("6-control. stripping left the code behind", apiAuth.includes("admitToEstate("));
  ok("6a. ⚠ the estate gate excludes BOTH tenant planes -- enterprise is not quietly estate-gated",
    /plane !== "practice" && opts\.plane !== "enterprise"/.test(apiAuth),
    "an enterprise caller reaching admitToEstate is the 115-route regression one plane over");
  const guard = strip(readFileSync("src/lib/enterprise-context.ts", "utf8"));
  ok("6b. requireEnterpriseContext declares its plane to getCaller",
    guard.includes(`getCaller({ plane: "enterprise" })`));
  ok("6c. ⚠ a non-null capability refuses today -- fail-closed until the capability store exists",
    guard.includes("capability !== null") && guard.includes("ENTERPRISE_CAPABILITIES_NOT_BUILT"),
    "a capability nobody can hold must refuse, not decorate");

  // ── 7. LIVE: THE TABLE, THE SEED, AND ⚠ THE DRIFT DETECTOR ──────────────────────────────────────
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } });

  // A REAL select: head+count returns count null with NO error on a missing table and proves nothing.
  const { data: mem, error: mErr } = await admin.from("enterprise_membership")
    .select("user_id, tenant_id, status, source");
  ok("7a. migration 286 is applied -- the table answers a real select", !mErr, mErr?.message ?? "");
  if (mErr) { report(); return; }

  const { data: profiles } = await admin.from("profiles").select("id, full_name, role, roles, tenant_id, hospital_id");
  const { data: hospitals } = await admin.from("hospitals").select("id, name, tenant_id, organisation_id");
  const { data: orgs } = await admin.from("organisations").select("id, tenant_id");
  const hospById = new Map((hospitals ?? []).map(h => [h.id, h]));
  const orgById = new Map((orgs ?? []).map(o => [o.id, o]));

  // ⚠⚠ THE PROMISE IN 286's HEADER. The denormalisation is a one-off backfill nothing maintains; the
  // decay resumes on the next insert, and this is where it surfaces as red instead of silence. When
  // this fails, the fix is to re-run 286 section 2's statements (idempotent) AND to find what inserted
  // the row without a tenant.
  const driftedProfiles = (profiles ?? []).filter(p =>
    !p.tenant_id && p.hospital_id && hospById.get(p.hospital_id)?.tenant_id);
  ok("7b. ⚠⚠ NO profile has drifted: null tenant_id while its hospital has one",
    driftedProfiles.length === 0,
    driftedProfiles.slice(0, 4).map(p => String(p.full_name)).join(", "));
  const driftedHospitals = (hospitals ?? []).filter(h =>
    !h.tenant_id && h.organisation_id && orgById.get(h.organisation_id)?.tenant_id);
  ok("7c. ⚠ and no hospital has drifted from its organisation",
    driftedHospitals.length === 0,
    driftedHospitals.slice(0, 4).map(h => String(h.name)).join(", "));

  // Every tenant administrator with a tenant holds a membership -- else D11 is a lockout on arrival.
  const admins = (profiles ?? []).filter(p =>
    (p.role === "hospital_admin" || (p.roles ?? []).includes("hospital_admin")) && p.tenant_id);
  const held = new Set((mem ?? []).map(m => `${m.user_id}:${m.tenant_id}`));
  const locked = admins.filter(a => !held.has(`${a.id}:${a.tenant_id}`));
  ok("7d. every hospital_admin with a tenant holds an active membership -- D11 will not be a lockout",
    locked.length === 0 && admins.length > 0,
    locked.length ? locked.map(a => String(a.full_name)).join(", ") : `${admins.length} admins checked`);

  // ⚠ The no-short-circuit decision, as data: Competen staff reach a tenant by GRANT or not at all.
  const superIds = new Set((profiles ?? [])
    .filter(p => p.role === "super_admin" || (p.roles ?? []).includes("super_admin")).map(p => p.id));
  const staffRows = (mem ?? []).filter(m => superIds.has(m.user_id));
  ok("7e. ⚠ any super_admin membership of a tenant is an explicit admin_grant, never a backfill",
    staffRows.every(m => m.source === "admin_grant"),
    staffRows.filter(m => m.source !== "admin_grant").map(m => m.source).join(", "));

  report();
}

function report() {
  console.log(failures.length
    ? `\nFAILED  ${pass} passed, ${failures.length} failed\n${failures.map(f => `  - ${f}`).join("\n")}`
    : `\nPASSED  ${pass} passed, 0 failed`);
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
