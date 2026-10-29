import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import {
  assignRequest, createMethod, endScope, grantScope, newDraft, publishVersion, retireVersion, revokeDecision, saveDraft,
} from "@/lib/competency/verification";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/hq/competency-verification -- COMPETEN-PROFESSIONAL-COMPETENCY-01 C5 (migration 510), the Verification Studio.
//
//   POST { action, ... }
//     create_method { code, name, kind }             a method and its first draft
//     new_draft     { methodId }                     a new draft from the latest criteria
//     save_draft    { versionId, content }           the no-code editor saves the draft (never a published version). 680 records the editor
//     publish       (680) never by the author or an editor of the version: another administrator publishes it
//     publish       { versionId }                    the criteria become fixed, and the older version retires
//     retire        { versionId }                    no new requests on it. Decisions under it keep it
//     grant_scope   { appointmentId, kind, ref | value, validUntil?, reason }
//     end_scope     { scopeId, reason }
//     assign        { requestId, appointmentId }     an assessor appointment takes a request
//     revoke        { decisionId, reason }           a standing outcome is revoked, with the reason the person sees
//
// ⚠ GATED BY hq.competency.verification.manage, held only by the Verification Studio Administrator (510), which nobody
// holds until the owner appoints someone. The DATABASE checks again on every write: the actor's ACTIVE appointment, an
// assessor never scoped or assigned by themselves, never on a person's own request.
// ⚠ The audit row names the action and its subject, never the criteria text or a person's evidence.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.competency.verification.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const b = await req.json().catch(() => ({}));
  const id = (k: string) => (typeof b?.[k] === "string" ? b[k] : "");
  let out: { ok: true } | { ok: false; status: number; error: string };
  let entity: { type: string; id: string | null } = { type: "competency_verification_method", id: null };
  let extra: Record<string, unknown> = {};

  switch (b?.action) {
    case "create_method": {
      const r = await createMethod(ctx.admin, ctx.userId, { code: b.code, name: b.name, kind: b.kind });
      if (r.ok) { await audit(ctx, "competency_verification_method_create", { type: "competency_verification_method", id: r.methodId }, { version: r.versionId, kind: b.kind }); return NextResponse.json({ ok: true, methodId: r.methodId, versionId: r.versionId }, { status: 201 }); }
      out = r; break;
    }
    case "new_draft": {
      const r = await newDraft(ctx.admin, ctx.userId, id("methodId"));
      if (r.ok) { await audit(ctx, "competency_verification_version_draft", { type: "competency_verification_method", id: id("methodId") }, { version: r.versionId }); return NextResponse.json({ ok: true, versionId: r.versionId }, { status: 201 }); }
      out = r; break;
    }
    case "save_draft": {
      const r = await saveDraft(ctx.admin, ctx.userId, id("versionId"), b.content);
      if (r.ok) { await audit(ctx, "competency_verification_version_save", { type: "competency_verification_method_version", id: id("versionId") }, { problems: r.problems.length }); return NextResponse.json({ ok: true, problems: r.problems }); }
      out = r; break;
    }
    case "publish": out = await publishVersion(ctx.admin, ctx.userId, id("versionId")); entity = { type: "competency_verification_method_version", id: id("versionId") }; break;
    case "retire": out = await retireVersion(ctx.admin, ctx.userId, id("versionId")); entity = { type: "competency_verification_method_version", id: id("versionId") }; break;
    case "grant_scope": out = await grantScope(ctx.admin, ctx.userId, b); entity = { type: "ogs_office_appointment", id: id("appointmentId") || null }; extra = { kind: b?.kind }; break;
    case "end_scope": out = await endScope(ctx.admin, ctx.userId, id("scopeId"), b?.reason); entity = { type: "competency_assessor_scope", id: id("scopeId") || null }; break;
    case "assign": out = await assignRequest(ctx.admin, ctx.userId, id("requestId"), id("appointmentId")); entity = { type: "competency_verification_request", id: id("requestId") || null }; extra = { appointment: id("appointmentId") }; break;
    case "revoke": out = await revokeDecision(ctx.admin, ctx.userId, id("decisionId"), b?.reason); entity = { type: "competency_verification_decision", id: id("decisionId") || null }; break;
    default: return refuse(400, "Unknown action.");
  }
  if (!out.ok) return refuse(out.status, out.error);
  await audit(ctx, `competency_verification_${b.action}`, entity, extra);
  return NextResponse.json({ ok: true });
}

async function audit(ctx: { admin: unknown; userId: string; fullName: string | null }, action: string, entity: { type: string; id: string | null }, extra: Record<string, unknown>) {
  await (ctx.admin as { from: (t: string) => { insert: (r: unknown) => PromiseLike<unknown> } }).from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName, action, entity_type: entity.type, entity_id: entity.id, new_value: extra,
  }).then((r: unknown) => r, () => {});
}
