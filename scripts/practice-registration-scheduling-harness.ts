/**
 * THE REGISTRATION SCHEDULING CARD, THE STAFF CHANNEL, AND THE ATOMIC REGISTER-AND-BOOK.
 *
 * CP-SCHED-001 s6 (the UX contract), s9 (the availability contracts) and s10 (concurrency).
 *
 * ⚠ THE STANDARD. Every control fixes EXACTLY ONE condition and shows the same call succeed. A refusal
 * reached with three things wrong is indistinguishable from one refusal wearing three names, and an
 * assertion whose break reds nothing is vacuous. Three traps are watched for by name:
 *   (a) scanning source for a phrase that also appears in a comment -- comments are stripped first
 *   (b) asserting over an EMPTY LIST -- every such assertion is preceded by one that it is non-empty
 *   (c) a harness that re-implements the rule it tests -- everything below IMPORTS the engine
 *
 * WHAT IT PROVES:
 *   A. The shape of the code and of migration 276, before anything touches a database.
 *   B. ⚠ THE CHANNEL IS REAL. A practice with no published booking page still offers STAFF slots while
 *      the same practice offers a patient nothing; an `internal` session is offered to staff and not to
 *      a patient; a `none` session is offered to neither.
 *   C. ⚠ THE DATES ENGINE CANNOT DRIFT FROM THE TIMES ENGINE. Every count on a date chip equals the
 *      length of the time list that date opens, and a booking moves both by one.
 *   D. ⚠ ATOMICITY. Register-and-book into a free slot writes both rows; into a slot taken between the
 *      read and the write it writes NEITHER, and says so. Plus: the function is not callable by anon.
 *   E. Every judgement is still in TypeScript, and each refusal leaves no patient behind.
 *
 *   npx --yes tsx scripts/practice-registration-scheduling-harness.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { issueIdentity, claimHandle } from "../src/lib/practice/identity-service";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { saveBookingAccess, setPublishState } from "../src/lib/practice/patient-access";
import { saveBookingRule } from "../src/lib/practice/booking-rules";
import { generateSlots } from "../src/lib/practice/availability-config";
import { practiceToday } from "../src/lib/practice/practice-time";
import {
  bookableSlots, bookableTimes, nextAvailableDates, staffBookingLocations,
} from "../src/lib/practice/patient-booking";
import { registerAndBook, register } from "../src/lib/practice/registration";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// ⚠ ITS OWN OWNER. Another harness runs concurrently and a shared owner id makes them purge each
// other's rows mid-run, which produces refusals that look like engine bugs.
const OWNER = "00000000-0000-4000-8000-00000000cafe";
const TZ = "Africa/Kampala";
const CORR = "harness-registration-scheduling";
const HANDLE = "harnessregsched";
const ROOT = process.cwd();
const MIGRATION = join(ROOT, "supabase/migrations/276-practice-register-and-book.sql");

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── A CLIENT THAT CANNOT SEE ONE APPOINTMENT ─────────────────────────────────────────────────────────
//
// ⚠ THIS IS HOW THE RACE IS REPRODUCED WITHOUT TOUCHING ANY SQL. The engine looks at the diary, does not
// see the row, decides the time is free -- and then the DATABASE, which does see it, refuses the write.
// That is precisely the sequence migration 255's exclusion constraint exists for, and it is the only
// sequence in which the transaction is the thing that saves the patient record.
//
// ⚠ `.rpc` IS PASSED THROUGH UNTOUCHED, so the write goes to the real database.
function blindToAppointment(hiddenId: string) {
  return {
    from(table: string) {
      const builder: any = (admin as any).from(table);
      if (table !== "practice_appointment") return builder;
      return new Proxy(builder, {
        get(target: any, prop: string | symbol) {
          if (prop === "select") return (...a: any[]) => target.select(...a).neq("id", hiddenId);
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
    rpc: (...a: any[]) => (admin as any).rpc(...a),
  } as any;
}

/** A client that will not answer for one table at all. Used for the failed-read assertions. */
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
  from(t: string) { return t === table ? failingQuery(message) : (admin as any).from(t); },
  rpc: (...a: any[]) => (admin as any).rpc(...a),
}) as any;

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(name: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-regsched-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: OWNER, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_booking_request").delete().eq("workspace_id", w.id);
    await admin.from("practice_booking_access").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_relationship").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_contact").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
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
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

// ⚠ COMMENTS STRIPPED FIRST. Two vacuous assertions were found in this repo by scanning source for a
// phrase that also appeared in a comment. Anything asserted below is asserted about CODE.
const stripTs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const stripSql = (src: string) => src.split("\n").map(l => {
  const i = l.indexOf("--");
  return i >= 0 ? l.slice(0, i) : l;
}).join("\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

let seq = 0;
const person = (over: Record<string, any> = {}) => ({
  givenName: "Sched", familyName: `Harness${seq++}`, sex: "female",
  birthDate: "1988-04-02", phone: `+25677266${String(1000 + seq).slice(-4)}`,
  reasonForVisit: "a cough", correlationId: CORR, ...over,
});

async function patientCount(ws: string) {
  const { count, error } = await admin.from("practice_patient")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  // ⚠ A FAILED COUNT IS NOT A COUNT OF NOUGHT. Returning -1 makes a broken read fail the assertion
  // rather than satisfy it by accident.
  return error ? -1 : (count ?? -1);
}
async function apptCount(ws: string) {
  const { count, error } = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  return error ? -1 : (count ?? -1);
}

async function main() {
  console.log("\nThe registration scheduling card, the staff channel, and the atomic register-and-book\n");

  // ══ A. THE SHAPE OF THE CODE, ASSERTED BEFORE ANYTHING TOUCHES A DATABASE ══════════════════════
  section("A. The shape of the code and of migration 276");

  const migRaw = readFileSync(MIGRATION, "utf8");
  const migCode = stripSql(migRaw);

  ok("A1. migration 276 is ASCII only -- the owner applies it by hand and a stray glyph is a paste that fails",
    [...migRaw].every(c => c.charCodeAt(0) <= 126),
    [...migRaw].filter(c => c.charCodeAt(0) > 126).slice(0, 5).join(""));

  const commentSemicolon = migRaw.split("\n")
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(({ l }) => { const d = l.indexOf("--"); return d >= 0 && l.slice(d).includes(";"); });
  ok("A2. ⚠ NO SEMICOLON INSIDE A COMMENT. One in migration 238 silently shredded two sections while still reporting success",
    commentSemicolon.length === 0, commentSemicolon.map(x => `line ${x.i}`).join(", "));

  ok("A3. ⚠ security invoker, AND NOT security definer. A definer function here would be a door around every capability check, because RLS on practice_* has no policies at all",
    /security\s+invoker/i.test(migCode) && !/security\s+definer/i.test(migCode));

  ok("A4. ⚠ THE EXECUTE PRIVILEGE IS REVOKED FROM public, anon AND authenticated. PostgREST publishes every function as an RPC endpoint, so without this the file publishes patient creation to any signed-in user",
    /revoke\s+execute\s+on\s+function\s+practice_register_and_book\([\s\S]*?\)\s*from\s+public,\s*anon,\s*authenticated/i.test(migCode));

  ok("A5. ...and granted to service_role, which is the client an API route uses AFTER it has checked a capability",
    /grant\s+execute\s+on\s+function\s+practice_register_and_book\([\s\S]*?\)\s*to\s+service_role/i.test(migCode));

  ok("A6. the revoke comes BEFORE the grant. A grant to service_role that a later revoke-from-public reversed would leave nobody able to call it",
    migCode.search(/revoke\s+execute/i) < migCode.search(/grant\s+execute/i));

  ok("A7. notify pgrst is the LAST statement",
    migCode.trim().endsWith("notify pgrst, 'reload schema';"));

  // ⚠ THE FUNCTION BODY, AND NOTHING ELSE. Taken between the dollar quotes so the surrounding prose
  // cannot satisfy or break this.
  const body = (migCode.match(/as \$\$([\s\S]*?)\$\$;/) ?? [])[1] ?? "";
  ok("A8-control. the function body was found and is not empty, so A8 and A9 are asserting over something",
    body.trim().length > 200, String(body.trim().length));
  ok("A8. ⚠ THE FUNCTION DECIDES NOTHING: no `if`, no `case`, no `coalesce`-as-a-branch on any decision, and no loop. Every judgement is in TypeScript where a harness can break it",
    !/\bif\b/i.test(body) && !/\bcase\b/i.test(body) && !/\bloop\b/i.test(body),
    body.match(/\b(if|case|loop)\b/i)?.[0] ?? "");
  ok("A9. ⚠ AND IT CONTAINS NO STATEMENT TERMINATOR AT ALL, so a runner that splits on semicolons cannot shred it",
    !body.includes(";"));

  ok("A10. ⚠ NO ANONYMOUS do-block. The owner's migration runner splits on semicolons and a do $$ block does not survive it",
    !/\bdo\s+\$\$/i.test(migCode));

  // ── THE SOURCE ─────────────────────────────────────────────────────────────────────────────────
  const sources = walk(join(ROOT, "src"));
  const clientFiles = sources.filter(f => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
  ok("A11-control. there are client components in this build, so A11 is asserting over something",
    clientFiles.length > 0, String(clientFiles.length));
  const offenders = clientFiles.filter(f => {
    const s = stripTs(readFileSync(f, "utf8"));
    return /from "@\/lib\/practice\/(patient-booking|registration|patients|scheduling)"/.test(s);
  });
  ok("A11. ⚠ NO CLIENT COMPONENT IMPORTS AN AVAILABILITY OR REGISTRATION ENGINE. They reach node:crypto and next/headers, and one type taken from them would drag both into the browser",
    offenders.length === 0, offenders.join(", "));

  const formSrc = stripTs(readFileSync(join(ROOT, "src/app/practice/(shell)/patients/RegistrationForm.tsx"), "utf8"));
  ok("A12. ⚠ THE FREE-FORM APPOINTMENT BOX IS GONE. It was a datetime-local that knew nothing about locations, sessions or what was already booked, and it passed locationId: null",
    !/datetime-local/.test(formSrc) && !/appointmentAt/.test(formSrc));
  ok("A13. ...and the form reaches the transactional route for a booking, and the plain one for a registration",
    /\/api\/v1\/practice\/register-and-book/.test(formSrc)
    && /\/api\/v1\/practice\/registration/.test(formSrc));

  const cardSrc = readFileSync(join(ROOT, "src/app/practice/(shell)/patients/SchedulingCard.tsx"), "utf8");
  ok("A14. the card says what it is showing, in the design's own words",
    cardSrc.includes("Times shown are based on your practice schedule and existing bookings."));
  ok("A15. ⚠ AND IT KEEPS AN OUTAGE AND AN EMPTY DIARY APART. A card that drew the same empty row for both would tell a desk the practitioner is fully booked when a read simply failed",
    /problem=\{/.test(stripTs(cardSrc)) && /emptyText=/.test(stripTs(cardSrc)));

  const bookingSrc = stripTs(readFileSync(join(ROOT, "src/lib/practice/patient-booking.ts"), "utf8"));
  ok("A16. ⚠ bookableSlots PASSES THE PATIENT CHANNEL AS A LITERAL, not as an argument it forwards. There is no value a caller can pass through that door to reach the staff branch",
    /channel:\s*"patient_self"\s*\}\s*\)/.test(bookingSrc)
    && /export async function bookableSlots/.test(bookingSrc));

  const regSrc = stripTs(readFileSync(join(ROOT, "src/lib/practice/registration.ts"), "utf8"));
  ok("A17. ⚠ EVERY JUDGEMENT RUNS BEFORE THE RPC. A check after the write is a check that decided nothing",
    regSrc.indexOf("screenRegistration") < regSrc.indexOf("practice_register_and_book")
    && regSrc.indexOf("checkPlacement") < regSrc.indexOf("practice_register_and_book")
    && regSrc.indexOf("prepareRegistration") < regSrc.indexOf("practice_register_and_book"));
  ok("A18. ⚠ AND THE SEQUENTIAL PATH SURVIVES, because 'Register only' and every caller that books nothing still needs it",
    /export async function register\(/.test(regSrc) && /bookAppointment\(/.test(regSrc));

  await cleanup();

  // ══ 0. A PRACTICE WITH THREE KINDS OF SESSION AND NO PUBLISHED PAGE ════════════════════════════
  section("0. Fixture -- three booking modes, and nothing published yet");

  const ws = await provision("Registration Scheduling Harness");
  const res = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!res.ok) { ok("0-control. context resolves", false); return report(); }
  const ctx: WorkspaceContext = res.ctx;

  const { data: locRow } = await admin.from("practice_location")
    .insert({ workspace_id: ws, name: "Kabale Rooms", type: "clinic", active: true, travel_buffer_minutes: 0 })
    .select("id").single();
  const locId = locRow!.id as string;

  await issueIdentity(admin, { userId: OWNER, displayName: "Dr Scheduling Harness", workspaceId: ws, correlationId: CORR });

  // ⚠ THREE MODES, THREE DIFFERENT WEEKDAYS, so each can be asked about on its own. A fixture that put
  // two modes on one day could not tell which one a returned time came from.
  const MODE_DAY: Record<string, number> = { link_only: 1, internal: 2, none: 3 };
  let sessionsMade = 0;
  for (const [mode, weekday] of Object.entries(MODE_DAY)) {
    const saved = await saveSession(admin, ctx, {
      weekday, startsMinute: 8 * 60, endsMinute: 12 * 60, locationId: locId,
      sessionName: `${mode} clinic`, bookingMode: mode,
      appointmentTypes: ["new_consultation"], actorId: OWNER, correlationId: CORR,
    });
    if (saved.ok) sessionsMade++;
    else console.log(`      (session ${mode} refused: ${(saved as any).message})`);
  }
  ok("0a-control. one session of each booking mode exists -- otherwise every later refusal is just an empty diary",
    sessionsMade === 3, String(sessionsMade));

  // ⚠ ONE RULE PER CHANNEL. s7.3's vocabulary is closed and there is no "any" -- and a fixture whose
  // patient channel had no rule cover cannot publish, which would silently turn section B's patient
  // control into a second measurement of the same absent page.
  let rulesMade = 0;
  for (const channel of ["patient_self", "staff"]) {
    const rule = await saveBookingRule(admin, ctx, {
      name: `Open diary (${channel})`, status: "active", priority: 10,
      channel, leadTimeMinutes: 0, bookingHorizonDays: 365,
      actorId: OWNER, correlationId: CORR,
    });
    if (rule.ok) rulesMade++;
    else console.log(`      (rule ${channel} refused: ${(rule as any).message})`);
  }
  ok("0b-control. a rule in force opens the diary on both channels, so nothing below is refused by a notice period",
    rulesMade === 2, String(rulesMade));

  // Publish readiness asks for a registration template. Without it the page cannot publish and section
  // B's patient control would measure the missing template rather than the channel.
  await admin.from("practice_registration_template").insert({
    workspace_id: ws, name: "Scheduling harness intake", status: "published", is_default: true,
  });

  const today = new Date().toISOString().slice(0, 10);
  const inThirty = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const generated = await generateSlots(admin, ctx, {
    fromDate: today, toDate: inThirty, actorId: OWNER, correlationId: CORR,
  });
  ok("0c-control. the diary actually has generated times in it",
    generated.ok && generated.data.slotsCreated > 0,
    generated.ok ? String(generated.data.slotsCreated) : (generated as any).message);

  const { data: pageRow } = await admin.from("practice_booking_access").select("id").eq("workspace_id", ws).maybeSingle();
  ok("0d-control. ⚠ NOTHING IS PUBLISHED YET. Section B's whole point is a practitioner who never opened a public page, and a fixture that had one would prove nothing",
    !pageRow, pageRow ? "a booking page already exists" : "");

  // ══ B. ⚠ THE CHANNEL ══════════════════════════════════════════════════════════════════════════
  section("B. The channel is real");

  const from = new Date(); from.setUTCHours(0, 0, 0, 0);
  const window60 = { fromIso: from.toISOString(), toIso: new Date(from.getTime() + 60 * 86400000).toISOString() };

  const staffAll = await bookableTimes(admin, {
    channel: "staff", workspaceId: ws, appointmentType: "new_consultation",
    locationId: locId, ...window60,
  });
  ok("B1. ⚠ A PRACTICE WITH NO PUBLISHED BOOKING PAGE STILL OFFERS STAFF SLOTS. A practitioner booking their own patient at their own desk does not need a public page, and until now was told there was no booking page at that address",
    staffAll.ok && staffAll.data.slots.length > 0,
    staffAll.ok ? String(staffAll.data.slots.length) : `${(staffAll as any).code}: ${(staffAll as any).message}`);
  if (!staffAll.ok) return report();

  const patientUnpublished = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId, ...window60,
  });
  ok("B2. ⚠ AND THE SAME PRACTICE OFFERS A PATIENT NOTHING, because it has published nothing. The patient side is not loosened by one inch",
    !patientUnpublished.ok && (patientUnpublished as any).code === "NOT_FOUND",
    patientUnpublished.ok ? `it returned ${patientUnpublished.data.slots.length} slots` : (patientUnpublished as any).code);

  // ── Publish, so the patient channel has something to be compared against ────────────────────────
  const claimed = await claimHandle(admin, { userId: OWNER, handle: HANDLE, correlationId: CORR });
  ok("B2-control-0. the handle was claimed", claimed.ok, claimed.ok ? "" : (claimed as any).message);
  const savedAccess = await saveBookingAccess(admin, ctx, {
    mode: "link_only", otpRequired: true, visibleLocationIds: [locId],
    visibleAppointmentTypes: ["new_consultation"], consentRequired: true,
    brandDisplayName: "Kabale Rooms", actorId: OWNER, correlationId: CORR,
  });
  ok("B2-control-1. a booking page was configured", savedAccess.ok, savedAccess.ok ? "" : (savedAccess as any).message);
  await admin.from("practice_booking_access").update({ handle: HANDLE }).eq("workspace_id", ws);
  await admin.from("practice_message_channel").insert([{ workspace_id: ws, kind: "sms", enabled: true, sender_name: "Harness" }]);
  process.env.AFRICASTALKING_API_KEY = "harness-only";
  process.env.AFRICASTALKING_USERNAME = "harness";
  const published = await setPublishState(admin, ctx, {
    to: "published", acceptWarnings: true, actorId: OWNER, correlationId: CORR,
  });
  ok("B2-control-2. the page publishes", published.ok, published.ok ? "" : (published as any).message);

  const patientPublished = await bookableSlots(admin, {
    handle: HANDLE, appointmentType: "new_consultation", locationId: locId, ...window60,
  });
  ok("B2-control-3. ⚠ AND THE SAME PATIENT CALL NOW RETURNS TIMES -- so B2 is the absent page and not a broken read",
    patientPublished.ok && patientPublished.data.slots.length > 0,
    patientPublished.ok ? String(patientPublished.data.slots.length) : (patientPublished as any).message);
  if (!patientPublished.ok) return report();

  // ── ⚠ MODE BY MODE, ON ITS OWN DAY ─────────────────────────────────────────────────────────────
  //
  // The weekday of a returned time is read from the practice's own calendar, not from the ISO string:
  // an 08:00 Kampala session is 05:00Z and slicing the string would attribute a third of it to the day
  // before.
  const tz = staffAll.data.timezone;
  const weekdayOf = (iso: string) => {
    const local = practiceToday(tz, new Date(iso));
    // 1..7, Monday first -- migration 230's own weekday numbering.
    const d = new Date(`${local}T00:00:00Z`).getUTCDay();
    return d === 0 ? 7 : d;
  };
  const staffDays = new Set(staffAll.data.slots.map(s => weekdayOf(s.startsAt)));
  const patientDays = new Set(patientPublished.data.slots.map(s => weekdayOf(s.startsAt)));

  ok("B3-control. both channels returned times at all, so B3 to B6 are not asserting over empty lists",
    staffDays.size > 0 && patientDays.size > 0,
    `staff ${[...staffDays]} / patient ${[...patientDays]}`);

  ok("B3. ⚠ AN `internal` SESSION IS OFFERED TO STAFF. Its own blurb is 'you and authorised staff may book patients in' -- it is the mode written for this channel and it was being filtered out of every availability read",
    staffDays.has(MODE_DAY.internal), `staff days: ${[...staffDays].sort()}`);

  ok("B4. ⚠ AND IT IS NOT OFFERED TO A PATIENT. `internal` says there is no patient-facing route, and there is not",
    !patientDays.has(MODE_DAY.internal), `patient days: ${[...patientDays].sort()}`);

  ok("B5-control. ⚠ THE link_only SESSION IS OFFERED TO BOTH -- so B4 is about the mode and not about the patient channel returning nothing on a Tuesday",
    staffDays.has(MODE_DAY.link_only) && patientDays.has(MODE_DAY.link_only));

  ok("B6. ⚠ A `none` SESSION IS OFFERED TO NEITHER. It is time the practitioner set aside for themselves and the registration desk has no more claim on it than a stranger does",
    !staffDays.has(MODE_DAY.none) && !patientDays.has(MODE_DAY.none),
    `staff ${[...staffDays].sort()} / patient ${[...patientDays].sort()}`);

  // ── The locations read, and its default ────────────────────────────────────────────────────────
  const locsRead = await staffBookingLocations(admin, ws);
  ok("B7. the staff locations read returns the practice's active locations",
    locsRead.ok && locsRead.data.locations.some(l => l.id === locId),
    locsRead.ok ? JSON.stringify(locsRead.data.locations) : (locsRead as any).message);
  ok("B8. ⚠ AND IT DEFAULTS ONLY WHEN CONTEXT IS UNAMBIGUOUS, WITH THE REASON SAID. A card that picked the first location in a list would silently book patients into the wrong building",
    locsRead.ok && locsRead.data.defaultLocationId === locId && !!locsRead.data.defaultReason,
    locsRead.ok ? JSON.stringify({ id: locsRead.data.defaultLocationId, why: locsRead.data.defaultReason }) : "");

  const locsBlind = await staffBookingLocations(adminBlindTo("practice_location", "relation is unavailable"), ws);
  ok("B9. ⚠ AN UNREADABLE LOCATION TABLE REFUSES RATHER THAN REPORTING A PRACTICE WITH NO LOCATIONS",
    !locsBlind.ok && (locsBlind as any).code === "READ_FAILED",
    locsBlind.ok ? "it returned a list" : (locsBlind as any).code);

  // ══ C. ⚠ THE DATES ENGINE CANNOT DRIFT FROM THE TIMES ENGINE ══════════════════════════════════
  section("C. Dates are derived from times, so they cannot disagree");

  const dates = await nextAvailableDates(admin, {
    channel: "staff", workspaceId: ws, appointmentType: "new_consultation",
    locationId: locId, fromIso: from.toISOString(), limit: 5,
  });
  ok("C1-control. the dates engine returns dates at all, so every assertion below is over a non-empty list",
    dates.ok && dates.data.dates.length > 0,
    dates.ok ? JSON.stringify(dates.data.dates) : (dates as any).message);
  if (!dates.ok || dates.data.dates.length === 0) return report();

  // ⚠ THE ANTI-DRIFT ASSERTION. Every chip says "N available"; opening it must show exactly N times.
  // A dates engine that recomputed the rules would pass this on the day it was written and fail on the
  // first rule anybody changed -- which is why the count is derived from the same call, not beside it.
  const mismatches: string[] = [];
  for (const d of dates.data.dates) {
    const dayStart = new Date(`${d.date}T00:00:00Z`).getTime() - 24 * 3600000;
    const times = await bookableTimes(admin, {
      channel: "staff", workspaceId: ws, appointmentType: "new_consultation", locationId: locId,
      fromIso: new Date(dayStart).toISOString(),
      toIso: new Date(dayStart + 3 * 86400000).toISOString(),
    });
    if (!times.ok) { mismatches.push(`${d.date}: ${(times as any).code}`); continue; }
    const onThatDay = times.data.slots.filter(s => practiceToday(tz, new Date(s.startsAt)) === d.date);
    if (onThatDay.length !== d.freeCount) mismatches.push(`${d.date}: chip says ${d.freeCount}, the day holds ${onThatDay.length}`);
  }
  ok("C2. ⚠ EVERY DATE'S COUNT IS THE LENGTH OF THE TIME LIST IT OPENS. A chip reading '12 available' over an empty time list is the registration desk telling a patient standing at it that Tuesday is open",
    mismatches.length === 0, mismatches.join("; "));

  ok("C3. ⚠ THE DATE IS THE PRACTICE'S OWN CALENDAR DAY, NOT UTC's. An 08:00 Kampala session is 05:00Z, and bucketing on the ISO string would put the morning on the day before",
    dates.data.dates.every(d => practiceToday(tz, new Date(d.firstFreeAt)) === d.date),
    JSON.stringify(dates.data.dates.map(d => [d.date, d.firstFreeAt])));

  ok("C4. ⚠ THE DATES NEVER FALL ON THE `none` SESSION'S DAY EITHER -- the same rule, applied by the same computation",
    dates.data.dates.every(d => {
      const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
      return (wd === 0 ? 7 : wd) !== MODE_DAY.none;
    }), JSON.stringify(dates.data.dates.map(d => d.date)));

  const datesBlind = await nextAvailableDates(adminBlindTo("practice_availability_slot", "relation is unavailable"), {
    channel: "staff", workspaceId: ws, appointmentType: "new_consultation",
    locationId: locId, fromIso: from.toISOString(), limit: 5,
  });
  ok("C5. ⚠ AN UNREADABLE DIARY REFUSES RATHER THAN RETURNING NO DATES. 'The practitioner has no free days' and 'nobody could tell' are different sentences",
    !datesBlind.ok && (datesBlind as any).code === "READ_FAILED",
    datesBlind.ok ? `it returned ${datesBlind.data.dates.length} dates` : (datesBlind as any).code);

  const datesPayload = JSON.stringify(dates.data);
  ok("C6. ⚠ EVERY FIELD OF THE DATES PAYLOAD IS PLAIN DATA. A function on a payload passed to a client component type-checks, lints, passes every harness and kills the page at runtime",
    JSON.stringify(JSON.parse(datesPayload)) === datesPayload
    && Object.values(dates.data).every(v => typeof v !== "function"));

  // ══ D. ⚠ ATOMICITY ═══════════════════════════════════════════════════════════════════════════
  section("D. Register and book, atomically");

  // The time the control books, and the time the proof loses. Both ASKED FOR rather than invented -- a
  // fixture that states the answer cannot discover that the answer is wrong.
  const chosen = dates.data.dates[0];
  const dayTimes = await bookableTimes(admin, {
    channel: "staff", workspaceId: ws, appointmentType: "new_consultation", locationId: locId,
    fromIso: new Date(Date.parse(chosen.firstFreeAt) - 3600000).toISOString(),
    toIso: new Date(Date.parse(chosen.firstFreeAt) + 12 * 3600000).toISOString(),
  });
  ok("D0-control. the fixture offers at least four times on the chosen day, so every assertion below gets its own minute",
    dayTimes.ok && dayTimes.data.slots.length >= 4,
    dayTimes.ok ? String(dayTimes.data.slots.length) : (dayTimes as any).message);
  if (!dayTimes.ok || dayTimes.data.slots.length < 4) return report();
  const [timeControl, timeRace, timeSeen, timePremise] = dayTimes.data.slots.slice(0, 4).map(s => s.startsAt);

  // ══ D-premise. ⚠ THE FAILURE THE TRANSACTION EXISTS TO PREVENT, DEMONSTRATED ON LIVE CODE ══════
  //
  // ⚠ THIS IS WHAT MAKES D2a NON-VACUOUS, AND IT RUNS WHETHER OR NOT MIGRATION 276 IS APPLIED.
  //
  // D2a asserts that a refused booking leaves NO patient behind. An assertion like that is worthless
  // unless the opposite is genuinely reachable -- so here is the SEQUENTIAL path, which is real,
  // shipped, still in use for "Register only", taking exactly the same shape of call against a time
  // that is already taken. It creates the patient, fails to book, and reports the failure. If
  // registerAndBook behaved like this, D2a would be RED.
  section("D-premise. The sequential path leaves the patient behind, and that is why D2 matters");

  const { data: premiseClash } = await admin.from("practice_appointment").insert({
    workspace_id: ws, location_id: locId, patient_name: "Already Booked",
    appointment_type: "new_consultation", scheduled_at: timePremise,
    duration_minutes: dayTimes.data.minutes, status: "CONFIRMED", overlap_acknowledged: false,
    created_by: OWNER,
  }).select("id").maybeSingle();
  ok("Dp-control. an appointment already occupies the premise minute, so the booking below has a real reason to fail",
    !!premiseClash);

  const beforePremise = await patientCount(ws);
  const sequential = await register(admin, ctx, {
    ...person({ familyName: "Premisecase" }), appointmentAt: timePremise,
  });
  ok("Dp1. the sequential register-then-book reports the booking as the thing that did not happen",
    sequential.ok && sequential.data.appointmentId === null
    && sequential.data.incomplete.some(i => i.step === "appointment"),
    sequential.ok ? JSON.stringify(sequential.data.incomplete) : `${(sequential as any).code}: ${(sequential as any).message}`);
  ok("Dp2. ⚠ AND THE PATIENT EXISTS ANYWAY. A lost race on that path leaves a half-registered person on the register -- which is exactly the outcome D2a asserts the transaction prevents, and is the proof that D2a can fail",
    (await patientCount(ws)) === beforePremise + 1,
    `${beforePremise} -> ${await patientCount(ws)}`);

  // ══ E. THE JUDGEMENTS ARE IN TYPESCRIPT, AND THIS IS PROVED BEFORE THE MIGRATION GATE ═════════
  //
  // ⚠ THESE RUN WHETHER OR NOT MIGRATION 276 IS APPLIED, AND THAT IS THE POINT OF THE SECTION. If any
  // of them needed the function to exist, the judgement would be living in the function. Each refusal
  // below is reached with everything else about the call valid, and each one writes nothing.
  section("E. Every judgement is in TypeScript, ahead of the transaction");

  const seeded = await register(admin, ctx, { ...person({ familyName: "Sequential" }) });
  ok("E0-control. ⚠ THE SEQUENTIAL REGISTRATION STILL WORKS AND BOOKS NOTHING -- s15's 'registration succeeds and no calendar event is created', and 'Register only' needs it",
    seeded.ok && seeded.data.appointmentId === null,
    seeded.ok ? "" : `${(seeded as any).code}: ${(seeded as any).message}`);

  const patientsBeforeE = await patientCount(ws);

  // ⚠ A TIME NO SESSION COVERS. Midnight UTC on the chosen day is 03:00 local -- outside 08:00-12:00.
  const midnight = new Date(`${chosen.date}T00:00:00Z`).toISOString();
  const notOffered = await registerAndBook(admin, ctx, {
    ...person({ familyName: "Notoffered" }), scheduledAt: midnight, locationId: locId,
  });
  ok("E1. ⚠ A TIME THE CARD NEVER OFFERED IS REFUSED, BEFORE THE TRANSACTION IS EVEN REACHED. The instant is the easiest thing in a request body to change, so the offer is re-asked rather than trusted",
    !notOffered.ok && (notOffered as any).code !== "TRANSACTION_UNAVAILABLE",
    notOffered.ok ? "it was booked" : `${(notOffered as any).code}: ${(notOffered as any).message}`);

  const minor = await registerAndBook(admin, ctx, {
    ...person({ familyName: "Minorcase", birthDate: new Date(Date.now() - 8 * 365 * 86400000).toISOString().slice(0, 10) }),
    scheduledAt: timeSeen, locationId: locId,
  });
  ok("E2. ⚠ A CHILD WITH NO GUARDIAN IS REFUSED ON THE TRANSACTIONAL PATH TOO. Two ways of WRITING must never become two ways of DECIDING",
    !minor.ok && (minor as any).code === "GUARDIAN_REQUIRED",
    minor.ok ? "a child was registered with no guardian" : `${(minor as any).code}: ${(minor as any).message}`);

  const dup = await registerAndBook(admin, ctx, {
    ...person({ familyName: "Sequential", birthDate: "1988-04-02" }),
    scheduledAt: timeSeen, locationId: locId,
  });
  ok("E3. ⚠ THE SIMILAR-PERSON CHECK STILL RUNS, and it is the SAME function the sequential path calls rather than a copy",
    !dup.ok && (dup as any).code === "POSSIBLE_DUPLICATE"
    && Array.isArray((dup as any).candidates) && (dup as any).candidates.length > 0,
    dup.ok ? "a near-duplicate was registered without a question" : `${(dup as any).code}: ${(dup as any).message}`);

  ok("E4. ⚠ AND NONE OF THE THREE WROTE ANYTHING. A refusal that leaves a patient behind is the failure the whole transaction exists to prevent, and it must not be reintroduced by a check that runs late",
    (await patientCount(ws)) === patientsBeforeE, `${patientsBeforeE} -> ${await patientCount(ws)}`);

  // ── ⚠ THE MIGRATION GATE ───────────────────────────────────────────────────────────────────────
  // 289 REPLACED 276's function and 293 REPLACED 289's: the current signature carries the numbering
  // (p_patient_number/p_registration_year/p_sequence_number) AND the taxonomy (p_visit_type_id/
  // p_consultation_mode_id/p_booking_source). Each migration DROPS its predecessor so no caller can
  // reach a writer that omits either, which is why this probe must speak the newest signature and
  // nothing older.
  //
  // ⚠ THIS GATE HAS NOW GONE STALE TWICE, both times because it pins a SIGNATURE rather than a
  // capability -- and a signature is exactly what the next migration changes. It reddened against a
  // correctly-applied 293 while section D itself passed, which reads as "the migration is missing" when
  // the truth was the opposite. Repointed rather than deleted: it is the only thing standing between a
  // silently-absent function and a section D that would report nothing at all.
  section("D-gate. Migration 293 (the numbered, taxonomy-carrying register-and-book)");
  const probe = await admin.rpc("practice_register_and_book", {
    p_workspace_id: ws, p_display_name: "", p_given_name: null, p_middle_name: null,
    p_family_name: null, p_sex: "unspecified", p_birth_date: null, p_age_estimate_years: null,
    p_created_by: OWNER, p_patient_number: null, p_registration_year: null, p_sequence_number: null,
    p_identifiers: [], p_contacts: [],
    p_location_id: null, p_patient_phone: null, p_appointment_type: "new_consultation",
    p_scheduled_at: new Date().toISOString(), p_duration_minutes: 20, p_status: "REQUESTED", p_reason: null,
    p_visit_type_id: null, p_consultation_mode_id: null, p_booking_source: null,
  });
  // An empty display name violates migration 193's own CHECK, so a REACHABLE function refuses this with
  // a constraint error and an ABSENT one refuses it with PGRST202. The two are told apart by the code.
  const migrationApplied = String((probe.error as any)?.code ?? "") !== "PGRST202"
    && !/Could not find the function/i.test(String(probe.error?.message ?? ""));
  ok("D-gate. ⚠ MIGRATION 293 IS APPLIED -- every assertion in section D is about the function it (re)creates, and none of them has been exercised until it is",
    migrationApplied, String(probe.error?.message ?? "the probe returned no error at all"));

  if (!migrationApplied) {
    console.log("\n  ⚠ THE ATOMICITY SECTION DID NOT RUN. It is not passing and it is not failing --");
    console.log("    it is unexercised, which is a third thing and must not be read as either.");
    console.log("    Apply supabase/migrations/276-practice-register-and-book.sql and run this again.\n");
    await cleanup();
    return report();
  }

  // ── D1. THE CONTROL: A FREE SLOT WRITES BOTH ROWS ──────────────────────────────────────────────
  const patientsBefore1 = await patientCount(ws);
  const apptsBefore1 = await apptCount(ws);
  const booked = await registerAndBook(admin, ctx, {
    ...person({ familyName: "Controlcase" }), scheduledAt: timeControl, locationId: locId,
  });
  ok("D1. ⚠ REGISTER AND BOOK INTO A FREE SLOT SUCCEEDS",
    booked.ok, booked.ok ? "" : `${(booked as any).code}: ${(booked as any).message}`);
  if (!booked.ok) return report();

  // ── CP-BOOKING-TAXONOMY-001, on the THIRD writer ─────────────────────────────────────────────────
  // ⚠ ASSERTED ON THE ROW. The RPC could accept all three parameters and drop them on the floor -- an
  // insert that omits a column is not an error anywhere, and D1 above would stay green.
  {
    const { data: tax } = await admin.from("practice_appointment")
      .select("visit_type_id, consultation_mode_id, booking_source, status")
      .eq("id", booked.data.appointmentId).maybeSingle();
    ok("D1-tax-a. the register-and-book transaction records a VISIT TYPE and a MODE",
      !!tax?.visit_type_id && !!tax?.consultation_mode_id, JSON.stringify(tax));
    ok("D1-tax-b. and derives the booking source rather than leaving it null",
      !!tax?.booking_source && tax.booking_source !== "unknown", String(tax?.booking_source));
    // ⚠ THE REGRESSION THIS PATH ACTUALLY HAD. It wrote REQUESTED under a comment claiming it mirrored
    // bookAppointment, months after that engine stopped agreeing -- so a patient registered and booked
    // at the desk still needed somebody to confirm the booking they had just made.
    ok("D1-tax-c. ⚠ AND IT CONFIRMS, like every other staff booking -- no second click at the desk",
      tax?.status === "CONFIRMED", String(tax?.status));
  }

  const { data: pRow } = await admin.from("practice_patient").select("id, display_name")
    .eq("id", booked.data.patientId).maybeSingle();
  const { data: aRow } = await admin.from("practice_appointment")
    .select("id, patient_id, scheduled_at, location_id, status")
    .eq("id", booked.data.appointmentId).maybeSingle();
  ok("D1a. ⚠ BOTH ROWS EXIST AND THE APPOINTMENT NAMES THE PATIENT -- one transaction, one act",
    !!pRow && !!aRow && aRow!.patient_id === booked.data.patientId
    && Date.parse(aRow!.scheduled_at) === Date.parse(timeControl)
    && aRow!.location_id === locId,
    JSON.stringify({ p: pRow, a: aRow }));
  ok("D1b. ...and exactly one of each was added",
    (await patientCount(ws)) === patientsBefore1 + 1 && (await apptCount(ws)) === apptsBefore1 + 1,
    `${patientsBefore1} -> ${await patientCount(ws)} patients`);

  const { data: idRows } = await admin.from("practice_patient_identifier")
    .select("identifier_type, value").eq("patient_id", booked.data.patientId);
  const { data: cRows } = await admin.from("practice_patient_contact")
    .select("contact_type, value").eq("patient_id", booked.data.patientId);
  // CPR-PID-001 (2026-08-12): the number lives ON the patient row now, not in the identifier table --
  // new registrations issue no P-XXXXXX. The same-transaction proof reads the column and the contact.
  const { data: numberedRow } = await admin.from("practice_patient")
    .select("patient_number").eq("id", booked.data.patientId).single();
  ok("D1c. the patient number, extra identifiers and contacts were written in the same transaction",
    numberedRow?.patient_number === booked.data.patientNumber && /^\d{2}-\d{6}$/.test(booked.data.patientNumber)
    && (cRows ?? []).some((r: any) => r.contact_type === "phone"),
    JSON.stringify({ patientNumber: booked.data.patientNumber, stored: numberedRow?.patient_number, idRows, cRows }));

  // ── D2. ⚠ THE PROOF: A SLOT TAKEN BETWEEN THE READ AND THE WRITE ───────────────────────────────
  //
  // The conflicting appointment is inserted first, and then HIDDEN FROM THE ENGINE ONLY. So every check
  // in TypeScript passes -- the practice is open, the location is fine, the rules allow it, and the time
  // is on the offered list -- and the DATABASE is what refuses. That is the race, and it is the only
  // arrangement in which the transaction is the thing that saves the record.
  const { data: conflict, error: conflictErr } = await admin.from("practice_appointment").insert({
    workspace_id: ws, location_id: locId, patient_name: "Somebody Else",
    appointment_type: "new_consultation", scheduled_at: timeRace,
    duration_minutes: dayTimes.data.minutes, status: "CONFIRMED", overlap_acknowledged: false,
    created_by: OWNER,
  }).select("id").maybeSingle();
  ok("D2-control-0. a conflicting appointment exists at the racing minute, so D2 is asserting over something",
    !!conflict && !conflictErr, conflictErr?.message ?? "");
  if (!conflict) return report();

  const patientsBefore2 = await patientCount(ws);
  const apptsBefore2 = await apptCount(ws);
  const raced = await registerAndBook(blindToAppointment(conflict.id as string), ctx, {
    ...person({ familyName: "Racecase" }), scheduledAt: timeRace, locationId: locId,
  });
  ok("D2. ⚠ A SLOT TAKEN WHILE THE FORM WAS BEING TYPED IS REFUSED, AND THE REFUSAL NAMES THE CONFLICT",
    !raced.ok && (raced as any).code === "SLOT_TAKEN"
    && /taken while you were typing/i.test((raced as any).message)
    && /[Nn]othing was saved/.test((raced as any).message),
    raced.ok ? "it was booked" : `${(raced as any).code}: ${(raced as any).message}`);

  const patientsAfter2 = await patientCount(ws);
  ok("D2a. ⚠ AND NO PATIENT ROW WAS CREATED. THIS IS THE WHOLE POINT OF THE TRANSACTION. On the sequential path the patient exists by the time the booking is refused, and a lost race leaves a half-registered person on the register",
    patientsAfter2 === patientsBefore2 && patientsBefore2 >= 0,
    `${patientsBefore2} -> ${patientsAfter2}`);

  const { data: orphan } = await admin.from("practice_patient")
    .select("id, display_name").eq("workspace_id", ws).ilike("display_name", "%Racecase%");
  ok("D2b. ...and there is no patient of that name anywhere in the practice, which is the same claim said a second way",
    (orphan ?? []).length === 0, JSON.stringify(orphan));

  ok("D2c. ...and no appointment was added either",
    (await apptCount(ws)) === apptsBefore2, `${apptsBefore2} -> ${await apptCount(ws)}`);

  const alts = ((raced as any).alternatives ?? []) as { startsAt: string }[];
  ok("D2d. ⚠ AND THE REFUSAL CARRIES THE TIMES THAT ARE STILL FREE, WITHOUT THE ONE THAT JUST FAILED. s10: 'return a conflict response and IMMEDIATELY REFRESH nearby free times'. A refusal that only says no -- or that hands back the minute they just lost -- sends the desk to press it again and get the same answer",
    Array.isArray((raced as any).alternatives) && alts.length > 0
    && !alts.some(s => Date.parse(s.startsAt) === Date.parse(timeRace)),
    JSON.stringify(alts.slice(0, 4).map(s => s.startsAt)));

  // ── ⚠ WHAT REMOVES THE LOST MINUTE, AND WHAT WOULD NOT HAVE ────────────────────────────────────
  //
  // D2d must not be allowed to pass because the re-read happened to catch the conflict. These two say
  // which mechanism did the work, and they disagree with each other on purpose.
  const blindRecompute = await bookableTimes(blindToAppointment(conflict.id as string), {
    channel: "staff", workspaceId: ws, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeRace, toIso: new Date(Date.parse(timeRace) + 24 * 3600000).toISOString(),
  });
  ok("D2e. ⚠ A RE-READ THAT CANNOT SEE THE WINNING APPOINTMENT STILL OFFERS THE LOST MINUTE -- so D2d is passing because the engine REMOVES it explicitly, not because a refresh was trusted to notice. A read replica lagging the write, or a winner booked through a path this read does not model, both look exactly like this",
    blindRecompute.ok && blindRecompute.data.slots.some(s => Date.parse(s.startsAt) === Date.parse(timeRace)),
    blindRecompute.ok ? JSON.stringify(blindRecompute.data.slots.slice(0, 3).map(s => s.startsAt)) : (blindRecompute as any).message);

  const trueRecompute = await bookableTimes(admin, {
    channel: "staff", workspaceId: ws, appointmentType: "new_consultation", locationId: locId,
    fromIso: timeRace, toIso: new Date(Date.parse(timeRace) + 24 * 3600000).toISOString(),
  });
  ok("D2f-control. ⚠ AND A RE-READ THAT CAN SEE IT EXCLUDES THE MINUTE ANYWAY -- so the explicit removal is a second lock on the same door rather than the only one, and D2e is the blinding and not a broken subtraction",
    trueRecompute.ok && trueRecompute.data.slots.length > 0
    && !trueRecompute.data.slots.some(s => Date.parse(s.startsAt) === Date.parse(timeRace)),
    trueRecompute.ok ? JSON.stringify(trueRecompute.data.slots.slice(0, 3).map(s => s.startsAt)) : (trueRecompute as any).message);

  // ── D3. THE OTHER HALF: THE ENGINE CATCHES THE ORDINARY CASE, AND ALSO WRITES NOTHING ──────────
  const patientsBefore3 = await patientCount(ws);
  const seen = await registerAndBook(admin, ctx, {
    ...person({ familyName: "Seencase" }), scheduledAt: timeRace, locationId: locId,
  });
  ok("D3. ⚠ WHEN THE ENGINE CAN SEE THE CLASH IT REFUSES FIRST, in TypeScript -- the constraint is the backstop for the race the engine cannot see, not the primary check",
    !seen.ok && ((seen as any).code === "DOUBLE_BOOKED" || (seen as any).code === "TIME_NOT_OFFERED"),
    seen.ok ? "it was booked" : `${(seen as any).code}: ${(seen as any).message}`);
  ok("D3a. ...and that path writes no patient either",
    (await patientCount(ws)) === patientsBefore3, `${patientsBefore3} -> ${await patientCount(ws)}`);

  // ── D4. ⚠ THE REVOKE ACTUALLY TOOK ─────────────────────────────────────────────────────────────
  if (!anonKey) {
    ok("D4. ⚠ the function is NOT callable by anon", false, "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set, so this could not be tested -- which is not a pass");
  } else {
    const stranger = createClient(url!, anonKey, { auth: { persistSession: false } });
    const forbidden = await stranger.rpc("practice_register_and_book", {
      p_workspace_id: ws, p_display_name: "Intruder Test", p_given_name: null, p_middle_name: null,
      p_family_name: null, p_sex: "unspecified", p_birth_date: "1990-01-01", p_age_estimate_years: null,
      p_created_by: OWNER, p_patient_number: "99-999999", p_registration_year: 2099, p_sequence_number: 999999,
      p_identifiers: [], p_contacts: [],
      p_location_id: locId, p_patient_phone: null, p_appointment_type: "new_consultation",
      p_scheduled_at: timeSeen, p_duration_minutes: 20, p_status: "REQUESTED", p_reason: null,
    });
    ok("D4. ⚠ THE FUNCTION IS NOT CALLABLE BY anon. PostgREST publishes every function as an RPC endpoint, so without the revoke this migration would have published patient creation to anybody who can reach the API",
      !!forbidden.error,
      forbidden.error ? `${forbidden.error.code}: ${forbidden.error.message}` : "IT WAS EXECUTED BY ANON");
    const { data: intruder } = await admin.from("practice_patient")
      .select("id").eq("workspace_id", ws).ilike("display_name", "%Intruder Test%");
    ok("D4a. ...and no row of any kind was written by that call",
      (intruder ?? []).length === 0, JSON.stringify(intruder));
  }

  // ══ E-control. THE REFUSALS ABOVE, PAIRED WITH THE SAME CALLS SUCCEEDING ══════════════════════
  section("E-control. The same calls, one condition fixed");

  const minorOk = await registerAndBook(admin, ctx, {
    ...person({
      familyName: "Minorok",
      birthDate: new Date(Date.now() - 8 * 365 * 86400000).toISOString().slice(0, 10),
      relationships: [{
        relationshipType: "mother", fullName: "Grace Nakato", phone: "+256772660001",
        isLegalGuardian: true, mayReceiveInformation: true, isPrimary: true,
      }],
    }),
    scheduledAt: timeSeen, locationId: locId,
  });
  ok("E2-control. ⚠ THE SAME CHILD, WITH A GUARDIAN, BOOKS -- so E2 is the guardian rule and nothing else",
    minorOk.ok, minorOk.ok ? "" : `${(minorOk as any).code}: ${(minorOk as any).message}`);
  ok("E2-control-2. ...and the guardian was attached after the transaction, and would have been reported if it had not been",
    minorOk.ok && minorOk.data.relationships === 1 && minorOk.data.incomplete.length === 0,
    minorOk.ok ? JSON.stringify({ n: minorOk.data.relationships, incomplete: minorOk.data.incomplete }) : "");

  await cleanup();
  const { count: leftover } = await admin.from("practice_workspace")
    .select("*", { count: "exact", head: true }).eq("owner_person_id", OWNER);
  ok("Z. ⚠ THE FIXTURES WERE DELETED, AND THE DELETION WAS CHECKED. A cleanup whose error is discarded is how the next run fails with a wall of duplicates that reads like an engine bug",
    (leftover ?? -1) === 0, String(leftover));

  report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`   FAILED: ${f}`); process.exit(1); }
  console.log("");
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
