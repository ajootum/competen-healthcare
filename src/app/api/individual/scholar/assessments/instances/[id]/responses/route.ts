import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { assessmentApiGate, respond } from "@/lib/assessment/adapters/scholar/gate";
import { patchResponse } from "@/lib/assessment/adapters/scholar/store";

export const dynamic = "force-dynamic";

// PATCH /api/individual/scholar/assessments/instances/[id]/responses { key, value | null, revision } -- CHECKLIST STUDIO S3 autosave, one answer at a time.
// `revision` is the one the browser last saw (0 for none). A different one is 409 with the server's copy. value null clears the answer ("Not answered").

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await assessmentApiGate(ctx);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.key !== "string" || typeof body?.revision !== "number") return NextResponse.json({ error: "That answer could not be read." }, { status: 400 });
  const value = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value : null;
  return respond(await patchResponse(ctx.admin, ctx.userId, (await params).id, { key: body.key, value, revision: body.revision }));
}
