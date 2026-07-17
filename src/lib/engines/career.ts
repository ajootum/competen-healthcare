import { OUTCOME_CONFIG, type DecisionOutcome, type Maturity } from "@/lib/ckcm";

// Career progression ladder and the transparent readiness formula shared by
// the Career Growth page and the dashboard's career widget.

export const LADDER = [
  { role: "Healthcare Worker", icon: "🩺" },
  { role: "Preceptor / Mentor", icon: "🧭" },
  { role: "Shift Supervisor", icon: "🕐" },
  { role: "Unit Manager", icon: "🏢" },
  { role: "Hospital Nurse Manager", icon: "🏥" },
];

export type LatestDecision = {
  outcome: DecisionOutcome;
  maturity: Maturity | null;
  expired: boolean;
  validated: boolean;
};

export type ReadinessPart = { label: string; detail: string; weight: number; value: number };

export function latestPerCompetency(
  decisions: { competency_id: string; outcome: string; maturity?: string | null; expiry_date?: string | null; validation_outcome?: string | null }[],
): LatestDecision[] {
  const seen = new Set<string>();
  const latest: LatestDecision[] = [];
  for (const d of decisions) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    latest.push({
      outcome: d.outcome as DecisionOutcome,
      maturity: (d.maturity as Maturity) ?? null,
      expired: !!d.expiry_date && new Date(d.expiry_date).getTime() < Date.now(),
      validated: d.validation_outcome === "validated",
    });
  }
  return latest;
}

export function computeReadiness(
  latest: LatestDecision[],
  credentials: { verified: boolean | null; status: string | null; expiry_date: string | null }[],
  recognitions: { recognition_type: string }[],
): { readiness: number; parts: ReadinessPart[]; nextRole: string } {
  const total = latest.length;
  const competent = latest.filter(l => OUTCOME_CONFIG[l.outcome]?.passing && !l.expired).length;
  const validated = latest.filter(l => l.validated).length;
  const advanced = latest.filter(l => l.maturity === "proficient" || l.maturity === "expert").length;
  const credsCurrent = credentials.length > 0 && credentials.every(c =>
    c.verified && c.status === "active" && (!c.expiry_date || new Date(c.expiry_date).getTime() > Date.now()));
  const isPreceptor = recognitions.some(r => ["preceptor", "mentor"].includes(r.recognition_type));

  const parts: ReadinessPart[] = [
    { label: "Competency coverage", detail: `${competent}/${total || "—"} competencies current & competent`, weight: 40, value: total ? competent / total : 0 },
    { label: "Educator validation", detail: `${validated}/${total || "—"} decisions validated`, weight: 20, value: total ? validated / total : 0 },
    { label: "Advanced practice", detail: `${advanced} at Proficient/Expert maturity`, weight: 15, value: total ? Math.min(advanced / Math.max(total * 0.3, 1), 1) : 0 },
    { label: "Credentials current", detail: credentials.length ? (credsCurrent ? "All verified & current" : "Verification or renewal needed") : "No credentials on record", weight: 15, value: credsCurrent ? 1 : 0 },
    { label: "Recognition & mentorship", detail: recognitions.length ? `${recognitions.length} recognition${recognitions.length !== 1 ? "s" : ""}${isPreceptor ? " incl. preceptor/mentor" : ""}` : "None yet", weight: 10, value: isPreceptor ? 1 : recognitions.length ? 0.6 : 0 },
  ];
  const readiness = Math.round(parts.reduce((s, p) => s + p.weight * p.value, 0));
  return { readiness, parts, nextRole: LADDER[1].role };
}
