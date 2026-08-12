/**
 * Booking taxonomy harness (CP-BOOKING-TAXONOMY-001). No database.
 *
 * The pure rules of the taxonomy, which are the ones that fail SILENTLY when they are wrong: a booking
 * form does not crash on a bad default, it just shows nothing selected and looks like the user has not
 * chosen yet.
 *
 * WHAT IT PROVES:
 *   1. A DEFAULT THAT IS NOT IN THE OFFERED LIST IS DISCARDED. It happens the moment somebody
 *      deactivates the item that was the default.
 *   2. AN UNREADABLE TAXONOMY REFUSES EVERY BOOKING. Empty lists must never read as "no constraint".
 *   3. A DEACTIVATED ITEM CANNOT BE BOOKED even when the id is real and the browser sent it.
 *   4. DURATION FALLS BACK TO THE VISIT TYPE and is bounded.
 *   5. BOOKING SOURCE IS DERIVED, and self-booking can never be claimed by an in-house caller.
 *
 *   npx --yes tsx scripts/practice-taxonomy-harness.ts
 */

import {
  resolveDefaults, validateChoice, deriveBookingSource,
  SEED_VISIT_TYPES, SEED_MODES, type Taxonomy, type VisitType, type ConsultationMode,
} from "../src/lib/practice/taxonomy";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const vt = (id: string, over: Partial<VisitType> = {}): VisitType => ({
  id, code: id, label: id, active: true, selfBookable: false,
  defaultDurationMinutes: 30, sortOrder: 10, systemSeeded: true, ...over,
});
const md = (id: string, over: Partial<ConsultationMode> = {}): ConsultationMode => ({
  id, code: id, label: id, active: true, selfBookable: true,
  requiresLocation: true, sortOrder: 10, systemSeeded: true, ...over,
});
const tax = (over: Partial<Taxonomy> = {}): Taxonomy => ({
  visitTypes: [vt("v1"), vt("v2")], modes: [md("m1"), md("m2")],
  defaultVisitTypeId: "v1", defaultModeId: "m1", readable: true, detail: null, ...over,
});

console.log("\nBOOKING TAXONOMY HARNESS\n");

// 1 ── defaults
{
  const lists = { visitTypes: [vt("v1"), vt("v2")], modes: [md("m1")] };
  const kept = resolveDefaults(lists, "v2", "m1");
  check("1a a configured default that IS offered is kept", kept.defaultVisitTypeId === "v2", String(kept.defaultVisitTypeId));

  // ⚠ THE ONE THAT MATTERS: the default was deactivated, so it is no longer in the list.
  const dropped = resolveDefaults(lists, "v-deactivated", "m1");
  check("1b ⚠ a default absent from the list falls back to the first offered item, never to itself",
    dropped.defaultVisitTypeId === "v1", String(dropped.defaultVisitTypeId));

  const none = resolveDefaults({ visitTypes: [], modes: [] }, "v1", "m1");
  check("1c with nothing offered there is no default, rather than a dangling id",
    none.defaultVisitTypeId === null && none.defaultModeId === null, JSON.stringify(none));
}

// 2 ── an unreadable taxonomy
{
  const r = validateChoice(tax({ readable: false, visitTypes: [], modes: [], detail: "boom" }),
    { visitTypeId: "v1", consultationModeId: "m1" });
  check("2 ⚠ an UNREADABLE taxonomy refuses the booking rather than treating empty as unconstrained",
    !r.ok && r.code === "TAXONOMY_UNAVAILABLE", JSON.stringify(r));
}

// 3 ── membership of the ACTIVE list
{
  const t = tax();
  const good = validateChoice(t, { visitTypeId: "v1", consultationModeId: "m1" });
  check("3a a valid pair is accepted", good.ok, JSON.stringify(good));

  const gone = validateChoice(t, { visitTypeId: "v-deactivated", consultationModeId: "m1" });
  check("3b ⚠ a real-looking id that is NOT in the offered list is refused, not trusted",
    !gone.ok && gone.code === "VISIT_TYPE_INVALID", JSON.stringify(gone));

  const noMode = validateChoice(t, { visitTypeId: "v1", consultationModeId: null });
  check("3c a missing mode is refused -- the whole point is that both are recorded",
    !noMode.ok && noMode.code === "MODE_REQUIRED", JSON.stringify(noMode));

  const noVisit = validateChoice(t, { visitTypeId: null, consultationModeId: "m1" });
  check("3d and a missing visit type likewise",
    !noVisit.ok && noVisit.code === "VISIT_TYPE_REQUIRED", JSON.stringify(noVisit));
}

// 4 ── duration
{
  const t = tax({ visitTypes: [vt("v1", { defaultDurationMinutes: 15 })] });
  const inherited = validateChoice(t, { visitTypeId: "v1", consultationModeId: "m1" });
  check("4a duration falls back to the visit type",
    inherited.ok && inherited.value.durationMinutes === 15, JSON.stringify(inherited));

  const overridden = validateChoice(t, { visitTypeId: "v1", consultationModeId: "m1", durationMinutes: 45 });
  check("4b an explicit duration overrides it",
    overridden.ok && overridden.value.durationMinutes === 45, JSON.stringify(overridden));

  const absurd = validateChoice(t, { visitTypeId: "v1", consultationModeId: "m1", durationMinutes: 900 });
  check("4c an absurd duration is refused", !absurd.ok && absurd.code === "DURATION_INVALID", JSON.stringify(absurd));

  // "Other" carries no minutes on purpose, and that must stay a null rather than becoming a guess.
  const other = tax({ visitTypes: [vt("v1", { defaultDurationMinutes: null })] });
  const nullDur = validateChoice(other, { visitTypeId: "v1", consultationModeId: "m1" });
  check("4d a type with no default duration yields null, not a fabricated number",
    nullDur.ok && nullDur.value.durationMinutes === null, JSON.stringify(nullDur));
}

// 5 ── provenance
{
  check("5a the patient-facing engine self-books",
    deriveBookingSource({ channel: "patient_facing" }) === "self_booked");
  check("5b in-house by the practitioner",
    deriveBookingSource({ channel: "in_house" }) === "practitioner_created");
  check("5c in-house by delegated staff is distinguished",
    deriveBookingSource({ channel: "in_house", actorIsPractitioner: false }) === "staff_created");
  check("5d a walk-in wins over the channel", deriveBookingSource({ channel: "in_house", isWalkIn: true }) === "walk_in");
  check("5e a cron books as the system", deriveBookingSource({ channel: "system" }) === "system");
  // ⚠ `unknown` IS LEGACY-ONLY. Nothing derivable may produce it, or the audit trail acquires a hole
  // that looks exactly like a migrated row.
  const everyCombination = [
    deriveBookingSource({ channel: "patient_facing" }), deriveBookingSource({ channel: "in_house" }),
    deriveBookingSource({ channel: "system" }), deriveBookingSource({ channel: "in_house", isWalkIn: true }),
    deriveBookingSource({ channel: "in_house", actorIsPractitioner: false }),
    deriveBookingSource({ channel: "patient_facing", actorIsPractitioner: false }),
  ];
  check("5f ⚠ no derivable path ever yields `unknown`, which is reserved for migrated rows",
    !everyCombination.includes("unknown" as never), everyCombination.join(","));
}

// 6 ── the seed matches what the spec froze
{
  check("6a the six visit types are seeded, and Follow-up is not called Scheduled follow-up",
    SEED_VISIT_TYPES.length === 6 && SEED_VISIT_TYPES.some(v => v.code === "follow_up" && v.label === "Follow-up"),
    SEED_VISIT_TYPES.map(v => v.label).join(" | "));
  check("6b Teleconsultation and Home visit are MODES, never visit types",
    !SEED_VISIT_TYPES.some(v => ["teleconsultation", "home_visit"].includes(v.code))
    && SEED_MODES.length === 3,
    SEED_VISIT_TYPES.map(v => v.code).join(","));
  check("6c neither remote mode requires a clinic room",
    SEED_MODES.filter(m => !m.requiresLocation).map(m => m.code).sort().join(",") === "home_visit,teleconsultation",
    SEED_MODES.map(m => `${m.code}:${m.requiresLocation}`).join(" "));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
