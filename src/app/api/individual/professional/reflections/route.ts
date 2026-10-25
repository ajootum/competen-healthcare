import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { parseReflection } from "@/lib/individual/professional/needs-form";
import { reflectionOf, saveReflection } from "@/lib/individual/professional/needs-store";
import { askProfessionalAssistant } from "@/lib/individual/professional/needs-ai";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Allow up to 60s for an AI summary -- the ceiling the Professional assistant uses.
export const maxDuration = 60;
// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/reflections -- COMPETEN-PROFESSIONAL-NEEDS-01 N4 (migration 470).
//
//   POST            { body, template? } records a private reflection.
//   PUT ?id=        { body, template? } edits it (it stays the person's own text).
//   POST            { action: "summarise", id } -- the AUTHORISED AI action: the personal AI summarises that one
//                   reflection and may suggest one need, which comes back as text only. Only when the person asks,
//                   only when the privacy policy (professional_reflection_ai) allows it, through the gateway's
//                   identifier screen. Nothing is stored.
//
// ⚠ PRIVATE. Nothing shares a reflection: no plan, Passport, share link or organisation reads 470's table. A need
// made from a reflection names it, and copies its words only if the person chooses to.
// ⚠ The audit row says a reflection was saved or summarised, never what it says.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalNeeds;

  if (fields.action === "summarise") {
    if (policy.reflectionAi !== "on") return refuse("AI on reflections is turned off.");
    if (!isUuid(fields.id)) return refuse("Choose a reflection.");
    const r = await reflectionOf(ctx.admin, ctx.userId, fields.id);
    if (!r) return refuse("That reflection is not yours.", 404);
    const question = "Summarise this private reflection of mine in two or three sentences, then suggest at most one development need it points to, "
      + "as a line: - <what to develop> :: <why>. Do not judge my competence and do not add events. Reflection: " + r.body.slice(0, 650);
    const out = await askProfessionalAssistant(ctx, req, question);
    if (!out.ok) return NextResponse.json(out.body, { status: out.status });
    await audit(ctx, "individual_professional_reflection_summarise", "individual_professional_reflection", r.id, { model: out.model });
    return NextResponse.json({ answer: out.answer });
  }

  const parsed = parseReflection(fields, policy.templates);
  if (!parsed.ok) return refuse(parsed.error);
  const out = await saveReflection(ctx.admin, ctx.userId, null, parsed.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_reflection_create", "individual_professional_reflection", out.id);
  return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
}

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a reflection.");
  const { fields } = await readBody(req);
  const parsed = parseReflection(fields, (await loadIndividualPolicy(ctx.admin)).professionalNeeds.templates);
  if (!parsed.ok) return refuse(parsed.error);
  const out = await saveReflection(ctx.admin, ctx.userId, id, parsed.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_reflection_update", "individual_professional_reflection", id);
  return NextResponse.json({ ok: true });
}
