/**
 * CPR-PROV-DEFAULTS-001 s16 -- the clean-room journey, executed and timed.
 *
 * Provisions a FRESH synthetic practice, then performs exactly the practitioner's own acts -- through
 * the same canonical services the UI's clicks call -- until the public booking page is live and a
 * patient could book. Wall-clock timed per act, verified by the readiness engine and the public entry
 * resolver after each stage, and fully purged at the end.
 *
 * ⚠ WHAT THIS PROVES AND WHAT IT CANNOT. It proves the number of acts, the system path, and that the
 * end state is genuinely bookable (the same publicBookingEntry the patient page renders says so). It
 * cannot measure a HUMAN finding the buttons -- that is s16's untrained-practitioner walk, which stays
 * the owner's. One step differs for a synthetic user: identity discovery needs a confirmed email, so
 * the PROFILE page's visibility step is reported, not performed. The BOOKING page (what a patient's
 * link opens) does not depend on it.
 *
 *   npx tsx scripts/_cleanroom-journey.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { createLocation } from "../src/lib/practice/configuration";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { generateSlots } from "../src/lib/practice/availability-config";
import { claimHandle } from "../src/lib/practice/identity-service";
import { saveBookingAccess, setPublishState, publishReadiness } from "../src/lib/practice/patient-access";
import { publicBookingEntry, bookableSlots } from "../src/lib/practice/patient-booking";
import { computeSetupWizard } from "../src/app/practice/(shell)/setup/patient-booking/wizard";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

/* eslint-disable @typescript-eslint/no-explicit-any */

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false } });

const SYNTH_USER = "00000000-0000-4000-8000-0000000c1ea0";
const CORR = "cleanroom-journey";
const HANDLE = `cleanroom${String(Date.now()).slice(-6)}`;

const PAYLOAD: IndividualRequest = {
  displayName: "CLEANROOM Practice (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
  professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
};

const acts: { act: string; ms: number; outcome: string }[] = [];
async function timed<T>(act: string, fn: () => Promise<T>, outcomeOf: (r: T) => string): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  acts.push({ act, ms: Date.now() - t0, outcome: outcomeOf(r) });
  return r;
}

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().eq("user_id", SYNTH_USER);
  await admin.from("practice_handle_history").delete().eq("user_id", SYNTH_USER);
  await purgeWorkspacesOwnedBy(admin, [SYNTH_USER]);
  await admin.from("provisioning_request").delete().eq("target_user_id", SYNTH_USER);
}

async function main() {
  console.log("\nClean-room journey (CPR-PROV-DEFAULTS-001 s16)\n");
  await cleanup();

  // ── PLATFORM SIDE: provisioning (not the practitioner's clock) ─────────────
  const { data: reqRow, error: reqErr } = await admin.from("provisioning_request").insert({
    idempotency_key: `cleanroom-${Date.now()}`, request_type: "pilot",
    actor_user_id: SYNTH_USER, target_user_id: SYNTH_USER,
    payload_hash: "cleanroom", correlation_id: CORR,
  }).select("id").single();
  if (reqErr || !reqRow) { console.error("request refused:", reqErr?.message); process.exit(1); }

  const prov = await timed("PLATFORM: provision (baseline seeded)", () =>
    runProvisioning(admin, { id: reqRow.id, target_user_id: SYNTH_USER, correlation_id: CORR, workspace_id: null }, PAYLOAD),
    r => r.ok ? "workspace ready" : `FAILED ${r.errorCode}`);
  if (!prov.ok || !prov.workspaceId) { console.error("provisioning failed"); await cleanup(); process.exit(1); }
  const ws = prov.workspaceId;

  const resolved = await resolveWorkspaceContext(admin, SYNTH_USER, ws);
  if (!resolved.ok) { console.error("ctx:", resolved.reason); await cleanup(); process.exit(1); }
  const ctx = resolved.ctx;

  const readiness0 = await publishReadiness(admin, ctx);
  console.log(`  after provisioning: verdict=${readiness0.verdict}, blockers=[${readiness0.blockersFailing.map((b: any) => b.code ?? b).join(", ")}]`);
  const wizard0 = computeSetupWizard({
    publishState: readiness0.profile?.publishState ?? null, verdict: readiness0.verdict,
    checks: (readiness0.checks as any[]).map((c: any) => ({ code: c.code, state: c.state })),
    onlineClinicCount: 0,
  });
  console.log(`  wizard opens at: ${wizard0.stages.find(s => s.state === "current")?.title ?? "?"}\n`);

  // ── THE PRACTITIONER'S ACTS ────────────────────────────────────────────────
  const loc = await timed("ACT 1: add a location", () =>
    createLocation(admin, { workspaceId: ws, name: "Cleanroom Clinic House", type: "clinic", actorId: SYNTH_USER, correlationId: CORR }),
    r => r.ok ? "location created" : `FAILED ${r.message}`);
  if (!loc.ok) { await cleanup(); process.exit(1); }

  const sess = await timed("ACT 2: create the Wednesday morning clinic (bookable, typed)", async () => {
    const s = await saveSession(admin, ctx, {
      weekday: 3, startsMinute: 8 * 60 + 30, endsMinute: 12 * 60 + 30,
      locationId: loc.data.id, sessionName: "Wednesday Morning Clinic",
      bookingMode: "public", appointmentTypes: ["new_consultation", "scheduled_followup"],
      appointmentMinutes: 30, actorId: SYNTH_USER, correlationId: CORR,
    });
    if (!(s as any).ok) return s as any;
    // The diary's slots for the next fortnight -- the UI generates these on save.
    const today = new Date().toISOString().slice(0, 10);
    const fortnight = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
    await generateSlots(admin, ctx, { fromDate: today, toDate: fortnight, actorId: SYNTH_USER, correlationId: CORR });
    return s as any;
  }, (r: any) => r.ok ? "clinic saved + slots generated" : `FAILED ${r.message}`);
  if (!(sess as any).ok) { console.error(JSON.stringify(sess)); await cleanup(); process.exit(1); }

  const claim = await timed("ACT 3: claim the booking handle", () =>
    claimHandle(admin, { userId: SYNTH_USER, handle: HANDLE, correlationId: CORR }),
    r => r.ok ? `@${HANDLE}` : `FAILED ${r.message}`);
  if (!claim.ok) { console.error(claim.message); await cleanup(); process.exit(1); }

  const publish = await timed("ACT 4: booking page settings + publish", async () => {
    const saved = await saveBookingAccess(admin, ctx, {
      mode: "public",
      visibleLocationIds: [loc.data.id],
      visibleAppointmentTypes: ["new_consultation", "scheduled_followup"],
      actorId: SYNTH_USER, correlationId: CORR,
    } as any);
    if (!(saved as any).ok) return saved as any;
    return await setPublishState(admin, ctx, {
      to: "published", acceptWarnings: true, actorId: SYNTH_USER, correlationId: CORR,
    } as any);
  }, (r: any) => r.ok ? "published" : `FAILED ${r.message ?? JSON.stringify(r)}`);
  if (!(publish as any).ok) { console.error(JSON.stringify(publish)); await cleanup(); process.exit(1); }

  // ── THE VERDICTS, FROM THE ENGINES THAT SERVE PATIENTS ─────────────────────
  const entry = await publicBookingEntry(admin, HANDLE);
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 13 * 86400000).toISOString();
  const slots = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation",
    fromIso: new Date().toISOString(), toIso: nextWeek,
  });
  const readiness1 = await publishReadiness(admin, ctx);
  const wizard1 = computeSetupWizard({
    publishState: readiness1.profile?.publishState ?? null, verdict: readiness1.verdict,
    checks: (readiness1.checks as any[]).map((c: any) => ({ code: c.code, state: c.state })),
    onlineClinicCount: 1,
  });

  console.log("\n── the acts, timed ──");
  for (const a of acts) console.log(`  ${(a.ms / 1000).toFixed(1).padStart(6)}s  ${a.act} — ${a.outcome}`);
  const practitionerMs = acts.filter(a => a.act.startsWith("ACT")).reduce((n, a) => n + a.ms, 0);
  console.log(`  practitioner acts total: ${(practitionerMs / 1000).toFixed(1)}s system time across ${acts.filter(a => a.act.startsWith("ACT")).length} acts`);

  console.log("\n── end state ──");
  console.log(`  entry.state=${entry.state} canBook=${entry.canBook} availability=${entry.availability.state}`);
  console.log(`  bookable slots in the fortnight: ${slots.ok ? (slots as any).data.slots?.length ?? (slots as any).data.times?.length ?? "?" : `unreadable: ${(slots as any).message}`}`);
  console.log(`  readiness verdict: ${readiness1.verdict}; wizard shown: ${wizard1.show}`);
  console.log(`  (identity discovery is the one step a synthetic user cannot take — a real user picks a discovery mode with one click before publish)`);

  const pass = entry.state === "open" && entry.canBook === true
    && entry.availability.state === "has_public_clinic"
    && wizard1.show === false;
  console.log(pass ? "\nPASS: a patient at the page could book." : "\nFAIL: the end state is not bookable.");

  await cleanup();
  console.log("cleaned up.\n");
  process.exit(pass ? 0 : 1);
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
