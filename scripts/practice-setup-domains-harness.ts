/**
 * CPR-V5-008 -- Practice Setup workspace: three domains, progress, readiness, dependencies. No migration
 * of its own; gated on 240 because the availability parts read migration 240's columns.
 *
 * WHAT IT PROVES:
 *   1. THE THREE DOMAINS PARTITION THE SEVENTEEN EXACTLY, and by NAME rather than by count -- a count
 *      is equally true of a module filed in the wrong domain.
 *   2. s7's PROGRESS IS COUNTS AND DENOMINATORS. No percentage anywhere in the payload, and every
 *      domain's `done` equals the modules actually configured in it.
 *   3. THE PROGRESS MOVES. Configuring something changes the figure -- the whole objection to a "72%"
 *      that sits still. Each domain is moved in turn and the change is asserted to be exactly one.
 *   4. s8's DEPENDENCY RULES ARE EVALUATED, not printed. Each one names what is still missing, and
 *      each names something DIFFERENT once that thing exists.
 *   5. s7's READINESS INDICATORS MOVE, except the one that cannot -- and that one carries the reason
 *      and the phase rather than an unexplained empty circle.
 *   6. THE AVAILABILITY MODULE'S PARTS ARE REAL. Six parts, exactly one not built, and the one that is
 *      not built is excluded from the denominator so the fraction can close.
 *   7. A FAILED READ IS NEVER A ZERO. With one table unreadable, its module is `unreadable` -- not
 *      "needs attention", not "configured" -- it is counted as neither, the legend still sums, and the
 *      control proves the same module reads normally when the table answers.
 *   8. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-setup-domains-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { practiceSetup, SETUP_DOMAINS } from "../src/lib/practice/setup";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ed001";
const OTHER = "00000000-0000-4000-8000-0000000ed002";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-dom-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-dom",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-dom", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_session_appointment_type").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
      await admin.from("practice_registration_template").delete().eq("workspace_id", w.id);
      await admin.from("practice_message_channel").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
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

async function main() {
  console.log("\n=== CPR-V5-008 PRACTICE SETUP: THREE DOMAINS ===\n");

  const probe = await admin.from("practice_availability_template").select("booking_mode").limit(1);
  const probeJoin = await admin.from("practice_session_appointment_type").select("id").limit(1);
  if (probe.error || probeJoin.error) {
    console.error("\n  run 240\n");
    console.error(`  (${probe.error?.message ?? probeJoin.error?.message})`);
    process.exit(1);
  }

  await cleanup();

  const wsA = await provision(OWNER, "Dr Domain A", "a");
  const wsB = await provision(OTHER, "Dr Domain B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");
  const A = ctxA.ctx, B = ctxB.ctx;

  type Setup = Awaited<ReturnType<typeof practiceSetup>>;
  const dom = (s: Setup, k: string) => s.domains.find(d => d.key === k)!;
  const mod = (s: Setup, k: string) => s.modules.find(m => m.key === k)!;
  const dep = (s: Setup, k: string) => s.dependencies.find(d => d.key === k)!;
  const rdy = (s: Setup, k: string) => s.readiness.find(r => r.key === k)!;
  const part = (s: Setup, k: string) => s.availability.parts.find(p => p.key === k)!;

  const first = await practiceSetup(admin, A);

  // ══ 1. THE PARTITION, BY NAME ═════════════════════════════════════════════════════════════════
  ok("1a there are exactly three domains, in CPR-V5-008's order",
    first.domains.map(d => d.key).join(",") === "foundation,operations,administration",
    first.domains.map(d => d.key).join(","));
  ok("1b s3's Practice Foundation holds exactly the four modules it names",
    dom(first, "foundation").moduleKeys.slice().sort().join(",") === "identifiers,letterhead,locations,profile",
    dom(first, "foundation").moduleKeys.join(","));
  // ⚠ EACH DOMAIN HAS GAINED ONE MODULE SINCE CPR-V5-008, AND THE ADDITIONS ARE NAMED RATHER THAN THE
  // ASSERTION BEING LOOSENED. Module 18 Clinical Parameters (CPR-LCP-001 s10.1) is operations; module 19
  // Practice Lifecycle (CPR-LIFE-001 s8) is administration -- s8's breadcrumb names a "Security & Data"
  // domain that does not exist here, and inventing a fourth domain on the strength of a breadcrumb would
  // be a restructure of a frozen surface. An exact list is kept so a module cannot drift between domains
  // unnoticed, which is the whole point of 1b to 1e.
  // Repointed 2026-08-16: investigations + treatment lists (275) and the procedure catalogue (297's
  // settings screen) each arrived holding a document. The list stays exact so a module cannot drift
  // between domains unnoticed.
  ok("1c s4's Practice Operations holds its named modules plus investigations, treatments and procedures",
    dom(first, "operations").moduleKeys.slice().sort().join(",")
    === "appointment_types,availability,booking_rules,clinical_parameters,investigations,notifications,procedures,registration,self_booking,treatment_lists,workflows",
    dom(first, "operations").moduleKeys.join(","));
  ok("1d s5's Practice Administration holds the six it names, plus practice lifecycle",
    dom(first, "administration").moduleKeys.slice().sort().join(",")
    === "ai,analytics,billing,import_export,integrations,lifecycle,team",
    dom(first, "administration").moduleKeys.join(","));
  ok("1e every module is in exactly one domain and none is left out",
    first.modules.length === first.domains.reduce((n, d) => n + d.moduleKeys.length, 0)
    && new Set(first.domains.flatMap(d => d.moduleKeys)).size === first.modules.length,
    `${first.modules.length} vs ${first.domains.reduce((n, d) => n + d.moduleKeys.length, 0)}`);
  ok("1f the domain catalogue and the computed domains agree key for key",
    SETUP_DOMAINS.map(d => d.key).join(",") === first.domains.map(d => d.key).join(","));
  // s4 makes availability the domain's PRIMARY module, so the three it subsumes are not drawn beside it.
  ok("1g the operations domain draws eight cards -- the three availability subsumptions stay folded",
    dom(first, "operations").cardKeys.slice().sort().join(",")
    === "availability,clinical_parameters,investigations,notifications,procedures,registration,treatment_lists,workflows",
    dom(first, "operations").cardKeys.join(","));

  // ══ 2. COUNTS, NEVER PERCENTAGES ══════════════════════════════════════════════════════════════
  ok("2a no percentage anywhere in the payload",
    !/percent|"\d+%"|\d+\s?%/i.test(JSON.stringify(first)), "found a percentage");
  for (const d of first.domains) {
    const configuredHere = first.modules.filter(m => d.moduleKeys.includes(m.key) && m.state === "configured").length;
    const countableHere = first.modules.filter(m => d.moduleKeys.includes(m.key) && m.state !== "not_built").length;
    ok(`2b ${d.key}: done equals the modules actually configured in it`,
      d.progress.done === configuredHere, `${d.progress.done} vs ${configuredHere}`);
    ok(`2c ${d.key}: the denominator excludes what is not built`,
      d.progress.of === countableHere, `${d.progress.of} vs ${countableHere}`);
  }
  ok("2d the domain denominators sum to the page's own denominator",
    first.domains.reduce((n, d) => n + d.progress.of, 0) === first.progress.of,
    `${first.domains.reduce((n, d) => n + d.progress.of, 0)} vs ${first.progress.of}`);
  ok("2e and the domain numerators sum to the page's own numerator",
    first.domains.reduce((n, d) => n + d.progress.done, 0) === first.progress.done,
    `${first.domains.reduce((n, d) => n + d.progress.done, 0)} vs ${first.progress.done}`);

  // ══ 3. THE FIGURE MOVES ═══════════════════════════════════════════════════════════════════════
  //
  // A fresh practice has no location, no letterhead and no institution -- so Foundation starts short of
  // its own denominator, and each of the three moves it by exactly one.
  ok("3a a fresh practice's Foundation is not complete",
    dom(first, "foundation").state !== "complete" && dom(first, "foundation").progress.done < dom(first, "foundation").progress.of,
    JSON.stringify(dom(first, "foundation").progress));
  const foundationBefore = dom(first, "foundation").progress.done;

  const { data: locRow, error: locErr } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "TMR International Hospital", type: "hospital", active: true })
    .select("id").single();
  if (locErr || !locRow) throw new Error(`location fixture failed: ${locErr?.message}`);
  const locId = locRow.id as string;

  const withLoc = await practiceSetup(admin, A);
  ok("3b adding a location moves Foundation by exactly one",
    dom(withLoc, "foundation").progress.done === foundationBefore + 1,
    `${dom(withLoc, "foundation").progress.done} vs ${foundationBefore}`);
  ok("3c and it is the LOCATIONS module that turned, not some other one",
    mod(withLoc, "locations").state === "configured" && mod(first, "locations").state === "needs_attention",
    `${mod(first, "locations").state} -> ${mod(withLoc, "locations").state}`);

  await admin.from("practice_configuration").update({ letterhead_name: "Dr Domain A Clinic" })
    .eq("workspace_id", wsA).eq("is_effective", true);
  await admin.from("practice_facility")
    .insert({ workspace_id: wsA, name: "Mulago Hospital", facility_type: "hospital", active: true });
  const foundationDone = await practiceSetup(admin, A);
  ok("3d with a letterhead and an institution, Foundation is COMPLETE",
    dom(foundationDone, "foundation").state === "complete"
    && dom(foundationDone, "foundation").progress.done === dom(foundationDone, "foundation").progress.of,
    `${dom(foundationDone, "foundation").state} ${JSON.stringify(dom(foundationDone, "foundation").progress)}`);
  ok("3e and the other two domains are UNTOUCHED by that, so 3d is not measuring the whole page",
    dom(foundationDone, "operations").progress.done === dom(first, "operations").progress.done
    && dom(foundationDone, "administration").progress.done === dom(first, "administration").progress.done,
    `${dom(foundationDone, "operations").progress.done} / ${dom(foundationDone, "administration").progress.done}`);

  // s7's FOURTH STATUS. A domain whose dependency is unsatisfied is not merely partly done -- it is
  // stuck, and NEEDS ATTENTION rather than IN PROGRESS. Operations is the only domain that can reach it
  // here, because availability is the only countable module anything depends on.
  ok("3f a domain with an unsatisfied dependency is NEEDS ATTENTION, not IN PROGRESS",
    dom(first, "operations").state === "needs_attention"
    && dom(first, "operations").blockedBy.join() === "availability_needs_locations",
    `${dom(first, "operations").state} ${JSON.stringify(dom(first, "operations").blockedBy)}`);
  ok("3g CONTROL: satisfying the dependency drops it to IN PROGRESS, so 3f is not just the default",
    dom(withLoc, "operations").state === "in_progress"
    && dom(withLoc, "operations").blockedBy.length === 0,
    `${dom(withLoc, "operations").state} ${JSON.stringify(dom(withLoc, "operations").blockedBy)}`);
  // THE INVARIANT BEHIND THE CHIP. Whatever else a state means, COMPLETE must never appear over a
  // fraction that is short -- that is the one combination a practitioner would act on and be wrong.
  const completeButShort = [first, withLoc].flatMap(s =>
    s.domains.filter(d => d.state === "complete" && d.progress.done < d.progress.of).map(d => d.key));
  ok("3h no domain ever reads COMPLETE over a fraction that is short",
    completeButShort.length === 0, JSON.stringify(completeButShort));

  // ══ 4. DEPENDENCY RULES ═══════════════════════════════════════════════════════════════════════
  ok("4a with no location, s8's availability dependency named the missing location",
    dep(first, "availability_needs_locations").unmet.join() === "an open location",
    JSON.stringify(dep(first, "availability_needs_locations").unmet));
  ok("4b CONTROL: with a location it is met, so 4a is evaluated rather than printed",
    dep(withLoc, "availability_needs_locations").unmet.length === 0,
    JSON.stringify(dep(withLoc, "availability_needs_locations").unmet));

  const bookingDepBefore = dep(foundationDone, "booking_needs_availability_types_registration");
  ok("4c the patient-booking dependency names all three of its missing prerequisites",
    bookingDepBefore.unmet.length === 3
    && bookingDepBefore.unmet.some(u => /regular week/.test(u))
    && bookingDepBefore.unmet.some(u => /appointment type/.test(u))
    && bookingDepBefore.unmet.some(u => /registration form/.test(u)),
    JSON.stringify(bookingDepBefore.unmet));
  ok("4d the self-booking dependency leads with the part that is NOT BUILT, so it does not read as a form somebody forgot",
    dep(foundationDone, "self_booking_needs_access_notifications_registration").unmet[0] === "patient booking access, which is not built",
    JSON.stringify(dep(foundationDone, "self_booking_needs_access_notifications_registration").unmet));

  // ══ 6. THE AVAILABILITY MODULE'S PARTS ════════════════════════════════════════════════════════
  ok("6a seven parts, named (booking_address joined with mig 254's arc)",
    foundationDone.availability.parts.map(p => p.key).join(",")
    === "locations,sessions,appointment_types,capacity,booking_rules,booking_address,booking_access",
    foundationDone.availability.parts.map(p => p.key).join(","));
  ok("6b exactly one of them is not built, and it is patient booking access",
    foundationDone.availability.parts.filter(p => p.notBuilt).map(p => p.key).join(",") === "booking_access",
    foundationDone.availability.parts.filter(p => p.notBuilt).map(p => p.key).join(","));
  ok("6c and its reason names the phase",
    /Phase 4/.test(part(foundationDone, "booking_access").notBuilt ?? ""),
    part(foundationDone, "booking_access").notBuilt ?? "null");
  ok("6d THE DENOMINATOR EXCLUDES IT, so the fraction can actually close",
    foundationDone.availability.progress.of === 6, String(foundationDone.availability.progress.of));
  ok("6e with a location but no session, one part of five is done",
    foundationDone.availability.progress.done === 1
    && part(foundationDone, "locations").done === true && part(foundationDone, "sessions").done === false,
    JSON.stringify(foundationDone.availability.progress));

  // ---- Add a real session with a real appointment type, through the engine. -----------------------
  const made = await saveSession(admin, A, {
    weekday: 2, startsMinute: 540, endsMinute: 780, locationId: locId,
    sessionName: "Tuesday Outpatient Clinic", activityType: "outpatient_clinic",
    appointmentMinutes: 30, bookingMode: "internal", appointmentTypes: ["new_consultation"],
    actorId: OWNER, correlationId: "harness-dom",
  });
  if (!made.ok) throw new Error(`session fixture refused: ${made.code} ${made.message}`);

  const withSession = await practiceSetup(admin, A);
  ok("6f adding one session with a type and a derivable capacity moves three parts at once",
    part(withSession, "sessions").done === true
    && part(withSession, "appointment_types").done === true
    && part(withSession, "capacity").done === true,
    JSON.stringify(withSession.availability.parts.map(p => [p.key, p.done])));
  ok("6g so the parts figure goes from 1 to 4 of 6",
    withSession.availability.progress.done === 4 && withSession.availability.progress.of === 6,
    JSON.stringify(withSession.availability.progress));
  ok("6h and the appointment-types part NAMES how many are offered, not how many exist",
    /1 of 7 offered/.test(part(withSession, "appointment_types").detail),
    part(withSession, "appointment_types").detail);

  // ══ 5. READINESS ══════════════════════════════════════════════════════════════════════════════
  ok("5a Foundation complete is met once the foundation domain is",
    rdy(foundationDone, "foundation_complete").met === true
    && rdy(first, "foundation_complete").met === false,
    `${rdy(first, "foundation_complete").met} -> ${rdy(foundationDone, "foundation_complete").met}`);
  ok("5b Operations ready is NOT met on a week with no published registration form",
    rdy(withSession, "operations_ready").met === false,
    JSON.stringify(rdy(withSession, "operations_ready")));

  const { error: regErr } = await admin.from("practice_registration_template")
    .insert({ workspace_id: wsA, name: "Standard registration", status: "published" });
  if (regErr) throw new Error(`registration fixture failed: ${regErr.message}`);
  const opsReady = await practiceSetup(admin, A);
  ok("5c CONTROL: publishing one turns it, so 5b is about the form and not about the indicator being dead",
    rdy(opsReady, "operations_ready").met === true, JSON.stringify(rdy(opsReady, "operations_ready")));

  ok("5d Patient booking published can NEVER be met in this build",
    rdy(opsReady, "patient_booking_published").met === false);
  ok("5e and it says why, and names the phase, rather than sitting as an unexplained empty circle",
    /Phase 4/.test(rdy(opsReady, "patient_booking_published").blockedReason ?? ""),
    rdy(opsReady, "patient_booking_published").blockedReason ?? "null");
  ok("5f no other readiness indicator carries a blocked reason -- the exception is one, not a habit",
    opsReady.readiness.filter(r => r.blockedReason !== null).map(r => r.key).join(",") === "patient_booking_published",
    opsReady.readiness.filter(r => r.blockedReason !== null).map(r => r.key).join(","));
  ok("5g Practice ready is not met while any domain is short",
    rdy(opsReady, "practice_ready").met === false
    && opsReady.domains.some(d => d.state !== "complete"),
    JSON.stringify(opsReady.domains.map(d => [d.key, d.state])));

  // ══ 7. A FAILED READ IS NEVER A ZERO ══════════════════════════════════════════════════════════
  //
  // practice_facility is the institutions behind the Hospital Identifiers module, and practice A HAS
  // one -- so the readable run says "configured". That is what makes this non-vacuous: the unreadable
  // run must not say "configured" and must not say "needs attention" either.
  ok("7a CONTROL: with the table readable, Hospital Identifiers is CONFIGURED",
    mod(opsReady, "identifiers").state === "configured",
    mod(opsReady, "identifiers").state);

  const blind = await practiceSetup(adminWithUnreadable(admin, "practice_facility"), A);
  ok("7b with the table unreadable it is UNREADABLE -- neither configured nor needing attention",
    mod(blind, "identifiers").state === "unreadable", mod(blind, "identifiers").state);
  ok("7c and the detail says so rather than showing a nought",
    /could not be read/.test(mod(blind, "identifiers").detail ?? ""),
    mod(blind, "identifiers").detail ?? "null");
  ok("7d it is not counted as done",
    blind.checklist.find(i => i.key === "identifiers")?.done === false
    && blind.checklist.find(i => i.key === "identifiers")?.unreadable === true,
    JSON.stringify(blind.checklist.find(i => i.key === "identifiers")));
  ok("7e the numerator drops by exactly one and the DENOMINATOR DOES NOT -- the area still exists",
    blind.progress.done === opsReady.progress.done - 1 && blind.progress.of === opsReady.progress.of,
    `${blind.progress.done}/${blind.progress.of} vs ${opsReady.progress.done}/${opsReady.progress.of}`);
  ok("7f its domain goes to `unreadable` rather than reporting partial progress as fact",
    dom(blind, "foundation").state === "unreadable", dom(blind, "foundation").state);
  ok("7g the legend gains the category and STILL sums to the total",
    blind.legend.some(l => l.key === "unreadable" && l.count === 1)
    && blind.legend.reduce((n, l) => n + l.count, 0) === blind.progress.total,
    JSON.stringify(blind.legend) + ` total=${blind.progress.total}`);
  ok("7h and a warning names which part of the page is a shrug",
    blind.warnings.some(w => w.key === "unreadable_identifiers"),
    JSON.stringify(blind.warnings.map(w => w.key)));
  ok("7i the readiness indicator over that domain is INDETERMINATE, not unmet",
    rdy(blind, "foundation_complete").indeterminate === true && rdy(opsReady, "foundation_complete").indeterminate === false,
    JSON.stringify(rdy(blind, "foundation_complete")));

  // ══ 8. WARNINGS MOVE WITH THE PRACTICE ════════════════════════════════════════════════════════
  ok("8a a practice with no location is warned about it, as a blocker",
    first.warnings.some(w => w.key === "no_locations" && w.severity === "blocker"),
    JSON.stringify(first.warnings.map(w => w.key)));
  ok("8b once there is a location that warning is gone and a different one takes its place",
    !withLoc.warnings.some(w => w.key === "no_locations")
    && withLoc.warnings.some(w => w.key === "no_sessions"),
    JSON.stringify(withLoc.warnings.map(w => w.key)));
  ok("8c and once there is a session, that one goes too",
    !withSession.warnings.some(w => w.key === "no_sessions"),
    JSON.stringify(withSession.warnings.map(w => w.key)));

  // ══ 9. CONTEXTUAL QUICK ACTIONS ═══════════════════════════════════════════════════════════════
  ok("9a a practice with nothing set up is offered the FIRST-TIME wording",
    first.quickActions.some(a => a.label === "Add your first location")
    && first.quickActions.some(a => a.label === "Build your regular week"),
    JSON.stringify(first.quickActions.map(a => a.label)));
  ok("9b a practice with a week and a location is offered the REVIEW wording instead",
    withSession.quickActions.some(a => a.label === "Add a new clinic")
    && withSession.quickActions.some(a => a.label === "Review your regular week"),
    JSON.stringify(withSession.quickActions.map(a => a.label)));
  ok("9c the letterhead action disappears once there is a letterhead",
    first.quickActions.some(a => a.key === "letterhead")
    && !foundationDone.quickActions.some(a => a.key === "letterhead"),
    JSON.stringify(foundationDone.quickActions.map(a => a.key)));

  // ══ 10. CROSS-WORKSPACE ISOLATION ═════════════════════════════════════════════════════════════
  const b = await practiceSetup(admin, B);
  // NAMED, NOT COUNTED. A fresh practice's PROFILE is already configured -- provisioning writes the
  // name, the timezone and the country -- so "done === 0" would be a false claim about isolation and
  // an assertion that fails for the wrong reason. The three that our fixtures configured are the
  // three that must still be untouched here.
  ok("10a practice B's Foundation is not complete, and the three we configured are untouched there",
    dom(b, "foundation").state !== "complete"
    && mod(b, "locations").state === "needs_attention"
    && mod(b, "letterhead").state === "needs_attention"
    && mod(b, "identifiers").state === "needs_attention",
    JSON.stringify([mod(b, "locations").state, mod(b, "letterhead").state, mod(b, "identifiers").state]));
  ok("10b nor does it see our session",
    part(b, "sessions").done === false, JSON.stringify(part(b, "sessions")));
  // ⚠ THIS ASSERTED `operations_ready === false` AND A PROBE SHOWED IT PROVED NOTHING. That indicator is
  // a conjunction of three things, and practice B is missing the other two anyway -- so unscoping the
  // registration query entirely, which is the leak this line is aimed at, left it green. The claim is
  // about the registration module, so it is now made about the registration module.
  ok("10c nor our registration form",
    mod(b, "registration").state === "needs_attention"
    && rdy(b, "operations_ready").met === false,
    `${mod(b, "registration").state} ${JSON.stringify(rdy(b, "operations_ready"))}`);
  ok("10d CONTROL: practice A has all of them configured, so 10a-c are not vacuous",
    dom(opsReady, "foundation").state === "complete"
    && mod(opsReady, "locations").state === "configured"
    && mod(opsReady, "letterhead").state === "configured"
    && mod(opsReady, "identifiers").state === "configured"
    && mod(opsReady, "registration").state === "configured"
    && part(opsReady, "sessions").done === true
    && rdy(opsReady, "operations_ready").met === true);

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
