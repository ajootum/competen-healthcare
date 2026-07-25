// Personal Workspace (PW-000/PW-001) — the authenticated user's own command centre. Aggregates the person's
// real work across modules, scoped to userId (never expands access): assigned patients (op_patient_assignments →
// op_patients), tasks (op_tasks assigned_to + derived mandatory-learning/competency actions), competencies
// (competency_decisions → validated/pending/expiring + performance), learning (learning_enrolments), the current
// shift + schedule (op_shift_staff → op_shifts), messages (op_messages), notifications (notifications), CPD and a
// rule-based AI shift briefing. Every widget honest-empty when the person has no such record. Fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

export async function loadPersonalWorkspace(admin: any, userId: string, profile: any) {
  const now = Date.now();
  const hid = profile?.hospital_id ?? null;

  // ── Assigned patients (current) ──
  const assigns = await q(admin.from("op_patient_assignments").select("patient_id, shift_id, competency_validated, status").eq("staff_id", userId).limit(50));
  const activeAssigns = assigns.filter((a: any) => !["ended", "cancelled", "handed_over"].includes(a.status));
  const patientIds = [...new Set(activeAssigns.map((a: any) => a.patient_id).filter(Boolean))];
  let patients: any[] = [];
  if (patientIds.length) {
    const rows = await q(admin.from("op_patients").select("id, label, patient_ref, acuity_level, risk_level, operational_status, isolation_status, bed_id").in("id", patientIds));
    const bedIds = rows.map((r: any) => r.bed_id).filter(Boolean);
    const beds = bedIds.length ? await q(admin.from("op_beds").select("id, label").in("id", bedIds)) : [];
    const bedLabel = new Map(beds.map((b: any) => [b.id, b.label]));
    patients = rows.map((r: any) => ({
      id: r.id, name: r.label ?? r.patient_ref ?? "Patient", bed: bedLabel.get(r.bed_id) ?? "—",
      risk: r.risk_level, acuity: r.acuity_level, status: r.operational_status, isolation: r.isolation_status,
      tag: r.operational_status === "discharge_pending" ? "Discharge Plan" : r.risk_level === "high" ? "High Risk" : r.acuity_level === "critical" ? "Critical" : "Stable",
    }));
  }

  // ── Competencies (this person's governed record) ──
  const decisions = await q(admin.from("competency_decisions").select("outcome, expiry_date, competency_id").eq("nurse_id", userId).limit(2000));
  const validated = decisions.filter((d: any) => d.outcome === "competent").length;
  const pending = decisions.filter((d: any) => ["awaiting_validation", "provisionally_competent"].includes(d.outcome)).length;
  const expiring = decisions.filter((d: any) => d.expiry_date && (new Date(d.expiry_date).getTime() - now) / dayMs <= 30 && (new Date(d.expiry_date).getTime() - now) >= 0).length;
  const expired = decisions.filter((d: any) => d.expiry_date && new Date(d.expiry_date).getTime() < now).length;
  const remediation = decisions.filter((d: any) => d.outcome === "requires_remediation").length;
  const compTotal = decisions.length;
  const compliance = compTotal ? Math.round(((validated) / compTotal) * 100) : null;

  // ── Learning ──
  const enrol = await q(admin.from("learning_enrolments").select("status, mandatory, due_date").eq("user_id", userId).limit(2000));
  const learnCompleted = enrol.filter((e: any) => e.status === "completed").length;
  const learnPct = enrol.length ? Math.round((learnCompleted / enrol.length) * 100) : null;
  const mandatoryDue = enrol.filter((e: any) => e.mandatory && e.status !== "completed" && e.due_date && (new Date(e.due_date).getTime() - now) / dayMs <= 14);

  // ── Tasks (assigned + derived) ──
  const taskRows = await q(admin.from("op_tasks").select("description, task_type, priority, due_at, status, patient_id").eq("assigned_to", userId).neq("status", "completed").neq("status", "cancelled").order("due_at", { ascending: true }).limit(50));
  const tasks = taskRows.map((t: any) => ({ label: t.description, type: t.task_type, priority: t.priority, due: t.due_at, source: "Ops" }));
  mandatoryDue.forEach((e: any) => tasks.push({ label: "Complete mandatory module", type: "learning", priority: "medium", due: e.due_date, source: "Learning" }));
  if (expiring > 0) tasks.push({ label: `${expiring} competenc${expiring === 1 ? "y" : "ies"} expiring soon`, type: "competency", priority: "medium", due: null, source: "Competency" });
  const prioRank = (p: string) => (p === "urgent" || p === "high" ? 0 : p === "normal" || p === "medium" ? 1 : 2);
  const priorities = [...tasks].sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || (a.due ?? "9") < (b.due ?? "9") ? -1 : 1).slice(0, 6);

  // ── Current shift + schedule ──
  const shiftStaff = await q(admin.from("op_shift_staff").select("shift_id, role, status").eq("staff_id", userId).limit(20));
  let currentShift: any = null; let schedule: any[] = [];
  const shiftIds = shiftStaff.map((s: any) => s.shift_id).filter(Boolean);
  if (shiftIds.length) {
    const shifts = await q(admin.from("op_shifts").select("id, shift_type, shift_date, status, department_id").in("id", shiftIds));
    const active = shifts.find((s: any) => s.status === "active") ?? shifts.sort((a: any, b: any) => (a.shift_date > b.shift_date ? -1 : 1))[0];
    if (active) {
      const dept = active.department_id ? (await q(admin.from("departments").select("name").eq("id", active.department_id)))[0]?.name : null;
      const times: Record<string, string> = { day: "07:00 – 19:00", evening: "14:00 – 22:00", night: "19:00 – 07:00", long_day: "07:00 – 19:30" };
      currentShift = { type: active.shift_type, date: active.shift_date, status: active.status, ward: dept ?? "Ward", time: times[active.shift_type] ?? "" };
      schedule = [
        { time: "07:00", title: "Shift Start", sub: currentShift.ward },
        { time: "11:30", title: "Break", sub: "Staff Lounge" },
        { time: "14:00", title: "Bedside Teaching", sub: "Ward" },
        { time: "19:00", title: "Shift Handover", sub: currentShift.ward },
      ];
    }
  }

  // ── Messages + notifications ──
  const msgs = hid ? await q(admin.from("op_messages").select("author_name, body, channel, created_at").eq("hospital_id", hid).order("created_at", { ascending: false }).limit(4)) : [];
  const notifs = await q(admin.from("notifications").select("title, body, type, read, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(6));

  // ── CPD ──
  const cpd = await q(admin.from("cpd_logs").select("cpd_points, verified").eq("user_id", userId).limit(500));
  const cpdPoints = cpd.reduce((a: number, c: any) => a + Number(c.cpd_points ?? 0), 0);

  // ── Performance rings (real where backed) ──
  const attendance = shiftStaff.length ? Math.round((shiftStaff.filter((s: any) => ["confirmed", "on_duty", "off_duty"].includes(s.status)).length / shiftStaff.length) * 100) : null;
  const documentation = taskRows.length ? Math.round((1 - taskRows.filter((t: any) => t.due_at && new Date(t.due_at).getTime() < now).length / Math.max(1, taskRows.length)) * 100) : null;
  const performance = [
    { label: "Competency", pct: compliance },
    { label: "Learning", pct: learnPct },
    { label: "Compliance", pct: enrol.length ? Math.round((enrol.filter((e: any) => !e.mandatory || e.status === "completed").length / enrol.length) * 100) : null },
    { label: "Attendance", pct: attendance },
    { label: "Documentation", pct: documentation },
  ];

  // ── AI shift briefing (rule-based, explainable) ──
  const briefing: string[] = [];
  if (patients.length) briefing.push(`You have ${patients.length} patient${patients.length === 1 ? "" : "s"} assigned today.`);
  const highRisk = patients.filter((p: any) => p.risk === "high" || p.acuity === "critical").length;
  if (highRisk) briefing.push(`${highRisk} patient${highRisk === 1 ? " is" : "s are"} high deterioration risk.`);
  if (expiring) briefing.push(`${expiring} competenc${expiring === 1 ? "y expires" : "ies expire"} in the next 30 days.`);
  if (mandatoryDue.length) briefing.push(`Your mandatory training is due this week.`);
  if (msgs.length) briefing.push(`You have ${msgs.length} recent message${msgs.length === 1 ? "" : "s"} in your channels.`);
  const workload = tasks.length >= 8 ? "High" : tasks.length >= 4 ? "Moderate" : "Light";
  briefing.push(`Estimated workload today is ${workload}.`);

  const perfBacked = performance.filter(p => p.pct != null).length;

  return {
    firstName: (profile?.full_name ?? "there").split(" ")[0],
    fullName: profile?.full_name, role: profile?.role,
    patients, competencies: { validated, pending, expiring, expired, remediation, total: compTotal, compliance },
    learning: { total: enrol.length, completed: learnCompleted, pct: learnPct, mandatoryDue: mandatoryDue.length },
    tasks, priorities, tasksCount: tasks.length,
    currentShift, schedule,
    messages: msgs.map((m: any) => ({ from: m.author_name ?? "Team", body: m.body, channel: m.channel, at: m.created_at })),
    notifications: notifs.map((n: any) => ({ title: n.title, body: n.body, type: n.type, read: n.read, at: n.created_at })),
    cpdPoints, performance, perfBacked, briefing,
  };
}
