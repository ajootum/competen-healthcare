// Pro plan: allow up to 60s for AI generation (Hobby capped at 10s)
export const maxDuration = 60;

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// AI Report Writer — generates a professional narrative report from REAL
// figures the server computes for the chosen window/department. The model is
// instructed to use only the provided figures. Export via print-to-PDF.
// Body: { report_type, department?, from?, to? }

const REPORT_TYPES: Record<string, string> = {
  assessment_summary: "Assessment Summary Report",
  department: "Department Performance Report",
  learner_progress: "Learner Progress Overview",
  executive: "Executive Summary",
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const hospitalId = me?.hospital_id ?? null;
  if (!hospitalId) return NextResponse.json({ error: "No facility assigned" }, { status: 400 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  const quota = await checkAiQuota(admin, user.id);
  if (!quota.ok) return NextResponse.json({ error: "AI rate limit reached (" + quota.limit + " requests/hour). Try again later." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const reportType = REPORT_TYPES[body.report_type] ? body.report_type as string : null;
  if (!reportType) return NextResponse.json({ error: `report_type must be one of: ${Object.keys(REPORT_TYPES).join(", ")}` }, { status: 400 });
  const department = typeof body.department === "string" && body.department ? body.department : null;
  const from = typeof body.from === "string" && body.from ? `${body.from}T00:00:00Z` : new Date(Date.now() - 30 * 86400000).toISOString();
  const to = typeof body.to === "string" && body.to ? `${body.to}T23:59:59Z` : new Date().toISOString();

  // ── Real figures for the window ─────────────────────────────────────────────
  const [{ data: nurses }, { data: assessRaw }, { data: entriesRaw }] = await Promise.all([
    admin.from("profiles").select("id, full_name, specialization").eq("hospital_id", hospitalId).eq("role", "nurse"),
    admin.from("assessments")
      .select("score, method, assessed_at, competency_cycles!cycle_id(hospital_id, nurse_id), framework_competencies!competency_id(name)")
      .eq("status", "complete").not("score", "is", null).gte("assessed_at", from).lte("assessed_at", to).limit(3000),
    admin.from("skill_log_entries")
      .select("status, created_at, profiles!nurse_id(hospital_id, specialization)")
      .gte("created_at", from).lte("created_at", to).limit(2000),
  ]);
  const deptOf = new Map((nurses ?? []).map(n => [n.id, n.specialization ?? "General"]));
  const inDept = (nurseId: string) => !department || deptOf.get(nurseId) === department;
  const assess = (assessRaw ?? []).filter(a => {
    const c = a.competency_cycles as unknown as { hospital_id: string | null; nurse_id: string } | null;
    return !!c && c.hospital_id === hospitalId && inDept(c.nurse_id);
  });
  const entries = (entriesRaw ?? []).filter(e => {
    const p = e.profiles as unknown as { hospital_id: string | null; specialization: string | null } | null;
    return p?.hospital_id === hospitalId && (!department || (p?.specialization ?? "General") === department);
  });
  const scores = assess.map(a => a.score as number);
  const pass = scores.length ? Math.round(scores.filter(s => s >= 3).length / scores.length * 100) : null;
  const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 10) / 10 : null;

  const perComp = new Map<string, { pass: number; n: number }>();
  for (const a of assess) {
    const name = (a.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    const v = perComp.get(name) ?? { pass: 0, n: 0 };
    v.n++; if ((a.score as number) >= 3) v.pass++;
    perComp.set(name, v);
  }
  const compLines = [...perComp.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)
    .map(([n, v]) => `${n}: ${Math.round(v.pass / v.n * 100)}% pass of ${v.n}`);

  const perDept = new Map<string, { pass: number; n: number }>();
  for (const a of assess) {
    const c = a.competency_cycles as unknown as { nurse_id: string };
    const dep = deptOf.get(c.nurse_id) ?? "General";
    const v = perDept.get(dep) ?? { pass: 0, n: 0 };
    v.n++; if ((a.score as number) >= 3) v.pass++;
    perDept.set(dep, v);
  }
  const deptLines = [...perDept.entries()].map(([d, v]) => `${d}: ${v.n} assessments, ${Math.round(v.pass / v.n * 100)}% pass`);

  // Current-state decisions (not window-bound)
  const nurseIds = (nurses ?? []).filter(n => !department || (n.specialization ?? "General") === department).map(n => n.id);
  const { data: decisions } = nurseIds.length
    ? await admin.from("competency_decisions").select("nurse_id, competency_id, outcome, validation_outcome, expiry_date, created_at")
        .in("nurse_id", nurseIds).order("created_at", { ascending: false }).limit(4000)
    : { data: [] };
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  let latestTotal = 0, compliant = 0, expired = 0;
  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latestTotal++;
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const isExpired = passing && d.expiry_date && d.expiry_date < today;
    if (isExpired) expired++;
    if (passing && d.validation_outcome === "validated" && !isExpired) compliant++;
  }

  const figures = [
    `Facility scope: ${department ?? "all departments"}. Window: ${from.slice(0, 10)} to ${to.slice(0, 10)}.`,
    `Learners in scope: ${nurseIds.length}. Assessments completed: ${assess.length} (pass rate ${pass ?? "n/a"}%, average score ${avg ?? "n/a"} on the 0–6 Benner scale).`,
    `Evidence submitted in window: ${entries.length} (verified ${entries.filter(e => e.status === "verified").length}, rejected ${entries.filter(e => e.status === "rejected").length}, pending ${entries.filter(e => e.status === "pending").length}).`,
    `Current competency state: ${latestTotal} latest decisions, ${latestTotal ? Math.round(compliant / latestTotal * 100) : "n/a"}% validated-and-current, ${expired} expired.`,
    compLines.length ? `Per-competency (window): ${compLines.join("; ")}.` : "No per-competency data in the window.",
    deptLines.length ? `Per-department (window): ${deptLines.join("; ")}.` : "",
  ].filter(Boolean);

  const system = [
    `You are the Competen report writer producing a "${REPORT_TYPES[reportType]}" for hospital governance readers.`,
    "Use ONLY the figures provided — never invent numbers, names, incidents or causes. Where data is missing, state that plainly.",
    "Structure with markdown headings: Title, Executive Summary (3-4 sentences), Key Findings (bulleted, each tied to a figure), Areas of Concern, Recommendations (3-5, actionable), and a one-line data-provenance note stating the window and that figures are live platform data.",
    "Professional British clinical-governance tone. Concise — this is a working document, not marketing.",
  ].join("\n");

  const result = await generate({ system, user: `Figures:\n${figures.join("\n")}\n\nWrite the report.`, tier: "reasoning", maxTokens: 1200 });
  if (!result.ok) {
    return NextResponse.json({ error: result.error === "refusal" ? "The report writer declined this request." : `Report error: ${result.detail ?? "failed"}` }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "ai_report", entity_type: "ai", entity_id: null,
    new_value: { report_type: reportType, department, from: from.slice(0, 10), to: to.slice(0, 10), model: result.model, tokens: result.usage },
  });
  return NextResponse.json({ answer: result.text, model: result.model, title: REPORT_TYPES[reportType] });
}
