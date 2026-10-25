import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import { parseEntry } from "@/lib/individual/professional/competency-form";
import { addEntry, setEntry } from "@/lib/individual/professional/competency-store";
import { createNeed, linkCompetency } from "@/lib/individual/professional/needs-store";
import { createGoal, linkPlanCompetency } from "@/lib/individual/professional/plan-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/my-competencies -- COMPETEN-PROFESSIONAL-COMPETENCY-01 C1 and S9 (migration 520).
//
//   POST { competencyId } | { title, description?, category? }   add an offered catalogue competency, or one in own words
//   POST { action: "need" | "goal", id }                         a development need (470) or a goal (480) from the entry,
//                                                                 through those stages' own writers, linked to the competency
//   PATCH { id, removed | interest | interestNote }              remove (kept as history), bring back, or mark an interest
//
// ⚠ ONLY OFFERED CATALOGUES. A catalogue entry must be in the Professional allowlist (published, entitled). A personal
// entry is the person's own words and is never verifiable. Nothing here states that anyone is or is not competent.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);

  if (fields.action === "need" || fields.action === "goal") {
    if (!isUuid(fields.id)) return refuse("Choose a competency.");
    const { data: e } = await ctx.admin.from("individual_professional_my_competency").select("id, kind, framework_competency_id, title")
      .eq("id", fields.id).eq("user_id", ctx.userId).maybeSingle();
    if (!e) return refuse("That competency is not in My Competencies.", 404);
    const offered = e.framework_competency_id ? await loadCatalogueFor(ctx.admin, "professional") : [];
    const title = `Develop: ${e.title}`.slice(0, 200);
    if (fields.action === "need") {
      const made = await createNeed(ctx.admin, ctx.userId, { title, origin: "competency_exploration" }, {});
      if (!made.ok) return refuse(made.error, made.status);
      if (e.framework_competency_id && offered) await linkCompetency(ctx.admin, ctx.userId, made.id!, e.framework_competency_id, offered, null);
      await audit(ctx, "individual_professional_need_create", "individual_professional_need", made.id, { from: "competency" });
      return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
    }
    const made = await createGoal(ctx.admin, ctx.userId, { title }, {
      createdFrom: "competency", needId: null, competencyId: e.framework_competency_id, offeringId: null, aspirationItemId: null, reflectionId: null,
    });
    if (!made.ok) return refuse(made.error, made.status);
    if (e.framework_competency_id && offered) await linkPlanCompetency(ctx.admin, ctx.userId, { goalId: made.id! }, e.framework_competency_id, offered, null);
    await audit(ctx, "individual_professional_goal_create", "individual_professional_goal", made.id, { from: "competency" });
    return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
  }

  const policy = (await loadIndividualPolicy(ctx.admin)).professionalCompetency;
  const offered = isUuid(fields.competencyId) ? await loadCatalogueFor(ctx.admin, "professional") : [];
  if (offered === null) return refuse("The competencies could not be read just now.", 503);
  const parsed = parseEntry(fields, policy, offered);
  if (!parsed.ok) return refuse(parsed.error);
  const out = await addEntry(ctx.admin, ctx.userId, parsed.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_my_competency_add", "individual_professional_my_competency", out.id, { kind: parsed.value.kind });
  return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.id)) return refuse("Choose a competency.");
  const flag = (v: unknown) => (v === undefined ? undefined : v === true || v === "true");
  const note = typeof fields.interestNote === "string" ? fields.interestNote.trim().slice(0, 1000) || null : undefined;
  const p = { removed: flag(fields.removed), interest: flag(fields.interest), interest_note: note };
  if (p.removed === undefined && p.interest === undefined && p.interest_note === undefined) return refuse("Choose what to change.");
  const out = await setEntry(ctx.admin, ctx.userId, fields.id, p);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_my_competency_change", "individual_professional_my_competency", fields.id, { removed: p.removed ?? null, interest: p.interest ?? null });
  return NextResponse.json({ ok: true });
}
