// Assignment & Workload Engine (HWW-AE-001, migration 155) — explainable
// nurse-to-patient recommendations from the inputs that now all exist: acuity
// scores (153), NAS workload (153), competency readiness (COMP-027 engine),
// continuity of care (current op_patient_assignments), isolation status and
// staffing ratios (op_staffing_standards). DETERMINISTIC and explainable — a
// greedy balanced allocator with hard safety rules and soft preferences, no
// LLM. The charge nurse reviews, overrides and PUBLISHES (spec S4); published
// assignments land in op_patient_assignments with the exact semantics of the
// single-assignment API (primary uniqueness, competency validation, mandatory
// override reason). allocate() is pure so the harness proves the rules.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { checkDeploymentReadiness } from "@/lib/operations/deployment-readiness";

// Fallback per-patient workload when no NAS/ward assessment is recorded yet —
// a documented operational convention keyed on the coarse acuity level.
export const DEFAULT_WORKLOAD_BY_ACUITY: Record<string, number> = { critical: 90, high: 60, moderate: 35, stable: 20 };
// Continuity preference (spec S5 "maintain continuity where feasible"):
// keeping the current nurse discounts this much load in the choice, so
// continuity wins ties and near-ties but never beats real imbalance.
export const CONTINUITY_BONUS = 15;
// Isolation cohorting preference: a nurse already holding an isolation
// patient is mildly preferred for further isolation patients (IPC exposure).
export const ISOLATION_COHORT_BONUS = 8;
export const OVERLOAD_PCT = 100;

export type NurseInput = {
  id: string; name: string; role: string;
  currentPatients: string[];               // patient ids currently assigned (continuity)
  blocked: boolean;                        // COMP-027: unresolved critical competency failure
  criticalFailures: number;
  expiredCount: number;
  competencyValidated: boolean;            // holds >=1 current passing decision (assignment-API rule)
};

export type PatientInput = {
  id: string; label: string; bed: string | null;
  acuityLevel: string;                     // stable|moderate|high|critical
  acuityScore: number | null;              // 0-18 when assessed
  workloadPct: number;                     // latest NAS/ward % or the acuity fallback
  workloadIsMeasured: boolean;
  isolation: boolean;
  currentNurse: string | null;             // staff id of current active primary
};

export type Proposal = {
  patient_id: string; patient: string; bed: string | null;
  staff_id: string; nurse: string;
  load_after: number; continuity: boolean; needs_override: boolean;
  flags: string[]; explanation: string;
};
export type AllocationResult = {
  proposals: Proposal[];
  gaps: { patient_id: string; patient: string; reason: string }[];
  nurseLoads: { staff_id: string; nurse: string; patients: number; load: number; overloaded: boolean; blocked: boolean }[];
  riskAlerts: { severity: "high" | "medium"; text: string }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

// ── The pure allocator ───────────────────────────────────────────────────────
// Heaviest patients placed first onto the nurse with the lowest effective cost
// (projected load − continuity/cohorting bonuses), under the hard rules:
//   R1  high/critical-acuity patients never go to a competency-BLOCKED nurse
//   R2  the staffing-ratio cap (patients per nurse) is never exceeded
// A patient no nurse can safely take is a COVERAGE GAP (spec S5: "escalate
// when safe assignment cannot be achieved"), never a silent unsafe placement.
export function allocate(nurses: NurseInput[], patients: PatientInput[], opts?: { maxPerNurse?: number | null }): AllocationResult {
  const cap = opts?.maxPerNurse && opts.maxPerNurse > 0 ? opts.maxPerNurse : null;
  const state = new Map(nurses.map(n => [n.id, { n, load: 0, count: 0, isolation: 0 }]));
  const proposals: Proposal[] = [];
  const gaps: AllocationResult["gaps"] = [];
  const riskAlerts: AllocationResult["riskAlerts"] = [];

  const ordered = [...patients].sort((a, b) => b.workloadPct - a.workloadPct || (b.acuityScore ?? 0) - (a.acuityScore ?? 0));

  for (const p of ordered) {
    const highAcuity = ["high", "critical"].includes(p.acuityLevel);
    let best: { s: any; cost: number } | null = null;
    let sawCapOnly = false, sawBlockedOnly = false;

    for (const s of state.values()) {
      if (cap != null && s.count >= cap) { sawCapOnly = true; continue; }
      if (highAcuity && s.n.blocked) { sawBlockedOnly = true; continue; }         // R1
      const continuity = p.currentNurse === s.n.id;
      let cost = s.load + p.workloadPct;
      if (continuity) cost -= CONTINUITY_BONUS;
      if (p.isolation && s.isolation > 0) cost -= ISOLATION_COHORT_BONUS;
      if (!highAcuity && s.n.blocked) cost += 25;                                  // soft: steer work away from blocked nurses
      if (best == null || cost < best.cost) best = { s, cost };
    }

    if (!best) {
      const reason = sawBlockedOnly && !sawCapOnly
        ? "no competency-cleared nurse available for a high-acuity patient"
        : sawCapOnly && !sawBlockedOnly
          ? "every nurse is at the staffing-ratio cap"
          : "no nurse can safely take this patient (ratio cap / competency constraints)";
      gaps.push({ patient_id: p.id, patient: p.label, reason });
      riskAlerts.push({ severity: "high", text: `Coverage gap — ${p.label} (${p.acuityLevel}): ${reason}. Escalate staffing.` });
      continue;
    }

    const { s } = best;
    s.load = r1(s.load + p.workloadPct);
    s.count += 1;
    if (p.isolation) s.isolation += 1;
    const continuity = p.currentNurse === s.n.id;
    const flags: string[] = [];
    if (s.n.blocked) flags.push("nurse has unresolved critical competency failure");
    if (!s.n.competencyValidated) flags.push("no current validated competency — override required to publish");
    if (p.isolation) flags.push("isolation");

    const why: string[] = [];
    why.push(`${p.workloadIsMeasured ? "measured workload" : "estimated workload (no assessment yet)"} ${p.workloadPct}%`);
    why.push(`acuity ${p.acuityLevel}${p.acuityScore != null ? ` (${p.acuityScore}/18)` : ""}`);
    if (continuity) why.push("continuity — already this nurse's patient");
    else if (p.currentNurse) why.push("moved for load balance");
    if (p.isolation && s.isolation > 1) why.push("isolation cohorted with this nurse's existing isolation patient");
    if (highAcuity) why.push("competency-cleared for high acuity");
    why.push(`nurse load after: ${s.load}%${cap != null ? `, ${s.count}/${cap} patients` : ""}`);

    proposals.push({
      patient_id: p.id, patient: p.label, bed: p.bed,
      staff_id: s.n.id, nurse: s.n.name,
      load_after: s.load, continuity, needs_override: !s.n.competencyValidated,
      flags, explanation: why.join("; "),
    });
  }

  const nurseLoads = [...state.values()].map(s => ({
    staff_id: s.n.id, nurse: s.n.name, patients: s.count, load: r1(s.load),
    overloaded: s.load > OVERLOAD_PCT, blocked: s.n.blocked,
  })).sort((a, b) => b.load - a.load);

  for (const nl of nurseLoads) {
    if (nl.overloaded) riskAlerts.push({ severity: "high", text: `${nl.nurse} projected at ${nl.load}% — over one nurse's capacity even after balancing. Staffing is short.` });
  }
  const blockedWithWork = proposals.filter(p => p.flags.includes("nurse has unresolved critical competency failure"));
  if (blockedWithWork.length) riskAlerts.push({ severity: "medium", text: `${blockedWithWork.length} assignment(s) to nurses with unresolved critical competency failures (lower-acuity patients only). Prioritise remediation.` });
  const unvalidated = proposals.filter(p => p.needs_override).length;
  if (unvalidated) riskAlerts.push({ severity: "medium", text: `${unvalidated} proposal(s) need a professional-judgement override (nurse has no current validated competency).` });

  return { proposals, gaps, nurseLoads, riskAlerts };
}

// ── Context assembly (real stores) ───────────────────────────────────────────

const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
const IN_WARD = ["admitted", "transfer_pending", "discharge_pending"];
const NURSE_ROLES = ["nurse", "charge"];
const ON_SHIFT = ["assigned", "confirmed", "on_duty"];

export async function loadAssignmentContext(admin: any, hospitalId: string | null, isSuperUser: boolean) {
  // The unit of work: the latest ACTIVE shift on the tenant.
  let sq = admin.from("op_shifts").select("id, shift_type, shift_date, hospital_id, department_id, unit_id, supervisor_id, departments!department_id(name), units!unit_id(name)")
    .eq("status", "active").order("shift_date", { ascending: false }).order("created_at", { ascending: false }).limit(1);
  if (!isSuperUser) sq = sq.eq("hospital_id", hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data: shifts } = await sq;
  const shift = shifts?.[0] ?? null;
  if (!shift) return { shift: null, nurses: [] as NurseInput[], patients: [] as PatientInput[], maxPerNurse: null as number | null };

  // Nurses on this shift (nurse/charge tiers, present statuses).
  const { data: staffRows } = await admin.from("op_shift_staff")
    .select("staff_id, role, status, profiles!staff_id(id, full_name)")
    .eq("shift_id", shift.id).in("role", NURSE_ROLES).in("status", ON_SHIFT).limit(100);
  const staff = ((staffRows ?? []) as any[]).filter(s => s.profiles);

  // Patients on the shift's unit (fallback: department, then hospital).
  let pq = admin.from("op_patients").select("id, label, acuity_level, isolation_status, op_beds!bed_id(label)").in("operational_status", IN_WARD).limit(200);
  if (shift.unit_id) pq = pq.eq("unit_id", shift.unit_id);
  else if (shift.department_id) pq = pq.eq("department_id", shift.department_id);
  else pq = pq.eq("hospital_id", shift.hospital_id);
  const { data: patientRows } = await pq;
  const pats = (patientRows ?? []) as any[];
  const pids = pats.map(p => p.id);

  const soft = (p: Promise<any>) => p.then((r: any) => r, () => ({ data: [] }));
  const [asgRes, acuityRes, workloadRes, standardRes, ...readiness] = await Promise.all([
    pids.length ? soft(admin.from("op_patient_assignments").select("patient_id, staff_id").in("patient_id", pids).eq("status", "active").eq("assignment_type", "primary").limit(300)) : Promise.resolve({ data: [] }),
    pids.length ? soft(admin.from("op_acuity_assessments").select("patient_id, score, assessed_at").in("patient_id", pids).order("assessed_at", { ascending: false }).limit(400)) : Promise.resolve({ data: [] }),
    pids.length ? soft(admin.from("op_workload_assessments").select("patient_id, percentage, assessed_at").in("patient_id", pids).order("assessed_at", { ascending: false }).limit(400)) : Promise.resolve({ data: [] }),
    soft(admin.from("op_staffing_standards").select("target_ratio, role").eq("hospital_id", shift.hospital_id).eq("shift_type", shift.shift_type).limit(20)),
    ...staff.map(s => checkDeploymentReadiness(admin, s.profiles.id).catch(() => ({ blocked: false, criticalFailures: 0, expiredCount: 0 }))),
  ]);

  const latestBy = (rows: any[], field: string) => {
    const m = new Map<string, number>();
    for (const row of rows) if (!m.has(row.patient_id)) m.set(row.patient_id, Number(row[field]));
    return m;
  };
  const acuityScore = latestBy(acuityRes.data ?? [], "score");
  const workloadPct = latestBy(workloadRes.data ?? [], "percentage");
  const currentNurse = new Map(((asgRes.data ?? []) as any[]).map(a => [a.patient_id, a.staff_id]));

  // Current passing competency per nurse — the assignment-API validation rule.
  const today = new Date().toISOString().slice(0, 10);
  const validated = new Map<string, boolean>();
  if (staff.length) {
    const { data: decs } = await admin.from("competency_decisions")
      .select("nurse_id, outcome, expiry_date").in("nurse_id", staff.map(s => s.profiles.id)).in("outcome", PASSING).limit(3000);
    for (const d of (decs ?? []) as any[]) {
      if (!d.expiry_date || d.expiry_date >= today) validated.set(d.nurse_id, true);
    }
  }

  const nurses: NurseInput[] = staff.map((s, i) => {
    const r = (readiness[i] ?? {}) as any;
    return {
      id: s.profiles.id, name: s.profiles.full_name ?? "Nurse", role: s.role,
      currentPatients: [...currentNurse.entries()].filter(([, sid]) => sid === s.profiles.id).map(([pid]) => pid),
      blocked: !!r.blocked, criticalFailures: r.criticalFailures ?? 0, expiredCount: r.expiredCount ?? 0,
      competencyValidated: validated.get(s.profiles.id) ?? false,
    };
  });

  const patients: PatientInput[] = pats.map(p => ({
    id: p.id, label: p.label, bed: p.op_beds?.label ?? null,
    acuityLevel: p.acuity_level, acuityScore: acuityScore.get(p.id) ?? null,
    workloadPct: workloadPct.get(p.id) ?? DEFAULT_WORKLOAD_BY_ACUITY[p.acuity_level] ?? 30,
    workloadIsMeasured: workloadPct.has(p.id),
    isolation: p.isolation_status && p.isolation_status !== "none",
    currentNurse: currentNurse.get(p.id) ?? null,
  }));

  // Ratio cap: patients per nurse from the staffing standard (nurse row preferred).
  const std = ((standardRes.data ?? []) as any[]).find(x => x.role === "nurse") ?? (standardRes.data ?? [])[0] ?? null;
  const ratio = std?.target_ratio != null ? Number(std.target_ratio) : null;
  const maxPerNurse = ratio && ratio > 0 ? Math.max(1, Math.round(ratio)) : null;

  return {
    shift: {
      id: shift.id, shift_type: shift.shift_type, shift_date: shift.shift_date,
      hospital_id: shift.hospital_id, department_id: shift.department_id, unit_id: shift.unit_id,
      department: shift.departments?.name ?? null, unit: shift.units?.name ?? null,
    },
    nurses, patients, maxPerNurse,
  };
}

// ── Generate (compute + persist the explainability record) ───────────────────

const migrationMissingErr = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export async function generateRecommendation(admin: any, opts: { hospitalId: string | null; isSuperUser: boolean; actorId?: string | null; actorName?: string | null; dryRun?: boolean }) {
  const ctx = await loadAssignmentContext(admin, opts.hospitalId, opts.isSuperUser);
  if (!ctx.shift) return { ok: false as const, status: 409, error: "No active shift on this tenant — activate a shift first; the engine allocates for the active shift's unit." };
  if (!ctx.nurses.length) return { ok: false as const, status: 409, error: "No nurses (nurse/charge, present) are staffed on the active shift." };
  if (!ctx.patients.length) return { ok: false as const, status: 409, error: "No admitted patients on the active shift's unit." };

  const result = allocate(ctx.nurses, ctx.patients, { maxPerNurse: ctx.maxPerNurse });
  const moves = result.proposals.filter(p => !p.continuity && ctx.patients.find(x => x.id === p.patient_id)?.currentNurse).length;
  const fresh = result.proposals.filter(p => !ctx.patients.find(x => x.id === p.patient_id)?.currentNurse).length;
  const keeps = result.proposals.filter(p => p.continuity).length;

  let runId: string | null = null;
  let migrationMissing = false;
  if (!opts.dryRun) {
    const { data, error } = await admin.from("op_assignment_recommendations").insert({
      hospital_id: ctx.shift.hospital_id, shift_id: ctx.shift.id,
      department_id: ctx.shift.department_id ?? null, unit_id: ctx.shift.unit_id ?? null,
      status: "generated",
      inputs: {
        nurses: ctx.nurses.length, patients: ctx.patients.length, maxPerNurse: ctx.maxPerNurse,
        measuredWorkloads: ctx.patients.filter(p => p.workloadIsMeasured).length,
        weightDefaults: DEFAULT_WORKLOAD_BY_ACUITY, continuityBonus: CONTINUITY_BONUS,
      },
      proposals: result.proposals, gaps: result.gaps, risk_alerts: result.riskAlerts, nurse_loads: result.nurseLoads,
      generated_by: opts.actorId ?? null, generated_by_name: opts.actorName ?? null,
    }).select("id").single();
    if (error) migrationMissing = migrationMissingErr(error);
    else runId = data.id;
  }

  return { ok: true as const, runId, migrationMissing, shift: ctx.shift, context: { nurses: ctx.nurses, patients: ctx.patients, maxPerNurse: ctx.maxPerNurse }, ...result, rebalance: { keeps, moves, fresh } };
}

// ── Continuous rebalancing (AE-001 S7) ──────────────────────────────────────
// Significant operational events (acuity change, workload overload, escalation
// raised) auto-generate a fresh recommendation run for the tenant's active
// shift and notify its supervisor — THROTTLED (skip when a run newer than 15
// minutes exists for the shift) and strictly fail-soft: rebalancing never
// breaks the originating clinical request. The charge nurse still reviews and
// publishes; nothing is auto-published.
export const REBALANCE_THROTTLE_MIN = 15;

export async function maybeAutoRebalance(admin: any, hospitalId: string | null, trigger: string, notifyFn?: (supervisorId: string, body: string) => Promise<void>): Promise<{ triggered: boolean; reason: string }> {
  try {
    let sq = admin.from("op_shifts").select("id, supervisor_id").eq("status", "active").order("created_at", { ascending: false }).limit(1);
    if (hospitalId) sq = sq.eq("hospital_id", hospitalId);
    const { data: shifts } = await sq;
    const shift = shifts?.[0];
    if (!shift) return { triggered: false, reason: "no active shift" };

    const since = new Date(Date.now() - REBALANCE_THROTTLE_MIN * 60e3).toISOString();
    const { data: recent, error: probeErr } = await admin.from("op_assignment_recommendations")
      .select("id").eq("shift_id", shift.id).gte("created_at", since).limit(1);
    if (probeErr) return { triggered: false, reason: "recommendation store unavailable (migration 155)" };
    if (recent?.length) return { triggered: false, reason: "throttled (recent run exists)" };

    const r = await generateRecommendation(admin, { hospitalId, isSuperUser: !hospitalId, actorId: null, actorName: `auto — ${trigger}` });
    if (!r.ok) return { triggered: false, reason: r.error };

    if (shift.supervisor_id && notifyFn) {
      await notifyFn(shift.supervisor_id, `Trigger: ${trigger}. ${r.proposals.length} proposals, ${r.gaps.length} gaps, ${r.riskAlerts.length} alerts — review before publishing.`).catch(() => {});
    }
    return { triggered: true, reason: trigger };
  } catch (e: any) {
    return { triggered: false, reason: String(e?.message ?? e) };
  }
}

// ── Publish (the charge nurse's approve/override act) ────────────────────────
// Mirrors the single-assignment API semantics per pair: end the existing
// active primary, insert the new assignment with competency_validated and the
// mandatory override reason when not validated. Returns per-pair outcomes —
// one bad pair never blocks the rest.

export async function publishPairs(admin: any, pairs: { patient_id: string; staff_id: string; override_reason?: string | null }[], actor: { id: string | null; name?: string | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const results: { patient_id: string; staff_id: string; ok: boolean; assignment_id?: string; competency_validated?: boolean; error?: string }[] = [];

  for (const pair of pairs) {
    const { data: patient } = await admin.from("op_patients").select("id, label, hospital_id").eq("id", pair.patient_id).maybeSingle();
    if (!patient) { results.push({ ...pair, ok: false, error: "Patient not found" }); continue; }

    const { data: decs } = await admin.from("competency_decisions")
      .select("outcome, expiry_date").eq("nurse_id", pair.staff_id).in("outcome", PASSING).limit(500);
    const competencyValidated = ((decs ?? []) as any[]).some(d => !d.expiry_date || d.expiry_date >= today);
    if (!competencyValidated && !pair.override_reason?.trim()) {
      results.push({ ...pair, ok: false, error: "Nurse has no current validated competency — an override reason is required" });
      continue;
    }

    // No-ops: already this nurse's ACTIVE primary (continuity keeps the
    // record) or already PENDING with this nurse (don't spam duplicates).
    const { data: existingRows } = await admin.from("op_patient_assignments").select("id, staff_id, status")
      .eq("patient_id", pair.patient_id).eq("assignment_type", "primary").in("status", ["active", "pending_acceptance"]).limit(5);
    const same = ((existingRows ?? []) as any[]).find(x => x.staff_id === pair.staff_id);
    if (same) {
      results.push({ ...pair, ok: true, assignment_id: same.id, competency_validated: competencyValidated });
      continue;
    }
    // A different nurse's stale PENDING offer is superseded; the ACTIVE
    // assignment stays until the new nurse ACCEPTS (WARD-003 rule).
    const stalePending = ((existingRows ?? []) as any[]).filter(x => x.status === "pending_acceptance");
    for (const sp of stalePending) {
      await admin.from("op_patient_assignments").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", sp.id);
    }

    let data: any = null;
    let pendingFlow = true;
    {
      const r = await admin.from("op_patient_assignments").insert({
        hospital_id: patient.hospital_id, patient_id: pair.patient_id, staff_id: pair.staff_id,
        assignment_type: "primary", competency_validated: competencyValidated,
        override_reason: competencyValidated ? null : (pair.override_reason?.trim() || null),
        status: "pending_acceptance", acceptance_status: "pending", created_by: actor.id ?? null,
      }).select("id").single();
      if (r.error && /check constraint|acceptance_status|column/i.test(r.error.message)) {
        // Pre-migration-156 fallback: legacy immediate-active behaviour.
        pendingFlow = false;
        const active = ((existingRows ?? []) as any[]).find(x => x.status === "active");
        if (active) await admin.from("op_patient_assignments").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", active.id);
        const legacy = await admin.from("op_patient_assignments").insert({
          hospital_id: patient.hospital_id, patient_id: pair.patient_id, staff_id: pair.staff_id,
          assignment_type: "primary", competency_validated: competencyValidated,
          override_reason: competencyValidated ? null : (pair.override_reason?.trim() || null),
          status: "active", created_by: actor.id ?? null,
        }).select("id").single();
        if (legacy.error) { results.push({ ...pair, ok: false, error: legacy.error.message }); continue; }
        data = legacy.data;
      } else if (r.error) { results.push({ ...pair, ok: false, error: r.error.message }); continue; }
      else data = r.data;
    }

    await admin.from("audit_log").insert({
      actor_id: actor.id, actor_name: actor.name ?? null, action: "assign_patient",
      entity_type: "op_patient_assignment", entity_id: data.id, entity_name: patient.label,
      hospital_id: patient.hospital_id,
      new_value: { staff_id: pair.staff_id, type: "primary", competency_validated: competencyValidated, override: !competencyValidated, via: "assignment_engine", awaiting_acceptance: pendingFlow },
    }).then((x: any) => x, () => {});
    results.push({ ...pair, ok: true, assignment_id: data.id, competency_validated: competencyValidated });
  }

  return results;
}
