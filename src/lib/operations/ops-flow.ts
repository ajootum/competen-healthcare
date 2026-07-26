// UMW-OPC-005 Patient Flow Coordination Centre loader. The live movement picture over op_movement_events (today's
// admissions/transfers/discharges/theatre), op_patients (census by department + operational status), op_flow_blockers
// (constraints), op_beds (turnover) and op_ops_snapshots (LOS / before-noon / forecast). Computes the KPI ribbon, a
// 3-stage flow overview (incoming → current → outgoing), census by location, flow performance indicators, pathway
// mix, live blockers and rule-based flow recommendations. Read-only manager lens; live execution stays in the SSW.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, pct, NONE } from "./ops-shared";

const BLOCKER_LABEL: Record<string, string> = { no_bed: "No bed available", bed_cleaning: "Bed cleaning", discharge_meds: "Discharge meds", family_education: "Family education", transport: "Transport delay", medical_review: "Medical review", documentation: "Documentation", receiving_unit: "Receiving unit", isolation_room: "Isolation room", equipment: "Equipment", other: "Other" };

export async function loadFlowCommand(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { patients, movements, blockers, beds, cur } = c;

  // Department names for census grouping.
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const depRes = await scope(admin.from("departments").select("id, name")).then((r: any) => r, () => ({ data: [] }));
  const depName = new Map<string, string>((depRes.data ?? []).map((d: any) => [d.id, d.name]));

  // Movement counts today by type. Admissions/discharges prefer the daily snapshot (authoritative daily total) and
  // fall back to the granular movement-event log where snapshots are absent — the log may be sparse for a given day.
  const mv = (t: string[]) => movements.filter(m => t.includes(m.event_type)).length;
  const admissions = cur.admissions ?? mv(["admission"]);
  const discharges = cur.discharges ?? mv(["discharge"]);
  const transfers = mv(["transfer"]);
  const theatre = mv(["theatre", "recovery"]);
  const stepdown = movements.filter(m => m.event_type === "bed_change").length;

  const inpatients = patients.filter(p => p.operational_status === "admitted").length;
  const totalBeds = beds.length, occ = beds.filter(b => b.status === "occupied").length;
  const blocked = blockers.length;
  const flowEfficiency = Math.max(0, 100 - Math.min(100, blocked * 8));

  const kpis = {
    inpatients, admissions, discharges, transfers,
    avgLos: cur.avg_los != null ? Number(cur.avg_los) : null,
    turnover: cur.bed_turnover != null ? Number(cur.bed_turnover) : (discharges + admissions),
    flowEfficiency, blocked,
    occupancy: totalBeds ? pct(occ, totalBeds) : (cur.occupancy_pct ?? 0),
  };

  // 3-stage flow overview.
  const flow = {
    incoming: [
      { label: "Admissions", n: admissions, color: "#ef4444" },
      { label: "Transfers in", n: transfers, color: "#f59e0b" },
      { label: "Theatre / Recovery", n: theatre, color: "#a855f7" },
    ],
    current: [...depName.entries()].map(([id, name]) => ({ label: name, n: patients.filter(p => p.department_id === id && p.operational_status === "admitted").length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 6),
    outgoing: [
      { label: "Discharges", n: discharges, color: "#22c55e" },
      { label: "Transfers out", n: transfers, color: "#3b82f6" },
      { label: "Step-down", n: stepdown, color: "#a855f7" },
    ],
  };
  // Census fallback when patients carry no department_id.
  if (!flow.current.length) flow.current = [{ label: "This unit", n: inpatients }];

  // Flow timeline — today's movements bucketed by hour (admissions / discharges / transfers).
  const hours: Record<number, { a: number; d: number; t: number }> = {};
  movements.forEach(m => { const h = new Date(m.created_at).getHours(); const b = hours[h] ?? { a: 0, d: 0, t: 0 }; if (m.event_type === "admission") b.a++; else if (m.event_type === "discharge") b.d++; else if (m.event_type === "transfer") b.t++; hours[h] = b; });
  const timeline = Object.entries(hours).map(([h, v]) => ({ h: Number(h), ...v })).sort((a, b) => a.h - b.h);

  // Flow performance indicators (only real values; else marked derived/unknown).
  const indicators = [
    { label: "Discharge before 11:00", pct: cur.discharge_before_noon_pct ?? null, target: 80 },
    { label: "Bed turnover / day", value: cur.bed_turnover != null ? Number(cur.bed_turnover).toFixed(1) : null },
    { label: "ED boarding (hrs)", value: cur.ed_boarding_hours != null ? Number(cur.ed_boarding_hours).toFixed(1) : null },
    { label: "Readmission rate", pct: cur.readmission_rate != null ? Math.round(Number(cur.readmission_rate)) : null, target: 10, invert: true },
  ];

  // Pathway mix from movement types (approximate).
  const total = admissions + transfers + discharges + theatre + stepdown || 1;
  const pathways = [
    { label: "Admission → Ward", n: admissions, pct: pct(admissions, total) },
    { label: "Transfer", n: transfers, pct: pct(transfers, total) },
    { label: "Theatre → Recovery", n: theatre, pct: pct(theatre, total) },
    { label: "Step-down / bed change", n: stepdown, pct: pct(stepdown, total) },
    { label: "Discharge", n: discharges, pct: pct(discharges, total) },
  ].filter(p => p.n > 0);

  // Blockers & constraints (real).
  const constraints = blockers.slice(0, 6).map(b => ({ label: BLOCKER_LABEL[b.category] ?? b.category, detail: b.detail ?? "", at: b.created_at, impact: ["no_bed", "medical_review", "receiving_unit"].includes(b.category) ? "High" : "Medium" }));

  // Rule-based recommendations.
  const recs: { text: string; href: string }[] = [];
  if (kpis.occupancy >= 90) recs.push({ text: `Expedite discharges — occupancy at ${kpis.occupancy}%`, href: "/unit-manager/patient-operations/flow" });
  if (blockers.filter(b => b.category === "no_bed").length) recs.push({ text: "Resolve no-bed blockers to release waiting patients", href: "/unit-manager/patient-operations/beds" });
  if (blockers.filter(b => b.category === "discharge_meds").length) recs.push({ text: "Chase discharge medications to clear delayed discharges", href: "/unit-manager/patient-operations/flow" });
  if (!recs.length) recs.push({ text: "Flow within normal parameters — no action required", href: "/unit-manager/patient-operations" });

  return { provisioned: true as const, hasData: c.hasData, kpis, flow, timeline, indicators, pathways, constraints, recs, asOf: cur.period ?? null };
}
