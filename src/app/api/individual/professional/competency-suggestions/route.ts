import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import { AI_COMPETENCY_KINDS, aiCompetencyQuestion, parseAiMappings, type AiCompetencyKind } from "@/lib/individual/professional/competency-form";
import { loadPortfolio } from "@/lib/individual/professional/competency-store";
import { askProfessionalAssistant } from "@/lib/individual/professional/needs-ai";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Allow up to 60s for AI generation -- the ceiling the Professional assistant uses.
export const maxDuration = 60;
// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/competency-suggestions -- COMPETEN-PROFESSIONAL-COMPETENCY-01 S12.
//
// { entryId, kind: explore | reflect | map | summary }. The Holdings Personal AI (the one Professional helper: guard,
// fair use, model eligibility, gateway) about ONE competency of the person's. NOTHING IS SAVED HERE: an explanation,
// reflection questions or a summary come back as advisory text, and mapping suggestions come back with the model and
// prompt version so that, IF the person accepts one, the link records where it came from. Only the competency, its
// outcomes and the titles of shareable records are sent: never a reflection. AI never verifies anything.

const PROMPT_VERSION = "comp-map-1";

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalCompetency;
  if (policy.ai !== "on") return refuse("AI help with competencies is turned off.");
  const kind = fields.kind as AiCompetencyKind;
  if (!AI_COMPETENCY_KINDS.includes(kind)) return refuse("Choose what you would like help with.");
  if (!isUuid(fields.entryId)) return refuse("Choose a competency.");
  const { data: e } = await ctx.admin.from("individual_professional_my_competency").select("id, title, framework_competency_id").eq("id", fields.entryId).eq("user_id", ctx.userId).maybeSingle();
  if (!e) return refuse("That competency is not in My Competencies.", 404);
  const offered = e.framework_competency_id ? await loadCatalogueFor(ctx.admin, "professional") : [];
  const outcomes = offered?.find(o => o.competencyId === e.framework_competency_id)?.outcomes ?? [];
  const items = kind === "map" ? (await loadPortfolio(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10))).items.filter(i => i.shareable).slice(0, 6) : [];
  if (kind === "map" && !items.length) return refuse("There are no records in your portfolio to map yet.");
  const out = await askProfessionalAssistant(ctx, req, aiCompetencyQuestion(kind, { title: e.title, outcomes }, items));
  if (!out.ok) return NextResponse.json(out.body, { status: out.status });
  await audit(ctx, "individual_professional_competency_ai", "individual_professional_my_competency", e.id, { kind, model: out.model });
  if (kind !== "map") return NextResponse.json({ ok: true, kind, text: out.answer.slice(0, 3000) });
  const maps = parseAiMappings(out.answer, items.length, outcomes.length, policy.relations.map(r => r.code));
  return NextResponse.json({
    ok: true, kind, model: out.model ?? "unknown", promptVersion: PROMPT_VERSION,
    items: maps.map(m => ({ kind: items[m.item].kind, sourceId: items[m.item].id, title: items[m.item].title, outcome: m.outcome === null ? null : outcomes[m.outcome], relation: m.relation, basis: m.basis })),
    ...(maps.length ? {} : { note: "The assistant did not suggest a mapping in a form that can be added. Map your evidence yourself below." }),
  });
}
