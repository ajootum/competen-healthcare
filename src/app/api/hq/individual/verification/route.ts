import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { hasOpenRequest, isVerificationMethod, recordVerdict } from "@/lib/individual/professional/profile-verification";
import { signDocument } from "@/lib/individual/professional/documents";
import { currentTraceId } from "@/lib/trace";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/hq/individual/verification -- COMPETEN-PROFESSIONAL-PROFILE-01 part B (migration 451).
//
//   POST          { itemId, userId, event: "verified" | "declined" | "revoked", method?, validUntil?, reason? }
//   GET ?item=    a five-minute signed link to the record's document, ONLY while that record has an open
//                 request or dispute -- the person asked for it to be looked at
//
// ⚠ GATED BY hqApiGate(["hq.individual.professional.verify"]), the right the Professional Credential Verifier
// position holds (451). Nobody holds it until the owner appoints one. The DATABASE checks again, on every
// write: the actor must hold the capability through an ACTIVE appointment (an owner short-circuit here is not
// an appointment there), must not be the person, and the outcome must follow an open request or dispute.
// ⚠ The audit row carries the outcome and the method, never the record's words or the person's document.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.professional.verify"]);
  if (isHqRefusal(ctx)) return ctx;
  const b = await req.json().catch(() => ({}));
  if (!UUID.test(String(b?.itemId ?? "")) || !UUID.test(String(b?.userId ?? ""))) return refuse(400, "Choose a record.");
  const event = b?.event;
  if (event !== "verified" && event !== "declined" && event !== "revoked") return refuse(400, "Choose an outcome.");
  const method = event === "verified" ? b?.method : null;
  if (event === "verified" && !isVerificationMethod(method)) return refuse(400, "Say how it was verified.");
  const validUntil = event === "verified" && typeof b?.validUntil === "string" && b.validUntil ? b.validUntil : null;
  if (validUntil && !ISO.test(validUntil)) return refuse(400, "Enter the validity date as a date.");
  const reason = typeof b?.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, 1000) : null;
  if (event !== "verified" && (!reason || reason.length < 3)) return refuse(400, "Give the reason. The person will see it.");

  const out = await recordVerdict(ctx.admin, ctx.userId, { itemId: b.itemId, userId: b.userId, event, method, validUntil, reason });
  if (!out.ok) return refuse(out.status, out.error);
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName,
    action: `individual_professional_verification_${event}`, entity_type: "individual_professional_profile_item", entity_id: b.itemId,
    new_value: { event, method, valid_until: validUntil },
  }).then((r: unknown) => r, () => {});
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.individual.professional.verify"]);
  if (isHqRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("item") ?? "";
  if (!UUID.test(id)) return refuse(400, "Choose a record.");
  const open = await hasOpenRequest(ctx.admin, id, new Date().toISOString().slice(0, 10));
  if (!open || !open.path) return refuse(404, "There is no document to review on an open request for that record.");
  if (open.userId === ctx.userId) return refuse(403, "You cannot review your own record.");
  const signed = await signDocument(ctx.admin, open.path);
  if (!signed) return refuse(503, "The document could not be opened just now.");
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName,
    action: "individual_professional_verification_document_view", entity_type: "individual_professional_profile_item", entity_id: id, new_value: {},
  }).then((r: unknown) => r, () => {});
  return NextResponse.redirect(signed, { status: 303 });
}
