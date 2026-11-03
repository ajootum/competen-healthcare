import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { assessmentApiGate, respond } from "@/lib/assessment/adapters/scholar/gate";
import { addEvidence } from "@/lib/assessment/adapters/scholar/store";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/assessments/instances/[id]/evidence { itemKey?, kind: "note" | "record_ref", note?, refKind?, refId? } -- CHECKLIST STUDIO S3.
// A note, or a reference to the learner's OWN material or practice session (checked here against the learner's id). Append-only.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await assessmentApiGate(ctx);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  if (body?.kind !== "note" && body?.kind !== "record_ref") return NextResponse.json({ error: "Choose a note or one of your own materials." }, { status: 400 });
  return respond(await addEvidence(ctx.admin, ctx.userId, (await params).id, {
    itemKey: typeof body.itemKey === "string" ? body.itemKey : null, kind: body.kind,
    note: typeof body.note === "string" ? body.note : undefined, refKind: typeof body.refKind === "string" ? body.refKind : undefined, refId: typeof body.refId === "string" ? body.refId : undefined,
  }));
}
