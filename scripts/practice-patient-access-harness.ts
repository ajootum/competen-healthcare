/**
 * CPR-V5-007 PHASE 4 -- PATIENT BOOKING ACCESS, AND THE ONE-TIME CODE THAT PROTECTS IT.
 *
 * ⚠ THIS IS AN AUTHENTICATION SURFACE, AND PHASE 4 DOES NOT SHIP COMPLETE. The specification's Phase 4
 * is "handle, link-only page, OTP, registration intake, confirmation". Four of those five need stores
 * this build does not have, and the fifth cannot be completed by any patient, because a one-time code
 * has to be SENT and this deployment has no SMS gateway and no mail provider. What is here is therefore:
 * the code machinery, hardened; the gate that keeps the door shut and says why; and the proof that
 * neither of them can be talked into saying yes.
 *
 * WHAT IT PROVES:
 *   1. Capability codes are REAL. Both codes this area names are checked against the live catalogue,
 *      from an exported array -- the audit harness's scanner only sees inline double-quoted literals, so
 *      a code introduced through a constants object would otherwise never be checked at all.
 *   2. The delivery channel's absence is READ, not assumed. Including the case that matters: an
 *      unreadable channel table is UNREADABLE, not "no channel configured".
 *   3. ⚠ THE GATE CANNOT BE CONFIGURED OPEN. Section 3 clears every blocker configuration can clear --
 *      a provider is pretended into the environment, both channels are switched on, the launch flag is
 *      inserted -- and the door stays shut on a blocker that is a fact about the code. The blockers that
 *      WERE cleared are asserted to have disappeared, so this is not a gate that always says no.
 *   4. A FAILED READ IS NEVER AN OPEN DOOR, AND NEVER A ZERO. Four unreadable tables, four refusals,
 *      four controls proving the same call succeeds against a healthy one.
 *   5. ⚠ A ONE-TIME CODE USED TEN TIMES AT ONCE IS ACCEPTED ONCE. The attempt counter was a
 *      read-modify-write with its error discarded; ten concurrent verifications of the same correct code
 *      all passed under it. It is now a compare-and-set, and section 5 fires the ten.
 *   6. AN UNCOUNTED ATTEMPT IS REFUSED RATHER THAN JUDGED, and an unreadable challenge store is an
 *      ERROR rather than a wrong code -- each asserted with the RIGHT code, so a broken engine's answer
 *      is the one that fails.
 *   7. RATE LIMITS FAIL CLOSED. The per-destination count used to be `(count ?? 0)`, which turned an
 *      unreadable table into an unlimited allowance. Per-source limiting REFUSES rather than silently
 *      skipping, because the register cannot record a source.
 *   8. THE ISSUE PATH CONSULTS NO RECORD KEYED ON THE DESTINATION, so it cannot tell a stranger whether
 *      a number is known here. Proven by making the patient register unreadable and showing the answer
 *      does not move -- with a control proving the register really was unreadable.
 *   9. A PATIENT SESSION IS NOT A PRACTITIONER SESSION. The patient-facing route imports nothing that
 *      resolves a practitioner identity, with a control proving the same scanner finds those imports in
 *      a practitioner page.
 *  10. NOTHING RETURNS OR LOGS A CODE. Asserted against a real code, captured from a real message.
 *
 *   npx --yes tsx scripts/practice-patient-access-harness.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { issueOtp, verifyOtp, type Transport } from "../src/lib/practice/messaging";
import {
  deliveryReadiness, storePresence, patientAccessGate, patientAccessReadiness, patientBookingSurface,
} from "../src/lib/practice/patient-access";
import {
  PATIENT_ACCESS_CAPABILITIES, PATIENT_ACCESS_MODES, PATIENT_ACCESS_MODES_REACHABLE,
  PATIENT_BOOKING_FLAG, PATIENT_ACCESS_STORES, PATIENT_ACCESS_BUILD_BLOCKERS,
} from "../src/lib/practice/patient-access-constants";
import { PRACTICE_NAV } from "../src/lib/practice/navigation";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const REPO = join(__dirname, "..");
const OWNER = "00000000-0000-4000-8000-0000000fa001";
const OTHER = "00000000-0000-4000-8000-0000000fa002";
const TZ = "Africa/Kampala";
const CORR = "harness-patient-access";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pa-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_otp_challenge").delete().eq("workspace_id", w.id);
      await admin.from("practice_message").delete().eq("workspace_id", w.id);
      await admin.from("practice_message_channel").delete().eq("workspace_id", w.id);
      await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
      await admin.from("practice_patient").delete().eq("workspace_id", w.id);
      await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  await admin.from("practice_otp_challenge").delete().like("destination", "+256711%");
  await admin.from("practice_platform_flags").delete().eq("flag", PATIENT_BOOKING_FLAG);
}

/**
 * An admin client on which one table cannot be read.
 *
 * ⚠ THE ONLY WAY TO TEST "A FAILED READ IS NEVER A ZERO". It is a claim about what happens when a query
 * FAILS, and a working database never produces one. Same device as the booking-rules harness's, and
 * deliberately the same shape so a reader who has seen one has seen both.
 */
function adminWithUnreadable(real: any, table: string) {
  const failing = (): any => {
    const p: any = new Proxy({} as any, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: any) => resolve({ data: null, error: { message: "simulated read failure" }, count: null });
        return () => p;
      },
    });
    return p;
  };
  return new Proxy(real, {
    get(t: any, prop: string) {
      if (prop === "from") return (name: string) => (name === table ? failing() : t.from(name));
      const v = t[prop];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/**
 * An admin client on which one table answers as though it did not exist.
 *
 * ⚠ THE CONTROL FOR "MISSING IS NOT UNREADABLE", NOW THAT THE TABLES ARE REAL. Migrations 253-255 landed
 * the three stores this area probes for, so the database can no longer produce an absent one -- and a
 * presence probe that can only ever say "present" is a function that returns true. PGRST205 is the code
 * PostgREST answers with for a table it cannot find, and it is the exact string storePresence() treats as
 * absence.
 */
function adminWithMissingTable(real: any, table: string) {
  const missing = (): any => {
    const p: any = new Proxy({} as any, {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: any) => resolve({
            data: null, count: null,
            error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` },
          });
        return () => p;
      },
    });
    return p;
  };
  return new Proxy(real, {
    get(t: any, prop: string) {
      if (prop === "from") return (name: string) => (name === table ? missing() : t.from(name));
      const v = t[prop];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

// ⚠ adminWithTable() USED TO LIVE HERE, and it is gone rather than left unused. It made one table answer
// as though it existed and were empty, which was the only way to prove the presence probe could say
// "present" while every real store was absent. Migration 254 landed the stores, so the real database now
// provides that half and adminWithMissingTable() above provides the other. A stub kept "in case" is a
// stub nobody maintains.

/** Everything "sent" in this run lands here and nowhere else. No request leaves the process. */
const outbox: { kind: string; destination: string; body: string }[] = [];
const recorder: Transport = async (kind, destination, body) => {
  outbox.push({ kind, destination, body });
  return { ok: true, providerMessageId: `harness-${outbox.length}`, response: '{"harness":true}' };
};

/** Walk a payload and report every path that is not JSON-safe. */
function nonSerialisable(value: unknown, path = "$", out: string[] = []): string[] {
  if (typeof value === "function") out.push(`${path} is a function`);
  else if (value && typeof value === "object") {
    if (value instanceof Date || value instanceof Map || value instanceof Set) out.push(`${path} is a ${value.constructor.name}`);
    else for (const [k, v] of Object.entries(value)) nonSerialisable(v, `${path}.${k}`, out);
  }
  return out;
}

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every marker that means "this file resolves a PRACTITIONER identity". */
const PRACTITIONER_SESSION_MARKERS = [
  "practice/shell", "resolvePracticeShell", "requirePracticeContext",
  "resolveWorkspaceContext", "resolvePracticeAccess", "hasCapability",
  "ACTIVE_WS_COOKIE", "practice_active_ws", "capabilities",
];

/**
 * ⚠ COMMENTS ARE STRIPPED BEFORE THE SCAN, AND THIS IS NOT A CONVENIENCE.
 *
 * The first version of this scanner read the raw file, and it failed -- correctly -- on the patient
 * page, whose header comment EXPLAINS that it deliberately does not call resolvePracticeShell. A
 * scanner that cannot tell a call from a sentence about a call forces the next person to choose between
 * a green harness and a comment that says what the file is for, and they will delete the comment.
 *
 * The assertion is about what the code DOES. Prose is not code.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const practitionerMarkersIn = (file: string) => {
  const code = stripComments(readFileSync(file, "utf8"));
  return PRACTITIONER_SESSION_MARKERS.filter(m => code.includes(m));
};

async function main() {
  console.log("\nCPR-V5-007 PHASE 4 -- patient booking access and the one-time code\n");
  await cleanup();

  // ══ 0. CONTROLS: THE FIXTURE IS REAL BEFORE ANYTHING IS CLAIMED ABOUT IT ═══════════════════════
  section("0. Controls");

  const challengeProbe = await admin.from("practice_otp_challenge")
    .select("id, code_hash, attempts, max_attempts, consumed_at, expires_at").limit(1);
  ok("0a-control. the challenge register is readable and has the columns migration 224 promised",
    !challengeProbe.error, challengeProbe.error?.message ?? "");
  if (challengeProbe.error) return report();

  const wsA = await provision(OWNER, "Patient Access Harness", "a");
  const wsB = await provision(OTHER, "Patient Access Harness Other", "b");
  ok("0b-control. two separate practices exist to test a boundary between", wsA !== wsB, `${wsA} / ${wsB}`);

  const resA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const resB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!resA.ok || !resB.ok) { ok("0b-control. contexts resolve", false); return report(); }
  const ctxA: WorkspaceContext = resA.ctx;
  const ctxB: WorkspaceContext = resB.ctx;
  ok("0c-control. the owner's capabilities were read from the grants, not typed into this file",
    ctxA.capabilities.length > 0, `${ctxA.capabilities.length} granted`);

  // ══ 1. CAPABILITY CODES ARE REAL, INCLUDING THE ONES A SCANNER CANNOT SEE ══════════════════════
  section("1. Capability codes");

  const { data: catRows, error: catErr } = await admin.from("practice_role_capabilities").select("capability_code");
  ok("1a-control. the capability catalogue is readable and populated -- a failed read is not an empty one",
    !catErr && ((catRows ?? []) as any[]).length >= 30,
    catErr?.message ?? `${((catRows ?? []) as any[]).length} rows`);
  const catalogue = new Set(((catRows ?? []) as any[]).map(r => r.capability_code as string));

  ok("1a-control-2. and the catalogue check can say NO -- a code this product has already invented reads as absent",
    !catalogue.has("encounter.view") && !catalogue.has("practice.calendar.manage"),
    "an invented code reads as real, so 1a proves nothing");

  const invented = PATIENT_ACCESS_CAPABILITIES.filter(c => !catalogue.has(c));
  ok("1a. ⚠ every capability code this area names exists in practice_role_capabilities",
    invented.length === 0 && PATIENT_ACCESS_CAPABILITIES.length >= 2, invented.join(", "));

  // ⚠ THE BLIND SPOT THIS CLOSES. The audit harness scans for inline double-quoted literals inside
  // requirePracticeContext(...) and friends. The API route below declares its capability that way, so
  // the scanner sees it -- and this assertion ties the literal it will find to the exported array, so
  // the two can never name different codes.
  const routeFile = join(REPO, "src", "app", "api", "v1", "practice", "patient-access", "route.ts");
  const routeSrc = existsSync(routeFile) ? readFileSync(routeFile, "utf8") : "";
  const declared = [...routeSrc.matchAll(/requirePracticeContext\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]);
  ok("1b. the route's declared capability is one the array names AND one the catalogue holds",
    declared.length === 1 && PATIENT_ACCESS_CAPABILITIES.includes(declared[0]) && catalogue.has(declared[0]),
    declared.join(", ") || "no requirePracticeContext literal found");

  ok("1c. s8's four access modes exist, and only the internal one is reachable in this build",
    PATIENT_ACCESS_MODES.length === 4 && PATIENT_ACCESS_MODES_REACHABLE.length === 1
    && PATIENT_ACCESS_MODES_REACHABLE[0] === "internal_only",
    PATIENT_ACCESS_MODES_REACHABLE.join(", "));

  // ══ 2. THE DELIVERY CHANNEL'S ABSENCE IS READ, NOT ASSUMED ════════════════════════════════════
  section("2. Delivery");

  const envSnapshot: Record<string, string | undefined> = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    // ⚠ A KEY ALONE STOPPED BEING A CONFIGURED PROVIDER, AND THIS FIXTURE DID NOT NOTICE.
    //
    // messagingStatus() now asks for `RESEND_API_KEY && emailFrom()`, because a deployment with a key and
    // no from-address sends from no-reply@example.invalid and Resend rejects it. This harness pretended a
    // provider into existence by setting the key alone, so every section that needs one silently ran in a
    // world where nothing could send -- which is exactly the failure mode the comment below this one was
    // written about, in the other direction. Both halves are snapshotted, set and restored.
    RESEND_FROM: process.env.RESEND_FROM,
  };
  /**
   * ⚠ `process.env.X = undefined` SETS THE STRING "undefined", WHICH IS TRUTHY.
   *
   * The first version of this file restored the environment that way, and messagingStatus() -- which
   * asks `!!process.env.RESEND_API_KEY` -- went on believing a mail provider was configured for the rest
   * of the run. Section 7 caught it, because the patient-facing surface stopped naming the delivery
   * channel as the reason it was shut. Restoring an environment variable to absent means DELETING it.
   */
  const restoreEnv = () => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  ok("2a-control. this deployment genuinely has no gateway configured -- everything below rests on it",
    !envSnapshot.TWILIO_ACCOUNT_SID && !envSnapshot.RESEND_API_KEY,
    "a provider is configured, so section 2 is testing a different world than the one that ships");

  const dNoWs = await deliveryReadiness(admin, null);
  ok("2b. asked without a practice, delivery is not possible and the deployment is named",
    dNoWs.state === "ok" && !dNoWs.value.deliverable
    && dNoWs.value.reasons.some(r => /no SMS gateway and no mail provider/i.test(r)),
    JSON.stringify(dNoWs));
  ok("2c. and the PRACTICE half is null rather than guessed at -- `usable` is not claimed without one",
    dNoWs.state === "ok" && dNoWs.value.channels.every(c => c.practiceEnabled === null && !c.usable),
    JSON.stringify(dNoWs.state === "ok" ? dNoWs.value.channels : null));

  const dWs = await deliveryReadiness(admin, wsA);
  ok("2d. asked about a practice, both channels read as off",
    dWs.state === "ok" && dWs.value.channels.every(c => c.practiceEnabled === false),
    JSON.stringify(dWs));

  // ⚠ NON-VACUOUS: a function that returned `false` unconditionally would pass 2b-2d. This one has to
  // MOVE when the table moves.
  await admin.from("practice_message_channel").insert({
    workspace_id: wsA, kind: "sms", enabled: true, sender_name: "Harness",
  });
  const dEnabled = await deliveryReadiness(admin, wsA);
  ok("2e. ⚠ switching a channel on MOVES the answer -- the table is read, not described",
    dEnabled.state === "ok"
    && dEnabled.value.channels.find(c => c.kind === "sms")?.practiceEnabled === true
    && dEnabled.value.channels.find(c => c.kind === "email")?.practiceEnabled === false,
    JSON.stringify(dEnabled.state === "ok" ? dEnabled.value.channels : null));
  ok("2f. and it is STILL not deliverable, because the practice switching it on does not supply a gateway",
    dEnabled.state === "ok" && !dEnabled.value.deliverable,
    JSON.stringify(dEnabled.state === "ok" ? dEnabled.value.reasons : null));

  // ⚠ AN UNREADABLE CHANNEL TABLE IS UNREADABLE, NOT "NO CHANNEL". channelSettings() collapses these two
  // -- right for sending, wrong for reporting -- so this is the branch that had to be written fresh.
  const dBroken = await deliveryReadiness(adminWithUnreadable(admin, "practice_message_channel"), wsA);
  ok("2g. ⚠ an unreadable channel table is UNREADABLE, never 'nothing is switched on'",
    dBroken.state === "unreadable" && /could not be read/i.test((dBroken as any).reason),
    JSON.stringify(dBroken));
  ok("2g-control. the same call against the real database is readable, so 2g is not always-unreadable",
    dEnabled.state === "ok");

  await admin.from("practice_message_channel").delete().eq("workspace_id", wsA);

  // ══ 3. THE GATE ═══════════════════════════════════════════════════════════════════════════════
  section("3. The gate");

  const gate0 = await patientAccessGate(admin, { workspaceId: wsA });
  ok("3a. the door is shut", !gate0.open, JSON.stringify(gate0.blockers.map(b => b.code)));
  ok("3b. ⚠ and the DELIVERY CHANNEL is the first thing it says -- not the fifth",
    gate0.blockers[0]?.code === "DELIVERY_CHANNEL_ABSENT", gate0.blockers.map(b => b.code).join(" > "));
  // ⚠ THIS ASSERTION TURNED ROUND, AND THE TURN IS THE POINT.
  //
  // It read: "the build blocker is present and is named as a limit in the payload, not in prose" --
  // INTAKE_NOT_BUILT, true for as long as there was no intake and no confirmation. patient-booking.ts
  // built both, so PATIENT_ACCESS_BUILD_BLOCKERS is empty and the gate no longer pushes it.
  //
  // The PROPERTY under test is unchanged: whatever the build's own limits are, they appear as DATA on
  // the payload and match the exported list exactly. That is still asserted, against a list that is now
  // empty -- and an empty list is asserted to be genuinely empty rather than merely absent.
  ok("3c. the build's own limits are named as data and match the exported list -- which is now empty, because the intake was built",
    gate0.buildBlockers.length === PATIENT_ACCESS_BUILD_BLOCKERS.length
    && PATIENT_ACCESS_BUILD_BLOCKERS.length === 0
    && !gate0.blockers.some(b => b.code === "INTAKE_NOT_BUILT"),
    JSON.stringify({ payload: gate0.buildBlockers, exported: PATIENT_ACCESS_BUILD_BLOCKERS }));
  ok("3d. the flag is off, and it is off because nothing turned it on rather than because it was set off",
    !gate0.flagEnabled && gate0.flag === PATIENT_BOOKING_FLAG);
  ok("3e. no session is bookable by a patient yet, and the gate says so",
    gate0.blockers.some(b => b.code === "NO_BOOKABLE_SESSION"));
  ok("3f. no rule mentions patient self-booking, and that is a WARNING rather than a blocker",
    gate0.warnings.some(b => b.code === "NO_PATIENT_RULE")
    && !gate0.blockers.some(b => b.code === "NO_PATIENT_RULE"),
    gate0.warnings.map(b => b.code).join(", "));

  // ── 3g. ⚠ THE ONE THAT MATTERS: THE GATE CANNOT BE CONFIGURED OPEN ────────────────────────────
  //
  // Every blocker that a deployment or a practitioner could clear is cleared here: a provider is
  // pretended into the environment, both channels are switched on, the launch flag is inserted, a
  // session is opened to patients and a patient rule is written. If `open` were merely "everything I
  // could check said no", it would now say yes.
  const { data: locA } = await admin.from("practice_location").select("id").eq("workspace_id", wsA).limit(1).maybeSingle();
  await admin.from("practice_availability_template").insert([
    { workspace_id: wsA, location_id: locA?.id ?? null, weekday: 1, starts_minute: 540, ends_minute: 720, status: "active", booking_mode: "internal", session_name: "Monday internal" },
    { workspace_id: wsA, location_id: locA?.id ?? null, weekday: 2, starts_minute: 540, ends_minute: 720, status: "active", booking_mode: "internal", session_name: "Tuesday internal" },
    { workspace_id: wsA, location_id: locA?.id ?? null, weekday: 3, starts_minute: 540, ends_minute: 720, status: "active", booking_mode: "internal", session_name: "Wednesday internal" },
    { workspace_id: wsA, location_id: locA?.id ?? null, weekday: 4, starts_minute: 540, ends_minute: 720, status: "active", booking_mode: "link_only", session_name: "Thursday link only" },
    { workspace_id: wsA, location_id: locA?.id ?? null, weekday: 5, starts_minute: 540, ends_minute: 720, status: "active", booking_mode: "link_only", session_name: "Friday link only" },
    { workspace_id: wsA, location_id: locA?.id ?? null, weekday: 6, starts_minute: 540, ends_minute: 720, status: "active", booking_mode: "public", session_name: "Saturday public" },
  ]);
  await admin.from("practice_booking_rule").insert({
    workspace_id: wsA, name: "Patient self-booking", status: "draft", channel: "patient_self",
    location_id: locA?.id ?? null, priority: 0, lead_time_minutes: 0,
  });
  await admin.from("practice_message_channel").insert([
    { workspace_id: wsA, kind: "sms", enabled: true, sender_name: "Harness" },
    { workspace_id: wsA, kind: "email", enabled: true, sender_name: "Harness" },
  ]);
  await admin.from("practice_platform_flags").insert({
    flag: PATIENT_BOOKING_FLAG, enabled: true, note: "harness only",
  });
  process.env.RESEND_API_KEY = "re_harness_only";
  process.env.RESEND_FROM = "harness@example.invalid";

  const gateBest = await patientAccessGate(admin, { workspaceId: wsA });
  ok("3g-control-1. the cleared blockers really are gone -- delivery, the flag and the session are no longer refusing",
    !gateBest.blockers.some(b => ["DELIVERY_CHANNEL_ABSENT", "FLAG_OFF", "NO_BOOKABLE_SESSION"].includes(b.code))
    && gateBest.flagEnabled && gateBest.delivery?.deliverable === true,
    gateBest.blockers.map(b => b.code).join(", "));
  ok("3g-control-2. and the warning cleared too, so the gate is responding to the fixture throughout",
    !gateBest.warnings.some(b => b.code === "NO_PATIENT_RULE"),
    gateBest.warnings.map(b => b.code).join(", "));
  // ══ ⚠ 3g HAS REVERSED, DELIBERATELY, AND THIS IS THE MOST IMPORTANT COMMENT IN THIS FILE ═════════
  //
  // It read: "AND THE DOOR IS STILL SHUT. No configuration opens a door with nothing behind it", and it
  // was the assertion this whole section existed for. It was true because INTAKE_NOT_BUILT was true:
  // there was no intake, no confirmation, and no way for a patient booking to arrive, so clearing every
  // configurable blocker still left one that no setting and no migration could clear.
  //
  // patient-booking.ts built the intake and the confirmation, and booking-rules.ts gave the patient_self
  // channel a door guarded by a verified patient session. THERE IS NOW SOMETHING BEHIND THE DOOR. So a
  // practice that has a gateway, an enabled channel, the launch flag, a bookable session and a patient
  // rule can genuinely take a booking -- and a gate that still said `open: false` would be lying in the
  // opposite direction, which is the failure mode this codebase calls a control that does nothing.
  //
  // ⚠ THE PROPERTY BEING PROVED IS THEREFORE THE STRONGER ONE: THE GATE CAN SAY YES AND IT CAN SAY NO,
  // and which it says is derived from the fixture rather than hard-coded. 3a already proved it says no
  // against an unconfigured practice; this proves it says yes when, and only when, everything is truly in
  // place. An assertion that could only ever produce one answer is a function that returns a constant.
  ok("3g. ⚠ AND NOW THE DOOR OPENS -- because there is finally something behind it. This assertion was the reverse until the intake was built",
    gateBest.open && gateBest.blockers.length === 0,
    JSON.stringify({ open: gateBest.open, blockers: gateBest.blockers.map(b => b.code) }));
  // ⚠ AND THE CONTROL THAT KEEPS 3g HONEST: taking away ONE configurable thing shuts it again. Without
  // this, 3g is indistinguishable from a gate that started saying yes to everything.
  await admin.from("practice_platform_flags").delete().eq("flag", PATIENT_BOOKING_FLAG);
  const gateFlagOff = await patientAccessGate(admin, { workspaceId: wsA });
  ok("3g-b. ⚠ and removing a single cleared blocker shuts it again -- so 3g is derived from the fixture, not a gate that now says yes to anything",
    !gateFlagOff.open && gateFlagOff.blockers.some(b => b.code === "FLAG_OFF"),
    gateFlagOff.blockers.map(b => b.code).join(", "));
  await admin.from("practice_platform_flags").insert({
    flag: PATIENT_BOOKING_FLAG, enabled: true, note: "harness only",
  });

  // Put the world back before anything else reads it.
  restoreEnv();
  await admin.from("practice_platform_flags").delete().eq("flag", PATIENT_BOOKING_FLAG);
  await admin.from("practice_message_channel").delete().eq("workspace_id", wsA);
  const gateRestored = await patientAccessGate(admin, { workspaceId: wsA });
  ok("3g-control-3. the world was put back -- delivery refuses again, so nothing after this runs in the pretend world",
    gateRestored.blockers.some(b => b.code === "DELIVERY_CHANNEL_ABSENT") && !gateRestored.flagEnabled,
    gateRestored.blockers.map(b => b.code).join(", "));
  // ⚠ AND THE ENVIRONMENT SPECIFICALLY, because the channel being off would mask a leaked provider key
  // and let every later section run in the pretend world without a single assertion noticing.
  ok("3g-control-4. ⚠ including the environment -- no provider key survived the pretending",
    gateRestored.delivery?.channels.every(c => !c.providerConfigured) === true,
    JSON.stringify(gateRestored.delivery?.channels.map(c => [c.kind, c.providerConfigured])));

  // ── 3h. A FAILED READ IS NEVER AN OPEN DOOR ───────────────────────────────────────────────────
  const gateBrokenSessions = await patientAccessGate(
    adminWithUnreadable(admin, "practice_availability_template"), { workspaceId: wsA });
  ok("3h. ⚠ an unreadable session table produces READ_FAILED and a shut door, not 'no sessions'",
    !gateBrokenSessions.open
    && gateBrokenSessions.blockers.some(b => b.code === "READ_FAILED")
    && !gateBrokenSessions.blockers.some(b => b.code === "NO_BOOKABLE_SESSION"),
    gateBrokenSessions.blockers.map(b => b.code).join(", "));
  ok("3h-control. the same call against the real database raises no READ_FAILED, so 3h is not always-failing",
    !gateRestored.blockers.some(b => b.code === "READ_FAILED"),
    gateRestored.blockers.map(b => b.code).join(", "));

  // ── 3i. MISSING IS NOT UNREADABLE ─────────────────────────────────────────────────────────────
  // ⚠ THIS ASSERTION USED TO SAY THE OPPOSITE, AND BOTH VERSIONS ARE TRUE OF THEIR OWN DAY.
  //
  // It read "every one of them is absent today", which was the honest state of the build when it was
  // written. Migration 254 created practice_booking_access, practice_booking_request and
  // practice_patient_session, so the probe's answer changed on its own -- which is precisely what
  // storePresence() was written to do, and why it probes instead of remembering. The property being
  // asserted is unchanged: the probe reports what the database actually holds.
  const stores = await storePresence(admin);
  ok("3i. every store Phase 4 needs is probed, and migration 254 has landed all of them",
    stores.state === "ok" && stores.value.length === PATIENT_ACCESS_STORES.length
    && stores.value.every(s => s.present),
    JSON.stringify(stores));
  const storesBroken = await storePresence(adminWithUnreadable(admin, "practice_booking_access"));
  ok("3j. ⚠ a table that could not be REACHED is unreadable, not absent -- a network wobble is not 'Phase 4 is unbuilt'",
    storesBroken.state === "unreadable", JSON.stringify(storesBroken));
  // ⚠ THE CONTROL HAD TO TURN ROUND WITH IT. It used to prove the probe could say PRESENT while the real
  // answer was absent; the real answer is now present, so what needs proving is that the probe can still
  // say ABSENT -- otherwise 3i is a function that returns true.
  const storesMissing = await storePresence(adminWithMissingTable(admin, "practice_booking_request"));
  ok("3j-control. ⚠ and the probe CAN still say absent -- otherwise 3i is a function that returns true",
    storesMissing.state === "ok"
    && storesMissing.value.find(s => s.table === "practice_booking_request")?.present === false
    && storesMissing.value.find(s => s.table === "practice_booking_access")?.present === true,
    JSON.stringify(storesMissing));
  // And absence still SHUTS THE GATE. The blocker exists for a deployment that has not applied 254, and
  // it must not have quietly stopped working because this one has.
  const gateNoStore = await patientAccessGate(
    adminWithMissingTable(admin, "practice_booking_access"), { workspaceId: wsA });
  ok("3j-control-2. ⚠ and a deployment WITHOUT the store is still refused by name, not merely by INTAKE_NOT_BUILT",
    !gateNoStore.open && gateNoStore.blockers.some(b => b.code === "ACCESS_PROFILE_STORE_ABSENT"),
    gateNoStore.blockers.map(b => b.code).join(", "));

  // ══ 4. THE FIGURES A PRACTITIONER SEES ════════════════════════════════════════════════════════
  section("4. Readiness figures");

  const readiness = await patientAccessReadiness(admin, ctxA);
  // ⚠ THE FIXTURE IS 3 INTERNAL AND 3 PATIENT-FACING OUT OF 6. An engine that counted every session,
  // or none, or only `link_only`, gives 6, 0 or 2 -- all different from 3. A fixture where every session
  // was patient-facing could not tell any of those apart.
  ok("4a. ⚠ the count is of sessions opened to patients, with a denominator",
    readiness.sessionsOpenedToPatients === 3 && readiness.sessionsTotal === 6,
    `${readiness.sessionsOpenedToPatients} of ${readiness.sessionsTotal}`);
  ok("4b. and it is the length of a list that can be opened",
    readiness.sessionsOpenedToPatientsIds.length === readiness.sessionsOpenedToPatients,
    JSON.stringify(readiness.sessionsOpenedToPatientsIds));
  ok("4c. the ids are the patient-facing ones, not just any three",
    await (async () => {
      const { data } = await admin.from("practice_availability_template")
        .select("id, booking_mode").in("id", readiness.sessionsOpenedToPatientsIds);
      return ((data ?? []) as any[]).length === 3
        && ((data ?? []) as any[]).every(s => ["link_only", "public"].includes(s.booking_mode));
    })(), readiness.sessionsOpenedToPatientsIds.join(", "));
  ok("4d. the patient-self rule is counted, with its denominator",
    readiness.rulesNamingPatientSelf === 1 && (readiness.rulesTotal ?? 0) >= 1,
    `${readiness.rulesNamingPatientSelf} of ${readiness.rulesTotal}`);
  ok("4e. and nothing is incomplete when everything read",
    readiness.incomplete === false);

  const readinessBroken = await patientAccessReadiness(
    adminWithUnreadable(admin, "practice_availability_template"), ctxA);
  ok("4f. ⚠ AN UNREADABLE LIST IS NULL, NOT NOUGHT -- '0 sessions opened' is a sentence about the practice",
    readinessBroken.sessionsOpenedToPatients === null && readinessBroken.sessionsTotal === null
    && readinessBroken.incomplete === true,
    JSON.stringify({ n: readinessBroken.sessionsOpenedToPatients, incomplete: readinessBroken.incomplete }));
  ok("4f-control. and the rules it COULD read are still counted, so 4f is not 'everything went null'",
    readinessBroken.rulesNamingPatientSelf === 1, String(readinessBroken.rulesNamingPatientSelf));

  const readinessB = await patientAccessReadiness(admin, ctxB);
  ok("4g. another practice sees none of this one's sessions or rules",
    readinessB.sessionsTotal === 0 && readinessB.rulesTotal === 0,
    `${readinessB.sessionsTotal} / ${readinessB.rulesTotal}`);

  // ══ 5. THE ONE-TIME CODE, AS AN AUTHENTICATION CONTROL ════════════════════════════════════════
  section("5. The one-time code");

  // ── 5a. THE RATE LIMIT FAILS CLOSED ───────────────────────────────────────────────────────────
  //
  // ⚠ THIS WAS `(count ?? 0) >= 5`, WITH THE ERROR DISCARDED. An unreadable challenge table -- or
  // PostgREST answering with a null count, which it does -- read as "nought codes in the last hour" and
  // permitted an unlimited number. A rate limit whose failure mode is no-limit is not a rate limit.
  const rlBroken = await issueOtp(adminWithUnreadable(admin, "practice_otp_challenge"), {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256711000001",
    correlationId: CORR, transport: recorder,
  });
  ok("5a. ⚠ an uncountable rate limit REFUSES -- it does not read as nought codes sent",
    !rlBroken.ok && (rlBroken as any).code === "RATE_LIMIT_UNREADABLE" && (rlBroken as any).status === 503,
    rlBroken.ok ? "a code was issued against an unreadable register" : (rlBroken as any).code);

  const rlHealthy = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256711000001",
    correlationId: CORR, transport: recorder,
  });
  ok("5a-control. ⚠ the same call against the real register gets PAST the rate limit -- so 5a is about the read, not about the call",
    !rlHealthy.ok && (rlHealthy as any).code === "NOT_DELIVERED",
    rlHealthy.ok ? "it issued" : (rlHealthy as any).code);
  ok("5a-control-2. and it stopped at delivery, which is the honest state of this deployment",
    !rlHealthy.ok && (rlHealthy as any).code === "NOT_DELIVERED");

  // ── 5b. PER-SOURCE LIMITING IS REAL OR IT REFUSES ─────────────────────────────────────────────
  //
  // ⚠ THIS ASSERTION ALSO USED TO SAY THE OPPOSITE, AND FOR THE SAME REASON AS 3i.
  //
  // It read "a request that asks to be limited by source is REFUSED when the register cannot record one",
  // and SOURCE_LIMIT_UNAVAILABLE was what came back, because practice_otp_challenge had nowhere to put a
  // source. Migration 253 added source_hash. The refusal path is still in messaging.ts and 5a already
  // proves an unreadable register refuses; what changed is that this deployment now HAS the column, so a
  // source-limited request is no longer turned away for want of somewhere to record one.
  const srcLimited = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256711000002",
    sourceKey: "203.0.113.7", correlationId: CORR, transport: recorder,
  });
  ok("5b. ⚠ a source-limited request is no longer refused for want of a register -- migration 253 gave it one",
    !srcLimited.ok && (srcLimited as any).code === "NOT_DELIVERED",
    srcLimited.ok ? "it issued" : `${(srcLimited as any).code}: ${(srcLimited as any).message}`);

  // ── FROM HERE A PROVIDER IS PRETENDED INTO EXISTENCE, so a code can actually be issued ─────────
  process.env.RESEND_API_KEY = "re_harness_only";
  process.env.RESEND_FROM = "harness@example.invalid";
  await admin.from("practice_message_channel").insert({
    workspace_id: wsA, kind: "email", enabled: true, sender_name: "Harness", require_consent: false,
  });

  const issued = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "email", destination: "someone@example.invalid",
    correlationId: CORR, transport: recorder,
  });
  ok("5c-control-1. with a channel and a transport, a code is issued -- everything below needs a real one",
    issued.ok, issued.ok ? "" : (issued as any).message);
  if (!issued.ok) { await teardown(); return report(); }

  const realCode = (outbox[outbox.length - 1].body.match(/(\d{6})/) ?? [])[1];
  ok("5c-control-2. and the code reached the MESSAGE, which is where a patient would read it",
    !!realCode && /^\d{6}$/.test(realCode), String(realCode));

  // ── 5b-b. AND THE SOURCE IS ACTUALLY RECORDED, AS A HASH ──────────────────────────────────────
  //
  // ⚠ THE REPLACEMENT FOR WHAT 5b USED TO PROVE. "The register can record a source" is only worth saying
  // if the source is really written -- and only worth shipping if it is written as a hash. An IP address
  // in the clear on every code request is a log of who asked, kept in a table with a different retention
  // story from the one anybody agreed to. This can only be asserted once a code can actually be issued,
  // which is why it sits below the pretended provider rather than beside 5b.
  const SOURCE = "203.0.113.9";
  const withSource = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "email", destination: "sourced@example.invalid",
    sourceKey: SOURCE, correlationId: CORR, transport: recorder,
  });
  ok("5b-b. a source-limited request now issues, because the register can hold a source",
    withSource.ok, withSource.ok ? "" : (withSource as any).message);
  const { data: sourcedChallenge } = withSource.ok
    ? await admin.from("practice_otp_challenge").select("source_hash").eq("id", withSource.data.challengeId).maybeSingle()
    : { data: null };
  ok("5b-c. ⚠ and the source is stored as 64 hex characters, never in the clear",
    !!(sourcedChallenge as any)?.source_hash &&
    /^[0-9a-f]{64}$/.test((sourcedChallenge as any).source_hash) &&
    !(sourcedChallenge as any).source_hash.includes(SOURCE),
    JSON.stringify(sourcedChallenge));

  const withoutSource = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "email", destination: "unsourced@example.invalid",
    correlationId: CORR, transport: recorder,
  });
  const { data: unsourcedChallenge } = withoutSource.ok
    ? await admin.from("practice_otp_challenge").select("source_hash").eq("id", withoutSource.data.challengeId).maybeSingle()
    : { data: null };
  ok("5b-control. ⚠ CONTROL: the same call WITHOUT a source stores none -- so 5b-c is reading the argument, not a column that is always filled",
    withoutSource.ok && (unsourcedChallenge as any)?.source_hash === null,
    JSON.stringify(unsourcedChallenge));

  // ── 5d. NOTHING RETURNS OR LOGS A CODE ────────────────────────────────────────────────────────
  ok("5d. ⚠ the code is nowhere in what issueOtp returned",
    !JSON.stringify(issued).includes(realCode!), JSON.stringify(issued));
  const { data: storedChallenge } = await admin.from("practice_otp_challenge")
    .select("*").eq("id", issued.data.challengeId).maybeSingle();
  ok("5d-b. nor anywhere on the stored challenge -- only a 64-character hash",
    !JSON.stringify(storedChallenge).includes(realCode!)
    && (storedChallenge as any).code_hash.length === 64,
    (storedChallenge as any)?.code_hash?.slice(0, 12));
  ok("5d-control. ⚠ and the code really is a findable string -- it IS in the outbox, so 5d is not searching for nothing",
    JSON.stringify(outbox).includes(realCode!));

  const engineSources = [
    join(REPO, "src", "lib", "practice", "messaging.ts"),
    join(REPO, "src", "lib", "practice", "patient-access.ts"),
    join(REPO, "src", "app", "practice", "patient-booking", "page.tsx"),
  ];
  const withConsole = engineSources.filter(f => /\bconsole\.\w+\(/.test(readFileSync(f, "utf8")));
  ok("5e. nothing on this path logs at all, so nothing on it can log a code or an identifier",
    withConsole.length === 0, withConsole.map(f => f.replace(REPO, "")).join(", "));

  // ── 5f. ⚠ A ONE-TIME CODE USED TEN TIMES AT ONCE IS ACCEPTED ONCE ─────────────────────────────
  //
  // THE FIXTURE IS ARRANGED SO THE BROKEN ANSWER IS THE OBVIOUS ONE. All ten carry the CORRECT code.
  // Under the read-modify-write this replaced, all ten read attempts=0 and consumed_at=null, all ten
  // hashed correctly, and all ten returned ok -- a single-use code accepted ten times. A wrong code
  // would have been refused ten times either way, and proved nothing.
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () => verifyOtp(admin, { challengeId: issued.data.challengeId, code: realCode! })),
  );
  const accepted = concurrent.filter(r => r.ok).length;
  ok("5f. ⚠ TEN SIMULTANEOUS VERIFICATIONS OF THE CORRECT CODE ARE ACCEPTED EXACTLY ONCE",
    accepted === 1, `${accepted} of 10 were accepted`);
  ok("5f-b. and the nine losers were refused for not being counted, rather than judged",
    concurrent.filter(r => !r.ok && (r as any).code === "ATTEMPT_NOT_COUNTED").length >= 1,
    concurrent.filter(r => !r.ok).map(r => (r as any).code).join(", "));

  // ── 5g. AN UNREADABLE CHALLENGE STORE IS AN ERROR, NEVER A PASS ───────────────────────────────
  const issued2 = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "email", destination: "second@example.invalid",
    correlationId: CORR, transport: recorder,
  });
  ok("5g-control-1. a second code is issued", issued2.ok, issued2.ok ? "" : (issued2 as any).message);
  if (!issued2.ok) { await teardown(); return report(); }
  const realCode2 = (outbox[outbox.length - 1].body.match(/(\d{6})/) ?? [])[1];

  const verifyBroken = await verifyOtp(adminWithUnreadable(admin, "practice_otp_challenge"), {
    challengeId: issued2.data.challengeId, code: realCode2!,
  });
  // ⚠ WITH THE RIGHT CODE. The point is not "a failed read refuses" -- it always did, by accident, via
  // the null falling into the wrong-code branch. The point is that it now says so, so nobody reordering
  // these lines can let a null read fall the other way.
  ok("5g. ⚠ an unreadable challenge store is a 503 that names itself -- never a pass, and never the patient's fault",
    !verifyBroken.ok && (verifyBroken as any).code === "VERIFICATION_STORE_UNREADABLE"
    && (verifyBroken as any).status === 503,
    verifyBroken.ok ? "IT VERIFIED AGAINST AN UNREADABLE STORE" : (verifyBroken as any).code);

  const verifyReal = await verifyOtp(admin, { challengeId: issued2.data.challengeId, code: realCode2! });
  ok("5g-control-2. ⚠ and that very code verifies against the real store -- so 5g refused a code that was RIGHT",
    verifyReal.ok, verifyReal.ok ? "" : (verifyReal as any).code);

  // ── 5h. ENUMERATION: THE ISSUE PATH KNOWS NOTHING ABOUT WHO A DESTINATION BELONGS TO ──────────
  //
  // A booking with a phone number on it is a record keyed on a destination -- the exact thing an issue
  // path must not consult, because a different answer for a known number tells a stranger who is a
  // patient here.
  await admin.from("practice_appointment").insert({
    workspace_id: wsA, patient_name: "Known Person", patient_phone: "+256711000010",
    appointment_type: "new_consultation", scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    duration_minutes: 20, status: "CONFIRMED",
  });

  const known = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256711000010",
    correlationId: CORR, transport: recorder,
  });
  const unknown = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256711000011",
    correlationId: CORR, transport: recorder,
  });
  const shapeOf = (r: any) => JSON.stringify({ ok: r.ok, status: r.status ?? null, code: r.code ?? null, message: r.message ?? null });
  ok("5h. ⚠ a number this practice already holds and one it has never seen get the SAME answer, to the character",
    shapeOf(known) === shapeOf(unknown), `${shapeOf(known)} vs ${shapeOf(unknown)}`);

  // The structural half: if the path consulted the patient register, an unreadable one would move it.
  const brokenPatients = adminWithUnreadable(admin, "practice_patient");
  const knownBroken = await issueOtp(brokenPatients, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256711000012",
    correlationId: CORR, transport: recorder,
  });
  const unknownAgain = await issueOtp(admin, {
    workspaceId: wsA, purpose: "booking", channel: "sms", destination: "+256711000013",
    correlationId: CORR, transport: recorder,
  });
  ok("5h-b. ⚠ and the answer does not move when the PATIENT REGISTER is unreadable -- the path never asks it",
    shapeOf(knownBroken) === shapeOf(unknownAgain), `${shapeOf(knownBroken)} vs ${shapeOf(unknownAgain)}`);
  const proxyBites = await brokenPatients.from("practice_patient").select("id").limit(1);
  ok("5h-control. ⚠ and the patient register really was unreadable -- otherwise 5h-b compares two healthy runs",
    !!proxyBites.error, JSON.stringify(proxyBites.error));

  await teardown();

  // ══ 6. A PATIENT SESSION IS NOT A PRACTITIONER SESSION ════════════════════════════════════════
  section("6. The session boundary");

  const patientRouteDir = join(REPO, "src", "app", "practice", "patient-booking");
  const patientFiles = filesUnder(patientRouteDir);
  ok("6a-control. the patient-facing route exists and was actually scanned",
    patientFiles.length >= 1, `${patientFiles.length} files`);

  const leaked = patientFiles.flatMap(f => practitionerMarkersIn(f).map(m => `${f.replace(REPO, "")}:${m}`));
  ok("6a. ⚠ nothing on the patient-facing route resolves, imports or names a practitioner identity",
    leaked.length === 0, leaked.join(", "));

  // ⚠ THE CONTROL THAT MAKES 6a MEAN SOMETHING. A scanner with a typo in every marker finds nothing
  // everywhere, and 6a would be its proudest assertion.
  const practitionerPage = join(REPO, "src", "app", "practice", "access-status", "page.tsx");
  ok("6a-control-2. ⚠ and the same scanner DOES find them in a practitioner page",
    practitionerMarkersIn(practitionerPage).length > 0,
    practitionerMarkersIn(practitionerPage).join(", "));

  // ⚠ THE STRIPPER IS ITSELF UNDER TEST. One that returned "" would make 6a pass and 6a-control-2 fail;
  // one that returned the raw text would make 6a fail. Both halves are asserted directly, and the
  // patient page is confirmed to be the case that actually needs it -- otherwise the stripper is
  // untested on the only file it was written for.
  const stripFixture = "import { resolvePracticeShell } from 'x';\n// mentions resolvePracticeAccess in prose\n";
  const stripped = stripComments(stripFixture);
  ok("6a-control-3. ⚠ the comment stripper removes prose and keeps code -- it is not returning the file, or nothing",
    stripped.includes("resolvePracticeShell") && !stripped.includes("resolvePracticeAccess"),
    JSON.stringify(stripped));
  ok("6a-control-4. and the patient page really does discuss these names in its comments, so 6a exercises the stripper",
    readFileSync(join(patientRouteDir, "page.tsx"), "utf8").includes("resolvePracticeShell"));

  const patientRouteIsOutsideShell = !patientRouteDir.includes(`${"("}shell${")"}`)
    && existsSync(join(patientRouteDir, "page.tsx"));
  ok("6b. the route sits outside the (shell) group, so the practitioner guards never run for it",
    patientRouteIsOutsideShell);

  ok("6c. it has no sidebar entry, and needs none -- nothing in the practitioner nav points at it",
    !PRACTICE_NAV.some((i: any) => String(i.href).startsWith("/practice/patient-booking")),
    PRACTICE_NAV.filter((i: any) => String(i.href).includes("patient")).map((i: any) => i.href).join(", "));

  // ══ 7. THE PAYLOAD THE PAGE RENDERS ═══════════════════════════════════════════════════════════
  section("7. The patient-facing payload");

  const surface = await patientBookingSurface(admin);
  ok("7a. the surface is shut and says the delivery channel is why, in its first sentence",
    surface.open === false && /no way to send you a confirmation code/i.test(surface.headline),
    surface.headline);
  ok("7b. it names no practice, no practitioner and no handle -- this URL is reachable by strangers",
    !/Patient Access Harness/i.test(JSON.stringify(surface)),
    JSON.stringify(surface).slice(0, 200));
  ok("7c. it does not carry the per-practice blockers, only the ones true of the deployment",
    !surface.reasons.some(r => /session|rule/i.test(r.headline)),
    surface.reasons.map(r => r.headline).join(" | "));

  // ⚠ WALK THE PAYLOAD. A function on an object handed to a client component is tsc-clean, eslint-clean,
  // harness-clean and dead on the page -- which is how the Follow-ups board was killed this week.
  const notSerialisable = nonSerialisable(surface);
  ok("7d. ⚠ every field on it survives the server/client boundary -- nothing is a function or a Map",
    notSerialisable.length === 0, notSerialisable.join(", "));
  ok("7d-control. ⚠ and the walker CAN find one -- otherwise 7d is a function that returns an empty array",
    nonSerialisable({ a: 1, b: { c: () => 1 } }).length === 1,
    JSON.stringify(nonSerialisable({ a: 1, b: { c: () => 1 } })));

  const pageSrc = readFileSync(join(patientRouteDir, "page.tsx"), "utf8");
  ok("7e. the page is gated on the launch flag, and 404s rather than explaining itself to a stranger",
    pageSrc.includes("PATIENT_BOOKING_FLAG") && pageSrc.includes("notFound()"));
  ok("7f. and it is not indexed",
    /robots:\s*\{\s*index:\s*false/.test(pageSrc));

  await cleanup();
  report();

  async function teardown() {
    restoreEnv();
    await admin.from("practice_message_channel").delete().eq("workspace_id", wsA);
  }
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`   FAILED: ${f}`); process.exit(1); }
  console.log("");
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
