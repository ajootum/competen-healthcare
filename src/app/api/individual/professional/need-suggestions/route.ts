import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { AI_NEED_REQUEST, parseAiSuggestions } from "@/lib/individual/professional/needs-form";
import { createNeed, decideSuggestion, ruleSuggestions, saveAiSuggestions } from "@/lib/individual/professional/needs-store";
import { loadProfessionalProfile } from "@/lib/individual/professional/profile-store";
import { askProfessionalAssistant } from "@/lib/individual/professional/needs-ai";
import { SUGGESTION_DECISIONS, type SuggestionDecision } from "@/lib/individual/professional/needs-vocabulary";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Allow up to 60s for AI generation -- the ceiling the Professional assistant uses.
export const maxDuration = 60;
// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/need-suggestions -- COMPETEN-PROFESSIONAL-NEEDS-01 N7 (migration 470).
//
//   { action: "generate" }  ask the personal AI for up to three suggestions, from the person's own record. They are
//                           stored PRIVATE and undecided, each with the basis the AI gave. Policy- and fair-use-gated.
//   { action: "decide", suggestionId | ruleKey, decision: accepted | dismissed | deferred, title? }
//                           accepted creates a need -- with the person's edited title if they changed it -- marked as
//                           coming from a suggestion. dismissed and deferred create nothing. A rule suggestion is
//                           re-derived here from the person's own record, never taken from the request.
//
// ⚠ A SUGGESTION IS NEVER A NEED UNTIL ACCEPTED, and never a statement that the person lacks anything.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalNeeds;

  if (fields.action === "generate") {
    if (policy.aiSuggestions !== "on") return refuse("AI suggestions are turned off.");
    const out = await askProfessionalAssistant(ctx, req, AI_NEED_REQUEST);
    if (!out.ok) return NextResponse.json(out.body, { status: out.status });
    const items = parseAiSuggestions(out.answer);
    const saved = await saveAiSuggestions(ctx.admin, ctx.userId, items, out.model);
    if (!saved.ok) return refuse(saved.error, saved.status);
    await audit(ctx, "individual_professional_need_suggestions_generated", "individual_professional_need_suggestion", null, { count: items.length, model: out.model });
    return NextResponse.json({ ok: true, count: items.length, ...(items.length ? {} : { note: "The assistant did not suggest anything in a form that can be saved. Try again, or add a need yourself." }) });
  }

  if (fields.action !== "decide") return refuse("Choose what to do.");
  const decision = fields.decision as SuggestionDecision;
  if (!(SUGGESTION_DECISIONS as readonly string[]).includes(decision)) return refuse("Accept, dismiss or defer.");
  const edited = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim().slice(0, 200) : null;

  if (isUuid(fields.suggestionId)) {
    const { data: s } = await ctx.admin.from("individual_professional_need_suggestion").select("id, source, title, basis, status").eq("id", fields.suggestionId).eq("user_id", ctx.userId).maybeSingle();
    if (!s || s.status !== "suggested") return refuse("That suggestion is not open.", 404);
    let needId: string | null = null;
    if (decision === "accepted") {
      const made = await createNeed(ctx.admin, ctx.userId, { title: edited ?? s.title, why_it_matters: s.basis }, { createdVia: "ai_suggestion" });
      if (!made.ok) return refuse(made.error, made.status);
      needId = made.id;
    }
    const out = await decideSuggestion(ctx.admin, ctx.userId, { suggestionId: s.id, decision, acceptedNeedId: needId });
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, `individual_professional_need_suggestion_${decision}`, "individual_professional_need_suggestion", s.id, { source: s.source, need: needId });
    return NextResponse.json({ ok: true, needId });
  }

  if (typeof fields.ruleKey !== "string" || !fields.ruleKey) return refuse("Choose a suggestion.");
  if (policy.ruleSuggestions !== "on") return refuse("Suggestions are turned off.");
  const [view, decided, needs] = await Promise.all([
    loadProfessionalProfile(ctx.admin, ctx.userId),
    ctx.admin.from("individual_professional_need_suggestion").select("rule_key, status, decided_at").eq("user_id", ctx.userId).eq("source", "rule"),
    ctx.admin.from("individual_professional_need").select("aspiration_item_id, title").eq("user_id", ctx.userId),
  ]);
  const rule = ruleSuggestions({ items: view.items ?? [], needs: needs.data ?? [], decided: decided.data ?? [], today: new Date().toISOString().slice(0, 10), windowDays: policy.reviewDays })
    .find(r => r.key === fields.ruleKey);
  if (!rule) return refuse("That suggestion is no longer open.", 404);
  let needId: string | null = null;
  if (decision === "accepted") {
    const made = await createNeed(ctx.admin, ctx.userId, { title: edited ?? rule.title, why_it_matters: rule.basis }, { createdVia: "rule_suggestion", aspirationItemId: rule.aspirationItemId });
    if (!made.ok) return refuse(made.error, made.status);
    needId = made.id;
  }
  const out = await decideSuggestion(ctx.admin, ctx.userId, { rule: { key: rule.key, title: rule.title, basis: rule.basis }, decision, acceptedNeedId: needId });
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, `individual_professional_need_suggestion_${decision}`, "individual_professional_need_suggestion", out.id, { source: "rule", need: needId });
  return NextResponse.json({ ok: true, needId });
}
