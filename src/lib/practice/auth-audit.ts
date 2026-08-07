import { DEVICE_COOKIE } from "@/lib/practice/device-register";

// The Practice authentication audit trail (COMP-AUTH-001 item 6, COMP-SECURITY-SURVEY-001 s0.5).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// BEFORE THIS FILE, NOTHING IN THIS PRODUCT RECORDED THAT ANYBODY EVER SIGNED IN.
//
// `practice_audit_event` held 2,480 rows across 38 event types and not one of them was an authentication
// event -- no sign-in, no refusal, no device, no timeout. Meanwhile the public practice sign-in page
// carried a green tick beside the sentence "Every sign-in recorded". That sentence described nothing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// WHAT THIS TRAIL CAN SEE, AND WHAT IT CANNOT, ARE BOTH STATED IN THE PAYLOAD -- see
// AUTH_EVENTS_RECORDED and AUTH_EVENTS_NOT_RECORDED_HERE. A trail that quietly covered half of
// authentication would be worse than none, because the half it missed is the half somebody would assume
// was there. Every claim this product makes about sign-in recording is generated from those two lists,
// so the marketing copy and the security console cannot say more than the code does.
//
// WHERE THE EVENTS COME FROM. `resolvePracticeShell` runs on every authenticated Practice page and is
// the one door into this product; `touchSession` runs inside it. So the producer is the shell, not a
// form, and that is deliberate: the Practice sign-in form is a client component calling
// `supabase.auth.signInWithPassword` in the browser, with no server hop to record anything. Hanging the
// trail off the shell means it records a sign-in however it happened -- this form, the platform login
// route, a session restored on another workspace and carried in -- rather than only the one path
// somebody remembered to instrument.
//
// HOW IT AVOIDS RECORDING THE SAME SIGN-IN ON EVERY PAGE LOAD. GoTrue stamps `last_sign_in_at` on the
// user, and it does not move until the person authenticates again. That timestamp IS the identity of a
// sign-in, so it is the deduplication key: the first Practice page a session opens writes the row and
// every page after it finds the row already there.
//
// THE STORE IS `practice_audit_event`, WITH NO MIGRATION. Its `workspace_id` is nullable and migration
// 247 made the table append-only in the database (UPDATE and DELETE both raise). An authentication event
// is an account fact rather than a workspace fact, so the workspace is carried when the shell had
// resolved one by the time the event fired and left null when it had not -- never invented.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Every authentication event type this product writes. Nothing else may be written by this module. */
export const AUTH_EVENT = {
  SIGN_IN: "practice.auth.sign_in",
  DEVICE_REGISTERED: "practice.auth.device_registered",
  DEVICE_REGISTER_UNAVAILABLE: "practice.auth.device_register_unavailable",
  SESSION_REFUSED: "practice.auth.session_refused",
  IDLE_TIMEOUT: "practice.auth.idle_timeout",
  IDLE_SESSION_RESUMED: "practice.auth.idle_session_resumed",
  MFA_REFUSED: "practice.auth.mfa_refused",
  SECURITY_CHECK_UNAVAILABLE: "practice.auth.security_check_unavailable",
} as const;

export type AuthEventType = (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT];

/**
 * Every type belonging to this trail, so a reader can select the whole of it and nothing else.
 *
 * An explicit set rather than a `like 'practice.auth.%'` pattern: a wildcard would silently widen if
 * anything else ever took the prefix, and PostgREST's own escaping rules for `%` are a poor thing to
 * rest an audit query on.
 */
export const ALL_AUTH_EVENT_TYPES: AuthEventType[] = Object.values(AUTH_EVENT);

/**
 * WHAT IS RECORDED, as a list somebody can open -- not as a count and not as a claim.
 *
 * The security console and the public sign-in page both render this array. That is the point: the only
 * way to widen what the product claims about sign-in recording is to widen what it records.
 */
export const AUTH_EVENTS_RECORDED: { type: AuthEventType; what: string }[] = [
  { type: AUTH_EVENT.SIGN_IN, what: "A sign-in that opened this practice, once per sign-in." },
  { type: AUTH_EVENT.DEVICE_REGISTERED, what: "A browser presenting itself to this practice for the first time." },
  { type: AUTH_EVENT.SESSION_REFUSED, what: "A device turned away because it had been locked out." },
  { type: AUTH_EVENT.IDLE_TIMEOUT, what: "A device locked out for sitting unused longer than this practice allows." },
  { type: AUTH_EVENT.IDLE_SESSION_RESUMED, what: "An idle lock-out cleared because the person signed in again." },
  { type: AUTH_EVENT.MFA_REFUSED, what: "Entry refused because this practice requires a second factor." },
  { type: AUTH_EVENT.SECURITY_CHECK_UNAVAILABLE, what: "A security check that gave no answer, so entry was refused." },
  { type: AUTH_EVENT.DEVICE_REGISTER_UNAVAILABLE, what: "A request the device register could not run on, so no device was recorded." },
];

/**
 * ⚠ WHAT IS NOT RECORDED, AND WHY. A control that cannot run must say so.
 *
 * Each line below is an authentication event this trail genuinely does not see. They are listed rather
 * than omitted because an unwarned reader would assume an authentication audit covers all of them, and
 * the whole reason this file exists is that somebody assumed exactly that about a green tick.
 */
export const AUTH_EVENTS_NOT_RECORDED_HERE: { what: string; why: string }[] = [
  {
    what: "A failed sign-in attempt.",
    why: "The password is checked by the platform's authentication server, which this product does not sit in front of. A failure never reaches any code here, so nothing here can count one -- which is also why this product has no account lockout.",
  },
  {
    what: "A sign-out.",
    why: "Signing out is a call from the browser to the platform's authentication server. Practice sees the absence of a session on the next request, which is not the same fact and would date it wrongly.",
  },
  {
    what: "A password change, a password reset, or adding or removing a second factor.",
    why: "All three live on the Competen account rather than in Practice. This product has no screen for any of them.",
  },
  {
    what: "A sign-in that never opened this practice.",
    why: "The trail is written by the Practice shell. Somebody who signs in and goes to a hospital workspace instead has not signed in to a practice, and inventing a row here would say they had.",
  },
];

// ── WRITING ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a write to the trail actually did.
 *
 * ⚠ FOUR OUTCOMES, NOT A BOOLEAN. "Nothing was written" has three quite different causes -- it was
 * already there, the deduplication read failed, or the insert failed -- and collapsing them would put
 * this file in the same class as the bugs it was written to answer.
 */
export type AuthWriteOutcome =
  | { recorded: true; dedupeCheck: "clear" | "failed" }
  | { recorded: false; reason: "already_recorded" }
  | { recorded: false; reason: "write_failed"; message: string };

type RecordArgs = {
  workspaceId?: string | null;
  actorId: string;
  eventType: AuthEventType;
  /** The identity of the occasion. One row per (actor, event type, key), for ever. */
  dedupeKey: string;
  payload?: Record<string, unknown>;
  correlationId?: string | null;
};

/**
 * Write one authentication event, at most once per occasion.
 *
 * ⚠ A FAILED DEDUPLICATION READ RECORDS ANYWAY, AND SAYS IT DID.
 *
 * This is the one place in this module where the safe direction is to write rather than to refuse, and
 * it is worth being explicit about why. If the "have I already recorded this?" read fails, the two wrong
 * answers are: assume yes and lose a sign-in from the audit trail for ever, or assume no and write a
 * duplicate. An audit trail's whole value is that nothing is missing from it, and a duplicate that
 * carries `dedupeCheckFailed: true` is self-describing -- a reader can see why there are two rows. A
 * missing row explains nothing to anybody.
 */
export async function recordAuthEvent(admin: any, args: RecordArgs): Promise<AuthWriteOutcome> {
  let dedupeCheck: "clear" | "failed" = "clear";

  const { data: seen, error: seenError } = await admin.from("practice_audit_event")
    .select("id")
    .eq("event_type", args.eventType)
    .eq("actor_id", args.actorId)
    .eq("payload->>dedupeKey", args.dedupeKey)
    .limit(1);

  if (seenError) {
    dedupeCheck = "failed";
  } else if (((seen ?? []) as any[]).length > 0) {
    return { recorded: false, reason: "already_recorded" };
  }

  // Deliberately its own insert rather than a call to `audit()`: that helper returns a boolean, and this
  // module has to be able to say WHY a write did not land, not merely that it did not.
  const { error } = await admin.from("practice_audit_event").insert({
    workspace_id: args.workspaceId ?? null,
    actor_id: args.actorId,
    event_type: args.eventType,
    source: "shell",
    payload: {
      ...(args.payload ?? {}),
      dedupeKey: args.dedupeKey,
      ...(dedupeCheck === "failed" ? { dedupeCheckFailed: true } : {}),
    },
    correlation_id: args.correlationId ?? null,
  });

  if (error) {
    // The same channel `audit()` uses, for the same reason: an audit write that fails must not be the
    // quietest thing that happens in the request.
    console.error(`[practice] auth event "${args.eventType}" was NOT recorded: ${error.message}`);
    return { recorded: false, reason: "write_failed", message: error.message };
  }
  return { recorded: true, dedupeCheck };
}

/**
 * The deduplication key for one sign-in.
 *
 * GoTrue's `last_sign_in_at` is the identity of an authentication. When it is absent -- which should not
 * happen for a signed-in user, but "should not" is not a guarantee -- the key falls back to the calendar
 * day, so the trail records at most one row a day rather than one per page load. The payload says which
 * of the two it was, because a reader comparing rows needs to know that one of them is dated coarsely.
 */
export function signInOccasion(lastSignInAt: string | null | undefined, now = new Date()): {
  key: string; authSignInAt: string | null; marker: "auth_server" | "unavailable";
} {
  if (lastSignInAt) return { key: lastSignInAt, authSignInAt: lastSignInAt, marker: "auth_server" };
  return { key: `no-sign-in-timestamp:${now.toISOString().slice(0, 10)}`, authSignInAt: null, marker: "unavailable" };
}

// ── READING ──────────────────────────────────────────────────────────────────────────────────────────

export type AuthTrail = {
  /** ⚠ WAS THE TRAIL READ AT ALL? Everything beside this is meaningless when it is false. */
  readable: boolean;
  events: {
    id: string; event_type: string; workspace_id: string | null; actor_id: string | null;
    payload: Record<string, unknown>; occurred_at: string;
  }[];
  /** True when the page reached the row cap, so "12 sign-ins" is never read as "only 12". */
  truncated: boolean;
};

/**
 * The authentication trail, as a list somebody can open.
 *
 * ⚠ THE FAILED READ IS A STATE, NOT AN EMPTY LIST. `data ?? []` on this query would render "no sign-ins
 * recorded" for a database that could not be reached -- on the page whose entire subject is that
 * sign-ins are recorded. That is the exact shape of the bug this arc exists to remove.
 */
export async function authTrail(admin: any, opts: {
  workspaceId?: string | null; userId?: string; since?: string; types?: AuthEventType[]; limit?: number;
} = {}): Promise<AuthTrail> {
  const limit = opts.limit ?? 200;
  let q = admin.from("practice_audit_event")
    .select("id, event_type, workspace_id, actor_id, payload, occurred_at")
    .in("event_type", opts.types?.length ? opts.types : ALL_AUTH_EVENT_TYPES);

  if (opts.workspaceId) q = q.eq("workspace_id", opts.workspaceId);
  if (opts.userId) q = q.eq("actor_id", opts.userId);
  if (opts.since) q = q.gte("occurred_at", opts.since);

  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(limit);
  if (error) return { readable: false, events: [], truncated: false };

  const rows = (data ?? []) as AuthTrail["events"];
  return { readable: true, events: rows, truncated: rows.length === limit };
}

export type AuthTrailSummary = {
  readable: boolean;
  /** null when the trail could not be read. NEVER zero -- a failed read is not a quiet practice. */
  signInsLast7Days: number | null;
  refusalsLast7Days: number | null;
  devicesFirstSeenLast7Days: number | null;
  lastSignInRecordedAt: string | null;
  truncated: boolean;
  recordedTypes: typeof AUTH_EVENTS_RECORDED;
  notRecordedHere: typeof AUTH_EVENTS_NOT_RECORDED_HERE;
};

/** The figures the security console shows, each of them the length of a list the console can open. */
export async function authTrailSummary(admin: any, workspaceId: string, days = 7): Promise<AuthTrailSummary> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const trail = await authTrail(admin, { workspaceId, since, limit: 1000 });

  const shell = {
    recordedTypes: AUTH_EVENTS_RECORDED,
    notRecordedHere: AUTH_EVENTS_NOT_RECORDED_HERE,
  };
  if (!trail.readable)
    return {
      readable: false, signInsLast7Days: null, refusalsLast7Days: null, devicesFirstSeenLast7Days: null,
      lastSignInRecordedAt: null, truncated: false, ...shell,
    };

  const of = (t: AuthEventType) => trail.events.filter(e => e.event_type === t);
  const signIns = of(AUTH_EVENT.SIGN_IN);
  const refusals = trail.events.filter(e =>
    e.event_type === AUTH_EVENT.SESSION_REFUSED || e.event_type === AUTH_EVENT.MFA_REFUSED
    || e.event_type === AUTH_EVENT.IDLE_TIMEOUT || e.event_type === AUTH_EVENT.SECURITY_CHECK_UNAVAILABLE);

  return {
    readable: true,
    signInsLast7Days: signIns.length,
    refusalsLast7Days: refusals.length,
    devicesFirstSeenLast7Days: of(AUTH_EVENT.DEVICE_REGISTERED).length,
    lastSignInRecordedAt: signIns[0]?.occurred_at ?? null,
    truncated: trail.truncated,
    ...shell,
  };
}

/**
 * What the device register needs planted before it can run, stated once so a screen can say it.
 *
 * Exported rather than inlined because the sentence "no device was recorded for this request" is only
 * useful next to the reason, and the reason is a cookie name and where it comes from.
 */
export const DEVICE_REGISTER_REQUIREMENT = {
  cookie: DEVICE_COOKIE,
  plantedBy: "src/proxy.ts, on the first signed-in Practice request from a browser",
  ifAbsent: "the device register does not run for that request, no device is recorded, and the request is allowed through -- a bookkeeping cookie must never stand between a clinician and a clinical record",
};
