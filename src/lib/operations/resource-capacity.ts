// Resource & Capacity Coordination (SSW-OPS-004) — beds, equipment, isolation,
// ICU and shared resources in one operational read model.
//
// op_equipment and op_resources (migration 101) have existed with ZERO
// consuming pages platform-wide; this is their first surface. Beds come from
// op_beds + the live census, isolation demand from op_patients.isolation_status,
// and resource escalations from the equipment/operational escalation types.
//
// HONEST GAPS (reported by the page, never faked):
//   - Critical supplies / consumables: no par-level store exists.
//   - Theatre case scheduling: op_resources holds counts and a demand flag,
//     not a case list — so theatre shows availability, not a schedule.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const IN_WARD = ["admitted", "transfer_pending", "discharge_pending"];

export async function loadResourceCapacity(admin: any, hid: string | null, isSuper: boolean, now = Date.now()) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: true }));

  const [bedRes, patRes, eqRes, resRes, escRes, turnRes] = await Promise.all([
    soft(scope(admin.from("op_beds").select("id, label, bed_type, status, unit_id, units!unit_id(name)").limit(600))),
    soft(scope(admin.from("op_patients").select("id, isolation_status, acuity_level, bed_id, unit_id").in("operational_status", IN_WARD).limit(600))),
    soft(scope(admin.from("op_equipment").select("id, name, category, status").limit(400))),
    soft(scope(admin.from("op_resources").select("id, name, category, total, available, demand").limit(200))),
    soft(scope(admin.from("op_escalations").select("id, escalation_type, level, severity, summary, status, created_at, response_deadline")
      .in("escalation_type", ["equipment", "operational", "resource"]).in("status", ["open", "acknowledged"]).limit(100))),
    soft(scope(admin.from("op_bed_turnaround").select("id, bed_id, stage, created_at, updated_at, completed_at")
      .is("completed_at", null).limit(200))),
  ]);

  const beds = (bedRes.data ?? []) as any[];
  const patients = (patRes.data ?? []) as any[];
  const equipment = (eqRes.data ?? []) as any[];
  const resources = (resRes.data ?? []) as any[];
  const escalations = (escRes.data ?? []) as any[];
  const turnarounds = (turnRes.data ?? []) as any[];

  const bedsProvisioned = !bedRes.error;
  const equipmentProvisioned = !eqRes.error;
  const resourcesProvisioned = !resRes.error;

  // ── Bed capacity by unit ──
  const unitMap = new Map<string, any>();
  for (const b of beds) {
    const name = b.units?.name ?? "Unassigned";
    const u = unitMap.get(name) ?? { unit: name, total: 0, occupied: 0, available: 0, cleaning: 0, reserved: 0, outOfService: 0, icu: 0, isolation: 0 };
    u.total++;
    if (b.status === "occupied") u.occupied++;
    else if (b.status === "available") u.available++;
    else if (b.status === "cleaning") u.cleaning++;
    else if (b.status === "reserved") u.reserved++;
    else if (b.status === "out_of_service") u.outOfService++;
    if (b.bed_type === "critical_care") u.icu++;
    if (b.bed_type === "isolation") u.isolation++;
    unitMap.set(name, u);
  }
  const units = [...unitMap.values()].map(u => ({
    ...u, occupancy: u.total ? Math.round((u.occupied / u.total) * 100) : 0,
    usable: u.total - u.outOfService,
  })).sort((a, b) => b.occupancy - a.occupancy);

  const totalBeds = beds.length;
  const occupied = beds.filter(b => b.status === "occupied").length;
  const availableBeds = beds.filter(b => b.status === "available").length;
  const outOfService = beds.filter(b => b.status === "out_of_service").length;
  const cleaning = beds.filter(b => b.status === "cleaning").length;

  // ── ICU + isolation capacity ──
  const icuBeds = beds.filter(b => b.bed_type === "critical_care");
  const icu = {
    total: icuBeds.length,
    occupied: icuBeds.filter(b => b.status === "occupied").length,
    available: icuBeds.filter(b => b.status === "available").length,
  };
  const isoBeds = beds.filter(b => b.bed_type === "isolation");
  const isoPatients = patients.filter(p => p.isolation_status && p.isolation_status !== "none");
  const isolation = {
    beds: isoBeds.length,
    occupied: isoBeds.filter(b => b.status === "occupied").length,
    available: isoBeds.filter(b => b.status === "available").length,
    patientsRequiring: isoPatients.length,
    byType: [...new Set(isoPatients.map(p => p.isolation_status))].map(t => ({
      type: t as string, n: isoPatients.filter(p => p.isolation_status === t).length,
    })).sort((a, b) => b.n - a.n),
    // Demand vs DEDICATED isolation beds — a real shortfall signal (patients
    // needing isolation can be sided in other beds, so this is a pressure
    // indicator, not a hard breach).
    shortfall: Math.max(0, isoPatients.length - isoBeds.length),
  };

  // ── Equipment readiness ──
  const eqByStatus = (s: string) => equipment.filter(e => e.status === s).length;
  const equipmentSummary = {
    total: equipment.length,
    operational: eqByStatus("operational"),
    maintenance: eqByStatus("under_maintenance"),
    outOfService: eqByStatus("out_of_service"),
    calibrationDue: eqByStatus("calibration_due"),
    readiness: equipment.length ? Math.round((eqByStatus("operational") / equipment.length) * 100) : null,
  };
  const eqCatMap = new Map<string, any>();
  for (const e of equipment) {
    const c = e.category ?? "other";
    const row = eqCatMap.get(c) ?? { category: c, total: 0, operational: 0, unavailable: 0, items: [] as any[] };
    row.total++;
    if (e.status === "operational") row.operational++; else { row.unavailable++; row.items.push(e); }
    eqCatMap.set(c, row);
  }
  const equipmentByCategory = [...eqCatMap.values()]
    .map(r => ({ ...r, readiness: r.total ? Math.round((r.operational / r.total) * 100) : 0 }))
    .sort((a, b) => a.readiness - b.readiness);
  const equipmentAttention = equipment.filter(e => e.status !== "operational");

  // ── Shared resources (theatre / rooms / transport) ──
  const resourcesByCategory = [...new Set(resources.map(r => r.category))].map(cat => {
    const items = resources.filter(r => r.category === cat);
    const total = items.reduce((s, r) => s + (r.total ?? 0), 0);
    const available = items.reduce((s, r) => s + (r.available ?? 0), 0);
    return {
      category: cat as string, items, total, available,
      utilisation: total ? Math.round(((total - available) / total) * 100) : 0,
      strained: items.filter(r => r.demand === "high").length,
    };
  }).sort((a, b) => b.utilisation - a.utilisation);

  // ── Turnaround in flight (beds not yet back in service) ──
  const turnaroundStages = [...new Set(turnarounds.map(t => t.stage))].map(s => ({
    stage: s as string, n: turnarounds.filter(t => t.stage === s).length,
  }));
  const turnaroundAging = turnarounds
    .map(t => ({ ...t, ageMin: Math.round((now - new Date(t.updated_at ?? t.created_at).getTime()) / 60000) }))
    .sort((a, b) => b.ageMin - a.ageMin).slice(0, 8);

  // ── Alerts ──
  const alerts: { severity: "high" | "medium"; text: string }[] = [];
  const occPct = totalBeds ? Math.round((occupied / totalBeds) * 100) : 0;
  if (occPct >= 95) alerts.push({ severity: "high", text: `Bed occupancy at ${occPct}% — capacity effectively exhausted.` });
  else if (occPct >= 90) alerts.push({ severity: "medium", text: `Bed occupancy at ${occPct}% — limited headroom for admissions.` });
  if (icu.total && icu.available === 0) alerts.push({ severity: "high", text: "No ICU beds available — escalate before accepting critical admissions." });
  if (isolation.shortfall > 0) alerts.push({ severity: "high", text: `${isolation.shortfall} isolation patient(s) beyond dedicated isolation bed capacity.` });
  if (equipmentSummary.outOfService > 0) alerts.push({ severity: "medium", text: `${equipmentSummary.outOfService} equipment item(s) out of service.` });
  if (equipmentSummary.calibrationDue > 0) alerts.push({ severity: "medium", text: `${equipmentSummary.calibrationDue} item(s) due calibration.` });
  for (const r of resourcesByCategory.filter(r => r.total > 0 && r.available === 0)) alerts.push({ severity: "medium", text: `No ${r.category.replace(/_/g, " ")} currently available.` });
  if (outOfService > 0) alerts.push({ severity: "medium", text: `${outOfService} bed(s) out of service, reducing usable capacity.` });

  return {
    bedsProvisioned, equipmentProvisioned, resourcesProvisioned,
    kpis: {
      totalBeds, occupied, availableBeds, cleaning, outOfService,
      occupancy: occPct,
      icuAvailable: icu.available, icuTotal: icu.total,
      isolationAvailable: isolation.available, isolationDemand: isolation.patientsRequiring,
      equipmentReadiness: equipmentSummary.readiness,
      openResourceEscalations: escalations.length,
    },
    units, icu, isolation, equipmentSummary, equipmentByCategory, equipmentAttention,
    resourcesByCategory, escalations, turnaroundStages, turnaroundAging, alerts,
  };
}
