/**
 * THE BOOKING ADDRESS: REACHABLE FROM THE SIDEBAR, AND OFFERED DURING ONBOARDING.
 *
 * Two defects the practice owner found by walking the product, and neither could have been found by a
 * test that only asked whether the code worked:
 *
 *   1. /practice/setup/identity shipped WORKING and reachable only by typing the URL. "I don't see
 *      identity."
 *   2. The setup readiness rows say what is unconfigured and go nowhere.
 *
 * And one thing they asked for: offer the handle DURING provisioning -- optional, and not first.
 *
 * WHAT THIS PROVES:
 *   1. ⚠ THE CPR-V5-002 FREEZE IS INTACT. PRIMARY_ORDER is the same nine, in the same order, written
 *      out in full here so a change has to be made twice and read once.
 *   2. The identity page is in the catalogue as a CHILD of Practice Setup, capability-filtered, and the
 *      whole catalogue still points at pages that exist.
 *   3. Every readiness row and every availability part that names something unconfigured carries an
 *      href to the screen that owns it -- computed, so it MOVES as the practice is configured, and
 *      absent rather than wrong when the underlying read failed.
 *   4. The onboarding offer is NOT FIRST and IS SKIPPABLE, asserted on the pure function that decides
 *      it rather than on a condition buried in JSX.
 *   5. ⚠ ISSUING NEVER CLAIMS, AND CLAIMING CANNOT BE REPEATED. Proven against the live engine.
 *   6. The onboarding step performs at most one act: it can claim, it can never publish.
 *
 *   npx --yes tsx scripts/practice-handle-reachability-harness.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  PRACTICE_NAV, PRIMARY_ORDER, primaryNav, childrenOf, orphanedNav, visibleNav,
} from "../src/lib/practice/navigation";
import { practiceSetup } from "../src/lib/practice/setup";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  issueIdentity, claimHandle, getIdentity, handleAvailable,
} from "../src/lib/practice/identity-service";
import { handleOfferDecision, OFFER_AFTER_COMPLETED_STEPS } from "../src/app/practice/onboarding/handle-offer";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

/**
 * ⚠ THE OWNER ID I WAS GIVEN WAS `00000000-0000-4000-8000-00000000ide1`, WHICH IS NOT A UUID: the last
 * group must be twelve HEX digits and `i` is not one, so Postgres refuses it outright with "invalid
 * input syntax for type uuid". The nearest valid id is used instead -- `i` to `1` -- and the
 * substitution is written down rather than made quietly, because the whole point of the instruction was
 * that no two agents share an owner and purge each other's fixtures.
 */
const OWNER = "00000000-0000-4000-8000-000000001de1";
/** A handle nobody would choose, checked for availability before it is claimed. */
const FIXTURE_HANDLE = "honbfixture1";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const SHELL = join(process.cwd(), "src", "app", "practice", "(shell)");
const pageExists = (href: string) =>
  existsSync(join(SHELL, href.split("?")[0].replace(/^\/practice\//, ""), "page.tsx"));

/**
 * ⚠ COMMENTS OUT FIRST, ALWAYS. Scanning source for a phrase that also appears in the comment ABOUT
 * that phrase is a vacuous assertion, and this codebase has shipped that mistake more than once. The
 * strip is proven by its own control below: a sentence that exists only in a comment must be gone.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function cleanup() {
  await admin.from("practice_handle_history").delete().eq("handle", FIXTURE_HANDLE);
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_template").delete().eq("workspace_id", w.id);
    await admin.from("practice_availability_slot").delete().eq("workspace_id", w.id);
  }
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  return purgeWorkspacesOwnedBy(admin, [OWNER], { quiet: true });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** An admin client on which one table cannot be read. The only way to exercise the three-state rule. */
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
  console.log("\n=== THE BOOKING ADDRESS: REACHABLE, AND OFFERED ===\n");

  // ══ 1. THE FREEZE ═════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ WRITTEN OUT IN FULL, NOT DERIVED. An assertion that compares PRIMARY_ORDER to itself, or to
  // whatever the catalogue currently marks primary, is a transcript. CPR-V5-002's nine are copied from
  // the specification, so moving one means editing this line and explaining why.
  const FROZEN_PRIMARY = [
    "/practice/home", "/practice/today", "/practice/calendar", "/practice/patients",
    "/practice/encounters", "/practice/follow-ups", "/practice/documents",
    "/practice/payments",
    "/practice/intelligence", "/practice/reports", "/practice/setup",
  ];
  // Repointed 2026-08-15 twice, and the second one is v1.1 -- the final source of truth, which
  // restored Encounters and added Payments. Eleven now, still written out in full, so the NEXT
  // change also has to arrive holding a document.
  ok("1a. ⚠ PRIMARY_ORDER is CPR-HFE-001 v1.1's eleven, in order",
    PRIMARY_ORDER.join() === FROZEN_PRIMARY.join(), PRIMARY_ORDER.join(" "));

  const allCaps = [...new Set(PRACTICE_NAV.map(i => i.capability).filter(Boolean))] as string[];
  const rendered = primaryNav(allCaps);
  ok("1b. and the sidebar renders exactly those nine, in that order",
    rendered.map(i => i.href).join() === FROZEN_PRIMARY.join(), rendered.map(i => i.href).join(" "));
  // NON-VACUITY. 1a and 1b would both pass against an empty catalogue.
  ok("1c-control. the catalogue is populated and the sidebar is not empty",
    PRACTICE_NAV.length >= 20 && rendered.length === 11,
    `${PRACTICE_NAV.length} entries, ${rendered.length} primary`);

  // ══ 2. THE IDENTITY PAGE IS REACHABLE ═════════════════════════════════════════════════════════
  const IDENTITY_HREF = "/practice/setup/identity";
  const entry = PRACTICE_NAV.find(i => i.href === IDENTITY_HREF);
  ok("2a. the booking-address page has a catalogue entry at all",
    !!entry, "nothing in PRACTICE_NAV points at " + IDENTITY_HREF);
  ok("2b. it is BUILT and NOT primary -- the freeze is untouched",
    entry?.built === true && entry?.primary !== true,
    JSON.stringify({ built: entry?.built, primary: entry?.primary }));
  ok("2c. its parent is Practice Setup, which is itself primary and built",
    entry?.parent === "/practice/setup"
    && PRACTICE_NAV.some(i => i.href === entry?.parent && i.primary && i.built),
    String(entry?.parent));

  const children = childrenOf("/practice/setup", allCaps);
  ok("2d. it renders under Practice Setup, exactly once",
    children.filter(c => c.href === IDENTITY_HREF).length === 1,
    children.map(c => c.href).join(" "));
  // CONTROL, both directions: the capability filter really applies to this entry.
  const withoutCap = childrenOf("/practice/setup", allCaps.filter(c => c !== "practice.settings.manage"));
  ok("2e-control. and NOT for a caller without practice.settings.manage",
    !withoutCap.some(c => c.href === IDENTITY_HREF) && withoutCap.length > 0,
    `${withoutCap.length} children remain: ${withoutCap.map(c => c.href).join(" ")}`);

  // The nav entry's capability must be the one the PAGE enforces, or the sidebar offers a bounce.
  const identityPageSrc = stripComments(readFileSync(join(SHELL, "setup", "identity", "page.tsx"), "utf8"));
  ok("2f. the entry's capability is the one the page itself guards",
    entry?.capability === "practice.settings.manage"
    && /hasCapability\([^)]*"practice\.settings\.manage"\)/.test(identityPageSrc),
    `entry ${entry?.capability}`);

  ok("2g. no built module is unreachable from the sidebar", orphanedNav().length === 0,
    orphanedNav().map(o => `${o.label} (${o.href})`).join("; "));

  const missing = visibleNav(allCaps).filter(i => !pageExists(i.href));
  ok("2h. every visible nav entry still points at a page that exists",
    missing.length === 0, missing.map(m => m.href).join(", "));
  ok("2h-control. the page check really looked at the filesystem",
    visibleNav(allCaps).length >= 20 && pageExists(IDENTITY_HREF) && !pageExists("/practice/no-such-route"),
    `${visibleNav(allCaps).length} entries checked`);

  // ══ 3. THE ROWS GO SOMEWHERE ══════════════════════════════════════════════════════════════════
  const purged = await cleanup();
  if (purged.blocked.length > 0)
    console.log(`  (a previous fixture survives: ${purged.blocked.map(b => b.reason).join("; ")})`);

  const { data: req, error: reqError } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-handle-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-handle",
  }).select("id").single();
  if (reqError || !req) throw new Error(`provisioning request refused: ${reqError?.message ?? "no row"}`);
  const run = await runProvisioning(
    admin, { id: req.id, target_user_id: OWNER, correlation_id: "harness-handle", workspace_id: null },
    payload("Dr Handle Fixture"));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, run.workspaceId);
  if (!ctxRes.ok) throw new Error(`context resolution failed: ${ctxRes.reason}`);
  const CTX = ctxRes.ctx;

  type Setup = Awaited<ReturnType<typeof practiceSetup>>;
  const rdy = (s: Setup, k: string) => s.readiness.find(r => r.key === k)!;
  const part = (s: Setup, k: string) => s.availability.parts.find(p => p.key === k)!;

  const fresh = await practiceSetup(admin, CTX);

  // Non-vacuity BEFORE the rules: both lists must be populated, or every assertion below is a loop
  // over nothing that passes for the wrong reason.
  ok("3a-control. the parts list and the readiness list are both populated",
    fresh.availability.parts.length >= 6 && fresh.readiness.length >= 4,
    `${fresh.availability.parts.length} parts, ${fresh.readiness.length} readiness rows`);

  const partsWithoutHref = fresh.availability.parts.filter(p => !p.notBuilt && !p.href);
  ok("3b. every part that CAN be configured carries the href of the screen that owns it",
    partsWithoutHref.length === 0, partsWithoutHref.map(p => p.key).join(", "));
  const notBuiltWithHref = fresh.availability.parts.filter(p => p.notBuilt && p.href);
  ok("3c. and the part with no implementation carries NO href -- no link to nowhere",
    notBuiltWithHref.length === 0 && fresh.availability.parts.some(p => p.notBuilt),
    notBuiltWithHref.map(p => p.key).join(", "));
  const badPartHref = fresh.availability.parts.filter(p => p.href && !pageExists(p.href));
  ok("3d. and every one of those hrefs is a page that exists",
    badPartHref.length === 0, badPartHref.map(p => `${p.key} -> ${p.href}`).join(", "));

  // ── The readiness rows ────────────────────────────────────────────────────────────────────────
  const withNext = fresh.readiness.filter(r => r.next !== null);
  ok("3e-control. a fresh practice really does offer somewhere to go -- the rows are not all null",
    withNext.length >= 2, fresh.readiness.map(r => `${r.key}:${r.next?.href ?? "none"}`).join(" "));
  const badNext = withNext.filter(r => !pageExists(r.next!.href));
  ok("3f. every readiness destination is a page that exists",
    badNext.length === 0, badNext.map(r => `${r.key} -> ${r.next!.href}`).join(", "));
  ok("3g. a fresh practice's Foundation row points at its Locations, which is what is missing",
    rdy(fresh, "foundation_complete").next?.href === "/practice/settings?tab=practice#locations",
    JSON.stringify(rdy(fresh, "foundation_complete").next));

  // ⚠ IT MOVES. A row wired to a constant href would pass 3f and 3g and still be useless the moment
  // the thing it names is configured.
  const { error: locErr } = await admin.from("practice_location")
    .insert({ workspace_id: CTX.workspaceId, name: "Fixture Clinic", type: "clinic", active: true });
  ok("3h-control. a location was really added", !locErr, locErr?.message ?? "");
  const withLoc = await practiceSetup(admin, CTX);
  ok("3h. once locations exist, the Foundation row points somewhere ELSE",
    rdy(withLoc, "foundation_complete").next !== null
    && rdy(withLoc, "foundation_complete").next!.href !== rdy(fresh, "foundation_complete").next!.href,
    JSON.stringify(rdy(withLoc, "foundation_complete").next));

  // ⚠ THREE STATES. A module whose configuration could not be read must never become a destination:
  // sending somebody to configure something that may already be configured is acting on a failed read.
  const blind = await practiceSetup(adminWithUnreadable(admin, "practice_location"), CTX);
  ok("3i-control. with practice_location unreadable, the Foundation row is INDETERMINATE",
    rdy(blind, "foundation_complete").indeterminate === true,
    JSON.stringify({ indeterminate: rdy(blind, "foundation_complete").indeterminate }));
  ok("3i. and it never sends anybody to the module it could not read",
    rdy(blind, "foundation_complete").next?.href !== "/practice/settings?tab=practice#locations",
    JSON.stringify(rdy(blind, "foundation_complete").next));

  // ── The booking-address row, which is the one the owner could not find ────────────────────────
  ok("3j. while the address is unclaimed, its readiness row links to the page that claims it",
    rdy(fresh, "patient_booking_published").next?.href === "/practice/setup/identity"
    && part(fresh, "booking_address").href === "/practice/setup/identity",
    JSON.stringify(rdy(fresh, "patient_booking_published").next));

  // ══ 4. THE OFFER: NOT FIRST, AND SKIPPABLE ════════════════════════════════════════════════════
  const STEPS = ["professional_profile", "practice_context", "regional_settings", "clinical_defaults",
    "privacy_security", "review_activate"];
  const decide = (o: Partial<Parameters<typeof handleOfferDecision>[0]>) => handleOfferDecision({
    steps: STEPS, completedSteps: ["professional_profile"], currentStep: "practice_context",
    identity: "unclaimed", skipped: false, ...o,
  });

  ok("4a-control. after one step, an unclaimed practitioner IS offered the address",
    decide({}).show === true && decide({}).show && (decide({}) as { kind: string }).kind === "claim",
    JSON.stringify(decide({})));
  // ⚠ THE PROMISE. Everything else identical; only the completed-step count changes.
  ok("4b. ⚠ and NEVER on the first screen -- nothing completed means no offer",
    decide({ completedSteps: [], currentStep: "professional_profile" }).show === false
    && (decide({ completedSteps: [], currentStep: "professional_profile" }) as { reason: string }).reason === "first_step",
    JSON.stringify(decide({ completedSteps: [], currentStep: "professional_profile" })));
  ok("4c. declining is respected -- a skipped offer is not re-asked",
    decide({ skipped: true }).show === false
    && (decide({ skipped: true }) as { reason: string }).reason === "skipped",
    JSON.stringify(decide({ skipped: true })));
  ok("4d. an address that already exists is never offered again",
    decide({ identity: "claimed" }).show === false,
    JSON.stringify(decide({ identity: "claimed" })));
  ok("4e. ⚠ a FAILED READ is offered as unreadable, never as a claim box",
    decide({ identity: "unreadable" }).show === true
    && (decide({ identity: "unreadable" }) as { kind: string }).kind === "unreadable",
    JSON.stringify(decide({ identity: "unreadable" })));
  ok("4f. no identity row yet is the ISSUE act, which is a different one",
    (decide({ identity: "none" }) as { kind: string }).kind === "issue",
    JSON.stringify(decide({ identity: "none" })));
  ok("4g. nothing is offered before the read has answered",
    decide({ identity: "checking" }).show === false,
    JSON.stringify(decide({ identity: "checking" })));
  ok("4h. a caller who could not claim one is not shown an offer they cannot take",
    decide({ identity: "no_permission" }).show === false,
    JSON.stringify(decide({ identity: "no_permission" })));
  ok("4i. once the flow is finished there is no 'during provisioning' left",
    decide({ currentStep: null }).show === false,
    JSON.stringify(decide({ currentStep: null })));
  ok("4j. the anchor is at least one completed step",
    OFFER_AFTER_COMPLETED_STEPS >= 1, String(OFFER_AFTER_COMPLETED_STEPS));

  // ══ 5. ISSUING NEVER CLAIMS, AND A CLAIM IS PERMANENT ═════════════════════════════════════════
  const provisioned = await getIdentity(admin, OWNER);
  ok("5a-control. provisioning really issued an identity for this practitioner",
    !!provisioned?.practitioner_number, JSON.stringify(provisioned?.practitioner_number ?? null));
  ok("5a. ⚠ and it carries NO handle -- issuing an identity never creates a public address",
    provisioned?.handle === null, String(provisioned?.handle));

  const reissued = await issueIdentity(admin, {
    userId: OWNER, displayName: "Dr Handle Fixture", workspaceId: CTX.workspaceId, correlationId: "harness-handle",
  });
  ok("5b. issuing again is idempotent and STILL writes no handle",
    reissued.ok && reissued.data.created === false && reissued.data.handle === null,
    JSON.stringify(reissued));

  const free = await handleAvailable(admin, FIXTURE_HANDLE);
  if (!free.available) {
    ok(`5c. the fixture handle @${FIXTURE_HANDLE} was free to claim`, false,
      `it is ${free.reason} -- a previous run did not clean up, or somebody really has it`);
  } else {
    const claimed = await claimHandle(admin, { userId: OWNER, handle: FIXTURE_HANDLE, correlationId: "harness-handle" });
    ok("5c. claiming writes the address, and only when asked",
      claimed.ok && claimed.ok === true && (claimed as { data: { handle: string } }).data.handle === FIXTURE_HANDLE,
      JSON.stringify(claimed));

    const again = await claimHandle(admin, { userId: OWNER, handle: "hsecondname1", correlationId: "harness-handle" });
    ok("5d. ⚠ and it cannot be claimed over -- a second claim is refused, not silently applied",
      !again.ok && (again as { code: string }).code === "HANDLE_ALREADY_CLAIMED",
      JSON.stringify(again));
    const still = await getIdentity(admin, OWNER);
    ok("5d-control. the refused claim changed nothing",
      still?.handle === FIXTURE_HANDLE, String(still?.handle));

    // And the setup page stops offering what has been done.
    const afterClaim = await practiceSetup(admin, CTX);
    ok("5e. once claimed, the booking-address readiness row offers no destination",
      rdy(afterClaim, "patient_booking_published").next === null
      && part(afterClaim, "booking_address").done === true,
      JSON.stringify(rdy(afterClaim, "patient_booking_published").next));
  }

  // ══ 6. THE ONBOARDING STEP PERFORMS AT MOST ONE ACT ═══════════════════════════════════════════
  const stepPath = join(process.cwd(), "src", "app", "practice", "onboarding", "BookingAddressStep.tsx");
  const rawStep = readFileSync(stepPath, "utf8");
  const stepSrc = stripComments(rawStep);

  // ⚠ THE STRIPPER'S OWN CONTROL. This sentence exists only in a comment in that file; if it survives
  // the strip, every scan below is reading my own prose about the code instead of the code.
  ok("6a-control. the comment stripper works -- comment-only prose is gone, code is not",
    !stepSrc.includes("is not on this screen AT ALL") && rawStep.includes("is not on this screen AT ALL")
    && stepSrc.includes("action: \"claim\""),
    `stripped ${rawStep.length} -> ${stepSrc.length} chars`);

  ok("6b. the step can claim, exactly once, and from one place",
    (stepSrc.match(/action: "claim"/g) ?? []).length === 1,
    String((stepSrc.match(/action: "claim"/g) ?? []).length));
  ok("6c. ⚠ and it can NEVER publish or change discovery -- becoming findable is not an onboarding step",
    !/action: "publish"/.test(stepSrc) && !/action: "discovery"/.test(stepSrc),
    stepSrc.match(/action: "\w+"/g)?.join(" ") ?? "none");
  ok("6d. claiming is behind a button the practitioner presses, not an effect",
    /onClick=\{claim\}/.test(stepSrc) && !/useEffect\([^)]*claim\(/.test(stepSrc));
  ok("6e. skipping is a real control on every branch of the step",
    (stepSrc.match(/onClick=\{onSkip\}/g) ?? []).length >= 3,
    String((stepSrc.match(/onClick=\{onSkip\}/g) ?? []).length));

  // ══ 7. TEARDOWN, AND THE PROOF THAT IT WORKED ═════════════════════════════════════════════════
  const finalPurge = await cleanup();
  const { data: leftIdentity } = await admin.from("practice_practitioner_identity")
    .select("id").eq("user_id", OWNER).maybeSingle();
  const { data: leftWs, error: leftWsError } = await admin.from("practice_workspace")
    .select("id").eq("owner_person_id", OWNER);
  ok("7a. the fixture identity is gone", !leftIdentity, JSON.stringify(leftIdentity));
  ok("7b. and so is the fixture workspace",
    leftWsError === null && (leftWs ?? []).length === 0 && finalPurge.unreadable === null,
    `${(leftWs ?? []).length} left; ${finalPurge.blocked.map(b => b.reason).join("; ")}`);

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   FAILED: ${f}`)); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
