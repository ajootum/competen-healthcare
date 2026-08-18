/**
 * COMP-IDENTITY-001 item 14 — organisation join requests + team membership, over migration 308.
 *
 * WHAT IT PROVES, against the live database:
 *   - the request lifecycle: ask → one-PENDING rule (engine sentence AND the sentinel unique at the
 *     database) → withdraw frees the sentinel → refuse needs words → approve GRANTS;
 *   - ⚠ THE GRANT IS THE ROLE EDITOR'S GRANT: approval writes the profile through
 *     profileUpdateForOrgRoles — the same derivation, pinned here against the old route arithmetic;
 *   - ⚠ APPROVAL OPENS GATE 1: a requester with no platform_membership row holds one afterwards —
 *     the born-locked-out shape the users route guards against, guarded here too;
 *   - single-home: asking while homed is refused; approving a since-homed requester is refused as
 *     stale rather than silently overwriting their organisation;
 *   - migration 308's own constraints are real (refusal-needs-words, grant-only-on-approval);
 *   - teams: membership is now expressible — add, refuse-duplicate, list, mine, remove, archived.
 *
 *   npx --yes tsx scripts/identity-join-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  createJoinRequest, myJoinRequests, withdrawJoinRequest, decideJoinRequest, listJoinRequests,
} from "../src/lib/org-join";
import { addTeamMember, removeTeamMember, listTeamMembers, teamsOf } from "../src/lib/enterprise/teams";
import { profileUpdateForOrgRoles, ORG_ROLE_CONFIG, type OrgRole } from "../src/lib/roles";
import { cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const STAMP = Date.now();
const mail = (n: string) => `harness-join-${n}-${STAMP}@harness.invalid`;

const created: { users: string[]; orgs: string[]; teams: string[] } = { users: [], orgs: [], teams: [] };

async function newUser(name: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: mail(name), email_confirm: true, user_metadata: { full_name: `Harness ${name}` },
  });
  if (error || !data.user) throw new Error(`fixture user ${name}: ${error?.message}`);
  created.users.push(data.user.id);
  // handle_new_user may or may not have populated a profile row depending on trigger timing; make
  // the profile deterministic AND un-homed either way. This is fixture setup, not the path under test.
  await admin.from("profiles").upsert({
    id: data.user.id, email: mail(name), full_name: `Harness ${name}`,
    role: null, roles: [], org_role: null, org_roles: [],
    organisation_id: null, hospital_id: null,
  });
  return data.user.id;
}

async function cleanup() {
  for (const id of created.teams) await admin.from("ent_teams").delete().eq("id", id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id).catch(() => null);
  for (const id of created.orgs) await admin.from("organisations").delete().eq("id", id);
}

async function main() {
  console.log("\n=== IDENTITY: ORG JOIN REQUESTS + TEAM MEMBERSHIP (migration 308) ===\n");

  // ── 0. THE SHARED DERIVATION, PINNED AGAINST THE OLD ROUTE ARITHMETIC ──────────────────────────
  const derived = profileUpdateForOrgRoles(["educator", "org_admin"], ["assessor"]);
  const tiers: [OrgRole, OrgRole] = ["educator", "org_admin"];
  const expectPrimary = ORG_ROLE_CONFIG[tiers[0]].tier < ORG_ROLE_CONFIG[tiers[1]].tier ? tiers[0] : tiers[1];
  ok("0a. profileUpdateForOrgRoles keeps the route's arithmetic: primary = lowest tier, portals = union",
    !!derived && derived.org_role === expectPrimary
    && derived.role === ORG_ROLE_CONFIG[expectPrimary].portalRole
    && derived.roles.includes("assessor")
    && derived.org_roles.length === 2,
    JSON.stringify(derived));
  ok("0b. a grant of nothing is null, not an empty grant",
    profileUpdateForOrgRoles([]) === null && profileUpdateForOrgRoles(["not_a_role"]) === null);

  // ── fixtures ────────────────────────────────────────────────────────────────────────────────────
  const { data: org, error: orgErr } = await admin.from("organisations")
    .insert({ name: `Harness Org ${STAMP}`, hq_country: "UG", type: "private" }).select("id").single();
  if (orgErr) { console.error("org fixture failed:", orgErr.message); process.exitCode = 1; return; }
  created.orgs.push(org.id);

  const asker = await newUser("asker");
  const approver = await newUser("approver");
  const bystander = await newUser("bystander");
  // The approver is an organisation administrator OF THIS ORG — the authority the engine checks.
  await admin.from("profiles").update({
    organisation_id: org.id, role: "hospital_admin", roles: ["hospital_admin"],
  }).eq("id", approver);

  try {
    // ── 1. ASK ────────────────────────────────────────────────────────────────────────────────────
    const asked = await createJoinRequest(admin, { userId: asker, organisationId: org.id, note: "I work at the clinic" });
    ok("1a. an un-homed account can ask", asked.ok, asked.ok ? "" : asked.message);
    const again = await createJoinRequest(admin, { userId: asker, organisationId: org.id });
    ok("1b. asking twice is refused with the waiting sentence",
      !again.ok && again.code === "ALREADY_ASKED" && /still waiting/i.test(again.message));
    const direct = await admin.from("org_join_request").insert({ user_id: asker, organisation_id: org.id });
    ok("1c. ⚠ THE DATABASE holds the one-PENDING rule too -- the sentinel unique, not just the engine",
      !!direct.error, direct.error?.message ?? "A SECOND PENDING ROW WAS ACCEPTED");
    const ghostOrg = await createJoinRequest(admin, { userId: asker, organisationId: "00000000-0000-4000-8000-0000000000aa" });
    ok("1d. a request into a non-existent organisation is refused", !ghostOrg.ok && ghostOrg.code === "NO_SUCH_ORG");

    // ── 2. WITHDRAW ──────────────────────────────────────────────────────────────────────────────
    const requestId = asked.ok ? asked.data.id : "";
    const notYours = await withdrawJoinRequest(admin, { requestId, userId: bystander });
    ok("2a. ⚠ withdrawing somebody else's request reads as not-found -- existence is not theirs to learn",
      !notYours.ok && notYours.code === "NOT_FOUND");
    const withdrawn = await withdrawJoinRequest(admin, { requestId, userId: asker });
    ok("2b. the requester can withdraw their own", withdrawn.ok);
    const reAsk = await createJoinRequest(admin, { userId: asker, organisationId: org.id, note: "asking again" });
    ok("2c. withdrawal frees the sentinel -- asking again is allowed", reAsk.ok, reAsk.ok ? "" : reAsk.message);

    // ── 3. DECIDE: AUTHORITY AND WORDS ───────────────────────────────────────────────────────────
    const req2 = reAsk.ok ? reAsk.data.id : "";
    const nobody = await decideJoinRequest(admin, { requestId: req2, approve: false, decisionNote: "no", actorId: bystander });
    ok("3a. ⚠ a bystander cannot decide -- the engine checks authority itself, not only the route",
      !nobody.ok && nobody.code === "FORBIDDEN");
    const wordless = await decideJoinRequest(admin, { requestId: req2, approve: false, actorId: approver });
    ok("3b. a refusal without words is refused", !wordless.ok && wordless.code === "REFUSAL_NEEDS_WORDS");
    const emptyGrant = await decideJoinRequest(admin, { requestId: req2, approve: true, orgRoles: [], actorId: approver });
    ok("3c. a grant of nothing is refused", !emptyGrant.ok && emptyGrant.code === "GRANT_NEEDS_ROLE");

    // ── 4. APPROVE: THE GRANT ────────────────────────────────────────────────────────────────────
    const { count: memBefore } = await admin.from("platform_membership")
      .select("id", { count: "exact", head: true }).eq("user_id", asker);
    const approved = await decideJoinRequest(admin, {
      requestId: req2, approve: true, orgRoles: ["educator"], actorId: approver,
    });
    ok("4a. approval succeeds", approved.ok, approved.ok ? "" : approved.message);
    const { data: after } = await admin.from("profiles")
      .select("organisation_id, org_role, org_roles, role, roles").eq("id", asker).single();
    ok("4b. ⚠ THE GRANT IS THE ROLE EDITOR'S GRANT: org home + the derived four role columns",
      after?.organisation_id === org.id && after?.org_role === "educator"
      && JSON.stringify(after?.org_roles) === JSON.stringify(["educator"])
      && after?.role === ORG_ROLE_CONFIG.educator.portalRole
      && JSON.stringify(after?.roles) === JSON.stringify([ORG_ROLE_CONFIG.educator.portalRole]),
      JSON.stringify(after));
    const { count: memAfter } = await admin.from("platform_membership")
      .select("id", { count: "exact", head: true }).eq("user_id", asker);
    ok("4c. ⚠⚠ GATE 1 OPENED: the requester holds a platform_membership row after approval",
      (memBefore ?? 0) === 0 && (memAfter ?? 0) === 1,
      `before=${memBefore} after=${memAfter}`);
    const { data: reqRow } = await admin.from("org_join_request")
      .select("status, granted_org_role").eq("id", req2).single();
    ok("4d. the request row is the account of what was given",
      reqRow?.status === "APPROVED" && reqRow?.granted_org_role === "educator");

    // ── 5. SINGLE-HOME, BOTH DOORS ───────────────────────────────────────────────────────────────
    const homedAsk = await createJoinRequest(admin, { userId: asker, organisationId: org.id });
    ok("5a. a homed account asking again is told they already belong",
      !homedAsk.ok && homedAsk.code === "ALREADY_MEMBER");
    const stale = await createJoinRequest(admin, { userId: bystander, organisationId: org.id });
    if (stale.ok) {
      await admin.from("profiles").update({ organisation_id: org.id }).eq("id", bystander);
      const staleApprove = await decideJoinRequest(admin, {
        requestId: stale.data.id, approve: true, orgRoles: ["educator"], actorId: approver,
      });
      ok("5b. ⚠ approving a since-homed requester is refused as STALE -- never a silent overwrite",
        !staleApprove.ok && staleApprove.code === "ALREADY_HOMED");
      await admin.from("profiles").update({ organisation_id: null }).eq("id", bystander);
    } else {
      ok("5b. ⚠ approving a since-homed requester is refused as STALE -- never a silent overwrite",
        false, `fixture request failed: ${stale.message}`);
    }

    // ── 6. MIGRATION 308's CONSTRAINTS ARE REAL ──────────────────────────────────────────────────
    const badRefusal = await admin.from("org_join_request").insert({
      user_id: bystander, organisation_id: org.id, status: "REFUSED",
      decided_by: approver, decided_at: new Date().toISOString(), decision_note: "   ",
    });
    ok("6a. ⚠ THE DATABASE refuses a refusal whose words are whitespace -- btrim, not is-not-null",
      !!badRefusal.error, badRefusal.error?.message ?? "IT WAS ACCEPTED");
    const badGrant = await admin.from("org_join_request").insert({
      user_id: bystander, organisation_id: org.id, status: "WITHDRAWN",
      decided_by: bystander, decided_at: new Date().toISOString(), granted_org_role: "educator",
    });
    ok("6b. and a grant recorded on anything but an approval", !!badGrant.error);

    // ── 7. THE INBOX ─────────────────────────────────────────────────────────────────────────────
    const inbox = await listJoinRequests(admin, { organisationId: org.id });
    ok("7a. the approver's inbox lists this organisation's requests with the requester attached",
      !inbox.unavailable && inbox.items.length >= 2 && !!inbox.items[0].profiles);
    const noScope = await listJoinRequests(admin, {});
    ok("7b. an un-scoped inbox says it cannot exist rather than showing everybody's requests",
      noScope.unavailable === true);

    // ── 8. TEAMS: MEMBERSHIP IS NOW EXPRESSIBLE ──────────────────────────────────────────────────
    const { data: unit } = await admin.from("units").select("id").limit(1).maybeSingle();
    if (!unit) {
      ok("8. team membership (skipped: no unit exists on this estate to parent a fixture team)", false, "no units");
    } else {
      const { data: team, error: teamErr } = await admin.from("ent_teams")
        .insert({ unit_id: unit.id, name: `Harness Team ${STAMP}` }).select("id").single();
      ok("8-fixture. a fixture team exists", !teamErr, teamErr?.message ?? "");
      if (team) {
        created.teams.push(team.id);
        const add = await addTeamMember(admin, { teamId: team.id, userId: bystander, actorId: approver });
        ok("8a. a person can be put ON a team -- the fact migration 052 could never record", add.ok);
        const dup = await addTeamMember(admin, { teamId: team.id, userId: bystander, actorId: approver });
        ok("8b. re-adding is refused as already-there, never a silent second row",
          !dup.ok && dup.code === "ALREADY_ON_TEAM");
        const members = await listTeamMembers(admin, team.id);
        ok("8c. the team lists its people", !members.unavailable && members.items.length === 1);
        const mine = await teamsOf(admin, bystander);
        ok("8d. the spec's sentence, queryable: which teams this person belongs to",
          !mine.unavailable && mine.items.some((t: any) => t.team_id === team.id));
        const gone = await removeTeamMember(admin, { teamId: team.id, userId: bystander });
        const goneAgain = await removeTeamMember(admin, { teamId: team.id, userId: bystander });
        ok("8e. removal removes once and says so the second time",
          gone.ok && !goneAgain.ok && goneAgain.code === "NOT_ON_TEAM");
        await admin.from("ent_teams").update({ is_active: false }).eq("id", team.id);
        const archived = await addTeamMember(admin, { teamId: team.id, userId: bystander, actorId: approver });
        ok("8f. an archived team takes nobody", !archived.ok && archived.code === "TEAM_ARCHIVED");
      }
    }
  } finally {
    await cleanup();
  }

  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
