// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";

// AI Validation Assistant (Educator Validation Centre spec). The server
// computes REAL figures for one competency score — attempt history, every
// assessor's score and notes, scoring spread — and hands only those to Claude
// for an advisory review. The model is told not to invent numbers; the
// educator makes the decision. Body: { competency_score_id }

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, full_name").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit} requests/hour). Try again later.` }, { status: 429 });

  const { competency_score_id } = await req.json().catch(() => ({}));
  if (!competency_score_id) return NextResponse.json({ error: "competency_score_id required" }, { status: 400 });

  const { data: cs } = await admin
    .from("competency_scores")
    .select(`
      id, competency_id, cycle_id, nurse_id, score, label, is_passing, assessed_at,
      profiles!nurse_id(full_name),
      framework_competencies!competency_id(name, framework_domains(name, frameworks(name)))
    `)
    .eq("id", competency_score_id)
    .single();
  if (!cs) return NextResponse.json({ error: "Score not found" }, { status: 404 });

  const [{ data: assessments }, { data: history }] = await Promise.all([
    admin.from("assessments")
      .select("method, score, notes, assessed_at, profiles!assessor_id(full_name)")
      .eq("competency_id", cs.competency_id).eq("cycle_id", cs.cycle_id).order("assessed_at"),
    admin.from("competency_scores")
      .select("score, is_passing, assessed_at, educator_validated")
      .eq("nurse_id", cs.nurse_id).eq("competency_id", cs.competency_id)
      .order("assessed_at"),
  ]);

  const comp = cs.framework_competencies as unknown as { name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
  const nurse = (cs.profiles as unknown as { full_name: string } | null)?.full_name ?? "the learner";
  const scores = (assessments ?? []).map(a => a.score).filter((s): s is number => s !== null);
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : null;

  const lines: string[] = [];
  lines.push(`Competency: ${comp?.name ?? "—"} (${comp?.framework_domains?.frameworks?.name ?? "—"} > ${comp?.framework_domains?.name ?? "—"}).`);
  lines.push(`Learner: ${nurse}. Aggregated score: ${cs.score}/6 (${cs.label ?? "—"}), ${cs.is_passing ? "passing" : "NOT passing"}, assessed ${cs.assessed_at?.slice(0, 10)}.`);
  lines.push(`Attempt ${history?.length ?? 1} recorded for this learner on this competency. Prior attempts: ${(history ?? []).slice(0, -1).map(h => `${h.score}/6${h.educator_validated ? " (validated)" : ""}`).join(", ") || "none"}.`);
  lines.push(`Individual assessments this cycle: ${(assessments ?? []).length}.`);
  for (const a of assessments ?? []) {
    const nm = (a.profiles as unknown as { full_name: string } | null)?.full_name ?? "Assessor";
    lines.push(`- ${nm}: ${a.score ?? "?"}/6 via ${a.method}${a.notes ? ` — notes: "${a.notes.slice(0, 200)}"` : " — no notes"}`);
  }
  lines.push(`Assessor scoring spread (max − min): ${spread === null ? "n/a (single assessor)" : spread}.`);
  lines.push(`Evidence attachments are not linked to this record in the current data model — do not comment on evidence files.`);

  const system = [
    "You are the Competen AI Validation Assistant advising a nurse educator who must validate a competency score.",
    "Use ONLY the figures provided — never invent numbers, evidence, names or events. If data is thin, say so plainly.",
    "Respond in exactly three short sections:",
    "REVIEW: 2-4 sentences on what the record shows (score vs pass line, attempt history, assessor agreement).",
    "FLAGS: bullet list of specific concerns (scoring spread, failed prior attempts, missing assessor notes), or 'None noted.'",
    "SUGGESTION: one line — 'Approve', 'Approve with conditions', or 'Return for revision' — plus a one-sentence rationale.",
    "Your suggestion is advisory; the educator decides. British clinical English, no hype.",
  ].join("\n");

  const result = await generate({
    system,
    user: `Record for validation review:\n${lines.join("\n")}\n\nWrite the advisory review.`,
    tier: "reasoning",
    maxTokens: 500,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "refusal" ? "The assistant declined this request." : `Assistant error: ${result.detail ?? "failed"}` }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "ai_validation_review", entity_type: "competency_score", entity_id: cs.id,
    new_value: { model: result.model, tokens: result.usage },
  });
  return NextResponse.json({ answer: result.text, model: result.model, spread });
}
