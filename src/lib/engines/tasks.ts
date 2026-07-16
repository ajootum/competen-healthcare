import { createAdminClient } from "@/lib/supabase/server";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

type Admin = ReturnType<typeof createAdminClient>;

// ============================================================
// "The Assessor Role" spec — readiness + task-generation engine.
// Converts the content library into a small, prioritized set of
// assessment decisions. No task is stored; the queue is computed
// live from role requirements, decisions, evidence and blueprints.
// ============================================================

export type TaskType = "full_cpu" | "focused" | "renewal" | "remediation" | "entrustment";
export type AssessorTask = {
  nurseId: string;
  nurseName: string;
  department: string | null;
  cpuId: string;
  cpuName: string;
  cpuCode: string | null;
  riskCategory: string;
  type: TaskType;
  priority: number;          // 1 = most urgent (spec §11 queue order)
  reason: string;
  readiness: number;         // % of CPU competencies currently competent
  estMinutes: number;        // spec §15 effort model
  decisionRequired: string;
  // Level-2 progressive disclosure
  evidence: { complete: number; gaps: string[]; expiring: string[]; expired: string[] };
  criticalItems: string[];
  methods: string[];
};

export type AssessorQueue = {
  tasks: AssessorTask[];
  workload: { tasks: number; estMinutes: number; learners: number; urgent: number };
};

const EST: Record<TaskType, number> = { full_cpu: 40, focused: 15, renewal: 15, remediation: 20, entrustment: 10 };

// When assessorId is given and that assessor holds any active authorizations
// (migration 023), the queue is filtered to their authorized CPUs — the spec's
// scope matching. Assessors with no authorization rows see the full hospital
// queue (backward-compatible default until scopes are assigned).
export async function generateAssessorQueue(admin: Admin, hospitalId: string, assessorId?: string): Promise<AssessorQueue> {
  let authorizedCpus: Set<string> | null = null; // null = unrestricted
  if (assessorId) {
    const { data: auths, error } = await admin
      .from("assessor_authorizations")
      .select("cpu_id, hospital_id, valid_until")
      .eq("user_id", assessorId)
      .eq("status", "active");
    if (!error && auths && auths.length > 0) {
      const now = Date.now();
      const valid = auths.filter(a =>
        (!a.valid_until || new Date(a.valid_until).getTime() >= now) &&
        (!a.hospital_id || a.hospital_id === hospitalId));
      if (valid.some(a => !a.cpu_id)) {
        authorizedCpus = null; // blanket authorization for this scope
      } else {
        authorizedCpus = new Set(valid.map(a => a.cpu_id as string));
      }
    }
  }
  return buildQueue(admin, hospitalId, authorizedCpus);
}

async function buildQueue(admin: Admin, hospitalId: string, authorizedCpus: Set<string> | null): Promise<AssessorQueue> {
  const [{ data: nurses }, { data: reqs }, { data: cpus }, { data: comps },
         { data: decisions }, { data: auths }, { data: cfr }, { data: blueprints }, { data: depts }] =
    await Promise.all([
      admin.from("profiles").select("id, full_name, department_id").eq("hospital_id", hospitalId).eq("role", "nurse"),
      admin.from("role_requirements").select("cpu_id, requirement_type, hospital_id, department_id")
        .eq("is_active", true).or(`hospital_id.is.null,hospital_id.eq.${hospitalId}`),
      admin.from("clinical_practice_units").select("id, name, code, risk_category").eq("pub_status", "published"),
      admin.from("framework_competencies").select("id, name, cpu_id").not("cpu_id", "is", null),
      admin.from("competency_decisions")
        .select("nurse_id, competency_id, cpu_id, outcome, expiry_date, critical_failure, created_at, profiles!nurse_id!inner(hospital_id)")
        .eq("profiles.hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(5000),
      admin.from("clinical_authorizations").select("nurse_id, status, based_on_decision, scope, entrustment_level, authorization_activities(cpu_id)")
        .in("status", ["active", "suspended"]),
      admin.from("critical_failure_rules").select("cpu_id, description"),
      admin.from("assessment_blueprints").select("cpu_id, min_assessors, blueprint_methods(method)"),
      admin.from("departments").select("id, name").eq("hospital_id", hospitalId),
    ]);

  const deptName = new Map((depts ?? []).map(d => [d.id, d.name]));
  const cpuById = new Map((cpus ?? []).map(c => [c.id, c]));
  const compsByCpu = new Map<string, { id: string; name: string }[]>();
  for (const c of comps ?? []) {
    if (!c.cpu_id || !cpuById.has(c.cpu_id)) continue;
    if (!compsByCpu.has(c.cpu_id)) compsByCpu.set(c.cpu_id, []);
    compsByCpu.get(c.cpu_id)!.push({ id: c.id, name: c.name });
  }
  const critByCpu = new Map<string, string[]>();
  for (const r of cfr ?? []) {
    if (!critByCpu.has(r.cpu_id)) critByCpu.set(r.cpu_id, []);
    critByCpu.get(r.cpu_id)!.push(r.description);
  }
  const methodsByCpu = new Map<string, string[]>();
  for (const b of blueprints ?? []) {
    methodsByCpu.set(b.cpu_id, ((b.blueprint_methods ?? []) as { method: string }[]).map(m => m.method));
  }

  // Latest decision per nurse+competency
  const latest = new Map<string, { outcome: DecisionOutcome; expiry: string | null; critical: boolean }>();
  for (const d of decisions ?? []) {
    const k = `${d.nurse_id}:${d.competency_id}`;
    if (!latest.has(k)) latest.set(k, { outcome: d.outcome as DecisionOutcome, expiry: d.expiry_date, critical: !!d.critical_failure });
  }

  // Entrusted CPUs per nurse (via authorization activities)
  const entrusted = new Set<string>();
  for (const a of auths ?? []) {
    for (const act of (a.authorization_activities ?? []) as { cpu_id: string | null }[]) {
      if (act.cpu_id) entrusted.add(`${a.nurse_id}:${act.cpu_id}`);
    }
  }

  // Required CPUs (matrix): applies when hospital matches (or null) — department
  // filter applied per nurse below.
  const requirements = (reqs ?? []).filter(r => cpuById.has(r.cpu_id));

  const now = Date.now();
  const tasks: AssessorTask[] = [];

  for (const nurse of nurses ?? []) {
    const applicable = requirements.filter(r => !r.department_id || r.department_id === nurse.department_id);
    const cpuIds = [...new Set(applicable.map(r => r.cpu_id))]
      .filter(id => !authorizedCpus || authorizedCpus.has(id));

    for (const cpuId of cpuIds) {
      const cpu = cpuById.get(cpuId)!;
      const cpuComps = compsByCpu.get(cpuId) ?? [];
      if (!cpuComps.length) continue;
      const reqType = applicable.find(r => r.cpu_id === cpuId)?.requirement_type ?? "mandatory";

      let passing = 0, hasCritical = false;
      const gaps: string[] = [], expiring: string[] = [], expired: string[] = [];
      let decided = 0;
      for (const c of cpuComps) {
        const d = latest.get(`${nurse.id}:${c.id}`);
        if (!d) { gaps.push(c.name); continue; }
        decided++;
        if (d.critical) hasCritical = true;
        const isExpired = d.expiry && new Date(d.expiry).getTime() < now;
        const daysLeft = d.expiry ? (new Date(d.expiry).getTime() - now) / 86400000 : null;
        if (OUTCOME_CONFIG[d.outcome]?.passing && !isExpired) {
          passing++;
          if (daysLeft != null && daysLeft <= 60) expiring.push(c.name);
        } else if (isExpired) {
          expired.push(c.name);
        } else {
          gaps.push(c.name);
        }
      }
      const readiness = Math.round((passing / cpuComps.length) * 100);
      const isEntrusted = entrusted.has(`${nurse.id}:${cpuId}`);

      // Classification → spec §11 priority order
      let type: TaskType | null = null, priority = 9, reason = "", decision = "";
      if (hasCritical) {
        type = "remediation"; priority = 1;
        reason = "Critical failure recorded — practice restriction in force";
        decision = "Remediation outcome";
      } else if (readiness === 100 && !isEntrusted) {
        type = "entrustment"; priority = 2;
        reason = "All competencies current — blocking independent practice";
        decision = "Entrustment level";
      } else if (expired.length > 0) {
        type = "renewal"; priority = 3;
        reason = `${expired.length} competency decision${expired.length !== 1 ? "s" : ""} expired`;
        decision = "Reassessment outcome";
      } else if (decided > 0 && gaps.length > 0) {
        type = gaps.length < cpuComps.length ? "focused" : "full_cpu";
        priority = 4;
        reason = `${gaps.length} open gap${gaps.length !== 1 ? "s" : ""} after previous assessment`;
        decision = "Competency decision";
      } else if (expiring.length > 0) {
        type = "renewal"; priority = 5;
        reason = `${expiring.length} decision${expiring.length !== 1 ? "s" : ""} expiring within 60 days`;
        decision = "Reassessment outcome";
      } else if (decided === 0) {
        type = "full_cpu"; priority = reqType === "orientation" ? 3 : 6;
        reason = reqType === "orientation" ? "New-staff orientation requirement" : "Initial assessment not yet started";
        decision = "Competency decision";
      }
      if (!type) continue; // fully current + entrusted → no work

      tasks.push({
        nurseId: nurse.id, nurseName: nurse.full_name ?? "—",
        department: nurse.department_id ? (deptName.get(nurse.department_id) ?? null) : null,
        cpuId, cpuName: cpu.name, cpuCode: cpu.code, riskCategory: cpu.risk_category,
        type, priority, reason, readiness, estMinutes: EST[type], decisionRequired: decision,
        evidence: { complete: passing, gaps, expiring, expired },
        criticalItems: critByCpu.get(cpuId) ?? [],
        methods: methodsByCpu.get(cpuId) ?? [],
      });
    }
  }

  tasks.sort((a, b) => a.priority - b.priority || b.readiness - a.readiness);
  return {
    tasks,
    workload: {
      tasks: tasks.length,
      estMinutes: tasks.reduce((s, t) => s + t.estMinutes, 0),
      learners: new Set(tasks.map(t => t.nurseId)).size,
      urgent: tasks.filter(t => t.priority <= 2).length,
    },
  };
}
