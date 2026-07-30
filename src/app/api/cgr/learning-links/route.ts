import { NextResponse } from "next/server";
import { getCaller, isResponse, requireRole, badRequest, ADMIN_ROLES, EDUCATOR_ROLES, isSuper } from "@/lib/api-auth";

// CGR-027 — Competency learning linkage write path (migration 150).
// A link is a GOVERNANCE ASSERTION that a learning signal caused a competency change, so:
//   • rationale is mandatory (no unexplained links),
//   • it moves proposed → confirmed → implemented under human review (AI may propose, only people confirm),
//   • implemented_at closes the loop and makes time-to-improvement a real causal measure,
//   • every transition is audited.
// Educators and admins may propose; confirming/implementing requires admin authority.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SOURCE_TYPES = ["incident", "audit_finding", "quality_indicator", "assessment_trend", "external_guideline", "regulatory_change", "feedback", "other"];
const TARGET_TYPES = ["competency", "framework", "change_request", "assessment", "learning_path", "policy", "none"];
const LINK_TYPES = ["triggered_review", "caused_change", "informed_evidence", "no_action_required"];
const STATUSES = ["proposed", "confirmed", "implemented", "rejected"];

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const gate = requireRole(c, [...new Set([...EDUCATOR_ROLES, ...ADMIN_ROLES])]);
  if (gate) return gate;

  const body = await req.json().catch(() => ({}));
  const { sourceType, sourceId, sourceRef, signalDate, targetType, targetId, targetName, linkType, rationale, proposedByAi } = body ?? {};

  if (!rationale || !String(rationale).trim()) return badRequest("A rationale is required — a link is a governance assertion.");
  if (sourceType && !SOURCE_TYPES.includes(sourceType)) return badRequest("Unknown source type");
  if (targetType && !TARGET_TYPES.includes(targetType)) return badRequest("Unknown target type");
  if (linkType && !LINK_TYPES.includes(linkType)) return badRequest("Unknown link type");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();

  const row: any = {
    hospital_id: c.hospitalId,
    source_type: sourceType ?? "incident",
    source_id: sourceId ?? null,
    source_ref: sourceRef ?? null,
    signal_date: signalDate ?? null,
    target_type: targetType ?? "competency",
    target_id: targetId ?? null,
    target_name: targetName ?? null,
    link_type: linkType ?? "triggered_review",
    rationale: String(rationale).trim(),
    status: "proposed",
    proposed_by_ai: !!proposedByAi,
    created_by: c.userId,
    created_by_name: me?.full_name ?? null,
  };

  const { data, error } = await c.admin.from("competency_learning_links").insert(row).select().single();
  if (error) {
    if (/duplicate key/i.test(error.message)) return badRequest("That signal is already linked to this target.");
    if (/does not exist|schema cache/i.test(error.message)) return NextResponse.json({ error: "Linkage table not found — apply migration 150." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: "learning_link_proposed",
    entity_type: "learning_link", entity_id: data.id, entity_name: data.source_ref ?? data.source_type,
    hospital_id: c.hospitalId, new_value: { source: data.source_type, target: data.target_type, link_type: data.link_type },
  }).then((r: any) => r, () => {});

  return NextResponse.json({ ok: true, link: data });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  // Confirming that a signal caused a competency change is a governance decision — admin authority only.
  const gate = requireRole(c, ADMIN_ROLES);
  if (gate) return gate;

  const body = await req.json().catch(() => ({}));
  const { id, status } = body ?? {};
  if (!id) return badRequest("Missing link id");
  if (!STATUSES.includes(status)) return badRequest("Unknown status");

  const { data: existing } = await c.admin.from("competency_learning_links").select("id, hospital_id, status, source_ref, source_type, confirmed_at").eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && existing.hospital_id && existing.hospital_id !== c.hospitalId) return NextResponse.json({ error: "Out of scope" }, { status: 403 });
  if (existing.status === "implemented") return badRequest("Link already implemented");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const patch: any = { status };
  if (status === "confirmed") { patch.confirmed_by = c.userId; patch.confirmed_by_name = me?.full_name ?? null; patch.confirmed_at = new Date().toISOString(); }
  if (status === "implemented") { patch.implemented_at = new Date().toISOString(); if (!existing.confirmed_at) { patch.confirmed_by = c.userId; patch.confirmed_by_name = me?.full_name ?? null; patch.confirmed_at = new Date().toISOString(); } }

  const { data, error } = await c.admin.from("competency_learning_links").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: `learning_link_${status}`,
    entity_type: "learning_link", entity_id: id, entity_name: existing.source_ref ?? existing.source_type,
    hospital_id: existing.hospital_id, old_value: { status: existing.status }, new_value: { status },
  }).then((r: any) => r, () => {});

  return NextResponse.json({ ok: true, link: data });
}
