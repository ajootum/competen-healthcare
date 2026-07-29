// COMP-018 Competency Assignment & Distribution Engine — the RULES loader. A rule pairs a POPULATION (a role,
// matched against profiles.role / roles[]) with a competency and a cadence; applying it materialises ONE
// target-based cmo_assignments row (method='rule'). This loader reads the rules, resolves each rule's live
// population from staff, and counts how many rule-method assignments each has generated. Real over
// cmo_assignment_rules (mig 125) + profiles + cmo_assignments (mig 114). No fabricated data.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export async function loadAssignmentRules(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const rulesRes = await scope(
    admin.from("cmo_assignment_rules")
      .select("id, hospital_id, name, target_role, target_label, competency_id, competency_name, priority, due_days, recurrence_months, trigger, is_active, created_by_name, created_at")
      .order("created_at", { ascending: false }).limit(2000)
  );
  if (rulesRes.error) return { provisioned: false as const };
  const ruleRows = (rulesRes.data ?? []) as any[];

  // Resolve any missing competency names by id (competency_name is denormalised on write, so this is a fallback).
  const needIds = [...new Set(ruleRows.filter(r => !r.competency_name && r.competency_id).map(r => r.competency_id))] as string[];
  const nameById = new Map<string, string>();
  if (needIds.length) { const { data } = await admin.from("framework_competencies").select("id, name").in("id", needIds.slice(0, 1000)); ((data ?? []) as any[]).forEach(c => nameById.set(c.id, c.name)); }
  const compName = (r: any) => r.competency_name ?? nameById.get(r.competency_id) ?? "—";
  const effLabel = (r: any) => r.target_label ?? r.target_role ?? "All staff";

  // Fetch in-scope staff ONCE (id, role, roles) and resolve each distinct target_role's population in JS.
  const profRes = await scope(admin.from("profiles").select("id, role, roles").limit(8000));
  const profs = (profRes.data ?? []) as any[];
  const allIds = profs.map(p => p.id as string);
  const matches = (p: any, role: string) => p.role === role || (Array.isArray(p.roles) && p.roles.includes(role));
  const distinctRoles = [...new Set(ruleRows.map(r => r.target_role).filter(Boolean))] as string[];
  const roleIds = new Map<string, string[]>();
  for (const role of distinctRoles) roleIds.set(role, profs.filter(p => matches(p, role)).map(p => p.id as string));
  const popIds = (role: string | null): string[] => (role ? (roleIds.get(role) ?? []) : allIds);

  // Fetch rule-method assignments ONCE and match per rule (competency + effective population label).
  const asgRes = await scope(admin.from("cmo_assignments").select("id, competency, target_label, status").eq("method", "rule").limit(20000));
  const ruleAsg = (asgRes.data ?? []) as any[];
  const generatedFor = (r: any) => ruleAsg.filter(a => a.competency === compName(r) && a.target_label === effLabel(r)).length;

  const rules = ruleRows.map(r => ({
    id: r.id,
    name: r.name,
    competency: compName(r),
    targetRole: r.target_role as string | null,
    targetLabel: effLabel(r),
    priority: r.priority,
    dueDays: r.due_days,
    recurrence: r.recurrence_months as number | null,
    trigger: r.trigger as string | null,
    population: popIds(r.target_role).length,
    generated: generatedFor(r),
    active: !!r.is_active,
  }));

  // Staff covered = distinct staff across every ACTIVE rule's population.
  const covered = new Set<string>();
  for (const r of ruleRows) { if (r.is_active) for (const id of popIds(r.target_role)) covered.add(id); }

  const kpis = {
    rules: ruleRows.length,
    active: ruleRows.filter(r => r.is_active).length,
    roles: distinctRoles.length,
    generated: ruleAsg.length,
    staffCovered: covered.size,
    neverApplied: rules.filter(r => r.generated === 0).length,
  };

  const rolesList = [...new Set(profs.flatMap(p => (Array.isArray(p.roles) && p.roles.length ? p.roles : [p.role]).filter(Boolean)))].sort() as string[];

  return { provisioned: true as const, empty: ruleRows.length === 0, kpis, rules, roles: rolesList };
}
