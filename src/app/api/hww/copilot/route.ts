export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { loadMyShift } from "@/lib/hww/my-shift";
import { loadMyAssessments, OVERLOAD_THRESHOLD } from "@/lib/hww/assessments";
import { loadMyMedications } from "@/lib/hww/medications";
import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */

// HWW-AI-001 — the bedside Clinical AI Copilot: shift assistant + patient/task
// prioritisation, grounded ONLY in the caller's OWN live operational picture
// (shift, assigned patients, PEWS, acuity/workload scores, medication queue,
// tasks, alerts). ADVISORY by design: every HWW business rule says AI
// recommendations require user acknowledgement or override — it never acts,
// never documents, and clinical judgement always prevails. Self-scoped (any
// authenticated clinician, own data only). Calls log to plat_ai_requests
// (operation "hww_bedside_copilot") + audit_log.

export async function GET() {
  const s = aiStatus();
  return NextResponse.json({ configured: s.configured, provider: s.provider });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();

  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured. Add an ANTHROPIC_API_KEY to enable the copilot." }, { status: 503 });

  const { question } = await req.json().catch(() => ({}));
  const q = (typeof question === "string" && question.trim()) ? question.trim() : "Brief me on my shift: who should I see first and why, what is due or overdue, and what could I be missing?";

  // Ground ONLY in the caller's own operational picture.
  const [shift, assess, meds] = await Promise.all([
    loadMyShift(admin, user.id).catch(() => null),
    loadMyAssessments(admin, user.id).catch(() => null),
    loadMyMedications(admin, user.id).catch(() => null),
  ]);
  const ctx: string[] = [];
  if (shift?.shift) {
    const s = shift.shift;
    ctx.push(`SHIFT: ${s.shift_type} on ${s.shift_date}, ${s.unit ?? s.department ?? "unit n/a"}, status ${s.status}, duty ${s.duty_status}${s.supervisor ? `, supervisor ${s.supervisor}` : ""}.`);
  } else ctx.push("SHIFT: not currently deployed on an active shift.");
  if (shift) {
    const lines = shift.patients.map((a: any) => {
      const p = a.op_patients;
      const ews = shift.observations.filter((o: any) => o.patient_id === p.id && o.ews_score != null)
        .sort((x: any, y: any) => +new Date(y.recorded_at ?? 0) - +new Date(x.recorded_at ?? 0))[0]?.ews_score ?? null;
      const due = shift.observations.filter((o: any) => o.patient_id === p.id && ["due", "overdue"].includes(o.status)).length;
      const acuity = assess?.acuityByPatient?.get(p.id)?.[0] ?? null;
      const wl = assess?.workloadByPatient?.get(p.id)?.[0] ?? null;
      const alerts = shift.safetyAlerts.filter((x: any) => x.patient_id === p.id).length;
      const escs = shift.escalations.filter((x: any) => x.patient_id === p.id).length;
      return `${p.label} (${p.op_beds?.label ?? "no bed"}): acuity ${p.acuity_level}${acuity ? ` score ${acuity.score}/18${acuity.significant_change ? " SIGNIFICANT CHANGE" : ""}` : ""}, risk ${p.risk_level}${p.isolation_status !== "none" ? `, ${p.isolation_status} isolation` : ""}, PEWS ${ews ?? "n/a"}${wl ? `, workload ${wl.percentage}%` : ""}, obs due ${due}, alerts ${alerts}, escalations ${escs}`;
    });
    if (lines.length) ctx.push(`MY PATIENTS (${lines.length}):\n- ${lines.join("\n- ")}`);
    else ctx.push("MY PATIENTS: none assigned.");
    const t = shift.tasks.slice(0, 12).map((x: any) => `${x.priority}: ${x.description}${x.op_patients?.label ? ` (${x.op_patients.label})` : ""} ${x.due_at ? `due ${new Date(x.due_at).toISOString().slice(11, 16)}` : ""} [${x.status}]`);
    if (t.length) ctx.push(`OPEN TASKS (${shift.tasks.length}):\n- ${t.join("\n- ")}`);
  }
  if (assess?.aggregate) ctx.push(`MY CUMULATIVE WORKLOAD: ${assess.aggregate.total}% of one nurse's capacity${assess.aggregate.overloaded ? ` — OVER the ${OVERLOAD_THRESHOLD}% threshold` : ""}.`);
  if (meds && !meds.migrationMissing) {
    ctx.push(`MEDICATIONS: due now ${meds.kpis.dueNow}, overdue ${meds.kpis.overdue}, delayed ${meds.kpis.delayed}, high-risk pending ${meds.kpis.highRiskPending}, administered 24h ${meds.kpis.administered24h}${meds.timeliness.onTimePct != null ? ` (${meds.timeliness.onTimePct}% on time)` : ""}.`);
    const urgentMeds = meds.queue.slice(0, 8).map((m: any) => `${m.effective_status.toUpperCase()}: ${m.drug_name} ${m.dose_display ?? ""} ${String(m.route).toUpperCase()} for ${m.op_patients?.label ?? "?"} @ ${new Date(m.scheduled_at).toISOString().slice(11, 16)}${m.high_risk ? " HIGH-RISK" : ""}`);
    if (urgentMeds.length) ctx.push(`MEDICATION QUEUE:\n- ${urgentMeds.join("\n- ")}`);
  }

  const system = [
    "You are the Competen bedside Clinical AI Copilot for a frontline nurse (the Healthcare Worker Workspace).",
    "Answer ONLY from the operational data provided — the nurse's OWN shift, patients, scores, tasks and medication queue. Never invent patients, values or orders.",
    "You PRIORITISE and EXPLAIN: who to see first (deterioration signals — PEWS, acuity changes, overdue observations, high-risk medications — outrank routine work), what is due, what looks missed. Always give the WHY with the underlying numbers.",
    "ADVISORY BOUNDARY: you never diagnose, never prescribe, never document care, and never override clinical judgement. Every recommendation requires the nurse's own acknowledgement or override; when in doubt say 'escalate to your supervisor'.",
    "Be concise, structured and calm. If the data doesn't support an answer, say so plainly.",
  ].join("\n");

  const result = await generate({ system, user: `My live operational picture:\n${ctx.join("\n")}\n\nRequest: ${q}`, tier: "reasoning", maxTokens: 900, context: { userId: user.id, tenantId: profile?.hospital_id ?? null, operation: "hww_bedside_copilot" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The copilot declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: user.id, actor_name: profile?.full_name ?? null, action: "hww_ai_query", entity_type: "ai", entity_id: null, new_value: { question: q.slice(0, 300), model: result.model, tokens: result.usage } }).then((r: any) => r, () => {});
  return NextResponse.json({ answer: result.text, model: result.model, grounded: ctx.length, usage: result.usage });
}
