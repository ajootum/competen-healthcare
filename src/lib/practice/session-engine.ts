// The Practice session engine (COMP-AUTH-001 "Session Lifecycle", "User Experience", "Activity
// Detection", "Clinical Pause Mode"; COMP-SECURITY-SURVEY-001 s1.2 and s6.5/s6.6).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY DECISION IN THIS FILE IS PURE, AND THAT IS THE WHOLE POINT.
//
// The thing being decided is when to stop showing somebody a patient record. It is a decision made in a
// browser, on a timer, against a policy read on the server -- three sources of drift -- and it is the
// kind of decision that is normally buried in a `useEffect` where nothing can be proved about it. So the
// decision lives here, takes numbers in and gives an answer out, and the component below it does nothing
// but render what this file says.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ LOCKOUT IS THE FAILURE MODE, NOT THE FEATURE.
//
// `practice_sign_in` is on and there are live users. So the rules this file obeys, in order:
//
//  1. A LIMIT THAT WAS NOT READ IS NOT A LIMIT. `readable: false` produces mode UNKNOWN, and UNKNOWN
//     never locks anything. A control that cannot run must say so rather than act.
//  2. NO LIMIT MEANS NO LOCK. The one live security policy row carries `session_idle_minutes: null`, so
//     every practice in existence today lands in OBSERVE, where nothing is hidden and nothing is
//     refused. This engine is dormant on the day it ships.
//  3. THE CLIENT NEVER REVOKES. Locking here draws a cover over a screen. The only thing that refuses a
//     device is `touchSession`, on the server, and it already existed. Nothing in this file can put
//     somebody in a state that a reload does not clear -- the lock screen carries a password field AND
//     an unconditional "sign out and start again".
//  4. THE HEARTBEAT MAKES LOCKOUT LESS LIKELY, NOT MORE. Before it, `practice_session.last_seen_at`
//     moved only on a full page load, so a clinician typing a note for 25 minutes under a 20-minute
//     idle limit was revoked by the server the moment they navigated -- while working the whole time.
//     A beat sent on real activity is what stops that.
//
// ⚠ AND THE ONE WAY THIS ENGINE COULD DEFEAT ITSELF: a heartbeat on a timer alone would keep every
// abandoned tab alive for ever and no session would ever be idle. `shouldHeartbeat` therefore requires
// ACTIVITY since the previous beat, and the harness proves the timer alone is not enough.

/**
 * The warning window, in seconds. COMP-AUTH-001: "60-second warning before idle logout."
 *
 * It is a constant rather than a setting because there is no column to hold a setting, and inventing a
 * per-practice number that nothing stores would be a control that cannot run.
 */
export const SESSION_WARNING_SECONDS = 60;

/** How often an ACTIVE session tells the server it is still in use. Never more often than this. */
export const SESSION_HEARTBEAT_SECONDS = 120;

/**
 * The observation window, in minutes -- COMP-AUTH-001's own default idle logout.
 *
 * ⚠ IT IS A MEASUREMENT, NEVER A LIMIT. In OBSERVE mode nothing is warned, hidden or refused; passing
 * this window writes one audit row saying the session sat unused for this long. That is how a practice
 * finds out what an idle limit WOULD have done to it before setting one -- COMP-SECURITY-SURVEY-001
 * s6.5, "implement as a client-side warning that does nothing first -- measure how often users would
 * have been logged out".
 */
export const IDLE_OBSERVATION_MINUTES = 30;

/**
 * The absolute-lifetime observation window, in minutes. COMP-AUTH-001's default is 12 hours.
 *
 * ⚠ ALSO A MEASUREMENT, AND UNLIKE THE IDLE ONE IT CANNOT BECOME ANYTHING ELSE IN THIS BUILD.
 * `practice_security_policy` has no column for an absolute lifetime, this build writes no migrations,
 * and a cap with nowhere to store its own number is not a control. See ABSOLUTE_LIFETIME_NOT_ENFORCED.
 */
export const ABSOLUTE_OBSERVATION_MINUTES = 12 * 60;

/**
 * The DOM events that count as being at the keyboard (COMP-AUTH-001 "Activity Detection": typing,
 * clicking, touch, scrolling).
 *
 * ⚠ NAVIGATION, SAVES, API CALLS, UPLOADS AND AI INTERACTIONS ARE COVERED WITHOUT BEING LISTED, because
 * every one of them is reached through a key press, a click or a touch in this product -- there is no
 * surface that saves without being told to. Listing them separately would suggest a second mechanism
 * that does not exist.
 */
export const SESSION_ACTIVITY_EVENTS = [
  "pointerdown", "keydown", "wheel", "touchstart", "scroll", "visibilitychange",
] as const;

/** The window event the security console dispatches to rehearse the behaviour. Named once so the two cannot drift. */
export const SESSION_PREVIEW_EVENT = "practice:session-preview";

/**
 * ⚠ THE ESCAPE HATCH'S WORDS, AS A CONSTANT, SO A TEST CAN PROVE THE BUTTON RENDERS THEM.
 *
 * This is here because the assertion that used to cover it was VACUOUS and was caught by breaking it:
 * the harness searched the component's source for the phrase "Sign out and start again", and the phrase
 * also appears in that file's own comments explaining why the button must exist. Deleting the button
 * left the test green. The label now lives in one place, the button renders the constant, and the
 * harness asserts the constant's value -- so neither half can go missing quietly.
 */
export const LOCK_ESCAPE_LABEL = "Sign out and start again";

/**
 * The idle limits the security console offers, in minutes.
 *
 * ⚠ THE DATABASE ACCEPTS 5 AND THIS LIST STARTS AT 30, DELIBERATELY. COMP-SECURITY-SURVEY-001 s6.4 asks
 * for "a floor well above 5 minutes"; a limit shorter than a consultation covers the screen of somebody
 * who is in the middle of one. It is a constant rather than an array literal in the markup because the
 * harness's first attempt at asserting the floor read the component's source, found the same numbers in
 * a second place, and stayed green when a five-minute option was added.
 */
export const CONSOLE_IDLE_OPTIONS = [30, 60, 120, 240] as const;

/**
 * ⚠ THE RESUME METHODS COMP-AUTH-001 ASKS FOR AND THIS PRODUCT DOES NOT HAVE.
 *
 * The spec says "resume from lock with PIN, biometrics, Windows Hello or device authentication". None of
 * the four exists here: there is no WebAuthn anywhere in the repository, no PIN store, and no enrolment
 * screen of any kind. The lock screen offers a password and nothing else, and it says so on itself --
 * because the failure this product has already shipped once is a screen telling somebody to use a
 * control that was never built (`/practice/access-status` sent MFA-blocked users to an enrolment page
 * that did not exist).
 */
export const RESUME_METHODS_NOT_BUILT = [
  "A PIN. Nothing in this product stores one.",
  "Biometrics or Windows Hello. There is no WebAuthn anywhere in this application.",
  "Device authentication. The device register identifies a browser; it does not authenticate one.",
] as const;

/**
 * ⚠ WHY AN ABSOLUTE SESSION LIFETIME IS MEASURED HERE AND NOT ENFORCED.
 *
 * Rendered on the security console verbatim, so the page cannot describe a cap this build does not
 * apply. Both sentences are true on the day they ship, which is the standard the rest of this arc failed
 * twice before it was set.
 */
export const ABSOLUTE_LIFETIME_NOT_ENFORCED = {
  measured: "How long each session has run since the person last authenticated, counted from the authentication server's own record.",
  notEnforced: "No cap. `practice_security_policy` has columns for two-factor, emergency access and an idle limit, and none for an absolute lifetime, so there is nowhere for a practice to put the number. Nothing here stops a session on age.",
  whatWouldBuildIt: "One nullable integer column, `session_absolute_minutes`, on `practice_security_policy` -- plus the same bounds check the idle limit carries. This build wrote no migration.",
} as const;

// ── THE LIMITS ───────────────────────────────────────────────────────────────────────────────────────

/**
 * How this practice's session behaves, derived from the one policy row that exists.
 *
 * THREE MODES, NEVER TWO:
 *  - ENFORCE  -- a practice set `session_idle_minutes`. Warn, then lock the screen.
 *  - OBSERVE  -- no limit set. Nothing warns, nothing locks; long idle stretches are counted.
 *  - UNKNOWN  -- the policy could not be read. Nothing at all happens, and the page says why.
 */
export type SessionMode = "ENFORCE" | "OBSERVE" | "UNKNOWN";

export type SessionLimits = {
  mode: SessionMode;
  /** ⚠ Null in OBSERVE and UNKNOWN. A number here always means something will actually lock. */
  idleMinutes: number | null;
  warningSeconds: number;
  heartbeatSeconds: number;
  idleObservationMinutes: number;
  absoluteObservationMinutes: number;
  /** Always null: there is no column to hold it. Present so no client can imagine one. */
  absoluteMinutes: null;
  /** Always false, for the same reason. */
  absoluteEnforced: false;
};

/**
 * The limits, from the policy `getSecurityPolicy` returned.
 *
 * ⚠ IT TAKES `readable` AS AN INPUT RATHER THAN TRUSTING THE NUMBER BESIDE IT. An unreadable policy
 * arrives as a placeholder whose `session_idle_minutes` is null, which would read as "no limit" and pass
 * silently into OBSERVE -- the exact shape of failure this arc keeps finding. It is told apart here.
 */
export function resolveSessionLimits(policy: {
  readable: boolean; session_idle_minutes?: number | null;
}): SessionLimits {
  const shared = {
    warningSeconds: SESSION_WARNING_SECONDS,
    heartbeatSeconds: SESSION_HEARTBEAT_SECONDS,
    idleObservationMinutes: IDLE_OBSERVATION_MINUTES,
    absoluteObservationMinutes: ABSOLUTE_OBSERVATION_MINUTES,
    absoluteMinutes: null as null,
    absoluteEnforced: false as const,
  };
  if (!policy.readable) return { mode: "UNKNOWN", idleMinutes: null, ...shared };
  const idle = policy.session_idle_minutes;
  if (typeof idle !== "number" || !Number.isFinite(idle) || idle <= 0)
    return { mode: "OBSERVE", idleMinutes: null, ...shared };
  return { mode: "ENFORCE", idleMinutes: idle, ...shared };
}

// ── THE IDLE DECISION ────────────────────────────────────────────────────────────────────────────────

/**
 * What the browser should be doing about how long this person has been away.
 *
 *  - ACTIVE   -- nothing.
 *  - WARNING  -- a countdown and a "Stay signed in" button, still fully usable underneath.
 *  - LOCK     -- draw the cover.
 *  - OBSERVED -- record that the session sat unused this long. NOTHING IS HIDDEN OR REFUSED.
 *  - DORMANT  -- this engine has no opinion: the policy could not be read.
 */
export type IdlePhase = "ACTIVE" | "WARNING" | "LOCK" | "OBSERVED" | "DORMANT";

export type IdleDecision = {
  phase: IdlePhase;
  /** Whole seconds until the cover is drawn. Null in every phase that will not draw one. */
  secondsToLock: number | null;
};

/**
 * ⚠ THE WARNING NEVER EATS THE WHOLE LIMIT.
 *
 * The database allows an idle limit as low as 5 minutes, and the warning window is a fixed 60 seconds,
 * so the naive `limit - 60s` is fine today. It would not be if the bound ever dropped: a 1-minute limit
 * would warn at zero, which is a lock with no warning at all -- exactly the surprise this arc exists to
 * prevent. The warning therefore starts at the later of "one minute before" and "halfway", so a person
 * always gets at least half their limit of undisturbed work and always gets some warning.
 */
export function idleDecision(input: { idleMs: number; limits: SessionLimits }): IdleDecision {
  const { idleMs, limits } = input;

  if (limits.mode === "UNKNOWN") return { phase: "DORMANT", secondsToLock: null };

  if (limits.mode === "OBSERVE") {
    return idleMs >= limits.idleObservationMinutes * 60_000
      ? { phase: "OBSERVED", secondsToLock: null }
      : { phase: "ACTIVE", secondsToLock: null };
  }

  const lockAtMs = (limits.idleMinutes ?? 0) * 60_000;
  if (idleMs >= lockAtMs) return { phase: "LOCK", secondsToLock: 0 };

  const warnAtMs = Math.max(lockAtMs - limits.warningSeconds * 1000, lockAtMs / 2);
  if (idleMs >= warnAtMs)
    return { phase: "WARNING", secondsToLock: Math.max(0, Math.ceil((lockAtMs - idleMs) / 1000)) };

  return { phase: "ACTIVE", secondsToLock: Math.ceil((lockAtMs - idleMs) / 1000) };
}

// ── THE HEARTBEAT DECISION ───────────────────────────────────────────────────────────────────────────

/**
 * Should this browser tell the server the session is still in use?
 *
 * ⚠ `activeSinceLastBeat` IS THE WHOLE CONTROL. Beating on a timer alone would keep an abandoned tab
 * alive for ever, and every idle rule in the product would quietly stop meaning anything -- a control
 * defeated by the thing built to support it. The harness proves the timer alone is not enough.
 *
 * ⚠ AND IT IS SILENT UNLESS SOMETHING ENFORCES. In OBSERVE and UNKNOWN nothing refuses a stale
 * `last_seen_at`, so a beat would buy nothing and cost a request from every open tab in every practice
 * that exists today. On the day this ships that is every practice, and the answer is no traffic at all.
 */
export function shouldHeartbeat(input: {
  activeSinceLastBeat: boolean;
  msSinceLastBeat: number;
  locked: boolean;
  limits: SessionLimits;
}): boolean {
  if (input.limits.mode !== "ENFORCE") return false;
  // A covered screen is not somebody working. Beating from behind the lock screen would hold the session
  // open for a browser nobody is sitting at, which is the state the cover exists to describe.
  if (input.locked) return false;
  if (!input.activeSinceLastBeat) return false;
  return input.msSinceLastBeat >= input.limits.heartbeatSeconds * 1000;
}

// ── WHAT THE BROWSER MAY TELL THE SERVER, AND WHICH OF IT COUNTS AS BEING IN USE ─────────────────────

/** The four things the browser's session engine says. Nothing else is accepted by the route. */
export const SESSION_ACTIONS = ["heartbeat", "locked", "unlocked", "idle_observed"] as const;
export type SessionAction = (typeof SESSION_ACTIONS)[number];

/**
 * Does this report refresh `practice_session.last_seen_at`?
 *
 * ⚠ THE MOST DEFEATABLE DECISION IN THE WHOLE ENGINE, WHICH IS WHY IT IS A FUNCTION AND NOT AN `if`
 * INSIDE A ROUTE HANDLER.
 *
 *  - `heartbeat`     YES. It is sent only after real activity, and refreshing is its entire purpose:
 *                    without it a long note on one page is indistinguishable from an empty desk.
 *  - `unlocked`      YES, and it is what makes unlocking real rather than cosmetic. The person has just
 *                    re-entered their password, so GoTrue has stamped a new `last_sign_in_at` and
 *                    `touchSession` will lift an idle lock-out applied while the screen was covered.
 *  - `locked`        NO. A covered screen reporting itself as in use would hold the session open for a
 *                    browser nobody is sitting at -- the rule defeated by the thing reporting on it.
 *  - `idle_observed` NO, and this one matters most. It is sent precisely BECAUSE nobody has touched the
 *                    machine for half an hour. Refreshing on it would mean the measurement of idleness
 *                    ended idleness, and every count it produced would be of an event it had erased.
 */
export function touchesSession(action: SessionAction): boolean {
  return action === "heartbeat" || action === "unlocked";
}

// ── THE ABSOLUTE LIFETIME ────────────────────────────────────────────────────────────────────────────

export type AbsoluteLifetime = {
  /** ⚠ False when the authentication server did not give a sign-in time. Everything else is then null. */
  known: boolean;
  minutesSinceSignIn: number | null;
  observationMinutes: number;
  /** Has this session run longer than COMP-AUTH-001's default 12 hours? Null when unknown. */
  pastObservation: boolean | null;
  /** ALWAYS FALSE. Stated as a field so no screen can imply a cap that has nowhere to be configured. */
  enforced: false;
};

/**
 * How long this session has run since the person last authenticated.
 *
 * ⚠ A MEASUREMENT WITH NO CONSEQUENCE, AND IT SAYS SO IN ITS OWN RETURN TYPE. `enforced: false` is not a
 * placeholder waiting for a flag; there is no column for a limit, so there is nothing that could set it.
 * A missing sign-in time gives `known: false` rather than a zero, because "this session is brand new" and
 * "the authentication server did not say" are different answers and one of them is a lie.
 */
export function absoluteLifetime(input: {
  signedInAt: string | null | undefined;
  now?: number;
  observationMinutes?: number;
}): AbsoluteLifetime {
  const observationMinutes = input.observationMinutes ?? ABSOLUTE_OBSERVATION_MINUTES;
  const parsed = input.signedInAt ? Date.parse(input.signedInAt) : NaN;
  if (!input.signedInAt || Number.isNaN(parsed))
    return { known: false, minutesSinceSignIn: null, observationMinutes, pastObservation: null, enforced: false };

  const minutes = Math.floor(((input.now ?? Date.now()) - parsed) / 60_000);
  return {
    known: true,
    minutesSinceSignIn: minutes,
    observationMinutes,
    pastObservation: minutes >= observationMinutes,
    enforced: false,
  };
}

// ── WHAT A LOCK IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────────────────

/** Why the cover is drawn. Recorded with the event, because "idle" and "somebody pressed pause" are different facts. */
export const LOCK_CAUSE = { IDLE: "idle", PAUSED: "paused" } as const;
export type LockCause = (typeof LOCK_CAUSE)[keyof typeof LOCK_CAUSE];

/**
 * ⚠ THE SENTENCES THE LOCK SCREEN AND THE CONSOLE BOTH RENDER, SO THEY CANNOT DIVERGE.
 *
 * Every one of them is true of this build on the day it ships. The pair that matter most are the last
 * two: a cover drawn by JavaScript is not a boundary, and saying otherwise would be the same class of
 * claim as the "Every sign-in recorded" tick that described nothing.
 */
export const LOCK_SCREEN_TRUTHS = [
  "Locking covers this screen. It does not sign you out of Competen and it does not end this session.",
  "Nothing on the page behind is discarded. Unlocking returns you to the same patient, the same form and anything you had typed into it.",
  "A password is the only way back in, because a PIN, biometrics and Windows Hello are not built in this product.",
  "Sign out and start again is always available, including when the password is not accepted.",
  "This is a cover over a screen, not a boundary in the browser. Somebody with the device in their hands and the will to use developer tools can get behind it -- lock the device itself if that matters.",
] as const;

/**
 * ⚠ WHAT CLINICAL PAUSE MODE DOES AND DOES NOT DO IN THIS BUILD.
 *
 * COMP-AUTH-001 asks for one-click pause, patient information hidden immediately, and resume to the same
 * patient after authentication. The first three are built. The fourth line is what is NOT built, and it
 * is listed rather than omitted because a clinician who assumed a pause survived closing the browser
 * would be assuming something false about a patient record.
 */
export const CLINICAL_PAUSE = {
  built: [
    "One press covers the screen, on any Practice page, with no navigation and nothing saved or discarded.",
    "The record behind is hidden immediately -- the cover is opaque and the page underneath is not re-rendered.",
    "Unlocking with a password returns you to exactly the same patient and the same half-typed note.",
    "The pause survives a reload of this tab, so an accidental refresh does not expose the record.",
  ],
  notBuilt: [
    "It does not survive closing the tab or the browser. The next visit is an ordinary sign-in, and whatever was on the screen is gone.",
    "It does not pause anything on another device, and it does not pause the practice for anybody else.",
    "It records that a pause happened; it does not record which patient was on the screen. The access log already holds that.",
  ],
} as const;
