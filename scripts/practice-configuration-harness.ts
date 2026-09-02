/**
 * Practice configuration harness -- CPR-360, exercised against the live database through the same
 * engine the page uses.
 *
 * THE FINDING THIS MODULE STARTED FROM: practice_configuration has existed since migration 191, is
 * written once at provisioning, and NOTHING HAS EVER READ IT. The same shape as the bug CPR-310 found
 * in practice_role_assignment -- a table designed correctly and never wired up, which is worse than an
 * absent feature because it reads as a working one.
 *
 * WHAT IT PROVES:
 *   1. AN UNKNOWN TIMEZONE IS REFUSED AT THE POINT OF WRITE, because the read path cannot catch it:
 *      practiceToday() falls back to UTC on an unknown zone deliberately, so a page never dies of a bad
 *      value -- and that fallback is silent, which makes write-time validation the only place a typo is
 *      catchable at all. Paired with its control: a real zone is accepted.
 *   2. CHANGING THE CLOCK CHANGES WHAT "TODAY" MEANS, demonstrated rather than asserted in prose -- the
 *      same workspace reports a different day either side of the change, at an instant chosen to sit
 *      between two zones' dates.
 *   3. BOTH VALUES ARE RECORDED. "The timezone is Africa/Kampala" does not answer "why did last month's
 *      report move"; the audit payload carries from and to.
 *   4. THE HARDCODED 20 IS GONE. A booking with no explicit length now takes the practice's configured
 *      default, proven by changing it and booking again.
 *   5. Bounds are enforced at both ends and the engine refuses a no-op rather than writing one.
 *   6. LOCATIONS can be created, renamed and closed -- never deleted, because appointments point at
 *      them -- and the last active one CAN be closed, unlike the last owner.
 *   7. Isolation non-vacuously.
 *
 *   npx --yes tsx scripts/practice-configuration-harness.ts
 */
import { readFileSync } from "node:fs";
import { daysAhead } from "./_harness-time";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { practiceToday } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  getConfiguration, updateConfiguration, configurationHistory, defaultAppointmentMinutes,
  listLocations, createLocation, updateLocation, isKnownTimezone,
} from "../src/lib/practice/configuration";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e19e1";
const OTHER = "00000000-0000-4000-8000-0000000e19e2";

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
    idempotency_key: `harness-cfg-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-cfg",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-cfg", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-cfg" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice configuration harness (CPR-360, migration 203)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Config A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Config B (synthetic)", "b");

  // ── The table is finally read ─────────────────────────────────────────────
  const initial = await getConfiguration(admin, wsA);
  ok("the configuration row provisioning wrote is now actually READ",
    !!initial && initial.config.locale === "en-UG" && initial.workspace.timezone === "Africa/Kampala",
    JSON.stringify({ locale: initial?.config.locale, tz: initial?.workspace.timezone }));
  ok("migration 203's default appointment length is present",
    initial?.config.default_appointment_minutes === 20, `${initial?.config.default_appointment_minutes}`);
  // ── CPR-SET-004 REVERSES WHAT THIS ASSERTION USED TO SAY ────────────────────────────────────────
  //
  // "Hide all developer placeholders such as 'Not yet wired', feature flags and identifiers" /
  // "No developer/debug information visible in production."
  //
  // CPR-360 listed the inert columns BY NAME, and that was the honest choice while the alternative was
  // rendering inputs that wrote to values nothing read. But `identifier_policy` in a monospace list is a
  // COLUMN NAME on a practitioner's settings page, and it is not something they can act on. The rule
  // that actually mattered survives -- never render an input bound to a value nothing reads -- and it is
  // now enforced by those inputs not existing rather than by a list explaining them.
  // COMMENTS ARE STRIPPED FIRST. The requirement is about what a practitioner SEES, and the page's own
  // header explains which column names were removed and why -- so a naive grep fails on the very
  // sentence documenting the fix. This is the third time this session an assertion could not tell a
  // thing from its description; the answer each time is to narrow what is searched, not to soften the
  // rule.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  const settingsSource = [
    "src/app/practice/(shell)/settings/page.tsx",
    "src/app/practice/(shell)/settings/SettingsConsole.tsx",
  ].map(f => stripComments(readFileSync(f, "utf8"))).join("\n");
  const leaked = ["identifier_policy", "feature_flags", "Not yet wired"]
    .filter(name => settingsSource.includes(name));
  ok("no column name or developer placeholder reaches the settings page",
    leaked.length === 0, leaked.join(", "));
  ok("CONTROL: that check can fire, so it is not vacuous",
    ["identifier_policy"].filter(n => "x identifier_policy y".includes(n)).length === 1);
  ok("and the engine no longer hands column names to any caller",
    !("inertColumns" in (initial ?? {})), JSON.stringify(Object.keys(initial ?? {})));

  // A workspace whose configuration row is missing must be repaired on sight, not left with defaults
  // coming from nowhere.
  await admin.from("practice_configuration").delete().eq("workspace_id", wsB);
  const repaired = await getConfiguration(admin, wsB);
  ok("a workspace with no configuration row gets one created rather than failing",
    !!repaired?.config?.id && repaired.config.default_appointment_minutes === 20,
    JSON.stringify({ id: !!repaired?.config?.id }));

  // ── 1. Timezone validation, because the read path cannot catch it ────────
  ok("isKnownTimezone accepts a real zone and rejects a typo of one",
    isKnownTimezone("Africa/Kampala") && !isKnownTimezone("Africa/Kampla") && !isKnownTimezone("nonsense"),
    `${isKnownTimezone("Africa/Kampala")}/${isKnownTimezone("Africa/Kampla")}`);

  // The reason this matters, demonstrated: the read path does NOT throw on the typo -- it silently
  // answers as UTC. That is why the write must refuse it.
  ok("...and the READ path silently treats the typo as UTC (which is why write-time validation is the only catch)",
    practiceToday("Africa/Kampla", new Date("2026-03-14T22:30:00Z")) === practiceToday("UTC", new Date("2026-03-14T22:30:00Z")),
    practiceToday("Africa/Kampla", new Date("2026-03-14T22:30:00Z")));

  const badZone = await updateConfiguration(admin, { workspaceId: wsA, timezone: "Africa/Kampla", ...base });
  ok("AN UNKNOWN TIMEZONE IS REFUSED AT THE POINT OF WRITE",
    !badZone.ok && badZone.code === "UNKNOWN_TIMEZONE", badZone.ok ? "was allowed" : badZone.code);
  const { data: unchangedWs } = await admin.from("practice_workspace").select("timezone").eq("id", wsA).single();
  ok("...and the workspace still holds its original zone", unchangedWs?.timezone === "Africa/Kampala", unchangedWs?.timezone);

  // ── 2. Changing the clock changes what "today" means ─────────────────────
  // 22:30Z is the 14th in London and the 15th in Kampala, so the same instant reads as two different
  // days -- which is the whole reason this setting is loud.
  const instant = new Date("2026-03-14T22:30:00Z");
  const beforeDay = practiceToday(initial!.workspace.timezone, instant);

  const changed = await updateConfiguration(admin, { workspaceId: wsA, timezone: "Europe/London", ...base });
  ok("a REAL timezone is accepted (control for the refusal above)", changed.ok, changed.ok ? "" : changed.message);
  ok("the result reports what the clock was changed FROM",
    changed.ok && changed.data.timezoneChangedFrom === "Africa/Kampala",
    changed.ok ? String(changed.data.timezoneChangedFrom) : "");

  const after = await getConfiguration(admin, wsA);
  const afterDay = practiceToday(after!.workspace.timezone, instant);
  ok("CHANGING THE CLOCK CHANGES WHAT 'TODAY' MEANS for an instant already recorded",
    beforeDay === "2026-03-15" && afterDay === "2026-03-14", `${beforeDay} -> ${afterDay}`);

  // ── 3. Both values recorded ──────────────────────────────────────────────
  const history = await configurationHistory(admin, wsA);
  ok("the change is in the trail with BOTH values ('it is Europe/London' does not explain a moved report)",
    history.some((h: any) => h.payload?.timezoneFrom === "Africa/Kampala" && h.payload?.timezoneTo === "Europe/London"),
    JSON.stringify(history.map((h: any) => h.payload?.changed)));
  ok("no separate trail table was created for it (the audit log already carries actor and payload)",
    history.every((h: any) => h.event_type === "practice.configuration_changed"));

  await updateConfiguration(admin, { workspaceId: wsA, timezone: "Africa/Kampala", ...base });

  // ── 4. The hardcoded 20 is gone ──────────────────────────────────────────
  ok("the engine reads the configured default", (await defaultAppointmentMinutes(admin, wsA)) === 20);

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Byaruhanga Eric", birthDate: "1980-05-05", sex: "male",
    phone: "0772 555 210", ...base,
  });
  if (!pa.ok) { ok("patient registration succeeded", false, pa.message); return report(); }

  const at20 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pa.data.id, patientName: "Byaruhanga Eric",
    appointmentType: "new_consultation", scheduledAt: daysAhead(3), allowOverlap: true, ...base,
  });
  const { data: booked20 } = at20.ok
    ? await admin.from("practice_appointment").select("duration_minutes").eq("id", at20.data.id).single()
    : { data: null };
  // ⚠ THIS ASSERTED THE WRONG RUNG OF A THREE-RUNG PRECEDENCE, and it had been red since the booking
  // taxonomy shipped. CPR-360 removed a hardcoded 20 and made the WORKSPACE default the fallback;
  // migration 292 then put minutes on the VISIT TYPE, and scheduling.ts states the order in as many
  // words: "the VISIT TYPE's duration outranks the workspace default, because 'New consultation 30
  // minutes, Follow-up 15' is the whole point of putting minutes on the type. An explicit caller value
  // still wins over both."
  //
  // So a booking with no explicit length takes 30 -- the seeded new-consultation type's minutes -- and
  // the workspace default is the rung BELOW that, reachable only when the type carries none. The old
  // assertion could never pass again, and while it sat red it was also hiding the fact that nothing
  // tested the workspace-default rung at all.
  //
  // All three rungs are asserted now, in order, because the precedence IS the contract.
  const typeMinutes = booked20?.duration_minutes as number | undefined;
  // ⚠ COMPARED AGAINST THE LIVE WORKSPACE DEFAULT, NOT THE LITERAL 20. Two reasons, and the second is
  // the one that matters. tsc narrows `typeMinutes` to 30 after the first comparison and then calls
  // `!== 20` a comparison with no overlap, which is a real complaint. And an assertion that the type's
  // minutes differ from a hardcoded 20 would pass vacuously the day somebody sets the workspace default
  // TO 30 -- at which point the two rungs are indistinguishable and this assertion would say nothing
  // while looking like it said something.
  const wsDefaultNow = await defaultAppointmentMinutes(admin, wsA);
  ok("rung 2: with no explicit length, the VISIT TYPE's minutes win over the workspace default",
    typeMinutes === 30 && typeMinutes !== wsDefaultNow,
    `${typeMinutes} from the visit type, workspace default is ${wsDefaultNow}`);

  const widen = await updateConfiguration(admin, { workspaceId: wsA, defaultAppointmentMinutes: 45, ...base });
  ok("the default length can be changed", widen.ok, widen.ok ? "" : widen.message);

  const at45 = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pa.data.id, patientName: "Byaruhanga Eric",
    appointmentType: "new_consultation", scheduledAt: daysAhead(4), allowOverlap: true, ...base,
  });
  const { data: booked45 } = at45.ok
    ? await admin.from("practice_appointment").select("duration_minutes").eq("id", at45.data.id).single()
    : { data: null };
  // ⚠ THE WORKSPACE DEFAULT IS THE THIRD RUNG AND THE FIXTURE HAS TO REACH IT DELIBERATELY. Every
  // seeded visit type carries minutes, so with the taxonomy as provisioned this rung is unreachable --
  // which is exactly why the original assertion looked like it was testing the workspace default and
  // was really reading the type's. Clearing default_duration_minutes on the type this fixture books
  // through is the only way to exercise defaultAppointmentMinutes at all, and the column is nullable
  // for precisely this case (migration 292 line 41).
  const { data: vtRows } = await admin.from("practice_visit_type")
    .select("id, code, default_duration_minutes").eq("workspace_id", wsA).eq("active", true);
  const bookedThrough = ((vtRows ?? []) as { id: string; code: string; default_duration_minutes: number | null }[])
    .find(v => v.default_duration_minutes === typeMinutes) ?? (vtRows ?? [])[0];
  ok("rung 3-setup. the visit type this fixture books through was found, and it carried minutes",
    !!bookedThrough && bookedThrough.default_duration_minutes !== null,
    JSON.stringify(vtRows));
  if (bookedThrough) {
    await admin.from("practice_visit_type")
      .update({ default_duration_minutes: null }).eq("id", bookedThrough.id).eq("workspace_id", wsA);
  }
  const atDefault = await bookAppointment(admin, {
    workspaceId: wsA, patientId: pa.data.id, patientName: "Byaruhanga Eric",
    appointmentType: "new_consultation", scheduledAt: daysAhead(6), allowOverlap: true, ...base,
  });
  const { data: bookedDefault } = atDefault.ok
    ? await admin.from("practice_appointment").select("duration_minutes").eq("id", atDefault.data.id).single()
    : { data: null };
  ok("rung 3: THE HARDCODED 20 IS GONE -- with no minutes on the type, the WORKSPACE default applies",
    bookedDefault?.duration_minutes === 45,
    `${bookedDefault?.duration_minutes} (expected the workspace default, 45)`);
  ok("rung 3-control. and that is the CHANGED default, not the original 20 -- so the read is live",
    bookedDefault?.duration_minutes !== 20 && (await defaultAppointmentMinutes(admin, wsA)) === 45,
    `${bookedDefault?.duration_minutes}`);
  // Put it back, so nothing downstream in this harness books through a type with no minutes.
  if (bookedThrough) {
    await admin.from("practice_visit_type")
      .update({ default_duration_minutes: bookedThrough.default_duration_minutes })
      .eq("id", bookedThrough.id).eq("workspace_id", wsA);
  }
  // ⚠ booked45 IS NOT DISCARDED -- IT CARRIES A PROPERTY WORTH ASSERTING. It was booked AFTER the
  // workspace default moved to 45, through a type that still carried 30, so it must STILL be 30:
  // moving the workspace default does not reach past a visit type that states its own minutes.
  //
  // (Writing `void booked45` here, which is what this line was for about ninety seconds, would be the
  // same no-op-wearing-an-explanation this session just found in search.ts. Once is a bug; twice is a
  // habit, and the second one is always easier to write than the first.)
  ok("rung 2-again: moving the workspace default does NOT move a booking whose type states minutes",
    booked45?.duration_minutes === typeMinutes, `${booked45?.duration_minutes} (expected ${typeMinutes})`);
  ok("...and an explicit length still wins over the default",
    await (async () => {
      const explicit = await bookAppointment(admin, {
        workspaceId: wsA, patientId: pa.data.id, patientName: "Byaruhanga Eric", durationMinutes: 10,
        appointmentType: "new_consultation", scheduledAt: daysAhead(5), allowOverlap: true, ...base,
      });
      if (!explicit.ok) return false;
      const { data } = await admin.from("practice_appointment").select("duration_minutes").eq("id", explicit.data.id).single();
      return data?.duration_minutes === 10;
    })());

  // ── 5. Bounds and no-ops ─────────────────────────────────────────────────
  for (const [value, label] of [[2, "too short"], [500, "too long"], [22.5, "not a whole number"]] as const) {
    const refused = await updateConfiguration(admin, { workspaceId: wsA, defaultAppointmentMinutes: value, ...base });
    ok(`an appointment length that is ${label} is refused`,
      !refused.ok && refused.code === "VALIDATION_ERROR", refused.ok ? "was allowed" : refused.code);
  }
  const noop = await updateConfiguration(admin, { workspaceId: wsA, defaultAppointmentMinutes: 45, ...base });
  ok("a change that changes nothing is refused rather than written",
    !noop.ok && noop.code === "NO_CHANGE", noop.ok ? "was allowed" : noop.code);

  const emptyName = await updateConfiguration(admin, { workspaceId: wsA, practiceName: "   ", ...base });
  ok("a practice cannot be renamed to nothing", !emptyName.ok && emptyName.code === "VALIDATION_ERROR",
    emptyName.ok ? "was allowed" : emptyName.code);

  const badMode = await updateConfiguration(admin, { workspaceId: wsA, defaultEncounterMode: "telepathy", ...base });
  ok("an unknown consultation mode is refused", !badMode.ok && badMode.code === "VALIDATION_ERROR",
    badMode.ok ? "was allowed" : badMode.code);

  // ── 6. Locations ─────────────────────────────────────────────────────────
  const before = await listLocations(admin, wsA);
  const loc = await createLocation(admin, { workspaceId: wsA, name: "Ntinda branch", type: "clinic", ...base });
  ok("a location can be created (the table and its capability existed since 191 with no way in)",
    loc.ok, loc.ok ? "" : loc.message);
  if (!loc.ok) return report();
  ok("...and appears in the list", (await listLocations(admin, wsA)).length === before.length + 1);

  const noName = await createLocation(admin, { workspaceId: wsA, name: "  ", ...base });
  ok("a location cannot be created without a name", !noName.ok && noName.code === "VALIDATION_ERROR",
    noName.ok ? "was allowed" : noName.code);

  const renamed = await updateLocation(admin, { workspaceId: wsA, locationId: loc.data.id, name: "Ntinda clinic", ...base });
  ok("a location can be renamed", renamed.ok && renamed.data.changed.includes("name"),
    renamed.ok ? renamed.data.changed.join(",") : renamed.message);

  const closed = await updateLocation(admin, { workspaceId: wsA, locationId: loc.data.id, active: false, ...base });
  ok("a location can be CLOSED rather than deleted (appointments point at it)",
    closed.ok && closed.data.changed.includes("closed"), closed.ok ? closed.data.changed.join(",") : closed.message);
  const stillThere = await listLocations(admin, wsA);
  ok("...and it is still listed, inactive", stillThere.some((l: any) => l.id === loc.data.id && l.active === false));

  // Unlike the last owner: a practice with no active location is odd but workable.
  for (const l of stillThere.filter((x: any) => x.active)) {
    await updateLocation(admin, { workspaceId: wsA, locationId: l.id, active: false, ...base });
  }
  const noneActive = await listLocations(admin, wsA);
  ok("THE LAST ACTIVE LOCATION CAN BE CLOSED (unlike the last owner -- different stakes, different rule)",
    noneActive.every((l: any) => !l.active), JSON.stringify(noneActive.map((l: any) => l.active)));

  // ── 7. Isolation ─────────────────────────────────────────────────────────
  const crossSetting = await updateConfiguration(admin, { workspaceId: wsB, practiceName: "Renamed through B", ...base });
  ok("changing B's settings does not touch A", crossSetting.ok, crossSetting.ok ? "" : crossSetting.message);
  const aStill = await getConfiguration(admin, wsA);
  ok("...A still holds its own name", aStill?.workspace.name === "HARNESS Config A (synthetic)", aStill?.workspace.name);

  const crossLocation = await updateLocation(admin, { workspaceId: wsB, locationId: loc.data.id, active: true, ...base });
  ok("A's location cannot be changed through B's workspace",
    !crossLocation.ok && crossLocation.code === "NOT_FOUND", crossLocation.ok ? "was allowed" : crossLocation.code);
  ok("B's location list holds none of A's", (await listLocations(admin, wsB)).every((l: any) => l.id !== loc.data.id));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
