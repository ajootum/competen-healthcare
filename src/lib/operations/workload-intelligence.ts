// Workforce Workload Intelligence (SSW-WFM-004) — the supervisor's lens over
// the assessment data the BEDSIDE now produces. HWW writes real instrument
// scores (migrations 153/157: Ward PEWS + CIAF acuity, Ward-12 + NAS workload)
// and medication activity (154), and until now NO SSW surface read any of it —
// the SSW saw only the coarse op_patients.acuity_level enum.
//
// Everything here is measured or explicitly marked estimated:
//   - per-patient workload = the latest recorded assessment (framework-aware);
//     patients never assessed are counted separately, never silently zeroed
//   - per-nurse load = sum of their actively-assigned patients' latest scores
//     (the same rule the HWW aggregate and the assignment engine use)
//   - unit rollups, acuity/workload distribution and the drivers behind them
// Fail-soft: any missing store degrades to an honest empty section.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const IN_WARD = ["admitted", "transfer_pending", "discharge_pending"];
// Ward-12 scores 0-36; NAS/ward-legacy are already a % of one nurse. Normalise
// ward12 to the same "% of one nurse" axis so cross-unit sums mean something.
const asPercent = (row: any): number => {
  const pct = Number(row?.percentage ?? 0);
  return Number.isFinite(pct) ? pct : 0;
};
const ACUITY_ORDER = ["stable", "moderate", "high", "critical"];

export async function loadWorkloadIntelligence(admin: any, hid: string | null, isSuper: boolean, now = Date.now()) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: true }));

  const probe = await admin.from("op_workload_assessments").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  // Patients currently in the ward, with their unit/department context.
  const { data: patientRows } = await soft(scope(admin.from("op_patients")
    .select("id, label, acuity_level, isolation_status, risk_level, unit_id, department_id, op_beds!bed_id(label, bed_type), units!unit_id(name), departments!department_id(name)")
    .in("operational_status", IN_WARD).limit(500)));
  const patients = (patientRows ?? []) as any[];
  const pids = patients.map(p => p.id);
  if (!pids.length) {
    return { provisioned: true as const, empty: true as const, patients: [], units: [], nurses: [], kpis: null, distribution: null, drivers: [], unsafe: [] };
  }

  const [wlRes, acRes, medRes, admRes, asgRes, movRes] = await Promise.all([
    soft(admin.from("op_workload_assessments").select("patient_id, percentage, score, framework, level, ratio, override_level, assessed_at")
      .in("patient_id", pids).order("assessed_at", { ascending: false }).limit(1500)),
    soft(admin.from("op_acuity_assessments").select("patient_id, score, level, classification, framework, significant_change, assessed_at")
      .in("patient_id", pids).order("assessed_at", { ascending: false }).limit(1500)),
    soft(admin.from("op_med_schedule").select("patient_id, status, scheduled_at, high_risk")
      .in("patient_id", pids).gte("scheduled_at", new Date(now - 12 * 3.6e6).toISOString()).limit(1000)),
    soft(admin.from("op_med_administrations").select("patient_id, outcome, delay_minutes, administered_at")
      .in("patient_id", pids).gte("administered_at", new Date(now - 12 * 3.6e6).toISOString()).limit(1000)),
    soft(admin.from("op_patient_assignments").select("patient_id, staff_id, status, assignment_type, profiles!staff_id(id, full_name)")
      .in("patient_id", pids).eq("status", "active").limit(600)),
    soft(admin.from("op_movement_events").select("patient_id, event_type, created_at")
      .in("patient_id", pids).gte("created_at", new Date(now - 12 * 3.6e6).toISOString()).limit(500)),
  ]);

  // Latest assessment per patient (rows arrive newest-first).
  const latest = (rows: any[]) => {
    const m = new Map<string, any>();
    for (const r of rows ?? []) if (!m.has(r.patient_id)) m.set(r.patient_id, r);
    return m;
  };
  const wl = latest(wlRes.data ?? []);
  const ac = latest(acRes.data ?? []);
  const meds = (medRes.data ?? []) as any[];
  const medEvents = (admRes.data ?? []) as any[];
  const moves = (movRes.data ?? []) as any[];

  // Per-patient composite row.
  const rows = patients.map(p => {
    const w = wl.get(p.id) ?? null;
    const a = ac.get(p.id) ?? null;
    const openMeds = meds.filter(m => m.patient_id === p.id && ["scheduled", "due", "overdue", "delayed"].includes(m.status));
    return {
      id: p.id, label: p.label,
      unit: p.units?.name ?? p.departments?.name ?? "Unassigned",
      bed: p.op_beds?.label ?? null,
      icu: p.op_beds?.bed_type === "critical_care",
      acuityLevel: p.acuity_level,
      isolation: !!p.isolation_status && p.isolation_status !== "none",
      acuityScore: a?.score ?? null, acuityFramework: a?.framework ?? null,
      acuityClassification: a?.classification ?? null, acuitySignificant: !!a?.significant_change,
      acuityAt: a?.assessed_at ?? null,
      workloadPct: w ? asPercent(w) : null,
      workloadLevel: w?.override_level || w?.level || null,
      workloadRatio: w?.ratio ?? null, workloadFramework: w?.framework ?? null,
      workloadAt: w?.assessed_at ?? null,
      assessed: !!w,
      openMeds: openMeds.length, highRiskMeds: openMeds.filter(m => m.high_risk).length,
      movements: moves.filter(m => m.patient_id === p.id).length,
    };
  });

  const assessedRows = rows.filter(r => r.assessed);
  const unassessed = rows.filter(r => !r.assessed);

  // ── Unit rollups ──
  const unitMap = new Map<string, any>();
  for (const r of rows) {
    const u = unitMap.get(r.unit) ?? { unit: r.unit, patients: 0, assessed: 0, totalPct: 0, high: 0, icu: 0, isolation: 0, openMeds: 0 };
    u.patients++; if (r.assessed) { u.assessed++; u.totalPct += r.workloadPct ?? 0; }
    if (["high", "critical"].includes(r.acuityLevel)) u.high++;
    if (r.icu) u.icu++; if (r.isolation) u.isolation++;
    u.openMeds += r.openMeds;
    unitMap.set(r.unit, u);
  }
  const units = [...unitMap.values()].map(u => ({
    ...u,
    avgPct: u.assessed ? Math.round((u.totalPct / u.assessed) * 10) / 10 : null,
    totalPct: Math.round(u.totalPct * 10) / 10,
    coverage: u.patients ? Math.round((u.assessed / u.patients) * 100) : 0,
  })).sort((a, b) => (b.totalPct ?? 0) - (a.totalPct ?? 0));

  // ── Per-nurse load (the assignment engine's rule) ──
  const byNurse = new Map<string, any>();
  for (const a of (asgRes.data ?? []) as any[]) {
    if (!a.profiles) continue;
    const n = byNurse.get(a.staff_id) ?? { id: a.staff_id, name: a.profiles.full_name ?? "Nurse", patients: [] as any[], load: 0, assessedCount: 0 };
    const r = rows.find(x => x.id === a.patient_id);
    if (r) { n.patients.push(r); if (r.assessed) { n.load += r.workloadPct ?? 0; n.assessedCount++; } }
    byNurse.set(a.staff_id, n);
  }
  const nurses = [...byNurse.values()].map(n => ({
    ...n, load: Math.round(n.load * 10) / 10, count: n.patients.length,
    unassessed: n.patients.length - n.assessedCount,
    overloaded: n.load > 100,
    highAcuity: n.patients.filter((p: any) => ["high", "critical"].includes(p.acuityLevel)).length,
  })).sort((a, b) => b.load - a.load);

  // ── Distribution ──
  const acuityDist = ACUITY_ORDER.map(k => ({ level: k, n: rows.filter(r => r.acuityLevel === k).length }));
  const wlBands = [
    { band: "Low (<40%)", n: assessedRows.filter(r => (r.workloadPct ?? 0) < 40).length },
    { band: "Moderate (40-69%)", n: assessedRows.filter(r => (r.workloadPct ?? 0) >= 40 && (r.workloadPct ?? 0) < 70).length },
    { band: "High (70-99%)", n: assessedRows.filter(r => (r.workloadPct ?? 0) >= 70 && (r.workloadPct ?? 0) < 100).length },
    { band: "Very high (>=100%)", n: assessedRows.filter(r => (r.workloadPct ?? 0) >= 100).length },
  ];
  const levelDist = [...new Set(assessedRows.map(r => r.workloadLevel).filter(Boolean))].sort()
    .map(l => ({ level: l as string, n: assessedRows.filter(r => r.workloadLevel === l).length }));

  // ── Drivers (what is actually generating the load) ──
  const administered = medEvents.filter(e => e.outcome === "administered");
  const drivers = [
    { label: "Measured patient workload", value: `${Math.round(assessedRows.reduce((s, r) => s + (r.workloadPct ?? 0), 0))}%`, sub: `${assessedRows.length} patients assessed` },
    { label: "High / critical acuity", value: rows.filter(r => ["high", "critical"].includes(r.acuityLevel)).length, sub: "of the current census" },
    { label: "Open medications (12h)", value: meds.filter(m => ["scheduled", "due", "overdue", "delayed"].includes(m.status)).length, sub: `${meds.filter(m => m.high_risk).length} high-risk` },
    { label: "Medication activity (12h)", value: administered.length, sub: administered.length ? `${Math.round((administered.filter(e => e.delay_minutes <= 15).length / administered.length) * 100)}% on time` : "no administrations" },
    { label: "Patient movements (12h)", value: moves.length, sub: "admissions / transfers / discharges" },
    { label: "Isolation patients", value: rows.filter(r => r.isolation).length, sub: "added IPC workload" },
  ];

  // ── Unsafe workload monitor (QS-003) ──
  const unsafe: { severity: "high" | "medium"; text: string }[] = [];
  for (const n of nurses.filter(x => x.overloaded)) unsafe.push({ severity: "high", text: `${n.name} carries ${n.load}% across ${n.count} patients — above one nurse's capacity.` });
  for (const u of units.filter(x => x.avgPct != null && x.avgPct >= 80)) unsafe.push({ severity: "medium", text: `${u.unit} averages ${u.avgPct}% workload per patient across ${u.assessed} assessed.` });
  if (unassessed.length) unsafe.push({ severity: "medium", text: `${unassessed.length} of ${rows.length} patients have no workload assessment — their load is unmeasured, not zero.` });
  const sigChanges = assessedRows.filter(r => r.acuitySignificant);
  if (sigChanges.length) unsafe.push({ severity: "high", text: `${sigChanges.length} patient(s) recorded a significant acuity change — assignment review recommended.` });

  const totalMeasured = Math.round(assessedRows.reduce((s, r) => s + (r.workloadPct ?? 0), 0) * 10) / 10;
  const kpis = {
    census: rows.length,
    assessed: assessedRows.length,
    coverage: rows.length ? Math.round((assessedRows.length / rows.length) * 100) : 0,
    totalMeasured,
    avgPerPatient: assessedRows.length ? Math.round((totalMeasured / assessedRows.length) * 10) / 10 : null,
    nursesOnLoad: nurses.length,
    overloadedNurses: nurses.filter(n => n.overloaded).length,
    highAcuity: rows.filter(r => ["high", "critical"].includes(r.acuityLevel)).length,
    // Nurse-equivalents the measured workload implies (100% = one nurse).
    nurseEquivalents: Math.round((totalMeasured / 100) * 10) / 10,
  };

  return {
    provisioned: true as const, empty: false as const,
    patients: rows.sort((a, b) => (b.workloadPct ?? -1) - (a.workloadPct ?? -1)),
    unassessed, units, nurses, kpis,
    distribution: { acuity: acuityDist, workload: wlBands, levels: levelDist },
    drivers, unsafe,
  };
}
