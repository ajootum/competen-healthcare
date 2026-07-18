// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { METHOD_LABELS, OUTCOME_CONFIG, type AssessmentMethod, type DecisionOutcome } from "@/lib/ckcm";

// POST — in-session assistant for the Conduct Assessment cockpit. Real AI
// (Claude), grounded ONLY in governed framework content fetched server-side:
// the focused competency's criteria + checklists and the learner's real
// decision gaps. Suggests observation prompts and probing questions; never
// makes or predicts the competency decision.
// Body: { nurse_id, competency_id?, method? }
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, full_name").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!aiStatus().configured) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }
  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) {
    return NextResponse.json({ error: "AI rate limit reached (" + quota.limit + " requests/hour). Try again later." }, { status: 429 });
  }

  const { nurse_id, competency_id, method } = await req.json().catch(() => ({}));
  if (!nurse_id) return NextResponse.json({ error: "nurse_id is required" }, { status: 400 });

  const [{ data: nurse }, { data: decisions }, { data: comp }] = await Promise.all([
    admin.from("profiles").select("full_name, specialization").eq("id", nurse_id).single(),
    admin.from("competency_decisions")
      .select("competency_id, outcome, expiry_date, created_at, framework_competencies(name)")
      .eq("nurse_id", nurse_id).order("created_at", { ascending: false }).limit(200),
    competency_id
      ? admin.from("framework_competencies")
          .select(`
            name, description,
            performance_criteria(criterion, sort_order),
            competency_skills(name, is_active,
              skill_checklists(name, checklist_items(item, is_critical, sort_order))
            )
          `)
          .eq("id", competency_id).single()
      : Promise.resolve({ data: null }),
  ]);
  if (!nurse) return NextResponse.json({ error: "Clinician not found" }, { status: 404 });

  // Real gaps from latest decisions (same rules as the coach).
  const seen = new Set<string>();
  const gaps: string[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const expired = d.expiry_date && new Date(d.expiry_date).getTime() < Date.now();
    if (passing && !expired) continue;
    const name = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    if (gaps.length < 6) gaps.push(`${name} — ${expired ? "expired, reassessment due" : OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.label ?? "gap"}`);
  }

  const ctxParts: string[] = [];
  if (comp) {
    ctxParts.push(`Focused competency: ${comp.name}${comp.description ? ` — ${comp.description}` : ""}`);
    const criteria = [...(comp.performance_criteria ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(c => c.criterion);
    if (criteria.length) ctxParts.push(`Performance criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`);
    for (const s of comp.competency_skills ?? []) {
      if (s.is_active === false) continue;
      const items = (s.skill_checklists ?? []).flatMap(cl =>
        [...(cl.checklist_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
          .map(it => `${it.item}${it.is_critical ? " [CRITICAL]" : ""}`));
      if (items.length) ctxParts.push(`Checklist (${s.name}):\n${items.map(i => `- ${i}`).join("\n")}`);
    }
  }
  if (gaps.length) ctxParts.push(`Learner's current competency gaps on record:\n${gaps.map(g => `- ${g}`).join("\n")}`);

  const system = [
    "You are the Competen assessment assistant, supporting a qualified assessor during a live workplace competency assessment.",
    "Ground your suggestions ONLY in the framework content and learner record provided. Do not invent criteria, checklist items, policies, or clinical facts, and do not give individualised medical advice.",
    "You NEVER make, predict, or score the competency decision — that is the assessor's professional judgement.",
    "Produce short, practical bullets under three headings:",
    "1. Watch for — observable behaviours tied to the listed criteria (flag CRITICAL items first).",
    "2. Ask the learner — probing questions to test underpinning knowledge.",
    "3. Common omissions — steps assessors often see missed for this kind of activity, tied to the checklist where possible.",
    "If little context is provided, keep it generic to the assessment method and say the framework content is limited.",
  ].join("\n");

  const userMsg = [
    `Learner: ${nurse.full_name}${nurse.specialization ? ` (${nurse.specialization})` : ""}`,
    `Assessment method: ${METHOD_LABELS[method as AssessmentMethod] ?? method ?? "direct observation"}`,
    ctxParts.length ? ctxParts.join("\n\n") : "(no framework content provided)",
    "Give the assessor your suggestions.",
  ].join("\n\n");

  const result = await generate({ system, user: userMsg, tier: "reasoning", maxTokens: 700 });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "refusal" ? "The assistant declined this request." : `Assistant error: ${result.detail ?? "failed"}` }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "ai_assess_assist", entity_type: "worker", entity_id: nurse_id,
    new_value: { competency_id: competency_id ?? null, model: result.model, tokens: result.usage },
  });

  return NextResponse.json({ answer: result.text, model: result.model });
}
