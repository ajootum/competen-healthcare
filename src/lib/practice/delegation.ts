import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  DELEGATION_AREAS, areaByCode, NEVER_DELEGABLE, APPROVAL_SUBJECTS,
} from "@/lib/practice/delegation-constants";

// CPR-310 DELEGATION BY AREA, APPROVALS AND SHARED QUEUES -- the delegation model, built after
// CPR-AUDIT-001.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// AN AREA DELEGATION MATERIALISES ORDINARY CAPABILITY GRANTS.
//
// It does not become a second place a permission can live. resolveWorkspaceContext still reads
// practice_role_assignment and nothing else; a practice_delegation row is the GROUPING that says why
// those grants exist and lets them be withdrawn together. Two places a permission can live is two
// answers to "may this person do that" and no tiebreak.
//
// This is the same shape CPR-140's plans take over follow-ups, and it is deliberate: the pattern is how
// this codebase adds a layer of meaning without adding a second source of truth.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NOTHING CLINICAL IS DELEGABLE, CHECKED TWICE. The area definitions exclude signing and clinical
// authorship; NEVER_DELEGABLE states the same rule independently and is enforced here at grant time. A
// rule stated once in a list is a convention; stated twice, with the second check refusing, it is a rule.
//
// AN APPROVAL IS A QUEUE, NOT A GATE. CPR-310 s5 already holds without it -- only a practitioner can
// sign, and the signing engines enforce that. An approval request records that a practitioner wanted to
// see something a delegate did, and whether they have. Unapproved work is NOT blocked; the delegate
// could do it because they held the capability. Anything that implied otherwise would be worse than not
// having approvals at all.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

async function liveCapabilities(admin: any, workspaceId: string, userId: string): Promise<Set<string>> {
  const { data: memberships } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active");
  const ids = ((memberships ?? []) as any[]).map(m => m.id);
  if (ids.length === 0) return new Set();

  const { data: grants } = await admin.from("practice_role_assignment")
    .select("capability_code, effective_from, effective_to").in("membership_id", ids);
  const now = nowIso();
  // Filtered in TypeScript rather than with .is("effective_to", null): a time-bounded grant that is
  // live right now is live, and the shipped bug this codebase already fixed once was exactly that test.
  return new Set(((grants ?? []) as any[])
    .filter(g => (!g.effective_from || g.effective_from <= now) && (g.effective_to === null || g.effective_to > now))
    .map(g => g.capability_code));
}

// ── DELEGATING AN AREA ───────────────────────────────────────────────────────────────────────────────

export async function delegateArea(admin: any, args: {
  workspaceId: string; membershipId: string; area: string; effectiveTo: string;
  effectiveFrom?: string; locationId?: string | null; note?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; area: string; capabilities: string[]; effectiveTo: string }>> {
  const area = areaByCode(args.area);
  if (!area) return { ok: false, status: 400, code: "UNKNOWN_AREA", message: `no such area: ${args.area}` };

  const { data: membership } = await admin.from("practice_membership")
    .select("id, user_id, role_code, status").eq("id", args.membershipId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!membership) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (membership.status !== "active")
    return { ok: false, status: 422, code: "MEMBERSHIP_NOT_ACTIVE", message: "that membership is not active" };
  if (membership.user_id === args.actorId)
    return { ok: false, status: 422, code: "SELF_DELEGATION", message: "you cannot delegate to yourself" };

  // A DELEGATION MUST END. Unchanged from the capability-level rule, and not relaxed by making the unit
  // bigger: an open-ended delegation is a role change wearing a temporary label.
  if (!args.effectiveTo)
    return { ok: false, status: 400, code: "END_REQUIRED", message: "a delegation must say when it ends" };
  const from = args.effectiveFrom ?? nowIso();
  if (args.effectiveTo <= from)
    return { ok: false, status: 400, code: "ENDS_BEFORE_IT_STARTS", message: "the end is not after the start" };

  // THE SECOND, INDEPENDENT CHECK. See the header.
  const forbidden = area.capabilities.filter(c => (NEVER_DELEGABLE as readonly string[]).includes(c));
  if (forbidden.length > 0)
    return {
      ok: false, status: 422, code: "NOT_DELEGABLE",
      message: `${forbidden.join(", ")} cannot be delegated; clinical authorship and signing stay with the practitioner`,
    };

  // YOU CANNOT GRANT WHAT YOU DO NOT HOLD -- AND AN AREA IS ALL OF IT OR NONE.
  //
  // The first draft granted whatever subset the delegator happened to hold. That is a worse failure than
  // refusing: "Documentation and letters" would appear against somebody's name on the team page while
  // they held only patient.list and could not author a document. A partial bundle under the bundle's
  // name misrepresents it exactly as a delegation that granted nothing would, and the harness caught it
  // doing so.
  const held = await liveCapabilities(admin, args.workspaceId, args.actorId);
  const withheld = area.capabilities.filter(c => !held.has(c));
  if (withheld.length > 0)
    return {
      ok: false, status: 403, code: "CANNOT_DELEGATE_WHAT_YOU_LACK",
      message: `you do not hold ${withheld.join(", ")}, so you cannot grant "${area.label}"`,
    };
  const grantable = [...area.capabilities];

  let locationId: string | null = null;
  if (args.locationId) {
    const { data: loc } = await admin.from("practice_location")
      .select("id").eq("id", args.locationId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    locationId = loc.id;
  }

  const { data: delegation, error } = await admin.from("practice_delegation").insert({
    workspace_id: args.workspaceId, membership_id: membership.id, area: area.code,
    location_id: locationId, effective_from: from, effective_to: args.effectiveTo,
    note: args.note?.trim() || null, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  // The grants. `ux_practice_capability` is unique on (membership, capability) WHERE effective_to is
  // null, so a time-bounded grant never collides with it -- these all carry an end.
  const { error: grantError } = await admin.from("practice_role_assignment").insert(
    grantable.map(c => ({
      membership_id: membership.id, capability_code: c, source: "delegation",
      effective_from: from, effective_to: args.effectiveTo,
      delegation_id: delegation.id, created_by: args.actorId,
    })),
  );
  // A DELEGATION THAT GRANTED NOTHING IS A LIE ON THE TEAM PAGE -- it says somebody can cover the diary
  // when they cannot. Rolled back rather than left standing.
  if (grantError) {
    await admin.from("practice_delegation").delete().eq("id", delegation.id);
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: grantError.message };
  }

  await admin.from("practice_membership_event").insert({
    workspace_id: args.workspaceId, subject_user_id: membership.user_id,
    event_type: "capability_delegated", to_value: area.code,
    note: `${area.label} until ${args.effectiveTo}${args.note ? ` — ${args.note}` : ""}`, actor_id: args.actorId,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.area_delegated",
    payload: { delegationId: delegation.id, area: area.code, granted: grantable, withheld, to: args.effectiveTo },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: { id: delegation.id as string, area: area.code, capabilities: grantable, effectiveTo: args.effectiveTo },
  };
}

/**
 * Withdraw a delegation early.
 *
 * ENDS EXACTLY THE GRANTS IT CREATED, by delegation_id. Ending every grant for those capabilities would
 * revoke a colleague's ROLE DEFAULT because somebody else's temporary cover was withdrawn -- and the
 * person who lost access would have no idea why.
 */
export async function withdrawDelegation(admin: any, args: {
  workspaceId: string; delegationId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ ended: number }>> {
  const reason = args.reason.trim();
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this is being withdrawn" };

  const { data: d } = await admin.from("practice_delegation")
    .select("id, membership_id, area, withdrawn_at, effective_to")
    .eq("id", args.delegationId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!d) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (d.withdrawn_at)
    return { ok: false, status: 422, code: "ALREADY_WITHDRAWN", message: "that delegation was already withdrawn" };

  const now = nowIso();
  const { data: ended } = await admin.from("practice_role_assignment")
    .update({ effective_to: now }).eq("delegation_id", d.id).gt("effective_to", now).select("id");

  await admin.from("practice_delegation").update({
    withdrawn_at: now, withdrawn_by: args.actorId, withdrawn_reason: reason,
  }).eq("id", d.id);

  // `delegation_ended` and not some new string: migration 201 constrains event_type with a CHECK, and a
  // value outside it is refused by the database. subject_user_id is NOT NULL there too, so the event is
  // written only when the membership is still resolvable -- the trail loses a row rather than the
  // withdrawal failing, which is the right way round for a permission being taken away.
  const { data: membership } = await admin.from("practice_membership").select("user_id").eq("id", d.membership_id).maybeSingle();
  if (membership?.user_id) {
    await admin.from("practice_membership_event").insert({
      workspace_id: args.workspaceId, subject_user_id: membership.user_id,
      event_type: "delegation_ended", from_value: d.area, note: reason, actor_id: args.actorId,
    });
  }
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.area_delegation_withdrawn",
    payload: { delegationId: d.id, area: d.area, ended: ((ended ?? []) as any[]).length, reason },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { ended: ((ended ?? []) as any[]).length } };
}

/**
 * Who currently holds what, by area.
 *
 * LIVE IS COMPUTED, NEVER STORED. A delegation that expired an hour ago is not live, and nothing had to
 * run for that to be true -- the same rule CPR-140 applies to overdue.
 */
export async function delegationBoard(admin: any, workspaceId: string) {
  const now = nowIso();
  const [{ data: delegations }, { data: memberships }] = await Promise.all([
    admin.from("practice_delegation")
      .select("id, membership_id, area, location_id, effective_from, effective_to, note, withdrawn_at, withdrawn_reason, created_at, created_by")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    admin.from("practice_membership").select("id, user_id, role_code, status").eq("workspace_id", workspaceId),
  ]);

  const rows = (delegations ?? []) as any[];
  const members = (memberships ?? []) as any[];
  const memberById = new Map(members.map(m => [m.id, m]));

  const userIds = [...new Set(members.map(m => m.user_id))];
  const { data: profiles } = userIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  const decorated = rows.map(d => {
    const m = memberById.get(d.membership_id);
    const live = !d.withdrawn_at && d.effective_from <= now && d.effective_to > now;
    return {
      ...d,
      live,
      // Distinguished, because "why did this stop" has different answers and the team page should say
      // which one it was.
      state: d.withdrawn_at ? "withdrawn" : live ? "live" : d.effective_from > now ? "scheduled" : "expired",
      userId: m?.user_id ?? null,
      name: m ? (nameOf.get(m.user_id) ?? null) : null,
      areaLabel: areaByCode(d.area)?.label ?? d.area,
    };
  });

  // The comp's Delegated Access Summary: how many people hold each area right now. A COUNT, not the
  // comp's percentage bars -- "85%" of a practice with six people is a number pretending to be a
  // measurement.
  const byArea = DELEGATION_AREAS.map(a => ({
    code: a.code, label: a.label, detail: a.detail,
    holders: decorated.filter(d => d.live && d.area === a.code).length,
  }));

  return {
    delegations: decorated,
    live: decorated.filter(d => d.live),
    byArea,
    memberCount: members.filter(m => m.status === "active").length,
  };
}

// ── ROLE TEMPLATES ───────────────────────────────────────────────────────────────────────────────────

export async function listRoleTemplates(admin: any, workspaceId: string, opts: { includeInactive?: boolean } = {}) {
  let q = admin.from("practice_role_template")
    .select("id, code, title, description, areas, active").eq("workspace_id", workspaceId);
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data } = await q.order("title");
  return ((data ?? []) as any[]).map(t => ({
    ...t,
    areaLabels: (Array.isArray(t.areas) ? t.areas : []).map((c: string) => areaByCode(c)?.label ?? c),
  }));
}

export async function createRoleTemplate(admin: any, args: {
  workspaceId: string; code: string; title: string; description?: string; areas: string[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a code is required" };
  if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };

  const areas = [...new Set(args.areas.map(a => String(a).trim()).filter(Boolean))];
  if (areas.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a template with no areas would grant nothing" };
  // VALIDATED AGAINST THE FIXED VOCABULARY, so a template can never name an area that resolves to
  // nothing -- which would be a role somebody assigns and then wonders why it did not work.
  const unknown = areas.filter(a => !areaByCode(a));
  if (unknown.length > 0)
    return { ok: false, status: 400, code: "UNKNOWN_AREA", message: `no such area: ${unknown.join(", ")}` };

  const { data, error } = await admin.from("practice_role_template").insert({
    workspace_id: args.workspaceId, code, title: args.title.trim(),
    description: args.description?.trim() || null, areas, created_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "CODE_IN_USE", message: `this practice already has a template coded "${code}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.role_template_created",
    payload: { templateId: data.id, code, areas }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/** Grant every area in a template at once. Each area still goes through delegateArea, checks and all. */
export async function applyRoleTemplate(admin: any, args: {
  workspaceId: string; membershipId: string; templateId: string; effectiveTo: string;
  note?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ granted: string[]; refused: { area: string; reason: string }[] }>> {
  const { data: t } = await admin.from("practice_role_template")
    .select("id, title, areas, active").eq("id", args.templateId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!t.active)
    return { ok: false, status: 422, code: "TEMPLATE_RETIRED", message: "that role template has been retired" };

  const granted: string[] = [];
  const refused: { area: string; reason: string }[] = [];
  for (const area of (Array.isArray(t.areas) ? t.areas : [])) {
    const result = await delegateArea(admin, {
      workspaceId: args.workspaceId, membershipId: args.membershipId, area: String(area),
      effectiveTo: args.effectiveTo, note: args.note ?? `From role template "${t.title}"`,
      actorId: args.actorId, correlationId: args.correlationId,
    });
    if (result.ok) granted.push(String(area));
    // PARTIAL IS REPORTED, NOT SWALLOWED. Somebody applying a five-area template who could only grant
    // three has to be told which two, or they will believe the cover is in place.
    else refused.push({ area: String(area), reason: result.message });
  }

  if (granted.length === 0)
    return {
      ok: false, status: 422, code: "NOTHING_GRANTED",
      message: `none of "${t.title}" could be granted: ${refused.map(r => r.reason).join("; ")}`,
    };
  return { ok: true, data: { granted, refused } };
}

// ── APPROVALS ────────────────────────────────────────────────────────────────────────────────────────

export async function requestApproval(admin: any, args: {
  workspaceId: string; subjectKind: string; subjectId?: string | null; patientId?: string | null;
  area?: string | null; summary: string; urgency?: string; assignedTo?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!APPROVAL_SUBJECTS.some(([k]) => k === args.subjectKind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `subjectKind must be one of: ${APPROVAL_SUBJECTS.map(([k]) => k).join(", ")}` };
  if (!args.summary.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say what is being sent for review" };

  // An assignee must be an active member here. Sending work for review to somebody who cannot open it is
  // a request that sits in a queue nobody reads.
  if (args.assignedTo) {
    const { data: m } = await admin.from("practice_membership")
      .select("id").eq("workspace_id", args.workspaceId).eq("user_id", args.assignedTo).eq("status", "active").limit(1).maybeSingle();
    if (!m) return { ok: false, status: 422, code: "NOT_A_MEMBER", message: "that person is not an active member of this practice" };
  }

  const { data, error } = await admin.from("practice_approval_request").insert({
    workspace_id: args.workspaceId, requested_by: args.actorId, assigned_to: args.assignedTo ?? null,
    subject_kind: args.subjectKind, subject_id: args.subjectId ?? null, patient_id: args.patientId ?? null,
    area: args.area ?? null, summary: args.summary.trim(),
    urgency: args.urgency === "urgent" ? "urgent" : "routine",
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.approval_requested",
    payload: { approvalId: data.id, subjectKind: args.subjectKind, urgency: args.urgency ?? "routine" },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function decideApproval(admin: any, args: {
  workspaceId: string; approvalId: string; decision: "APPROVED" | "REJECTED"; note?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const { data: r } = await admin.from("practice_approval_request")
    .select("id, status, requested_by, summary").eq("id", args.approvalId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!r) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (r.status !== "PENDING")
    return { ok: false, status: 422, code: "ALREADY_DECIDED", message: `that request is already ${r.status.toLowerCase()}` };

  // NOBODY APPROVES THEIR OWN WORK. The whole point of the queue is a second pair of eyes; a request
  // somebody can wave through themselves is a form they fill in twice.
  if (r.requested_by === args.actorId)
    return { ok: false, status: 422, code: "SELF_APPROVAL", message: "you cannot decide your own request" };

  const note = (args.note ?? "").trim();
  // A REJECTION WITHOUT WORDS IS A DECISION NOBODY CAN ACT ON. The person who did the work has to know
  // what to change.
  if (args.decision === "REJECTED" && !note)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say what needs to change" };

  const { error } = await admin.from("practice_approval_request").update({
    status: args.decision, decided_by: args.actorId, decided_at: nowIso(), decision_note: note || null,
  }).eq("id", r.id).eq("status", "PENDING");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: `practice.approval_${args.decision.toLowerCase()}`,
    payload: { approvalId: r.id, note: note || null }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.decision } };
}

export async function listApprovals(admin: any, workspaceId: string, opts: {
  status?: string; assignedTo?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_approval_request")
    .select("id, requested_by, assigned_to, subject_kind, subject_id, patient_id, area, summary, urgency, status, decided_by, decided_at, decision_note, created_at")
    .eq("workspace_id", workspaceId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.assignedTo) q = q.eq("assigned_to", opts.assignedTo);

  // Urgent first, then oldest -- ordered by what it costs to leave, as CPR-300's alerts are. Not newest
  // first, which is how the oldest request in a queue becomes the one nobody ever reaches.
  //
  // DESCENDING on urgency, and that is not a detail: "routine" sorts before "urgent" alphabetically, so
  // the obvious .order("urgency") puts every urgent request at the BOTTOM of the queue. The first draft
  // did exactly that.
  const { data } = await q.order("urgency", { ascending: false }).order("created_at").limit(opts.limit ?? 100);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.flatMap(r => [r.requested_by, r.assigned_to, r.decided_by]).filter(Boolean))];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return rows.map(r => ({
    ...r,
    requestedByName: nameOf.get(r.requested_by) ?? null,
    assignedToName: r.assigned_to ? nameOf.get(r.assigned_to) ?? null : null,
    decidedByName: r.decided_by ? nameOf.get(r.decided_by) ?? null : null,
  }));
}

/**
 * The comp's "Active Work Queues", DERIVED.
 *
 * Every one of these is a count of rows that already exist somewhere else -- documents awaiting review,
 * new registrations, approvals pending, unread messages. A work-queue table would be a second copy of
 * facts the record already holds, and it would go stale exactly when nobody was looking, which is the
 * same argument CPR-140 makes about overdue.
 *
 * EVERY QUEUE LEADS SOMEWHERE. A count somebody cannot open is decoration (CPR-300).
 */
export async function workQueues(admin: any, workspaceId: string, userId: string) {
  const count = async (table: string, apply: (q: any) => any) => {
    const { count: n } = await apply(admin.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId));
    return n ?? 0;
  };

  const [draftDocuments, unreviewedIncoming, pendingApprovals, myApprovals, openTasks, urgentApprovals] = await Promise.all([
    count("practice_clinical_document", q => q.eq("status", "DRAFT")),
    count("practice_incoming_document", q => q.is("reviewed_at", null)),
    count("practice_approval_request", q => q.eq("status", "PENDING")),
    count("practice_approval_request", q => q.eq("status", "PENDING").eq("assigned_to", userId)),
    count("practice_task", q => q.in("status", ["OPEN", "IN_PROGRESS"])),
    count("practice_approval_request", q => q.eq("status", "PENDING").eq("urgency", "urgent")),
  ]);

  return {
    queues: [
      { key: "documents", label: "Documents awaiting signature", total: draftDocuments, href: "/practice/documents?status=DRAFT" },
      { key: "incoming", label: "Received documents to review", total: unreviewedIncoming, href: "/practice/inbox" },
      { key: "approvals", label: "Waiting for your approval", total: myApprovals, href: "/practice/people?view=approvals" },
      { key: "tasks", label: "Open tasks", total: openTasks, href: "/practice/tasks" },
    ],
    pendingApprovals,
    urgentApprovals,
  };
}
