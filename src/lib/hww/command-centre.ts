// Shift Command Centre loader (HWW-ARCH-002 S5) — everything the modernized
// Shift Dashboard renders, composed from the shipped engines: my shift +
// patients (loadMyShift), medications (loadMyMedications), acuity/workload
// (loadMyAssessments), concerns, CNCI per patient (the S9 prioritisation
// engine), next-due item, PEWS trend, the S8 reassessment prompts, a REAL
// timeline (shift window + ward round schedule + due clusters) and this-shift
// performance counts (actor-scoped). All clock-derived fields live here so
// the page stays render-pure. Real rows only — nothing fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadMyShift, loadWardContext } from "@/lib/hww/my-shift";
import { loadMyMedications } from "@/lib/hww/medications";
import { loadMyAssessments } from "@/lib/hww/assessments";
import { computeCnci, cnciInputFromRows, pewsTrend, reassessmentDue, type CnciResult } from "@/lib/hww/cnci";

export type PatientRow = {
  patient: any;                 // the op_patients row (from the assignment join)
  assignment_type: string;
  cnci: CnciResult;
  pews: number | null;
  trend: "up" | "down" | "flat" | null;
  workloadPct: number | null;
  acuityScore: number | null;
  nextDue: { kind: "med" | "obs"; label: string; at: string | null; overdue: boolean } | null;
  reassess: { due: boolean; reason: string | null };
};

export async function loadShiftCommandCentre(admin: any, userId: string, now = Date.now()) {
  const [base, meds, assess] = await Promise.all([
    loadMyShift(admin, userId),
    loadMyMedications(admin, userId, now),
    loadMyAssessments(admin, userId),
  ]);
  const ward = await loadWardContext(admin, base.shift);
  const pids = base.patients.map((a: any) => a.op_patients.id);

  // Active concerns per patient (CNCI complexity signal) — fail-soft.
  let concerns: any[] = [];
  if (pids.length) {
    const { data } = await admin.from("op_concerns").select("patient_id, status")
      .in("patient_id", pids).in("status", ["open", "in_progress", "carried_forward"]).limit(200).then((r: any) => r, () => ({ data: [] }));
    concerns = data ?? [];
  }

  // ── Per-patient composite rows (CNCI-ranked) ──
  const rows: PatientRow[] = base.patients.map((a: any) => {
    const p = a.op_patients;
    const obs = base.observations.filter((o: any) => o.patient_id === p.id);
    const patientMeds = meds.schedule.filter((m: any) => m.patient_id === p.id);
    const alerts = base.safetyAlerts.filter((x: any) => x.patient_id === p.id);
    const escs = base.escalations.filter((x: any) => x.patient_id === p.id);
    const myConcerns = concerns.filter((x: any) => x.patient_id === p.id);
    const tasks = base.tasks.filter((t: any) => t.patient_id === p.id);
    const acuityLatest = (assess.acuityByPatient.get(p.id) ?? [])[0] ?? null;
    const workloadLatest = (assess.workloadByPatient.get(p.id) ?? [])[0] ?? null;

    const input = cnciInputFromRows({
      patient: p, acuityLatest, workloadLatest,
      observations: obs, meds: patientMeds, alerts, escalations: escs, concerns: myConcerns, tasks,
    });
    const cnci = computeCnci(input);

    // Next due item: earliest open medication or scheduled observation.
    const dueObs = obs.filter((o: any) => ["due", "overdue"].includes(o.status) && o.due_at)
      .map((o: any) => ({ kind: "obs" as const, label: `Obs: ${String(o.observation_type).replace(/_/g, " ")}`, at: o.due_at as string, overdue: o.status === "overdue" }));
    const dueMeds = patientMeds.filter((m: any) => ["due", "overdue", "delayed"].includes(m.effective_status))
      .map((m: any) => ({ kind: "med" as const, label: `Med: ${m.drug_name}`, at: m.scheduled_at as string, overdue: m.effective_status === "overdue" }));
    const nextDue = [...dueObs, ...dueMeds].sort((x, y) => +new Date(x.at) - +new Date(y.at))[0] ?? null;

    // S8 reassessment prompt: deterioration signal after the last assessment.
    const detObs = obs.filter((o: any) => o.recorded_at && (o.escalation_triggered || (o.ews_score != null && o.ews_score >= 5)))
      .sort((x: any, y: any) => +new Date(y.recorded_at) - +new Date(x.recorded_at))[0] ?? null;
    const reassess = reassessmentDue({
      latestAcuityAt: acuityLatest?.assessed_at ?? null,
      latestObsEscalatedAt: detObs?.recorded_at ?? null,
      acuityLevel: p.acuity_level,
    });

    return {
      patient: p, assignment_type: a.assignment_type, cnci,
      pews: input.pewsLatest, trend: pewsTrend(input.pewsLatest, input.pewsPrev),
      workloadPct: input.workloadPct, acuityScore: input.acuityScore,
      nextDue, reassess,
    };
  }).sort((a, b) => b.cnci.score - a.cnci.score);

  // ── This-shift performance (actor-scoped real counts) ──
  const since = base.shift?.starts_at ?? new Date(now - 12 * 3.6e6).toISOString();
  const soft = (p: any) => p.then((r: any) => r, () => ({ count: 0, data: [] }));
  const cnt = (r: any) => (r?.error ? 0 : r?.count ?? 0);
  const [obsMine, medMine, taskMine, incMine, escMine] = await Promise.all([
    soft(admin.from("op_observations").select("id", { count: "exact", head: true }).eq("observer_id", userId).gte("recorded_at", since)),
    soft(admin.from("op_med_administrations").select("outcome, delay_minutes").eq("administered_by", userId).gte("administered_at", since).limit(200)),
    soft(admin.from("op_tasks").select("id", { count: "exact", head: true }).eq("completed_by", userId).gte("completed_at", since)),
    soft(admin.from("op_incidents").select("id", { count: "exact", head: true }).eq("reported_by", userId).gte("created_at", since)),
    soft(admin.from("op_escalations").select("id", { count: "exact", head: true }).eq("raised_by", userId).gte("created_at", since)),
  ]);
  const medEvents = (medMine.data ?? []) as any[];
  const administered = medEvents.filter(e => e.outcome === "administered");
  const performance = {
    obsRecorded: cnt(obsMine),
    medsAdministered: administered.length,
    medOnTimePct: administered.length ? Math.round((administered.filter(e => e.delay_minutes <= 15).length / administered.length) * 100) : null,
    tasksCompleted: cnt(taskMine),
    safetyEvents: cnt(incMine) + cnt(escMine),
  };

  // ── Today's timeline (real entries only) ──
  type TimelineEntry = { at: string; time: string; label: string; detail: string | null; kind: "shift" | "round" | "due" | "handover" };
  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const timeline: TimelineEntry[] = [];
  if (base.shift?.starts_at && base.shift?.ends_at) {
    const s = base.shift;
    timeline.push({ at: s.starts_at, time: fmtT(s.starts_at), label: "Shift start & briefing", detail: s.unit ?? s.department ?? null, kind: "shift" });
    // Ward round schedule (real config rows) mapped onto today.
    if (s.department_id) {
      const { data: rounds } = await admin.from("op_round_schedule").select("at_time, label")
        .eq("department_id", s.department_id).eq("shift_type", s.shift_type).order("sort").limit(20)
        .then((r: any) => r, () => ({ data: [] }));
      const day = s.shift_date;
      for (const r of (rounds ?? []) as any[]) {
        if (!r.at_time) continue;
        const at = `${day}T${r.at_time}:00`;
        timeline.push({ at, time: r.at_time, label: r.label ?? "Ward round", detail: null, kind: "round" });
      }
    }
    // Due clusters: my open obs/meds bucketed to the hour.
    const dueItems = [
      ...base.observations.filter((o: any) => ["due", "overdue"].includes(o.status) && o.due_at).map((o: any) => ({ at: o.due_at, what: "obs" })),
      ...meds.queue.filter((m: any) => m.scheduled_at).map((m: any) => ({ at: m.scheduled_at, what: "med" })),
    ];
    const byHour = new Map<string, { obs: number; med: number; at: string }>();
    for (const d of dueItems) {
      const h = new Date(d.at).toISOString().slice(0, 13);
      const cur = byHour.get(h) ?? { obs: 0, med: 0, at: d.at };
      if (d.what === "obs") cur.obs++; else cur.med++;
      if (+new Date(d.at) < +new Date(cur.at)) cur.at = d.at;
      byHour.set(h, cur);
    }
    for (const c of byHour.values()) {
      const parts = [c.med ? `${c.med} medication${c.med === 1 ? "" : "s"}` : null, c.obs ? `${c.obs} observation${c.obs === 1 ? "" : "s"}` : null].filter(Boolean);
      timeline.push({ at: c.at, time: fmtT(c.at), label: parts.join(" · "), detail: "due", kind: "due" });
    }
    // Handover preparation window (operational convention: final hour).
    const prep = new Date(+new Date(s.ends_at) - 60 * 60e3).toISOString();
    timeline.push({ at: prep, time: fmtT(prep), label: "Handover preparation", detail: "SBAR per patient", kind: "handover" });
    timeline.push({ at: s.ends_at, time: fmtT(s.ends_at), label: "Shift end", detail: null, kind: "shift" });
    timeline.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }

  // ── Deterministic shift briefing (S11 embedded intelligence, no LLM cost) ──
  const briefing: string[] = [];
  const deteriorating = rows.filter(r => r.trend === "up" || (r.pews != null && r.pews >= 5));
  if (deteriorating.length) briefing.push(`${deteriorating.length} patient${deteriorating.length === 1 ? " is" : "s are"} showing deterioration signals: ${deteriorating.slice(0, 3).map(r => r.patient.label).join(", ")}.`);
  const topCnci = rows[0];
  if (topCnci && topCnci.cnci.score >= 60) briefing.push(`${topCnci.patient.label} carries the highest care index (${topCnci.cnci.score} — ${topCnci.cnci.drivers.slice(0, 2).join(", ")}).`);
  const obsOverdue = base.observations.filter((o: any) => o.status === "overdue").length;
  if (obsOverdue) briefing.push(`${obsOverdue} observation${obsOverdue === 1 ? " is" : "s are"} overdue.`);
  if (meds.kpis.overdue) briefing.push(`${meds.kpis.overdue} medication${meds.kpis.overdue === 1 ? " is" : "s are"} overdue.`);
  else if (meds.kpis.dueNow) briefing.push(`${meds.kpis.dueNow} medication${meds.kpis.dueNow === 1 ? "" : "s"} due in the current window.`);
  const reassessDue = rows.filter(r => r.reassess.due);
  if (reassessDue.length) briefing.push(`Focused reassessment recommended for ${reassessDue.map(r => r.patient.label).join(", ")}.`);
  if (assess.aggregate.overloaded) briefing.push(`Your cumulative workload is ${assess.aggregate.total}% — over one nurse's capacity; rebalancing has been signalled.`);
  if (!briefing.length) briefing.push("No elevated signals across your assignment right now.");

  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return {
    ...base, ward, meds, assess, rows, performance, timeline, briefing, greeting,
    kpis: {
      patients: base.patients.length,
      highPriority: rows.filter(r => ["critical", "high"].includes(r.cnci.band)).length,
      medsDueSoon: meds.kpis.dueNow + meds.kpis.overdue,
      obsOverdue,
      safetyAlerts: base.safetyAlerts.length + base.escalations.length,
    },
  };
}
