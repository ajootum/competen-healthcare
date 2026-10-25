import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit, readBody, refuse, todayUtc } from "@/lib/individual/professional/api";
import { isUuid } from "@/lib/individual/professional/validate";
import { askProfessionalAssistant } from "@/lib/individual/professional/needs-ai";
import { composeDocument } from "@/lib/individual/professional/document-compose";
import { documentOf } from "@/lib/individual/professional/document-store";

// Allow up to 60s for AI generation -- the ceiling the Professional assistant uses.
export const maxDuration = 60;
// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/document-drafts/ai -- COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.9, OPTIONAL.
//
// { id, purpose? }. Asks the Holdings Personal AI (askProfessionalAssistant: guard, fair use, model eligibility, gateway,
// identifier screen) for a draft professional summary, from ONLY the records the person already chose for this document
// (titles, dates and status wording, never notes or reflections) and the purpose they typed. NOTHING IS SAVED: the text
// goes back to the page, and becomes part of the draft only if the person accepts it and saves. It is told not to add
// anything the records do not say. The Document Studio works fully without this route.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.professionalDocuments.ai !== "on") return refuse("AI help in the Document Studio is turned off.");
  if (!isUuid(fields.id)) return refuse("Choose a document.");
  const doc = await documentOf(ctx.admin, ctx.userId, fields.id);
  if (!doc) return refuse("That document is not yours.", 404);
  const c = await composeDocument(ctx.admin, ctx, doc, todayUtc());
  if ("error" in c) return refuse(c.error, 409);
  const entries = c.model.sections.flatMap(s => s.entries.map(e => `- ${s.title}: ${e.title}${e.subtitle ? `, ${e.subtitle}` : ""}${e.when ? ` (${e.when})` : ""} [${e.status}]`)).slice(0, 40);
  if (!entries.length) return refuse("Choose some records for the document first: the summary is written only from them.");
  const purpose = typeof fields.purpose === "string" ? fields.purpose.trim().slice(0, 300) : "";
  const question = [
    `Draft a professional summary of 60 to 120 words for my ${c.type.label}${purpose ? `, for this purpose: ${purpose}` : ""}.`,
    "Use ONLY these records I chose, and keep each one's status wording honest:", ...entries,
    "Do not add any qualification, registration, employer, achievement, assessment outcome or competence that is not listed.",
    "Do not describe self-declared or formative records as verified. Write in the first person, plain and professional.",
  ].join("\n");
  const out = await askProfessionalAssistant(ctx, req, question);
  if (!out.ok) return NextResponse.json(out.body, { status: out.status });
  await audit(ctx, "individual_professional_document_ai", "individual_professional_document", doc.id, { model: out.model, records: entries.length });
  return NextResponse.json({ ok: true, text: out.answer.trim().slice(0, 4000), model: out.model });
}
