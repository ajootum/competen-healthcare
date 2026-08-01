/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-005 — Clinical Simulation & Practice delivery. Captures a deliberate-practice session against a scenario
// with a structured debrief + self-rating, so simulation becomes measurable delivery. A "needs_practice"
// outcome seeds a reinforcement card for the linked competency. Real over cdp_sim_sessions (147) +
// simulation_scenarios (131) + framework_competencies + profiles. No fabricated data.

import { emitDomainEvent, EVENT } from "@/lib/orchestration/events";

import { currentTraceId } from "@/lib/trace";
type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);

export async function recordPractice(admin: Admin, nurseId: string, input: { scenario_id?: string | null; outcome?: string; self_rating?: number | null; duration_min?: number | null; went_well?: string | null; to_improve?: string | null; action_plan?: string | null }) {
  let scenarioName: string | null = null, scenarioType: string | null = null, competencyId: string | null = null, competencyName: string | null = null;
  if (input.scenario_id) {
    const { data: sc } = await admin.from("simulation_scenarios").select("name, scenario_type, competency_id, competency_name").eq("id", input.scenario_id).maybeSingle();
    if (sc) { scenarioName = sc.name; scenarioType = sc.scenario_type; competencyId = sc.competency_id; competencyName = sc.competency_name; }
  }
  const { data: prof } = await admin.from("profiles").select("hospital_id").eq("id", nurseId).maybeSingle();
  const outcome = input.outcome === "needs_practice" ? "needs_practice" : "completed";

  const { data: row, error } = await admin.from("cdp_sim_sessions").insert({
    hospital_id: prof?.hospital_id ?? null, nurse_id: nurseId, scenario_id: input.scenario_id ?? null,
    scenario_name: scenarioName, scenario_type: scenarioType, competency_id: competencyId, competency_name: competencyName,
    outcome, self_rating: input.self_rating ?? null, duration_min: input.duration_min ?? null,
    went_well: input.went_well ?? null, to_improve: input.to_improve ?? null, action_plan: input.action_plan ?? null,
  }).select("id").single();
  if (error) return { ok: false as const, error: error.message };

  await emitDomainEvent(admin, { event_type: EVENT.SIMULATION_COMPLETED, subject_type: "cdp_sim_session", subject_id: row.id, hospital_id: prof?.hospital_id ?? null, actor_id: nurseId, payload: { scenario: scenarioName, type: scenarioType, outcome, competency_id: competencyId } });

  // A run that needs more practice seeds a reinforcement card for the competency (idempotent).
  if (outcome === "needs_practice" && competencyId) {
    await admin.from("cdp_reinforcement_cards").upsert(
      { hospital_id: prof?.hospital_id ?? null, nurse_id: nurseId, competency_id: competencyId, subject: competencyName ?? "Competency", prompt: `Simulation follow-up — recall the key steps and safety checks for "${competencyName ?? "this scenario"}".`, source: "simulation", next_review_at: today() },
      { onConflict: "nurse_id,competency_id", ignoreDuplicates: true },
    ).catch(() => {});
  }
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: nurseId, action: "sim_practice_logged", entity_type: "cdp_sim_sessions", entity_id: row.id, entity_name: scenarioName ?? "practice" });
  return { ok: true as const, id: row.id };
}

export async function learnerPractice(admin: Admin, nurseId: string) {
  const { data, error } = await admin.from("cdp_sim_sessions").select("id, scenario_name, scenario_type, outcome, self_rating, created_at").eq("nurse_id", nurseId).order("created_at", { ascending: false }).limit(50);
  if (error) return { provisioned: false as const };
  const rows = (data ?? []) as any[];
  return { provisioned: true as const, sessions: rows, stats: { total: rows.length, needsPractice: rows.filter(r => r.outcome === "needs_practice").length } };
}

export async function loadSimDelivery(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const totalRes = await scope(admin.from("cdp_sim_sessions").select("id", { count: "exact", head: true }));
  if (totalRes.error) return { provisioned: false as const };
  const [rowsRes, recentRes] = await Promise.all([
    scope(admin.from("cdp_sim_sessions").select("nurse_id, scenario_type, outcome").limit(20000)),
    scope(admin.from("cdp_sim_sessions").select("scenario_name, scenario_type, outcome, self_rating, created_at").order("created_at", { ascending: false }).limit(15)),
  ]);
  const rows = (rowsRes.data ?? []) as any[];
  const byType = new Map<string, { type: string; sessions: number; needs: number }>();
  for (const r of rows) {
    const t = r.scenario_type ?? "other";
    const s = byType.get(t) ?? { type: t, sessions: 0, needs: 0 };
    s.sessions++; if (r.outcome === "needs_practice") s.needs++;
    byType.set(t, s);
  }
  return {
    provisioned: true as const,
    kpis: { sessions: totalRes.count ?? 0, learners: new Set(rows.map(r => r.nurse_id)).size, needsPractice: rows.filter(r => r.outcome === "needs_practice").length },
    types: [...byType.values()].sort((a, b) => b.sessions - a.sessions),
    recent: (recentRes.data ?? []) as any[],
  };
}
