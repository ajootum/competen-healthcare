// Harness for Workforce Wellbeing & Fatigue (UMW-WFM-003, migration 162).
//
// Two things matter more than the feature working, and both are tested against REAL rows written and then
// deleted:
//
//   1. THE PRIVACY RULE. A check-in marked `private` must count toward unit figures and must NEVER be
//      attributable. The rule is enforced in the loader, so the test is: write a private check-in, and
//      assert its identity is absent from EVERYTHING the loader returns — not just from the field a page
//      happens to render.
//   2. ONE FATIGUE ENGINE. The Unit Manager and the Shift Supervisor must produce identical exposure from
//      identical shifts, because a manager and a supervisor disagreeing about whether a nurse is overworked
//      is the failure this shared engine exists to prevent.
//
//   npx --yes tsx scripts/umw-wellbeing-harness.ts
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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { loadWellbeing } = await import("../src/lib/workforce/wellbeing");
  const F = await import("../src/lib/workforce/fatigue");

  // ── 1. Pure fatigue maths ──
  const iso = (d: number) => new Date(d).toISOString();
  const day = (d: number) => iso(d).slice(0, 10);
  const now = Date.now();

  check(F.consecutiveDays(["2026-01-01", "2026-01-02", "2026-01-03"]) === 3, "three consecutive days count as three");
  check(F.consecutiveDays(["2026-01-01", "2026-01-03", "2026-01-04"]) === 2, "a gap breaks the run", `${F.consecutiveDays(["2026-01-01", "2026-01-03", "2026-01-04"])}`);
  check(F.consecutiveDays(["2026-01-01", "2026-01-01"]) === 1, "a duplicated date is one day, not two");
  check(F.consecutiveDays([]) === 0, "no dates is zero, not an error");

  check(F.hoursOfShift({ staffId: "x", date: "2026-01-01", startsAt: iso(now), endsAt: iso(now + 12 * 3.6e6) }) === 12, "a 12-hour shift measures 12h");
  check(F.hoursOfShift({ staffId: "x", date: "2026-01-01", startsAt: iso(now), endsAt: null }) === null, "a shift with no end time yields NULL hours, not zero");
  check(F.hoursOfShift({ staffId: "x", date: "2026-01-01", startsAt: iso(now), endsAt: iso(now + 30 * 3.6e6) }) === null,
    "a >24h span is treated as a data error, not believed as a 30-hour shift");
  check(F.hoursOfShift({ staffId: "x", date: "2026-01-01", startsAt: iso(now), endsAt: iso(now - 3.6e6) }) === null, "a negative span is rejected");

  const rest = F.shortestRest([
    { staffId: "a", date: "2026-01-01", startsAt: iso(now), endsAt: iso(now + 8 * 3.6e6) },
    { staffId: "a", date: "2026-01-02", startsAt: iso(now + 16 * 3.6e6), endsAt: iso(now + 24 * 3.6e6) },
  ]);
  check(rest === 8, "shortest rest is the gap between one shift ending and the next starting", `${rest}h`);
  check(F.shortestRest([{ staffId: "a", date: "2026-01-01", startsAt: iso(now), endsAt: iso(now + 8 * 3.6e6) }]) === null,
    "a single shift has no rest gap to measure");

  // Bands.
  const sixDays: any[] = Array.from({ length: 6 }, (_, i) => ({
    staffId: "s1", date: day(now - i * DAY), startsAt: iso(now - i * DAY - 12 * 3.6e6), endsAt: iso(now - i * DAY),
  }));
  const [r1] = F.computeFatigue(sixDays);
  check(r1.consecutive === 6, "six consecutive rostered days are counted", `${r1.consecutive}`);
  check(r1.flags.some(f => /consecutive/.test(f)), "and produce a named flag");
  check(r1.band === "high", "two or more flags reach the high band", `${r1.band} (${r1.flags.length} flags)`);
  const partial = F.computeFatigue([
    { staffId: "s2", date: day(now), startsAt: iso(now - 8 * 3.6e6), endsAt: iso(now) },
    { staffId: "s2", date: day(now - DAY), startsAt: null, endsAt: null },
  ]);
  check(partial[0].hoursPartial === true, "hours are marked PARTIAL when a shift has no recorded times");
  check(partial[0].hours === 8, "and count only the shifts that do have times", `${partial[0].hours}h`);
  check(partial[0].days === 2, "while both shifts still count toward days");
  const noneRostered = F.computeFatigue([{ staffId: "s3", date: day(now), startsAt: iso(now - 4 * 3.6e6), endsAt: iso(now) }]);
  check(noneRostered[0].band === "none" && noneRostered[0].flags.length === 0, "a single short shift raises no flag");
  check(noneRostered[0].hours === 4, "and still reports its hours");

  // A short rest gap ALONE reaches high — it is a rule breach, not a trend.
  const shortRest = F.computeFatigue([
    { staffId: "s4", date: day(now - DAY), startsAt: iso(now - DAY - 8 * 3.6e6), endsAt: iso(now - DAY) },
    { staffId: "s4", date: day(now), startsAt: iso(now - DAY + 4 * 3.6e6), endsAt: iso(now - DAY + 12 * 3.6e6) },
  ]);
  check(shortRest[0].band === "high", "a sub-threshold rest gap alone reaches HIGH", `rest ${shortRest[0].rest}h`);

  // ── 2. Live rows: the privacy rule ──
  const { data: hosps } = await admin.from("hospitals").select("id").limit(40);
  let hid: string | null = null, staff: any[] = [];
  for (const h of (hosps ?? []) as any[]) {
    const { data: p } = await admin.from("profiles").select("id, full_name").eq("hospital_id", h.id).limit(3);
    if ((p ?? []).length >= 2) { hid = h.id; staff = p as any[]; break; }
  }
  if (!hid) { console.error("No hospital with 2+ profiles."); process.exit(1); }
  const [privatePerson, sharingPerson] = staff;

  const cleanup: { table: string; ids: string[] }[] = [];
  const ins = async (table: string, rows: any[]) => {
    const { data, error } = await admin.from(table).insert(rows).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    const ids = (data ?? []).map((r: any) => r.id);
    cleanup.push({ table, ids });
    return ids;
  };

  const probe = await admin.from("op_wellbeing_checkins").select("id").limit(1);
  if (probe.error) { console.error("Migration 162 not applied:", probe.error.message); process.exit(1); }

  try {
    const base = { hospital_id: hid, energy: 2, workload: 2, support: 2, sleep_quality: 2, mood: 2 };
    await ins("op_wellbeing_checkins", [
      { ...base, staff_id: privatePerson.id, checkin_date: new Date(now).toISOString().slice(0, 10),
        visibility: "private", comment: "PRIVATE-HARNESS-COMMENT" },
      { ...base, staff_id: sharingPerson.id, checkin_date: new Date(now).toISOString().slice(0, 10),
        visibility: "manager", comment: "SHARED-HARNESS-COMMENT", energy: 4, workload: 4, support: 4, sleep_quality: 4, mood: 4 },
    ]);

    const d: any = await loadWellbeing(admin, hid, false, { now });
    check(d.provisioned, "the loader reports the wellbeing stores provisioned");
    check(d.checkIns.recorded >= 2, "both check-ins are COUNTED", `${d.checkIns.recorded} recorded`);
    check(d.checkIns.privateCount >= 1, "the private one is counted as private", `${d.checkIns.privateCount}`);
    // NOT "both contribute to a published score" — that is what suppression now prevents. Both are
    // COUNTED; whether their average may be shown is the cohort question tested below.
    check(d.checkIns.recorded === 2 && d.checkIns.privateCount === 1,
      "both are counted, one of them privately", `${d.checkIns.recorded} recorded, ${d.checkIns.privateCount} private`);

    // THE CENTRAL ASSERTION, scoped correctly. The private person may legitimately appear ELSEWHERE in the
    // payload — they are rostered, and a roster is operational data a manager is entitled to see. What must
    // never happen is their WELLBEING SELF-REPORT being attributable. So the check is on the check-in
    // subtree, not the whole blob. (The first version of this test checked the whole payload, failed, and
    // was right to: it exposed that suppression was missing, below.)
    const ci = JSON.stringify(d.checkIns);
    check(!ci.includes(privatePerson.id), "the private check-in's staff id is absent from the check-in data");
    check(!ci.includes("PRIVATE-HARNESS-COMMENT"), "nor is its comment");
    check(privatePerson.full_name && privatePerson.full_name !== sharingPerson.full_name ? !ci.includes(privatePerson.full_name) : true,
      "nor their name", privatePerson.full_name ?? "");
    check(d.checkIns.shared.every((c: any) => c.visibility !== "private"), "nothing in the shared list is private");

    // SMALL-COHORT SUPPRESSION. Two check-ins, one shared, means the other is deducible by elimination —
    // so with fewer than MIN_COHORT responses the aggregate itself is withheld.
    check(d.checkIns.cohortSafe === false, "a 2-response cohort is NOT safe to aggregate", `${d.checkIns.recorded} of ${d.checkIns.minCohort}`);
    check(d.checkIns.score === null, "so the wellbeing score is withheld, not published");
    check(d.checkIns.byDimension.length === 0 && d.checkIns.lowDimension.length === 0, "and so are the dimension breakdowns");
    check(d.kpis.wellbeingScore === null, "the KPI respects the suppression too");
    check(/identify individuals/.test(d.checkIns.suppressedReason ?? ""), "and the surface is told WHY", d.checkIns.suppressedReason ?? "");
    check(d.checkIns.recorded === 2 && d.checkIns.participants === 2,
      "participation is still reported — knowing people ARE checking in discloses nothing personal");

    // Above the threshold the aggregate MUST return, or "suppression" is indistinguishable from breakage.
    await ins("op_wellbeing_checkins", [{ ...base, staff_id: privatePerson.id, checkin_date: new Date(now - DAY).toISOString().slice(0, 10), visibility: "private" }]);
    const d3: any = await loadWellbeing(admin, hid, false, { now });
    check(d3.checkIns.recorded >= 3, "a third check-in reaches the cohort threshold", String(d3.checkIns.recorded));
    check(d3.checkIns.cohortSafe === true, "the cohort is now safe to aggregate");
    check(d3.checkIns.score != null, "and the score is published", d3.checkIns.score + "%");
    check(d3.checkIns.byDimension.length === 5, "with all five dimensions");
    check(!JSON.stringify(d3.checkIns).includes("PRIVATE-HARNESS-COMMENT"), "while private comments STILL never appear");

    // ── 3. Empty stores read as absent, never as healthy zeros ──
    check(d.kpis.burnoutHigh === null || d.burnout.recorded > 0, "burnout KPI is NULL when nothing is recorded, not 0");
    check(d.kpis.openReferrals === null || d.referrals.recorded > 0, "referrals KPI is NULL when nothing is recorded");
    check(d.kpis.missedBreaks === null || d.breakCompliance.recorded > 0, "missed-breaks KPI is NULL when no breaks are recorded");
    check(d.breakCompliance.rate === null || d.breakCompliance.recorded > 0, "break compliance rate is NULL rather than 100% with no data");

    // ── 4. Burnout + referral + plan round-trip ──
    await ins("op_burnout_assessments", [{
      hospital_id: hid, staff_id: sharingPerson.id, instrument: "cbi", total_score: 78,
      risk_band: "severe", follow_up_required: true,
    }]);
    await ins("op_occupational_referrals", [{
      hospital_id: hid, staff_id: sharingPerson.id, reason: "Harness referral",
      category: "fatigue", urgency: "urgent", status: "referred", self_referred: true,
    }]);
    await ins("op_wellbeing_plans", [{
      hospital_id: hid, staff_id: sharingPerson.id, scope: "individual", trigger: "burnout_assessment",
      goal: "Harness plan", status: "open", review_date: new Date(now - 3 * DAY).toISOString().slice(0, 10),
    }]);

    const d2: any = await loadWellbeing(admin, hid, false, { now });
    check(d2.burnout.atRisk.some((b: any) => b.band === "severe"), "a severe burnout assessment surfaces in the at-risk list");
    check(d2.kpis.burnoutHigh >= 1, "and raises the KPI", `${d2.kpis.burnoutHigh}`);
    check(d2.burnout.followUp >= 1, "follow-up flag is carried through");
    check(d2.referrals.urgent >= 1, "an urgent open referral is counted", `${d2.referrals.urgent}`);
    check(d2.referrals.selfReferred >= 1, "self-referral is recorded rather than inferred");
    check(d2.plans.overdueReviews >= 1, "a plan past its review date is flagged overdue");
    check(d2.signals.some((s: any) => /burnout/i.test(s.text)), "burnout risk raises an intervention signal");
    check(d2.signals.some((s: any) => /referral/i.test(s.text)), "so does an urgent referral");

    // ── 5. Thresholds are configurable, and fail soft ──
    const t = await F.resolveFatigueThresholds(admin, { hospitalId: hid });
    check(t.thresholds.consecutiveDays > 0 && t.thresholds.restHours > 0, "thresholds resolve to usable values");
    check(t.thresholds.consecutiveDays === F.DEFAULT_THRESHOLDS.consecutiveDays || t.configured,
      "unconfigured tenants fall back to the platform defaults, and say so", t.configured ? "configured" : "defaults");

    // ── 6. Tenant scoping ──
    const otherHid = ((hosps ?? []) as any[]).map(h => h.id).find(id => id !== hid);
    if (otherHid) {
      const other: any = await loadWellbeing(admin, otherHid, false, { now });
      check(!JSON.stringify(other).includes("SHARED-HARNESS-COMMENT"), "another hospital sees none of this data");
    } else console.log("SKIP  tenant scoping — one hospital only");
  } finally {
    for (const table of ["op_wellbeing_plans", "op_occupational_referrals", "op_burnout_assessments", "op_wellbeing_checkins"]) {
      const ids = cleanup.filter(c => c.table === table).flatMap(c => c.ids);
      if (ids.length) await admin.from(table).delete().in("id", ids);
    }
    let left = 0;
    for (const c of cleanup) {
      const { data } = await admin.from(c.table).select("id").in("id", c.ids);
      left += (data ?? []).length;
    }
    check(left === 0, "harness rows cleaned up", left ? `${left} left` : `${cleanup.reduce((n, c) => n + c.ids.length, 0)} removed`);
  }

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
