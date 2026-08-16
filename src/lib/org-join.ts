import { createAdminClient } from "@/lib/supabase/server";
import { estateRolesOf, profileUpdateForOrgRoles } from "@/lib/roles";
import { grantPlatformMembership } from "@/lib/platform-membership";
import { notify } from "@/lib/notify";

// ── ORGANISATION JOIN REQUESTS ── COMP-IDENTITY-001 item 14, over migration 308 ─────────────────────
//
// The lifecycle step the spec names ("Organization join request"): a person with a Competen account
// and no estate home asks, in their own words, to join an organisation. An organisation
// administrator answers. Approval IS the grant, and it grants through the SAME derivation the role
// editor uses (profileUpdateForOrgRoles) -- two spellings of role arithmetic would be the estate-fold
// drift one storey up.
//
// ⚠ SINGLE ESTATE HOME, BY THE CURRENT MODEL AND BY OWNER DECISION. profiles carries ONE
// organisation_id; cross-organisation membership is deliberately NOT expressible here because the
// owner settled multi-facility membership into Competen Enterprise's own model (ENT-DEC-001), not a
// rework of profiles. So a person who already belongs to an organisation is refused at CREATE and at
// APPROVE -- moving somebody between organisations is an administrator act on the users workspace,
// stated in those words, never a silent overwrite here.
//
// ⚠ APPROVAL OPENS BOTH GATES. The requester may be a practice-only account holding no
// platform_membership row at all (the two-gate split: Practice is a separate product). Admitting
// them to an organisation without gate 1 would grant a role that no layout ever admits -- the exact
// born-locked-out shape the users route guards against at account creation. Same call, same source
// vocabulary, failure REPORTED never swallowed into a rollback.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type JoinResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): { ok: false; status: number; code: string; message: string } =>
  ({ ok: false, status, code, message });

async function auditLog(admin: any, row: Record<string, unknown>) {
  // Fail-soft like every audit_log writer on this plane -- an audit failure must not undo the act it
  // describes, and the estate's audit_log has no append trigger to refuse it.
  try { await admin.from("audit_log").insert(row); } catch { /* reported nowhere better */ }
}

export async function createJoinRequest(admin: any, args: {
  userId: string; organisationId: string; hospitalId?: string | null; note?: string | null;
}): Promise<JoinResult<{ id: string }>> {
  const { data: org } = await admin.from("organisations")
    .select("id, name").eq("id", args.organisationId).maybeSingle();
  if (!org) return fail(404, "NO_SUCH_ORG", "that organisation does not exist");

  const { data: me, error: meErr } = await admin.from("profiles")
    .select("id, full_name, organisation_id").eq("id", args.userId).maybeSingle();
  if (meErr || !me) return fail(meErr ? 500 : 404, "NO_PROFILE", meErr ? meErr.message : "your profile could not be found");
  if (me.organisation_id === args.organisationId)
    return fail(422, "ALREADY_MEMBER", "you already belong to this organisation");
  if (me.organisation_id)
    return fail(422, "ALREADY_HOMED",
      "this account already belongs to an organisation. Moving between organisations is done by an administrator on the users workspace, not by a join request");

  if (args.hospitalId) {
    const { data: hosp } = await admin.from("hospitals")
      .select("id, organisation_id").eq("id", args.hospitalId).maybeSingle();
    if (!hosp) return fail(404, "NO_SUCH_FACILITY", "that facility does not exist");
    if (hosp.organisation_id && hosp.organisation_id !== args.organisationId)
      return fail(422, "FACILITY_ELSEWHERE", "that facility belongs to a different organisation");
  }

  const { data: req, error } = await admin.from("org_join_request").insert({
    user_id: args.userId, organisation_id: args.organisationId,
    hospital_id: args.hospitalId ?? null,
    note: (args.note ?? "").trim().slice(0, 500) || null,
  }).select("id").single();
  if (error) {
    // The sentinel unique: one PENDING per person per organisation. The friendly sentence, not 23505.
    if (String(error.code) === "23505" || /ux_org_join_request_one_pending/.test(String(error.message)))
      return fail(409, "ALREADY_ASKED", "you have already asked to join this organisation, and that request is still waiting for an answer");
    return fail(500, "WRITE_FAILED", error.message);
  }

  await auditLog(admin, {
    actor_id: args.userId, actor_name: me.full_name ?? null,
    action: "org_join_requested", entity_type: "org_join_request", entity_id: req.id,
    entity_name: org.name,
  });

  // Tell the people who can answer. Organisation administrators first; facility administrators when
  // a facility was named. Fail-soft by notify's own contract.
  const { data: admins } = await admin.from("profiles")
    .select("id, role, roles").eq("organisation_id", args.organisationId).limit(200);
  const adminIds = ((admins ?? []) as any[])
    .filter(p => estateRolesOf(p).includes("hospital_admin"))
    .map(p => p.id as string).slice(0, 20);
  await notify(adminIds, {
    type: "org_join_request",
    title: "Someone asked to join your organisation",
    body: `${me.full_name ?? "A Competen account holder"} asked to join ${org.name}.`,
    href: "/organisation-admin/users",
  });

  return { ok: true, data: { id: req.id as string } };
}

export async function myJoinRequests(admin: any, userId: string) {
  const { data, error } = await admin.from("org_join_request")
    .select("id, organisation_id, hospital_id, note, status, decision_note, created_at, decided_at, organisations(name)")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  if (error) return { items: [], unavailable: true as const, detail: error.message };
  return { items: (data ?? []) as any[], unavailable: false as const, detail: null };
}

export async function withdrawJoinRequest(admin: any, args: {
  requestId: string; userId: string;
}): Promise<JoinResult<{ id: string }>> {
  const { data: req } = await admin.from("org_join_request")
    .select("id, user_id, status").eq("id", args.requestId).maybeSingle();
  if (!req || req.user_id !== args.userId)
    // One sentence for both, deliberately: whether a request exists under somebody else's account is
    // not this caller's to learn.
    return fail(404, "NOT_FOUND", "that request was not found under your account");
  if (req.status !== "PENDING")
    return fail(422, "ALREADY_DECIDED", "that request has already been answered, so there is nothing to withdraw");

  const { error } = await admin.from("org_join_request")
    .update({ status: "WITHDRAWN", decided_by: args.userId, decided_at: new Date().toISOString() })
    .eq("id", args.requestId).eq("status", "PENDING");
  if (error) return fail(500, "WRITE_FAILED", error.message);
  return { ok: true, data: { id: args.requestId } };
}

/** The approver's inbox: requests into their organisation (or their facility, for a facility-scoped admin). */
export async function listJoinRequests(admin: any, scope: {
  organisationId?: string | null; hospitalId?: string | null; status?: string;
}) {
  if (!scope.organisationId && !scope.hospitalId)
    return { items: [], unavailable: true as const, detail: "this account is not linked to an organisation or facility, so there is no inbox to show" };
  let q = admin.from("org_join_request")
    .select("id, user_id, organisation_id, hospital_id, note, status, created_at, decided_at, decision_note, granted_org_role, profiles!org_join_request_user_id_fkey(full_name, email)")
    .order("created_at", { ascending: false }).limit(100);
  q = scope.organisationId ? q.eq("organisation_id", scope.organisationId) : q.eq("hospital_id", scope.hospitalId);
  if (scope.status) q = q.eq("status", scope.status);
  const { data, error } = await q;
  if (error) return { items: [], unavailable: true as const, detail: error.message };
  return { items: (data ?? []) as any[], unavailable: false as const, detail: null };
}

export async function decideJoinRequest(admin: any, args: {
  requestId: string;
  approve: boolean;
  decisionNote?: string | null;
  /** Required on approval: what the person becomes, in the org-role vocabulary the editor uses. */
  orgRoles?: string[];
  hospitalId?: string | null;
  actorId: string;
}): Promise<JoinResult<{ id: string; status: string }>> {
  const { data: req } = await admin.from("org_join_request")
    .select("id, user_id, organisation_id, hospital_id, status, organisations(name)")
    .eq("id", args.requestId).maybeSingle();
  if (!req) return fail(404, "NOT_FOUND", "that request does not exist");
  if (req.status !== "PENDING")
    return fail(422, "ALREADY_DECIDED", "that request has already been answered");

  // The approver's authority, checked HERE as well as at the route: super_admin anywhere, or a
  // hospital_admin whose own organisation (or facility) is the one being asked into.
  const { data: actor } = await admin.from("profiles")
    .select("id, full_name, role, roles, organisation_id, hospital_id").eq("id", args.actorId).maybeSingle();
  const actorRoles = estateRolesOf(actor);
  const mayDecide = actorRoles.includes("super_admin")
    || (actorRoles.includes("hospital_admin")
      && (actor?.organisation_id === req.organisation_id
        || (req.hospital_id !== null && actor?.hospital_id === req.hospital_id)));
  if (!mayDecide)
    return fail(403, "FORBIDDEN", "answering a join request needs an organisation administrator of the organisation being asked into");

  const now = new Date().toISOString();

  if (!args.approve) {
    const note = (args.decisionNote ?? "").trim();
    if (!note)
      return fail(422, "REFUSAL_NEEDS_WORDS", "a refusal has to say why -- the requester will read it with nothing else to go on");
    const { error } = await admin.from("org_join_request")
      .update({ status: "REFUSED", decided_by: args.actorId, decided_at: now, decision_note: note.slice(0, 500) })
      .eq("id", args.requestId).eq("status", "PENDING");
    if (error) return fail(500, "WRITE_FAILED", error.message);
    await auditLog(admin, {
      actor_id: args.actorId, actor_name: actor?.full_name ?? null,
      action: "org_join_refused", entity_type: "org_join_request", entity_id: args.requestId,
      entity_name: (req as any).organisations?.name ?? null,
    });
    await notify([req.user_id], {
      type: "org_join_refused", title: "Your request to join was not approved",
      body: note.slice(0, 200), href: "/dashboard/profile",
    });
    return { ok: true, data: { id: args.requestId, status: "REFUSED" } };
  }

  // ── Approval: the grant, through the one derivation ─────────────────────────────────────────────
  const derived = profileUpdateForOrgRoles(args.orgRoles ?? []);
  if (!derived)
    return fail(422, "GRANT_NEEDS_ROLE", "approving a join request grants at least one organisation role -- a grant of nothing is not a grant");

  // The requester must still be un-homed: a second approver, or the users workspace, may have moved
  // first, and overwriting somebody's organisation silently is the harm the single-home rule exists
  // to prevent.
  const { data: subject } = await admin.from("profiles")
    .select("id, full_name, organisation_id").eq("id", req.user_id).maybeSingle();
  if (!subject) return fail(404, "NO_PROFILE", "the requester's profile no longer exists");
  if (subject.organisation_id)
    return fail(409, "ALREADY_HOMED", "this person already belongs to an organisation now -- the request is stale. Refuse it with that reason, or manage them from the users workspace");

  const grantedHospitalId = args.hospitalId ?? req.hospital_id ?? null;
  const { error: grantErr } = await admin.from("profiles").update({
    ...derived,
    organisation_id: req.organisation_id,
    hospital_id: grantedHospitalId,
  }).eq("id", req.user_id);
  if (grantErr) return fail(500, "GRANT_FAILED", grantErr.message);

  // ⚠ GATE 1, for the practice-only requester who has never held estate access. Same call and same
  // reporting shape as the users route: the failure is surfaced, never rolled into deleting the grant.
  const membership = await grantPlatformMembership(admin, req.user_id, {
    grantedBy: args.actorId, source: "admin_grant",
    note: "Organisation join request approved",
  });
  if (!membership.ok)
    console.error(`[platform-membership] GRANT FAILED for ${req.user_id} at join approval: ${membership.error}`);

  const { error } = await admin.from("org_join_request").update({
    status: "APPROVED", decided_by: args.actorId, decided_at: now,
    decision_note: (args.decisionNote ?? "").trim().slice(0, 500) || null,
    granted_org_role: derived.org_role, granted_hospital_id: grantedHospitalId,
  }).eq("id", args.requestId).eq("status", "PENDING");
  if (error) {
    // The grant stood but the request row did not update -- said plainly, because the row is the
    // account of what was given and a silent mismatch here would misreport the grant forever.
    return fail(500, "DECISION_NOT_RECORDED", `the person was admitted, but the request could not be marked approved: ${error.message}`);
  }

  await auditLog(admin, {
    actor_id: args.actorId, actor_name: actor?.full_name ?? null,
    action: "org_join_approved", entity_type: "org_join_request", entity_id: args.requestId,
    entity_name: subject.full_name ?? null,
  });
  await notify([req.user_id], {
    type: "org_join_approved", title: "You have been admitted",
    body: `Your request to join ${(req as any).organisations?.name ?? "the organisation"} was approved.`,
    href: "/dashboard",
  });

  return { ok: true, data: { id: args.requestId, status: "APPROVED" } };
}

// Convenience for routes that need the admin client without plumbing it.
export function orgJoinAdmin() { return createAdminClient(); }
