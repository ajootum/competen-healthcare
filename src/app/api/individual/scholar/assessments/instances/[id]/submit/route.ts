import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { experienceHref } from "@/lib/individual/experiences";
import { audit } from "@/lib/individual/scholar/http";
import { assessmentApiGate, respond } from "@/lib/assessment/adapters/scholar/gate";
import { submitSelf } from "@/lib/assessment/adapters/scholar/store";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/assessments/instances/[id]/submit { confirmUnanswered? } -- CHECKLIST STUDIO S3. Evaluates on the server, checks the scoring
// hash and records the outcome in one transaction. A mandatory item left unanswered needs confirmUnanswered. Self-reported: this never advances the
// evidence-supported stage and never writes the Passport or a verification.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await assessmentApiGate(ctx);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const { id } = await params;
  const r = await submitSelf(ctx.admin, ctx.userId, id, { confirmUnanswered: body?.confirmUnanswered === true });
  if (r.ok) await audit(ctx, "asmt_self_submitted", "asmt_instance", id, { outcome_class: r.data.outcome.outcomeClass });
  return respond(r, () => ({ href: experienceHref("scholar", `my-competencies/assessments/${id}/report`) }));
}
