/**
 * CP-OFFLINE-SURVEY-001 phase one — the read-only offline cache.
 *
 * WHAT IT PROVES, taken from the survey's own rules rather than from what the code happens to do:
 *   - s3.8.1  "Project at WRITE time, not at render time" -- an ALLOW-LIST, and a dropped field is
 *             physically absent from the record rather than merely unrendered.
 *   - s3.8.1  age, not date of birth. No contact details. No free-text reason. No metrics.
 *   - s3.8.7  the clinical service label is CACHED and is NOT in the list row.
 *   - s3.8.2  hard expiry at the end of the clinic day IN THE PRACTICE'S TIMEZONE, escalating labels
 *             from 60 minutes, and past expiry the record is WITHHELD AND DELETED, not shown.
 *   - s3.4    a clock earlier than the capture instant means nothing is shown.
 *   - s3.5    ZERO ENABLED MUTATING CONTROLS offline -- asserted, not reviewed for.
 *   - s3.3    the service worker caches the app shell and NEVER an API response.
 *   - s3.7/8.6 the flag is fail-closed, and a practice's own "off" PURGES.
 *   - s3.6    what encryption does: a round trip, and the plaintext not lying in the store.
 *
 * ⚠ Several assertions are paired with a CONTROL that would pass trivially without it -- "the queue is
 * not cached" is worthless unless something proves the dashboard had a queue feeder to drop.
 *
 *   npx --yes tsx scripts/practice-offline-cache-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { dashboardReadModel } from "../src/lib/practice/dashboard";
import { offlineDayPayload, todaysCohort } from "../src/lib/practice/offline-day";
import { offlineCacheGate, OFFLINE_FLAG } from "../src/lib/practice/offline-gate";
import { updateConfiguration } from "../src/lib/practice/configuration";
import {
  OFFLINE_DAY_KEYS, OFFLINE_FORBIDDEN_FIELDS, OFFLINE_PATIENT_KEYS, OFFLINE_SCHEMA_VERSION,
  enabledMutatingControls, offlineControls, offlineExpiry, offlineFreshness, offlineListRow,
  offlineRecordDetail, readOfflineDay, type OfflineDay,
} from "../src/lib/practice/offline-projection";
import { fieldsNotAllowed } from "../src/lib/practice/offline-store";
import { generateCacheKey, openRecord, sealRecord } from "../src/lib/practice/offline-crypto";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-00000000fc01";
const ALL = ["practice.home.view", "practice.calendar.view", "appointment.manage", "queue.manage",
  "encounter.list", "task.view", "followup.view", "inbox.record", "practice.settings.manage"];

const ctxFor = (workspaceId: string, caps: string[] = ALL): WorkspaceContext => ({
  // ⚠ THE SAME SYMBOL THE WORKSPACE WAS PROVISIONED WITH, never a fresh literal -- a fixture
  // whose ctx claims one zone while its row holds another tests a state that cannot exist.
  workspaceTimezone: "Africa/Kampala",
  userId: USER, workspaceId, workspaceName: "H", workspaceType: "individual_practice",
  workspaceStatus: "active", roleCodes: ["owner"], capabilities: caps, entitled: true,
  entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
  // A fixture stands in for a resolved context; nothing here exercises invalidation.
  contextVersion: "harness",
});

// The fixture's disclosive values. Each is a field s3.8.1 DROPS, and each is searched for by value in the
// serialised record -- a key-name check alone would miss a field renamed on its way into the cache.
const PHONE = "+256700123456";
const REASON = "cough and night sweats for three weeks";
const BIRTH_DATE = "1990-03-15";
const NATIONAL_ID = "CM90031512345X";
const PRACTICE_ID = "PX-0042";
const PATIENT_NAME = "Harness Offline Patient";

/**
 * ⚠⚠ THE PLATFORM FLAG ROW THIS HARNESS FOUND, SO IT CAN PUT IT BACK.
 *
 * `plat_feature_flags` IS PLATFORM-WIDE. It is not scoped to this fixture, this workspace or this
 * practice -- one row governs every practice on the deployment. This harness seeds it, mutates it to
 * prove the gate closes, and used to DELETE it unconditionally in cleanup.
 *
 * ⚠ SO EVERY RUN SILENTLY SWITCHED OFF OFFLINE CACHING FOR THE WHOLE PLATFORM. Migration 285 seeded that
 * row on 2026-08-11 and a dozen harness runs later the owner opened the offline page and found nothing
 * cached, because the flag it depends on had been deleted by a test. That is a harness changing
 * production configuration, which is a worse failure than any assertion it contains.
 *
 * `undefined` means not yet looked at; `null` means genuinely absent before this run.
 */
let flagBeforeRun: Record<string, unknown> | null | undefined = undefined;

async function restoreFlag() {
  if (flagBeforeRun === undefined) return;          // never captured, nothing to restore
  await admin.from("plat_feature_flags").delete().eq("key", OFFLINE_FLAG);
  // ⚠ ABSENT IS A STATE WORTH RESTORING TOO. If there was no row before, leaving the harness one behind
  // would switch the feature ON for a platform that had never decided to.
  if (flagBeforeRun !== null) await admin.from("plat_feature_flags").insert(flagBeforeRun);
}

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_queue_entry").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_activity").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", USER);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  // ⚠ practice_audit_event is NOT deleted here: migration 247 made it append-only and every harness's
  // delete has been a silent no-op since. Any assertion about audit rows must scope itself to this run.
  await purgeWorkspacesOwnedBy(admin, [USER], { quiet: true });
  // Captured ONCE, on the first cleanup, before anything here has touched it.
  if (flagBeforeRun === undefined) {
    const { data } = await admin.from("plat_feature_flags").select("*").eq("key", OFFLINE_FLAG).maybeSingle();
    flagBeforeRun = (data as Record<string, unknown> | null) ?? null;
  }
  await admin.from("plat_feature_flags").delete().eq("key", OFFLINE_FLAG);
}

/** Every key at every depth, so a forbidden field cannot hide inside a nested object. */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) allKeys(v, into); return into; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { into.add(k); allKeys(v, into); }
  }
  return into;
}

async function main() {
  console.log("\n=== OFFLINE READ-ONLY CACHE (CP-OFFLINE-SURVEY-001 phase one) ===\n");
  await cleanup();

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-offline-${Date.now()}`, request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: "harness-offline",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "Harness Offline", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: USER, correlation_id: "harness-offline", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed:", run.errorCode); process.exitCode = 1; return; }
  const workspaceId = run.workspaceId;
  const ctx = ctxFor(workspaceId);

  // ── FIXTURE: one patient carrying every field the cache must drop ────────────────────────────────
  const { data: patient } = await admin.from("practice_patient").insert({
    workspace_id: workspaceId, display_name: PATIENT_NAME, sex: "female", birth_date: BIRTH_DATE,
  }).select("id").single();
  await admin.from("practice_patient_identifier").insert([
    { workspace_id: workspaceId, patient_id: patient!.id, identifier_type: "national_id", value: NATIONAL_ID },
    { workspace_id: workspaceId, patient_id: patient!.id, identifier_type: "practice_id", value: PRACTICE_ID },
    { workspace_id: workspaceId, patient_id: patient!.id, identifier_type: "phone", value: PHONE },
  ]);

  const at = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
  // 09:30 in Kampala on the practice's today. Chosen rather than "now" so the printed time label is a
  // known string and not whatever o'clock the harness happens to run at.
  const scheduledAt = new Date(`${today}T09:30:00.000+03:00`).toISOString();

  const { data: appt, error: apptErr } = await admin.from("practice_appointment").insert({
    workspace_id: workspaceId, patient_id: patient!.id, patient_name: PATIENT_NAME,
    patient_phone: PHONE, appointment_type: "scheduled_followup", scheduled_at: scheduledAt,
    duration_minutes: 25, status: "CONFIRMED", reason: REASON,
  }).select("id").single();
  ok("0a-control. the fixture appointment was created", !!appt && !apptErr, apptErr?.message ?? "");
  if (!appt) { await cleanup(); report(); return; }

  const { data: enc } = await admin.from("practice_encounter").insert({
    workspace_id: workspaceId, patient_id: patient!.id, appointment_id: appt.id,
    entry_pathway: "scheduled_followup", status: "ACTIVE", reason_for_visit: REASON,
  }).select("id").single();

  // ── 1. THE PROJECTION: s3.8.1's allow-list ───────────────────────────────────────────────────────
  const built = await offlineDayPayload(admin, ctx, { at });
  ok("1a-control. the day was assembled at all", built.ok, built.ok ? "" : built.reason);
  if (!built.ok) { await cleanup(); report(); return; }
  const day = built.day;

  ok("1b-control. the fixture patient really is on the cached day",
    day.patients.length === 1 && day.patients[0].name === PATIENT_NAME,
    JSON.stringify(day.patients.map(p => p.name)));

  const p0 = day.patients[0];
  ok("1c. a cached patient carries EXACTLY the allow-listed fields, no more and no fewer",
    [...Object.keys(p0)].sort().join(",") === [...OFFLINE_PATIENT_KEYS].sort().join(","),
    Object.keys(p0).join(","));
  ok("1d. and the record itself does too",
    [...Object.keys(day)].sort().join(",") === [...OFFLINE_DAY_KEYS].sort().join(","),
    Object.keys(day).join(","));

  // ⚠ `feeders` is excluded from the walk because it is a MAP WHOSE KEYS ARE CARD NAMES -- "alerts",
  // "brief", "drafts" -- and a card name is not a field. Including it would make this assertion fail for
  // a reason that has nothing to do with what is stored about a patient, and the usual fix for that
  // (deleting those names from the forbidden list) would quietly stop it checking three real fields.
  const keys = allKeys({ ...day, feeders: {} });
  const leakedKeys = OFFLINE_FORBIDDEN_FIELDS.filter(f => keys.has(f));
  ok("1e. no forbidden field NAME appears anywhere in the record, at any depth",
    leakedKeys.length === 0, leakedKeys.join(","));

  // ⚠ BY VALUE, NOT BY KEY NAME. A dropped field that arrived under a different name would pass 1e.
  const serialised = JSON.stringify(day);
  ok("1f. the patient's PHONE NUMBER is not in the record", !serialised.includes(PHONE));
  ok("1g. the free-text reason for visit is not in the record", !serialised.includes(REASON));
  ok("1h. the DATE OF BIRTH is not in the record", !serialised.includes(BIRTH_DATE));
  ok("1i. the national identifier is not in the record", !serialised.includes(NATIONAL_ID));

  // Age instead of DOB -- and it must be the right number, or "we dropped the DOB" is bought by
  // dropping the clinical utility with it.
  const expectedAge = (() => {
    const b = new Date(`${BIRTH_DATE}T00:00:00Z`);
    let y = at.getUTCFullYear() - b.getUTCFullYear();
    if (at.getUTCMonth() < b.getUTCMonth()
      || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate())) y -= 1;
    return y;
  })();
  ok("1j. AGE is carried instead, in whole years, correctly", p0.ageYears === expectedAge,
    `${p0.ageYears} vs ${expectedAge}`);

  ok("1k. ONE identifier is carried, and it is the practice one -- not the phone",
    p0.identifierType === "practice_id" && p0.identifierValue === PRACTICE_ID,
    `${p0.identifierType}=${p0.identifierValue}`);
  ok("1l. the clinic-running fields survive: time, duration, status, encounter id",
    p0.timeLabel === "09:30" && p0.durationMinutes === 25 && p0.status === "CONFIRMED"
    && p0.encounterId === enc?.id,
    JSON.stringify({ t: p0.timeLabel, d: p0.durationMinutes, s: p0.status, e: p0.encounterId }));

  // ── 2. THE LIVE QUEUE IS SUPPRESSED, and the control proves there was one to suppress ────────────
  const model = await dashboardReadModel(admin, ctx, { at });
  ok("2a-control. the dashboard read model DOES carry a queue feeder",
    Object.keys(model.feeders).includes("queue"), Object.keys(model.feeders).join(","));
  ok("2b. the cached day does not, and carries no queue at all",
    !Object.keys(day.feeders).includes("queue") && !("queue" in (day as unknown as Record<string, unknown>)),
    Object.keys(day.feeders).join(","));
  ok("2c. and no management metric, brief, alert or draft survives the projection",
    !("metrics" in day) && !("brief" in day) && !("alerts" in day) && !("drafts" in day));
  ok("2d. the per-card degradation captured at cache time is kept",
    Object.keys(day.feeders).length > 0
    && Object.keys(day.feeders).every(k => Object.keys(model.feeders).includes(k)),
    Object.keys(day.feeders).join(","));

  // ── 3. s3.8.7: THE SERVICE LABEL IS CACHED, AND IS NOT IN THE LIST ROW ───────────────────────────
  //
  // Both halves. Asserting only the second would pass on a build that never cached it, which would fail
  // the clinical half of the requirement instead.
  ok("3a-control. the visit kind IS cached -- a practitioner cannot triage without it",
    p0.visitKind === "scheduled_followup", p0.visitKind);
  ok("3b. it is NOT in the list row",
    !Object.keys(offlineListRow(p0)).includes("visitKind"), Object.keys(offlineListRow(p0)).join(","));
  ok("3c. it IS on the record opened deliberately",
    Object.keys(offlineRecordDetail(p0)).includes("visitKind"));
  const readerSrc = readFileSync("src/app/practice/offline/OfflineReader.tsx", "utf8");
  ok("3d. and the screen reaches it only through the record, never through the row",
    !/\brow\.visitKind\b/.test(readerSrc) && /\bdetail\.visitKind\b/.test(readerSrc));

  // ── 4. s3.8.2: EXPIRY AT THE END OF THE CLINIC DAY, IN THE PRACTICE'S TIMEZONE ───────────────────
  //
  // Kampala is UTC+3 all year, so the end of the practice's day is 21:00Z on the same date. Written out
  // literally rather than recomputed with the same function the code uses -- an assertion that calls the
  // implementation to work out what it expects proves only that the implementation is consistent.
  ok("4a. the day expires at the next midnight ON THE PRACTICE'S CLOCK, not the server's",
    day.expiresAt === `${today}T21:00:00.000Z`, `${day.expiresAt} vs ${today}T21:00:00.000Z`);
  ok("4b-control. and that is NOT the same instant as UTC midnight",
    day.expiresAt !== `${today}T00:00:00.000Z` && day.expiresAt !== `${today}T23:59:59.999Z`);
  ok("4c. offlineExpiry agrees for a zone on the other side of UTC",
    offlineExpiry("2026-06-15", "America/New_York") === "2026-06-16T04:00:00.000Z",
    offlineExpiry("2026-06-15", "America/New_York"));

  const asOf = "2026-06-15T05:00:00.000Z";
  const band = (mins: number) => offlineFreshness(asOf, "Africa/Kampala", new Date(Date.parse(asOf) + mins * 60000));
  ok("4d. under an hour the day is labelled fresh", band(59).band === "fresh", band(59).band);
  ok("4e. AT sixty minutes the label escalates", band(60).band === "ageing", band(60).band);
  ok("4f. and again at three hours", band(180).band === "stale", band(180).band);
  ok("4g. the three bands do not share a sentence or a colour",
    new Set([band(0).sentence, band(60).sentence, band(180).sentence]).size === 3
    && new Set([band(0).tone, band(60).tone, band(180).tone]).size === 3);
  ok("4h. the stamp is the PRACTICE's wall clock, absolute -- 05:00Z is 08:00 in Kampala",
    band(0).atLabel === "08:00", band(0).atLabel);

  // ── 5. s3.4.3: PAST EXPIRY THE RECORD IS WITHHELD AND DELETED, NOT SHOWN ─────────────────────────
  const stored: OfflineDay = { ...day, asOf, expiresAt: "2026-06-15T21:00:00.000Z" };
  const justInside = readOfflineDay(stored, new Date("2026-06-15T20:59:00.000Z"));
  ok("5a-control. a moment before expiry the day IS shown", justInside.state === "ok", justInside.state);
  const justOutside = readOfflineDay(stored, new Date("2026-06-15T21:00:00.000Z"));
  ok("5b. at the expiry instant it is withheld", justOutside.state === "expired", justOutside.state);
  ok("5c. ⚠ and NOTHING of the day comes back with the refusal -- an empty screen with a reason",
    !("day" in justOutside) && "reason" in justOutside && justOutside.reason.length > 0);
  ok("5d. the record is marked for deletion, not merely hidden",
    justOutside.state === "expired" && justOutside.purge === true);

  const rolledBack = readOfflineDay(stored, new Date("2026-06-15T04:00:00.000Z"));
  ok("5e. a device clock EARLIER than the capture instant shows nothing",
    rolledBack.state === "clock_rollback" && !("day" in rolledBack));
  ok("5f. but does not delete -- a wrong clock is not a decision to discard the day",
    rolledBack.state === "clock_rollback" && rolledBack.purge === false);
  const wrongSchema = readOfflineDay({ ...stored, schemaVersion: OFFLINE_SCHEMA_VERSION + 1 },
    new Date("2026-06-15T09:00:00.000Z"));
  ok("5g. a record from an older shape is discarded rather than guessed at",
    wrongSchema.state === "wrong_schema" && wrongSchema.purge === true);
  ok("5h. nothing cached is a stated reason, not an empty day",
    readOfflineDay(null, new Date()).state === "none");

  // ── 6. s3.5: ZERO ENABLED MUTATING CONTROLS ─────────────────────────────────────────────────────
  const controls = offlineControls(p0);
  ok("6a-control. the offline screen really does offer controls that would mutate",
    controls.filter(c => c.mutating).length > 0, `${controls.length} controls`);
  ok("6b. ⚠ NOT ONE OF THEM IS ENABLED",
    enabledMutatingControls(controls).length === 0,
    enabledMutatingControls(controls).map(c => c.key).join(","));
  ok("6c. and each says why, in a sentence",
    controls.filter(c => c.mutating).every(c => (c.reason ?? "").length > 20));

  // The JSX, not only the data. s5's warning is about a FORM reused from an online page that merely fails
  // on submit -- which no assertion over a control array would ever see.
  const pageSrc = readFileSync("src/app/practice/offline/page.tsx", "utf8");
  const frameSrc = readFileSync("src/app/practice/offline/OfflineFrame.tsx", "utf8");
  const offlineTree = readerSrc + pageSrc + frameSrc;

  // ── ⚠ THE FRAME MUST NOT REACH INTO THE SHELL, AND MUST NOT PRETEND TO NAVIGATE ─────────────────
  // The offline page renders with no connection, so anything it imports must too. The shell layout sits
  // behind six database reads and REDIRECTS on failure -- borrowing its sidebar would put that graph
  // behind the one page that has to work when nothing else does.
  // ⚠ PLAIN STRING CHECKS, NO REGEX LITERALS, AND THE REASON IS WORTH THE LINES. The first version
  // of these three was written through a shell-quoted script and every backslash was eaten: the escape
  // for whitespace became a literal letter, so the "from" needle could never match anything, and the
  // parenthesis escapes became a capture group matching a bare word. All three PASSED against code
  // deliberately broken to fail them. Seventh mangled pattern this session; the cure is not more care,
  // it is not writing regex literals through a shell at all.
  const importsTheShell = offlineTree.includes("(shell)/") || offlineTree.includes("(shell)\"");
  ok("6h. ⚠ nothing in the offline tree imports from the (shell) group",
    !importsTheShell, "the shell sits behind six database reads and redirects on failure");
  // ⚠ THE ASSERTION AND THE RULE BOTH MOVED ON 2026-08-11, and the old wording would have gone on
  // passing while describing something the code no longer does. The frame LISTS the practitioner's
  // sections -- leaving the column empty made the page read as broken -- but none of them is a link,
  // because offline every /practice/* route redirects straight back here.
  ok("6i. ⚠ no section in the frame is a LINK -- offline they all redirect back to this page",
    !frameSrc.includes("<Link") && !frameSrc.includes("href="),
    "links that bounce to this page look normal and behave bizarrely");
  ok("6i2. ⚠ but the sections ARE listed, disabled with a reason, as every other control here is",
    frameSrc.includes("aria-disabled") && frameSrc.includes("cursor-not-allowed")
    && frameSrc.includes("Needs a connection"),
    "an empty sidebar reads as a broken product rather than a reduced one");
  ok("6i3. ⚠ and the list is the one CACHED FOR THIS ACCOUNT, not all nine",
    frameSrc.includes("cachedNav") && !frameSrc.includes("PRIMARY_ORDER"),
    "eight of the nine sections are capability-gated");
  ok("6j. ⚠ and it names no practice and no person",
    !frameSrc.includes("workspaceName") && !frameSrc.includes("fullName")
    && !frameSrc.includes("ctx.") && !frameSrc.includes("profile"));
  ok("6k-control. it DOES render the product mark, so 6i is not passing over an empty file",
    frameSrc.includes("competen") && frameSrc.includes("cp-shell"));
  // ⚠ PARITY IS THE FRAME'S ONLY PURPOSE, so a layout that differs from the shell defeats it. The shell
  // renders `main.practice-scale.flex-1.min-w-0.p-5` and its pages use a bare `max-w-*` with no
  // `mx-auto`. Centring here left a wide empty band between the sidebar and the content and made the
  // page look like a different application again -- which is what the owner saw on 2026-08-11.
  // ⚠ STRIPPED. This assertion went red against CORRECT code because the only `mx-auto` left in the file
  // is the COMMENT saying there must not be one. That is the EIGHTH time in this session that a needle
  // has matched its own documentation, and the eighth is where it stops being bad luck: any source
  // assertion in this repository reads stripped text, without exception.
  const frameCode = frameSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join("\n");
  ok("6l-control. stripping comments left the frame's markup behind",
    frameCode.includes("max-w-3xl") && frameCode.includes("aside"));
  ok("6l. ⚠ the frame left-aligns its content, as every other page does",
    !frameCode.includes("mx-auto"), "centred content re-opens the gap the frame exists to close");
  ok("6m-control. and it still uses the shell's own main classes",
    frameCode.includes("practice-scale") && frameCode.includes("flex-1") && frameCode.includes("p-5"));
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ 6d AND 6g GUARDED s5's LINE, AND THE LINE MOVED ON 2026-08-11. THEY ARE REPOINTED, NOT RELAXED.
  //
  // They asserted that the offline screen contains NO input and NO enabled button, because phase one
  // could deliver nothing and s5 is explicit that the harm is done by the ACCEPTANCE: "an offline screen
  // that renders a form because the component was reused from the online page, and merely fails on
  // submit. The user typed. The input was accepted. The duty felt discharged. Nothing arrived."
  //
  // Capture now exists for ONE entity, because all seven preconditions hold for it. So the property is
  // no longer "no input anywhere" -- it is:
  //
  //     THE ONLY INPUTS ON THIS SCREEN ARE INSIDE THE SANCTIONED CAPTURE COMPONENT, WHICH ENQUEUES WHAT
  //     IT ACCEPTS. Everywhere else the old rule stands, unchanged and unweakened.
  //
  // ⚠ That is what keeps the assertion dangerous. A form added to the clinical panel tomorrow -- the
  // most likely way this goes wrong, because that panel already renders allergies and somebody will want
  // to add one -- still fails, exactly as it did yesterday.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ A LIST NOW, NOT A SINGLE SLICE -- entity two ("Encounters then follow-up", 2026-08-16) added a
  // second sanctioned component. The exemption stays exactly as narrow as it was: each entry must be
  // FOUND, BOUNDED, and PROVEN A PRODUCER by naming the capture function it enqueues through. A third
  // component added without extending this list fails 6d, which is the point.
  const SANCTIONED = [
    { name: "CaptureReading", producer: "captureMeasurement(" },
    { name: "CaptureVisit", producer: "captureEncounter(" },
    { name: "CaptureFollowUp", producer: "captureFollowUp(" },
    { name: "CaptureCollection", producer: "captureCollection(" },
  ];
  const slices = SANCTIONED.map(s => {
    const start = readerSrc.indexOf(`function ${s.name}(`);
    const ends = ["\nfunction ", "\nconst "].map(m => readerSrc.indexOf(m, start + 1)).filter(i => i > start);
    const end = Math.min(...ends);
    return { ...s, start, end, body: readerSrc.slice(start, end) };
  });
  for (const s of slices) {
    ok(`6d-control. the ${s.name} component was located and is a bounded slice`,
      s.start > 0 && s.end > s.start && !s.body.includes("\nfunction "),
      `${s.body.length} chars`);
    ok(`6d-control-b. ⚠ and ${s.name} is genuinely a producer -- it enqueues what it accepts`,
      s.body.includes(s.producer),
      "the exemption below would be carved for a component that accepts input and delivers nothing");
  }

  // Everything on the screen EXCEPT those components -- cut from the end so indexes stay valid.
  let outsideCapture = readerSrc;
  for (const s of [...slices].sort((a, b) => b.start - a.start))
    outsideCapture = outsideCapture.slice(0, s.start) + outsideCapture.slice(s.end);
  outsideCapture += pageSrc + frameSrc;
  ok("6d. ⚠ no form or input anywhere on the offline screen OUTSIDE the sanctioned capture components",
    !/<form\b/i.test(outsideCapture) && !/<input\b/i.test(outsideCapture)
    && !/<textarea\b/i.test(outsideCapture) && !/<select\b/i.test(outsideCapture),
    "an input that does not enqueue is input accepted and lost");
  ok("6d2. ⚠ and there is still NO <form> even inside them -- nothing here submits anywhere",
    slices.every(s => !/<form\b/i.test(s.body)),
    "a form element implies a submit target, and there is none");

  // ── D6 (owner decision 2026-08-16): the bedside billing warning is a WARNING, never a gate ──────
  const collectionSlice = slices.find(s => s.name === "CaptureCollection");
  ok("6j. the money capture reads the CACHED billing verdict and warns in the practitioner's words",
    !!collectionSlice && collectionSlice.body.includes("cachedBillingCapture")
    && /refuse to file it at sync/.test(collectionSlice.body)
    && /You can still record money taken/.test(collectionSlice.body),
    "the warning or its source is missing from CaptureCollection");
  // The submit button's disabled expression may reference busy/description/time/amount and NOTHING
  // about billing -- a warning that quietly became a gate would be a permission enforced by a cache.
  const collectionSubmit = collectionSlice?.body.match(/disabled=\{busy \|\|[^}]+\}/)?.[0] ?? "";
  ok("6j2. ⚠ the warning never gates: the submit's disabled expression carries no billing reference",
    collectionSubmit.length > 0 && !/billing/i.test(collectionSubmit),
    collectionSubmit || "the submit button's disabled expression was not found");
  // ONE spelling of the capability pair, shared by the engine's refusal and the shell's cached
  // verdict -- two spellings is how the warning and the refusal drift apart.
  const filingSrc = readFileSync("src/lib/practice/offline-filing.ts", "utf8");
  const pairSpellers = ["src/app/practice/(shell)/home/page.tsx", "src/app/practice/(shell)/today/page.tsx"]
    .map(f => readFileSync(f, "utf8"));
  ok("6j3. ⚠ engine refusal and cached verdict stand on the ONE capability pair (BILLING_CAPTURE_CAPABILITIES)",
    filingSrc.includes("BILLING_CAPTURE_CAPABILITIES.every")
    && pairSpellers.every(s => s.includes("BILLING_CAPTURE_CAPABILITIES.every"))
    && !filingSrc.includes("\"payment.record\") || !ctx.capabilities.includes(\"invoice.draft\""),
    "a second spelling of the pair exists, or a reader stopped using the shared constant");
  ok("6e. it sends nothing: no fetch, no mutating method, no server action",
    !/\bfetch\s*\(/.test(offlineTree) && !/"(POST|PATCH|PUT|DELETE)"/.test(offlineTree)
    && !/use server/.test(offlineTree));
  const buttons = offlineTree.match(/<button[\s\S]*?>/g) ?? [];
  ok("6f-control. there are buttons on the screen to judge", buttons.length > 0, `${buttons.length}`);
  // ⚠ SAME REPOINTING AS 6d, AND THE SAME LIMIT ON IT. Outside the capture component every button must
  // still be disabled or a disclosure toggle -- that is what stops "Start a consultation" quietly
  // becoming clickable. Inside it, the buttons are the capture controls, which enqueue.
  const outsideButtons = outsideCapture.match(/<button[\s\S]*?>/g) ?? [];
  ok("6f-control-b. there are buttons OUTSIDE the capture component too",
    outsideButtons.length > 0, `${outsideButtons.length}`);
  ok("6g. ⚠ outside capture, every button is still disabled or the non-mutating disclosure toggle",
    outsideButtons.every(b => /\bdisabled\b/.test(b) || /aria-expanded/.test(b)),
    outsideButtons.filter(b => !/\bdisabled\b/.test(b) && !/aria-expanded/.test(b)).join(" | "));
  // ⚠ THE SAME `controls` 6b JUDGED, RE-JUDGED HERE ON PURPOSE. 6b proves the list is clean; this proves
  // it STAYED clean after capture shipped -- i.e. that capture was not smuggled in as an enabled entry,
  // which would have retired 6b silently while leaving it green.
  ok("6g2. ⚠ capture was NOT added to the shared control list -- it is still entirely disabled",
    enabledMutatingControls(controls).length === 0,
    enabledMutatingControls(controls).map(c => c.key).join(","));

  // ⚠ THE PAGE THAT DEPENDS ON THE WORKER MUST BE ABLE TO UPDATE IT. Registration lived only in
  // OfflineCacheWriter, inside the (shell), behind auth and the feature flag -- so a device holding an
  // old worker had no route to a newer one, because reaching it meant visiting a page that is not this
  // one. Found on 2026-08-11 when a shipped change simply never arrived.
  const gateSrc = readFileSync("src/app/practice/offline/OfflineGate.tsx", "utf8");
  // ⚠ NO REGEX LITERALS ANYWHERE IN THIS BLOCK. The first version of it was mangled passing through a
  // shell-quoted script -- every backslash eaten -- and the file stopped parsing, so the whole harness
  // printed its own transpiled source instead of running. Ninth time this session. String operations
  // cannot be damaged that way.
  const stripComments = (src: string): string => {
    const out: string[] = [];
    let inBlock = false;
    // ⚠ String.fromCharCode(10) rather than a newline escape: an escape passing through a shell-quoted
    // script has been eaten ten times in this session, once turning into a real line break and breaking
    // the parse. A character code cannot be mangled.
    for (const raw of src.split(String.fromCharCode(10))) {
      const line = raw.trim();
      if (inBlock) { if (line.includes("*/")) inBlock = false; continue; }
      if (line.startsWith("/*")) { if (!line.includes("*/")) inBlock = true; continue; }
      if (line.startsWith("//") || line.startsWith("*") || line.startsWith("{/*")) continue;
      out.push(raw);
    }
    return out.join(String.fromCharCode(10));
  };
  const gateCode = stripComments(gateSrc);
  ok("6n-control. stripping comments left the gate code behind", gateCode.includes("OfflineGate"));
  ok("6n. ⚠ the offline page registers the worker itself, so it can receive a new one",
    gateCode.includes("serviceWorker") && gateCode.includes("register("),
    "only an authenticated shell page could ever update the worker this page depends on");
  ok("6o. ⚠ and asks for an update explicitly, since re-registering can be a no-op",
    gateCode.includes(".update()"));

  // ── 7. s3.3: THE SERVICE WORKER CACHES THE SHELL AND NEVER AN API RESPONSE ───────────────────────
  const swSrc = readFileSync("public/sw.js", "utf8");
  const listeners: Record<string, (e: unknown) => void> = {};
  const cachePut: string[] = [];
  const fakeCache = { put: (req: { url?: string } | string) => { cachePut.push(typeof req === "string" ? req : (req.url ?? "?")); return Promise.resolve(); }, add: () => Promise.resolve(), match: () => Promise.resolve(undefined) };
  const fakeCaches = { open: () => Promise.resolve(fakeCache), match: () => Promise.resolve(undefined), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) };
  const fakeSelf: Record<string, unknown> = {
    addEventListener: (name: string, fn: (e: unknown) => void) => { listeners[name] = fn; },
    location: { origin: "https://app.example" },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  new Function("self", "caches", "fetch", "Response", "URL", swSrc)(
    fakeSelf, fakeCaches, () => Promise.reject(new Error("offline")), Response, URL,
  );

  // ── ⚠ THE SHELL IS USELESS WITHOUT WHAT IT REFERENCES ───────────────────────────────────────────
  // Measured in a real browser on 2026-08-11: install cached ONE entry, the page needed 21 assets, and
  // 21 were missing. Offline that is the shell HTML with no CSS and no JavaScript -- unstyled text and a
  // client component that never boots, so the screen sits on "Reading what is stored on this device..."
  // for ever. The page had never actually worked offline, which is its only purpose.
  // ⚠ COMMENTS STRIPPED, AND THIS IS THE SIXTH TIME IN ONE SESSION IT HAS BEEN NEEDED. sw.js now
  // explains at length what install USED to do -- `cache.add(SHELL)` -- and why `addAll` is wrong. Both
  // phrases are the needles below. A file that documents the fix reads, to a raw-text search, exactly
  // like a file that still has the bug.
  const swCode = swSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/).filter(l => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  ok("7-pre-0-control. stripping comments left the worker's code behind",
    swCode.includes("addEventListener") && swCode.includes("const CACHE"));

  const extract = fakeSelf.__assetsReferencedBy as (html: string, origin: string) => string[];
  ok("7-pre-a. the worker exposes its asset extractor for testing",
    typeof extract === "function");
  const sampleHtml = `<link rel="stylesheet" href="/_next/static/chunks/a__x._.css"/>`
    + `<script src="/_next/static/chunks/b_y._.js"></script>`
    + `<script>self.__next_f.push([1,"c:\\"/_next/static/media/f.woff2\\""])</script>`
    + `<img src="https://elsewhere.example/_next/static/nope.js">`;
  const found = typeof extract === "function" ? extract(sampleHtml, "https://app.example") : [];
  ok("7-pre-b. ⚠ it finds the stylesheet, the script AND the font",
    found.some(u => u.endsWith("a__x._.css")) && found.some(u => u.endsWith("b_y._.js"))
    && found.some(u => u.endsWith("f.woff2")), found.join(", "));
  ok("7-pre-c. ⚠ a font URL embedded with ESCAPED quotes is not left with a trailing backslash",
    found.every(u => !u.includes("%5C") && !u.endsWith("/")), found.join(", "));
  ok("7-pre-d. ⚠ and a CROSS-ORIGIN asset is refused",
    !found.some(u => u.includes("elsewhere.example")), found.join(", "));
  ok("7-pre-e. ⚠ install precaches the referenced assets, not just the document",
    // ⚠ Built by concatenation, not written as a regex literal. Three times this session an escape has
    // been eaten on its way through a shell-quoted script, and a broken literal here makes tsx print the
    // transpiled file instead of running -- which reads as catastrophe rather than as a typo.
    swCode.includes("assetsReferencedBy" + "(html") && !swCode.includes("cache" + ".add(" + "SHELL)"),
    "install caches one HTML file and nothing it needs");
  ok("7-pre-f. ⚠ each asset may fail alone -- addAll would abort the whole precache on one 404",
    !swCode.includes("addAll"));
  ok("7-pre-g. ⚠ the cache name was bumped, or every device keeps the broken v1 set for ever",
    swCode.includes(`const CACHE = "competen-practice-shell-v2"`));

  // ⚠ AND THE SHELL PATH MUST RE-SCAN, NOT ONLY RE-CACHE. install runs once and does not re-run for a
  // worker whose script has not changed, so after a deploy the network-first path would store a FRESH
  // document pointing at assets the cache does not hold -- the unstyled skeleton again. A full page load
  // happens to request the new assets and the `static` branch catches them; a prefetch or an RSC fetch
  // does not, and leaves the two out of step silently. Verified in a browser by poisoning the cached
  // shell and watching one fetch bring 50 assets back in step.
  const shellBranch = swCode.slice(swCode.indexOf("isShellItself"));
  ok("7-pre-h. ⚠ refreshing the shell also refreshes the assets it references",
    shellBranch.includes("assetsReferencedBy"),
    "a deploy would leave a fresh document pointing at assets that are not cached");
  ok("7-pre-i. ⚠ and that work never blocks the response the practitioner is waiting for",
    shellBranch.includes("return res;"));

  const policy = fakeSelf.__cachePolicy as (r: { url: string; mode?: string }, origin: string) => string;
  ok("7a-control. the worker registered a fetch handler and exposed its policy",
    typeof policy === "function" && typeof listeners.fetch === "function");
  ok("7b. ⚠ an API response is NEVER cached",
    policy({ url: "https://app.example/api/v1/practice/dashboard" }, "https://app.example") === "never");
  ok("7c. nor is the offline endpoint that carries the patients",
    policy({ url: "https://app.example/api/v1/practice/offline/day" }, "https://app.example") === "never");
  ok("7d. build assets are, and the offline shell is",
    policy({ url: "https://app.example/_next/static/chunk.js" }, "https://app.example") === "static"
    && policy({ url: "https://app.example/practice/offline" }, "https://app.example") === "shell");
  ok("7e. a cross-origin request is never touched",
    policy({ url: "https://elsewhere.example/practice/offline" }, "https://app.example") === "never");
  ok("7f. and an ordinary practice page is not cached either -- only navigations fall back to the shell",
    policy({ url: "https://app.example/practice/today" }, "https://app.example") === "never"
    && policy({ url: "https://app.example/practice/today", mode: "navigate" }, "https://app.example") === "shell");

  // Behavioural, not only declarative: drive the real handler with a real API request.
  let responded = false;
  listeners.fetch({
    request: { url: "https://app.example/api/v1/practice/offline/day", mode: "cors" },
    // The catch is not cosmetic: the static branch calls the stubbed fetch, which rejects to simulate a
    // dead network, and an unhandled rejection would take the whole harness down mid-run.
    respondWith: (p: unknown) => { responded = true; void Promise.resolve(p).catch(() => undefined); },
    waitUntil: () => undefined,
  });
  ok("7g. the handler does not even intercept an API request", !responded && cachePut.length === 0,
    `responded=${responded} put=${cachePut.join(",")}`);
  listeners.fetch({
    request: { url: "https://app.example/_next/static/chunk.js", mode: "no-cors" },
    // The catch is not cosmetic: the static branch calls the stubbed fetch, which rejects to simulate a
    // dead network, and an unhandled rejection would take the whole harness down mid-run.
    respondWith: (p: unknown) => { responded = true; void Promise.resolve(p).catch(() => undefined); },
    waitUntil: () => undefined,
  });
  ok("7h-control. it DOES intercept a build asset, so 7g is not passing over a dead handler", responded);

  // ── 8. THE WRITE-TIME ALLOW-LIST IN THE BROWSER STORE ───────────────────────────────────────────
  ok("8a-control. the real record is accepted", fieldsNotAllowed(day).length === 0,
    fieldsNotAllowed(day).join(","));
  const contaminated: OfflineDay = {
    ...day,
    patients: day.patients.map(p => ({ ...p, birthDate: BIRTH_DATE } as unknown as typeof p)),
  };
  ok("8b. a record carrying one extra field is REFUSED, and the field is named",
    fieldsNotAllowed(contaminated).includes("patient.birthDate"),
    fieldsNotAllowed(contaminated).join(","));

  // ── 9. s3.6: WHAT THE ENCRYPTION ACTUALLY DOES ──────────────────────────────────────────────────
  const key = await generateCacheKey();
  const sealed = await sealRecord(key, day);
  const opened = await openRecord<OfflineDay>(key, sealed);
  ok("9a. a sealed day opens again, unchanged", JSON.stringify(opened) === JSON.stringify(day));
  const bytes = Buffer.from(new Uint8Array(sealed.ciphertext)).toString("latin1");
  ok("9b. the patient's name is not lying in the stored bytes", !bytes.includes(PATIENT_NAME));
  const otherKey = await generateCacheKey();
  ok("9c. another key opens nothing, and returns null rather than throwing",
    (await openRecord(otherKey, sealed)) === null);
  const tampered = new Uint8Array(sealed.ciphertext.slice(0));
  tampered[0] ^= 0xff;
  ok("9d. a single flipped byte makes the record unreadable, not partly readable",
    (await openRecord(key, { iv: sealed.iv, ciphertext: tampered.buffer })) === null);

  // ── 10. s3.7 / s3.8.6: THE GATE ─────────────────────────────────────────────────────────────────
  const noFlag = await offlineCacheGate(admin, ctx, USER);
  ok("10a. with no flag in the catalogue the gate is UNRESOLVED, and closed",
    noFlag.state === "unresolved" && noFlag.allowed === false, noFlag.reason);
  ok("10b. ⚠ and does NOT purge -- an unreadable switch is not a decision anybody made",
    noFlag.purge === false);

  await admin.from("plat_feature_flags").insert({ key: OFFLINE_FLAG, default_on: true, description: "harness" });
  const flagOn = await offlineCacheGate(admin, ctx, USER);
  ok("10c-control. seeded and defaulted on, the gate opens",
    flagOn.state === "allowed" && flagOn.allowed === true, flagOn.reason);

  const off = await updateConfiguration(admin, {
    workspaceId, offlineCache: false, actorId: USER, correlationId: "harness-offline-off",
  });
  ok("10d-control. a practice can switch it off through the settings engine", off.ok,
    off.ok ? "" : off.message);
  const practiceOff = await offlineCacheGate(admin, ctx, USER);
  ok("10e. the practice's own switch closes the gate even with the platform flag on",
    practiceOff.state === "withheld" && practiceOff.allowed === false, practiceOff.reason);
  ok("10f. ⚠ and turning it off PURGES rather than merely stopping new writes",
    practiceOff.purge === true);
  ok("10g. its reason is a sentence a practitioner can read, naming what happened",
    /turned offline access off/i.test(practiceOff.reason));

  await admin.from("plat_feature_flags").update({ default_on: false }).eq("key", OFFLINE_FLAG);
  const platformOff = await offlineCacheGate(admin, ctx, USER);
  ok("10h. the platform switch closes it too, and purges", platformOff.state === "withheld"
    && platformOff.purge === true, platformOff.reason);

  // ── 11. ⚠ A REFUSAL IS NOT A FAULT ──────────────────────────────────────────────────────────────
  // todaysCohort sets ONE flag for two very different things: an account without practice.calendar.view
  // (permanent, expected, nothing wrong) and a read that failed (transient, somebody should look). Until
  // 2026-08-11 both rendered as "could not be read", which tells an administrator who is not a clinician
  // that the system is broken. Three states, and this was two collapsed into one.
  const refused = await todaysCohort(admin, ctxFor(workspaceId, ["practice.home.view"]),
    { date: today, timezone: "Africa/Kampala", at });
  ok("11a. ⚠ no practice.calendar.view is reported as REFUSED, not failed",
    refused.unavailable === true && refused.reason === "refused", String(refused.reason));

  const cohortFailed = await todaysCohort(
    { from: () => ({ select: () => ({ eq: () => ({ gte: () => ({ lt: () => ({ neq: () => ({ order: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) }) }) }) },
    ctxFor(workspaceId), { date: today, timezone: "Africa/Kampala", at });
  ok("11b. ⚠ and a read that broke is reported as FAILED",
    cohortFailed.unavailable === true && cohortFailed.reason === "failed", String(cohortFailed.reason));

  const cohortOk = await todaysCohort(admin, ctxFor(workspaceId), { date: today, timezone: "Africa/Kampala", at });
  ok("11c-control. a healthy read reports neither, so 11a/11b are the two paths and not a constant",
    cohortOk.unavailable === false && cohortOk.reason === null, String(cohortOk.reason));

  ok("11d. ⚠ the screen says something DIFFERENT for a refusal",
    /patientsUnavailableReason === "refused"/.test(readerSrc)
    && /permission rather than a fault/.test(readerSrc));
  ok("11e. the reason is carried on the cached record, not recomputed offline",
    (built.ok ? Object.keys(built.day) : []).includes("patientsUnavailableReason"));

  await cleanup();
  await restoreFlag();
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

// ⚠ THE CRASH PATH RESTORES AS WELL. A harness that only puts the platform back when it passes leaves
// the deployment misconfigured exactly when somebody is distracted by a failure.
main().catch(async e => { console.error(e); await cleanup(); await restoreFlag(); process.exitCode = 1; });
