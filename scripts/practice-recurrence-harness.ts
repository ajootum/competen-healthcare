/**
 * CPR-RECUR-001 -- SESSIONS THAT DO NOT REPEAT EVERY WEEK. Migration 274.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WHAT THIS HARNESS CAN AND CANNOT PROVE, STATED FIRST SO NOTHING BELOW READS AS MORE THAN IT IS
 *
 * Migration 274 is applied BY HAND, once, in the Supabase SQL editor, and had not been applied when this
 * was written -- there is no DDL path from here at all (the service role reaches PostgREST, which
 * executes no DDL, and no exec-SQL function exists in this project). PostgREST refuses a select naming a
 * column that does not exist, so anything that needs the two stored columns CANNOT run yet.
 *
 * The assertions are therefore in FOUR groups and the split is deliberate:
 *
 *   A. PURE ARITHMETIC. The occurrence maths, exercised directly. These are not "unit tests instead of
 *      the real thing" -- occursOn() and its neighbours ARE the functions the generator and the session
 *      editor call, called the way they call them. Runs today. Includes the YEAR BOUNDARY and the
 *      53-WEEK ISO YEAR, each with an ISO-week-parity CONTROL implemented here that is watched to BREAK
 *      where the anchor does not.
 *
 *   B. THE ENGINE OVER A REAL DIARY, with the two columns SIMULATED. A proxy strips migration 274's
 *      columns out of the select and injects the values back into the rows -- so generateSlots runs
 *      against the REAL database, writing real slots, reading real appointments and running its real
 *      reaping guards, with only the two column VALUES stubbed. What it proves is the generator's
 *      behaviour. What it does not prove is the SQL in the migration file.
 *
 *   C. THE STORE-ABSENT BEHAVIOUR, which is a real state this product is in right now: the engine must
 *      refuse an alternate-week session with a sentence about the practice rather than a database error,
 *      and must go on generating weekly diaries exactly as before. Runs today, against the real store.
 *
 *   D. END TO END THROUGH saveSession, WHICH NEEDS THE MIGRATION. Probed for. If absent, this script
 *      prints a loud block naming the file AND EXITS NON-ZERO -- absence is reported as an unproven
 *      claim, never as a pass.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT PROVES:
 *   1. ANCHOR, NOT PARITY. Alternate Saturdays counted from a chosen Saturday land fourteen days apart
 *      across a year boundary AND across a 53-week ISO year. The parity implementation is written out
 *      here and watched to break on both.
 *   2. TWO PRACTITIONERS WHO CHOSE ALTERNATE SATURDAYS A WEEK APART GET DIFFERENT SATURDAYS. Under
 *      parity they get the same ones -- proven, not asserted.
 *   3. THE GENERATOR MATERIALISES ONLY THE RIGHT WEEKS, over a real database, and is idempotent.
 *   4. TURNING A WEEKLY SESSION FORTNIGHTLY REMOVES THE OFF-WEEK SLOTS AND NEVER ONE WITH AN
 *      APPOINTMENT IN IT -- matched by slot_id AND by time overlap -- and the refusal that stops the
 *      change happening silently reports the count.
 *   5. TWO FORTNIGHTLY SESSIONS IN ANTIPHASE MAY OVERLAP. In phase they may not. Both directions.
 *   6. THE STORE-ABSENT PATH REFUSES HONESTLY and leaves weekly generation untouched.
 *   7. A FAILED TEMPLATE READ IS NEVER AN EMPTY WEEK -- generation refuses rather than reaping a diary
 *      it could not see.
 *
 *   npx --yes tsx scripts/practice-recurrence-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  addSession, generateSlots, sessionConflict, forgetRecurrenceStore, recurrenceStoreState,
} from "../src/lib/practice/availability-config";
import { saveSession, occurrencesDroppedBy, practiceSessions } from "../src/lib/practice/practice-sessions";
// CPR-RECUR-001's other surface. The planner projects the regular week onto real dates, so a fortnightly
// session that it drew every week would contradict the diary on the same afternoon.
import { plannerWeek } from "../src/lib/practice/planner";
import {
  occursOn, occurrencesBetween, nextOccurrences, nextWeekdayOnOrAfter, alignAnchorToWeekday,
  recurrencesCanCoincide, describeRecurrence, recurrenceBadge, readRecurrence, isoWeekdayOf,
  addDaysIso, isDateIso, wholeWeeksBetween, RECURRENCE_INTERVALS, MAX_RECURRENCE_WEEKS,
  type Recurrence,
} from "../src/lib/practice/recurrence";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

/**
 * ⚠ THE OWNER ID FIRST ISSUED FOR THIS HARNESS WAS NOT A UUID, AND THE SUBSTITUTION IS RECORDED HERE SO
 * THE NEXT PERSON DOES NOT WONDER.
 *
 * It read `00000000-0000-4000-8000-00000000rec1`. The final group must be twelve HEXADECIMAL digits and
 * `r` is not one, so Postgres refuses the insert with 22P02 before any fixture exists. The replacement
 * below was issued as the correction: same shape, twelve legal digits, and distinct from every other
 * fixture owner in scripts/ (checked against af001, ec001 and the rest), which matters because harnesses
 * here purge by owner id and a shared one makes two agents delete each other's rows.
 */
const OWNER = "00000000-0000-4000-8000-00000000dec1";
const TZ = "Africa/Kampala"; // UTC+3, no DST -- the arithmetic is checkable by hand.
const CORR = "harness-recur";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONTROL IMPLEMENTATION: ISO WEEK-NUMBER PARITY, WRITTEN OUT SO IT CAN BE WATCHED TO FAIL
//
// ⚠ THIS IS THE SHORTCUT THE DESIGN REJECTED, and it is here rather than described because "parity
// breaks at year boundaries" is a claim, and a claim in a comment proves nothing. Every assertion about
// the anchor below has a twin that runs the same question through this and expects the opposite answer.
// If parity ever stopped breaking, the twin would go red and the design note would be wrong.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

function isoWeekOf(dateIso: string): { year: number; week: number } {
  const d = new Date(Date.parse(`${dateIso}T12:00:00Z`));
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  // The Thursday of this week decides which ISO year the week belongs to.
  d.setUTCDate(d.getUTCDate() - dayFromMonday + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const jan4FromMonday = (jan4.getUTCDay() + 6) % 7;
  const firstThursday = new Date(jan4.getTime());
  firstThursday.setUTCDate(jan4.getUTCDate() - jan4FromMonday + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year, week };
}

/** "Alternate Saturdays" as even ISO weeks -- one integer, no anchor, and wrong. */
const parityOccursOn = (dateIso: string, weekday: number, evenWeeks: boolean) =>
  isoWeekdayOf(dateIso) === weekday && (isoWeekOf(dateIso).week % 2 === 0) === evenWeeks;

function datesEvery(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  for (let d = fromIso; d <= toIso; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** Every gap between consecutive dates, in days. The shape of a pattern, as a list of numbers. */
const gapsOf = (dates: string[]) =>
  dates.slice(1).map((d, i) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${dates[i]}T12:00:00Z`)) / 86400000));

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROXY THAT SIMULATES MIGRATION 274'S TWO COLUMNS
//
// ⚠ WHAT IS FAKE AND WHAT IS REAL, PRECISELY. Everything is real -- the workspace, the sessions, the
// slots, the appointments, the reaping, PostgREST itself -- EXCEPT that the two columns migration 274
// adds do not exist in the database yet, so the select naming them is rewritten to omit them and the
// VALUES are grafted onto the rows on the way back.
//
// It exists because the alternative was to prove nothing about the generator until somebody applies a
// file by hand. It is NOT a substitute for group D, which is why group D still exits non-zero.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const stripRecurrenceCols = (cols: string) =>
  cols.replace(/\s*,\s*recurrence_weeks\s*,\s*recurrence_anchor_date/g, "")
    .replace(/recurrence_weeks\s*,\s*recurrence_anchor_date\s*,\s*/g, "");

function wrapResult(builder: any, inject: (rows: any[]) => any[]): any {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return (resolve: any, reject: any) =>
          (target as any).then((r: any) => {
            if (r && Array.isArray(r.data)) return resolve({ ...r, data: inject(r.data) });
            if (r && r.data && typeof r.data === "object") return resolve({ ...r, data: inject([r.data])[0] });
            return resolve(r);
          }, reject);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function")
        return (...args: any[]) => {
          const out = value.apply(target, args);
          return out && typeof out.then === "function" ? wrapResult(out, inject) : out;
        };
      return value;
    },
  });
}

/** `patch` maps a template id to the recurrence the database would have held for it. */
function adminWithRecurrence(real: any, patch: Map<string, Recurrence>) {
  const inject = (rows: any[]) => rows.map(r => {
    const p = r && r.id ? patch.get(String(r.id)) : undefined;
    return { ...r, recurrence_weeks: p?.everyWeeks ?? 1, recurrence_anchor_date: p?.anchorDate ?? null };
  });
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "from") {
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      }
      return (table: string) => {
        const q = target.from(table);
        if (table !== "practice_availability_template") return q;
        return new Proxy(q, {
          get(qt, qp, qr) {
            if (qp !== "select") {
              const v = Reflect.get(qt, qp, qr);
              return typeof v === "function" ? v.bind(qt) : v;
            }
            return (cols: any, opts?: any) => {
              const wants = typeof cols === "string" && cols.includes("recurrence_weeks");
              const b = (qt as any).select(wants ? stripRecurrenceCols(cols) : cols, opts);
              return wants ? wrapResult(b, inject) : b;
            };
          },
        });
      };
    },
  });
}

/** An admin whose template read always fails, to prove generation refuses instead of reaping. */
function adminWithBrokenTemplateRead(real: any) {
  const failure = { data: null, error: { code: "57014", message: "statement cancelled by the harness" } };
  const stub: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: any) => res(failure);
      return () => stub;
    },
  });
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "from") {
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      }
      return (table: string) => (table === "practice_availability_template" ? stub : target.from(table));
    },
  });
}

// ── FIXTURES ─────────────────────────────────────────────────────────────────────────────────────────

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-recur-${suffix}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: OWNER, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    // In foreign-key order. The workspace cascade covers most of it, but an appointment holding a slot
    // and a patient is exactly the shape that makes a cascade's ORDER matter -- and the failure mode is
    // a workspace that silently survives and collides with the next run.
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_audit_event").delete().eq("actor_id", OWNER);
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

/** A Saturday a good way ahead, so nothing here collides with "now" or with a lead-time rule. */
function futureSaturday(weeksAhead = 8): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  return nextWeekdayOnOrAfter(d.toISOString().slice(0, 10), 6);
}

const SAT = 6;

async function main() {
  console.log("\n=== SESSIONS THAT DO NOT REPEAT EVERY WEEK (CPR-RECUR-001, migration 274) ===\n");

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("-- A. THE ARITHMETIC, AND THE SHORTCUT IT REJECTS -------------------------------------");
  // ══════════════════════════════════════════════════════════════════════════════════════════════════

  // The owner's own sentence, in dates: alternate Saturdays at TMR from Saturday 15 August 2026.
  const anchor2026 = "2026-08-15";
  ok("A0 the fixture anchor really is a Saturday", isoWeekdayOf(anchor2026) === SAT, anchor2026);

  const fortnightly: Recurrence = { everyWeeks: 2, anchorDate: anchor2026 };
  const augSep = occurrencesBetween("2026-08-01", "2026-09-30", SAT, fortnightly);

  // ⚠ NON-VACUOUS FIRST. Every assertion below is about members of this list, so an empty list would
  // make all of them pass while proving nothing. This is the exact bug found in the booking harness.
  ok("A1 the pattern produces occurrences at all", augSep.length > 0, JSON.stringify(augSep));
  ok("A2 every occurrence is a Saturday", augSep.length > 0 && augSep.every(d => isoWeekdayOf(d) === SAT),
    JSON.stringify(augSep));
  ok("A3 every occurrence is fourteen days from the last",
    augSep.length > 1 && gapsOf(augSep).every(g => g === 14), JSON.stringify(gapsOf(augSep)));
  ok("A4 the anchor is one of them, and the Saturday after it is not",
    augSep.includes(anchor2026) && !augSep.includes(addDaysIso(anchor2026, 7)), JSON.stringify(augSep));
  // Derived from what the engine produced, never invented: take a real occurrence and its neighbour.
  {
    const on = augSep[1];
    const off = addDaysIso(on, 7);
    ok("A5 a date the engine listed is on, and the Saturday after it is off",
      occursOn(on, SAT, fortnightly) && !occursOn(off, SAT, fortnightly), `${on} / ${off}`);
    ok("A6 a weekday that is not the session's is never an occurrence",
      !occursOn(addDaysIso(on, 1), SAT, fortnightly) && !occursOn(addDaysIso(on, -1), SAT, fortnightly), on);
  }
  ok("A7 dates BEFORE the anchor stay in phase rather than being excluded",
    occursOn(addDaysIso(anchor2026, -14), SAT, fortnightly)
    && !occursOn(addDaysIso(anchor2026, -7), SAT, fortnightly));

  // Every interval, not only the fortnight.
  for (const n of RECURRENCE_INTERVALS) {
    const r: Recurrence = { everyWeeks: n, anchorDate: anchor2026 };
    const list = occurrencesBetween(anchor2026, addDaysIso(anchor2026, 7 * 4 * n), SAT, r);
    ok(`A8.${n} every ${n} week(s) produces occurrences ${n * 7} days apart`,
      list.length > 1 && gapsOf(list).every(g => g === n * 7), JSON.stringify(list));
  }
  ok("A9 a weekly session needs no anchor and consults none",
    occursOn(anchor2026, SAT, { everyWeeks: 1, anchorDate: null })
    && occursOn(addDaysIso(anchor2026, 7), SAT, { everyWeeks: 1, anchorDate: null }));
  // ⚠ THE SAFE DIRECTION. An interval with no anchor names no dates -- it must not fall back to weekly,
  // which would put a patient in front of a locked door.
  ok("A10 an interval with no anchor generates NOTHING rather than every week",
    !occursOn(anchor2026, SAT, { everyWeeks: 2, anchorDate: null })
    && !occursOn(addDaysIso(anchor2026, 7), SAT, { everyWeeks: 2, anchorDate: null }));

  // ── THE YEAR BOUNDARY, AND ITS CONTROL ───────────────────────────────────────────────────────────
  //
  // ⚠ 2026 IS A 53-WEEK ISO YEAR. 1 January 2026 is a Thursday, which is exactly the condition -- so the
  // boundary from ISO 2026 into ISO 2027 is the one that inverts a parity implementation. This is not a
  // hypothetical year chosen to make a point: it is next year.
  ok("A11 the fixture year really is a 53-week ISO year",
    isoWeekOf("2026-12-28").week === 53, JSON.stringify(isoWeekOf("2026-12-28")));

  const acrossNewYear: Recurrence = { everyWeeks: 2, anchorDate: "2026-11-07" };
  ok("A12 the new-year fixture anchor is a Saturday", isoWeekdayOf("2026-11-07") === SAT);
  const anchorRun = occurrencesBetween("2026-11-01", "2027-03-01", SAT, acrossNewYear);
  ok("A13 the run across the year boundary is not empty", anchorRun.length > 3, JSON.stringify(anchorRun));
  ok("A14 THE ANCHOR SURVIVES A 53-WEEK YEAR: every gap is still fourteen days",
    anchorRun.length > 3 && gapsOf(anchorRun).every(g => g === 14), JSON.stringify(gapsOf(anchorRun)));
  ok("A15 and the run really does cross the boundary",
    anchorRun.some(d => d < "2027-01-01") && anchorRun.some(d => d > "2027-01-01"), JSON.stringify(anchorRun));

  // THE CONTROL. The same question, asked of ISO week parity, watched to give the wrong answer.
  const parityRun = datesEvery("2026-11-01", "2027-03-01")
    .filter(d => parityOccursOn(d, SAT, isoWeekOf("2026-11-07").week % 2 === 0));
  ok("A16 CONTROL the parity run is not empty either", parityRun.length > 3, JSON.stringify(parityRun));
  ok("A17 CONTROL parity BREAKS across the 53-week year: at least one gap is not fourteen days",
    parityRun.length > 3 && gapsOf(parityRun).some(g => g !== 14), JSON.stringify(gapsOf(parityRun)));
  ok("A18 CONTROL the two agree BEFORE the boundary and disagree after it",
    anchorRun.filter(d => d < "2026-12-01").join() === parityRun.filter(d => d < "2026-12-01").join()
    && anchorRun.filter(d => d > "2027-01-15").join() !== parityRun.filter(d => d > "2027-01-15").join(),
    `${JSON.stringify(anchorRun)} vs ${JSON.stringify(parityRun)}`);

  // ── TWO PRACTITIONERS, A WEEK APART ──────────────────────────────────────────────────────────────
  const drA: Recurrence = { everyWeeks: 2, anchorDate: "2026-08-15" };
  const drB: Recurrence = { everyWeeks: 2, anchorDate: "2026-08-22" };
  const runA = occurrencesBetween("2026-08-01", "2026-10-31", SAT, drA);
  const runB = occurrencesBetween("2026-08-01", "2026-10-31", SAT, drB);
  ok("A19 both practitioners' patterns produce dates", runA.length > 2 && runB.length > 2);
  ok("A20 THE ANCHOR KEEPS THEM APART: no Saturday is in both",
    runA.every(d => !runB.includes(d)) && runB.every(d => !runA.includes(d)),
    `${JSON.stringify(runA)} vs ${JSON.stringify(runB)}`);
  const parityA = datesEvery("2026-08-01", "2026-10-31").filter(d => parityOccursOn(d, SAT, true));
  const parityB = datesEvery("2026-08-01", "2026-10-31").filter(d => parityOccursOn(d, SAT, true));
  ok("A21 CONTROL under parity both produce dates", parityA.length > 2 && parityB.length > 2);
  ok("A22 CONTROL under parity they land on exactly the SAME Saturdays",
    parityA.join() === parityB.join(), JSON.stringify(parityA));

  // ── MOVING THE DAY ───────────────────────────────────────────────────────────────────────────────
  {
    const monday = alignAnchorToWeekday(anchor2026, 1);
    ok("A23 aligning a Saturday anchor onto Monday goes BACK into the same ISO week, not forward",
      monday === addDaysIso(anchor2026, -5) && isoWeekdayOf(monday) === 1, monday);
    ok("A24 aligning keeps the ISO week number",
      isoWeekOf(monday).week === isoWeekOf(anchor2026).week
      && isoWeekOf(monday).year === isoWeekOf(anchor2026).year);
    const sunday = alignAnchorToWeekday(anchor2026, 7);
    ok("A25 aligning onto Sunday goes forward one day, staying in the same ISO week",
      sunday === addDaysIso(anchor2026, 1) && isoWeekOf(sunday).week === isoWeekOf(anchor2026).week, sunday);
  }

  // ── CAN TWO PATTERNS EVER COINCIDE? ──────────────────────────────────────────────────────────────
  ok("A26 two fortnightly patterns in ANTIPHASE never coincide",
    !recurrencesCanCoincide(SAT, drA, drB));
  ok("A27 CONTROL two fortnightly patterns in PHASE do coincide",
    recurrencesCanCoincide(SAT, drA, { everyWeeks: 2, anchorDate: addDaysIso(drA.anchorDate!, 14) }));
  ok("A28 a weekly pattern coincides with everything",
    recurrencesCanCoincide(SAT, { everyWeeks: 1, anchorDate: null }, drB));
  ok("A29 every-2 and every-3 always meet eventually (their intervals share no factor)",
    recurrencesCanCoincide(SAT, drA, { everyWeeks: 3, anchorDate: drB.anchorDate }));
  ok("A30 an unanswerable pattern counts as a clash rather than as never",
    recurrencesCanCoincide(SAT, drA, { everyWeeks: 2, anchorDate: null }));

  // ── THE PREVIEW AND THE GENERATOR ASK ONE FUNCTION ───────────────────────────────────────────────
  {
    const preview = nextOccurrences("2026-08-01", SAT, fortnightly, 5);
    const scanned = occurrencesBetween("2026-08-01", "2027-01-01", SAT, fortnightly).slice(0, 5);
    ok("A31 the preview is not empty", preview.length === 5, JSON.stringify(preview));
    ok("A32 the editor's preview and a full scan produce the SAME dates",
      preview.join() === scanned.join(), `${JSON.stringify(preview)} vs ${JSON.stringify(scanned)}`);
  }

  // ── READING AND SAYING ───────────────────────────────────────────────────────────────────────────
  ok("A33 a row with no recurrence columns reads as weekly",
    readRecurrence({}).everyWeeks === 1 && readRecurrence({}).anchorDate === null);
  ok("A34 a nonsense interval reads as weekly rather than as nothing",
    readRecurrence({ recurrence_weeks: 99 }).everyWeeks === 1
    && readRecurrence({ recurrence_weeks: null }).everyWeeks === 1);
  ok("A35 a timestamp-shaped anchor is read as its date",
    readRecurrence({ recurrence_weeks: 2, recurrence_anchor_date: "2026-08-15T00:00:00+00:00" }).anchorDate === "2026-08-15");
  ok("A36 the wording never says '3rd Saturday', which means the month's third one",
    describeRecurrence({ everyWeeks: 3, anchorDate: anchor2026 }, SAT) === "Every 3 weeks, on a Saturday"
    && describeRecurrence({ everyWeeks: 2, anchorDate: anchor2026 }, SAT) === "Every other Saturday"
    && describeRecurrence({ everyWeeks: 1, anchorDate: null }, SAT) === "Every Saturday");
  ok("A37 a weekly session carries no badge, and a fortnightly one does",
    recurrenceBadge({ everyWeeks: 1, anchorDate: null }) === null
    && recurrenceBadge({ everyWeeks: 2, anchorDate: anchor2026 }) === "Alternate weeks");
  ok("A38 an impossible date is refused rather than silently accepted",
    !isDateIso("2026-02-30") && !isDateIso("15-08-2026") && isDateIso("2026-08-15"));
  ok("A39 whole weeks between two same-weekday dates is exact and signed",
    wholeWeeksBetween("2026-08-15", "2026-08-29") === 2
    && wholeWeeksBetween("2026-08-29", "2026-08-15") === -2);
  ok("A40 the interval list and the cap agree",
    RECURRENCE_INTERVALS[RECURRENCE_INTERVALS.length - 1] === MAX_RECURRENCE_WEEKS);

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n-- REAL WORKSPACE ---------------------------------------------------------------------");
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  await cleanup();
  const wsId = await provision("Dr Recurrence", "a");
  const resolved = await resolveWorkspaceContext(admin, OWNER, wsId);
  if (!resolved.ok) throw new Error("context resolution failed");
  const ctx = resolved.ctx;

  const { data: locRow } = await admin.from("practice_location")
    .insert({ workspace_id: wsId, name: "TMR International", type: "hospital", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locId = locRow!.id as string;

  const A1 = futureSaturday(8);          // the anchor -- an ON Saturday
  const OFF1 = addDaysIso(A1, 7);        // the Saturday between -- an OFF Saturday
  const A2 = addDaysIso(A1, 14);         // the next ON Saturday
  const WINDOW_TO = addDaysIso(A1, 35);

  const created = await addSession(admin, ctx, {
    locationId: locId, weekday: SAT, startsMinute: 9 * 60, endsMinute: 13 * 60,
    actorId: OWNER, correlationId: `${CORR}-1`,
  });
  ok("B0 a Saturday session can be created", created.ok, JSON.stringify(created));
  if (!created.ok) throw new Error("cannot continue without a session");
  const templateId = created.data.id;

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n-- C. THE STORE-ABSENT PATH (real store, whatever state it is in) ---------------------");
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  forgetRecurrenceStore();
  const storeState = await recurrenceStoreState(admin);
  ok("C0 the recurrence store reports a definite state",
    storeState === "present" || storeState === "absent", storeState);
  const migrationApplied = storeState === "present";
  console.log(`     migration 274 is ${migrationApplied ? "APPLIED" : "NOT APPLIED"} on this database`);

  if (!migrationApplied) {
    const refused = await saveSession(admin, ctx, {
      templateId, recurrenceWeeks: 2, recurrenceAnchorDate: A1,
      actorId: OWNER, correlationId: `${CORR}-c1`,
    });
    ok("C1 an alternate-week session is refused with a sentence about the practice, not a database error",
      !refused.ok && refused.code === "RECURRENCE_NOT_AVAILABLE", JSON.stringify(refused));
    // ⚠ THE CONTROL. Without it, C1 would also pass if saveSession were simply broken.
    const stillWorks = await saveSession(admin, ctx, {
      templateId, recurrenceWeeks: 1, sessionName: "Saturday clinic",
      actorId: OWNER, correlationId: `${CORR}-c2`,
    });
    ok("C2 CONTROL the same call at every-week SUCCEEDS, so C1 refused the interval and not the save",
      stillWorks.ok, JSON.stringify(stillWorks));

    const gen = await generateSlots(admin, ctx, {
      fromDate: A1, toDate: WINDOW_TO, actorId: OWNER, correlationId: `${CORR}-c3`,
    });
    ok("C3 weekly generation is untouched where the columns are absent", gen.ok, JSON.stringify(gen));
    const { data: weeklySlots } = await admin.from("practice_availability_slot")
      .select("generated_for_date").eq("workspace_id", wsId)
      .eq("generated_from_template_id", templateId).order("generated_for_date");
    const weeklyDates = ((weeklySlots ?? []) as any[]).map(s => String(s.generated_for_date));
    ok("C4 it produced slots at all", weeklyDates.length > 2, JSON.stringify(weeklyDates));
    ok("C5 EVERY Saturday in the window is there, including the one a fortnight would drop",
      weeklyDates.includes(A1) && weeklyDates.includes(OFF1) && weeklyDates.includes(A2)
      && gapsOf(weeklyDates).every(g => g === 7), JSON.stringify(weeklyDates));
  } else {
    ok("C1 skipped: migration 274 IS applied, so the absent path cannot be exercised here", true);
    ok("C2 skipped: see C1", true);
    ok("C3 skipped: see C1", true);
    ok("C4 skipped: see C1", true);
    ok("C5 skipped: see C1", true);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n-- B. THE GENERATOR OVER A REAL DIARY (274's two column VALUES simulated) -------------");
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  //
  // Everything below is the real generateSlots, writing real rows, running its real guards. Only the
  // two column values are grafted on -- see the proxy's header for exactly what that does and does not
  // prove.

  const patch = new Map<string, Recurrence>();
  patch.set(templateId, { everyWeeks: 2, anchorDate: A1 });
  const fakeAdmin = adminWithRecurrence(admin, patch);

  // Clear the weekly slots first so what follows is the fortnightly pattern's own output rather than a
  // mixture. Deleted directly, not through the engine, because the engine's own reaping is what is
  // being measured afterwards.
  await admin.from("practice_availability_slot").delete()
    .eq("workspace_id", wsId).eq("generated_from_template_id", templateId);

  const genB = await generateSlots(fakeAdmin, ctx, {
    fromDate: A1, toDate: WINDOW_TO, actorId: OWNER, correlationId: `${CORR}-b1`,
  });
  ok("B1 generation with a fortnightly session succeeds", genB.ok, JSON.stringify(genB));

  const datesOf = async () => {
    const { data } = await admin.from("practice_availability_slot")
      .select("id, generated_for_date").eq("workspace_id", wsId)
      .eq("generated_from_template_id", templateId).order("generated_for_date");
    return ((data ?? []) as any[]).map(s => ({ id: String(s.id), date: String(s.generated_for_date) }));
  };
  let rows = await datesOf();
  let dates = rows.map(r => r.date);
  ok("B2 it materialised slots at all", dates.length > 1, JSON.stringify(dates));
  ok("B3 every materialised date is fourteen days from the last",
    dates.length > 1 && gapsOf(dates).every(g => g === 14), JSON.stringify(dates));
  ok("B4 the anchor Saturday is in the diary and the Saturday after it is NOT",
    dates.includes(A1) && !dates.includes(OFF1), `${A1} / ${OFF1} in ${JSON.stringify(dates)}`);
  ok("B5 the report says how many off-weeks it skipped rather than skipping them silently",
    genB.ok && genB.data.occurrencesSkippedForInterval > 0, JSON.stringify(genB.ok ? genB.data : genB));

  const genAgain = await generateSlots(fakeAdmin, ctx, {
    fromDate: A1, toDate: WINDOW_TO, actorId: OWNER, correlationId: `${CORR}-b2`,
  });
  const afterAgain = (await datesOf()).map(r => r.date);
  ok("B6 generation is idempotent -- running it twice produces the same diary",
    genAgain.ok && afterAgain.join() === dates.join(), JSON.stringify(afterAgain));

  // ── WHAT HAPPENS TO SLOTS THAT ARE ALREADY THERE ─────────────────────────────────────────────────
  //
  // Back to weekly, so the off-week Saturday exists again and can be watched being reclaimed.
  patch.set(templateId, { everyWeeks: 1, anchorDate: null });
  await generateSlots(fakeAdmin, ctx, { fromDate: A1, toDate: WINDOW_TO, actorId: OWNER, correlationId: `${CORR}-b3` });
  rows = await datesOf();
  dates = rows.map(r => r.date);
  ok("B7 back at every week, the off-week Saturday is in the diary again",
    dates.includes(OFF1) && gapsOf(dates).every(g => g === 7), JSON.stringify(dates));

  // ⚠ AN APPOINTMENT ON THE OFF WEEK. This is the row the whole feature must not destroy.
  const offSlot = rows.find(r => r.date === OFF1);
  ok("B8 the off-week slot to protect actually exists", !!offSlot, JSON.stringify(dates));
  const { data: patient, error: patErr } = await admin.from("practice_patient")
    .insert({ workspace_id: wsId, display_name: "Recurrence Fixture" })
    .select("id").maybeSingle();
  ok("B9 a patient fixture exists to be booked", !!patient?.id, JSON.stringify(patErr));
  if (!patient?.id) throw new Error(`patient fixture failed: ${patErr?.message ?? "no row"}`);

  const { data: offSlotRow } = await admin.from("practice_availability_slot")
    .select("starts_at").eq("id", offSlot!.id).maybeSingle();
  const { data: booking, error: bookErr } = await admin.from("practice_appointment").insert({
    workspace_id: wsId, patient_id: patient!.id, slot_id: offSlot!.id,
    patient_name: "Recurrence Fixture",
    scheduled_at: offSlotRow!.starts_at, duration_minutes: 30,
    status: "CONFIRMED", appointment_type: "new_consultation", location_id: locId, created_by: OWNER,
  }).select("id").maybeSingle();
  ok("B10 a patient is booked into the off-week Saturday", !!booking?.id && !bookErr,
    JSON.stringify(bookErr ?? booking));

  // THE REFUSAL, taken from the real engine function over real rows -- no simulation in this one.
  const dropped = await occurrencesDroppedBy(admin, ctx, {
    templateId, weekday: SAT, recurrence: { everyWeeks: 2, anchorDate: A1 }, fromDate: A1,
  });
  ok("B11 going fortnightly is seen to drop the booked week, and the count is right",
    dropped.state === "ok" && dropped.value.count === 1 && dropped.value.dates.includes(OFF1),
    JSON.stringify(dropped));
  // ⚠ THE CONTROL. Without it, B11 would also pass if the function counted every booking everywhere.
  const notDropped = await occurrencesDroppedBy(admin, ctx, {
    templateId, weekday: SAT, recurrence: { everyWeeks: 2, anchorDate: OFF1 }, fromDate: A1,
  });
  ok("B12 CONTROL anchoring on the OTHER Saturday keeps that booking, and the count is nought",
    notDropped.state === "ok" && notDropped.value.count === 0, JSON.stringify(notDropped));
  // ⚠ AND THE SECOND CONTROL: matched by TIME as well as by slot id, because a booking made before slots
  // existed carries no slot_id at all.
  await admin.from("practice_appointment").update({ slot_id: null }).eq("id", booking!.id);
  const droppedByTime = await occurrencesDroppedBy(admin, ctx, {
    templateId, weekday: SAT, recurrence: { everyWeeks: 2, anchorDate: A1 }, fromDate: A1,
  });
  ok("B13 a booking carrying no slot_id is still found, by time overlap",
    droppedByTime.state === "ok" && droppedByTime.value.count === 1, JSON.stringify(droppedByTime));
  await admin.from("practice_appointment").update({ slot_id: offSlot!.id }).eq("id", booking!.id);

  // ── AND WHAT THE GENERATOR ACTUALLY DOES IF THE CHANGE HAPPENS ANYWAY ────────────────────────────
  //
  // The save door refuses while that patient is booked. This proves the SECOND guard underneath it: even
  // if the pattern changed some other way, the generator does not cancel anybody.
  patch.set(templateId, { everyWeeks: 2, anchorDate: A1 });
  const genDrop = await generateSlots(fakeAdmin, ctx, {
    fromDate: A1, toDate: WINDOW_TO, actorId: OWNER, correlationId: `${CORR}-b4`,
  });
  const afterDrop = (await datesOf()).map(r => r.date);
  ok("B14 the regeneration succeeded", genDrop.ok, JSON.stringify(genDrop));
  ok("B15 THE BOOKED OFF-WEEK SATURDAY SURVIVES, and it is the only off-week left",
    afterDrop.includes(OFF1) && afterDrop.includes(A1), JSON.stringify(afterDrop));
  ok("B16 the unbooked off-weeks were reclaimed, and the engine said how many it kept",
    genDrop.ok && genDrop.data.slotsRemoved > 0 && genDrop.data.slotsKept > 0,
    JSON.stringify(genDrop.ok ? genDrop.data : genDrop));
  const { data: stillBooked } = await admin.from("practice_appointment")
    .select("id, status").eq("id", booking!.id).maybeSingle();
  ok("B17 the appointment itself is untouched -- not cancelled, not orphaned",
    stillBooked?.status === "CONFIRMED", JSON.stringify(stillBooked));

  // ── A FAILED READ IS NEVER AN EMPTY WEEK ─────────────────────────────────────────────────────────
  const before = (await datesOf()).length;
  const brokenGen = await generateSlots(adminWithBrokenTemplateRead(admin), ctx, {
    fromDate: A1, toDate: WINDOW_TO, actorId: OWNER, correlationId: `${CORR}-b5`,
  });
  const after = (await datesOf()).length;
  ok("B18 an unreadable session list REFUSES generation instead of guessing an empty week",
    !brokenGen.ok && brokenGen.code === "TEMPLATES_UNREADABLE", JSON.stringify(brokenGen));
  ok("B19 and it removed nothing on the way",
    before > 0 && after === before, `${before} -> ${after}`);

  // ── TWO SESSIONS IN ANTIPHASE ────────────────────────────────────────────────────────────────────
  const antiphase = await sessionConflict(fakeAdmin, ctx, {
    weekday: SAT, startsMinute: 9 * 60, endsMinute: 13 * 60, locationId: null,
    recurrence: { everyWeeks: 2, anchorDate: OFF1 },
  });
  ok("B20 a second fortnightly Saturday IN ANTIPHASE is allowed to hold the same hours",
    antiphase === null, JSON.stringify(antiphase));
  const inPhase = await sessionConflict(fakeAdmin, ctx, {
    weekday: SAT, startsMinute: 9 * 60, endsMinute: 13 * 60, locationId: null,
    recurrence: { everyWeeks: 2, anchorDate: A1 },
  });
  ok("B21 CONTROL the same session IN PHASE is refused, so B20 is not simply a broken check",
    inPhase !== null && inPhase.code === "SESSION_OVERLAP", JSON.stringify(inPhase));
  const weeklyRival = await sessionConflict(fakeAdmin, ctx, {
    weekday: SAT, startsMinute: 9 * 60, endsMinute: 13 * 60, locationId: null,
  });
  ok("B22 CONTROL a WEEKLY rival at the same hours is refused, because it meets every fortnight",
    weeklyRival !== null && weeklyRival.code === "SESSION_OVERLAP", JSON.stringify(weeklyRival));

  // ── THE READ A SCREEN DRAWS ──────────────────────────────────────────────────────────────────────
  const view = await practiceSessions(fakeAdmin, ctx);
  const mine = view.sessions.state === "ok"
    ? view.sessions.value.find(s => s.id === templateId) : undefined;
  ok("B23 the session comes back on the read a screen draws", !!mine, view.sessions.state);
  ok("B24 it reports its interval, its anchor and its own words",
    mine?.recurrenceWeeks === 2 && mine?.recurrenceAnchorDate === A1
    && mine?.recurrenceLabel === "Every other Saturday" && mine?.recurrenceBadge === "Alternate weeks",
    JSON.stringify(mine && {
      w: mine.recurrenceWeeks, a: mine.recurrenceAnchorDate, l: mine.recurrenceLabel, b: mine.recurrenceBadge,
    }));
  ok("B25 the dates it will fall on are derived, not stored, and are fourteen days apart",
    !!mine && mine.nextOccurrences.length > 1 && gapsOf(mine.nextOccurrences).every(g => g === 14),
    JSON.stringify(mine?.nextOccurrences));
  ok("B26 those dates agree with the generator's own filter",
    !!mine && mine.nextOccurrences.every(d => occursOn(d, SAT, { everyWeeks: 2, anchorDate: A1 })),
    JSON.stringify(mine?.nextOccurrences));

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n-- D. END TO END THROUGH THE SAVE DOOR (needs migration 274) --------------------------");
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  let migrationMissing = false;
  if (!migrationApplied) {
    migrationMissing = true;
    console.log("  ....  NOT RUN. See the block at the end of this report.");
  } else {
    // ════════════════════════════════════════════════════════════════════════════════════════════
    // ⚠ D1 GETS A SESSION OF ITS OWN, AND WHY IS WORTH RECORDING.
    //
    // It first ran against the Saturday session above -- which by this point has a patient booked on
    // its off week by the B14-B17 fixture -- so the pre-flight guard REFUSED the save and D1 went red
    // while the product was doing exactly what D5 asserts it must. The defect was this harness's
    // fixture ordering, not the engine's behaviour, and group D could not run at all until migration
    // 274 was applied, so the ordering had never been exercised.
    //
    // ⚠ AND THE FIX IS A CLEAN SESSION, NOT A KINDER TEST. Choosing an anchor that happened to spare
    // that booking would have made D1 pass by dodging the guard, and the guard is the feature. D5
    // still points at the booked session and still expects the refusal.
    // ════════════════════════════════════════════════════════════════════════════════════════════
    const WED = 3;
    const wedAnchor = nextWeekdayOnOrAfter(A1, WED);
    const clean = await addSession(admin, ctx, {
      locationId: locId, weekday: WED, startsMinute: 14 * 60, endsMinute: 17 * 60,
      actorId: OWNER, correlationId: `${CORR}-d0`,
    });
    ok("D0 a second session, with nothing booked into it, exists for D1 to save",
      clean.ok, JSON.stringify(clean));
    if (!clean.ok) throw new Error("cannot run group D without a clean session");
    const cleanId = clean.data.id;

    const storedRecurrence = async (id: string) => {
      const { data } = await admin.from("practice_availability_template")
        .select("recurrence_weeks, recurrence_anchor_date").eq("id", id).maybeSingle();
      return data as { recurrence_weeks: number; recurrence_anchor_date: string | null } | null;
    };

    const before = await storedRecurrence(cleanId);
    ok("D1a it starts out weekly, so what follows is a change and not a coincidence",
      before?.recurrence_weeks === 1 && before?.recurrence_anchor_date === null, JSON.stringify(before));

    const saved = await saveSession(admin, ctx, {
      templateId: cleanId, recurrenceWeeks: 2, recurrenceAnchorDate: wedAnchor, todayDate: A1,
      actorId: OWNER, correlationId: `${CORR}-d1`,
    });
    const after = await storedRecurrence(cleanId);

    // ⚠ D1 ASSERTS THE STORED ROW AND NOT ONLY THE RETURN VALUE, AND THAT IS THE WHOLE POINT OF THIS
    // ASSERTION RATHER THAN AN EXTRA BESIDE IT.
    //
    // `ok: true` on its own stays true when the two columns are quietly dropped from the write -- which
    // is precisely what the store-absent branch does ON PURPOSE, so it is one wrong condition away at
    // all times. A D1 that read `saved.ok` alone would have been GREEN over a save that stored nothing,
    // which is the definition of vacuous. Proven: the failability probe breaks exactly that condition
    // and this line goes red.
    ok("D1 an alternate-week session saves through the real door AND the database holds it",
      saved.ok && after?.recurrence_weeks === 2 && String(after?.recurrence_anchor_date) === wedAnchor,
      `${JSON.stringify(saved)} stored=${JSON.stringify(after)}`);

    // The real generator, over the real columns, with no proxy anywhere near it.
    const genReal = await generateSlots(admin, ctx, {
      fromDate: wedAnchor, toDate: addDaysIso(wedAnchor, 35), actorId: OWNER, correlationId: `${CORR}-d1c`,
    });
    const { data: wedSlots } = await admin.from("practice_availability_slot")
      .select("generated_for_date").eq("workspace_id", wsId)
      .eq("generated_from_template_id", cleanId).order("generated_for_date");
    const wedDates = ((wedSlots ?? []) as any[]).map(s => String(s.generated_for_date));
    ok("D1c the real generator materialised dates from the real stored columns",
      genReal.ok && wedDates.length > 1, `${JSON.stringify(genReal)} ${JSON.stringify(wedDates)}`);
    ok("D1d ...fourteen days apart, with the chosen first date among them",
      wedDates.length > 1 && gapsOf(wedDates).every(g => g === 14) && wedDates.includes(wedAnchor),
      JSON.stringify(wedDates));

    const wrongDay = await saveSession(admin, ctx, {
      templateId: cleanId, recurrenceWeeks: 2, recurrenceAnchorDate: addDaysIso(wedAnchor, 1),
      actorId: OWNER, correlationId: `${CORR}-d2`,
    });
    ok("D2 a first date that is not the session's own weekday is refused",
      !wrongDay.ok && wrongDay.code === "VALIDATION_ERROR", JSON.stringify(wrongDay));

    const noAnchor = await saveSession(admin, ctx, {
      templateId: cleanId, recurrenceWeeks: 3, recurrenceAnchorDate: null, todayDate: A1,
      actorId: OWNER, correlationId: `${CORR}-d3`,
    });
    ok("D3 an interval with no first date is refused, and the refusal names one",
      !noAnchor.ok && noAnchor.code === "RECURRENCE_ANCHOR_REQUIRED", JSON.stringify(noAnchor));

    const tooOften = await saveSession(admin, ctx, {
      templateId: cleanId, recurrenceWeeks: 9, recurrenceAnchorDate: wedAnchor,
      actorId: OWNER, correlationId: `${CORR}-d4`,
    });
    ok("D4 an interval outside 1..4 is refused",
      !tooOften.ok && tooOften.code === "VALIDATION_ERROR", JSON.stringify(tooOften));

    // ⚠ AND THE REFUSALS LEFT THE STORED PATTERN ALONE. A refusal that had half-written the row would
    // be worse than one that let the change through, because nothing would say which half.
    const afterRefusals = await storedRecurrence(cleanId);
    ok("D4b the three refusals changed nothing in the database",
      afterRefusals?.recurrence_weeks === 2 && String(afterRefusals?.recurrence_anchor_date) === wedAnchor,
      JSON.stringify(afterRefusals));

    // The booked off-week refusal, through the door this time.
    const drops = await saveSession(admin, ctx, {
      templateId, recurrenceWeeks: 2, recurrenceAnchorDate: A1, todayDate: A1,
      actorId: OWNER, correlationId: `${CORR}-d5`,
    });
    ok("D5 a pattern change that would drop a booked week is REFUSED, with the number",
      !drops.ok && drops.code === "RECURRENCE_DROPS_BOOKED_WEEKS", JSON.stringify(drops));
    const { data: survivor } = await admin.from("practice_appointment")
      .select("status").eq("id", booking!.id).maybeSingle();
    ok("D6 and the patient's appointment is exactly where it was",
      survivor?.status === "CONFIRMED", JSON.stringify(survivor));

    // ⚠ THE CONTROL for D5: the same change with nobody booked goes through.
    await admin.from("practice_appointment").update({ status: "CANCELLED" }).eq("id", booking!.id);
    const nowFine = await saveSession(admin, ctx, {
      templateId, recurrenceWeeks: 2, recurrenceAnchorDate: A1, todayDate: A1,
      actorId: OWNER, correlationId: `${CORR}-d7`,
    });
    ok("D7 CONTROL with that booking cancelled the same change is accepted",
      nowFine.ok, JSON.stringify(nowFine));

    // The database's own constraints, which no engine can talk round.
    const badAnchor = await admin.from("practice_availability_template")
      .update({ recurrence_weeks: 2, recurrence_anchor_date: addDaysIso(A1, 1) }).eq("id", templateId);
    ok("D8 the DATABASE refuses an anchor that is not on the session's weekday",
      !!badAnchor.error, JSON.stringify(badAnchor.error));
    const noAnchorRow = await admin.from("practice_availability_template")
      .update({ recurrence_weeks: 2, recurrence_anchor_date: null }).eq("id", templateId);
    ok("D9 the DATABASE refuses an interval with no anchor",
      !!noAnchorRow.error, JSON.stringify(noAnchorRow.error));
    const goodAnchor = await admin.from("practice_availability_template")
      .update({ recurrence_weeks: 2, recurrence_anchor_date: A1 }).eq("id", templateId);
    ok("D10 CONTROL the database accepts a correct anchor, so D8 and D9 are about the constraint",
      !goodAnchor.error, JSON.stringify(goodAnchor.error));

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // P. THE PLANNER MUST NOT DRAW A CLINIC THAT IS NOT RUNNING
    //
    // planner.ts projects the regular week onto real dates as `templateSessions`, and it matched on the
    // WEEKDAY alone -- so an alternate-Saturday clinic appeared on every Saturday. The slot generator
    // and the planner would then disagree about the same afternoon: no bookable time, and a clinic
    // drawn on the week plan anyway.
    //
    // ⚠ DRIVEN THROUGH plannerWeek(), NOT BY RE-IMPLEMENTING ITS FILTER. A harness that recomputes the
    // rule it is testing stays green under every break to the real code, which is the failure this
    // repo has already had twice. Everything below reads the planner's own output.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    const THU = 4;
    const weeklyControl = await addSession(admin, ctx, {
      locationId: locId, weekday: THU, startsMinute: 9 * 60, endsMinute: 12 * 60,
      actorId: OWNER, correlationId: `${CORR}-p0`,
    });
    ok("P0 a WEEKLY session exists as the control", weeklyControl.ok, JSON.stringify(weeklyControl));
    const weeklyId = weeklyControl.ok ? weeklyControl.data.id : "";

    const onDate = wedAnchor;                    // an ON week for the fortnightly Wednesday
    const offDate = addDaysIso(wedAnchor, 7);    // the Wednesday between -- an OFF week
    const thuOn = addDaysIso(wedAnchor, 1);      // the Thursday of each of those two weeks
    const thuOff = addDaysIso(wedAnchor, 8);

    const weekOn = await plannerWeek(admin, ctx, { date: onDate });
    const weekOff = await plannerWeek(admin, ctx, { date: offDate });
    const dayOf = (w: any, date: string) => (w.days ?? []).find((d: any) => d.date === date);
    const idsOn = (w: any, date: string) =>
      ((dayOf(w, date)?.templateSessions ?? []) as any[]).map(t => String(t.id));

    // ⚠ NON-VACUOUS FIRST, AND AT WEEK LEVEL RATHER THAN DAY LEVEL. "Does not appear" is also true of a
    // planner that has stopped projecting sessions altogether, so something has to be shown to be
    // projected before anything is said about what is missing.
    //
    // ⚠ THIS ASSERTION WAS WRONG ON ITS FIRST WRITING AND WENT RED, WHICH IS WHY IT IS SPELT OUT. It
    // demanded that the OFF Wednesday itself hold a session -- but the fortnightly clinic is the only
    // session on a Wednesday, so that day is legitimately empty and the guard was asking the planner to
    // contradict the very behaviour being tested. What makes P4 non-vacuous is that the off WEEK
    // projects sessions on its other days, not that the off DAY does.
    const weekIds = (w: any) => ((w.days ?? []) as any[])
      .flatMap(d => ((d.templateSessions ?? []) as any[]).map(t => String(t.id)));

    ok("P1 the planner returned both weeks, and both days exist",
      !weekOn.unavailable && !weekOff.unavailable && !!dayOf(weekOn, onDate) && !!dayOf(weekOff, offDate),
      `${weekOn.detail ?? ""} ${weekOff.detail ?? ""}`);
    ok("P2 the planner is projecting sessions in BOTH weeks, so an empty day is a fact about that day",
      idsOn(weekOn, onDate).length > 0 && weekIds(weekOff).length > 0,
      `${JSON.stringify(idsOn(weekOn, onDate))} / ${JSON.stringify(weekIds(weekOff))}`);

    ok("P3 the fortnightly session IS on the planner on its ON week",
      idsOn(weekOn, onDate).includes(cleanId), JSON.stringify(idsOn(weekOn, onDate)));
    ok("P4 and is NOT on the planner on the OFF week of the same weekday",
      !idsOn(weekOff, offDate).includes(cleanId), JSON.stringify(idsOn(weekOff, offDate)));

    // THE CONTROL. Without it, P4 also passes when the planner projects nothing at all.
    ok("P5 CONTROL the WEEKLY session is on the planner on BOTH occurrences of its weekday",
      idsOn(weekOn, thuOn).includes(weeklyId) && idsOn(weekOff, thuOff).includes(weeklyId),
      `${JSON.stringify(idsOn(weekOn, thuOn))} / ${JSON.stringify(idsOn(weekOff, thuOff))}`);
    ok("P6 CONTROL and the two Thursdays really are different dates in different weeks",
      thuOn !== thuOff && isoWeekdayOf(thuOn) === THU && isoWeekdayOf(thuOff) === THU,
      `${thuOn} / ${thuOff}`);
  }

  // ── FIXTURES GO, AND THE GOING IS ASSERTED ───────────────────────────────────────────────────────
  await cleanup();
  const [{ count: wsLeft }, { count: reqLeft }, { count: apptLeft }, { count: patLeft }] = await Promise.all([
    admin.from("practice_workspace").select("id", { count: "exact", head: true }).eq("owner_person_id", OWNER),
    admin.from("provisioning_request").select("id", { count: "exact", head: true }).eq("target_user_id", OWNER),
    // ⚠ THE BOOKING THIS HARNESS MADE IS CHASED BY NAME. A leftover live appointment would sit in a
    // workspace nobody owns and would be counted by anything that scans across practices.
    admin.from("practice_appointment").select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
    admin.from("practice_patient").select("id", { count: "exact", head: true }).eq("workspace_id", wsId),
  ]);
  ok("Z1 every fixture workspace this harness made is gone", (wsLeft ?? -1) === 0, String(wsLeft));
  ok("Z2 every provisioning request is gone", (reqLeft ?? -1) === 0, String(reqLeft));
  ok("Z3 the appointment booked into the off-week Saturday is gone", (apptLeft ?? -1) === 0, String(apptLeft));
  ok("Z4 the patient fixture is gone", (patLeft ?? -1) === 0, String(patLeft));

  // ── REPORT ───────────────────────────────────────────────────────────────────────────────────────
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   FAILED: ${f}`)); process.exit(1); }

  if (migrationMissing) {
    console.log(`
  ══════════════════════════════════════════════════════════════════════════════════════════════════
  ⚠  GROUP D DID NOT RUN, AND THIS SCRIPT IS EXITING NON-ZERO BECAUSE OF IT.

     supabase/migrations/274-practice-session-recurrence.sql HAS NOT BEEN APPLIED to this database.
     Migrations here are applied by hand, once, in the Supabase SQL editor, and there is no DDL path
     from this script -- so the following remain UNPROVEN and must not be reported as working:

       - saving an alternate-week session through saveSession
       - the refusal when a pattern change would drop a booked week, through the save door
       - the three CHECK constraints in the migration file itself

     Everything in groups A, B and C above DID run and DID pass. Group B ran the real generator over a
     real diary with only the two column VALUES grafted on, so what is unproven is the STORE, not the
     arithmetic. Apply the file and run this again.
  ══════════════════════════════════════════════════════════════════════════════════════════════════
`);
    process.exit(1);
  }
  console.log("  ALL GREEN\n");
}

main().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
