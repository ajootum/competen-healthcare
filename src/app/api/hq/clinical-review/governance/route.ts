import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { publishScope, setOverride, wceMissing } from "@/lib/config/workspace-config-write";
import { CLINICAL_PATH, CLINICAL_SCOPE, REQUIRED_MAX, REQUIRED_MIN, SCOPE_KINDS, type ScopeKind } from "@/lib/competency/clinical-review";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/clinical-review/governance -- owner decision D2, migration 395.
//
// Body: { action: "add_scope", appointmentId, kind, ref } | { action: "end_scope", scopeId } |
//       { action: "set_required", standard, high, note? } | { action: "set_specialty", frameworkId, termId | null }
//
// ⚠ GATED BY hqApiGate(["hq.quality.clinical.govern"]) -- held by the Quality Council Member position. It sets
// WHAT a reviewer appointment may review and HOW MANY independent approvals content needs. It cannot approve
// anything, and appointing a person to the reviewer position stays the existing HQ appointment workflow.
// The review counts go through the CONFIG-002 engine (draft, published version, audit) at the Holdings
// clinical scope. Scope rows are checked by the 395 trigger (the right kind of record, shared only).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= REQUIRED_MIN && (v as number) <= REQUIRED_MAX;

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.quality.clinical.govern"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const audit = async (action: string, entityId: string | null, detail: Record<string, unknown>) => ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null, action, entity_type: "clinical_review", entity_id: entityId, new_value: detail,
  }).then((x: unknown) => x, () => {});

  switch (body?.action) {
    case "add_scope": {
      if (!isId(body.appointmentId) || !isId(body.ref) || !(SCOPE_KINDS as readonly string[]).includes(body.kind)) return refuse(400, "Choose a reviewer appointment and a scope.");
      const { data: a } = await ctx.admin.from("ogs_office_appointments").select("id").eq("id", body.appointmentId).eq("role", "clinical_content_reviewer").eq("status", "active").maybeSingle();
      if (!a) return refuse(404, "That is not an active clinical reviewer appointment.");
      const { data, error } = await ctx.admin.from("clinical_reviewer_scope").insert({ appointment_id: a.id, scope_kind: body.kind as ScopeKind, scope_ref: body.ref, granted_by: ctx.userId }).select("id").single();
      if (error) return refuse(422, /must be|shared/i.test(error.message) ? "That scope does not name a record of its kind (or names an organisation's own)." : "The scope could not be added just now.");
      await audit("clinical_scope_added", data.id, { appointment_id: a.id, kind: body.kind, ref: body.ref });
      return NextResponse.json({ ok: true });
    }
    case "end_scope": {
      if (!isId(body.scopeId)) return refuse(400, "Choose a scope.");
      const { data, error } = await ctx.admin.from("clinical_reviewer_scope").update({ ended_at: new Date().toISOString() }).eq("id", body.scopeId).is("ended_at", null).select("id");
      if (error) return refuse(503, "The scope could not be ended just now.");
      if (!data?.length) return refuse(404, "That scope is not active.");
      await audit("clinical_scope_ended", body.scopeId, {});
      return NextResponse.json({ ok: true });
    }
    case "set_required": {
      if (!isCount(body.standard) || !isCount(body.high)) return refuse(422, `Each count must be a whole number from ${REQUIRED_MIN} to ${REQUIRED_MAX}.`);
      if (body.high < body.standard) return refuse(422, "Higher-risk content cannot need fewer approvals than standard content.");
      if (await wceMissing(ctx.admin)) return refuse(409, "The configuration engine is not available on this environment (migration 076).");
      const actor = { userId: ctx.userId, name: ctx.fullName ?? null };
      for (const [path, value] of [[CLINICAL_PATH.standard, body.standard], [CLINICAL_PATH.high, body.high]] as const) {
        const r = await setOverride(ctx.admin, actor, CLINICAL_SCOPE, path, { value });
        if (!r.ok) return refuse(r.status, r.error);
      }
      const p = await publishScope(ctx.admin, actor, CLINICAL_SCOPE, { label: "Clinical review counts", note: typeof body.note === "string" ? body.note.slice(0, 500) : null });
      if (!p.ok) return refuse(p.status, p.error);
      return NextResponse.json({ ok: true });
    }
    case "set_specialty": {
      if (!isId(body.frameworkId) || !(body.termId === null || isId(body.termId))) return refuse(400, "Choose a framework and a specialty.");
      if (body.termId) {
        const { data: t } = await ctx.admin.from("taxonomy_terms").select("id, taxonomies!inner(kind)").eq("id", body.termId).eq("taxonomies.kind", "specialty").maybeSingle();
        if (!t) return refuse(422, "That is not a specialty.");
      }
      const { data, error } = await ctx.admin.from("frameworks").update({ specialty_term_id: body.termId }).eq("id", body.frameworkId).is("hospital_id", null).select("id");
      if (error) return refuse(503, "The framework could not be changed just now.");
      if (!data?.length) return refuse(404, "That is not a shared framework.");
      await audit("framework_specialty_set", body.frameworkId, { specialty_term_id: body.termId });
      return NextResponse.json({ ok: true });
    }
    default:
      return refuse(400, "Unknown action");
  }
}
