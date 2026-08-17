/**
 * CPR-LIFE-001 -- PRACTICE LIFECYCLE, THE SAFE SUBSET. On migration 247.
 *
 * WHAT IT PROVES:
 *   1. THE FIVE CAPABILITY CODES ARE THE FIVE THAT ARE LIVE. Six invented codes have shipped on this
 *      product before; an invented code compiles, reviews clean and returns 403 for every user
 *      including the owner. LIFECYCLE_CAPABILITIES is asserted against practice_role_capabilities and
 *      the control proves the check can say no.
 *   2. THE STATE VIEW IS THREE-STATE. A count that could not be read is null, never nought, and the
 *      unreadable-table control proves the null is real rather than an untested branch.
 *   3. THE TWO UNCHECKABLE CLOSURE LINES SAY SO. verdict `no_store`, never `unmet` -- an unticked box
 *      says "you have not done this" and the truth is "we cannot tell".
 *   4. THE VERBS. Archive, suspend and restore move one column and write one row. A missing reason
 *      writes NOTHING (the column is NOT NULL, so there is nowhere to put it); a missing capability and
 *      an illegal move are refused AND recorded.
 *   5. APPEND ONLY, AT THE DATABASE. UPDATE and DELETE are refused on practice_lifecycle_transition and
 *      on practice_audit_event, each paired with an INSERT control so "refused" is not "unwritable".
 *   6. ⚠ AN ARCHIVED PRACTICE REFUSES A BOOKING, AND AN ACTIVE ONE ACCEPTS THE SAME BOOKING. The
 *      fixture is arranged so the wrong answer is the one a broken engine would give: the SAME
 *      workspace, the SAME appointment, the SAME caller, and only the status differs. All four booking
 *      entry points are exercised or shown to route through the one that is.
 *   7. THE WHOLE-PRACTICE EXPORT IS REAL AND AUDITED, declares billing unavailable and the three
 *      formats it does not produce, and is refused without data.export.
 *   8. THE NINETEENTH SETUP MODULE EXISTS, IS IN `administration`, AND NAVIGATION IS UNTOUCHED.
 *
 * ⚠ THE FIXTURE IS REUSED, NOT REBUILT, AND THAT IS MIGRATION 247 WORKING AS INTENDED. A workspace
 * with lifecycle transitions CANNOT BE DELETED -- practice_lifecycle_transition.workspace_id has no
 * on-delete clause, so NO ACTION refuses the workspace delete, and the transitions cannot be deleted
 * either because the table's own trigger refuses DELETE. So this harness finds its workspace, resets
 * the rows it is allowed to reset, and tags every reason it writes with a per-run token so nothing it
 * asserts can be satisfied by a previous run's rows.
 *
 *   npx --yes tsx scripts/practice-lifecycle-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import {
  practiceLifecycle, applyTransition, exportPractice, resolveLifecycleActor,
  EXPORT_SECTIONS, type LifecycleActor,
} from "../src/lib/practice/lifecycle";
import {
  LIFECYCLE_CAPABILITIES, NON_BOOKING_STATUSES, bookingBlock,
} from "../src/lib/practice/lifecycle-constants";
import { bookAppointment, rescheduleAppointment } from "../src/lib/practice/scheduling";
import { evaluateBooking, bookUnderRules } from "../src/lib/practice/booking-rules";
import { practiceSetup } from "../src/lib/practice/setup";
import { PRACTICE_NAV } from "../src/lib/practice/navigation";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

/* eslint-disable @typescript-eslint/no-explicit-any */

const OWNER = "00000000-0000-4000-8000-00000011fe01";
const STRANGER = "00000000-0000-4000-8000-00000011fe02";
const CORR = "harness-lifecycle";
const REPO = join(__dirname, "..");

/** Every reason this run writes carries this, so no assertion can be satisfied by an older run. */
const RUN = `run-${Date.now().toString(36)}`;
const because = (what: string) => `${RUN} ${what}`;

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

// ── FIXTURE ─────────────────────────────────────────────────────────────────────────────────────────

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

/**
 * Find this harness's workspace, or make one.
 *
 * ⚠ NOT DELETED AND REMADE. See the header: once a transition exists the workspace cannot be removed,
 * by design. Reusing it is the honest shape rather than a workaround -- and the per-run token means a
 * stale row can never make an assertion pass.
 */
async function fixtureWorkspace(): Promise<string> {
  const { data: existing } = await admin.from("practice_workspace")
    .select("id").eq("owner_person_id", OWNER).order("created_at").limit(1).maybeSingle();
  if (existing) return existing.id as string;

  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-life-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(
    admin, { id: req.id, target_user_id: OWNER, correlation_id: CORR, workspace_id: null }, payload("Dr Lifecycle"));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

/**
 * Put the workspace back to ACTIVE and clear the rows this harness writes.
 *
 * ⚠ THE STATUS IS SET WITH A RAW UPDATE ON PURPOSE. Going through applyTransition would write a
 * transition row for the reset itself, and a fixture that pollutes the very log it is about to assert
 * over is a fixture that can make itself pass.
 */
async function reset(workspaceId: string) {
  await admin.from("practice_workspace").update({ status: "ACTIVE" }).eq("id", workspaceId);
  await admin.from("practice_appointment").delete().eq("workspace_id", workspaceId);
  await admin.from("practice_follow_up").delete().eq("workspace_id", workspaceId);
  await admin.from("practice_patient").delete().eq("workspace_id", workspaceId);
  await admin.from("practice_location").delete().eq("workspace_id", workspaceId);
}

/** An admin client on which one table cannot be read. The only way to exercise the first doctrine. */
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

/** The transitions this run wrote, newest first. */
async function myTransitions(workspaceId: string) {
  const { data } = await admin.from("practice_lifecycle_transition")
    .select("id, from_status, to_status, outcome, refusal_code, reason, actor_user_id, actor_membership_id, actor_kind, occurred_at")
    .eq("workspace_id", workspaceId).like("reason", `${RUN}%`)
    .order("occurred_at", { ascending: false });
  return (data ?? []) as any[];
}

const tomorrowAt = (hour: number) => {
  const d = new Date(Date.now() + 86400000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function main() {
  console.log("\n=== CPR-LIFE-001 PRACTICE LIFECYCLE (safe subset) ===");
  console.log(`    run token ${RUN}\n`);

  // The migration this whole build stands on. Probed rather than assumed: a missing table returns
  // count === null and never an error, which is the discriminator this codebase uses everywhere.
  const probe = await admin.from("practice_lifecycle_transition").select("*", { count: "exact", head: true });
  if (probe.count === null) { console.error("\n  run migration 247\n"); process.exit(1); }

  const ws = await fixtureWorkspace();
  await reset(ws);

  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) throw new Error(`context resolution failed: ${ctxRes.reason}`);
  const OWNER_CTX: WorkspaceContext = ctxRes.ctx;

  const ownerActor = await resolveLifecycleActor(admin, OWNER, ws);
  if (!ownerActor) throw new Error("the owner has no active membership in the fixture workspace");

  /** A member who may LOOK and may not TOUCH. */
  const looker: LifecycleActor = {
    userId: STRANGER, workspaceId: ws, workspaceName: OWNER_CTX.workspaceName,
    capabilities: ["practice.lifecycle.view"], membershipId: null, actorKind: "member",
  };
  /** The same context shape, with a chosen capability set, so the state view can be read in any status. */
  const ctxWith = (caps: string[]): WorkspaceContext => ({ ...OWNER_CTX, capabilities: caps });

  // ══ 1. THE CAPABILITY CODES ══════════════════════════════════════════════════════════════════════
  section("1. capability codes");

  const { data: catRows, error: catErr } = await admin.from("practice_role_capabilities")
    .select("role_code, capability_code");
  const catalogue = new Set(((catRows ?? []) as any[]).map(r => r.capability_code as string));
  ok("1a the catalogue was readable at all", !catErr && catalogue.size > 0, catErr?.message ?? "");

  const missing = LIFECYCLE_CAPABILITIES.filter(c => !catalogue.has(c));
  ok("1b every code this build uses is seeded in practice_role_capabilities",
    missing.length === 0, missing.join(","));
  // CONTROL. Without this, 1b passes against a catalogue check that always says yes.
  ok("1b-control the same check REJECTS a code that was never seeded",
    !catalogue.has("practice.delete") && !catalogue.has("practice.lifecycle.manage"));

  const ownerCaps = new Set(((catRows ?? []) as any[]).filter(r => r.role_code === "practice_owner")
    .map(r => r.capability_code as string));
  ok("1c practice_owner holds all five", LIFECYCLE_CAPABILITIES.every(c => ownerCaps.has(c)),
    LIFECYCLE_CAPABILITIES.filter(c => !ownerCaps.has(c)).join(","));
  ok("1d and the grant reached a real membership, not just the catalogue",
    LIFECYCLE_CAPABILITIES.every(c => ownerActor.capabilities.includes(c)),
    LIFECYCLE_CAPABILITIES.filter(c => !ownerActor.capabilities.includes(c)).join(","));

  // ⚠ THE ONE THAT CATCHES AN INVENTED CODE BEFORE IT SHIPS. Every practice.* capability named in this
  // build's own source has to exist. Six invented codes got past review here historically.
  const lifecycleSource = [
    readFileSync(join(REPO, "src/lib/practice/lifecycle.ts"), "utf8"),
    readFileSync(join(REPO, "src/lib/practice/lifecycle-constants.ts"), "utf8"),
    readFileSync(join(REPO, "src/app/api/v1/practice/lifecycle/route.ts"), "utf8"),
  ].join("\n");
  const quoted = [...lifecycleSource.matchAll(/"((?:practice|data)\.[a-z.]+)"/g)].map(m => m[1]);
  const invented = [...new Set(quoted)].filter(c => !catalogue.has(c));
  ok("1e no capability code in this build's source is one that does not exist",
    invented.length === 0, invented.join(","));
  ok("1e-control the scanner actually found codes to check", quoted.length >= 5, String(quoted.length));

  // ══ 2. THE STATE VIEW ════════════════════════════════════════════════════════════════════════════
  section("2. the state view");

  const active = await practiceLifecycle(admin, OWNER_CTX);
  ok("2a an ACTIVE practice reports ACTIVE, as a lifecycle state",
    active.status === "ACTIVE" && active.statusKind === "lifecycle" && active.statusReadable,
    `${active.status}/${active.statusKind}`);
  ok("2b it names when it was created", !!active.createdAt);
  ok("2c a caller without practice.lifecycle.view is refused the whole view",
    (await practiceLifecycle(admin, ctxWith(["patient.view"]))).permitted === false);
  ok("2c-control the owner IS permitted, so 2c is not vacuous", active.permitted === true);

  // ⚠ THE FIGURES ARE NUMBERS OR NULLS, NEVER A CONFIDENT NOUGHT.
  const { count: livePatients } = await admin.from("practice_patient")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  const patientFigure = active.figures.items.find(f => f.key === "patients");
  ok("2d the patient figure equals an independent count of the same table",
    patientFigure?.value === (livePatients ?? 0), `${patientFigure?.value} vs ${livePatients}`);

  const blindPatients = await practiceLifecycle(adminWithUnreadable(admin, "practice_patient"), OWNER_CTX);
  const blindFigure = blindPatients.figures.items.find(f => f.key === "patients");
  ok("2e ⚠ a failed patient read is NULL, not nought", blindFigure?.value === null, String(blindFigure?.value));
  ok("2e-control and with the table readable the same figure is a number",
    typeof patientFigure?.value === "number");

  ok("2f the quota is null in the payload, so a client cannot draw a bar against a limit nobody set",
    active.bytes.quotaBytes === null);
  ok("2g the byte figure names the tables it covers and the ones it excludes",
    active.bytes.covers.join(",") === "practice_attachment,practice_library_document"
    && active.bytes.excludes.includes("clinical record"));

  // ⚠ THE SENTENCE THAT MUST NEVER BE PRINTED. The comp's Danger Zone says patient data will be
  // "anonymised or removed according to privacy laws"; CPR-LIFE-001 is 61 lines and never uses the word,
  // and 111 cascading foreign keys contradict it. The only place the string may appear is in the refusal
  // that explains why nothing anonymises anything.
  const consoleSource = readFileSync(
    join(REPO, "src/app/practice/(shell)/setup/lifecycle/PracticeLifecycleConsole.tsx"), "utf8");
  ok("2h ⚠ the screen never claims patient data is anonymised",
    !/anonymis(ed|ation)\s+or\s+removed/i.test(consoleSource + JSON.stringify(active))
    && !/according to privacy laws/i.test(consoleSource + JSON.stringify(active)));
  ok("2h-control the refusal that explains the absence IS present, so 2h is not passing on an empty page",
    /anonymis/i.test(JSON.stringify(active.refusals)));

  ok("2i no integration tile: the refusal is carried instead of a nought or a six",
    !JSON.stringify(active.figures.items).includes("integration")
    && active.refusals.integrations.includes("practice_integration does not exist"));

  // ══ 3. s4's CLOSURE REPORT ═══════════════════════════════════════════════════════════════════════
  section("3. the closure report");

  const closure = active.closure.items;
  ok("3a six checks, one per line of s4", closure.length === 6, String(closure.length));
  // Repointed 2026-08-16: the invoices line was taught to read billing (the gap the old assertion
  // pinned was CLOSED, holding the CPR-PAY arc as its document). Integrations remain the one
  // no-store line.
  const noStore = closure.filter(c => c.verdict === "no_store").map(c => c.key).sort();
  ok("3b ⚠ exactly ONE line has no store, and it is integrations -- invoices compute now",
    noStore.join(",") === "integrations", noStore.join(","));
  ok("3c the no-store line is not drawn as an unticked box -- no count, a reason instead",
    closure.filter(c => c.verdict === "no_store").every(c => c.count === null && c.detail.length > 40));
  const invLine = closure.find(c => c.key === "invoices");
  ok("3c2 the invoices line is MET on a practice with no issued balances, through the Payments derivation",
    invLine?.verdict === "met" && invLine?.count === 0
      && (invLine?.href ?? "").includes("/practice/payments"),
    JSON.stringify(invLine));

  // A future appointment makes the appointments line UNMET, and removing it makes it MET. Arranged this
  // way round so a line that always said "met" would fail.
  const { data: p1 } = await admin.from("practice_patient")
    .insert({ workspace_id: ws, display_name: "Lifecycle Fixture", status: "active" }).select("id").single();
  const booked = await bookAppointment(admin, {
    workspaceId: ws, patientId: p1?.id ?? null, patientName: "Lifecycle Fixture",
    appointmentType: "new_consultation", scheduledAt: tomorrowAt(9),
    actorId: OWNER, correlationId: CORR,
  });
  ok("3d-control ⚠ AN ACTIVE PRACTICE ACCEPTS A BOOKING", booked.ok === true,
    booked.ok ? "" : `${booked.code}: ${booked.message}`);

  const withAppt = await practiceLifecycle(admin, OWNER_CTX);
  const apptLine = withAppt.closure.items.find(x => x.key === "appointments")!;
  ok("3d a future appointment makes the closure line outstanding, and counts it",
    apptLine.verdict === "unmet" && apptLine.count === 1, `${apptLine.verdict}/${apptLine.count}`);

  const blindAppts = await practiceLifecycle(adminWithUnreadable(admin, "practice_appointment"), OWNER_CTX);
  const blindLine = blindAppts.closure.items.find(x => x.key === "appointments")!;
  ok("3e ⚠ an unreadable diary makes the line UNREADABLE, not met",
    blindLine.verdict === "unreadable" && blindLine.count === null, blindLine.verdict);

  // ══ 4. THE THREE VERBS ═══════════════════════════════════════════════════════════════════════════
  section("4. archive, suspend, restore");

  const before = (await myTransitions(ws)).length;

  const noReason = await applyTransition(admin, ownerActor, { action: "archive", reason: "  ", correlationId: CORR });
  ok("4a a change with no reason is refused", !noReason.ok && noReason.code === "REASON_REQUIRED",
    noReason.ok ? "accepted" : noReason.code);
  ok("4a-store and NOTHING was written, because the column is NOT NULL and there is nowhere to put it",
    (await myTransitions(ws)).length === before);

  const denied = await applyTransition(admin, looker, { action: "archive", reason: because("denied attempt"), correlationId: CORR });
  ok("4b a caller without practice.archive is refused", !denied.ok && denied.code === "FORBIDDEN",
    denied.ok ? "accepted" : denied.code);
  const deniedRows = (await myTransitions(ws)).filter(r => r.outcome === "refused" && r.refusal_code === "FORBIDDEN");
  ok("4b-record ⚠ and the ATTEMPT is recorded, with who and why",
    deniedRows.length === 1 && deniedRows[0].actor_user_id === STRANGER
    && deniedRows[0].reason === because("denied attempt"),
    JSON.stringify(deniedRows));
  ok("4b-status and the practice did not move",
    (await admin.from("practice_workspace").select("status").eq("id", ws).single()).data?.status === "ACTIVE");

  const archived = await applyTransition(admin, ownerActor, { action: "archive", reason: because("archiving"), correlationId: CORR });
  ok("4c-control ⚠ the SAME action by a caller who HOLDS practice.archive succeeds, so 4b is not vacuous",
    archived.ok === true, archived.ok ? "" : `${archived.code}: ${archived.message}`);

  const nowStatus = (await admin.from("practice_workspace").select("status").eq("id", ws).single()).data?.status;
  ok("4c the practice is ARCHIVED", nowStatus === "ARCHIVED", String(nowStatus));

  const appliedRows = (await myTransitions(ws)).filter(r => r.outcome === "applied");
  ok("4d exactly one applied row, and it names both states, the actor and the reason",
    appliedRows.length === 1 && appliedRows[0].from_status === "ACTIVE" && appliedRows[0].to_status === "ARCHIVED"
    && appliedRows[0].actor_user_id === OWNER && appliedRows[0].reason === because("archiving"),
    JSON.stringify(appliedRows));
  ok("4d-membership and the membership it was done under, so an operator with none is distinguishable",
    appliedRows[0]?.actor_membership_id === ownerActor.membershipId
    && appliedRows[0]?.actor_kind === "member",
    `${appliedRows[0]?.actor_membership_id} vs ${ownerActor.membershipId}`);

  const { data: auditRows } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("workspace_id", ws).eq("event_type", "practice.lifecycle_archived")
    .order("occurred_at", { ascending: false }).limit(1);
  ok("4e and an audit event was raised for it",
    ((auditRows ?? []) as any[])[0]?.payload?.reason === because("archiving"),
    JSON.stringify(auditRows));

  const again = await applyTransition(admin, ownerActor, { action: "archive", reason: because("again"), correlationId: CORR });
  ok("4f archiving an archived practice is refused as an illegal move",
    !again.ok && again.code === "ILLEGAL_TRANSITION", again.ok ? "accepted" : again.code);
  ok("4f-record and that attempt is recorded too",
    (await myTransitions(ws)).some(r => r.refusal_code === "ILLEGAL_TRANSITION" && r.reason === because("again")));

  const del = await applyTransition(admin, ownerActor, { action: "delete", reason: because("nope"), correlationId: CORR });
  ok("4g ⚠ there is no delete verb, and asking for one is refused by name",
    !del.ok && del.code === "VALIDATION_ERROR" && /no delete/i.test(del.message), del.ok ? "accepted" : del.message);

  // ══ 5. ⚠ THE BOOKING REFUSAL ═════════════════════════════════════════════════════════════════════
  //
  // The same workspace, the same patient, the same time of day, the same caller. ONLY THE STATUS
  // DIFFERS between 3d-control (accepted) and 5a (refused), so an engine that ignored the status would
  // accept both and an engine that refused everything would fail 3d-control.
  section("5. an archived practice refuses a booking");

  const refusedBooking = await bookAppointment(admin, {
    workspaceId: ws, patientId: p1?.id ?? null, patientName: "Lifecycle Fixture",
    appointmentType: "new_consultation", scheduledAt: tomorrowAt(11),
    actorId: OWNER, correlationId: CORR,
  });
  ok("5a ⚠ AN ARCHIVED PRACTICE REFUSES A BOOKING",
    !refusedBooking.ok && refusedBooking.code === "PRACTICE_NOT_BOOKABLE",
    refusedBooking.ok ? "ACCEPTED" : refusedBooking.code);
  ok("5a-message and it says which state refused it",
    !refusedBooking.ok && /archived/i.test(refusedBooking.message), refusedBooking.ok ? "" : refusedBooking.message);

  const { count: apptCount } = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws);
  ok("5b and nothing was written -- the refusal is a refusal, not a rollback", apptCount === 1, String(apptCount));

  const moved = await rescheduleAppointment(admin, {
    workspaceId: ws, appointmentId: (booked.ok ? booked.data.id : ""),
    scheduledAt: tomorrowAt(14), actorId: OWNER, correlationId: CORR,
  });
  ok("5c the drag-and-drop path is refused on the same ground",
    !moved.ok && moved.code === "PRACTICE_NOT_BOOKABLE", moved.ok ? "MOVED" : moved.code);

  const previewArchived = await evaluateBooking(admin, ctxWith(["appointment.manage"]), {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: tomorrowAt(15),
  } as any);
  ok("5d the PREVIEW refuses too, so no screen promises what the write refuses",
    !previewArchived.ok && previewArchived.code === "PRACTICE_NOT_BOOKABLE",
    previewArchived.ok ? "ALLOWED" : previewArchived.code);

  const ruleBooking = await bookUnderRules(admin, ctxWith(["appointment.manage", "practice.settings.manage"]), {
    channel: "practitioner", appointmentType: "new_consultation", scheduledAt: tomorrowAt(16),
    patientName: "Lifecycle Fixture", actorId: OWNER, correlationId: CORR,
  } as any);
  ok("5e and so is the rules engine's own booking path",
    !ruleBooking.ok && ruleBooking.code === "PRACTICE_NOT_BOOKABLE",
    ruleBooking.ok ? "BOOKED" : ruleBooking.code);

  // SUSPENDED refuses on the same ground, and it is reached from ARCHIVED.
  const suspended = await applyTransition(admin, ownerActor, { action: "suspend", reason: because("suspending"), correlationId: CORR });
  ok("5f a practice can be suspended from archived", suspended.ok === true,
    suspended.ok ? "" : `${suspended.code}: ${suspended.message}`);
  const suspendedBooking = await bookAppointment(admin, {
    workspaceId: ws, patientId: p1?.id ?? null, patientName: "Lifecycle Fixture",
    appointmentType: "new_consultation", scheduledAt: tomorrowAt(12),
    actorId: OWNER, correlationId: CORR,
  });
  ok("5g a SUSPENDED practice refuses a booking too",
    !suspendedBooking.ok && suspendedBooking.code === "PRACTICE_NOT_BOOKABLE",
    suspendedBooking.ok ? "ACCEPTED" : suspendedBooking.code);

  const restored = await applyTransition(admin, ownerActor, { action: "restore", reason: because("restoring"), correlationId: CORR });
  ok("5h restore returns it to ACTIVE", restored.ok === true && restored.ok && restored.data.to === "ACTIVE",
    restored.ok ? "" : `${restored.code}: ${restored.message}`);

  const rebooked = await bookAppointment(admin, {
    workspaceId: ws, patientId: p1?.id ?? null, patientName: "Lifecycle Fixture",
    appointmentType: "new_consultation", scheduledAt: tomorrowAt(13),
    actorId: OWNER, correlationId: CORR,
  });
  ok("5i ⚠ AND THE SAME BOOKING IS ACCEPTED AGAIN ONCE IT IS RESTORED -- it was the status, not the fixture",
    rebooked.ok === true, rebooked.ok ? "" : `${rebooked.code}: ${rebooked.message}`);

  // The pure function behind all of it, exercised on its own so the vocabulary cannot drift.
  ok("5j an unreadable status refuses rather than being treated as open",
    bookingBlock(null)?.code === "PRACTICE_STATUS_UNREADABLE");
  // ⚠ THE FOUR ARE NAMED HERE, NOT ITERATED FROM THE ARRAY UNDER TEST. The first version of this line
  // read `NON_BOOKING_STATUSES.every(...)`, and the deliberate break that DELETED "ARCHIVED" from that
  // very array left it green -- a list checking itself agrees with itself however wrong it is.
  ok("5k ACTIVE and ONBOARDING are bookable; archived, suspended, closing and closed are not",
    bookingBlock("ACTIVE") === null && bookingBlock("ONBOARDING") === null
    && bookingBlock("ARCHIVED") !== null && bookingBlock("SUSPENDED") !== null
    && bookingBlock("CLOSING") !== null && bookingBlock("CLOSED") !== null,
    NON_BOOKING_STATUSES.join(","));

  // ⚠ EVERY WRITE PATH GOES THROUGH THE ONE CHECK. Two files insert into practice_appointment and both
  // call checkPlacement first; a third one appearing is the way this refusal gets bypassed.
  const inserters = ["scheduling.ts", "booking-rules.ts", "registration.ts", "patients.ts", "calendar.ts",
    "hospital-booking.ts", "operations.ts", "follow-ups.ts", "tasks.ts"]
    .filter(f => {
      try { return readFileSync(join(REPO, "src/lib/practice", f), "utf8").includes(`from("practice_appointment").insert(`); }
      catch { return false; }
    });
  ok("5l only two files put an appointment into a diary",
    inserters.sort().join(",") === "booking-rules.ts,scheduling.ts", inserters.join(","));
  ok("5m and both of them consult the practice's status first",
    inserters.every(f => readFileSync(join(REPO, "src/lib/practice", f), "utf8").includes("bookingBlock")
      || readFileSync(join(REPO, "src/lib/practice", f), "utf8").includes("checkPlacement")));
  ok("5l-control the scanner can see an insert that IS there",
    readFileSync(join(REPO, "src/lib/practice/scheduling.ts"), "utf8").includes(`from("practice_appointment").insert(`));

  // ══ 6. APPEND ONLY, AT THE DATABASE ══════════════════════════════════════════════════════════════
  section("6. append-only, enforced by the database");

  const anyRow = (await myTransitions(ws))[0];
  const upTr = await admin.from("practice_lifecycle_transition").update({ reason: "edited" }).eq("id", anyRow.id);
  ok("6a UPDATE is refused on a lifecycle transition",
    !!upTr.error && /append only/i.test(upTr.error.message), upTr.error?.message ?? "NOT REFUSED");
  const delTr = await admin.from("practice_lifecycle_transition").delete().eq("id", anyRow.id);
  ok("6b DELETE is refused on a lifecycle transition",
    !!delTr.error && /append only/i.test(delTr.error.message), delTr.error?.message ?? "NOT REFUSED");
  ok("6a-control the row is still there afterwards, so the refusal is real rather than a lost error",
    !!(await admin.from("practice_lifecycle_transition").select("id").eq("id", anyRow.id).maybeSingle()).data);

  const probeAudit = await admin.from("practice_audit_event").insert({
    workspace_id: ws, actor_id: OWNER, event_type: "practice.harness_probe", source: "harness",
    payload: { run: RUN }, correlation_id: CORR,
  }).select("id").single();
  ok("6c-control an INSERT into the audit trail still works, so 6d and 6e are not `the table is unwritable`",
    !probeAudit.error && !!probeAudit.data, probeAudit.error?.message ?? "");
  const upAudit = await admin.from("practice_audit_event").update({ source: "edited" }).eq("id", probeAudit.data?.id);
  ok("6d UPDATE is refused on the audit trail",
    !!upAudit.error && /append only/i.test(upAudit.error.message), upAudit.error?.message ?? "NOT REFUSED");
  const delAudit = await admin.from("practice_audit_event").delete().eq("id", probeAudit.data?.id);
  ok("6e ⚠ DELETE is refused on the audit trail -- s7's `deletion events are never removable` is now true",
    !!delAudit.error && /append only/i.test(delAudit.error.message), delAudit.error?.message ?? "NOT REFUSED");

  const insTr = await admin.from("practice_lifecycle_transition").insert({
    workspace_id: ws, from_status: "ACTIVE", to_status: "ACTIVE",
    reason: because("insert control"), actor_kind: "system",
  }).select("id").single();
  ok("6b-control an INSERT into the transition log still works", !insTr.error && !!insTr.data,
    insTr.error?.message ?? "");

  const noReasonRow = await admin.from("practice_lifecycle_transition").insert({
    workspace_id: ws, from_status: "ACTIVE", to_status: "ARCHIVED", actor_kind: "system",
  }).select("id").single();
  ok("6f the database itself refuses a transition with no reason",
    !!noReasonRow.error, noReasonRow.error?.message ?? "ACCEPTED");

  // ══ 7. THE WHOLE-PRACTICE EXPORT ═════════════════════════════════════════════════════════════════
  section("7. the whole-practice export");

  const noExport = await exportPractice(admin, ctxWith(["practice.lifecycle.view"]), { correlationId: CORR });
  ok("7a export is refused without data.export", !noExport.ok && noExport.code === "FORBIDDEN",
    noExport.ok ? "ALLOWED" : noExport.code);

  const { count: accessBefore } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws).eq("subject_kind", "export");
  const exported = await exportPractice(admin, OWNER_CTX, { correlationId: CORR });
  ok("7b-control the owner CAN export, so 7a is not vacuous", exported.ok === true,
    exported.ok ? "" : `${exported.code}: ${exported.message}`);

  if (exported.ok) {
    const file = exported.data as any;
    ok("7c it declares which formats it produces and which it does not",
      file.export.formats.produced.join(",") === "json"
      && file.export.formats.notBuilt.sort().join(",") === "csv,pdf,zip",
      JSON.stringify(file.export.formats));
    // Repointed 2026-08-16: the billing store shipped (migs 303-304) and the export now carries it.
    // The old pin ("declared unavailable") was made false by the PAY arc -- exactly the situation a
    // repoint-with-document exists for.
    ok("7d ⚠ billing is IN the export: twelve tables in the manifest, the counter deliberately out",
      file.export.billing.available === true
      && ["practice_charge", "practice_invoice", "practice_invoice_item", "practice_payment",
        "practice_receipt", "practice_settlement"].every((t: string) =>
        file.export.sections.some((s: any) => s.table === t))
      && !file.export.sections.some((s: any) => s.table === "practice_billing_number_counter")
      && file.export.billing.note.includes("counter"));
    ok("7e every section it names is in the manifest with a row count",
      file.export.sections.length >= EXPORT_SECTIONS.length
      && file.export.sections.every((s: any) => s.error !== null || typeof s.rows === "number"));
    ok("7f the patient section really read the table, and matches a live count",
      Array.isArray(file.patients) && file.patients.length === 1, String(file.patients?.length));
    ok("7g the appointments it exports are the appointments in the diary",
      Array.isArray(file.appointments) && file.appointments.length === 2, String(file.appointments?.length));
    ok("7h and the lifecycle history travels with it",
      Array.isArray(file.lifecycleTransitions) && file.lifecycleTransitions.length > 0);
  }

  const { count: accessAfter } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", ws).eq("subject_kind", "export");
  ok("7i the export is in the access log", (accessAfter ?? 0) === (accessBefore ?? 0) + 1,
    `${accessBefore} -> ${accessAfter}`);
  const { count: exportAudits } = await admin.from("practice_audit_event")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", ws).eq("event_type", "practice.practice_exported");
  ok("7j and in the audit trail", (exportAudits ?? 0) >= 1, String(exportAudits));

  const blindExport = await exportPractice(adminWithUnreadable(admin, "practice_patient"), OWNER_CTX, { correlationId: CORR });
  ok("7k ⚠ an unreadable section is NAMED, not emitted as an empty array",
    blindExport.ok
    && (blindExport.data as any).export.complete === false
    && (blindExport.data as any).patients === null
    && (blindExport.data as any).export.unreadableSections.some((u: any) => u.key === "patients"));
  ok("7k-control a complete export says so", exported.ok && (exported.data as any).export.complete === true);

  // ══ 8. THE NINETEENTH SETUP MODULE, AND NAVIGATION UNTOUCHED ═════════════════════════════════════
  section("8. the setup module and the sidebar");

  const setup = await practiceSetup(admin, OWNER_CTX);
  const card = setup.modules.find(m => m.key === "lifecycle");
  // Repointed 2026-08-16: this pinned the Setup catalogue's TOTAL (19) and went quietly red when
  // later features grew it -- the pinned-count class again. The subject was always "the lifecycle
  // card exists in Setup", so that is what is pinned now; the catalogue's size belongs to no
  // assertion in this file.
  ok("8a Practice Lifecycle is a Setup module", !!card, String(setup.modules.length));
  ok("8b it is in `administration`, because there is no `Security & Data` domain to put it in",
    card?.domain === "administration", card?.domain);
  ok("8c it points at the page that exists and is gated on a real capability",
    card?.href === "/practice/setup/lifecycle" && card?.capability === "practice.lifecycle.view");
  ok("8d its detail is the practice's own state rather than a fixed sentence",
    card?.detail === "active", String(card?.detail));

  // ⚠ THE SIDEBAR IS UNTOUCHED. The comp draws a grouped ~20-item three-section navigation; four specs'
  // comps have now drawn a different one and all four were correctly ignored.
  ok("8e no lifecycle entry was added to the navigation catalogue",
    !PRACTICE_NAV.some(n => n.href.includes("lifecycle")),
    PRACTICE_NAV.filter(n => n.href.includes("lifecycle")).map(n => n.href).join(","));
  ok("8e-control the catalogue is populated, so 8e is not passing over an empty list",
    PRACTICE_NAV.length > 9, String(PRACTICE_NAV.length));

  // ── Leave the fixture where the next run expects it. ───────────────────────────────────────────
  await reset(ws);

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`   - ${f}`);
  if (fails.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
