import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { assessmentApiGate } from "@/lib/assessment/adapters/scholar/gate";
import { loadInstanceBundle } from "@/lib/assessment/adapters/scholar/store";

export const dynamic = "force-dynamic";

// GET /api/individual/scholar/assessments/instances/[id] -- CHECKLIST STUDIO S3. The learner's own instance: its status, answers and the revision of
// each (the browser refetches this after a conflict). Another person's id reads exactly as an id that does not exist.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await assessmentApiGate(ctx);
  if (!gate.ok) return gate.res;
  const b = await loadInstanceBundle(ctx.admin, ctx.userId, (await params).id);
  if (!b.ok) return NextResponse.json({ error: b.error }, { status: b.status });
  if (!b.data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, status: b.data.instance.status, responses: b.data.responses, revisions: b.data.revisions }, { headers: { "Cache-Control": "private, no-store" } });
}
