import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit, readBody, refuse, todayUtc } from "@/lib/individual/professional/api";
import { decideRecommendation, evaluationOf } from "@/lib/individual/professional/evaluation-store";
import { parseDecision } from "@/lib/individual/professional/evaluation-form";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/evaluation-decisions -- COMPETEN-PROFESSIONAL-EVALUATION-01 E4.
//
// { evaluationId, key, decision: accepted | deferred | dismissed, editedTitle?, deferredUntil?, note? }. A decision on
// one recommendation of the person's own snapshot (append-only, latest wins). Accepting one that creates a need, goal or
// activity creates it through ITS owning service (needs-store / plan-store), by the person's own id, and only then
// records the decision with the new record's id. Nothing is ever created without this request.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const p = parseDecision(fields, todayUtc());
  if (!p.ok) return refuse(p.error);
  const ev = await evaluationOf(ctx.admin, ctx.userId, p.value.evaluationId);
  if (!ev) return refuse("That evaluation is not on your record.", 404);
  const out = await decideRecommendation(ctx.admin, ctx.userId, ev, p.value.key, p.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_evaluation_decide", "individual_professional_evaluation", ev.id,
    { decision: p.value.decision, created_kind: out.created?.kind ?? null, created_id: out.created?.id ?? null });
  return NextResponse.json({ ok: true, id: out.id, created: out.created ?? null }, { status: 201 });
}
