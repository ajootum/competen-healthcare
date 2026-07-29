/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-006 — Simulation Studio. Loads the persistent scenario store (simulation_scenarios, migration 131):
// named, typed, competency-linked, versioned scenarios with a publish lifecycle. KPIs, type/difficulty
// distribution and the scenario list. The visual branching flow-builder (nodes/decisions/outcomes) is
// the next-phase layer on top of this store; delivery/AI-drafting live in the existing simulation runtime.

const NONE = "00000000-0000-0000-0000-000000000000";

export const SCENARIO_TYPES = [
  { key: "mock_code", label: "Mock Code" }, { key: "emergency", label: "Emergency Response" }, { key: "virtual_patient", label: "Virtual Patient" },
  { key: "skills", label: "Clinical Skills" }, { key: "team", label: "Team Simulation" }, { key: "procedure", label: "Procedure" },
  { key: "communication", label: "Communication" }, { key: "disaster", label: "Disaster" }, { key: "orientation", label: "Orientation" },
  { key: "reassessment", label: "Reassessment" }, { key: "clinical", label: "Clinical" },
];
export const SCENARIO_TYPE_LABEL: Record<string, string> = Object.fromEntries(SCENARIO_TYPES.map(t => [t.key, t.label]));
export const DIFFICULTY = [
  { key: "beginner", label: "Beginner", color: "#10b981" }, { key: "intermediate", label: "Intermediate", color: "#f59e0b" }, { key: "advanced", label: "Advanced", color: "#ef4444" },
];
export const DIFF_LABEL: Record<string, string> = Object.fromEntries(DIFFICULTY.map(d => [d.key, d.label]));
export const DIFF_COLOR: Record<string, string> = Object.fromEntries(DIFFICULTY.map(d => [d.key, d.color]));
export const SIM_STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", published: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export type Scenario = { id: string; name: string; description: string | null; scenario_type: string; competency_name: string | null; difficulty: string; participants: number | null; duration_min: number | null; status: string; version: string; created_by_name: string | null };

export async function loadSimulations(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("simulation_scenarios").select("id, name, description, scenario_type, competency_name, difficulty, participants, duration_min, status, version, created_by_name").order("created_at", { ascending: false }).limit(2000));
  if (res.error) return { provisioned: false as const };
  const scenarios = (res.data ?? []) as Scenario[];

  const count = (s: string) => scenarios.filter(x => x.status === s).length;
  const typeDist = SCENARIO_TYPES.map(t => ({ key: t.key, label: t.label, n: scenarios.filter(s => s.scenario_type === t.key).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const diffDist = DIFFICULTY.map(d => ({ key: d.key, label: d.label, color: d.color, n: scenarios.filter(s => s.difficulty === d.key).length })).filter(x => x.n > 0);

  return {
    provisioned: true as const,
    empty: scenarios.length === 0,
    kpis: {
      total: scenarios.length,
      published: count("published"),
      draft: count("draft"),
      competencyLinked: scenarios.filter(s => s.competency_name).length,
      types: typeDist.length,
    },
    typeDist, diffDist, scenarios,
  };
}
