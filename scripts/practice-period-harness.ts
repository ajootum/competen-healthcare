/**
 * THE SHARED PERIOD CONTROL, ON THE SCREENS THAT REVIEW DATA OVER TIME.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE THREE CLAIMS THIS FILE EXISTS TO PROVE, IN THE ORDER THEY MATTER
 *
 *   1. ⚠ ROLLING STILL MEANS ROLLING. Every migrated caller resolves to the SAME TWO DATES it produced
 *      before the shared module existed. Not the same label -- the same dates. "Last 30 days" and "this
 *      month" are different windows and swapping one for the other is a change to what a clinician sees
 *      wearing the costume of a refactor. The "before" is not re-typed here: it is EXTRACTED FROM GIT
 *      (section 2) and, for reports, read live from the untouched engine (section 3).
 *
 *   2. ⚠ THE LOADER RESPECTS THE RANGE, NOT JUST THE URL. For each screen: a day WITH data and a day
 *      WITHOUT produce different payloads, against the real database. A navigator that moves the address
 *      bar while the query still says "everything" is a lie the screen tells about itself.
 *
 *   3. ⚠ AN UNREADABLE READ IS NOT AN EMPTY PERIOD. For each screen, a client whose one table fails is
 *      distinguishable from a period that is genuinely empty -- each with a CONTROL proving the same
 *      call succeeds when nothing is broken.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE THREE VACUITY TRAPS THIS FILE IS WRITTEN AGAINST
 *
 *   (a) SCANNING SOURCE FOR A PHRASE THAT IS ALSO IN THE COMMENT. Every scan strips comments first.
 *       period-range.ts's own header contains the sentence "last 30 days is not this month"; a naive
 *       grep for it would pass over a module that had deleted rolling entirely.
 *   (b) ASSERTING OVER AN EMPTY LIST. Every list assertion is preceded by a count control.
 *   (c) A HARNESS THAT RE-IMPLEMENTS THE RULE IT TESTS. The rolling equivalence uses the code that was
 *       actually shipped, pulled out of git, rather than a reference written today by the same hand that
 *       wrote the replacement.
 *
 *   npx --yes tsx scripts/practice-period-harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { recordActivity, listActivitiesResult, portfolioSummary } from "../src/lib/practice/clinical-activity";
import { createFollowUp, followUpWorkspace } from "../src/lib/practice/follow-ups";
import { recordIncoming } from "../src/lib/practice/communication";
import { documentsOverview, documentRegister } from "../src/lib/practice/documents-workspace";
import { myPatients } from "../src/lib/practice/patient-workspace";
import { encountersLanding } from "../src/lib/practice/encounters-landing";
import { launchEncounter } from "../src/lib/practice/encounters";
import { resolvePeriod as reportsPeriod } from "../src/lib/practice/reports";
import {
  resolvePeriod, periodLabel, periodSpanDays, shiftPeriod, periodFromParams, periodToParams,
  resolveTarget, allDatesTarget, rollingPeriodTarget, addDaysIso, daysBetweenIso,
  ROLLING_PERIODS, QUICK_PERIODS, PERIOD_VIEWS, PERIOD_PARAMS, ALL_DATES_LABEL,
  type PeriodRange,
} from "../src/lib/practice/period-range";
import {
  HISTORY_PERIODS, DEFAULT_HISTORY_PERIOD, historyPeriodRange, historyPeriodKeyFor,
} from "../src/lib/practice/encounters-landing-constants";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

/* eslint-disable @typescript-eslint/no-explicit-any */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// ⚠ HEX ONLY. A uuid with a non-hex character is refused by Postgres outright and dies several lines
// later in the wrong place; earlier briefs in this codebase shipped ids like `...deadbeef` variants that
// were not. Both of these are checked below before anything is written.
const OWNER = "00000000-0000-4000-8000-00000000fade";
const OTHER = "00000000-0000-4000-8000-00000000face";
const CID = "harness-period";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/** ⚠ TRAP (a). Comments are stripped before any scan of source. */
const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * A client whose reads of ONE table fail and whose reads of everything else are real.
 *
 * The second half is what makes the three-state assertions mean anything: a stub that failed
 * universally would report every panel unavailable and pass for the wrong reason.
 */
function failingOn(table: string, message: string) {
  return {
    from: (t: string) => {
      if (t !== table) return admin.from(t) as any;
      const chain: Record<string, any> = {};
      const result = { data: null, error: { message }, count: null };
      for (const m of ["select", "eq", "in", "order", "not", "is", "neq", "lt", "gt", "gte", "lte", "or", "textSearch"])
        chain[m] = () => chain;
      chain.limit = async () => result;
      chain.range = async () => result;
      chain.maybeSingle = async () => result;
      chain.single = async () => result;
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
    rpc: (...args: unknown[]) => (admin.rpc as unknown as (...a: unknown[]) => unknown)(...args),
  } as any;
}

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-period-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CID,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CID, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const owner of [OWNER, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", owner);
    for (const w of (ws ?? []) as { id: string }[]) {
      for (const t of [
        "practice_clinical_activity", "practice_follow_up", "practice_incoming_document",
        "practice_clinical_document", "practice_attachment", "practice_encounter_status_history",
        "practice_encounter", "practice_patient_identifier", "practice_patient", "practice_access_log",
      ]) await admin.from(t).delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", owner);
    await admin.from("provisioning_request").delete().eq("target_user_id", owner);
  }
  // ⚠ NO practice_audit_event DELETE -- migration 247 makes it append-only and refuses one.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

async function main() {
  console.log("\nPRACTICE PERIOD CONTROL\n");

  // ══ 0. THE FIXTURE IDS ARE VALID ═══════════════════════════════════════════════════════════════════
  const UUID_HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  section("0. fixture ids");
  ok("0a. ⚠ both owner ids are valid lowercase hex uuids -- Postgres refuses anything else outright",
    UUID_HEX.test(OWNER) && UUID_HEX.test(OTHER), `${OWNER} | ${OTHER}`);
  ok("0a-control. and the check really rejects a non-hex id, so 0a is not always true",
    !UUID_HEX.test("00000000-0000-4000-8000-00000000dead".replace("dead", "ghij")));

  // ══ 1. ONE MODULE, BOTH ANCHORINGS ════════════════════════════════════════════════════════════════
  //
  // The whole of the complication, as arithmetic. THE THIRD OF AUGUST is the date the brief names,
  // because that is where the two anchorings diverge most visibly: three days against thirty-one.
  section("1. one module expresses calendar AND rolling");

  const AUG3 = "2026-08-03";
  const thisMonth = resolvePeriod("month", AUG3);
  const rolling30 = resolvePeriod("agenda", AUG3, { anchoring: "rolling", backDays: 30, todayDate: AUG3 });

  ok("1a. ⚠ 'this month' on 3 August is a CALENDAR month -- its focus starts on the 1st",
    thisMonth.anchoring === "calendar" && thisMonth.focusFromDate === "2026-08-01"
    && thisMonth.focusToDate === "2026-08-31", JSON.stringify(thisMonth));
  ok("1b. ⚠ and 'last 30 days' on the same day reaches back into JULY -- a different window entirely",
    rolling30.anchoring === "rolling" && rolling30.fromDate === "2026-07-04"
    && rolling30.toDate === AUG3, JSON.stringify(rolling30));
  ok("1c. ⚠ THE TWO ARE NOT THE SAME RANGE. This is the assertion the whole task turns on: a module "
    + "that had quietly replaced one with the other would fail here and nowhere else",
    rolling30.fromDate !== thisMonth.focusFromDate && rolling30.fromDate < thisMonth.focusFromDate,
    `${rolling30.fromDate} vs ${thisMonth.focusFromDate}`);

  ok("1d. the label SAYS WHICH: a month reads as the month, a rolling window names itself and prints "
    + "its real dates",
    periodLabel(thisMonth) === "August 2026"
    && periodLabel(rolling30).startsWith("Last 30 days")
    && periodLabel(rolling30).includes("04 Jul") && periodLabel(rolling30).includes("03 Aug"),
    `${periodLabel(thisMonth)} | ${periodLabel(rolling30)}`);

  ok("1e. ⚠ the TRUE span is available and is 31, not 30 -- the offset arithmetic this codebase already "
    + "shipped is preserved rather than corrected, and it is said out loud",
    periodSpanDays(rolling30) === 31, String(periodSpanDays(rolling30)));

  const allDates = resolvePeriod("agenda", AUG3, { anchoring: "all" });
  ok("1f. 'all dates' is a third anchoring, is NOT bounded, and reads as itself",
    allDates.anchoring === "all" && allDates.bounded === false && periodLabel(allDates) === ALL_DATES_LABEL,
    JSON.stringify(allDates));
  ok("1f-control. and both other anchorings ARE bounded, so 1f is not passing on a field nobody sets",
    thisMonth.bounded === true && rolling30.bounded === true);
  ok("1g. periodSpanDays refuses to invent a length for an unbounded period",
    periodSpanDays(allDates) === null, String(periodSpanDays(allDates)));

  // Rolling of nought days is TODAY, which is what HISTORY_PERIODS's first chip has always meant.
  const rolling0 = resolvePeriod("agenda", AUG3, { anchoring: "rolling", backDays: 0, todayDate: AUG3 });
  ok("1h. a rolling window of nought back is today alone, and says 'Today'",
    rolling0.fromDate === AUG3 && rolling0.toDate === AUG3 && periodLabel(rolling0).startsWith("Today"),
    periodLabel(rolling0));

  // ⚠ A rolling window CANNOT be measured from a today the module invented.
  const noToday = resolvePeriod("month", AUG3, { anchoring: "rolling", backDays: 30, todayDate: null });
  ok("1i. ⚠ a rolling request with no today falls back to the CALENDAR rather than reaching for the "
    + "renderer's clock -- which is the wrong day for three hours of every Kampala morning",
    noToday.anchoring === "calendar" && noToday.view === "month", JSON.stringify(noToday));

  // ── the planner's four views and six quick periods are UNTOUCHED ──────────────────────────────────
  ok("1j. ⚠ the four views are still four -- rolling is an ANCHORING, not a fifth view, so the "
    + "planner's own assertion cannot be broken by this work",
    PERIOD_VIEWS.length === 4, PERIOD_VIEWS.map(v => v.key).join(","));
  ok("1k. and s3's six quick periods are still exactly six",
    QUICK_PERIODS.length === 6, String(QUICK_PERIODS.length));
  ok("1l-control. the rolling list is non-empty, so every assertion over it below means something",
    ROLLING_PERIODS.length >= 4, String(ROLLING_PERIODS.length));
  ok("1l. every rolling chip resolves to a rolling period of its own offset",
    ROLLING_PERIODS.every(r => {
      const p = resolveTarget(rollingPeriodTarget(r.backDays, AUG3), AUG3);
      return p.anchoring === "rolling" && p.backDays === r.backDays
        && p.toDate === AUG3 && p.fromDate === addDaysIso(AUG3, -r.backDays);
    }));

  // ── shifting ──────────────────────────────────────────────────────────────────────────────────────
  const shifted = shiftPeriod(rolling30, -1);
  ok("1m. ⚠ shifting a rolling window returns FIXED dates -- so nobody is ever looking at a header "
    + "reading 'Last 30 days' over a window that is not the last 30 days",
    shifted.from !== null && shifted.to !== null
    && daysBetweenIso(shifted.from!, shifted.to!) === daysBetweenIso(rolling30.fromDate, rolling30.toDate)
    && shifted.to! < rolling30.fromDate,
    JSON.stringify(shifted));
  const shiftedAll = shiftPeriod(allDates, -1);
  ok("1n. shifting an unbounded period steps by a whole MONTH rather than by the length of the month "
    + "it happened to be standing on",
    shiftedAll.from === "2026-07-01" && shiftedAll.to === "2026-07-31", JSON.stringify(shiftedAll));

  // ── the URL contract round-trips ──────────────────────────────────────────────────────────────────
  const roundTrip = (p: PeriodRange) => {
    const params = periodToParams({
      view: p.view, anchorDate: p.anchorDate, from: p.bounded ? p.fromDate : null,
      to: p.bounded ? p.toDate : null, anchoring: p.anchoring, backDays: p.backDays,
    });
    return periodFromParams(k => params[k] ?? null, AUG3, allDatesTarget(AUG3));
  };
  ok("1o. a period survives being written into a URL and read back -- all three anchorings",
    [thisMonth, rolling30, allDates].every(p => {
      const back = roundTrip(p);
      return back.anchoring === p.anchoring && back.fromDate === p.fromDate && back.toDate === p.toDate;
    }));
  ok("1p. ⚠ an unreadable period falls back to the caller's own default rather than narrowing to "
    + "nothing -- `?pa=banana` must not render as an empty register",
    (() => {
      const junk = periodFromParams(k => (k === PERIOD_PARAMS.anchoring ? "banana" : null), AUG3,
        { view: "agenda", anchorDate: AUG3, from: null, to: null, anchoring: "rolling", backDays: 30 });
      return junk.anchoring === "rolling" && junk.backDays === 30;
    })());
  ok("1q. ⚠ and the fallback is the CALLER's, not one the module picked: two callers with different "
    + "defaults get different answers from the same empty URL",
    (() => {
      const a = periodFromParams(() => null, AUG3, allDatesTarget(AUG3));
      const b = periodFromParams(() => null, AUG3,
        { view: "agenda", anchorDate: AUG3, from: null, to: null, anchoring: "rolling", backDays: 29 });
      return a.anchoring === "all" && b.anchoring === "rolling" && b.backDays === 29;
    })());

  // ⚠ THE HARD RULE: this module still imports NOTHING, or the control cannot be mounted on a client.
  const periodImports = src("src/lib/practice/period-range.ts").split("\n")
    .filter(l => /^\s*import\s/.test(l) || /\brequire\(/.test(l));
  ok("1r. ⚠ period-range.ts STILL imports nothing after being extended",
    periodImports.length === 0, periodImports.join(" | "));
  ok("1r-control. and it is still the real module -- it exports the resolver, the views AND the new "
    + "anchoring, so 1r is not passing on a truncated file",
    /export function resolvePeriod\(/.test(src("src/lib/practice/period-range.ts"))
    && /export const PERIOD_VIEWS/.test(src("src/lib/practice/period-range.ts"))
    && /anchoring: "rolling"/.test(src("src/lib/practice/period-range.ts")));

  const navPracticeImports = [...src("src/components/practice/PeriodNavigator.tsx")
    .matchAll(/from\s+["'](@\/lib\/practice\/[^"']+)["']/g)].map(m => m[1]);
  ok("1s-control. the shared control really does import from the practice library",
    navPracticeImports.length >= 1, navPracticeImports.join(", "));
  ok("1s. ⚠ and period-range is STILL the only practice module it touches -- it is now mounted on six "
    + "screens, so one server import here would be six bundles",
    navPracticeImports.every(i => i === "@/lib/practice/period-range"), navPracticeImports.join(", "));

  // ══ 2. ROLLING STILL MEANS ROLLING -- THE ENCOUNTERS REGISTER ═════════════════════════════════════
  //
  // ⚠ THE "BEFORE" IS NOT WRITTEN HERE. It is the function that was actually shipped, taken out of git
  // and executed. Trap (c): a reference implementation typed today by the hand that wrote the
  // replacement can agree with the replacement and disagree with what users had.
  section("2. rolling still means rolling (the before is extracted from git)");

  const headSource = execFileSync("git", ["show", "HEAD:src/lib/practice/encounters-landing.ts"],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const oldFn = headSource.match(/^function resolveHistoryFilter[\s\S]*?\n\}/m)?.[0] ?? "";
  ok("2a-control. the shipped implementation was found in git and it contains the arithmetic that "
    + "matters -- without this, everything below could be comparing against an empty string",
    oldFn.includes("end.getTime() - days * 86400000") && oldFn.includes("start.toISOString().slice(0, 10)"),
    `${oldFn.length} chars`);

  // The BODY is verbatim; only the type annotations in the signature are removed so it can be run.
  const runnable = oldFn
    .replace("function resolveHistoryFilter(opts: LandingOptions, today: string): HistoryFilter {",
      "export function resolveHistoryFilter(opts: any, today: any): any {")
    .replace("let from: string | null = null;", "let from = null;")
    .replace("let to: string | null = null;", "let to = null;")
    .replace("opts.historyPage!)", "opts.historyPage)");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "period-before-"));
  const tmpFile = path.join(tmpDir, "before.ts");
  fs.writeFileSync(tmpFile,
    `import { HISTORY_PERIODS, HISTORY_STATES, DEFAULT_HISTORY_PERIOD } from `
    + `${JSON.stringify(path.join(process.cwd(), "src/lib/practice/encounters-landing-constants").replace(/\\/g, "/"))};\n`
    + runnable + "\n");
  const before = (await import(`file://${tmpFile.replace(/\\/g, "/")}`)) as {
    resolveHistoryFilter: (opts: any, today: any) => { period: string; from: string | null; to: string | null };
  };

  // Two todays, so an implementation that happened to be right on one day is not enough.
  const TODAYS = ["2026-08-03", "2027-03-01"];
  const mismatches: string[] = [];
  let compared = 0;
  for (const today of TODAYS) {
    for (const p of HISTORY_PERIODS) {
      const old = before.resolveHistoryFilter({ historyPeriod: p.key }, today);
      const now = historyPeriodRange(p.key as any, today);
      const nowFrom = now.bounded ? now.fromDate : null;
      const nowTo = now.bounded ? now.toDate : null;
      compared++;
      if (old.from !== nowFrom || old.to !== nowTo)
        mismatches.push(`${today}/${p.key}: was ${old.from}..${old.to}, now ${nowFrom}..${nowTo}`);
    }
  }
  ok("2b-control. ⚠ the comparison actually ran over a NON-EMPTY set -- trap (b): asserting 'no "
    + "mismatches' over nothing is the commonest false green in this codebase",
    compared === TODAYS.length * HISTORY_PERIODS.length && compared >= 8, `${compared} comparisons`);
  ok("2c. ⚠ EVERY s4.7 PERIOD RESOLVES TO THE IDENTICAL PAIR OF DATES IT DID BEFORE. The dates, not "
    + "the label. This is the assertion the owner asked for first",
    mismatches.length === 0, mismatches.join(" | "));

  ok("2d. ⚠ and the DEFAULT did not move: no period in the URL is still 30 days back to today",
    (() => {
      const old = before.resolveHistoryFilter({}, "2026-08-03");
      const now = historyPeriodRange(DEFAULT_HISTORY_PERIOD, "2026-08-03");
      return old.period === DEFAULT_HISTORY_PERIOD && old.from === now.fromDate && old.to === now.toDate
        && old.from === "2026-07-04";
    })(), JSON.stringify(before.resolveHistoryFilter({}, "2026-08-03")));

  ok("2e. ⚠ CONTROL: the comparison can FAIL. A deliberately calendar-anchored answer -- 'this month' "
    + "in place of 'last 30 days' -- is rejected, which is exactly the substitution being guarded against",
    (() => {
      const old = before.resolveHistoryFilter({ historyPeriod: "30d" }, "2026-08-03");
      const calendar = resolvePeriod("month", "2026-08-03");
      return old.from !== calendar.focusFromDate;
    })());

  ok("2f. a custom range with BOTH ends is a calendar range and keeps both",
    (() => {
      const r = historyPeriodRange("custom", "2026-08-03", { from: "2026-01-01", to: "2026-01-31" });
      return r.anchoring === "calendar" && r.fromDate === "2026-01-01" && r.toDate === "2026-01-31";
    })());
  ok("2g. ⚠ a custom range with NEITHER end is unbounded -- which is what an empty custom has always "
    + "done, and is why the module has a name for an absent period",
    historyPeriodRange("custom", "2026-08-03").bounded === false);
  ok("2h. a rolling window s4.7 does not name lights no chip rather than the nearest one",
    historyPeriodKeyFor(resolvePeriod("agenda", "2026-08-03",
      { anchoring: "rolling", backDays: 90, todayDate: "2026-08-03" })) === "custom"
    && historyPeriodKeyFor(resolvePeriod("agenda", "2026-08-03",
      { anchoring: "rolling", backDays: 7, todayDate: "2026-08-03" })) === "7d");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  ok("2i. the extracted 'before' module was deleted after use", !fs.existsSync(tmpFile));

  // ══ 3. ROLLING STILL MEANS ROLLING -- REPORTS ═════════════════════════════════════════════════════
  //
  // reports.ts was NOT modified, so its resolvePeriod IS the before. `days=30` means thirty days
  // INCLUSIVE there -- a different convention from the encounters register, which is why the page maps
  // it to an offset of twenty-nine rather than thirty.
  section("3. reports: `days=N` still means N days inclusive");

  await cleanup();
  const ws = await provision(OWNER, "Period Harness", "a");
  const wsOther = await provision(OTHER, "Other Practice", "b");
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) throw new Error(`no workspace context: ${ctxRes.reason}`);
  const ctx: WorkspaceContext = ctxRes.ctx;
  const { data: wsRow } = await admin.from("practice_workspace").select("timezone").eq("id", ws).maybeSingle();
  const tz = wsRow?.timezone ?? "UTC";
  const today = new Intl.DateTimeFormat("en-CA",
    { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const reportMismatch: string[] = [];
  let reportCompared = 0;
  for (const days of [7, 30, 90, 365]) {
    const engine = await reportsPeriod(admin, ws, { days });
    // The mapping the page performs, in the page's own words: backDays = days - 1.
    const mapped = resolvePeriod("agenda", today,
      { anchoring: "rolling", backDays: days - 1, todayDate: today });
    reportCompared++;
    if (engine.fromDay !== mapped.fromDate || engine.toDay !== mapped.toDate)
      reportMismatch.push(`days=${days}: engine ${engine.fromDay}..${engine.toDay}, mapped ${mapped.fromDate}..${mapped.toDate}`);
  }
  ok("3a-control. the comparison ran over four windows against the LIVE, unmodified reports engine",
    reportCompared === 4, String(reportCompared));
  ok("3b. ⚠ `?days=N` resolves to the identical range the untouched engine produces -- so every "
    + "bookmarked report in the practice still covers the days it covered",
    reportMismatch.length === 0, reportMismatch.join(" | "));
  ok("3c. ⚠ CONTROL: mapping it to N BACK instead of N-1 really would move the boundary, so 3b is not "
    + "true of any mapping at all",
    (() => {
      const engine30Start = addDaysIso(today, -29);
      const wrong = resolvePeriod("agenda", today, { anchoring: "rolling", backDays: 30, todayDate: today });
      return wrong.fromDate !== engine30Start;
    })());
  ok("3d. ⚠ and the two conventions really do disagree in this codebase: reports means 30 days "
    + "inclusive by 'days=30', the encounters register means 31. Both are preserved; neither is "
    + "silently corrected",
    (await reportsPeriod(admin, ws, { days: 30 })).fromDay === addDaysIso(today, -29)
    && historyPeriodRange("30d", today).fromDate === addDaysIso(today, -30));

  // ══ 4. THE LOADERS RESPECT THE RANGE ══════════════════════════════════════════════════════════════
  section("4. fixtures");

  const OLD_DAY = "2026-01-15";          // a day we will put data on
  const QUIET_DAY = "2026-02-20";        // a day we will put nothing on
  const OLD_ISO = `${OLD_DAY}T09:00:00.000Z`;

  const pat = await registerPatient(admin, {
    workspaceId: ws, displayName: "Aine Kabuye", sex: "female", birthDate: "1990-04-04", phone: "+256772000901",
    actorId: OWNER, correlationId: CID,
  });
  if (!pat.ok) throw new Error(`patient: ${pat.message}`);
  const patientId = pat.data.id;

  const act = await recordActivity(admin, {
    workspaceId: ws, kind: "ward_round", title: "Morning ward round", occurredAt: OLD_ISO,
    durationMinutes: 60, actorId: OWNER, correlationId: CID,
  });
  ok("4a-control. the activity fixture was written", act.ok, act.ok ? "" : (act as any).message);

  const fu = await createFollowUp(admin, {
    workspaceId: ws, patientId, reason: "Review blood pressure", dueOn: OLD_DAY,
    actorId: OWNER, correlationId: CID,
  });
  ok("4b-control. the follow-up fixture was written, due on the day with data",
    fu.ok && fu.data.dueOn === OLD_DAY, fu.ok ? fu.data.dueOn : (fu as any).message);

  const inc = await recordIncoming(admin, {
    workspaceId: ws, patientId, source: "District laboratory", title: "Malaria smear",
    receivedOn: OLD_DAY, actorId: OWNER, correlationId: CID,
  });
  ok("4c-control. the incoming-document fixture was written", inc.ok, inc.ok ? "" : (inc as any).message);

  const enc = await launchEncounter(admin, {
    workspaceId: ws, patientId, pathway: "new_walk_in", actorId: OWNER, correlationId: CID,
  });
  ok("4d-control. an encounter fixture exists", enc.ok, enc.ok ? "" : (enc as any).message);
  if (enc.ok) {
    // Backdated and closed, so it is in the SIGNED/AMENDED register the history period filters.
    await admin.from("practice_encounter")
      .update({ started_at: OLD_ISO, completed_at: OLD_ISO, signed_at: OLD_ISO, status: "SIGNED" })
      .eq("id", enc.data.id);
  }
  // The patient's own record is backdated too, so the register's period has something to find.
  await admin.from("practice_patient").update({ created_at: OLD_ISO }).eq("id", patientId);

  const withDay = resolvePeriod("day", OLD_DAY);
  const quietDay = resolvePeriod("day", QUIET_DAY);

  section("4. the loader is bounded by the range, screen by screen");

  // ---- activity ----
  const actOn = await listActivitiesResult(admin, ws, { fromDay: withDay.fromDate, toDay: withDay.toDate });
  const actOff = await listActivitiesResult(admin, ws, { fromDay: quietDay.fromDate, toDay: quietDay.toDate });
  ok("4e. ⚠ ACTIVITY: a day with data and a day without produce DIFFERENT payloads, and neither read "
    + "failed -- so the query is bounded by the range and not merely described by it",
    actOn.items.length === 1 && actOff.items.length === 0
    && !actOn.unavailable && !actOff.unavailable,
    `${actOn.items.length} vs ${actOff.items.length}`);
  const actAll = await listActivitiesResult(admin, ws, {});
  ok("4e-control. and with NO period the same read finds it, so 4e's empty day is the range's doing "
    + "and not an empty table",
    actAll.items.length === 1, String(actAll.items.length));

  const portOn = await portfolioSummary(admin, ws, OWNER, { fromDay: withDay.fromDate, toDay: withDay.toDate });
  const portOff = await portfolioSummary(admin, ws, OWNER, { fromDay: quietDay.fromDate, toDay: quietDay.toDate });
  ok("4f. ACTIVITY: the portfolio figures move with the period too -- a period control over a list "
    + "whose summary ignored it would print two different answers on one screen",
    portOn.activities.total === 1 && portOff.activities.total === 0,
    `${portOn.activities.total} vs ${portOff.activities.total}`);

  // ---- follow-ups ----
  const fuOn = await followUpWorkspace(admin, ws, { dueFrom: withDay.fromDate, dueTo: withDay.toDate });
  const fuOff = await followUpWorkspace(admin, ws, { dueFrom: quietDay.fromDate, dueTo: quietDay.toDate });
  ok("4g. ⚠ FOLLOW-UPS: bounded on due_on -- a day with an obligation and a day without differ",
    fuOn.readCount === 1 && fuOff.readCount === 0 && !fuOn.unavailable && !fuOff.unavailable,
    `${fuOn.readCount} vs ${fuOff.readCount}`);
  const fuAll = await followUpWorkspace(admin, ws, {});
  ok("4g-control. and the unbounded board still holds it -- 4g's empty day is not an empty queue",
    fuAll.readCount === 1, String(fuAll.readCount));

  // ---- documents ----
  const docOn = await documentRegister(admin, ws, { from: withDay.fromDate, to: withDay.toDate });
  const docOff = await documentRegister(admin, ws, { from: quietDay.fromDate, to: quietDay.toDate });
  ok("4h. ⚠ DOCUMENTS: the range reaches the THREE QUERIES, not just the filter over the newest 500 "
    + "rows -- which is the defect that made an old period return nothing in a busy practice",
    docOn.rows.length === 1 && docOff.rows.length === 0
    && docOn.unreadable.length === 0 && docOff.unreadable.length === 0,
    `${docOn.rows.length} vs ${docOff.rows.length} | ${JSON.stringify(docOn.unreadable)}`);
  const docAll = await documentRegister(admin, ws, {});
  ok("4h-control. the unbounded register holds it, so 4h's empty period is the range's doing",
    docAll.rows.length === 1, String(docAll.rows.length));
  // ⚠ THE ONE ASSERTION THAT CAN TELL A PUSH-DOWN FROM AN IN-MEMORY FILTER. Every other observable is
  // the same either way: the rows come out identical whether the range bounded the QUERY or only the
  // predicate over what the query returned -- and "the same either way" is exactly the shape of a
  // period control that changes the address bar and reads the whole register.
  ok("4h-push. ⚠ DOCUMENTS: under a quiet period the three queries return NOTHING AT ALL, so the range "
    + "reached the database rather than being applied to 500 rows it had already fetched",
    docOff.sourceRowsRead === 0 && docOn.sourceRowsRead >= 1 && docAll.sourceRowsRead >= 1,
    `quiet ${docOff.sourceRowsRead}, with-data ${docOn.sourceRowsRead}, unbounded ${docAll.sourceRowsRead}`);

  // ---- patients ----
  const patOn = await myPatients(admin, ctx, { registeredFrom: withDay.fromDate, registeredTo: withDay.toDate });
  const patOff = await myPatients(admin, ctx, { registeredFrom: quietDay.fromDate, registeredTo: quietDay.toDate });
  ok("4i. ⚠ PATIENTS: the register is bounded on registration date, and the TOTAL moves with the rows "
    + "-- a count that ignored the period would print a figure over a table that contradicted it",
    patOn.rows.length === 1 && patOff.rows.length === 0
    && patOn.total === 1 && patOff.total === 0 && !patOn.unavailable && !patOff.unavailable,
    `${patOn.rows.length}/${patOn.total} vs ${patOff.rows.length}/${patOff.total}`);
  const patAll = await myPatients(admin, ctx, {});
  ok("4i-control. the unbounded register holds the patient",
    patAll.rows.length === 1, String(patAll.rows.length));

  // ---- encounters ----
  const encOn = await encountersLanding(admin, ctx, {
    historyPeriod: "custom", historyFrom: OLD_DAY, historyTo: OLD_DAY,
  });
  const encOff = await encountersLanding(admin, ctx, {
    historyPeriod: "custom", historyFrom: QUIET_DAY, historyTo: QUIET_DAY,
  });
  ok("4j. ⚠ ENCOUNTERS: the history register is bounded -- and it was before this work, which is why "
    + "this assertion is here to prove the migration did not lose it",
    encOn.history.items.length === 1 && encOff.history.items.length === 0
    && !encOn.history.unavailable && !encOff.history.unavailable,
    `${encOn.history.items.length} vs ${encOff.history.items.length}`);
  const encGeneric = await encountersLanding(admin, ctx, {
    periodParams: { [PERIOD_PARAMS.view]: "day", [PERIOD_PARAMS.date]: OLD_DAY },
  });
  ok("4k. ⚠ and the SHARED url contract reaches the same read -- a named calendar day, which is what "
    + "the practice owner asked for and what s4.7's three rolling chips could not express",
    encGeneric.history.items.length === 1
    && encGeneric.historyFilter.from === OLD_DAY && encGeneric.historyFilter.to === OLD_DAY,
    JSON.stringify(encGeneric.historyFilter));
  const encLegacy = await encountersLanding(admin, ctx, { historyPeriod: "7d" });
  ok("4k-control. ⚠ and the OLD url keys still work when the new ones are absent, so a link a "
    + "practitioner sent last week opens the same seven days",
    encLegacy.historyFilter.period === "7d"
    && encLegacy.historyFilter.from === addDaysIso(encLegacy.today, -7)
    && encLegacy.historyFilter.to === encLegacy.today,
    JSON.stringify(encLegacy.historyFilter));

  // ---- reports ----
  const repOn = await reportsPeriod(admin, ws, { fromDay: OLD_DAY, toDay: OLD_DAY });
  const repOff = await reportsPeriod(admin, ws, { fromDay: QUIET_DAY, toDay: QUIET_DAY });
  const { count: encOnCount } = await admin.from("practice_encounter")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).gte("started_at", repOn.fromIso).lt("started_at", repOn.toIso);
  const { count: encOffCount } = await admin.from("practice_encounter")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).gte("started_at", repOff.fromIso).lt("started_at", repOff.toIso);
  ok("4l. ⚠ REPORTS: the resolved window really does bound the counts the page reads",
    encOnCount === 1 && encOffCount === 0, `${encOnCount} vs ${encOffCount}`);

  // ---- tenancy, so none of the above is passing over one shared table ----
  const otherDocs = await documentRegister(admin, wsOther, {});
  ok("4m-control. the other practice exists and holds nothing of ours, so every count above belongs "
    + "to the workspace it was asked for",
    otherDocs.rows.length === 0 && otherDocs.unreadable.length === 0);

  // ══ 5. AN UNREADABLE READ IS NOT AN EMPTY PERIOD ══════════════════════════════════════════════════
  section("5. unreadable is not empty, screen by screen, each with a control");

  const brokeAct = await listActivitiesResult(
    failingOn("practice_clinical_activity", "connection refused"), ws, {});
  ok("5a. ⚠ ACTIVITY: a failed read reports unavailable WITH the database's own words, and does not "
    + "return an empty log -- which on a portfolio is a claim that somebody did no work",
    brokeAct.unavailable && brokeAct.detail === "connection refused" && brokeAct.items.length === 0);
  ok("5a-control. and the real client reports available over the same call, so 5a is not always true",
    !actAll.unavailable && actAll.items.length === 1);

  const brokePort = await portfolioSummary(
    failingOn("practice_clinical_activity", "permission denied"), ws, OWNER, {});
  ok("5b. ⚠ ACTIVITY: the portfolio says its figures could not be read rather than printing noughts",
    brokePort.unavailable && (brokePort.unavailableDetail ?? "").includes("permission denied"));
  ok("5b-control. and the real portfolio is available",
    !(await portfolioSummary(admin, ws, OWNER, {})).unavailable);

  const brokeFu = await followUpWorkspace(failingOn("practice_follow_up", "timeout"), ws, {});
  ok("5c. ⚠ FOLLOW-UPS: an unreadable queue is unavailable, and every card's count is NULL rather "
    + "than nought -- 'nobody is waiting' is the sentence somebody acts on by going home",
    brokeFu.unavailable && brokeFu.cards.length > 0 && brokeFu.cards.every(c => c.count === null),
    JSON.stringify(brokeFu.cards.map(c => c.count)));
  ok("5c-control. the real board reports available and its cards carry numbers",
    !fuAll.unavailable && fuAll.cards.length > 0 && fuAll.cards.every(c => c.count !== null));

  const brokeDoc = await documentRegister(failingOn("practice_incoming_document", "relation missing"), ws, {});
  ok("5d. ⚠ DOCUMENTS: the failing source is NAMED and the others still answer -- 'the incoming "
    + "register could not be read' and 'nothing could be read' are different sentences",
    brokeDoc.unreadable.length === 1 && brokeDoc.unreadable[0].source === "incoming register"
    && brokeDoc.unreadable[0].detail === "relation missing",
    JSON.stringify(brokeDoc.unreadable));
  const brokeOverview = await documentsOverview(
    failingOn("practice_incoming_document", "relation missing"), ws,
    { userId: OWNER, capabilities: ctx.capabilities });
  const awaiting = brokeOverview.cards.find(c => c.key === "awaiting_review");
  ok("5e. ⚠ DOCUMENTS: the card that counts the failed source is UNREADABLE, not nought -- and the "
    + "page's 'this practice is empty, here is how to start' is withheld",
    awaiting?.count.state === "unreadable" && brokeOverview.empty === false,
    JSON.stringify(awaiting?.count));
  const realOverview = await documentsOverview(admin, ws, { userId: OWNER, capabilities: ctx.capabilities });
  ok("5e-control. and the real overview counts it as a number",
    realOverview.cards.find(c => c.key === "awaiting_review")?.count.state === "ok");
  ok("5f. ⚠ DOCUMENTS: a chosen period NEVER produces 'this practice has no documents yet'. That "
    + "sentence is a claim about the practice, and a reader who narrowed to a quiet fortnight has not "
    + "made it",
    (await documentsOverview(admin, ws, {
      userId: OWNER, capabilities: ctx.capabilities, from: QUIET_DAY, to: QUIET_DAY,
    })).empty === false);
  ok("5f-control. and an unbounded read of a workspace with nothing in it DOES say it is empty, so "
    + "5f is not passing because the flag is never true",
    (await documentsOverview(admin, wsOther, { userId: OTHER, capabilities: [] })).empty === true);

  const brokePat = await myPatients(failingOn("practice_patient", "read failed"), ctx, {});
  ok("5g. ⚠ PATIENTS: an unreadable register is unavailable with a reason, not an empty cohort",
    brokePat.unavailable && brokePat.reason === "read_failed" && brokePat.rows.length === 0,
    JSON.stringify({ u: brokePat.unavailable, r: brokePat.reason }));
  ok("5g-control. the real register is available",
    !patAll.unavailable && patAll.rows.length === 1);

  const brokeEnc = await encountersLanding(failingOn("practice_encounter", "connection refused"), ctx, {});
  ok("5h. ⚠ ENCOUNTERS: an unreadable history panel is unavailable, and every tab count is null "
    + "rather than nought",
    brokeEnc.history.unavailable && brokeEnc.countsUnavailable
    && brokeEnc.counts.open === null && brokeEnc.counts.all === null);
  ok("5h-control. the real board reads counts as numbers",
    !encGeneric.history.unavailable && encGeneric.counts.open !== null);

  // ══ 6. THE SCREENS ACTUALLY MOUNT IT ══════════════════════════════════════════════════════════════
  //
  // ⚠ SOURCE SCANS, WITH COMMENTS STRIPPED (trap a). Each adapter's header explains at length what the
  // control is for; a scan over raw source would match the explanation whether or not the component was
  // ever rendered.
  section("6. every adopted screen mounts the shared control and bounds its own read");

  const ADOPTED: { screen: string; page: string; adapter: string }[] = [
    { screen: "activity", page: "src/app/practice/(shell)/activity/page.tsx", adapter: "ActivityNavigator" },
    { screen: "documents", page: "src/app/practice/(shell)/documents/page.tsx", adapter: "DocumentsNavigator" },
    { screen: "follow-ups", page: "src/app/practice/(shell)/follow-ups/page.tsx", adapter: "FollowUpsNavigator" },
    { screen: "encounters", page: "src/app/practice/(shell)/encounters/page.tsx", adapter: "HistoryNavigator" },
    { screen: "patients", page: "src/app/practice/(shell)/patients/page.tsx", adapter: "RegisterNavigator" },
    { screen: "reports", page: "src/app/practice/(shell)/reports/page.tsx", adapter: "ReportsNavigator" },
    { screen: "reports/analytics", page: "src/app/practice/(shell)/reports/analytics/page.tsx", adapter: "ReportsNavigator" },
  ];
  ok("6a-control. ⚠ the adopted list is non-empty and every page named really exists -- trap (b)",
    ADOPTED.length === 7 && ADOPTED.every(a => fs.existsSync(path.join(process.cwd(), a.page))),
    ADOPTED.filter(a => !fs.existsSync(path.join(process.cwd(), a.page))).map(a => a.page).join(", "));

  const notMounted = ADOPTED.filter(a => !new RegExp(`<${a.adapter}\\b`).test(src(a.page)));
  ok("6b. every adopted screen RENDERS its adapter",
    notMounted.length === 0, notMounted.map(a => a.screen).join(", "));

  // ⚠ WHERE THE RESOLUTION HAPPENS IS PER-SCREEN AND THE LIST SAYS SO RATHER THAN GUESSING. Five pages
  // resolve the period themselves; encounters hands the query values to its loader, which resolves them
  // there because that is where the filter that uses them lives. What must be true of all of them is
  // that it happens ON THE SERVER -- a period resolved in the browser is one the query never saw.
  const RESOLVED_IN: Record<string, string> = Object.fromEntries(
    ADOPTED.map(a => [a.screen, a.screen === "encounters" ? "src/lib/practice/encounters-landing.ts" : a.page]),
  );
  const notResolved = ADOPTED.filter(a => !/periodFromParams\(/.test(src(RESOLVED_IN[a.screen])));
  ok("6c. every adopted screen resolves the period SERVER-SIDE from the URL",
    notResolved.length === 0, notResolved.map(a => a.screen).join(", "));
  ok("6c-control. ⚠ and the encounters PAGE really does hand the shared query keys down, so 6c is not "
    + "excused by pointing at a loader nothing calls with them",
    /PERIOD_PARAMS/.test(src(ADOPTED.find(a => a.screen === "encounters")!.page))
    && /periodParams:/.test(src(ADOPTED.find(a => a.screen === "encounters")!.page)));

  const adapters = [...new Set(ADOPTED.map(a => a.adapter))].map(name => {
    const dir = ADOPTED.find(x => x.adapter === name)!.page.replace(/page\.tsx$/, "");
    const p = fs.existsSync(path.join(process.cwd(), `${dir}${name}.tsx`))
      ? `${dir}${name}.tsx`
      : `${dir}../${name}.tsx`;
    return { name, path: p };
  });
  ok("6d-control. every adapter file was found",
    adapters.every(a => fs.existsSync(path.join(process.cwd(), a.path))),
    adapters.filter(a => !fs.existsSync(path.join(process.cwd(), a.path))).map(a => a.path).join(", "));
  ok("6e. ⚠ every adapter is an ADAPTER over the ONE control, not a second control -- six screens with "
    + "six period pickers is how 'last week' comes to mean six things",
    adapters.every(a => /from\s+["']@\/components\/practice\/PeriodNavigator["']/.test(src(a.path))));
  ok("6f. ⚠ and no adapter imports a server engine. A 'use client' file that reached one would drag "
    + "next/headers into six bundles, which tsc and eslint both pass",
    adapters.every(a => [...src(a.path).matchAll(/from\s+["'](@\/lib\/practice\/[^"']+)["']/g)]
      .every(m => m[1] === "@/lib/practice/period-range")),
    adapters.map(a => [...src(a.path).matchAll(/from\s+["'](@\/lib\/practice\/[^"']+)["']/g)]
      .map(m => m[1]).join("+")).join(" | "));

  // ⚠ THE PERIOD RIDES ALONG WITH EVERY OTHER CONTROL ON ITS OWN SCREEN.
  //
  // Three of these screens rebuild their URL from scratch somewhere OTHER than the navigator -- the
  // encounters pager, the activity kind filter, the patients cohort table. Each one silently dropped the
  // period until it was made to carry it, and the symptom is the worst kind: the register widens back
  // out to every date while the control above it stays lit as though it were still narrow.
  const RIDE_ALONG: { what: string; file: string; needs: RegExp }[] = [
    { what: "the encounters history pager", file: "src/app/practice/(shell)/encounters/page.tsx", needs: /periodHere/ },
    { what: "the activity kind filter", file: "src/app/practice/(shell)/activity/ActivityConsole.tsx", needs: /\$\{periodQuery\}/ },
    { what: "the patients cohort table", file: "src/app/practice/(shell)/patients/PatientsScreen.tsx", needs: /props\.periodParams/ },
  ];
  ok("6i-control. every file named in the ride-along list exists",
    RIDE_ALONG.every(r => fs.existsSync(path.join(process.cwd(), r.file))));
  const dropped = RIDE_ALONG.filter(r => !r.needs.test(src(r.file)));
  ok("6i. ⚠ every URL a screen builds OUTSIDE its navigator carries the period too -- paging, filtering "
    + "and sorting must not silently widen a narrowed register",
    dropped.length === 0, dropped.map(r => r.what).join(", "));
  ok("6i-control-2. ⚠ and the encounters pager no longer re-emits the LEGACY period keys, which the "
    + "loader ignores whenever the shared ones are present -- that combination is how a named calendar "
    + "day would silently become the default thirty on the second page",
    !/hperiod: d\.historyFilter\.period/.test(src("src/app/practice/(shell)/encounters/page.tsx")));

  // ⚠ A FUNCTION ON A PAYLOAD PASSED TO A CLIENT COMPONENT KILLS THE PAGE -- tsc passes, the API is
  // fine, the page is dead. Every payload the adapters receive is walked here.
  const walkForFunctions = (v: unknown, at = "$", seen = new Set<unknown>()): string[] => {
    if (typeof v === "function") return [at];
    if (v === null || typeof v !== "object") return [];
    if (seen.has(v)) return [];
    seen.add(v);
    return Object.entries(v as Record<string, unknown>)
      .flatMap(([k, x]) => walkForFunctions(x, `${at}.${k}`, seen));
  };
  const clientPayloads: [string, unknown][] = [
    ["period (rolling)", rolling30], ["period (calendar)", thisMonth], ["period (all)", allDates],
    ["encounters historyFilter.range", encGeneric.historyFilter.range],
    ["follow-ups workspace", fuAll],
    ["documents overview", realOverview],
    ["patients cohort", patAll],
    ["activity items", actAll.items],
    ["portfolio", await portfolioSummary(admin, ws, OWNER, {})],
  ];
  ok("6g-control. the payload walk really ran over a non-empty set",
    clientPayloads.length >= 9, String(clientPayloads.length));
  const carriers = clientPayloads.filter(([, p]) => walkForFunctions(p).length > 0)
    .map(([n, p]) => `${n}${walkForFunctions(p).join(",")}`);
  ok("6h. ⚠ NO payload handed to a client component carries a FUNCTION",
    carriers.length === 0, carriers.join(" | "));
  ok("6h-control. and the walk really finds one when there is one, so 6h is not always true",
    walkForFunctions({ a: { b: () => 1 } }).length === 1);

  // ══ 7. CLEAN UP, AND PROVE IT ═════════════════════════════════════════════════════════════════════
  section("7. fixtures deleted");
  await cleanup();
  const { count: leftWorkspaces } = await admin.from("practice_workspace")
    .select("id", { count: "exact", head: true }).in("owner_person_id", [OWNER, OTHER]);
  const { count: leftPatients } = await admin.from("practice_patient")
    .select("id", { count: "exact", head: true }).in("workspace_id", [ws, wsOther]);
  const { count: leftActivities } = await admin.from("practice_clinical_activity")
    .select("id", { count: "exact", head: true }).in("workspace_id", [ws, wsOther]);
  ok("7a. ⚠ every fixture this harness created is gone -- workspaces, patients and activities",
    leftWorkspaces === 0 && leftPatients === 0 && leftActivities === 0,
    `${leftWorkspaces} workspaces, ${leftPatients} patients, ${leftActivities} activities`);

  console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log("\nFAILURES:"); fails.forEach(f => console.log("  " + f)); }
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(async e => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
