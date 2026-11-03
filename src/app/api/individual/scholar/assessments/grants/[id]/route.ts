import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit } from "@/lib/individual/scholar/http";
import { assessmentApiGate } from "@/lib/assessment/adapters/scholar/gate";
import { acceptGrant, endGrant } from "@/lib/assessment/adapters/scholar/store";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/assessments/grants/[id] { action: "accept" | "end", reason? } -- CHECKLIST STUDIO S3 (decision D4). The learner accepts an
// assessor grant made for them, or ends it (declining one not yet accepted is ending it). Only their own grants; an ended grant never reopens.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await assessmentApiGate(ctx);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (body?.action !== "accept" && body?.action !== "end") return NextResponse.json({ error: "Choose accept or end." }, { status: 400, headers });
  const r = body.action === "accept" ? await acceptGrant(ctx.admin, ctx.userId, id) : await endGrant(ctx.admin, ctx.userId, id, typeof body.reason === "string" ? body.reason : "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers });
  await audit(ctx, body.action === "accept" ? "asmt_grant_accepted" : "asmt_grant_ended", "asmt_respondent_grant", id, {});
  return NextResponse.json({ ok: true }, { headers });
}
