import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { OFFICE_TYPES, SCOPE_TYPES } from "@/lib/ogs/lifecycle";

// OGS write-workflow — Constitute New Office (OGS-001). POST creates a first-class office with its
// founding charter, an optional chair appointment and an immutable constituting lifecycle transition.
// Admin-tier (hospital_admin/super_admin), tenant-scoped, audit-logged. Reads/lists come from the
// server page (ogsGuard scope) + router.refresh(), so no GET is needed here.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migrations 116/117 to enable the office model" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const today = () => new Date().toISOString().slice(0, 10);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Constituting an office requires admin authority");

  const b = await req.json().catch(() => ({}));
  const name = clean(b.name);
  if (!name) return badRequest("Office name required");
  const officeType = OFFICE_TYPES.includes(b.office_type) ? b.office_type : "governance";
  const scopeType = SCOPE_TYPES.includes(b.scope_type) ? b.scope_type : "hospital";
  const activate = !!b.activate;
  const status = activate ? "active" : "proposed";
  // Non-super callers are pinned to their own hospital; super may target the scoped hospital (or enterprise/null).
  const hospitalId = isSuper(c) ? (clean(b.hospital_id) ?? null) : (c.hospitalId ?? NONE);
  const quorum = Number.isFinite(+b.quorum) && +b.quorum > 0 ? Math.floor(+b.quorum) : 3;
  const reviewDate = clean(b.review_date);

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const actor = me?.full_name ?? null;

  // 1) Office.
  const { data: office, error } = await c.admin.from("ogs_offices").insert({
    hospital_id: hospitalId, organisation_id: c.organisationId ?? null,
    office_type: officeType, name, code: clean(b.code), scope_type: scopeType, status,
    authority_source: clean(b.authority_source), reporting_line: clean(b.reporting_line),
    quorum, established_at: today(), next_review_date: reviewDate, charter_version: "v1.0", is_active: activate,
  }).select("id, name, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  // 2) Founding charter.
  await c.admin.from("ogs_office_charters").insert({
    office_id: office.id, version: "v1.0",
    purpose: clean(b.purpose) ?? `Govern the ${name} mandate.`, mandate: clean(b.mandate),
    quorum_rule: clean(b.quorum_rule) ?? `Quorum: ${quorum} members.`, decision_rule: clean(b.decision_rule),
    effective_from: clean(b.effective_from) ?? today(), review_date: reviewDate,
    approved_by: actor, approval_status: activate ? "approved" : "draft",
  });

  // 3) Optional chair appointment.
  const chairId = clean(b.chair_id);
  if (chairId) {
    const scope = await assertProfileScope(c, chairId);
    if (scope) return scope;
    const { data: chair } = await c.admin.from("profiles").select("full_name").eq("id", chairId).maybeSingle();
    await c.admin.from("ogs_office_appointments").insert({ office_id: office.id, person_id: chairId, person_name: chair?.full_name ?? null, role: "chair", term_start: today(), status: "active", appointed_by: actor });
    await c.admin.from("ogs_offices").update({ chair_id: chairId, chair_name: chair?.full_name ?? null }).eq("id", office.id);
  }

  // 4) Immutable constituting transition.
  await c.admin.from("ogs_lifecycle_transitions").insert({ office_id: office.id, from_state: null, to_state: status, reason: `Office constituted${activate ? " and activated" : " (proposed)"}`, actor_name: actor });

  // 5) Activation-readiness snapshot at constitution (audit artifact; fail-soft until migration 121).
  const hasCharter = !!clean(b.purpose), hasChair = !!chairId, hasQuorum = quorum > 0, ready = hasCharter && hasChair && hasQuorum;
  await c.admin.from("ogs_activation_checklist").insert({ office_id: office.id, hospital_id: hospitalId, has_name: true, has_charter: hasCharter, has_chair: hasChair, has_quorum: hasQuorum, ready, activated: activate, created_by: c.userId });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: actor, action: "constitute_office", entity_type: "ogs_office", entity_id: office.id, hospital_id: hospitalId, new_value: { name, office_type: officeType, status } });
  return NextResponse.json(office, { status: 201 });
}
