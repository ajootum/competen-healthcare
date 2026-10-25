import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { askProfessionalAssistant } from "@/lib/individual/professional/needs-ai";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Allow up to 60s for AI generation -- the ceiling the Professional assistant uses.
export const maxDuration = 60;
// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/passport-suggestions -- COMPETEN-PROFESSIONAL-PASSPORT-01, AI help with a view.
//
// { purpose? } asks the Holdings Personal AI (the one Professional helper: guard, fair use, eligibility, gateway) to
// draft a short summary for a Passport view, from the person's own record. NOTHING IS SAVED OR SHARED HERE: the draft
// comes back as text, and is used only if the person puts it in their view and creates it themselves. The AI is told
// never to invent a qualification, achievement, verification or regulatory recognition.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalPassport;
  if (policy.ai !== "on") return refuse("AI help with the Passport is turned off.");
  const purpose = typeof fields.purpose === "string" ? policy.purposes.find(o => o.code === fields.purpose)?.label ?? null : null;
  const question = `Draft a professional summary of at most three sentences for a Passport view${purpose ? ` for ${purpose.toLowerCase()}` : ""}, from my own record only. `
    + "Do not invent any qualification, role, achievement, verification, assessment or regulatory recognition, and do not call anything verified unless my record says an organisation verified it.";
  const out = await askProfessionalAssistant(ctx, req, question);
  if (!out.ok) return NextResponse.json(out.body, { status: out.status });
  await audit(ctx, "individual_passport_ai_summary", "passport_share_token", null, { model: out.model });
  return NextResponse.json({ ok: true, text: out.answer.slice(0, 2000) });
}
