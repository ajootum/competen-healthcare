// Shift Attendance & Fatigue (SSW-WFM-001 / WFM-003) — the SUPERVISOR lens over
// the attendance machinery.
//
// op_attendance_events, op_attendance_exceptions, op_leave_records,
// op_replacement_requests and op_roster_actuals are all live and fully surfaced
// in the Unit Manager Workspace — but as a MONTHLY/managerial view. Nothing read
// them shift-scoped, which is the only view a supervisor can act on: who is due
// on this shift, who actually clocked in, who is late, who is uncovered right
// now. This closes that gap without any new store.
//
// (It also retires a stale honesty note on /supervisor/workforce-operations that
// claimed shift clocking, late arrivals and absence reasons "need dedicated
// stores" — those stores shipped; the SSW simply had not read them.)
//
// Everything is measured from records. Fatigue is computed from ROSTERED shifts
// in the trailing 7 days, and is labelled as exposure, not as a clinical
// judgement of any individual.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

// Consecutive-day and hour thresholds mirror the roster-governance rules already
// used in the UMW (excess_hours / insufficient_rest exception categories).
const FATIGUE = { consecutiveDays: 5, weekHours: 48, restHours: 11 };

export async function loadShiftAttendance(admin: any, hid: string | null, isSuper: boolean, now = Date.now()) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: true }));

  const probe = await admin.from("op_attendance_events").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  const today = new Date(now).toISOString().slice(0, 10);
  const weekAgo = new Date(now - 7 * DAY).toISOString();

  // The shift the supervisor is running: the active one, else today's latest.
  const { data: shiftRows } = await soft(scope(admin.from("op_shifts")
    .select("id, shift_type, shift_date, starts_at, ends_at, status, unit_id, department_id, units!unit_id(name), departments!department_id(name)")
    .gte("shift_date", new Date(now - 7 * DAY).toISOString().slice(0, 10))
    .order("shift_date", { ascending: false }).limit(40)));
  const shifts = (shiftRows ?? []) as any[];
  const shift = shifts.find(s => s.status === "active")
    ?? shifts.find(s => s.shift_date === today)
    ?? shifts[0] ?? null;

  if (!shift) {
    return { provisioned: true as const, empty: true as const, shift: null, roster: [], kpis: null, exceptions: [], leave: [], replacements: [], fatigue: [], variance: null };
  }

  const [staffRes, evtRes, excRes, leaveRes, replRes, weekStaffRes, actualRes] = await Promise.all([
    soft(admin.from("op_shift_staff").select("id, staff_id, role, status, profiles!staff_id(id, full_name)").eq("shift_id", shift.id).limit(200)),
    soft(scope(admin.from("op_attendance_events")
      .select("id, shift_id, staff_id, staff_name, event_type, event_at, minutes_late, check_in_method, reason")
      .gte("event_at", weekAgo).order("event_at", { ascending: false }).limit(1000))),
    soft(scope(admin.from("op_attendance_exceptions")
      .select("id, shift_id, staff_id, staff_name, category, severity, status, detected_at, rule_breached, operational_impact, due_at")
      .not("status", "in", "(corrected,approved_exception,rejected,closed)").limit(200))),
    soft(scope(admin.from("op_leave_records")
      .select("id, staff_id, staff_name, shift_id, absence_date, absence_type, leave_approval_status, replacement_required, expected_return, operational_impact")
      .gte("absence_date", new Date(now - 2 * DAY).toISOString().slice(0, 10)).limit(200))),
    soft(scope(admin.from("op_replacement_requests")
      .select("id, shift_id, role, quantity, reason, priority, status, selected_staff_name, offer_expires_at, is_redeployment, requested_by_name, created_at")
      .not("status", "in", "(filled,redeployed,cancelled)").limit(100))),
    // Rostered shifts across the week, for consecutive-day / hours exposure.
    soft(admin.from("op_shift_staff").select("staff_id, shift_id, status, op_shifts!shift_id(shift_date, starts_at, ends_at, shift_type, hospital_id)")
      .limit(2000)),
    soft(scope(admin.from("op_roster_actuals")
      .select("staff_id, staff_name, shift_date, attendance_status, actual_hours, variance_reason")
      .gte("shift_date", new Date(now - 7 * DAY).toISOString().slice(0, 10)).limit(500))),
  ]);

  const staff = (staffRes.data ?? []) as any[];
  const events = (evtRes.data ?? []) as any[];
  const exceptions = (excRes.data ?? []) as any[];
  const leave = (leaveRes.data ?? []) as any[];
  const replacements = (replRes.data ?? []) as any[];
  const actuals = (actualRes.data ?? []) as any[];

  // ── Roster board: expected staff vs what the attendance record says ──
  const shiftEvents = events.filter(e => e.shift_id === shift.id);
  const latestFor = (sid: string, types: string[]) =>
    shiftEvents.find(e => e.staff_id === sid && types.includes(e.event_type)) ?? null;

  const roster = staff.map(s => {
    const checkIn = latestFor(s.staff_id, ["check_in"]);
    const checkOut = latestFor(s.staff_id, ["check_out", "early_departure"]);
    const lateEvt = latestFor(s.staff_id, ["late_flagged"]);
    const noShow = latestFor(s.staff_id, ["no_show_detected"]);
    const absent = latestFor(s.staff_id, ["absence_reported"]);
    const onLeave = leave.find(l => l.staff_id === s.staff_id && (l.shift_id === shift.id || l.absence_date === shift.shift_date));
    const minutesLate = lateEvt?.minutes_late ?? checkIn?.minutes_late ?? null;
    // Attendance state, most severe first — an explicit "not recorded" rather
    // than assuming a silent roster row means the person turned up.
    const state = noShow ? "no_show"
      : (absent || onLeave) ? "absent"
      : checkOut ? "departed"
      : checkIn ? (minutesLate && minutesLate > 0 ? "late" : "on_duty")
      : s.status === "on_duty" ? "on_duty_unverified"
      : "not_recorded";
    return {
      id: s.id, staffId: s.staff_id, name: s.profiles?.full_name ?? "Staff",
      role: s.role, rosterStatus: s.status, state,
      checkInAt: checkIn?.event_at ?? null, checkInMethod: checkIn?.check_in_method ?? null,
      checkOutAt: checkOut?.event_at ?? null, minutesLate,
      absenceType: onLeave?.absence_type ?? (absent ? "reported" : null),
      replacementRequired: !!onLeave?.replacement_required,
      exceptions: exceptions.filter(x => x.staff_id === s.staff_id).length,
    };
  }).sort((a, b) => {
    const rank = (r: any) => ["no_show", "absent", "late", "not_recorded", "on_duty_unverified", "on_duty", "departed"].indexOf(r.state);
    return rank(a) - rank(b);
  });

  const count = (st: string) => roster.filter(r => r.state === st).length;
  const present = roster.filter(r => ["on_duty", "late", "departed"].includes(r.state)).length;
  const verified = roster.filter(r => r.checkInAt).length;

  // ── Fatigue exposure from ROSTERED shifts in the trailing 7 days ──
  const weekRows = ((weekStaffRes.data ?? []) as any[])
    .filter(r => r.op_shifts && (isSuper || r.op_shifts.hospital_id === hid))
    .filter(r => {
      const d = r.op_shifts.shift_date;
      return d && d >= new Date(now - 7 * DAY).toISOString().slice(0, 10) && d <= today;
    });
  const hoursOf = (s: any) => {
    if (s.starts_at && s.ends_at) {
      const h = (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3.6e6;
      if (h > 0 && h <= 24) return Math.round(h * 10) / 10;
    }
    return null;   // unrecorded start/end -> counted as a shift, not as hours
  };
  const fatigueMap = new Map<string, any>();
  for (const r of weekRows) {
    const f = fatigueMap.get(r.staff_id) ?? { staffId: r.staff_id, dates: new Set<string>(), hours: 0, hoursKnown: 0, shifts: 0, nights: 0, ends: [] as string[], starts: [] as string[] };
    f.dates.add(r.op_shifts.shift_date);
    f.shifts++;
    const h = hoursOf(r.op_shifts);
    if (h != null) { f.hours += h; f.hoursKnown++; }
    if (r.op_shifts.shift_type === "night") f.nights++;
    if (r.op_shifts.ends_at) f.ends.push(r.op_shifts.ends_at);
    if (r.op_shifts.starts_at) f.starts.push(r.op_shifts.starts_at);
    fatigueMap.set(r.staff_id, f);
  }
  const nameOf = (sid: string) =>
    staff.find(s => s.staff_id === sid)?.profiles?.full_name
    ?? events.find(e => e.staff_id === sid)?.staff_name
    ?? actuals.find(a => a.staff_id === sid)?.staff_name ?? "Staff";

  // Longest run of consecutive rostered days.
  const consecutive = (dates: Set<string>) => {
    const sorted = [...dates].sort();
    let best = 0, run = 0, prev: number | null = null;
    for (const d of sorted) {
      const t = new Date(`${d}T00:00:00Z`).getTime();
      run = prev != null && t - prev === DAY ? run + 1 : 1;
      prev = t; best = Math.max(best, run);
    }
    return best;
  };
  // Shortest gap between a shift ending and the next starting.
  const shortestRest = (f: any) => {
    const ends = f.ends.map((e: string) => new Date(e).getTime()).sort((a: number, b: number) => a - b);
    const starts = f.starts.map((s: string) => new Date(s).getTime()).sort((a: number, b: number) => a - b);
    let min: number | null = null;
    for (const e of ends) {
      const next = starts.find((s: number) => s > e);
      if (next == null) continue;
      const gap = (next - e) / 3.6e6;
      if (min == null || gap < min) min = gap;
    }
    return min == null ? null : Math.round(min * 10) / 10;
  };
  const onShift = new Set(staff.map(s => s.staff_id));
  const fatigue = [...fatigueMap.values()].map(f => {
    const days = consecutive(f.dates);
    const hours = Math.round(f.hours * 10) / 10;
    const rest = shortestRest(f);
    const flags: string[] = [];
    if (days >= FATIGUE.consecutiveDays) flags.push(`${days} consecutive days rostered`);
    if (f.hoursKnown && hours >= FATIGUE.weekHours) flags.push(`${hours}h rostered in 7 days`);
    if (rest != null && rest < FATIGUE.restHours) flags.push(`${rest}h between shifts`);
    if (f.nights >= 4) flags.push(`${f.nights} night shifts`);
    return {
      staffId: f.staffId, name: nameOf(f.staffId), onShift: onShift.has(f.staffId),
      shifts: f.shifts, days: f.dates.size, consecutive: days, nights: f.nights,
      hours: f.hoursKnown ? hours : null,
      hoursPartial: f.hoursKnown < f.shifts,   // some shifts had no start/end recorded
      rest, flags,
    };
  }).filter(f => f.flags.length > 0).sort((a, b) => b.flags.length - a.flags.length || b.consecutive - a.consecutive);

  // ── Planned vs actual variance for the week (roster governance record) ──
  const attended = actuals.filter(a => a.attendance_status === "attended").length;
  const variance = actuals.length ? {
    total: actuals.length, attended,
    adherence: Math.round((attended / actuals.length) * 100),
    byStatus: [...new Set(actuals.map(a => a.attendance_status))]
      .map(s => ({ status: s as string, n: actuals.filter(a => a.attendance_status === s).length }))
      .filter(s => s.status !== "attended").sort((a, b) => b.n - a.n),
  } : null;

  const uncovered = replacements.filter(r => ["identified", "candidates_generated", "offered", "escalated"].includes(r.status));

  return {
    provisioned: true as const, empty: false as const,
    shift: {
      id: shift.id, type: shift.shift_type, date: shift.shift_date, status: shift.status,
      startsAt: shift.starts_at, endsAt: shift.ends_at,
      unit: shift.units?.name ?? shift.departments?.name ?? null,
    },
    roster,
    kpis: {
      rostered: roster.length, present, verified,
      verification: roster.length ? Math.round((verified / roster.length) * 100) : 0,
      late: count("late"), absent: count("absent"), noShow: count("no_show"),
      notRecorded: count("not_recorded") + count("on_duty_unverified"),
      openExceptions: exceptions.length,
      criticalExceptions: exceptions.filter(e => ["critical", "high"].includes(e.severity)).length,
      uncovered: uncovered.reduce((n, r) => n + (r.quantity ?? 1), 0),
      fatigueFlagged: fatigue.filter(f => f.onShift).length,
    },
    exceptions: exceptions.sort((a, b) =>
      ["critical", "high", "moderate", "low", "informational"].indexOf(a.severity) -
      ["critical", "high", "moderate", "low", "informational"].indexOf(b.severity)).slice(0, 20),
    leave, replacements: uncovered, fatigue, variance,
    thresholds: FATIGUE,
  };
}
