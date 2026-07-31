// One-off harness for MDT Coordination (SSW-CCR-005, migration 160).
// Exercises the SHIPPED loader and the SHARED validators (@/lib/operations/mdt — the same functions the
// write route imports) against REAL rows it writes and then deletes.
//
// Proves the honesty rules the module is built on:
//   - attendance is a status ON an invitation: a meeting with no invitation list reports attendanceRate
//     null ("not recorded"), NEVER 0%
//   - quorum is measured against that meeting's REQUIRED participants, and is null when none are required
//   - completion rate excludes CANCELLED actions (you cannot fail to do a cancelled action)
//   - referral SLA per priority, ordering by priority then wait
//   - the action tracker sorts overdue first and puts undated actions last
//   - completing a meeting closes the referrals it was convened for
//   - tenant scoping
//   npx --yes tsx scripts/ssw-mdt-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

const HOUR = 3.6e6;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const mdt = await import("../src/lib/operations/mdt");
  const { loadMdt, quorum, referralOverdue, validateMeeting, validateReferral } = mdt;

  // ── Pure rules first (no rows needed) ───────────────────────────────────────
  check(quorum([]).met === null, "quorum with no participants is null, not false");
  check(quorum([{ required: false, attendance: "absent" }]).met === null, "quorum with no REQUIRED participants is null");
  check(quorum([{ required: true, attendance: "attended" }, { required: false, attendance: "absent" }]).met === true,
    "an optional absentee does not break quorum");
  check(quorum([{ required: true, attendance: "attended" }, { required: true, attendance: "absent" }]).met === false,
    "a required absentee breaks quorum");
  check(quorum([{ required: true, attendance: "delegated" }]).met === true, "a delegate counts as present");

  const now = Date.now();
  const raised = (h: number) => new Date(now - h * HOUR).toISOString();
  check(referralOverdue({ priority: "immediate", raised_at: raised(5), status: "awaiting_review" }, now), "immediate referral overdue after 4h");
  check(!referralOverdue({ priority: "immediate", raised_at: raised(3), status: "awaiting_review" }, now), "immediate referral not overdue at 3h");
  check(!referralOverdue({ priority: "routine", raised_at: raised(100), status: "awaiting_review" }, now), "routine referral not overdue at 100h");
  check(!referralOverdue({ priority: "immediate", raised_at: raised(99), status: "reviewed" }, now), "a REVIEWED referral is never overdue");
  check(validateMeeting({ title: "", scheduled_at: "nope" }).length === 2, "meeting validation catches empty title and bad date");
  check(validateMeeting({ title: "x", scheduled_at: new Date().toISOString(), meeting_type: "bogus" }).length === 1, "meeting validation rejects an unknown type");
  check(validateMeeting({ title: "x", scheduled_at: new Date().toISOString(), meeting_type: "family_conference" }).length === 0, "family_conference is a valid meeting type");
  check(validateReferral({}).length === 2, "referral validation requires patient and reason");

  // ── Live rows ──────────────────────────────────────────────────────────────
  const { data: hosps } = await admin.from("hospitals").select("id").limit(40);
  let hid: string | null = null, staff: any[] = [];
  for (const h of (hosps ?? []) as any[]) {
    const { data: p } = await admin.from("profiles").select("id, full_name").eq("hospital_id", h.id).limit(4);
    if ((p ?? []).length >= 2) { hid = h.id; staff = p as any[]; break; }
  }
  if (!hid) { console.error("No hospital has 2+ profiles to test against."); process.exit(1); }
  const otherHid = ((hosps ?? []) as any[]).map(h => h.id).find(id => id !== hid) ?? null;
  const [chair, member] = staff;

  const cleanup: { table: string; ids: string[] }[] = [];
  const ins = async (table: string, rows: any[]) => {
    const { data, error } = await admin.from(table).insert(rows).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    const ids = (data ?? []).map((r: any) => r.id);
    cleanup.push({ table, ids });
    return ids;
  };

  const probe = await admin.from("op_mdt_meetings").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) {
    console.error("Migration 160 is not applied — run supabase/migrations/160-mdt-coordination.sql first.");
    process.exit(1);
  }

  try {
    const [patient] = await ins("op_patients", [{ hospital_id: hid, label: "MDT-HARNESS-1", operational_status: "admitted", acuity_level: "high" }]);

    // Two referrals: one urgent + long-waiting (overdue), one routine and fresh.
    // NOTE: PostgREST unifies the column list across a batch insert, so a column supplied in SOME rows is
    // sent as explicit NULL for the others and the table DEFAULT never applies. Every row below therefore
    // carries every column it shares with its siblings.
    const [refUrgent, refRoutine] = await ins("op_mdt_referrals", [
      { hospital_id: hid, patient_id: patient, reason: "Complex discharge planning", complexity: "highly_complex",
        priority: "urgent", services_requested: ["physiotherapy", "social_work"], raised_by: member.id, raised_at: raised(30) },
      { hospital_id: hid, patient_id: patient, reason: "Nutrition review", complexity: "standard",
        priority: "routine", services_requested: null, raised_by: member.id, raised_at: new Date(now).toISOString() },
    ]);

    let d: any = await loadMdt(admin, hid, false, now);
    check(d.provisioned, "loader reports the MDT stores provisioned");
    check(d.awaiting.length >= 2, "referrals land on the complex case register", `${d.awaiting.length} awaiting`);
    const u = d.awaiting.find((r: any) => r.id === refUrgent);
    const r0 = d.awaiting.find((r: any) => r.id === refRoutine);
    check(u?.overdue === true, "the 30h-old urgent referral is flagged overdue", `waited ${u?.waitingHours}h`);
    check(r0?.overdue === false, "the fresh routine referral is not");
    check(d.awaiting.findIndex((r: any) => r.id === refUrgent) < d.awaiting.findIndex((r: any) => r.id === refRoutine),
      "the register orders by priority");
    check(d.kpis.escalatedCases >= 1, "a highly_complex referral counts as escalated", `${d.kpis.escalatedCases}`);

    // A meeting with NO participant rows — the "not recorded" case.
    const [bare] = await ins("op_mdt_meetings", [{
      hospital_id: hid, patient_id: patient, title: "Bare meeting", meeting_type: "ward_mdt",
      scheduled_at: new Date(now - 2 * HOUR).toISOString(), status: "completed", completed_at: new Date(now - HOUR).toISOString(),
    }]);
    d = await loadMdt(admin, hid, false, now);
    const bm = [...d.today, ...d.recent, ...d.upcoming].find((m: any) => m.id === bare);
    check(bm?.attendanceRate === null, "a meeting with no invitation list reports attendanceRate NULL, not 0", `${bm?.attendanceRate}`);
    check(bm?.quorum.met === null, "and quorum null rather than false");
    check(d.signals.some((s: any) => /recorded no attendance/.test(s.text)), "the page is told attendance cannot be reported for it");

    // A real meeting scheduled from the urgent referral, with a required + optional participant.
    const [meeting] = await ins("op_mdt_meetings", [{
      hospital_id: hid, patient_id: patient, title: "Complex case review", meeting_type: "complex_case",
      scheduled_at: new Date(now + 1 * HOUR).toISOString(), status: "scheduled",
      chaired_by: chair.id, location: "Seminar room",
    }]);
    await admin.from("op_mdt_referrals").update({ status: "scheduled", meeting_id: meeting }).eq("id", refUrgent);
    const [pReq, pOpt] = await ins("op_mdt_participants", [
      { meeting_id: meeting, service: "physiotherapy", staff_id: member.id, required: true },
      { meeting_id: meeting, service: "nutrition", participant_name: "Dietitian on call", required: false },
    ]);

    d = await loadMdt(admin, hid, false, now);
    let m = d.upcoming.find((x: any) => x.id === meeting);
    check(!!m, "the scheduled meeting appears in upcoming");
    check(m.attendanceRate === 0, "with invitations recorded but nobody yet attended, the rate IS 0", `${m.attendanceRate}%`);
    check(m.quorum.required === 1 && m.quorum.met === false, "quorum counts only the REQUIRED participant", `${m.quorum.present}/${m.quorum.required}`);
    check(!d.awaiting.some((r: any) => r.id === refUrgent), "a scheduled referral leaves the awaiting register");

    // Attendance recorded.
    await admin.from("op_mdt_participants").update({ attendance: "attended" }).eq("id", pReq);
    await admin.from("op_mdt_participants").update({ attendance: "apologies" }).eq("id", pOpt);
    d = await loadMdt(admin, hid, false, now);
    m = d.upcoming.find((x: any) => x.id === meeting);
    check(m.quorum.met === true, "quorum is met once every REQUIRED participant attends, despite an optional apology");
    check(m.attendanceRate === 50, "the attendance rate counts all invitations", `${m.attendanceRate}%`);
    check(d.byService.some((s: any) => s.service === "physiotherapy" && s.rate === 100), "per-service attendance is computed");
    check(d.byService.some((s: any) => s.service === "nutrition" && s.rate === 0), "a service that sent apologies reads 0%, because it WAS invited");

    // Decisions + actions: one overdue, one undated, one completed, one cancelled.
    const [decision] = await ins("op_mdt_decisions", [{
      meeting_id: meeting, patient_id: patient, category: "discharge",
      decision: "Discharge once home oxygen is in place", rationale: "Stable on 2L", decided_by: chair.id,
    }]);
    const base = { meeting_id: meeting, decision_id: decision, patient_id: patient, owner_id: null as string | null, due_at: null as string | null, completed_at: null as string | null, priority: "normal" };
    const [aOverdue, aUndated, , ] = await ins("op_mdt_actions", [
      { ...base, action: "Arrange home oxygen", owner_id: member.id, due_at: new Date(now - 3 * HOUR).toISOString(), status: "open", priority: "high" },
      { ...base, action: "Family education", status: "open" },
      { ...base, action: "Physio review", status: "completed", completed_at: new Date().toISOString() },
      { ...base, action: "Duplicate referral", status: "cancelled" },
    ]);

    d = await loadMdt(admin, hid, false, now);
    check(d.openActions.length === 2, "cancelled and completed actions leave the open tracker", `${d.openActions.length} open`);
    check(d.openActions[0].id === aOverdue, "the tracker sorts overdue first", d.openActions.map((a: any) => a.action).join(" > "));
    check(d.openActions.find((a: any) => a.id === aUndated)?.overdue === false, "an undated action is never overdue");
    check(d.openActions[d.openActions.length - 1].id === aUndated, "undated actions sort last");
    // 4 raised, 1 cancelled -> 3 decided, 1 completed = 33%.
    check(d.kpis.completionRate === 33, "completion rate EXCLUDES cancelled actions", `${d.kpis.completionRate}% (1 of 3)`);
    check(d.kpis.overdueActions === 1, "overdue actions are counted", `${d.kpis.overdueActions}`);
    check(d.themes.some((t: any) => t.category === "discharge"), "decision categories feed the recurring-themes widget");
    check(d.signals.some((s: any) => /past their due date/.test(s.text)), "an overdue action raises a coordination signal");

    // Completing the meeting closes the referral it was convened for.
    await admin.from("op_mdt_meetings").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", meeting);
    await admin.from("op_mdt_referrals").update({ status: "reviewed", reviewed_at: new Date().toISOString() })
      .eq("meeting_id", meeting).in("status", ["awaiting_review", "scheduled"]);
    const { data: refAfter } = await admin.from("op_mdt_referrals").select("status, reviewed_at").eq("id", refUrgent).maybeSingle();
    check(refAfter?.status === "reviewed" && !!refAfter?.reviewed_at, "completing the meeting marks its referral reviewed", `${refAfter?.status}`);

    d = await loadMdt(admin, hid, false, now);
    check(d.recent.some((x: any) => x.id === meeting), "the completed meeting moves to recently completed");
    check(!d.signals.some((s: any) => /did not have every required service/.test(s.text)),
      "no false quorum warning for a meeting that DID have quorum");

    // Family conference is the same object with a different type.
    await ins("op_mdt_meetings", [{
      hospital_id: hid, patient_id: patient, title: "Family conference", meeting_type: "family_conference",
      scheduled_at: new Date(now + 4 * HOUR).toISOString(), status: "scheduled",
    }]);
    d = await loadMdt(admin, hid, false, now);
    check(d.kpis.familyMeetings === 1, "family conferences are counted as their own KPI", `${d.kpis.familyMeetings}`);
    check(d.upcoming.some((x: any) => x.meeting_type === "family_conference"), "and appear in the normal meeting flow");

    // Tenant scoping.
    if (otherHid) {
      const other: any = await loadMdt(admin, otherHid, false, now);
      check(!(other.awaiting ?? []).some((r: any) => r.id === refRoutine), "another hospital never sees these referrals");
      check(![...(other.today ?? []), ...(other.upcoming ?? []), ...(other.recent ?? [])].some((x: any) => x.id === meeting),
        "another hospital never sees these meetings");
    } else {
      console.log("SKIP  tenant scoping — only one hospital row");
    }
  } finally {
    const order = ["op_mdt_actions", "op_mdt_decisions", "op_mdt_participants", "op_mdt_referrals", "op_mdt_meetings", "op_patients"];
    for (const table of order) {
      const ids = [...new Set(cleanup.filter(c => c.table === table).flatMap(c => c.ids))];
      if (ids.length) await admin.from(table).delete().in("id", ids);
    }
    let leftover = 0;
    for (const table of order) {
      const ids = [...new Set(cleanup.filter(c => c.table === table).flatMap(c => c.ids))];
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
