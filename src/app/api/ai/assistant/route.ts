// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";

// GET — report AI readiness (so the UI can show config state without a call)
export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured, provider: s.provider });
}

// POST — grounded natural-language question over the CKCM content.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "educator"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) {
    return NextResponse.json({ error: "AI rate limit reached (" + quota.limit + " requests/hour). Try again later." }, { status: 429 });
  }

  if (!aiStatus().configured) {
    return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the assistant." }, { status: 503 });
  }

  const { question } = await req.json();
  if (!question || typeof question !== "string") return NextResponse.json({ error: "question required" }, { status: 400 });

  // ── Retrieve grounding context from the CKCM ────────────────
  // Preferred: Postgres full-text search (migration 018). Falls back to
  // keyword ilike matching if the search_ckcm function isn't installed yet.
  const ctxParts: string[] = [];
  const TYPE_LABEL: Record<string, string> = {
    framework: "Framework", cpu: "CPU", competency: "Competency",
    skill: "Skill", resource: "Resource", policy: "Policy",
  };

  const { data: ftsData, error: ftsError } = await admin
    .rpc("search_ckcm", { q: question, max_results: 24 });
  const ftsHits = (ftsData ?? null) as
    | { object_type: string; object_id: string; title: string; snippet: string; rank: number }[]
    | null;

  if (!ftsError && ftsHits) {
    for (const h of ftsHits) {
      ctxParts.push(`[${TYPE_LABEL[h.object_type] ?? h.object_type}: ${h.title}]${h.snippet ? ` ${h.snippet.slice(0, 300)}` : ""}`);
    }
  } else {
    // Fallback: keyword search over the main tables
    const terms = question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3).slice(0, 6);
    const pattern = terms.length ? terms.map(t => `%${t}%`).join("|") : `%${question.slice(0, 40)}%`;

    const [{ data: comps }, { data: frameworks }, { data: cpus }, { data: policies }] = await Promise.all([
      admin.from("framework_competencies")
        .select("id, name, description, risk_category, framework_domains(name, frameworks(name))")
        .or(terms.map(t => `name.ilike.%${t}%`).join(",") || `name.ilike.${pattern}`)
        .limit(12),
      admin.from("frameworks").select("id, name, library, description").eq("is_active", true)
        .or(terms.map(t => `name.ilike.%${t}%`).join(",") || `name.ilike.${pattern}`)
        .limit(6),
      admin.from("clinical_practice_units").select("id, name, description, risk_category, complexity")
        .or(terms.map(t => `name.ilike.%${t}%`).join(",") || `name.ilike.${pattern}`)
        .limit(8),
      admin.from("policies").select("id, title, content").limit(4),
    ]);

    for (const f of frameworks ?? []) {
      ctxParts.push(`[Framework: ${f.name}] library=${f.library}${f.description ? ` — ${f.description}` : ""}`);
    }
    for (const c of cpus ?? []) {
      ctxParts.push(`[CPU: ${c.name}] risk=${c.risk_category} complexity=L${c.complexity}${c.description ? ` — ${c.description}` : ""}`);
    }
    for (const c of comps ?? []) {
      const d = c.framework_domains as unknown as { name: string; frameworks: { name: string } | null } | null;
      ctxParts.push(`[Competency: ${c.name}] framework=${d?.frameworks?.name ?? "—"} domain=${d?.name ?? "—"} risk=${c.risk_category ?? "standard"}${c.description ? ` — ${c.description}` : ""}`);
    }
    for (const p of policies ?? []) {
      ctxParts.push(`[Policy: ${p.title}] ${(p.content ?? "").slice(0, 300)}`);
    }
  }

  const context = ctxParts.length ? ctxParts.join("\n") : "(no matching CKCM content found)";

  const system = [
    "You are the Competen Clinical Intelligence assistant for a healthcare competency platform.",
    "Answer ONLY from the governed CKCM context provided in the user message. This is a clinical governance tool — accuracy and traceability are mandatory (Book IV Ch.10: explainable, transparent AI).",
    "Rules:",
    "- Ground every claim in the provided context. Cite the object you used in square brackets, e.g. [Competency: Safe Oxygen Administration].",
    "- If the context does not contain the answer, say so plainly and suggest what the user could search or build. Do NOT invent competencies, frameworks, policies, scores, or clinical facts.",
    "- Never give individualised clinical or medical advice. You describe and navigate the competency framework; you do not make competency decisions (those require human assessors).",
    "- Be concise and structured.",
  ].join("\n");

  const userMsg = `CKCM context:\n${context}\n\nQuestion: ${question}`;

  const result = await generate({ system, user: userMsg, tier: "reasoning", maxTokens: 1200 });

  if (!result.ok) {
    const msg = result.error === "not_configured"
      ? "AI is not configured."
      : result.error === "refusal"
        ? "The assistant declined to answer that request."
        : `Assistant error: ${result.detail ?? "failed"}`;
    return NextResponse.json({ error: msg }, { status: result.error === "not_configured" ? 503 : 500 });
  }

  // Audit every AI answer (explainability + governance)
  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: profile?.full_name ?? null,
    action: "ai_assistant_query", entity_type: "ai", entity_id: null,
    new_value: { question: question.slice(0, 300), model: result.model, tokens: result.usage },
  });

  return NextResponse.json({
    answer: result.text,
    model: result.model,
    sources: ctxParts.length,
    usage: result.usage,
  });
}
