/**
 * Practice session-engine harness -- COMP-AUTH-001's session lifecycle: activity detection, the
 * sixty-second warning, the lock screen, Clinical Pause Mode and the absolute session lifetime.
 *
 * WHAT IT PROVES:
 *   1. ⚠ THIS ENGINE IS DORMANT ON THE DAY IT SHIPS. The one live security policy row carries
 *      `session_idle_minutes: null`, and a policy with no limit produces mode OBSERVE, which never
 *      warns, never covers a screen and never sends a heartbeat. A practice that SETS a limit gets
 *      ENFORCE, and the control proves the first result is not hardcoded.
 *   2. ⚠ A POLICY THAT COULD NOT BE READ IS NOT A POLICY WITH NO LIMIT. It produces UNKNOWN, which
 *      locks nothing -- proved against a client MADE to fail, with the failure probed first.
 *   3. THE WARNING NEVER EATS THE WHOLE LIMIT. Even at a pathological limit shorter than the warning
 *      window, a person gets some warning AND at least half their limit undisturbed.
 *   4. ⚠ THE HEARTBEAT CANNOT DEFEAT THE RULE IT SUPPORTS. A timer alone is not enough: without
 *      activity since the previous beat nothing is sent, so an abandoned tab does not keep itself alive.
 *      And a covered screen never beats.
 *   5. ⚠ AND NEITHER CAN THE MEASUREMENT. `idle_observed` and `locked` do not refresh `last_seen_at`;
 *      only `heartbeat` and `unlocked` do. An observation that ended the idleness it was measuring would
 *      erase every event it counted.
 *   6. THE HEARTBEAT'S REAL EFFECT IS REAL: `touchSession` moves `last_seen_at` forward, which is what
 *      stops an idle limit revoking somebody who has been typing on one page the whole time.
 *   7. AN OBSERVATION IS NOT A REFUSAL. Nothing was hidden and nobody was turned away, and the summary
 *      counts it apart from the refusals -- a practice reading "3 turned away" must not be reading
 *      three people who were let straight through.
 *   8. A PAUSE IS COUNTED APART FROM AN IDLE COVER, and the same occasion recorded twice is one row.
 *   9. ⚠ A FAILED TRAIL READ IS FOUR NULLS, NEVER FOUR ZEROES. "0 screens covered" is a statement about
 *      a practice; a database fault must not make it. Proved against a failing client, probe first.
 *  10. ⚠ THE ABSOLUTE SESSION LIFETIME IS MEASURED AND NOT ENFORCED, AND THE PAGE SAYS SO. There is no
 *      column to hold a cap, so the posture names the gap rather than implying one exists.
 *  11. ⚠ THE ENGINE IS ACTUALLY MOUNTED. This repository has shipped two controls that could never fire;
 *      the shell layout is read and the guard's mount is asserted, because an engine nothing renders is
 *      the same bug wearing new clothes.
 *  12. Cross-workspace isolation of every figure, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-session-engine-harness.ts
 */
import fs from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import {
  getSecurityPolicy, updateSecurityPolicy, touchSession, securityPosture,
} from "../src/lib/practice/security";
import { AUTH_EVENT, authTrailSummary, recordAuthEvent, AUTH_EVENTS_RECORDED } from "../src/lib/practice/auth-audit";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  resolveSessionLimits, idleDecision, shouldHeartbeat, absoluteLifetime, touchesSession,
  SESSION_ACTIONS, SESSION_WARNING_SECONDS, SESSION_HEARTBEAT_SECONDS, IDLE_OBSERVATION_MINUTES,
  ABSOLUTE_OBSERVATION_MINUTES, SESSION_ACTIVITY_EVENTS,
  LOCK_SCREEN_TRUTHS, RESUME_METHODS_NOT_BUILT, CLINICAL_PAUSE, ABSOLUTE_LIFETIME_NOT_ENFORCED,
  LOCK_ESCAPE_LABEL, CONSOLE_IDLE_OPTIONS,
  type SessionLimits,
} from "../src/lib/practice/session-engine";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e29a1";
const OTHER = "00000000-0000-4000-8000-0000000e29a2";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-ses-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-ses",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-ses", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

// ── THE FAULT INJECTOR ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ SIMULATE THE FAILURE; DO NOT ASSERT THE HAPPY PATH. An absence assertion that passes because the
// query errored is the bug class this repository has found twenty times. Every "a failed read is not a
// pass" assertion below therefore runs against a client MADE to fail on one named table, and asserts a
// PROBE first -- proof the read really did fail -- before asserting how the failure was handled.

const stubBuilder = (result: { data: unknown; error: unknown }): any => {
  const b: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return () => b;
    },
  });
  return b;
};

/** The real client, except that `table` always answers with an error. */
const brokenOn = (table: string): any => ({
  from(t: string) {
    if (t === table) return stubBuilder({ data: null, error: { message: `simulated failure on ${table}` } });
    return admin.from(t as any);
  },
});

const base = { actorId: OWNER, correlationId: "harness-ses" };

async function main() {
  console.log("\n=== PRACTICE SESSION ENGINE (COMP-AUTH-001 session lifecycle) ===\n");
  await cleanup();

  const A = await provision(OWNER, "Session Harness A", "a");
  const B = await provision(OTHER, "Session Harness B", "b");

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 1. THE THREE MODES, AND WHICH ONE EVERY PRACTICE IS IN TODAY --\n");

  const fresh = await getSecurityPolicy(admin, A);
  ok("0-control. a fresh practice's policy is readable (nothing below is asserting over a failed read)",
    fresh.readable === true, JSON.stringify(fresh));
  ok("0. and it carries no idle limit, which is the state every live practice is in",
    fresh.session_idle_minutes === null, String(fresh.session_idle_minutes));

  const observe = resolveSessionLimits(fresh);
  ok("1a. no limit set resolves to OBSERVE", observe.mode === "OBSERVE", observe.mode);
  ok("1b. and OBSERVE carries no idle minutes, so nothing can count down to anything",
    observe.idleMinutes === null, String(observe.idleMinutes));

  const setIt = await updateSecurityPolicy(admin, { ...base, workspaceId: A, sessionIdleMinutes: 30 });
  ok("1c-control. an idle limit can be set (the OBSERVE result above is not hardcoded)",
    setIt.ok === true && setIt.data.changed.includes("sessionIdleMinutes"), JSON.stringify(setIt));
  const enforce = resolveSessionLimits(await getSecurityPolicy(admin, A));
  ok("1d. a practice that sets a limit resolves to ENFORCE, with its own number",
    enforce.mode === "ENFORCE" && enforce.idleMinutes === 30, JSON.stringify(enforce));

  // ⚠ THE THIRD STATE. An unreadable policy carries `session_idle_minutes: null` in its placeholder, so
  // trusting that number would land it in OBSERVE and it would look exactly like a practice that had
  // chosen no limit. `readable` is what tells them apart.
  const brokenPolicy = await getSecurityPolicy(brokenOn("practice_security_policy"), A);
  ok("2-probe. the injected fault really did break the policy read",
    brokenPolicy.readable === false, JSON.stringify(brokenPolicy));
  ok("2a. ⚠ an unreadable policy is UNKNOWN, never OBSERVE -- a control that cannot run must not act",
    resolveSessionLimits(brokenPolicy).mode === "UNKNOWN", resolveSessionLimits(brokenPolicy).mode);
  ok("2b. and UNKNOWN is DORMANT at any idle time at all, so nothing is ever covered on a failed read",
    idleDecision({ idleMs: 40 * 86400000, limits: resolveSessionLimits(brokenPolicy) }).phase === "DORMANT");

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 2. THE IDLE DECISION --\n");

  const min = (m: number) => m * 60_000;
  ok("3a. OBSERVE is ACTIVE below the observation window",
    idleDecision({ idleMs: min(IDLE_OBSERVATION_MINUTES) - 1000, limits: observe }).phase === "ACTIVE");
  ok("3b. OBSERVE becomes OBSERVED at the window",
    idleDecision({ idleMs: min(IDLE_OBSERVATION_MINUTES), limits: observe }).phase === "OBSERVED");
  ok("3c. ⚠ AND OBSERVE NEVER LOCKS, at any idle time whatever -- ten days away covers nothing",
    idleDecision({ idleMs: min(60 * 24 * 10), limits: observe }).phase === "OBSERVED");
  ok("3d. and it offers no countdown, because there is nothing to count down to",
    idleDecision({ idleMs: min(60 * 24 * 10), limits: observe }).secondsToLock === null);

  ok("4a. ENFORCE is ACTIVE well before the limit",
    idleDecision({ idleMs: min(10), limits: enforce }).phase === "ACTIVE");
  // ⚠ THE NUMBER IS WRITTEN OUT HERE, NOT REFERRED TO, AND THAT IS A CORRECTION.
  //
  // This assertion originally expressed BOTH sides in terms of SESSION_WARNING_SECONDS, which made it a
  // tautology: changing the constant to 45 moved the input and the expectation together and the test
  // stayed green. It was caught by deliberately breaking the constant and watching nothing go red --
  // which is the twenty-first vacuous assertion found in this repository, and the first found by the
  // procedure rather than by reading. COMP-AUTH-001 says sixty seconds, so sixty is what is written.
  ok("4b0. the warning window is COMP-AUTH-001's sixty seconds, asserted against the number and not "
    + "against itself", SESSION_WARNING_SECONDS === 60, String(SESSION_WARNING_SECONDS));
  const atWarn = idleDecision({ idleMs: min(30) - 60_000, limits: enforce });
  ok("4b. the warning starts exactly 60 seconds before the limit (COMP-AUTH-001)",
    atWarn.phase === "WARNING" && atWarn.secondsToLock === 60, JSON.stringify(atWarn));
  ok("4c. and the countdown counts",
    idleDecision({ idleMs: min(30) - 1000, limits: enforce }).secondsToLock === 1);
  ok("4d. at the limit the screen is covered",
    idleDecision({ idleMs: min(30), limits: enforce }).phase === "LOCK");
  ok("4e-control. one second earlier it is not (4d is not passing on a constant)",
    idleDecision({ idleMs: min(30) - 1000, limits: enforce }).phase === "WARNING");

  // ⚠ THE PATHOLOGICAL LIMIT. The database floor is 5 minutes today; if it ever dropped, `limit - 60s`
  // would put the warning at or before zero, which is a cover with no warning at all.
  const tiny: SessionLimits = { ...enforce, idleMinutes: 1 };
  ok("5a. ⚠ at a 1-minute limit the warning still starts halfway, not at zero -- some warning always",
    idleDecision({ idleMs: 30_000, limits: tiny }).phase === "WARNING"
    && idleDecision({ idleMs: 29_000, limits: tiny }).phase === "ACTIVE");
  ok("5b. and half the limit is still undisturbed working time",
    idleDecision({ idleMs: 1000, limits: tiny }).phase === "ACTIVE");

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 3. THE HEARTBEAT, AND THE TWO WAYS IT COULD DEFEAT THE RULE --\n");

  const beat = (o: Partial<Parameters<typeof shouldHeartbeat>[0]>) => shouldHeartbeat({
    activeSinceLastBeat: true, msSinceLastBeat: SESSION_HEARTBEAT_SECONDS * 1000,
    locked: false, limits: enforce, ...o,
  });

  ok("6a-control. an active, unlocked session past the interval in an enforcing practice DOES beat",
    beat({}) === true);
  ok("6b. ⚠ BUT A TIMER ALONE DOES NOT. No activity since the last beat, no beat -- otherwise every "
    + "forgotten tab would keep itself alive and no session would ever be idle",
    beat({ activeSinceLastBeat: false, msSinceLastBeat: 60 * 60 * 1000 }) === false);
  ok("6c. ⚠ AND A COVERED SCREEN DOES NOT BEAT, whatever it saw before it was covered",
    beat({ locked: true }) === false);
  ok("6d. nor does it beat more often than the interval",
    beat({ msSinceLastBeat: SESSION_HEARTBEAT_SECONDS * 1000 - 1 }) === false);
  ok("6e. and it sends nothing at all where no limit is enforced -- no traffic for any practice today",
    beat({ limits: observe }) === false);
  ok("6f. nor where the policy could not be read",
    beat({ limits: resolveSessionLimits(brokenPolicy) }) === false);

  ok("7a. ⚠ AN OBSERVATION DOES NOT REFRESH THE SESSION. It is sent because nobody has touched the "
    + "machine; refreshing on it would erase the very idleness it counts",
    touchesSession("idle_observed") === false);
  ok("7b. ⚠ NOR DOES DRAWING THE COVER -- a covered screen reporting itself in use defeats the rule",
    touchesSession("locked") === false);
  ok("7c-control. a heartbeat does, which is its whole purpose", touchesSession("heartbeat") === true);
  ok("7d. and so does unlocking, which is what makes re-entering a password lift an idle lock-out",
    touchesSession("unlocked") === true);
  ok("7e. and those four are the only reports the browser may make",
    SESSION_ACTIONS.length === 4 && SESSION_ACTIONS.every(a => typeof touchesSession(a) === "boolean"));

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 4. THE HEARTBEAT'S REAL EFFECT ON THE REAL REGISTER --\n");

  const device = "harness-session-device-1";
  const first = await touchSession(admin, { workspaceId: A, userId: OWNER, deviceId: device });
  ok("8a-control. the device registers", first.allowed && first.checked && first.created === true, JSON.stringify(first));
  const { data: afterCreate } = await admin.from("practice_session")
    .select("id, last_seen_at").eq("id", first.sessionId!).maybeSingle();

  // Age the row by hand: this is exactly what "somebody has been typing on one page for a while" used
  // to look like to the server, because `last_seen_at` only moved on a full page load.
  const aged = new Date(Date.now() - 12 * 60_000).toISOString();
  await admin.from("practice_session").update({ last_seen_at: aged }).eq("id", first.sessionId!);
  const beaten = await touchSession(admin, { workspaceId: A, userId: OWNER, deviceId: device });
  const { data: afterBeat } = await admin.from("practice_session")
    .select("last_seen_at").eq("id", first.sessionId!).maybeSingle();
  ok("8b-probe. the row really was aged before the beat", (afterCreate as any)!.last_seen_at > aged);
  ok("8c. ⚠ A BEAT MOVES last_seen_at FORWARD. This is what stops a 30-minute limit revoking somebody "
    + "who has been writing one note for 40 minutes -- before it, only a page load did this",
    beaten.allowed && Date.parse((afterBeat as any)!.last_seen_at) > Date.parse(aged),
    `${aged} -> ${(afterBeat as any)?.last_seen_at}`);

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 5. WHAT IS WRITTEN DOWN, AND WHAT IT IS NOT COUNTED AS --\n");

  // ⚠ THE KEYS ARE UNIQUE PER RUN, AND THIS HARNESS WAS WRONG BEFORE THEY WERE.
  //
  // `cleanup()` deletes this harness's audit rows -- except that migration 247 made
  // `practice_audit_event` APPEND-ONLY IN THE DATABASE, so that delete raises and is discarded, and the
  // rows outlive the run. With fixed keys the second run's writes all came back "already_recorded",
  // pointing at the PREVIOUS run's workspace, and every count below read nought. A harness that passes
  // once and then reports nothing is worse than one that fails, so the occasion is dated.
  const run = Date.now();
  const rec = (type: any, dedupeKey: string, payloadIn: Record<string, unknown>) =>
    recordAuthEvent(admin, { workspaceId: A, actorId: OWNER, eventType: type, dedupeKey: `${run}:${dedupeKey}`, payload: payloadIn });

  await rec(AUTH_EVENT.WORKSPACE_LOCKED, "k1", { cause: "idle" });
  await rec(AUTH_EVENT.WORKSPACE_LOCKED, "k2", { cause: "paused" });
  const dupe = await rec(AUTH_EVENT.WORKSPACE_LOCKED, "k2", { cause: "paused" });
  await rec(AUTH_EVENT.WORKSPACE_UNLOCKED, "k3", { cause: "paused" });
  await rec(AUTH_EVENT.IDLE_OBSERVED, "k4", { idleMinutes: 41, measuredBy: "browser" });
  await rec(AUTH_EVENT.ABSOLUTE_LIFETIME_OBSERVED, "k5", { minutesSinceSignIn: 800 });

  ok("9a. the same occasion recorded twice is one row, not two",
    dupe.recorded === false && dupe.reason === "already_recorded", JSON.stringify(dupe));

  const sum = await authTrailSummary(admin, A);
  ok("9b-control. the trail was read (nothing below is asserting over a failed read)", sum.readable === true);
  ok("9c. both covers are counted", sum.sessionLifetime.screensCoveredLast7Days === 2,
    String(sum.sessionLifetime.screensCoveredLast7Days));
  ok("9d. and the one somebody chose is counted apart from the one the clock caused",
    sum.sessionLifetime.pausesLast7Days === 1, String(sum.sessionLifetime.pausesLast7Days));
  ok("9e. the idle stretch is counted", sum.sessionLifetime.idleStretchesObservedLast7Days === 1);
  ok("9f. and the long-running session is counted",
    sum.sessionLifetime.sessionsPastAbsoluteObservationLast7Days === 1);
  ok("9g. ⚠ AND NONE OF THEM IS A REFUSAL. Nothing was hidden and nobody was turned away; a practice "
    + "reading 'turned away' must not be reading people who were let straight through",
    sum.refusalsLast7Days === 0, String(sum.refusalsLast7Days));

  const brokenSum = await authTrailSummary(brokenOn("practice_audit_event"), A);
  ok("10-probe. the injected fault really did break the trail read", brokenSum.readable === false);
  ok("10a. ⚠ A FAILED READ IS FOUR NULLS, NEVER FOUR ZEROES -- '0 screens covered' is a statement "
    + "about a practice and a database fault must not make it",
    brokenSum.sessionLifetime.screensCoveredLast7Days === null
    && brokenSum.sessionLifetime.pausesLast7Days === null
    && brokenSum.sessionLifetime.idleStretchesObservedLast7Days === null
    && brokenSum.sessionLifetime.sessionsPastAbsoluteObservationLast7Days === null,
    JSON.stringify(brokenSum.sessionLifetime));

  ok("11. every new event type is described in the list the console renders, so the page cannot "
    + "describe more than is recorded",
    [AUTH_EVENT.WORKSPACE_LOCKED, AUTH_EVENT.WORKSPACE_UNLOCKED, AUTH_EVENT.IDLE_OBSERVED,
      AUTH_EVENT.ABSOLUTE_LIFETIME_OBSERVED].every(t => AUTH_EVENTS_RECORDED.some(r => r.type === t)));
  ok("11b. and the two measurements say in their own description that nothing was refused",
    AUTH_EVENTS_RECORDED.filter(r => r.type === AUTH_EVENT.IDLE_OBSERVED || r.type === AUTH_EVENT.ABSOLUTE_LIFETIME_OBSERVED)
      .every(r => /nothing was hidden or refused/i.test(r.what)));

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 6. THE ABSOLUTE SESSION LIFETIME: MEASURED, NOT ENFORCED --\n");

  const noStamp = absoluteLifetime({ signedInAt: null });
  ok("12a. ⚠ NO SIGN-IN TIME IS 'UNKNOWN', NEVER A BRAND-NEW SESSION",
    noStamp.known === false && noStamp.minutesSinceSignIn === null && noStamp.pastObservation === null,
    JSON.stringify(noStamp));
  ok("12b. and neither is a timestamp the authentication server sent in a shape nobody can parse",
    absoluteLifetime({ signedInAt: "not a date" }).known === false);

  const now = Date.now();
  const old = absoluteLifetime({ signedInAt: new Date(now - min(ABSOLUTE_OBSERVATION_MINUTES)).toISOString(), now });
  const young = absoluteLifetime({ signedInAt: new Date(now - min(ABSOLUTE_OBSERVATION_MINUTES - 1)).toISOString(), now });
  ok("12c. a session past 12 hours is past the observation window", old.pastObservation === true);
  ok("12d-control. one a minute younger is not (12c is not passing on a constant)",
    young.pastObservation === false);
  ok("12e. ⚠ AND NEITHER IS ENFORCED. There is no column to hold a cap, so the type itself says so "
    + "rather than leaving a screen to imply one",
    old.enforced === false && young.enforced === false && noStamp.enforced === false);
  ok("12f. and the reason is written down where a page can read it, naming the column that would build it",
    /session_absolute_minutes/.test(ABSOLUTE_LIFETIME_NOT_ENFORCED.whatWouldBuildIt));

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 7. WHAT THE SECURITY PAGE SAYS --\n");

  const posture: any = await securityPosture(admin, A);
  ok("13a-control. the posture was produced over a readable policy", posture.policyReadable === true);
  ok("13b. it carries the session lifecycle, in the mode this practice is actually in",
    posture.sessionLifetime?.mode === "ENFORCE" && posture.sessionLifetime.idleMinutes === 30,
    JSON.stringify(posture.sessionLifetime?.mode));
  ok("13c. with the figures beside it, read from the trail rather than invented",
    posture.sessionLifetime.observed.screensCoveredLast7Days === 2);
  ok("13d. ⚠ AND IT NAMES THE CAP IT DOES NOT APPLY. COMP-AUTH-001 asks for a 12-hour absolute "
    + "lifetime; there is nowhere to store one, so the page says so rather than implying it exists",
    posture.notKnowableFromHere.some((s: string) => /Nothing caps how long a session may run/.test(s)));
  ok("13e. and no guarantee on that page claims a cap on session age",
    !posture.guarantees.some((g: string) => /absolute|caps? how long|session lifetime/i.test(g)),
    JSON.stringify(posture.guarantees.filter((g: string) => /absolute|cap/i.test(g))));
  ok("13f. it also names the workspaces this control does NOT reach, which is all of them but Practice",
    posture.notKnowableFromHere.some((s: string) => /another Competen workspace/i.test(s)));
  ok("13g. the lock screen's own claims travel in the payload, so no screen can widen them",
    Array.isArray(posture.sessionLifetime.lockScreen) && posture.sessionLifetime.lockScreen.length === LOCK_SCREEN_TRUTHS.length);
  ok("13h. ⚠ INCLUDING THE ONE THAT COSTS SOMETHING TO SAY: a cover drawn by a browser is not a "
    + "boundary in it, and somebody holding the device can get behind it",
    posture.sessionLifetime.lockScreen.some((s: string) => /not a boundary/i.test(s)));
  ok("13i. and the resume methods COMP-AUTH-001 asks for and this product does not have are listed, "
    + "on pain of repeating the enrolment page that never existed",
    posture.sessionLifetime.resumeMethodsNotBuilt.length === RESUME_METHODS_NOT_BUILT.length
    && posture.sessionLifetime.resumeMethodsNotBuilt.some((s: string) => /PIN/.test(s))
    && posture.sessionLifetime.resumeMethodsNotBuilt.some((s: string) => /Windows Hello/.test(s)));
  ok("13j. Clinical Pause Mode's limits are stated beside what it does",
    posture.sessionLifetime.clinicalPauseNotBuilt.length === CLINICAL_PAUSE.notBuilt.length
    && posture.sessionLifetime.clinicalPauseNotBuilt.some((s: string) => /closing the tab/i.test(s)));

  const brokenPosture: any = await securityPosture(brokenOn("practice_security_policy"), A);
  ok("14-probe. the injected fault really did break that posture's policy read",
    brokenPosture.policyReadable === false);
  ok("14a. ⚠ AND ITS SESSION BLOCK IS UNKNOWN, NOT 'no limit set'. A practice looking at a security "
    + "page must never be told it has no idle rule by a read that failed",
    brokenPosture.sessionLifetime.mode === "UNKNOWN", brokenPosture.sessionLifetime.mode);

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 8. IT IS ACTUALLY MOUNTED, AND ACTUALLY REACHABLE --\n");

  // ⚠ THIS REPOSITORY HAS SHIPPED TWO CONTROLS THAT COULD NEVER FIRE -- an idle rule with no stable
  // device, and an "add an authenticator" instruction with no enrolment page. An engine nothing renders
  // is the same bug in new clothes, so the mount is asserted rather than assumed.
  const layout = fs.readFileSync("src/app/practice/(shell)/layout.tsx", "utf8");
  ok("15a. the shell layout mounts the session guard, so this engine runs on every Practice page",
    /import PracticeSessionGuard/.test(layout) && /<PracticeSessionGuard\b/.test(layout));
  ok("15b. and it is handed the limits the shell resolved, rather than fetching a second opinion",
    /<PracticeSessionGuard\s+limits=\{shell\.session\}/.test(layout));

  const guard = fs.readFileSync("src/app/practice/(shell)/PracticeSessionGuard.tsx", "utf8");
  // ⚠ THIS ASSERTION USED TO SEARCH THE SOURCE FOR THE PHRASE ITSELF, AND WAS VACUOUS: the phrase also
  // appears in that file's comments explaining why the button must exist, so deleting the button left it
  // green. Caught by breaking it. It now asserts the label's VALUE and that the component renders the
  // constant, which is two things neither a comment nor a deletion can satisfy.
  ok("15c. ⚠ THE WAY OUT IS ON THE COVER ITSELF, unconditionally -- a lock screen whose only exit is "
    + "the password is a lockout waiting for a forgotten one",
    LOCK_ESCAPE_LABEL === "Sign out and start again" && guard.includes("{LOCK_ESCAPE_LABEL}")
    && /auth\.signOut\(\)/.test(guard));
  ok("15d. and the cover declares itself to assistive technology, since the page behind it is not usable",
    /role="dialog"/.test(guard) && /aria-modal="true"/.test(guard) && /aria-labelledby=/.test(guard));
  ok("15e. Clinical Pause Mode is one press and does not depend on any policy being set",
    /onClick=\{pause\}/.test(guard));

  const consoleSrc = fs.readFileSync("src/app/practice/(shell)/privacy/security/SecurityConsole.tsx", "utf8");
  // ⚠ ALSO TIGHTENED AFTER A BREAK LEFT IT GREEN. Searching for the constant's NAME matched the import
  // line, so removing the dispatch changed nothing. The dispatch and the listener are asserted instead.
  ok("15f. ⚠ AND A PRACTICE CAN SEE THE BEHAVIOUR BEFORE IT BITES: the console dispatches the rehearsal "
    + "the guard listens for",
    /dispatchEvent\(new CustomEvent\(SESSION_PREVIEW_EVENT\)\)/.test(consoleSrc)
    && /addEventListener\(SESSION_PREVIEW_EVENT/.test(guard));
  // ⚠ AND SO WAS THIS ONE: the numbers appeared twice in that component, so adding a five-minute option
  // left the source pattern satisfied by the other occurrence. The floor is now a VALUE this harness can
  // compute, and the component renders the same constant rather than its own copy of the numbers.
  ok("15g. the console does not offer an idle limit shorter than a consultation, though the database "
    + "would accept one",
    Math.min(...CONSOLE_IDLE_OPTIONS) >= 30 && consoleSrc.includes("CONSOLE_IDLE_OPTIONS.map"),
    String(Math.min(...CONSOLE_IDLE_OPTIONS)));
  ok("15h. and activity detection watches the events COMP-AUTH-001 names -- typing, clicking, touch, scrolling",
    (["keydown", "pointerdown", "touchstart", "scroll"] as const)
      .every(e => (SESSION_ACTIVITY_EVENTS as readonly string[]).includes(e)));

  // ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- 9. ISOLATION --\n");

  const sumB = await authTrailSummary(admin, B);
  ok("16a-control. B's trail was read, so the zeroes below mean 'none' rather than 'unknown'",
    sumB.readable === true);
  ok("16b. B sees none of A's covers", sumB.sessionLifetime.screensCoveredLast7Days === 0);
  ok("16c. and A does (the isolation test is not vacuous)",
    sum.sessionLifetime.screensCoveredLast7Days === 2);
  const postureB: any = await securityPosture(admin, B);
  ok("16d. B's own policy is untouched by A's idle limit",
    postureB.sessionLifetime.mode === "OBSERVE" && postureB.sessionLifetime.idleMinutes === null,
    JSON.stringify(postureB.sessionLifetime.mode));

  await cleanup();

  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
