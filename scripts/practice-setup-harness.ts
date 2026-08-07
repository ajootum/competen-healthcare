/**
 * CPR-SETUP-001 v1 Practice Setup harness (seventeen modules). No migration.
 *
 * WHAT IT PROVES:
 *   1. THE CHECKLIST IS READ FROM THE DATABASE. Every line moves when the thing it describes changes,
 *      and the harness moves each one in turn. A setup dashboard is the one screen where a wrong
 *      completion figure does direct harm -- somebody reads "almost ready" and opens their doors.
 *   2. THE PROGRESS FIGURE IS A COUNT AND ITS DENOMINATOR, never a percentage, and it equals the number
 *      of ticked lines.
 *   3. WHAT IS NOT BUILT IS NOT COUNTABLE. The five unbuilt areas are shown, are not clickable, and are
 *      excluded from the denominator -- a checklist that counts work nobody can do never reaches the end.
 *   4. NOTHING CLAIMS TO BE COMPLETE THAT IS NOT. A card is CONFIGURED only when its own configuration
 *      exists, and flipping that configuration flips the card.
 *   5. NO CARD LEADS TO A ROUTE THAT DOES NOT EXIST -- every href on the page resolves to a real page
 *      file in this repo.
 *   6. THE NOTIFICATION LINE DOES NOT OVERSTATE ITSELF. A channel being on is not reminders being sent,
 *      and the detail says so, because a practice that ticks this and stops ringing people is worse off.
 *   7. PERMISSION CHANGES WHAT IS OFFERED, not what is true: a caller who cannot edit still sees the
 *      state of their practice.
 *   8. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-setup-harness.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { practiceSetup } from "../src/lib/practice/setup";
import { claimHandle } from "../src/lib/practice/identity-service";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000ee001";
const OTHER = "00000000-0000-4000-8000-0000000ee002";

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
    idempotency_key: `harness-set-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-set",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-set", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
      await admin.from("practice_workspace").delete().eq("id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

/**
 * A card's link must land somewhere real — the PAGE and, when it names one, the SECTION.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE FIRST VERSION CHECKED ONLY THE PAGE, AND A PRACTICE FOUND WHAT THAT MISSED.
 *
 * Seven setup cards pointed at a bare `/practice/settings`. Every one passed: the page exists. But from
 * the settings page itself that link goes to the page you are already on — and lands on the other tab,
 * so it reads as a button that does nothing. "They seem to be leading to nowhere" was exactly right.
 *
 * So an href is now checked in three parts: the route file exists, the query does not smuggle itself
 * into the path, and any `#section` corresponds to a real `id=` in that route's own components. A link
 * to a section that does not exist scrolls nowhere, which is the same failure wearing an anchor.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
function routeExists(href: string): boolean {
  const [pathAndQuery, hash] = href.split("#");
  const clean = pathAndQuery.split("?")[0].replace(/^\/practice\/?/, "").replace(/\/$/, "");
  const dir = clean === "" ? "src/app/practice" : `src/app/practice/(shell)/${clean}`;
  if (!existsSync(`${dir}/page.tsx`)) return false;
  if (!hash) return true;

  // The anchor may live in the page or in any component beside it.
  const files = readdirSync(dir).filter(f => f.endsWith(".tsx"));
  return files.some(f => readFileSync(`${dir}/${f}`, "utf8").includes(`id="${hash}"`));
}

async function main() {
  console.log("\n=== PRACTICE SETUP (CPR-SETUP-001 v1, seventeen modules) ===\n");
  await cleanup();

  const wsA = await provision(OWNER, "Dr Setup A", "a");
  const wsB = await provision(OTHER, "Dr Setup B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");

  // Typed off the engine's own return, so a renamed field breaks the harness at compile time rather
  // than at 3am against a green run.
  type Setup = Awaited<ReturnType<typeof practiceSetup>>;
  const line = (s: Setup, k: string) => s.checklist.find(i => i.key === k);
  const mod = (s: Setup, k: string) => s.modules.find(m => m.key === k);

  // ---- 5. No card leads to a route that does not exist -----------------------------------------------
  const first = await practiceSetup(admin, ctxA.ctx);
  const broken = first.modules.filter(m => m.href && !routeExists(m.href)).map(m => `${m.key} -> ${m.href}`);
  ok("5a every card that can be opened points at a page that exists", broken.length === 0, JSON.stringify(broken));
  const brokenQuick = first.quickActions.filter(a => !routeExists(a.href)).map(a => a.href);
  ok("5b so does every quick action", brokenQuick.length === 0, JSON.stringify(brokenQuick));
  ok("5c CONTROL: routeExists can say no, so 5a is not vacuous", routeExists("/practice/nothing-here") === false);

  // ---- 3. What is not built is not countable -----------------------------------------------------------
  const notBuilt = first.modules.filter(m => m.state === "not_built");
  // NAMED, NOT COUNTED. A magic number drifts every time one of them gets built -- 3a already had to
  // move from four to five to four again. The keys say which, and a build that closes one fails here
  // loudly enough to be updated deliberately.
  // `notifications` joined this list when a real practice's setup hub was reviewed: the delivery
  // channel exists in the engine (migration 224) and NOTHING RENDERS IT, so the card said "needs
  // attention" about something nobody could act on and its link went to the settings root. An
  // unactionable nag is worse than an honest absence.
  const UNBUILT = ["self_booking", "notifications", "workflows", "integrations", "billing"];
  ok("3a exactly the unbuilt areas are shown as not built",
    notBuilt.length === UNBUILT.length && UNBUILT.every(k => notBuilt.some(m => m.key === k)),
    JSON.stringify(notBuilt.map(m => m.key)));
  ok("3b none of them is clickable", notBuilt.every(m => m.href === null));
  ok("3c each says why", notBuilt.every(m => !!m.unavailableReason && m.unavailableReason.length > 20));
  ok("3d none of them appears on the checklist",
    notBuilt.every(m => !first.checklist.some(i => i.key === m.key)),
    JSON.stringify(first.checklist.map(i => i.key)));
  ok("3e and the page states how many were left out", first.notBuiltCount === UNBUILT.length);

  // ---- 2. The figure is a count that matches the ticks -------------------------------------------------
  ok("2a done equals the number of ticked lines",
    first.progress.done === first.checklist.filter(i => i.done).length,
    `${first.progress.done} vs ${first.checklist.filter(i => i.done).length}`);
  ok("2b the denominator is the checklist length", first.progress.of === first.checklist.length);
  ok("2d the legend counts sum to the total, which the comp's own panel does not",
    first.legend.reduce((n, l) => n + l.count, 0) === first.progress.total,
    JSON.stringify(first.legend) + ` total=${first.progress.total}`);
  ok("2e the denominator EXCLUDES what cannot be built",
    first.progress.of === first.progress.total - first.notBuiltCount,
    `${first.progress.of} vs ${first.progress.total}-${first.notBuiltCount}`);
  // ⚠ NINETEEN, NOT SEVENTEEN. CPR-SETUP-001 named seventeen; two more have shipped since and each one
  // states its own reason in setup.ts's CATALOGUE -- module 18 Clinical Parameters (CPR-LCP-001 s10.1)
  // and module 19 Practice Lifecycle (CPR-LIFE-001 s8). The denominator is what a practice can actually
  // configure, not what one document knew about, and a module that exists and is not counted is the same
  // lie as one that is counted and does not.
  ok("2f nineteen modules", first.modules.length === 19, String(first.modules.length));
  ok("2c no percentage anywhere in the payload",
    !/percent|"\d+%"/i.test(JSON.stringify({ ...first, modules: [], checklist: first.checklist })),
    "found a percentage");

  // ---- 1 + 4. Every line moves when its subject changes -------------------------------------------------
  // A fresh practice already has one location (provisioning creates it), so locations starts DONE.
  ok("1a a fresh practice has its profile line done", line(first, "profile")?.done === true,
    JSON.stringify(line(first, "profile")));
  ok("1b and nothing has been set aside yet", line(first, "availability")?.done === false,
    JSON.stringify(line(first, "availability")));
  ok("1c and no letterhead", line(first, "letterhead")?.done === false);
  ok("1d and no institution", line(first, "identifiers")?.done === false);

  const beforeDone = first.progress.done;

  // Letterhead.
  await admin.from("practice_configuration").update({ letterhead_name: "Dr Setup A Clinic" })
    .eq("workspace_id", wsA).eq("is_effective", true);
  const withHead = await practiceSetup(admin, ctxA.ctx);
  ok("4a adding a letterhead ticks its line", line(withHead, "letterhead")?.done === true);
  ok("4b and the card becomes ready", mod(withHead, "letterhead")?.state === "configured");
  ok("4c and the count goes up by exactly one", withHead.progress.done === beforeDone + 1,
    `${withHead.progress.done} vs ${beforeDone}`);
  ok("4d and the detail names what was found",
    line(withHead, "letterhead")?.detail === "Dr Setup A Clinic", JSON.stringify(line(withHead, "letterhead")));

  // A facility.
  const { error: facErr } = await admin.from("practice_facility")
    .insert({ workspace_id: wsA, name: "Mulago Hospital", facility_type: "hospital", active: true });
  if (facErr) throw new Error(`facility fixture failed: ${facErr.message}`);
  const withFac = await practiceSetup(admin, ctxA.ctx);
  ok("4e adding an institution ticks the identifiers line", line(withFac, "identifiers")?.done === true);
  ok("4f and counts it", line(withFac, "identifiers")?.detail === "1 institutions",
    JSON.stringify(line(withFac, "identifiers")));

  // Availability.
  const now = new Date();
  const { error: slotErr } = await admin.from("practice_availability_slot").insert({
    workspace_id: wsA,
    starts_at: new Date(now.getTime() + 86400000).toISOString(),
    ends_at: new Date(now.getTime() + 86400000 + 3600000).toISOString(),
    slot_kind: "clinic",
  });
  if (slotErr) throw new Error(`slot fixture failed: ${slotErr.message}`);
  // A LOOSE SLOT IS NOT A REGULAR WEEK, and since CPR-SET-002 the card says so. One-off slots in the
  // calendar are availability of a sort; the thing that keeps generating them is a template.
  const withSlot = await practiceSetup(admin, ctxA.ctx);
  ok("4g one-off slots alone do NOT tick the availability line",
    line(withSlot, "availability")?.done === false, JSON.stringify(line(withSlot, "availability")));
  ok("4g-detail and the card says what is missing",
    /no regular week/.test(line(withSlot, "availability")?.detail ?? ""),
    line(withSlot, "availability")?.detail ?? "null");

  const { error: tmplErr } = await admin.from("practice_availability_template").insert({
    workspace_id: wsA, weekday: 2, starts_minute: 9 * 60, ends_minute: 13 * 60, slot_kind: "clinic",
  });
  if (tmplErr) throw new Error(`template fixture failed: ${tmplErr.message}`);
  const withWeek = await practiceSetup(admin, ctxA.ctx);
  ok("4g-week a regular week DOES tick it", line(withWeek, "availability")?.done === true,
    JSON.stringify(line(withWeek, "availability")));
  ok("4h and the availability card becomes ready", mod(withWeek, "availability")?.state === "configured");

  // ---- 6. Patient notifications claim nothing they cannot do ---------------------------------------------
  //
  // ⚠ THIS ASSERTION MOVED. It used to check a CHECKLIST LINE that ticked when a delivery channel was
  // enabled. Reviewing a real practice's hub showed the line was unactionable: the channel table and
  // engine exist since migration 224, and NOTHING RENDERS THEM, so "needs attention · no channel on"
  // asked somebody to go and do a thing with no screen behind it -- and its link went to the settings
  // root, which is the "leads nowhere" a practitioner reported. An unactionable nag is worse than an
  // honest absence, so the module is not built and the claim lives in its reason instead.
  const { error: chErr } = await admin.from("practice_message_channel")
    .insert({ workspace_id: wsA, kind: "sms", enabled: true });
  if (chErr) throw new Error(`channel fixture failed: ${chErr.message}`);
  const withCh = await practiceSetup(admin, ctxA.ctx);

  ok("6a notifications is not built, so it cannot be opened",
    mod(withCh, "notifications")?.state === "not_built" && mod(withCh, "notifications")?.href === null,
    JSON.stringify(mod(withCh, "notifications")));
  ok("6b ENABLING A CHANNEL IN THE DATABASE DOES NOT MAKE IT LOOK CONFIGURED",
    mod(withCh, "notifications")?.state === "not_built",
    "a row is not a screen");
  ok("6c and the reason still says nothing sends by itself",
    /not scheduled or sent|nothing/i.test(mod(withCh, "notifications")?.unavailableReason ?? ""),
    mod(withCh, "notifications")?.unavailableReason ?? "null");
  ok("6d it is off the checklist entirely, so it cannot nag",
    !withCh.checklist.some(i => i.key === "notifications"),
    JSON.stringify(withCh.checklist.map(i => i.key)));

  // ---- 7. Permission changes what is offered, not what is true --------------------------------------------
  const readOnly = { ...ctxA.ctx, capabilities: ctxA.ctx.capabilities.filter(c => c !== "practice.settings.manage") };
  const ro = await practiceSetup(admin, readOnly);
  ok("7a a caller who cannot edit sees the profile card as hidden",
    mod(ro, "profile")?.state === "no_access" && mod(ro, "profile")?.href === null,
    JSON.stringify(mod(ro, "profile")));
  ok("7b but the CHECKLIST still tells them the state of their practice",
    ro.progress.done === withCh.progress.done && ro.checklist.length === withCh.checklist.length,
    `${ro.progress.done} vs ${withCh.progress.done}`);
  ok("7c CONTROL: with the permission it is openable, so 7a is not vacuous",
    mod(withCh, "profile")?.href === "/practice/settings?tab=practice#practice-profile",
    mod(withCh, "profile")?.href ?? "null");
  // AND IT NAMES A SECTION, not just a page. Seven cards used to point at the settings root, which from
  // the settings page itself is a link to where you already are.
  // Only links that land on the settings page ITSELF need a section. A sub-route like
  // /practice/settings/registration-form is its own page and correctly has no anchor.
  const ontoSettingsPage = withCh.modules
    .filter(m => m.href === "/practice/settings" || m.href?.startsWith("/practice/settings?"));
  ok("7d every card landing on the settings page names its section",
    ontoSettingsPage.length > 0 && ontoSettingsPage.every(m => m.href!.includes("#")),
    JSON.stringify(ontoSettingsPage.map(m => m.href)));

  // 2d asserted the legend sums to the total, but for a FULL-CAPABILITY owner the no_access count is
  // nought and is filtered out -- so a break that deleted that legend row changed nothing and the
  // assertion sat green. The read-only caller is the only fixture where every category is non-empty,
  // which is the only fixture where "the legend sums" is a claim with teeth.
  const roNoAccess = ro.legend.find(l => l.key === "no_access")?.count ?? 0;
  ok("2g the read-only caller genuinely has cards they cannot open", roNoAccess > 0, String(roNoAccess));
  ok("2h and the legend STILL sums to the total for them",
    ro.legend.reduce((n, l) => n + l.count, 0) === ro.progress.total,
    JSON.stringify(ro.legend) + ` total=${ro.progress.total}`);

  // ---- 9. The specification's status column disagrees with the code, and the code wins ---------------------
  //
  // CPR-SETUP-001 marks thirteen modules "Build" or "New". Several are already implemented here.
  // Copying the document's column would tell a practitioner their registration form builder, hospital
  // numbering and team management do not exist -- and they would stop using three things that work.
  ok("9a the disagreement is surfaced rather than silently resolved",
    withCh.specDisagreements.length > 0, JSON.stringify(withCh.specDisagreements));
  const disagreeKeys = withCh.modules.filter(m => m.specSaysUnbuilt && m.state !== "not_built").map(m => m.key);
  ok("9b it names registration, identifiers and team, which the document lists as unbuilt",
    ["registration", "identifiers", "team"].every(k => disagreeKeys.includes(k)),
    JSON.stringify(disagreeKeys));
  ok("9c and those cards are genuinely openable, so the disagreement is real",
    ["registration", "identifiers", "team"].every(k => !!mod(withCh, k)?.href),
    JSON.stringify(["registration", "identifiers", "team"].map(k => mod(withCh, k)?.href)));
  // Booking Rules used to be the control here and stopped being one the moment CPR-SET-002 built it --
  // it now correctly APPEARS in the disagreements. Self-Booking is the control: the document lists it
  // as unbuilt and it genuinely is.
  ok("9d CONTROL: a module the document lists as unbuilt AND that really is unbuilt does not appear",
    !withCh.specDisagreements.some(d => d.title === "Self-Booking"),
    JSON.stringify(withCh.specDisagreements.map(d => d.title)));
  ok("9e and Booking Rules HAS moved into the disagreements now that it is built",
    withCh.specDisagreements.some(d => d.title === "Booking Rules"),
    JSON.stringify(withCh.specDisagreements.map(d => d.title)));

  // ---- 8. Cross-workspace isolation, non-vacuously ---------------------------------------------------------
  const b = await practiceSetup(admin, ctxB.ctx);
  ok("8a practice B has no letterhead of ours", line(b, "letterhead")?.done === false,
    JSON.stringify(line(b, "letterhead")));
  ok("8b nor our institution", line(b, "identifiers")?.detail === "0 institutions",
    JSON.stringify(line(b, "identifiers")));
  ok("8c nor our availability", line(b, "availability")?.done === false);
  ok("8d CONTROL: practice A does have all three, so 8a-c are not vacuous",
    line(withCh, "letterhead")?.done === true && line(withCh, "identifiers")?.done === true &&
    line(withCh, "availability")?.done === true);

  // ---- 10. THE BOOKING ADDRESS (PIS-000 s3) -----------------------------------------------------------
  //
  // ⚠ AN UNCLAIMED ADDRESS MUST RENDER AS UNCLAIMED. It is a part of the primary operations card rather
  // than a module of its own, so nothing in section 2's counts covers it -- and a part that said nothing,
  // or said "not built" after it was built, would be the same overclaim as a percentage.
  //
  // ⚠ AND IT IS SEPARATE FROM `booking_access`, WHICH IS STILL NOT BUILT. Claiming an address is not
  // publishing a page; one part being real must not quietly mark the other done.
  const part = (s: Setup, k: string) => s.availability.parts.find(p => p.key === k);
  const beforeClaim = await practiceSetup(admin, ctxA.ctx);
  ok("10a the booking address is a part a practice can act on, and it starts unclaimed",
    part(beforeClaim, "booking_address")?.done === false &&
    !part(beforeClaim, "booking_address")?.notBuilt &&
    /unclaimed/i.test(part(beforeClaim, "booking_address")?.detail ?? ""),
    JSON.stringify(part(beforeClaim, "booking_address")));
  ok("10a-2 while the booking PAGE is still not built, and says so separately",
    !!part(beforeClaim, "booking_access")?.notBuilt &&
    part(beforeClaim, "booking_access")?.done === null,
    JSON.stringify(part(beforeClaim, "booking_access")));

  const claimed = await claimHandle(admin, {
    userId: OWNER, handle: "hsetupaddr", correlationId: "harness-set",
  });
  ok("10b-pre the address is claimed", claimed.ok, claimed.ok ? "" : claimed.message);
  const afterClaim = await practiceSetup(admin, ctxA.ctx);
  ok("10b and the part now names the handle",
    part(afterClaim, "booking_address")?.done === true &&
    part(afterClaim, "booking_address")?.detail === "@hsetupaddr",
    JSON.stringify(part(afterClaim, "booking_address")));
  const otherAfterClaim = await practiceSetup(admin, ctxB.ctx);
  ok("10c CONTROL: the OTHER practice is still unclaimed, so 10b is about this practitioner's claim",
    part(otherAfterClaim, "booking_address")?.done === false,
    JSON.stringify(part(otherAfterClaim, "booking_address")));

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
