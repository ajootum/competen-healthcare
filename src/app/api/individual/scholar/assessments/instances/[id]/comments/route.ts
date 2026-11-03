import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { assessmentApiGate, respond } from "@/lib/assessment/adapters/scholar/gate";
import { addComment } from "@/lib/assessment/adapters/scholar/store";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/assessments/instances/[id]/comments { itemKey?, body } -- CHECKLIST STUDIO S3. The learner's own words on an item or the whole
// assessment. Append-only; always a plain comment.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await assessmentApiGate(ctx);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.body !== "string") return NextResponse.json({ error: "Write a comment first." }, { status: 400 });
  return respond(await addComment(ctx.admin, ctx.userId, (await params).id, { itemKey: typeof body.itemKey === "string" ? body.itemKey : null, body: body.body }));
}
