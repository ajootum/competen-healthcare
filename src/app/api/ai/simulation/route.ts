// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";

// Simulation & OSCE Centre — AI scenario designer. Real Claude generation,
// grounded in the linked competency's governed criteria/checklists when
// provided. Drafts a runnable simulation scenario (presentation, vitals,
// expected actions, deterioration branches, debrief points) for the assessor
// to review and edit — the assessor stays the author of record.
// Body: { scenario_name, competency_id? }
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
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: "AI rate limit reached (" + quota.limit + " requests/hour). Try again later." }, { status: 429 });

  const { scenario_name, competency_id } = await req.json().catch(() => ({}));
  const name = typeof scenario_name === "string" ? scenario_name.trim() : "";
  if (!name) return NextResponse.json({ error: "scenario_name is required" }, { status: 400 });

  const ctxParts: string[] = [];
  if (competency_id) {
    const { data: comp } = await admin.from("framework_competencies")
      .select(`
        name, description,
        performance_criteria(criterion, sort_order),
        competency_skills(name, is_active, skill_checklists(name, checklist_items(item, is_critical, sort_order)))
      `)
      .eq("id", competency_id).single();
    if (comp) {
      ctxParts.push(`Linked competency: ${comp.name}${comp.description ? ` — ${comp.description}` : ""}`);
      const criteria = [...(comp.performance_criteria ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(c => c.criterion);
      if (criteria.length) ctxParts.push(`Performance criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`);
      for (const s of comp.competency_skills ?? []) {
        if (s.is_active === false) continue;
        const items = (s.skill_checklists ?? []).flatMap(cl =>
          [...(cl.checklist_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
            .map(it => `${it.item}${it.is_critical ? " [CRITICAL]" : ""}`));
        if (items.length) ctxParts.push(`Existing checklist (${s.name}):\n${items.map(i => `- ${i}`).join("\n")}`);
      }
    }
  }

  const system = [
    "You are the Competen simulation scenario designer, drafting material a qualified assessor will review and edit before use.",
    "Ground your draft in the governed competency content provided; where none is given, keep it method-generic and say so. Do not invent institution-specific policies or precise drug doses.",
    "Produce:",
    "1. Scenario overview — setting, patient profile, presenting situation (3-4 sentences).",
    "2. Initial vitals — a short list.",
    "3. Expected actions — 8-12 observable actions, [CRITICAL] tags where omission should fail the scenario, aligned to the provided criteria.",
    "4. Deterioration branch — what happens if key actions are missed or delayed (2-3 sentences).",
    "5. Debrief points — 3-5 discussion prompts tied to the expected actions.",
    "This is training material, not patient care advice.",
  ].join("\n");

  const userMsg = [
    `Scenario: ${name}`,
    ctxParts.length ? ctxParts.join("\n\n") : "(no linked competency content)",
    "Draft the simulation scenario.",
  ].join("\n\n");

  const result = await generate({ system, user: userMsg, tier: "reasoning", maxTokens: 900 });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "refusal" ? "The designer declined this request." : `Designer error: ${result.detail ?? "failed"}` }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "ai_simulation_design", entity_type: "ai", entity_id: null,
    new_value: { scenario: name.slice(0, 120), competency_id: competency_id ?? null, model: result.model, tokens: result.usage },
  });
  return NextResponse.json({ answer: result.text, model: result.model });
}
