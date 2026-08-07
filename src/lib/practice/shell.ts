import { cookies, headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeAccess, resolveWorkspaceContext, readActiveWorkspaceId, type WorkspaceContext } from "@/lib/practice/access";
import { touchSession, getSecurityPolicy, mfaGate } from "@/lib/practice/security";
import { DEVICE_COOKIE } from "@/lib/practice/device-register";
import { AUTH_EVENT, recordAuthEvent, signInOccasion } from "@/lib/practice/auth-audit";

// Server-side shell resolution (CPR-SHELL-001 sections 5, 5.1 and 6.1).
//
// One function answers, for any authenticated Practice page, the question the guards ask IN ORDER --
// authentication, workspace, membership, workspace status, entitlement, onboarding -- and returns a
// discriminated union that maps one-to-one onto SHELL-001 s5.1 loading states. Pages switch on the state
// and redirect; they never re-derive access themselves, which is how guard order stays uniform across
// every route instead of being re-implemented slightly differently per page.
//
// The active-workspace COOKIE IS A PREFERENCE. It picks which workspace to try first; the resolution
// below re-validates it and falls back to the user's real memberships, so a stale cookie (workspace
// closed, membership revoked) degrades to the chooser rather than granting anything.

export type ShellState =
  | { state: "AUTH_REQUIRED" }
  | { state: "WORKSPACE_REQUIRED"; userId: string }
  | { state: "CHOOSER_REQUIRED"; userId: string; workspaces: { id: string; name: string; status: string }[] }
  | { state: "ONBOARDING_REQUIRED"; userId: string; ctx: WorkspaceContext }
  | { state: "ACCESS_RESTRICTED"; userId: string; reason: "WORKSPACE_INACTIVE" | "NOT_ENTITLED"; workspaceId: string }
  // CPR-370 (migration 213). Two more refusals, both AFTER entitlement and onboarding so they can never
  // mask a more basic problem: a revoked device, and a practice that requires a second factor.
  | { state: "SESSION_REVOKED"; userId: string; reason: "revoked" | "idle"; workspaceId: string }
  | { state: "MFA_REQUIRED"; userId: string; workspaceId: string; enrolled: boolean }
  // ⚠ "COULD NOT BE CHECKED" IS ITS OWN STATE, and it is deliberately not MFA_REQUIRED.
  //
  // A failed check must never read as a passed one -- but it must not read as a FAILED one either, and
  // that distinction is the whole point of this state. MFA_REQUIRED routes to a screen telling somebody
  // to go and enrol a second factor; sending a person there because a database read timed out would give
  // them an instruction that neither describes their situation nor gets them back in. This state says
  // what actually happened and offers a retry, and because it is derived fresh on every request it
  // clears itself the moment the underlying read works.
  | { state: "SECURITY_CHECK_UNAVAILABLE"; userId: string; workspaceId: string; check: "mfa_policy" | "mfa_status" }
  | { state: "READY"; userId: string; ctx: WorkspaceContext };

/**
 * Resolve the shell, then write down what happened at the door.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS WRAPPER IS THE PRODUCT'S ONLY AUTHENTICATION AUDIT TRAIL (COMP-AUTH-001 item 6).
 *
 * Before it, `practice_audit_event` held 2,480 rows across 38 event types and not one of them was an
 * authentication event -- while the public sign-in page carried a green tick beside "Every sign-in
 * recorded". The trail hangs off the shell rather than off a form because the Practice sign-in form is a
 * client component calling `supabase.auth.signInWithPassword` in the browser: there is no server hop to
 * instrument. Recording here catches a sign-in however it arrived.
 *
 * IT NEVER CHANGES THE ANSWER. The state is decided first and returned unaltered; recording is
 * bookkeeping and bookkeeping must not stand between a clinician and a clinical record. Every write is
 * deduplicated on GoTrue's `last_sign_in_at`, which does not move until somebody authenticates again, so
 * a refused person reloading the page twenty times produces one row, not twenty.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function resolvePracticeShell(): Promise<ShellState> {
  const { state, user } = await resolveShellState();
  if (user) await recordShellAuthEvents(state, user);
  return state;
}

type ShellUser = { id: string; lastSignInAt: string | null };
type ShellResolution = { state: ShellState; user: ShellUser | null };

async function resolveShellState(): Promise<ShellResolution> {
  // Guard 1: authentication (central Competen identity -- IAM-ADR-01, no separate Practice auth).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: { state: "AUTH_REQUIRED" }, user: null };

  const me: ShellUser = {
    id: user.id,
    // GoTrue's own record of when this person last authenticated. It is the identity of a sign-in, and
    // therefore both the thing recorded and the thing the recording is deduplicated on.
    lastSignInAt: (user as { last_sign_in_at?: string | null }).last_sign_in_at ?? null,
  };

  const admin = createAdminClient();
  // Every exit below carries the user, so the wrapper can record what happened at the door for a refusal
  // just as readily as for an entry. A refusal nobody wrote down is the half of an authentication trail
  // that gets missed.
  const at = (state: ShellState): ShellResolution => ({ state, user: me });

  // Guards 2-3: workspace resolution and membership.
  const access = await resolvePracticeAccess(admin, user.id);
  if (access.workspaces.length === 0) return at({ state: "WORKSPACE_REQUIRED", userId: user.id });

  // Pick the workspace: validated cookie preference, else the only one, else the chooser (SHELL-001 s8).
  const preferred = await readActiveWorkspaceId();
  let workspaceId: string | null = null;
  if (preferred && access.workspaces.some(w => w.id === preferred)) workspaceId = preferred;
  else if (access.workspaces.length === 1) workspaceId = access.workspaces[0].id;
  if (!workspaceId) {
    return at({
      state: "CHOOSER_REQUIRED", userId: user.id,
      workspaces: access.workspaces.map(w => ({ id: w.id, name: w.name, status: w.status })),
    });
  }

  // Guards 4-5: workspace status and entitlement.
  const res = await resolveWorkspaceContext(admin, user.id, workspaceId);
  if (!res.ok) {
    if (res.reason === "NO_MEMBERSHIP") return at({ state: "WORKSPACE_REQUIRED", userId: user.id });
    return at({ state: "ACCESS_RESTRICTED", userId: user.id, reason: res.reason, workspaceId });
  }

  // Guard 6: onboarding completion.
  if (res.ctx.workspaceStatus !== "ACTIVE") return at({ state: "ONBOARDING_REQUIRED", userId: user.id, ctx: res.ctx });

  // ── Guards 7-8: the device register and the practice's MFA policy (CPR-370, migration 213) ────────
  //
  // THIS IS WHAT MAKES "SIGN OUT THIS DEVICE" REAL. Revoking a session row does not end the platform
  // auth token -- nothing in this product can -- but it is checked HERE, on every request, so a revoked
  // device is refused by the practice on its very next page load. A revocation that were merely
  // cosmetic would be the most dangerous thing CPR-370 could ship: somebody would press it after losing
  // a laptop and stop worrying.
  //
  // touchSession never throws and returns `allowed` on any internal error, deliberately: a bookkeeping
  // failure must not lock a clinician out of a clinical record.
  //
  // ⚠ AND THE REGISTER ONLY RUNS IF THE PROXY PLANTED A DEVICE COOKIE. It used to run always, on a fresh
  // UUID minted per request, which is what made the register useless. When the cookie is absent the
  // honest answer is that no device can be identified, so nothing is written and nothing is checked --
  // and that is RECORDED rather than passed over in silence, because a device check that did not happen
  // reads exactly like a device check that passed.
  const h = await headers();
  const deviceId = await readDeviceId();
  const session = deviceId
    ? await touchSession(admin, {
      workspaceId: res.ctx.workspaceId, userId: user.id, deviceId,
      userAgent: h.get("user-agent"), authSignInAt: me.lastSignInAt,
      correlationId: h.get("x-trace-id"),
    })
    : { allowed: true, checked: false } as const;
  if (!session.allowed) {
    return at({ state: "SESSION_REVOKED", userId: user.id, reason: session.reason ?? "revoked", workspaceId: res.ctx.workspaceId });
  }
  if (!session.checked) {
    // Allowed, but not cleared. Recorded once per sign-in so a practice can see that the register was
    // not able to run rather than reading an empty device list as an empty practice.
    await recordAuthEvent(admin, {
      workspaceId: res.ctx.workspaceId, actorId: user.id,
      eventType: AUTH_EVENT.DEVICE_REGISTER_UNAVAILABLE,
      dedupeKey: signInOccasion(me.lastSignInAt).key,
      payload: { deviceCookiePresent: !!deviceId, allowedThrough: true },
      correlationId: h.get("x-trace-id"),
    });
  }

  // MFA IS THE PLATFORM'S TO ENFORCE; what this product can do is refuse to OPEN the practice without
  // it. Checked only when the practice has asked for it, so no existing workspace is locked out by a
  // migration.
  //
  // ⚠ BOTH READS BEHIND THIS DECISION FAIL CLOSED, INTO A RETRIABLE STATE RATHER THAN A REFUSAL.
  //
  // Read 1 -- the policy -- used to fall through to a hardcoded `mfa_required: false` whenever the table
  // could not be read, so a database fault switched the second factor off for that request. Read 2 -- the
  // assurance level -- discarded its error, and since `data` is null on failure the guard's `aal &&`
  // short-circuited and the function returned READY: AN MFA-REQUIRED PRACTICE OPENED WITHOUT MFA
  // WHENEVER THAT CALL ERRORED. Neither is a pass now; the decision itself lives in mfaGate, apart from
  // the request, so all three of its answers can be proved.
  //
  // Why this is not a lockout: NOTHING HERE RUNS UNLESS A PRACTICE ASKED FOR MFA (read 2) or the policy
  // is unreadable (read 1), the state is recomputed on every single request so a reload clears it, and
  // it lands on a screen that says a check could not be completed and offers to try again -- not on the
  // enrolment instruction, which this product has no page to satisfy. Note also that
  // getAuthenticatorAssuranceLevel decodes the session that `supabase.auth.getUser()` at the top of this
  // function already validated over the network, so a transient failure here means the session went away
  // mid-request; refusing is then the right answer rather than an unlucky one.
  const policy = await getSecurityPolicy(admin, res.ctx.workspaceId);
  const mfaRequired = policy.mfa_required === true;
  // Asked only when the answer can matter, so an unreadable policy never buys a round trip whose result
  // would be ignored anyway.
  const aal = policy.readable && mfaRequired
    ? await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    : null;

  const gate = mfaGate({ policyReadable: policy.readable, mfaRequired, aal });
  if (gate.decision === "UNAVAILABLE") {
    return at({ state: "SECURITY_CHECK_UNAVAILABLE", userId: user.id, workspaceId: res.ctx.workspaceId, check: gate.check });
  }
  if (gate.decision === "REFUSE") {
    return at({ state: "MFA_REQUIRED", userId: user.id, workspaceId: res.ctx.workspaceId, enrolled: gate.enrolled });
  }

  return at({ state: "READY", userId: user.id, ctx: res.ctx });
}

/**
 * The device identifier: a random value THIS PRODUCT SET, not a fingerprint.
 *
 * A fingerprint would identify a person across contexts they did not consent to; a cookie identifies a
 * browser that chose to sign in here, and clearing it honestly produces a new device.
 *
 * ⚠ READ ONLY, AND THAT IS THE FIX RATHER THAN A LIMITATION.
 *
 * This function used to try `cookies().set` and fall back to `crypto.randomUUID()` when it threw. In a
 * Server Component that call ALWAYS throws, so the fallback was the only path and every request minted a
 * brand-new device: 13,114 `practice_session` rows for 8 memberships, "sign out this device" marking a
 * row nothing would ever present again, and an idle rule that could never measure an interval. The
 * comment here said the cookie was "planted by the API the client calls" and there was no such API
 * anywhere in the repository -- `grep practice_device` returned three hits, all inside this file.
 *
 * The cookie is now planted by `src/proxy.ts`, which is the only place in a Next application that holds a
 * response and can legitimately set one. When it is missing, this returns null and the caller runs no
 * device check and records that it could not -- rather than inventing a device and then reasoning about
 * it, which is what produced the bug.
 */
async function readDeviceId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(DEVICE_COOKIE)?.value ?? null;
}

/**
 * Write down what happened at the door.
 *
 * ⚠ EVERY WRITE IS DEDUPLICATED ON THE SIGN-IN, NOT ON THE REQUEST. A person refused for a missing second
 * factor may reload thirty times; the trail should say they were refused, once, on this sign-in. The
 * dedupe key is GoTrue's `last_sign_in_at`, which does not move until somebody authenticates again.
 *
 * ⚠ AND IT NEVER THROWS INTO THE RENDER. Each recorder already reports its own failure rather than
 * discarding it, but a rejected promise here would take down a page over an audit row, so the whole
 * block is guarded. A failure is loud in the log and invisible on the screen, which is the right way
 * round for bookkeeping that must not obstruct clinical work.
 */
async function recordShellAuthEvents(state: ShellState, me: ShellUser): Promise<void> {
  try {
    const admin = createAdminClient();
    const h = await headers();
    const correlationId = h.get("x-trace-id");
    const occasion = signInOccasion(me.lastSignInAt);
    const workspaceId = "workspaceId" in state ? state.workspaceId
      : "ctx" in state ? state.ctx.workspaceId : null;

    // THE SIGN-IN ITSELF. Recorded on whichever Practice page the session first opens, whatever that
    // page turned out to be -- including a refusal, because being turned away at the door is still
    // having arrived at it.
    await recordAuthEvent(admin, {
      workspaceId, actorId: me.id, eventType: AUTH_EVENT.SIGN_IN, dedupeKey: occasion.key,
      payload: {
        authSignInAt: occasion.authSignInAt, sessionMarker: occasion.marker,
        shellState: state.state, userAgent: h.get("user-agent"),
      },
      correlationId,
    });

    // THE REFUSALS. One row per sign-in per kind, so the trail says what stood in this person's way
    // without growing a row for every reload of the page that says so.
    const refusal =
      state.state === "SESSION_REVOKED"
        ? { type: AUTH_EVENT.SESSION_REFUSED, payload: { reason: state.reason } }
        : state.state === "MFA_REQUIRED"
          ? { type: AUTH_EVENT.MFA_REFUSED, payload: { enrolled: state.enrolled } }
          : state.state === "SECURITY_CHECK_UNAVAILABLE"
            ? { type: AUTH_EVENT.SECURITY_CHECK_UNAVAILABLE, payload: { check: state.check } }
            : null;

    if (refusal) {
      await recordAuthEvent(admin, {
        workspaceId, actorId: me.id, eventType: refusal.type,
        dedupeKey: `${occasion.key}:${JSON.stringify(refusal.payload)}`,
        payload: { ...refusal.payload, authSignInAt: occasion.authSignInAt },
        correlationId,
      });
    }
  } catch (e) {
    console.error(`[practice] the authentication trail could not be written: ${String(e)}`);
  }
}

/** Is any active Practice membership present at all? Used by the auth-aware public /practice index. */
export async function hasPracticeMembership(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const admin = createAdminClient();
  const access = await resolvePracticeAccess(admin, user.id);
  return access.workspaces.length > 0;
}
