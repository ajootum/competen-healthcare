// PW-003 Calendar & Schedule Centre — a unified, user-scoped calendar aggregating the person's REAL cross-module
// activities into one timeline: shifts (op_shift_staff → op_shifts, with real starts_at/ends_at), task deadlines
// (op_tasks.due_at), learning due (learning_enrolments), competency renewals (competency_decisions.expiry_date).
// Each normalised to an event {category, title, start, end, allDay, color, href}. Derives the day schedule,
// the next-7-days list, month markers, summary counts and on-call status. Read-only aggregation.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

export const EVENT_CAT: Record<string, { label: string; color: string }> = {
  shift: { label: "My Shifts", color: "#6366f1" },
  oncall: { label: "On-call", color: "#f43f5e" },
  task: { label: "Tasks & Deadlines", color: "#f59e0b" },
  learning: { label: "Learning & Education", color: "#8b5cf6" },
  competency: { label: "Assessments", color: "#10b981" },
};
const SHIFT_TIMES: Record<string, [number, number]> = { day: [7, 19], evening: [14, 22], night: [19, 31], long_day: [7, 19.5], on_call: [0, 24] };
const SHIFT_LABEL: Record<string, string> = { day: "Day Shift", evening: "Evening Shift", night: "Night Shift", long_day: "Long Day", on_call: "On Call" };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function loadCalendar(admin: any, userId: string, profile: any, anchorISO: string) {
  const now = Date.now();
  const anchor = new Date(anchorISO + "T00:00:00");
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const winStart = ymd(new Date(monthStart.getTime() - 7 * dayMs));
  const winEnd = ymd(new Date(monthEnd.getTime() + 8 * dayMs));
  const events: any[] = [];

  // ── Shifts ──
  const ss = await q(admin.from("op_shift_staff").select("shift_id").eq("staff_id", userId).limit(400));
  const shiftIds = [...new Set(ss.map((s: any) => s.shift_id).filter(Boolean))];
  if (shiftIds.length) {
    const shifts = await q(admin.from("op_shifts").select("id, shift_type, shift_date, starts_at, ends_at, status, department_id").in("id", shiftIds).gte("shift_date", winStart).lte("shift_date", winEnd));
    const deptIds = [...new Set(shifts.map((s: any) => s.department_id).filter(Boolean))];
    const dept = new Map<string, string>();
    if (deptIds.length) (await q(admin.from("departments").select("id, name").in("id", deptIds))).forEach((d: any) => dept.set(d.id, d.name));
    for (const s of shifts) {
      const onCall = s.shift_type === "on_call";
      const [sh, eh] = SHIFT_TIMES[s.shift_type] ?? [7, 19];
      const start = s.starts_at ? new Date(s.starts_at) : new Date(`${s.shift_date}T${String(Math.floor(sh)).padStart(2, "0")}:00:00`);
      const end = s.ends_at ? new Date(s.ends_at) : new Date(start.getTime() + (eh - sh) * 3600000);
      events.push({ id: `sh-${s.id}`, category: onCall ? "oncall" : "shift", title: `${SHIFT_LABEL[s.shift_type] ?? "Shift"}${dept.get(s.department_id) ? ` · ${dept.get(s.department_id)}` : ""}`, subtitle: dept.get(s.department_id) ?? "Ward", date: s.shift_date, start, end, allDay: false, status: s.status, href: "/dashboard/shift" });
    }
  }

  // ── Tasks (deadlines) ──
  const tasks = await q(admin.from("op_tasks").select("id, description, due_at, priority, status, patient_id").eq("assigned_to", userId).not("status", "in", "(completed,cancelled)").not("due_at", "is", null).gte("due_at", winStart).lte("due_at", winEnd + "T23:59:59").limit(200));
  for (const t of tasks) {
    const start = new Date(t.due_at);
    events.push({ id: `t-${t.id}`, category: "task", title: t.description, subtitle: "Task deadline", date: ymd(start), start, end: new Date(start.getTime() + 1800000), allDay: false, overdue: start.getTime() < now, href: "/dashboard/tasks" });
  }

  // ── Learning due ──
  const enrol = await q(admin.from("learning_enrolments").select("id, course_id, due_date, status").eq("user_id", userId).not("status", "in", "(completed,exempt)").not("due_date", "is", null).gte("due_date", winStart).lte("due_date", winEnd).limit(100));
  const cids = [...new Set(enrol.map((e: any) => e.course_id).filter(Boolean))];
  const ct = new Map<string, string>();
  if (cids.length) (await q(admin.from("learning_courses").select("id, title").in("id", cids))).forEach((c: any) => ct.set(c.id, c.title));
  for (const e of enrol) events.push({ id: `l-${e.id}`, category: "learning", title: ct.get(e.course_id) ?? "Learning due", subtitle: "Mandatory learning", date: e.due_date, start: new Date(e.due_date + "T00:00:00"), allDay: true, href: "/dashboard/learning" });

  // ── Competency renewals ──
  const dec = await q(admin.from("competency_decisions").select("id, competency_id, expiry_date").eq("nurse_id", userId).not("expiry_date", "is", null).gte("expiry_date", winStart).lte("expiry_date", winEnd).limit(60));
  const compIds = [...new Set(dec.map((d: any) => d.competency_id).filter(Boolean))];
  const cn = new Map<string, string>();
  if (compIds.length) (await q(admin.from("framework_competencies").select("id, name").in("id", compIds))).forEach((c: any) => cn.set(c.id, c.name));
  for (const d of dec) events.push({ id: `c-${d.id}`, category: "competency", title: `Renew: ${cn.get(d.competency_id) ?? "competency"}`, subtitle: "Competency expiry", date: d.expiry_date, start: new Date(d.expiry_date + "T00:00:00"), allDay: true, href: "/dashboard/passport" });

  events.forEach(e => { e.color = EVENT_CAT[e.category].color; });

  // ── Day schedule (anchor date) ──
  const anchorYmd = ymd(anchor);
  const dayEvents = events.filter(e => e.date === anchorYmd).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const dayTimed = dayEvents.filter(e => !e.allDay);
  const dayAllDay = dayEvents.filter(e => e.allDay);

  // ── Upcoming (next 7 days from today) ──
  const upcoming = events.filter(e => { const t = new Date(e.start).getTime(); return t >= now && t <= now + 7 * dayMs; }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()).slice(0, 8);

  // ── Month markers (which days have events, by count) ──
  const monthMarks = new Map<string, number>();
  events.forEach(e => { const d = new Date(e.start); if (d.getMonth() === anchor.getMonth() && d.getFullYear() === anchor.getFullYear()) monthMarks.set(ymd(d), (monthMarks.get(ymd(d)) ?? 0) + 1); });

  // ── Summary counts ──
  const currentShift = events.find(e => (e.category === "shift" || e.category === "oncall") && e.date === ymd(new Date()));
  const summary = {
    eventsToday: events.filter(e => e.date === ymd(new Date())).length,
    tasksDue: events.filter(e => e.category === "task").length,
    learning: events.filter(e => e.category === "learning").length,
    meetings: 0,
    currentShift: currentShift ? { title: currentShift.title, start: currentShift.start, end: currentShift.end } : null,
  };

  // ── My Tasks on Calendar (counts) ──
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const taskEvents = events.filter(e => e.category === "task");
  const taskCounts = {
    overdue: taskEvents.filter(e => new Date(e.start).getTime() < now).length,
    today: taskEvents.filter(e => new Date(e.start).getTime() >= startToday.getTime() && new Date(e.start).getTime() < startToday.getTime() + dayMs).length,
    week: taskEvents.filter(e => new Date(e.start).getTime() >= now && new Date(e.start).getTime() <= now + 7 * dayMs).length,
  };

  // ── On-call status ──
  const nextOnCall = events.filter(e => e.category === "oncall" && new Date(e.start).getTime() >= startToday.getTime()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0] ?? null;

  return { events, dayTimed, dayAllDay, upcoming, monthMarks, summary, taskCounts, nextOnCall, anchor, anchorYmd };
}
