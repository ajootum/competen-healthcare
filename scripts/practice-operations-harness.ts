/**
 * Practice operations-home harness -- CPR-300, plus the practice clock it shares with CPR-140.
 *
 * WHAT IT PROVES:
 *   1. THE PRACTICE'S DAY, NOT THE SERVER'S. zonedDayRange puts an 08:00 Kampala appointment inside
 *      that Kampala day and a 01:00 one too -- the second is the case the old UTC-window home page got
 *      wrong, because 01:00 EAT is the previous day in UTC. Asserted against fixed instants, and
 *      against a zone BEHIND UTC so the fix is not one-directional.
 *   2. EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. Structurally: every attention item carries a
 *      count, a link, and sample rows, and its count equals the number of real rows behind it. A tile
 *      whose count did not match its subject would be a decorative statistic, which is what this page
 *      exists to refuse.
 *   3. THE ORDER IS BY WHAT IT COSTS TO IGNORE, and it is the engine's, not the page's: an overdue
 *      follow-up outranks an unsigned encounter outranks a draft document, whatever order the rows
 *      were created in.
 *   4. A ZERO IS EARNED AND A BLIND SPOT IS NAMED. A caller without followup.view does not get a
 *      follow-up tile reading zero -- the tile is ABSENT and "follow-ups" appears in blindSpots, so
 *      allClear is false. "Nothing is owed" and "you cannot see what is owed" are different sentences.
 *   5. UNSIGNED IS SEPARATED FROM LIVE, and staleness escalates the severity: a completed encounter
 *      sitting unsigned for days is a different problem from one completed a minute ago.
 *   6. "Still to come today" counts what is REMAINING, not the whole day -- a home page that still says
 *      eight at five o'clock is describing the morning.
 *   7. Workspace isolation non-vacuously.
 *
 *   npx --yes tsx scripts/practice-operations-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { createDocument } from "../src/lib/practice/documentation";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { operationsHome } from "../src/lib/practice/operations-home";
import { practiceToday, dueDateFrom, zonedDayRange, zoneOffsetMinutes } from "../src/lib/practice/practice-time";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e1171";
const USER_B = "00000000-0000-4000-8000-0000000e1172";

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
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-ops-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-ops",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-ops", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-ops" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice operations-home harness (CPR-300)\n");
  await cleanup();

  // ── 1. THE PRACTICE'S DAY ────────────────────────────────────────────────
  // Kampala is UTC+3 with no DST, so its day D starts at D-1 21:00Z.
  const kampala = zonedDayRange("2026-03-15", "Africa/Kampala");
  ok("a Kampala day starts at 21:00 UTC the previous evening",
    kampala.startIso === "2026-03-14T21:00:00.000Z" && kampala.endIso === "2026-03-15T21:00:00.000Z",
    `${kampala.startIso} .. ${kampala.endIso}`);

  // THE CASE THE OLD HOME PAGE GOT WRONG. 01:00 EAT on the 15th is 22:00Z on the 14th, so a UTC-day
  // window for the 15th misses it entirely and the appointment vanishes from "today".
  const earlyMorning = Date.parse("2026-03-14T22:00:00.000Z");
  ok("an 01:00 Kampala appointment falls inside the Kampala day (the UTC window missed this)",
    earlyMorning >= Date.parse(kampala.startIso) && earlyMorning < Date.parse(kampala.endIso),
    new Date(earlyMorning).toISOString());
  // ...and the mirror: 23:00Z on the 15th is 02:00 EAT on the SIXTEENTH, so it must NOT be in the 15th.
  const lateUtc = Date.parse("2026-03-15T23:00:00.000Z");
  ok("a 23:00 UTC instant is the NEXT Kampala day and is excluded (the window discriminates)",
    lateUtc >= Date.parse(kampala.endIso), new Date(lateUtc).toISOString());

  const nyc = zonedDayRange("2026-03-15", "America/New_York");
  ok("a zone BEHIND UTC works too (the fix is not one-directional)",
    Date.parse(nyc.startIso) > Date.parse("2026-03-15T00:00:00.000Z"), nyc.startIso);
  ok("zoneOffsetMinutes reads Kampala as +180",
    zoneOffsetMinutes("Africa/Kampala", new Date("2026-03-15T12:00:00Z")) === 180,
    String(zoneOffsetMinutes("Africa/Kampala", new Date("2026-03-15T12:00:00Z"))));
  ok("an unknown timezone falls back rather than throwing",
    zonedDayRange("2026-03-15", "Mars/Olympus_Mons").startIso === "2026-03-15T00:00:00.000Z");
  ok("the day range is HALF-OPEN, so no millisecond of the day is dropped",
    Date.parse(kampala.endIso) - Date.parse(kampala.startIso) === 86400000);

  const wsA = await provision(USER_A, "HARNESS Operations A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Operations B (synthetic)", "b");
  const ctxA = await resolveWorkspaceContext(admin, USER_A, wsA);
  const ctxB = await resolveWorkspaceContext(admin, USER_B, wsB);
  if (!ctxA.ok || !ctxB.ok) { ok("workspace context resolves for the harness", false); return report(); }

  const today = practiceToday("Africa/Kampala");

  // ── An empty practice ────────────────────────────────────────────────────
  const empty = await operationsHome(admin, ctxA.ctx);
  ok("a fresh practice owes nothing and hides nothing", empty.allClear === true,
    `attention=${empty.attention.length} blindSpots=${empty.blindSpots.join(",")}`);
  ok("the home reports the practice's own timezone and day",
    empty.timezone === "Africa/Kampala" && empty.today === today, `${empty.timezone} ${empty.today}`);

  // ── Build real work, in an order that does NOT match the display order ───
  // Documents first and follow-ups last, so a page that rendered rows in creation order would come out
  // backwards and section 3 would catch it.
  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Kirabo Doreen", birthDate: "1993-04-08", sex: "female",
    phone: "0772 555 550", ...base,
  });
  if (!pa.ok) { ok("patient registration for the harness succeeded", false, pa.message); return report(); }
  const patientA = pa.data.id;

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patientA, pathway: "new_walk_in", reasonForVisit: "sore throat", ...base,
  });
  if (!enc.ok) { ok("encounter launch for the harness succeeded", false, enc.message); return report(); }
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "ACTIVE", ...base });

  const doc = await createDocument(admin, {
    workspaceId: wsA, patientId: patientA, encounterId: enc.data.id,
    title: "Sick note", docType: "sick_note", body: "Unfit for work 2 days.", ...base,
  });
  ok("a draft document exists for the harness", doc.ok, doc.ok ? "" : doc.message);

  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "COMPLETED", ...base });

  const overdue = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, originEncounterId: enc.data.id,
    reason: "review the throat swab", dueOn: dueDateFrom(today, -5), ...base,
  });
  ok("an overdue follow-up exists for the harness", overdue.ok, overdue.ok ? "" : overdue.message);

  // THREE due-soon against ONE overdue, deliberately. An ordering assertion where every tile has the
  // same count cannot tell "sorted by cost of ignoring" from "sorted by count" from "whatever order the
  // code happened to assign them in" -- and the first version of this harness could not, which a
  // deliberate break exposed. Making due-soon the LARGEST group means a count sort would float it to the
  // top, where the assertions below say it must not be.
  const soon = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "recheck in a week", intervalCode: "1w", ...base,
  });
  const soon2 = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "blood pressure recheck", intervalCode: "1w", ...base,
  });
  const soon3 = await createFollowUp(admin, {
    workspaceId: wsA, patientId: patientA, reason: "weight review", intervalCode: "2w", ...base,
  });
  ok("three due-soon follow-ups exist, outnumbering the overdue one",
    soon.ok && soon2.ok && soon3.ok, [soon, soon2, soon3].map(r => r.ok ? "ok" : r.message).join("; "));

  // Today's clinic: one still to come, one already seen.
  const a1 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: patientA, patientName: "Kirabo Doreen",
    appointmentType: "scheduled_followup", scheduledAt: `${today}T11:00:00.000Z`, ...base,
  });
  const a2 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: patientA, patientName: "Kirabo Doreen",
    appointmentType: "new_consultation", scheduledAt: `${today}T14:00:00.000Z`, ...base,
  });
  ok("two appointments book for today", a1.ok && a2.ok, a1.ok ? (a2.ok ? "" : a2.message) : a1.message);
  if (a2.ok) {
    // No confirm step: bookAppointment enters CONFIRMED for staff bookings (2ee597ae, the owner's
    // 2026-08-12 click-reduction decision), so a transition here is refused as CONFIRMED -> CONFIRMED.
    // The REQUESTED rung is still exercised, deliberately, in practice-scheduling-harness.
    await transitionAppointment(admin, { workspaceId: wsA, appointmentId: a2.data.id, to: "CANCELLED", ...base });
  }

  const home = await operationsHome(admin, ctxA.ctx);

  // ── 2. EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN ─────────────────
  ok("the home now has work on it (the assertions below are not vacuous)",
    home.attention.length >= 4, `${home.attention.length} items`);
  // ⚠ SCOPED TO READY ITEMS, AND THE SCOPE IS ITSELF ASSERTED BELOW. CPR-CC-MOB-001 s4 lets an item
  // arrive with status "unavailable" and count null, for a category whose read failed -- such an item
  // has no count and no samples BY DESIGN, so applying the old predicate to it would fail for the one
  // reason that is correct behaviour. Narrowing a test to dodge a case is how a test stops meaning
  // anything, so the narrowing is paid for: 2c asserts the excluded items really are the sizeless ones.
  const ready = home.attention.filter(i => i.status === "ready");
  ok("EVERY ready attention item carries a count, a link and real sample rows",
    ready.length > 0 && ready.every(i => (i.count ?? 0) > 0 && !!i.href && i.href.startsWith("/practice/") && i.sample.length > 0),
    JSON.stringify(ready.map(i => ({ k: i.kind, c: i.count, h: i.href, s: i.sample.length }))));
  ok("no item shows more samples than its count claims",
    ready.every(i => i.sample.length <= (i.count ?? 0)));
  ok("2c an item is sizeless only when it says it is unavailable, and never the reverse",
    home.attention.every(i => (i.count === null) === (i.status !== "ready")),
    JSON.stringify(home.attention.map(i => ({ k: i.kind, status: i.status, c: i.count }))));
  ok("every sample row has a label (no blank lines dressed as work)",
    home.attention.every(i => i.sample.every(s => !!s.label && s.label.length > 0)));

  const byKind = Object.fromEntries(home.attention.map(i => [i.kind, i]));
  const { count: overdueRows } = await admin.from("practice_follow_up")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("status", "OPEN").lt("due_on", today);
  ok("the overdue COUNT equals the rows behind it",
    byKind.followup_overdue?.count === (overdueRows ?? -1),
    `tile=${byKind.followup_overdue?.count} rows=${overdueRows}`);

  const { count: unsignedRows } = await admin.from("practice_encounter")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("status", "COMPLETED");
  ok("the unsigned-encounter COUNT equals the rows behind it",
    byKind.encounter_unsigned?.count === (unsignedRows ?? -1),
    `tile=${byKind.encounter_unsigned?.count} rows=${unsignedRows}`);

  // ── 3. Ordered by what it costs to ignore ────────────────────────────────
  const order = home.attention.map(i => i.kind);
  const idx = (k: (typeof order)[number]) => order.indexOf(k);
  ok("an overdue follow-up outranks an unsigned encounter",
    idx("followup_overdue") >= 0 && idx("followup_overdue") < idx("encounter_unsigned"), order.join(" > "));
  ok("an unsigned encounter outranks a draft document",
    idx("encounter_unsigned") < idx("document_unissued"), order.join(" > "));
  // THE DISCRIMINATING ONE. The engine builds its items in a different sequence from the order it
  // publishes them in, and due-soon is the single tile where the two disagree: it is built second and
  // ranks sixth. So this assertion fails if the page ever renders whatever order the code assigned --
  // which is the exact break the earlier version of this harness sat through green.
  ok("a due-soon follow-up ranks BELOW an unsigned encounter (not the order the engine built them in)",
    idx("followup_due_soon") > idx("encounter_unsigned"), order.join(" > "));
  // And it is the LARGEST group, so a sort by count would put it first.
  ok("...even though it is the biggest pile (size is not urgency)",
    (byKind.followup_due_soon?.count ?? 0) > (byKind.followup_overdue?.count ?? 0) &&
    idx("followup_due_soon") > idx("followup_overdue"),
    `due_soon=${byKind.followup_due_soon?.count} overdue=${byKind.followup_overdue?.count} — ${order.join(" > ")}`);

  // ── 5. Unsigned is separated from live, and staleness escalates ──────────
  ok("a freshly completed encounter is a WARNING, not a critical",
    byKind.encounter_unsigned?.severity === "warning", String(byKind.encounter_unsigned?.severity));

  // Back-date the completion by three days, straight at the table: the encounter is not signed, so this
  // is a legal edit and the trigger from 194 s6 does not apply.
  await admin.from("practice_encounter")
    .update({ completed_at: new Date(Date.now() - 3 * 86400000).toISOString() }).eq("id", enc.data.id);
  const stale = await operationsHome(admin, ctxA.ctx);
  const staleItem = stale.attention.find(i => i.kind === "encounter_unsigned");
  ok("an encounter unsigned for DAYS escalates to critical, and the tile says how long",
    staleItem?.severity === "critical" && /day or more/.test(staleItem?.detail ?? ""),
    `${staleItem?.severity} — ${staleItem?.detail}`);
  ok("the live consultation is NOT counted among the unsigned",
    (stale.attention.find(i => i.kind === "encounter_live")?.count ?? 0) === 0 ||
    staleItem?.count !== stale.attention.find(i => i.kind === "encounter_live")?.count,
    JSON.stringify({ unsigned: staleItem?.count, live: stale.attention.find(i => i.kind === "encounter_live")?.count }));

  // ── 6. Remaining, not the whole day ──────────────────────────────────────
  ok("today's clinic tile counts what is REMAINING, not everything booked",
    byKind.clinic_remaining?.count === 1 && /of 2 today/.test(byKind.clinic_remaining?.detail ?? ""),
    `${byKind.clinic_remaining?.count} — ${byKind.clinic_remaining?.detail}`);
  ok("the full day is still available for the diary panel", home.appointments.length === 2, `${home.appointments.length}`);

  // ── 4. A zero is earned; a blind spot is named ───────────────────────────
  // Withdraw followup.view from A's memberships and re-read. The tile must VANISH, not read zero.
  const { data: mine } = await admin.from("practice_membership").select("id").eq("workspace_id", wsA).eq("user_id", USER_A);
  const membershipIds = ((mine ?? []) as any[]).map(m => m.id);
  await admin.from("practice_role_assignment")
    .update({ effective_to: new Date().toISOString() })
    .in("membership_id", membershipIds).eq("capability_code", "followup.view").is("effective_to", null);

  const blinded = await resolveWorkspaceContext(admin, USER_A, wsA);
  if (!blinded.ok) { ok("context still resolves after withdrawing a capability", false); return report(); }
  ok("the capability was actually withdrawn (the test below is not vacuous)",
    !blinded.ctx.capabilities.includes("followup.view"), blinded.ctx.capabilities.join(","));

  const partial = await operationsHome(admin, blinded.ctx);
  ok("THE FOLLOW-UP TILE IS ABSENT, NOT ZERO",
    !partial.attention.some(i => i.kind.startsWith("followup")),
    JSON.stringify(partial.attention.map(i => i.kind)));
  ok("and the blind spot is NAMED rather than left silent",
    partial.blindSpots.includes("follow-ups"), partial.blindSpots.join(","));
  ok("allClear is false while anything is hidden, even with nothing owed",
    partial.allClear === false, String(partial.allClear));
  ok("the tiles the caller CAN see are unaffected (the withdrawal was surgical)",
    partial.attention.some(i => i.kind === "encounter_unsigned"),
    JSON.stringify(partial.attention.map(i => i.kind)));

  // Restore, so the isolation check below runs against a normal workspace.
  await admin.from("practice_role_assignment")
    .update({ effective_to: null })
    .in("membership_id", membershipIds).eq("capability_code", "followup.view");

  // ── 8. CPR-300'S SPECIFIED LAYOUT (added after CPR-AUDIT-001) ────────────
  //
  // The first version of this page was designed from the module's title without opening the
  // specification or the comp beside it. These assertions hold the comp's structure in place so it
  // cannot quietly drift back to something invented.
  const laid = await operationsHome(admin, ctxA.ctx);

  ok("the KPI strip has the comp's six tiles, in its order",
    laid.kpis.length === 6 &&
    laid.kpis.map(k => k.key).join(",") === "appointments,new_patients,procedures,followups,messages,tasks",
    laid.kpis.map(k => k.key).join(","));
  ok("every KPI a caller can see carries a value and somewhere to open",
    laid.kpis.filter(k => k.available).every(k => typeof k.value === "number" && k.href.startsWith("/practice/")),
    JSON.stringify(laid.kpis.map(k => ({ k: k.key, v: k.value }))));
  ok("NO KPI CARRIES A TREND, because nothing has recorded a baseline to compare against",
    !JSON.stringify(laid.kpis).match(/vs (yesterday|last)/i) && !/\d+%/.test(JSON.stringify(laid.kpis)),
    JSON.stringify(laid.kpis.map(k => k.detail)));

  ok("procedures are counted from the PLAN and the ACT separately (CPR-150's distinction)",
    /performed/.test(laid.kpis.find(k => k.key === "procedures")?.detail ?? "") &&
    /planned/.test(laid.kpis.find(k => k.key === "procedures")?.detail ?? ""),
    laid.kpis.find(k => k.key === "procedures")?.detail);

  // THE DECISION TAKEN AFTER THE AUDIT: a figure this product cannot produce renders IN ITS DESIGNED
  // POSITION carrying the reason, rather than being dropped. A reader cannot tell an absent tile from
  // an unbuilt one; an empty state in the right place can.
  const unavailable = laid.health.filter(h => !h.available);
  ok("the health tiles this product cannot fill are PRESENT and carry a reason",
    unavailable.length === 3 && unavailable.every(h => !!h.reason && h.value === null),
    JSON.stringify(unavailable.map(h => h.key)));
  ok("...and they name the missing capability rather than apologising vaguely",
    unavailable.some(h => /billing/i.test(h.reason ?? "")) && unavailable.some(h => /survey/i.test(h.reason ?? "")),
    JSON.stringify(unavailable.map(h => h.reason)));
  ok("the health tiles that CAN be filled carry a count and a denominator, never a rate",
    laid.health.filter(h => h.available).every(h => h.value !== null && !String(h.value).includes("%")),
    JSON.stringify(laid.health.filter(h => h.available).map(h => ({ k: h.key, v: h.value, of: h.of }))));

  ok("quick actions are offered only where the caller holds the capability",
    laid.quickActions.length > 0 && laid.quickActions.every(a => ctxA.ctx.capabilities.includes(a.capability)),
    laid.quickActions.map(a => a.key).join(","));
  ok("no quick action opens a capability that is not built (no AI assistant button)",
    !laid.quickActions.some(a => /ai|assistant/i.test(a.label)),
    laid.quickActions.map(a => a.label).join(","));

  // Withdrawn again here rather than reusing the earlier variable: that one is the resolver's result
  // wrapper, not a context, and by this point the capability had been restored -- so it would have
  // asserted the blind case against a sighted caller.
  await admin.from("practice_role_assignment")
    .update({ effective_to: new Date().toISOString() })
    .in("membership_id", membershipIds).eq("capability_code", "followup.view").is("effective_to", null);
  const reBlinded = await resolveWorkspaceContext(admin, USER_A, wsA);
  if (!reBlinded.ok) { ok("context resolves for the KPI blind check", false); return report(); }
  ok("the capability is genuinely withdrawn for this check (not vacuous)",
    !reBlinded.ctx.capabilities.includes("followup.view"));

  const blindKpis = await operationsHome(admin, reBlinded.ctx);
  ok("a KPI the caller cannot see is marked unavailable rather than shown as zero",
    blindKpis.kpis.find(k => k.key === "followups")?.available === false &&
    blindKpis.kpis.find(k => k.key === "followups")?.value === null,
    JSON.stringify(blindKpis.kpis.find(k => k.key === "followups")));
  ok("...while the KPIs it CAN see still carry real values (the gate is per tile)",
    blindKpis.kpis.find(k => k.key === "appointments")?.available === true &&
    typeof blindKpis.kpis.find(k => k.key === "appointments")?.value === "number",
    JSON.stringify(blindKpis.kpis.find(k => k.key === "appointments")));

  await admin.from("practice_role_assignment")
    .update({ effective_to: null })
    .in("membership_id", membershipIds).eq("capability_code", "followup.view");

  // ── 7. Isolation ─────────────────────────────────────────────────────────
  const bHome = await operationsHome(admin, ctxB.ctx);
  ok("B's home shows none of A's work", bHome.attention.length === 0 && bHome.allClear === true,
    JSON.stringify(bHome.attention.map(i => i.kind)));
  const aAgain = await operationsHome(admin, ctxA.ctx);
  ok("A's home still shows A's work (the isolation test is not vacuous)",
    aAgain.attention.length >= 4, `${aAgain.attention.length}`);
  // Asserted against the same queries rather than against a guessed floor. A fresh workspace is in
  // ONBOARDING with no ACTIVE location yet, so "locations >= 1" would have been a wrong expectation
  // dressed as a passing test -- the honest check is that the figure equals what is actually there.
  const [{ count: locRows }, { count: memberRows }] = await Promise.all([
    admin.from("practice_location").select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("active", true),
    admin.from("practice_membership").select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("status", "active"),
  ]);
  ok("A's practice figures equal real counts of A's own rows",
    aAgain.practice.locations === (locRows ?? -1) && aAgain.practice.members === (memberRows ?? -1),
    JSON.stringify({ tile: aAgain.practice, rows: { locRows, memberRows } }));
  ok("the membership count is non-zero, so the check above has a subject",
    (memberRows ?? 0) > 0, `${memberRows}`);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
