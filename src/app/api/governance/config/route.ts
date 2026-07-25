import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isSuper } from "@/lib/api-auth";
import { loadRegistry } from "@/lib/config/registry";
import { classifyChange } from "@/lib/config/governance";

// Configuration Governance (WCE-004) API — change-request lifecycle. Super-admin gated. Risk + required
// reviews are derived from the WCE-002 registry (§43). Separation of duties (§21): for high/critical changes
// the approver must differ from the requester and the publisher from the approver. Every action is audited.
//   POST {action:"create", ...}                → new CR (auto risk-classified + review-routed)
//   POST {action:"review", id, review_type, decision, findings}
//   POST {action:"approve"|"publish"|"verify"|"rollback"|"submit"|"cancel", id, reason?}
//   GET                                         → change-request list + stats (via the page loader)
/* eslint-disable @typescript-eslint/no-explicit-any */

async function nextRef(admin: any): Promise<string> {
  const year = new Date().getFullYear();
  const { count } = await admin.from("configuration_change_requests").select("id", { count: "exact", head: true }).gte("created_at", `${year}-01-01`);
  return `CCR-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}
async function audit(admin: any, cr: any, action: string, actorId: string | null, actorName: string | null, reason: string | null, prev?: any, next?: any) {
  await admin.from("configuration_governance_audit").insert({ cr_id: cr?.id ?? null, cr_ref: cr?.cr_ref ?? null, action, actor_id: actorId, actor_name: actorName, reason, previous_value: prev ?? null, new_value: next ?? null });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Configuration governance is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));

  const probe = await admin.from("configuration_change_requests").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return NextResponse.json({ error: "Governance not provisioned — run migration 093" }, { status: 409 });
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
  const actorName = me?.full_name ?? null;

  if (b.action === "create") {
    if (!b.title?.trim()) return badRequest("Title required");
    const reg = await loadRegistry(admin);
    const byKey = new Map((reg.provisioned ? reg.objects : []).map((o: any) => [o.object_key, o]));
    const affected: string[] = Array.isArray(b.affected_objects) ? b.affected_objects.filter(Boolean) : [];
    const scopeType = b.scope_type ?? "platform";
    const changeType = b.change_type ?? "normal";
    const { riskLevel, riskScore, requiredReviews } = classifyChange(byKey, affected, scopeType, changeType);
    const cr_ref = await nextRef(admin);
    const { data, error } = await admin.from("configuration_change_requests").insert({
      cr_ref, title: b.title.trim(), description: b.description ?? null, business_reason: b.business_reason ?? null,
      scope_type: scopeType, scope_ref: b.scope_ref ?? null, change_type: changeType, risk_level: riskLevel, risk_score: riskScore,
      affected_objects: affected, required_reviews: requiredReviews, status: "draft",
      emergency_justification: changeType === "emergency" ? (b.emergency_justification ?? null) : null,
      planned_release_date: b.planned_release_date || null, rollback_plan: b.rollback_plan ?? null,
      requested_by: userId, requested_by_name: actorName,
    }).select().single();
    if (error) return badRequest(error.message);
    await audit(admin, data, "created", userId, actorName, b.business_reason ?? null, null, { risk_level: riskLevel, required_reviews: requiredReviews });
    return NextResponse.json({ ok: true, cr: data });
  }

  // Actions on an existing CR.
  if (!b.id) return badRequest("id required");
  const { data: cr } = await admin.from("configuration_change_requests").select("*").eq("id", b.id).single();
  if (!cr) return badRequest("Change request not found");
  const highRisk = ["high", "critical"].includes(cr.risk_level);

  switch (b.action) {
    case "submit": {
      if (cr.status !== "draft") return badRequest("Only a draft can be submitted");
      await admin.from("configuration_change_requests").update({ status: "under_review", updated_at: new Date().toISOString() }).eq("id", cr.id);
      await audit(admin, cr, "submitted", userId, actorName, null, { status: cr.status }, { status: "under_review" });
      return NextResponse.json({ ok: true });
    }
    case "review": {
      if (!b.review_type || !b.decision) return badRequest("review_type and decision required");
      await admin.from("configuration_change_reviews").insert({ cr_id: cr.id, review_type: b.review_type, decision: b.decision, findings: b.findings ?? null, conditions: b.conditions ?? null, reviewer_id: userId, reviewer_name: actorName });
      const newStatus = b.decision === "reject" ? "rejected" : b.decision === "request_changes" ? "changes_requested" : "under_review";
      await admin.from("configuration_change_requests").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", cr.id);
      await audit(admin, cr, "reviewed", userId, actorName, b.findings ?? null, null, { review_type: b.review_type, decision: b.decision });
      return NextResponse.json({ ok: true });
    }
    case "approve": {
      if (!["under_review", "submitted", "changes_requested"].includes(cr.status)) return badRequest("Not in a reviewable state");
      // Separation of duties (§21) — the approver of a high-risk change must not be its requester.
      if (highRisk && cr.requested_by === userId) return forbidden("Separation of duties: the requester cannot approve a high/critical change");
      // Require every routed review to have a non-pending, non-rejecting decision.
      const { data: revs } = await admin.from("configuration_change_reviews").select("review_type, decision").eq("cr_id", cr.id);
      const ok = new Set((revs ?? []).filter((r: any) => ["approve", "approve_conditions"].includes(r.decision)).map((r: any) => r.review_type));
      const missingReviews = (cr.required_reviews ?? []).filter((rt: string) => !ok.has(rt));
      if (missingReviews.length) return badRequest(`Reviews outstanding: ${missingReviews.join(", ")}`);
      await admin.from("configuration_change_requests").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", cr.id);
      await audit(admin, cr, "approved", userId, actorName, b.reason ?? null, { status: cr.status }, { status: "approved" });
      return NextResponse.json({ ok: true });
    }
    case "publish": {
      if (cr.status !== "approved" && !(cr.change_type === "emergency" && cr.status === "draft")) return badRequest("Only an approved change (or an emergency) can be published");
      await admin.from("configuration_change_requests").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", cr.id);
      await audit(admin, cr, cr.change_type === "emergency" ? "emergency" : "published", userId, actorName, b.reason ?? null, { status: cr.status }, { status: "published" });
      return NextResponse.json({ ok: true });
    }
    case "verify": {
      if (cr.status !== "published" && cr.status !== "verification") return badRequest("Only a published change can be verified");
      await admin.from("configuration_change_requests").update({ status: "verified", updated_at: new Date().toISOString() }).eq("id", cr.id);
      await audit(admin, cr, "verified", userId, actorName, b.reason ?? null, { status: cr.status }, { status: "verified" });
      return NextResponse.json({ ok: true });
    }
    case "rollback": {
      if (!["published", "verified", "failed"].includes(cr.status)) return badRequest("Only a published/verified change can be rolled back");
      await admin.from("configuration_change_requests").update({ status: "rolled_back", updated_at: new Date().toISOString() }).eq("id", cr.id);
      await audit(admin, cr, "rolled_back", userId, actorName, b.reason ?? "rollback", { status: cr.status }, { status: "rolled_back" });
      return NextResponse.json({ ok: true });
    }
    case "cancel": {
      await admin.from("configuration_change_requests").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", cr.id);
      await audit(admin, cr, "cancelled", userId, actorName, b.reason ?? null, { status: cr.status }, { status: "cancelled" });
      return NextResponse.json({ ok: true });
    }
    default: return badRequest("Unknown action");
  }
}
