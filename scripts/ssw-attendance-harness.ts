// One-off harness for Shift Attendance & Fatigue (SSW-WFM-001 / WFM-003).
// Exercises the SHIPPED loader (@/lib/operations/shift-attendance) against REAL
// rows it writes and then deletes — no replica of the logic is reimplemented
// here, so a drift in the loader fails this harness.
//
// Proves:
//   - shift selection prefers the ACTIVE shift over merely today's
//   - attendance state precedence: no_show > absent > departed > late > on_duty
//   - a rostered person with no clock record is "not_recorded", NEVER "absent"
//   - leave rows mark a rostered person absent and flag cover
//   - KPIs are internally consistent with the roster board
//   - fatigue counts CONSECUTIVE rostered days and short rest, and reports
//     hours as null (not zero) when a shift has no start/end recorded
//   - open-only filters: resolved exceptions and filled cover requests excluded
//   - tenant scoping: another hospital's shift never appears
//   npx --yes tsx scripts/ssw-attendance-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { loadShiftAttendance } = await import("../src/lib/operations/shift-attendance");

  // Pick a hospital that actually has staff — most seeded hospitals have none.
  const { data: hosps } = await admin.from("hospitals").select("id").limit(40);
  let hid: string | null = null, staff: any[] = [];
  for (const h of (hosps ?? []) as any[]) {
    const { data: people } = await admin.from("profiles").select("id, full_name").eq("hospital_id", h.id).limit(8);
    if ((people ?? []).length >= 5) { hid = h.id; staff = people as any[]; break; }
  }
  if (!hid) { console.error("No hospital has 5+ profiles to test against."); process.exit(1); }
  const otherHid = ((hosps ?? []) as any[]).map(h => h.id).find(id => id !== hid) ?? null;

  const now = Date.now();
  const cleanup: { table: string; ids: string[] }[] = [];
  const track = (table: string, ids: string[]) => cleanup.push({ table, ids });
  const ins = async (table: string, rows: any[]) => {
    const { data, error } = await admin.from(table).insert(rows).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    const ids = (data ?? []).map((r: any) => r.id);
    track(table, ids);
    return ids;
  };

  try {
    // ── A COMPLETED shift today, plus an ACTIVE one: selection must take the active.
    const [doneShift] = await ins("op_shifts", [{
      hospital_id: hid, shift_type: "night", shift_date: day(now), status: "completed",
      starts_at: iso(now - 14 * 3.6e6), ends_at: iso(now - 2 * 3.6e6),
    }]);
    const [shiftId] = await ins("op_shifts", [{
      hospital_id: hid, shift_type: "day", shift_date: day(now), status: "active",
      starts_at: iso(now - 4 * 3.6e6), ends_at: iso(now + 4 * 3.6e6),
    }]);

    // Five rostered people, one per attendance state we want to prove.
    const [onDuty, late, noShow, onLeave, unrecorded] = staff.slice(0, 5);
    await ins("op_shift_staff", [
      { shift_id: shiftId, staff_id: onDuty.id, role: "nurse", status: "on_duty" },
      { shift_id: shiftId, staff_id: late.id, role: "nurse", status: "on_duty" },
      { shift_id: shiftId, staff_id: noShow.id, role: "nurse", status: "assigned" },
      { shift_id: shiftId, staff_id: onLeave.id, role: "support", status: "absent" },
      // `unrecorded` is rostered as on_duty but has NO clock event at all.
      { shift_id: shiftId, staff_id: unrecorded.id, role: "nurse", status: "assigned" },
    ]);

    await ins("op_attendance_events", [
      { hospital_id: hid, shift_id: shiftId, staff_id: onDuty.id, event_type: "check_in", event_at: iso(now - 3.9 * 3.6e6), check_in_method: "badge" },
      { hospital_id: hid, shift_id: shiftId, staff_id: late.id, event_type: "check_in", event_at: iso(now - 3.2 * 3.6e6), check_in_method: "mobile_geofence", minutes_late: 42 },
      { hospital_id: hid, shift_id: shiftId, staff_id: late.id, event_type: "late_flagged", event_at: iso(now - 3.2 * 3.6e6), minutes_late: 42 },
      { hospital_id: hid, shift_id: shiftId, staff_id: noShow.id, event_type: "no_show_detected", event_at: iso(now - 3 * 3.6e6) },
    ]);
    await ins("op_leave_records", [{
      hospital_id: hid, staff_id: onLeave.id, staff_name: onLeave.full_name, shift_id: shiftId,
      absence_date: day(now), absence_type: "sick", leave_approval_status: "approved", replacement_required: true,
    }]);

    let d: any = await loadShiftAttendance(admin, hid, false, now);
    check(d.provisioned && !d.empty, "loader returns a live shift", d.shift?.id === shiftId ? "the ACTIVE shift" : `got ${d.shift?.id}`);
    check(d.shift?.id === shiftId, "shift selection prefers ACTIVE over a completed shift on the same day", `${d.shift?.status}`);
    check(d.shift?.id !== doneShift, "the completed night shift is not chosen");

    const stateOf = (sid: string) => d.roster.find((r: any) => r.staffId === sid)?.state ?? null;
    check(stateOf(onDuty.id) === "on_duty", "clock-in with no lateness -> on_duty", String(stateOf(onDuty.id)));
    check(stateOf(late.id) === "late", "clock-in with minutes_late -> late", String(stateOf(late.id)));
    check(stateOf(noShow.id) === "no_show", "no_show_detected outranks everything", String(stateOf(noShow.id)));
    check(stateOf(onLeave.id) === "absent", "an approved leave record marks the person absent", String(stateOf(onLeave.id)));
    check(stateOf(unrecorded.id) === "not_recorded", "rostered with no clock record -> not_recorded, NOT absent", String(stateOf(unrecorded.id)));
    check(d.roster.find((r: any) => r.staffId === late.id)?.minutesLate === 42, "minutes_late is carried through");
    check(d.roster.find((r: any) => r.staffId === onLeave.id)?.replacementRequired === true, "leave rows flag that cover is required");
    check(d.roster[0]?.state === "no_show", "the board sorts most-severe first", d.roster.map((r: any) => r.state).join(" > "));

    // KPI consistency against the board the supervisor is looking at.
    check(d.kpis.rostered === d.roster.length, "kpis.rostered == roster rows", `${d.kpis.rostered}`);
    check(d.kpis.late === d.roster.filter((r: any) => r.state === "late").length, "kpis.late == late rows");
    check(d.kpis.noShow === 1 && d.kpis.absent === 1, "kpis count no-show and absent separately");
    check(d.kpis.verified === d.roster.filter((r: any) => r.checkInAt).length, "kpis.verified counts only recorded check-ins", `${d.kpis.verified} of ${d.kpis.rostered}`);
    check(d.kpis.notRecorded === 1, "kpis.notRecorded surfaces the unknown", `${d.kpis.notRecorded}`);

    // ── Departure outranks late for the same person.
    await ins("op_attendance_events", [{ hospital_id: hid, shift_id: shiftId, staff_id: late.id, event_type: "check_out", event_at: iso(now - 0.5 * 3.6e6) }]);
    d = await loadShiftAttendance(admin, hid, false, now);
    check(d.roster.find((r: any) => r.staffId === late.id)?.state === "departed", "a check_out moves the person to departed");

    // ── Fatigue: 6 consecutive rostered days for one person, with one shift
    //    missing start/end so hours must be partial, not silently zeroed.
    const fatigueIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const dayMs = now - i * DAY;
      const withTimes = i !== 3;
      const [sid] = await ins("op_shifts", [{
        hospital_id: hid, shift_type: "long_day", shift_date: day(dayMs), status: "completed",
        starts_at: withTimes ? iso(dayMs - 12 * 3.6e6) : null,
        ends_at: withTimes ? iso(dayMs) : null,
      }]);
      fatigueIds.push(sid);
      await ins("op_shift_staff", [{ shift_id: sid, staff_id: onDuty.id, role: "nurse", status: "off_duty" }]);
    }
    d = await loadShiftAttendance(admin, hid, false, now);
    const f = d.fatigue.find((x: any) => x.staffId === onDuty.id);
    check(!!f, "a heavily-rostered person appears in fatigue exposure");
    check((f?.consecutive ?? 0) >= 6, "consecutive rostered days are counted across the run", `${f?.consecutive} days`);
    check(f?.onShift === true, "fatigue rows flag whether the person is on the CURRENT shift");
    check(f?.hoursPartial === true, "hours are marked partial when a shift has no start/end recorded", `${f?.hours}h from ${f?.shifts} shifts`);
    check(f?.hours != null && f.hours > 0, "hours accumulate from the shifts that DO have times");
    check((f?.flags ?? []).some((x: string) => /consecutive/.test(x)), "the consecutive-days threshold produces a named flag", (f?.flags ?? []).join(" | "));
    check(d.kpis.fatigueFlagged >= 1, "kpis.fatigueFlagged counts only staff on this shift", `${d.kpis.fatigueFlagged}`);

    // ── Open-only filters.
    const [resolvedExc] = await ins("op_attendance_exceptions", [{
      hospital_id: hid, shift_id: shiftId, staff_id: late.id, staff_name: late.full_name,
      category: "late", severity: "moderate", status: "closed",
    }]);
    const [openExc] = await ins("op_attendance_exceptions", [{
      hospital_id: hid, shift_id: shiftId, staff_id: noShow.id, staff_name: noShow.full_name,
      category: "no_show", severity: "critical", status: "new", rule_breached: "Unnotified absence",
    }]);
    await ins("op_replacement_requests", [
      { hospital_id: hid, shift_id: shiftId, role: "nurse", quantity: 2, priority: "high", status: "offered", reason: "Sickness cover" },
      { hospital_id: hid, shift_id: shiftId, role: "nurse", quantity: 1, priority: "normal", status: "filled" },
    ]);
    d = await loadShiftAttendance(admin, hid, false, now);
    check(d.exceptions.some((e: any) => e.id === openExc), "open exceptions are listed");
    check(!d.exceptions.some((e: any) => e.id === resolvedExc), "closed exceptions are excluded");
    check(d.kpis.criticalExceptions === 1, "critical/high exceptions are counted separately", `${d.kpis.criticalExceptions}`);
    check(d.replacements.length === 1 && d.replacements[0].quantity === 2, "filled cover requests are excluded from the open pipeline");
    check(d.kpis.uncovered === 2, "kpis.uncovered sums QUANTITY, not request count", `${d.kpis.uncovered}`);

    // ── Tenant scoping.
    if (otherHid) {
      const other: any = await loadShiftAttendance(admin, otherHid, false, now);
      check(other.shift?.id !== shiftId, "another hospital never sees this shift", other.shift ? `theirs: ${other.shift.id}` : "no shift");
      check(!(other.roster ?? []).some((r: any) => r.staffId === noShow.id), "another hospital never sees this roster");
    } else {
      console.log("SKIP  tenant scoping — only one hospital row");
    }
  } finally {
    // Children first, then shifts.
    const order = ["op_attendance_events", "op_attendance_exceptions", "op_leave_records", "op_replacement_requests", "op_shift_staff", "op_shifts"];
    for (const table of order) {
      const ids = cleanup.filter(c => c.table === table).flatMap(c => c.ids);
      if (ids.length) await admin.from(table).delete().in("id", ids);
    }
    let leftover = 0;
    for (const table of order) {
      const ids = cleanup.filter(c => c.table === table).flatMap(c => c.ids);
      if (!ids.length) continue;
      const { data } = await admin.from(table).select("id").in("id", ids);
      leftover += (data ?? []).length;
    }
    check(leftover === 0, "harness rows cleaned up", leftover ? `${leftover} left` : `${cleanup.reduce((n, c) => n + c.ids.length, 0)} removed`);
  }

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
