import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { experienceHref } from "@/lib/individual/experiences";
import { audit } from "@/lib/individual/scholar/http";
import { assessmentApiGate, respond } from "@/lib/assessment/adapters/scholar/gate";
import { startSelf } from "@/lib/assessment/adapters/scholar/store";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/assessments/start { code } -- CHECKLIST STUDIO S3. Starts a NEW self-assessment on the latest published
// version of an instrument HQ offers. Guard, then module, then readiness, then the learner's own id on every row. The learner is the
// guard's user id, never a body field. Self-reported, always. No AI.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await assessmentApiGate(ctx);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.code !== "string") return NextResponse.json({ error: "Choose an assessment." }, { status: 400 });
  const r = await startSelf(ctx.admin, ctx.userId, body.code, gate.policyCodes);
  if (r.ok) await audit(ctx, "asmt_self_started", "asmt_instance", r.data.instanceId, { code: body.code });
  return respond(r, d => ({ href: experienceHref("scholar", `my-competencies/assessments/${d.instanceId}`) }));
}
