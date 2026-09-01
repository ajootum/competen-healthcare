/**
 * THE PATIENT BOOKING SCREENS, AND THE SIX GUARDS AROUND THE UNVERIFIED REQUEST.
 *
 * PATIENT_BOOKING_SCREENS_BUILT was false and three engines had only harness callers. This file proves
 * the screens and the public route exist, and -- far more importantly -- proves that the door they open
 * is bounded in the six ways the owner was promised when they chose to open it.
 *
 * ⚠ THE STANDARD. Every control fixes EXACTLY ONE condition and shows the same call succeed. A refusal
 * reached with three things wrong is indistinguishable from one refusal wearing three names, and an
 * assertion whose break reds nothing is vacuous.
 *
 * WHAT IT PROVES:
 *   1. ⚠ THE DEFAULT IS SHUT. A fresh practice refuses an unverified request, and the column defaults to
 *      false rather than to the door being open.
 *   2. ⚠ A PRACTICE REQUIRING VERIFICATION CANNOT HAVE AN UNVERIFIED REQUEST WRITTEN BY ANY CALL PATH --
 *      the engine refuses it, the booking path cannot produce one, and only two statements in the whole
 *      of src insert into this table at all.
 *   3. ⚠ THE MARK IS ON THE ROW, IS DERIVED FROM THE PROOF, AND CANNOT BE WRITTEN OVER.
 *   4. ⚠ AN UNVERIFIED REQUEST HOLDS NO SLOT. The same time is still offered afterwards, two people may
 *      ask for it, and the database refuses a slot id on such a row.
 *   5. ⚠ THE RATE LIMIT REFUSES WHEN IT CANNOT BE READ, and when no source can be recorded at all.
 *   6. ⚠ AN UNREADABLE DIARY IS NEVER "NO TIMES AVAILABLE", in the engine and on the screen.
 *   7. It never becomes an appointment, and nothing claims a confirmation was sent.
 *
 *   npx --yes tsx scripts/practice-patient-booking-screens-harness.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { issueIdentity, claimHandle } from "../src/lib/practice/identity-service";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { saveBookingAccess, setPublishState, bookingAccessProfile } from "../src/lib/practice/patient-access";
import { saveBookingRule } from "../src/lib/practice/booking-rules";
import { generateSlots } from "../src/lib/practice/availability-config";
import {
  resolveBookingPage, requestBookingCode, confirmBookingCode, submitBookingRequest,
  bookableSlots, publicBookingEntry, PATIENT_BOOKING_SCREENS_BUILT,
} from "../src/lib/practice/patient-booking";
import {
  submitUnverifiedRequest, unverifiedRequestPolicy, requestQueue, handleRequest,
  intakeQuestionsFor, VERIFICATION_MARKS, UNVERIFIED_PER_SOURCE_PER_HOUR,
} from "../src/lib/practice/booking-request-unverified";
import type { Transport } from "../src/lib/practice/messaging";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// ⚠ ITS OWN OWNER AND ITS OWN HANDLE. The live practice b7c5dbc1-22e1-4c53-900c-c2c0f0e7135b holds two
// real patients and is being walked by the owner. Nothing in this file addresses it.
const OWNER = "00000000-0000-4000-8000-0000000fc0b2";
const TZ = "Africa/Kampala";
const CORR = "harness-booking-screens";
const HANDLE = "harnessbookscreen";
const ROOT = process.cwd();

let phoneSeq = 0;
const nextPhone = () => `+2567725558${String(10 + phoneSeq++).padStart(2, "0")}`;
let sourceSeq = 0;
const nextSource = () => `harness-source-${Date.now()}-${sourceSeq++}`;

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── A CLIENT THAT WILL NOT ANSWER FOR ONE TABLE ──────────────────────────────────────────────────────
//
// ⚠ THE ONLY WAY TO REACH A FAIL-CLOSED BRANCH IS TO MAKE THE READ FAIL. Every chained method returns
// the same thenable, so `.select(...).eq(...).gte(...)` and `await` all land on one error -- and only
// for the named table, so the refusal being measured is that read and not a broken fixture.
function failingQuery(message: string) {
  const result = { data: null, error: { message, code: "XX000" }, count: null };
  const target: any = function () { /* proxy target only */ };
  const handler: any = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (res: any) => Promise.resolve(result).then(res);
      return () => handler;
    },
    apply() { return handler; },
  });
  return handler;
}

const adminBlindTo = (table: string, message: string) => ({
  from(t: string) {
    return t === table ? failingQuery(message) : (admin as any).from(t);
  },
}) as any;

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(name: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-bookscreens-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: OWNER, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    const { data: reqs } = await admin.from("practice_booking_request").select("challenge_id").eq("workspace_id", w.id);
    await admin.from("practice_booking_request").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_access").delete().eq("workspace_id", w.id);
    for (const r of (reqs ?? []) as any[])
      if (r.challenge_id) await admin.from("practice_patient_session").delete().eq("challenge_id", r.challenge_id);
    await admin.from("practice_otp_challenge").delete().eq("workspace_id", w.id);
    await admin.from("practice_message").delete().eq("workspace_id", w.id);
    await admin.from("practice_message_channel").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_rule").delete().eq("workspace_id", w.id);
    await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  await admin.from("practice_otp_challenge").delete().like("destination", "+2567725558%");
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

const outbox: { kind: string; destination: string; body: string }[] = [];
const recorder: Transport = async (kind, destination, body) => {
  outbox.push({ kind, destination, body });
  return { ok: true, providerMessageId: `harness-${outbox.length}`, response: '{"harness":true}' };
};
const codeFrom = (body: string) => (body.match(/\b(\d{6})\b/) ?? [])[1] ?? "";

async function freshPair(): Promise<{ token: string; phone: string }> {
  const phone = nextPhone();
  const req = await requestBookingCode(admin, {
    handle: HANDLE, channel: "sms", destination: phone, correlationId: CORR, transport: recorder,
  });
  if (!req.ok) throw new Error(`code request refused: ${req.code} ${req.message}`);
  const confirmed = await confirmBookingCode(admin, {
    challengeId: req.data.challengeId, code: codeFrom(outbox[outbox.length - 1]?.body ?? ""),
  });
  if (!confirmed.ok) throw new Error(`code confirm refused: ${confirmed.code} ${confirmed.message}`);
  return { token: confirmed.data.token, phone };
}

const intake = (over: Record<string, any> = {}) => ({
  givenName: "Sarah", familyName: "Nakato", birthDate: "1990-06-14", sex: "female",
  reasonForVisit: "recurring cough", contactPhone: nextPhone(),
  consentDataCapture: true, consentCommunication: false, ...over,
});

// ── SOURCE SCANNING, WITH COMMENTS STRIPPED ──────────────────────────────────────────────────────────
//
// ⚠ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT TIDINESS. Two vacuous assertions were found in this
// repo this week by scanning source for a phrase that also appeared in the scanner's own comment, or in
// an import line. Anything asserted below is asserted about CODE.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

async function main() {
  console.log("\nThe patient booking screens, and the unverified request\n");

  // ══ A. ⚠ WHAT IS TRUE OF THE SOURCE, ASSERTED BEFORE ANYTHING TOUCHES A DATABASE ══════════════
  //
  // ⚠ THIS SECTION IS FIRST ON PURPOSE. Migration 272 is written but not yet applied in this
  // environment, and a file that stopped at the migration gate would prove nothing at all -- including
  // the structural guarantees, which do not depend on a column existing. These run always.
  section("A. The shape of the code");

  const sources = walk(join(ROOT, "src"));
  const insertSites = sources.filter(f =>
    /from\("practice_booking_request"\)\s*\.insert/.test(stripComments(readFileSync(f, "utf8"))));
  ok("A1. ⚠ ONLY TWO FILES IN src INSERT INTO practice_booking_request AT ALL -- so 'the server enforces the config' is a claim about two statements, not about a convention",
    insertSites.length === 2
    && insertSites.some(f => f.endsWith("patient-booking.ts"))
    && insertSites.some(f => f.endsWith("booking-request-unverified.ts")),
    insertSites.join(", "));

  const engineSrc = stripComments(readFileSync(join(ROOT, "src/lib/practice/booking-request-unverified.ts"), "utf8"));
  ok("A2. ⚠ AND THE CONFIGURATION GATE IS AHEAD OF THE WRITE IN THAT FILE. A configuration read after the insert is a configuration that decided nothing",
    engineSrc.indexOf("UNVERIFIED_NOT_ACCEPTED") > 0
    && engineSrc.indexOf("UNVERIFIED_NOT_ACCEPTED") < engineSrc.indexOf(".insert("),
    `gate at ${engineSrc.indexOf("UNVERIFIED_NOT_ACCEPTED")}, insert at ${engineSrc.indexOf(".insert(")}`);

  ok("A3. ⚠ AND SO IS THE RATE LIMIT. A limit read after the row is written is a row that was written before it was limited",
    engineSrc.indexOf("RATE_LIMIT_UNREADABLE") > 0
    && engineSrc.indexOf("RATE_LIMIT_UNREADABLE") < engineSrc.indexOf(".insert("),
    `limit at ${engineSrc.indexOf("RATE_LIMIT_UNREADABLE")}, insert at ${engineSrc.indexOf(".insert(")}`);

  const bookingSrc = stripComments(readFileSync(join(ROOT, "src/lib/practice/patient-booking.ts"), "utf8"));
  ok("A4. ⚠ AND THE OTHER WRITER CANNOT PRODUCE AN UNVERIFIED ROW: its insert names both halves of the proof, which is exactly what the generated column reads",
    /challenge_id:\s*proof\.proof\.challengeId/.test(bookingSrc)
    && /verified_at:\s*new Date\(\)\.toISOString\(\)/.test(bookingSrc));

  const mustExist = [
    "src/app/practice/book/[handle]/appointment/page.tsx",
    "src/app/practice/book/[handle]/appointment/BookingWizard.tsx",
    "src/app/api/v1/practice/public/booking/route.ts",
  ];
  const present = mustExist.filter(f => { try { return statSync(join(ROOT, f)).isFile(); } catch { return false; } });
  ok("A5. ⚠ PATIENT_BOOKING_SCREENS_BUILT IS TRUE AND EVERY FILE IT CLAIMS EXISTS, EXISTS. A constant asserting a screen is exactly as true as the screen",
    PATIENT_BOOKING_SCREENS_BUILT === true && present.length === mustExist.length,
    mustExist.filter(f => !present.includes(f)).join(", "));

  const routeSrc = stripComments(readFileSync(join(ROOT, "src/app/api/v1/practice/public/booking/route.ts"), "utf8"));
  ok("A6. ⚠ THE PUBLIC ROUTE REACHES THE ENGINES WITHOUT A CAPABILITY TEST, because a patient holds none of the fifty seeded codes and one would refuse every real patient",
    /submitBookingRequest/.test(routeSrc) && /submitUnverifiedRequest/.test(routeSrc)
    && /bookableSlots/.test(routeSrc)
    && !/requirePracticeContext|hasCapability/.test(routeSrc), "");

  ok("A7. ⚠ AND IT DECIDES NOTHING ABOUT THE UNVERIFIED PATH ITSELF. No configuration test lives in the route, so it cannot open that door by forgetting one",
    !/unverified_requests_allowed|unverifiedRequestPolicy/.test(routeSrc), "");

  const boardSrc = stripComments(readFileSync(
    join(ROOT, "src/app/practice/(shell)/booking-requests/RequestQueueBoard.tsx"), "utf8"));
  ok("A8. ⚠ THE PRACTICE-FACING SCREEN DRAWS THE MARK FROM THE ENGINE'S FIELDS RATHER THAN DECIDING IT. A component that computed its own mark is a second answer to which row is which",
    /verificationLabel/.test(boardSrc) && /verificationSentence/.test(boardSrc)
    && !/challenge_id|verified_at/.test(boardSrc), "");

  const wizardSrc = stripComments(readFileSync(
    join(ROOT, "src/app/practice/book/[handle]/appointment/BookingWizard.tsx"), "utf8"));
  ok("A9. ⚠ THE WIZARD KEEPS AN OUTAGE AND AN EMPTY DIARY APART. Different state and different copy -- a component that drew `slots.length === 0` for both would tell a patient the wrong one",
    /slotsProblem/.test(wizardSrc)
    && /setSlots\(null\)/.test(wizardSrc)
    && /could not be read/.test(wizardSrc)
    && /Nothing is free in this week/.test(wizardSrc),
    "");

  ok("A10. ⚠ AND IT IS NOT A SECOND FORMS RUNTIME. One renderer, one validator, one condition evaluator, one catalogue -- all imported, none restated",
    /from "@\/components\/practice\/FormFieldInput"/.test(wizardSrc)
    && /resolveApplicable/.test(wizardSrc)
    && /validateAnswer/.test(wizardSrc)
    && /intakeField/.test(wizardSrc), "");

  // ⚠ THE BUNDLE BOUNDARY, ASSERTED. This is the failure that killed the Follow-ups board: a "use
  // client" component importing one label from a module that reaches node:crypto or next/headers
  // type-checks, lints, passes every harness, and kills the page at runtime. The engine reaches
  // evaluateBooking, audit and node:crypto, so nothing in a browser may import it -- the marks, the
  // outcomes and the queue row live in a constants file that imports nothing.
  const clientFiles = sources.filter(f => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
  const offenders = clientFiles.filter(f =>
    /from "@\/lib\/practice\/booking-request-unverified"/.test(stripComments(readFileSync(f, "utf8"))));
  ok("A11-control. there are client components in this build, so A11 is asserting over something",
    clientFiles.length > 0, String(clientFiles.length));
  ok("A11. ⚠ NO CLIENT COMPONENT IMPORTS THE SERVER ENGINE. It reaches node:crypto and next/headers, and one label taken from it would drag both into the browser",
    offenders.length === 0, offenders.join(", "));
  ok("A12. ⚠ AND THE CONSTANTS FILE THE SCREENS DO IMPORT HAS NO IMPORTS AT ALL. registration-condition.ts's rule: the moment it has one, the next person adds a second and the boundary is gone",
    !/^\s*import\s/m.test(readFileSync(join(ROOT, "src/lib/practice/booking-request-constants.ts"), "utf8")), "");

  await cleanup();

  // ══ 0. A PRACTICE THAT COULD TAKE A PATIENT BOOKING ═══════════════════════════════════════════
  section("0. Fixture");

  const ws = await provision("Booking Screens Harness");
  const res = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!res.ok) { ok("0-control. context resolves", false); return report(); }
  const ctx: WorkspaceContext = res.ctx;

  const { data: locRow } = await admin.from("practice_location")
    .insert({ workspace_id: ws, name: "Entebbe Rooms", type: "clinic", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locId = locRow!.id as string;

  await issueIdentity(admin, { userId: OWNER, displayName: "Dr Screens Harness", workspaceId: ws, correlationId: CORR });
  const claimed = await claimHandle(admin, { userId: OWNER, handle: HANDLE, correlationId: CORR });
  ok("0a-control. the handle was claimed", claimed.ok, claimed.ok ? "" : (claimed as any).message);

  let sessionsMade = 0;
  for (let weekday = 1; weekday <= 7; weekday++) {
    const saved = await saveSession(admin, ctx, {
      weekday, startsMinute: 6 * 60, endsMinute: 18 * 60, locationId: locId,
      sessionName: `Clinic ${weekday}`, bookingMode: "link_only",
      appointmentTypes: ["new_consultation"], actorId: OWNER, correlationId: CORR,
    });
    if (saved.ok) sessionsMade++;
  }
  ok("0b-control. seven bookable sessions exist -- otherwise every later refusal is just an empty diary",
    sessionsMade === 7, String(sessionsMade));

  await admin.from("practice_registration_template").insert({
    workspace_id: ws, name: "Booking intake", status: "published", is_default: true,
  });

  // ⚠ THE SLOTS ARE GENERATED, AND THIS IS NOT SCENERY. bookableSlots reads
  // practice_availability_slot -- an unrun generator leaves it empty, every read returns nothing, and
  // "an unreadable diary refuses rather than returning an empty list" would then be proved against a
  // fixture that returns an empty list either way. The control below is what catches that.
  const today = new Date().toISOString().slice(0, 10);
  const inThirty = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const generated = await generateSlots(admin, ctx, {
    fromDate: today, toDate: inThirty, actorId: OWNER, correlationId: CORR,
  });
  ok("0b2-control. the diary actually has generated times in it",
    generated.ok && generated.data.slotsCreated > 0,
    generated.ok ? String(generated.data.slotsCreated) : (generated as any).message);

  const savedAccess = await saveBookingAccess(admin, ctx, {
    mode: "link_only", otpRequired: true, visibleLocationIds: [locId],
    visibleAppointmentTypes: ["new_consultation"], consentRequired: true,
    brandDisplayName: "Entebbe Rooms", actorId: OWNER, correlationId: CORR,
  });
  ok("0c-control. a booking page was configured", savedAccess.ok, savedAccess.ok ? "" : (savedAccess as any).message);
  await admin.from("practice_booking_access").update({ handle: HANDLE }).eq("workspace_id", ws);

  const allowRule = await saveBookingRule(admin, ctx, {
    name: "Patients may book", status: "active", priority: 10,
    channel: "patient_self", leadTimeMinutes: 0, bookingHorizonDays: 365,
      // CPR-BOOK-READY-001 s3: the publish blocker resolves visibility per session, and a rule without one
      // leaves it visibility_unknown -- the check hardened after this fixture was written (2026-08-28).
      visibility: "public",
    actorId: OWNER, correlationId: CORR,
  });
  ok("0d-control. a rule in force covers the patient channel", allowRule.ok, allowRule.ok ? "" : (allowRule as any).message);

  await admin.from("practice_message_channel").insert([
    { workspace_id: ws, kind: "sms", enabled: true, sender_name: "Harness" },
  ]);
  process.env.AFRICASTALKING_API_KEY = "harness-only";
  process.env.AFRICASTALKING_USERNAME = "harness";

  const published = await setPublishState(admin, ctx, {
    to: "published", acceptWarnings: true, actorId: OWNER, correlationId: CORR,
  });
  ok("0e-control. the page publishes", published.ok, published.ok ? "" : (published as any).message);

  const page = await resolveBookingPage(admin, HANDLE);
  ok("0f-control. the page resolves for a stranger", page.state === "ok" && page.value !== null);

  // ⚠ ASKED FOR, NOT ASSUMED -- AND THE ASSUMPTION IS WHAT HID A PRODUCT BUG FOR A WHOLE RELEASE.
  //
  // These four times used to be invented: a day four days out, 08:00Z, then +1h, +2h, +3h. Nothing checked
  // that the practice offered any of them. It did not: the sessions are 06:00-18:00 Kampala, so slots begin
  // at 03:00Z, and a whole-hour-from-08:00Z grid need not land on the practice's own appointment length.
  // Every assertion about a time being offered, still offered, or no longer offered was therefore being made
  // against an EMPTY LIST -- 4b failed for the wrong reason and 4b-control-2 passed vacuously, "proving"
  // that booking removes a time by observing that a time never on the list was still not on it.
  //
  // Chasing that emptiness is what found the real defect: bookableSlots filtered session rows by STARTS_AT
  // inside the window, so a 06:00 session was invisible to any window that did not contain 06:00.
  //
  // So the harness now ASKS the product what it offers and asserts over those times. A fixture that states
  // the answer cannot discover that the answer is wrong.
  const offerFrom = new Date(Date.now() + 4 * 86400000); offerFrom.setUTCHours(0, 0, 0, 0);
  const menu = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: offerFrom.toISOString(),
    toIso: new Date(offerFrom.getTime() + 86400000).toISOString(),
  });
  ok("0b3-control. ⚠ the practice actually offers times on the fixture day, and the later assertions use THOSE times rather than invented ones",
    menu.ok && menu.data.slots.length >= 4,
    menu.ok ? `${menu.data.slots.length} offered: ${JSON.stringify(menu.data.slots.slice(0, 4).map(s => s.startsAt))}` : (menu as any).message);
  if (!menu.ok || menu.data.slots.length < 4) return report();

  const [timeA, timeB, timeC, timeD] = menu.data.slots.slice(0, 4).map(s => s.startsAt);

  // ══ B. ⚠ THE SHUT POSITION, AND A FAILED READ. NEITHER NEEDS MIGRATION 272 ════════════════════
  //
  // ⚠ THESE RUN WHETHER OR NOT THE MIGRATION IS APPLIED, and that is not a convenience. The shut
  // position is the position this product is in until somebody deliberately changes it, so it is the one
  // that most needs proving -- and it is provable now.
  section("B. GUARD 1 and GUARD 6 -- the default, and who enforces it");

  const deployed = await unverifiedRequestPolicy(admin, ws);
  ok("B1. ⚠ A FRESHLY CONFIGURED PRACTICE HAS THE DOOR SHUT. Nobody is opted in by a migration, and an absent column is not a yes either",
    deployed.state === "ok" && deployed.value.allowed === false,
    JSON.stringify(deployed));

  const beforeAny = await admin.from("practice_booking_request")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  const refusedByPolicy = await submitUnverifiedRequest(admin, {
    handle: HANDLE, intake: intake(), requestedStart: timeA,
    appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("B2. ⚠ THE ENGINE REFUSES AN UNVERIFIED REQUEST AT A PRACTICE THAT REQUIRES A CODE -- with everything else about the call valid",
    !refusedByPolicy.ok && (refusedByPolicy as any).code === "UNVERIFIED_NOT_ACCEPTED",
    refusedByPolicy.ok ? "it was accepted" : `${(refusedByPolicy as any).code}: ${(refusedByPolicy as any).message}`);

  const afterRefusal = await admin.from("practice_booking_request")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("B2-detail. ⚠ AND NOTHING WAS WRITTEN. A refused request must not leave a stranger's name and telephone number in the table anyway",
    (afterRefusal.count ?? -1) === (beforeAny.count ?? -2),
    `${beforeAny.count} -> ${afterRefusal.count}`);

  ok("B3. and the refusal says the same thing whether the practice turned it off or never turned it on -- a stranger learns nothing about a setting",
    !refusedByPolicy.ok && !/setting|configur|turned (it )?off|disabled/i.test((refusedByPolicy as any).message),
    refusedByPolicy.ok ? "" : (refusedByPolicy as any).message);

  const shutEntry = await publicBookingEntry(admin, HANDLE);
  ok("B4. ⚠ AND THE PUBLIC PAGE OFFERS NO REQUEST, while still offering the booking this practice CAN take -- two doors, decided separately",
    shutEntry.state === "open" && shutEntry.canBook === true
    && shutEntry.canRequestWithoutCode === false && shutEntry.requestNote === null,
    JSON.stringify({ canBook: shutEntry.canBook, canRequest: shutEntry.canRequestWithoutCode }));

  // ── ⚠ A FAILED READ IS NEVER A ZERO ────────────────────────────────────────────────────────────
  section("B5. A failed read is never a zero");

  const blindDiary = adminBlindTo("practice_availability_slot", "relation is unavailable");
  const diaryDown = await bookableSlots(blindDiary, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeA, toIso: new Date(Date.parse(timeA) + 86400000).toISOString(),
  });
  ok("B5a. ⚠ AN UNREADABLE DIARY REFUSES RATHER THAN RETURNING AN EMPTY LIST. 'No times available' and 'nobody could tell' are different sentences and a patient given the wrong one gives up or turns up",
    !diaryDown.ok && (diaryDown as any).code === "READ_FAILED",
    diaryDown.ok ? `it returned ${diaryDown.data.slots.length} slots` : (diaryDown as any).code);

  const diaryUp = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeA, toIso: new Date(Date.parse(timeA) + 86400000).toISOString(),
  });
  ok("B5-control. ⚠ AND THE SAME READ RETURNS TIMES WHEN THE STORE ANSWERS -- so B5a is the outage and not an empty fixture",
    diaryUp.ok && diaryUp.data.slots.length > 0,
    diaryUp.ok ? String(diaryUp.data.slots.length) : (diaryUp as any).message);

  // ── THE FORM ASKS THE SERVER WHAT TO ASK ───────────────────────────────────────────────────────
  const questions = await intakeQuestionsFor(admin, {
    handle: HANDLE, appointmentType: "new_consultation", scheduledAt: timeA, locationId: locId,
  });
  ok("B6-control. the form's questions come from the server", questions.ok, questions.ok ? "" : (questions as any).message);
  ok("B6. ⚠ THE TWO QUESTIONS A BOOKING CANNOT EXIST WITHOUT ARE RETURNED AS REQUIRED, whatever any rule says",
    questions.ok
    && questions.data.questions.filter(q => ["given_name", "family_name"].includes(q.fieldKey))
      .every(q => q.level === "required"),
    questions.ok ? JSON.stringify(questions.data.questions.map(q => `${q.fieldKey}:${q.level}`)) : "");
  ok("B7. ⚠ AND NOTHING ABOUT THE PRACTICE'S RULES TRAVELS WITH THEM -- no rule name, no capacity, no refusal. A stranger learns the questions and nothing else",
    questions.ok
    && !/ruleId|ruleName|capacity|refusal|leadTime|horizon/i.test(JSON.stringify(questions.data)),
    questions.ok ? JSON.stringify(questions.data).slice(0, 200) : "");

  // ══ ⚠ THE MIGRATION GATE. Everything past this point is about columns 272 creates. ═════════════
  section("C. Migration 272");

  const migrationApplied = deployed.state === "ok" && deployed.value.configurable;
  ok("C0-control. ⚠ MIGRATION 272 IS APPLIED -- every assertion below is about columns it creates, and none of them has been exercised until it is",
    migrationApplied,
    deployed.state === "ok" ? "the column is absent: apply migration 272 and run again" : deployed.reason);
  if (!migrationApplied) {
    console.log("\n  ⚠ SECTIONS 1 TO 7 DID NOT RUN. They are not passing and they are not failing --");
    console.log("    they are unexercised, which is a third thing and must not be read as either.\n");
    return report();
  }

  section("1. GUARD 1 and GUARD 6 -- opening the door deliberately");

  // ⚠ THE CONTROL: TURN ONLY THE SETTING ON. Nothing else about the fixture moves.
  const opened = await saveBookingAccess(admin, ctx, {
    unverifiedRequestsAllowed: true, actorId: OWNER, correlationId: CORR,
  });
  ok("1-control. the practice turned the setting on through the engine", opened.ok, opened.ok ? "" : (opened as any).message);

  const accepted = await submitUnverifiedRequest(admin, {
    handle: HANDLE, intake: intake(), requestedStart: timeA,
    appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("1d-control. ⚠ THE SAME CALL, WITH ONLY THE SETTING CHANGED, SUCCEEDS -- so 1b is the configuration and nothing else",
    accepted.ok, accepted.ok ? "" : `${(accepted as any).code}: ${(accepted as any).message}`);
  if (!accepted.ok) return report();

  const profile = await bookingAccessProfile(admin, ws);
  ok("1e. turning it on is recorded as an act with a date on it, not merely as a boolean that has always been whatever it is",
    profile.state === "ok" && profile.value?.unverifiedRequestsAllowed === true
    && !!profile.value?.unverifiedRequestsAllowedAt,
    JSON.stringify(profile.state === "ok" ? profile.value?.unverifiedRequestsAllowedAt : profile));

  // ══ 3. ⚠ THE MARK ═════════════════════════════════════════════════════════════════════════════
  section("3. GUARD 2 -- marked, and it stays marked");

  const { data: row1 } = await admin.from("practice_booking_request")
    .select("id, verification_state, status, appointment_id, slot_id, challenge_id, verified_at, source_hash")
    .eq("id", accepted.data.requestId).maybeSingle();
  ok("3a. ⚠ THE ROW IS MARKED UNVERIFIED, and the mark is derived from the absent proof rather than written beside it",
    row1?.verification_state === "unverified" && row1?.challenge_id === null && row1?.verified_at === null,
    JSON.stringify(row1));

  ok("3a-detail. and the receipt the patient is given reads the mark back from the row rather than typing it",
    accepted.data.verificationState === "unverified");

  // ⚠ THE FORGERY ATTEMPT. A generated column cannot be written, so this is refused by the database and
  // not by anything anybody has to remember.
  const forge = await admin.from("practice_booking_request")
    .update({ verification_state: "verified" }).eq("id", accepted.data.requestId).select("id");
  ok("3b. ⚠ AND IT CANNOT BE WRITTEN OVER. An update setting verification_state to 'verified' is REFUSED, in the database",
    !!forge.error,
    forge.error ? forge.error.message : "the update was accepted -- the column is not generated and the mark can be forged");

  const { data: stillMarked } = await admin.from("practice_booking_request")
    .select("verification_state").eq("id", accepted.data.requestId).maybeSingle();
  ok("3b-detail. and the row still reads unverified afterwards",
    stillMarked?.verification_state === "unverified", JSON.stringify(stillMarked));

  // ⚠ THE CONTROL: A REAL VERIFIED BOOKING ON THE SAME TABLE READS 'verified'. Without it, 3a proves only
  // that this column always says unverified.
  const pairV = await freshPair();
  const booked = await submitBookingRequest(admin, { transport: recorder,
    handle: HANDLE, token: pairV.token, intake: intake({ contactPhone: pairV.phone }),
    scheduledAt: timeB, appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("3-control. a verified booking succeeds on the same fixture",
    booked.ok, booked.ok ? "" : `${(booked as any).code}: ${(booked as any).message}`);
  if (!booked.ok) return report();

  const { data: rowV } = await admin.from("practice_booking_request")
    .select("verification_state, source_hash").eq("id", booked.data.requestId).maybeSingle();
  ok("3c-control. ⚠ AND THAT ROW READS 'verified' -- so 3a is about this request and not about every row",
    rowV?.verification_state === "verified", JSON.stringify(rowV));

  ok("3d. ⚠ sourceKey IS NO LONGER A DECORATIVE ARGUMENT: the verified path writes the hash the limit counts",
    typeof rowV?.source_hash === "string" && /^[0-9a-f]{64}$/.test(String(rowV?.source_hash)),
    String(rowV?.source_hash));

  // ⚠ AND THE PRACTICE-FACING VIEW CARRIES IT. A mark that exists only on the row is a mark nobody sees.
  const queue = await requestQueue(admin, ctx, { includeHandled: true });
  ok("3e-control. the practice can read its queue", queue.ok, queue.ok ? "" : (queue as any).message);
  const queued = queue.ok ? queue.data.requests.find(r => r.id === accepted.data.requestId) : null;
  const queuedVerified = queue.ok ? queue.data.requests.find(r => r.id === booked.data.requestId) : null;
  ok("3f. ⚠ THE PRACTICE-FACING ROW CARRIES THE MARK AND THE SENTENCE, and the two kinds do not read the same",
    queued?.verificationState === "unverified"
    && queued?.verificationLabel === VERIFICATION_MARKS.unverified.label
    && queued?.verificationSentence === VERIFICATION_MARKS.unverified.sentence
    && queuedVerified?.verificationLabel === VERIFICATION_MARKS.verified.label
    // ⚠ THE ONE THAT MATTERS: THE TWO DO NOT READ THE SAME. Compared as plain strings, because the
    // literal types are what a compiler would otherwise settle for us -- and a screen renders strings.
    && String(queued?.verificationLabel) !== String(queuedVerified?.verificationLabel),
    JSON.stringify({ a: queued?.verificationLabel, b: queuedVerified?.verificationLabel }));

  // ⚠ HANDLING ONE DOES NOT UNMARK IT. A practice that rings somebody has still not verified them.
  const handled = await handleRequest(admin, ctx, {
    requestId: accepted.data.requestId, outcome: "contacted", note: "rang them",
    actorId: OWNER, correlationId: CORR,
  });
  ok("3h-control. the practice closed the request", handled.ok, handled.ok ? "" : (handled as any).message);
  const { data: afterHandled } = await admin.from("practice_booking_request")
    .select("verification_state, handled_at, appointment_id").eq("id", accepted.data.requestId).maybeSingle();
  ok("3i. ⚠ CLOSING IT DOES NOT UNMARK IT, AND DOES NOT BOOK IT. The mark is for ever and the practice books in the diary",
    afterHandled?.verification_state === "unverified" && !!afterHandled?.handled_at
    && afterHandled?.appointment_id === null,
    JSON.stringify(afterHandled));

  // ══ 4. ⚠ IT HOLDS NO SLOT ═════════════════════════════════════════════════════════════════════
  section("4. GUARD 3 and GUARD 4 -- it is not a booking and it holds nothing");

  const apptCountBefore = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);

  // ⚠ THE OBSERVATION 4b AND 4b-control-2 BOTH ASSUMED, AND NEITHER MADE.
  //
  // 4b asserts the time is STILL offered after an unverified request; 4b-control-2 asserts a real booking
  // REMOVES its time. Both are absence-or-presence claims about the state AFTER an act, and neither looked
  // at the state BEFORE it. If the fixture never offered that minute at all, 4b fails for a reason that has
  // nothing to do with requests holding slots -- and 4b-control-2 passes VACUOUSLY, because a time that was
  // never on the list is trivially not on it afterwards. That is the whole control gone.

  // The widest question first: does this fixture offer ANY time that day? If not, every presence/absence
  // assertion below is being made against an empty list.
  const offeredThatDay = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeA, toIso: new Date(Date.parse(timeA) + 12 * 3600000).toISOString(),
  });
  ok("4b-pre0. the diary offers times at all on the fixture day",
    offeredThatDay.ok && offeredThatDay.data.slots.length > 0,
    offeredThatDay.ok ? JSON.stringify(offeredThatDay.data.slots.slice(0, 8).map(s => s.startsAt)) : (offeredThatDay as any).message);

  const offeredBeforeC = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeC, toIso: new Date(Date.parse(timeC) + 60000).toISOString(),
  });
  ok("4b-pre. ⚠ the minute 4b is about IS on the list to begin with -- otherwise 4b measures the fixture, not the guard",
    offeredBeforeC.ok && offeredBeforeC.data.slots.some(s => Date.parse(s.startsAt) === Date.parse(timeC)),
    offeredBeforeC.ok ? JSON.stringify(offeredBeforeC.data.slots.map(s => s.startsAt)) : (offeredBeforeC as any).message);

  const held = await submitUnverifiedRequest(admin, {
    handle: HANDLE, intake: intake(), requestedStart: timeC,
    appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("4-control. a request for a free time is accepted", held.ok, held.ok ? "" : (held as any).message);
  if (!held.ok) return report();

  const apptCountAfter = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("4a. ⚠ NO APPOINTMENT WAS CREATED. A request is a message and never a booking",
    (apptCountAfter.count ?? -1) === (apptCountBefore.count ?? -2),
    `${apptCountBefore.count} -> ${apptCountAfter.count}`);

  const stillOffered = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeC, toIso: new Date(Date.parse(timeC) + 60000).toISOString(),
  });
  ok("4b. ⚠ AND THE TIME IS STILL OFFERED TO THE NEXT PATIENT. An unverified stranger cannot take a clinic's diary off the market",
    stillOffered.ok && stillOffered.data.slots.some(s => Date.parse(s.startsAt) === Date.parse(timeC)),
    stillOffered.ok ? JSON.stringify(stillOffered.data.slots.map(s => s.startsAt)) : (stillOffered as any).message);

  // ⚠ THE CONTROL FOR 4b: A REAL BOOKING DOES REMOVE THE TIME. Without it, 4b proves only that
  // bookableSlots ignores everything.
  const offeredBeforeD = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeD, toIso: new Date(Date.parse(timeD) + 60000).toISOString(),
  });
  ok("4b-control-0. ⚠ and the minute the CONTROL is about is on the list before the booking -- without this, 4b-control-2 passes for a time that was never offered",
    offeredBeforeD.ok && offeredBeforeD.data.slots.some(s => Date.parse(s.startsAt) === Date.parse(timeD)),
    offeredBeforeD.ok ? JSON.stringify(offeredBeforeD.data.slots.map(s => s.startsAt)) : (offeredBeforeD as any).message);

  const pairH = await freshPair();
  const realBooking = await submitBookingRequest(admin, { transport: recorder,
    handle: HANDLE, token: pairH.token, intake: intake({ contactPhone: pairH.phone }),
    scheduledAt: timeD, appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("4b-control-1. a real booking was made at another time",
    realBooking.ok, realBooking.ok ? "" : (realBooking as any).message);
  const afterRealBooking = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeD, toIso: new Date(Date.parse(timeD) + 60000).toISOString(),
  });
  ok("4b-control-2. ⚠ AND A REAL BOOKING DOES TAKE ITS TIME OFF THE LIST -- so 4b is about requests holding nothing, not about this read never changing",
    afterRealBooking.ok && !afterRealBooking.data.slots.some(s => Date.parse(s.startsAt) === Date.parse(timeD)),
    afterRealBooking.ok ? JSON.stringify(afterRealBooking.data.slots.map(s => s.startsAt)) : (afterRealBooking as any).message);

  const second = await submitUnverifiedRequest(admin, {
    handle: HANDLE, intake: intake({ givenName: "Peter", familyName: "Okello" }), requestedStart: timeC,
    appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("4c. ⚠ TWO PEOPLE MAY ASK FOR THE SAME TIME, and the practice decides between them. A first-come lock on an unauthenticated endpoint is a denial-of-service with a form in front of it",
    second.ok, second.ok ? "" : `${(second as any).code}: ${(second as any).message}`);

  const { data: heldRow } = await admin.from("practice_booking_request")
    .select("slot_id, appointment_id, status").eq("id", held.data.requestId).maybeSingle();
  ok("4d. the row names no slot, no appointment, and is 'submitted' rather than 'booked'",
    heldRow?.slot_id === null && heldRow?.appointment_id === null && heldRow?.status === "submitted",
    JSON.stringify(heldRow));

  // ⚠ AND THE DATABASE REFUSES ONE, so a future call path cannot make a request hold a slot by writing
  // the column that nothing computing free time reads anyway.
  const { data: anySlot } = await admin.from("practice_availability_slot")
    .select("id").eq("workspace_id", ws).limit(1).maybeSingle();
  ok("4e-control. there is a slot id to try to attach, so 4e is asserting over something", !!anySlot);
  const attach = await admin.from("practice_booking_request")
    .update({ slot_id: anySlot!.id }).eq("id", held.data.requestId).select("id");
  ok("4e. ⚠ AND THE DATABASE REFUSES A SLOT ON AN UNVERIFIED REQUEST -- the constraint, not a convention",
    !!attach.error,
    attach.error ? attach.error.message : "the slot was attached -- an unverified request can hold a time");

  const promote = await admin.from("practice_booking_request")
    .update({ status: "booked" }).eq("id", held.data.requestId).select("id");
  ok("4f. ⚠ AND IT CANNOT BE PROMOTED TO 'booked' EITHER. A request becoming a booking by an UPDATE is the one shortcut that would undo all of this",
    !!promote.error,
    promote.error ? promote.error.message : "an unverified request was marked booked");

  // ══ 5. ⚠ THE RATE LIMIT, AND IT FAILS CLOSED ══════════════════════════════════════════════════
  section("5. GUARD 5 -- rate limited, and it refuses when it cannot count");

  const beforeLimit = await admin.from("practice_booking_request")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);

  const blind = adminBlindTo("practice_booking_request", "relation is unavailable");
  const unreadable = await submitUnverifiedRequest(blind, {
    handle: HANDLE, intake: intake(), requestedStart: timeC,
    appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("5a. ⚠ AN UNREADABLE LIMIT REFUSES. resolveBookingRule's discarded error produced a permissive default and a database wobble opened the diary -- this is the same shape, closed",
    !unreadable.ok && (unreadable as any).code === "RATE_LIMIT_UNREADABLE",
    unreadable.ok ? "it was accepted" : `${(unreadable as any).code}: ${(unreadable as any).message}`);

  const afterUnreadable = await admin.from("practice_booking_request")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("5a-detail. and nothing was written on that path",
    (afterUnreadable.count ?? -1) === (beforeLimit.count ?? -2),
    `${beforeLimit.count} -> ${afterUnreadable.count}`);

  const noSource = await submitUnverifiedRequest(admin, {
    handle: HANDLE, intake: intake(), requestedStart: timeC,
    appointmentType: "new_consultation", locationId: locId,
    sourceKey: "", correlationId: CORR,
  });
  ok("5b. ⚠ AND A REQUEST THAT CANNOT BE LIMITED AT ALL IS REFUSED RATHER THAN LET THROUGH UNLIMITED. issueOtp's own position: an approximated auth control is worse than a named absent one",
    !noSource.ok && (noSource as any).code === "SOURCE_LIMIT_UNAVAILABLE",
    noSource.ok ? "it was accepted with no source" : (noSource as any).code);

  // ⚠ THE CONTROL FOR BOTH: THE SAME CALL, ON A READABLE STORE, WITH A SOURCE.
  const limitControl = await submitUnverifiedRequest(admin, {
    handle: HANDLE, intake: intake(), requestedStart: timeC,
    appointmentType: "new_consultation", locationId: locId,
    sourceKey: nextSource(), correlationId: CORR,
  });
  ok("5-control. ⚠ THE SAME CALL SUCCEEDS WITH A READABLE STORE AND A SOURCE -- so 5a and 5b each refuse on their own ground",
    limitControl.ok, limitControl.ok ? "" : `${(limitControl as any).code}: ${(limitControl as any).message}`);

  // ⚠ AND THE LIMIT ACTUALLY BITES, which is the half a fail-closed test does not prove.
  const oneSource = nextSource();
  let acceptedFromSource = 0;
  let refusal: any = null;
  for (let i = 0; i < UNVERIFIED_PER_SOURCE_PER_HOUR + 1; i++) {
    const r = await submitUnverifiedRequest(admin, {
      handle: HANDLE, intake: intake(), requestedStart: timeC,
      appointmentType: "new_consultation", locationId: locId,
      sourceKey: oneSource, correlationId: CORR,
    });
    if (r.ok) acceptedFromSource++; else { refusal = r; break; }
  }
  ok("5c. ⚠ THE PER-SOURCE LIMIT BITES, and it bites at the number it says it does",
    acceptedFromSource === UNVERIFIED_PER_SOURCE_PER_HOUR && refusal?.code === "TOO_MANY_REQUESTS",
    `${acceptedFromSource} accepted, then ${refusal?.code ?? "nothing"}`);

  // ══ 6. WHAT THE PUBLIC PAGE MAY SAY ONCE BOTH DOORS ARE OPEN ═════════════════════════════════
  section("6. The entry, once the practice has opened the second door");

  const entry = await publicBookingEntry(admin, HANDLE);
  ok("6a. the entry reports booking open, and the request door open too, on a practice where both are",
    entry.state === "open" && entry.canBook === true && entry.canRequestWithoutCode === true
    && entry.requestNote !== null,
    JSON.stringify({ canBook: entry.canBook, canRequestWithoutCode: entry.canRequestWithoutCode }));

  ok("6b. ⚠ AND THE REQUEST NOTE PROMISES NOTHING THIS DEPLOYMENT CANNOT DO: no message sent, no appointment, no time held",
    !!entry.requestNote
    && /not an appointment/i.test(entry.requestNote)
    && /not being held/i.test(entry.requestNote)
    && /no message has been sent/i.test(entry.requestNote)
    && !/we have (texted|emailed)|check your (phone|inbox)/i.test(entry.requestNote),
    entry.requestNote ?? "");

  ok("6c. ⚠ AND NOTHING ON THE RECEIPT CLAIMS A CONFIRMATION WAS SENT, OR THAT A TIME IS HELD",
    accepted.data.confirmationSent === false && accepted.data.holdsSlot === false);

  // ══ 6.5 CPR-BOOK-HFE-002 s16/s17 -- THE STRUCTURED FAILURE REASONS ═══════════════════════════
  section("6.5. The public page's failure reasons are specific, and true");

  ok("6.5a. an open practice with a public clinic reports the availability state, not unknown",
    entry.availability.state === "has_public_clinic" && entry.availability.patientNote === null,
    JSON.stringify(entry.availability));
  ok("6.5b. and an open page carries no closed-reason",
    entry.closedBecause === null);

  // ── PAUSED IS A DIFFERENT SENTENCE FROM NEVER-PUBLISHED (s17 row 1). The fixture page is paused,
  //    the entry is asked again, and the state is restored whatever happens.
  {
    const { data: pageRow } = await admin.from("practice_booking_access")
      .select("publish_state").eq("workspace_id", ws).maybeSingle();
    const priorState = pageRow?.publish_state ?? null;
    await admin.from("practice_booking_access")
      .update({ publish_state: "paused" }).eq("workspace_id", ws);
    const paused = await publicBookingEntry(admin, HANDLE);
    ok("6.5c. ⚠ a PAUSED page says 'not right now', names PAGE_PAUSED, and offers no booking",
      paused.state === "closed" && paused.closedBecause === "paused"
      && paused.blockers.includes("PAGE_PAUSED") && paused.canBook === false
      && /not accepting online bookings right now/i.test(paused.whyNot ?? ""),
      JSON.stringify({ state: paused.state, closedBecause: paused.closedBecause, whyNot: paused.whyNot }));
    ok("6.5d. ⚠ and the paused sentence is NOT the never-published sentence -- the two remain distinguishable",
      !/does not take online bookings/i.test(paused.whyNot ?? ""), paused.whyNot ?? "");
    await admin.from("practice_booking_access")
      .update({ publish_state: priorState }).eq("workspace_id", ws);
    const restored = await publicBookingEntry(admin, HANDLE);
    ok("6.5e. CONTROL: restoring the publish state reopens the page exactly as it was",
      restored.state === "open" && restored.canBook === true);
  }

  // ── EVERY CLINIC INTERNAL-ONLY IS s17's SOFT STATE: the page stays open, the diary is empty by
  //    configuration, and the patient is told so in the prescribed sentence. Rules restored after.
  {
    const { data: priorRules } = await admin.from("practice_booking_rule")
      .select("id, visibility").eq("workspace_id", ws);
    await admin.from("practice_booking_rule")
      .update({ visibility: "internal" }).eq("workspace_id", ws);
    const dark = await publicBookingEntry(admin, HANDLE);
    ok("6.5f. ⚠ with every governing rule internal, the entry says no_public_clinic WITHOUT shutting the page",
      dark.state === "open" && dark.availability.state === "no_public_clinic"
      && /no online appointments are currently available/i.test(dark.availability.patientNote ?? ""),
      JSON.stringify(dark.availability));
    for (const r of (priorRules ?? []) as { id: string; visibility: string | null }[]) {
      await admin.from("practice_booking_rule").update({ visibility: r.visibility }).eq("id", r.id);
    }
    const relit = await publicBookingEntry(admin, HANDLE);
    ok("6.5g. CONTROL: restoring the rules restores the public clinic",
      relit.availability.state === "has_public_clinic");
  }

  // ⚠ THE QUEUE IS A PERMISSION, NOT A PAGE. The screen is behind appointment.manage and so is the read.
  section("7. The practice-facing queue");
  const noCap = await requestQueue(admin, { ...ctx, capabilities: [] }, {});
  ok("7j. ⚠ THE PRACTICE-FACING QUEUE REFUSES A CONTEXT WITHOUT appointment.manage, in the engine rather than in the sidebar",
    !noCap.ok && (noCap as any).code === "FORBIDDEN",
    noCap.ok ? "it read the queue" : (noCap as any).code);

  await cleanup();
  report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`   FAILED: ${f}`); process.exit(1); }
  console.log("");
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
