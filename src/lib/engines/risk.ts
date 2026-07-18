import { createAdminClient } from "@/lib/supabase/server";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

type Admin = ReturnType<typeof createAdminClient>;

// Risk flags derived entirely from real competency decisions: critical
// failures, non-passing latest outcomes and expired competencies. No
// prediction, no invented severity — just what the records say.
export type RiskFlag = {
  type: "critical_failure" | "not_competent" | "expired";
  competency: string;
  date: string | null;
};
export type NurseRisk = { nurseId: string; nurseName: string; flags: RiskFlag[] };

export async function computeRiskFlags(admin: Admin, hospitalId: string): Promise<NurseRisk[]> {
  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name").eq("hospital_id", hospitalId).eq("role", "nurse").limit(200);
  if (!nurses?.length) return [];
  const nameById = new Map(nurses.map(n => [n.id, n.full_name as string]));

  const { data: decisions } = await admin.from("competency_decisions")
    .select("nurse_id, competency_id, outcome, critical_failure, expiry_date, created_at, framework_competencies(name)")
    .in("nurse_id", nurses.map(n => n.id))
    .order("created_at", { ascending: false });

  // Latest decision per nurse+competency only — superseded decisions don't flag.
  const seen = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  const byNurse = new Map<string, RiskFlag[]>();

  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const compName = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const flags: RiskFlag[] = [];
    if (d.critical_failure) flags.push({ type: "critical_failure", competency: compName, date: d.created_at?.slice(0, 10) ?? null });
    if (!passing) flags.push({ type: "not_competent", competency: compName, date: d.created_at?.slice(0, 10) ?? null });
    if (passing && d.expiry_date && d.expiry_date < today) flags.push({ type: "expired", competency: compName, date: d.expiry_date });

    if (flags.length) {
      const list = byNurse.get(d.nurse_id) ?? [];
      list.push(...flags);
      byNurse.set(d.nurse_id, list);
    }
  }

  return [...byNurse.entries()]
    .map(([nurseId, flags]) => ({ nurseId, nurseName: nameById.get(nurseId) ?? "—", flags }))
    .sort((a, b) => b.flags.length - a.flags.length);
}
