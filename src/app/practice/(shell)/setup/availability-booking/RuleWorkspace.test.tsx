/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-RULES-HFE-001 -- the Rules Centre render pin.
 *
 * renderToString of the real component with fixtures typed against the ENGINE's own BookingRuleCard,
 * so the fixture cannot drift from the card shape the page actually serialises (the type import is
 * erased at runtime -- nothing here touches a database).
 *
 * What this pins, and why each is worth a test:
 *
 *   1. THE LANDING RENDERS EVERY RULE IT IS GIVEN, grouped by target -- a rule the grouping logic
 *      dropped would vanish from the screen while staying in force, which is the worst possible
 *      failure for a rules surface.
 *   2. THE HFE-11 BOUNDARY HOLDS AT RENDER TIME, not merely in source: no build archaeology, no
 *      migration number, no build-phase name reaches the HTML. The refusal harness scans source;
 *      this scans OUTPUT, which is what a practitioner actually receives.
 *   3. NUMERIC PRIORITY STAYS OFF THE CARD FACE (s8). It may appear only inside the
 *      "why does this apply?" drawer of a rule that genuinely carries one.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import RuleWorkspace from "./RuleWorkspace";
import type { BookingRuleCard } from "@/lib/practice/booking-rules";

const base: Omit<BookingRuleCard, "id" | "name" | "status"> = {
  description: null, priority: 0, version: 1,
  effectiveFrom: null, effectiveTo: null,
  locationId: null, locationName: null, sessionTemplateId: null, sessionName: null,
  appointmentType: null, channel: null, channelLabel: "Every channel",
  scopeLine: "Whole practice", windowLine: "Bookings open 120 days ahead and close 30 minutes before it.",
  capacityLine: "20 a session", confirmationMode: "instant",
  patientEligibility: "any", minAgeYears: null, maxAgeYears: null,
  followUpEarlyDays: null, followUpLateDays: null,
  capacityTotal: 20, capacityNew: 5, capacityFollowUp: 13, capacityUrgentReserve: 2,
  overbookingAllowed: 0, leadTimeMinutes: 30, bookingHorizonDays: 120,
  visibility: "public", walkInDailyLimit: 4,
  specificity: 0, rung: "Whole-practice rule",
  reasons: ["It applies to your whole practice, so it is the rule that decides when nothing more specific does."],
  legacy: false, conflictsWith: [],
  sectionsConfigurable: true, sectionsAbsentNote: null,
  requiredInformation: { fields: { contact_phone: { level: "required" } } },
  requiredFieldLabels: ["Phone number"],
  walkInCutoffMinutes: 90, walkInQueuePolicy: "first_come",
  selfCancelAllowed: true, selfRescheduleAllowed: true, rescheduleNoticeMinutes: null,
  cancellationNoticeMinutes: 120, dnaThreshold: null, dnaAction: "none", waitingListEnabled: false,
  walkInLine: "4 walk-ins a day · none in the last 1 hour of a session · the waiting room is first come, first seen.",
  cancellationLine: "Patients may cancel their own booking up to 2 hours' notice before it · and moving one follows the same notice · You are never refused by any of this.",
  requiredInformationLine: "A name, Phone number.",
};

const rules: BookingRuleCard[] = [
  { ...base, id: "r-practice", name: "Standard booking window", status: "active" },
  {
    ...base, id: "r-clinic", name: "TMR Friday Specialist Clinic", status: "active",
    sessionTemplateId: "s-fri", sessionName: "Friday Specialist Clinic",
    locationId: "l-tmr", locationName: "TMR International Hospital",
    scopeLine: "TMR International Hospital · Friday Specialist Clinic",
    specificity: 24, rung: "Session rule", reasons: ["It names the session it governs.", "It names the place."],
  },
  {
    ...base, id: "r-holiday", name: "Holiday exception", status: "active",
    effectiveFrom: "2026-12-24", effectiveTo: "2026-12-26",
    specificity: 32, rung: "Dated rule", reasons: ["It applies only between two dates."],
  },
  // A row written before rules had names, carrying a real priority -- the one place the number may show.
  { ...base, id: "r-legacy", name: null, status: "paused", legacy: true, priority: 5 },
];

// s-fri carries its own session-scoped rule (r-clinic); s-wed inherits the practice-wide one.
const sessions = [
  { id: "s-fri", weekday: 5, name: "Friday Specialist Clinic", startsMinute: 510, endsMinute: 780, locationId: "l-tmr", capacity: 20, bookingMode: "public" },
  { id: "s-wed", weekday: 3, name: "Wednesday Clinic", startsMinute: 510, endsMinute: 720, locationId: null, capacity: null, bookingMode: "internal" },
];
const locations = [{ id: "l-tmr", name: "TMR International Hospital" }];
const conflicts = [{
  a: { id: "r-practice", name: "Standard booking window" },
  b: { id: "r-legacy", name: null },
  rung: "Whole-practice rule", priority: 0,
  resolution: "Change either rule's scope or priority so one of them wins.",
}];

// useRouter/Link need an app router in context. The stub records nothing: rendering must not navigate.
const routerStub = {
  back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, hmrRefresh() {},
} as never;

function render(props: Partial<Parameters<typeof RuleWorkspace>[0]> = {}): string {
  return renderToString(
    React.createElement(
      AppRouterContext.Provider, { value: routerStub },
      React.createElement(RuleWorkspace, {
        rules: rules as never, conflicts: conflicts as never,
        locations: locations as never, sessions: sessions as never,
        mayAuthor: true, mayBook: true, rulesUnreadable: null, today: "2026-08-28",
        ...props,
      }),
    ),
    // React separates adjacent SSR text nodes with an empty comment; a reader sees the joined
    // sentence, so the assertions compare against what a reader sees.
  ).replace(/<!-- -->/g, "");
}

describe("the Rules Centre landing (CPR-RULES-HFE-001)", () => {
  const html = render();

  it("renders the s4 landing: title, subtitle, create action, search and every filter chip", () => {
    for (const s of [
      "Rules", "Control how your practice, clinics and bookings operate.", "+ Create rule",
      "Search rules by name, clinic, location or type",
      "All", "Clinics", "Booking", "Capacity", "Patients", "Walk-ins", "Changes", "Exceptions",
    ]) expect(html).toContain(s);
  });

  it("summarises what is in force and what needs attention", () => {
    expect(html).toContain("3 active");
    expect(html).toContain("0 drafts");
    expect(html).toContain("1 temporary exception");
    expect(html).toContain("1 conflict");
  });

  it("groups every rule under its human target -- none vanishes", () => {
    for (const s of [
      "Practice-wide rules", "Clinic &amp; session rules", "Temporary exceptions",
      "Standard booking window", "TMR Friday Specialist Clinic", "Holiday exception", "Unnamed rule",
    ]) expect(html).toContain(s);
  });

  it("draws compact structured badges, not prose, on the card face", () => {
    for (const s of [
      "2026-12-24 → 2026-12-26", "Opens 120d ahead", "Closes 30 min before",
      "20 places", "4 walk-ins a day", "Public booking",
    ]) expect(html).toContain(s);
  });

  it("keeps the full behaviour and the why one open away (s12), and the explain panel present", () => {
    for (const s of ["Everything this rule says", "Why does this rule apply?", "Which rule would decide this?"])
      expect(html).toContain(s);
  });

  it("draws a conflict as a deadlock to fix, naming both rules", () => {
    expect(html).toContain("nothing can choose between");
    expect(html).toContain("An unnamed rule");
  });

  it("HFE-11 at render time: no archaeology, migration number or build phase reaches the HTML", () => {
    for (const bad of [/card model/i, /\bmigrations?\s+[0-9]/i, /\bPhase [0-9]\b/, /not built/i, /used to say/i])
      expect(html).not.toMatch(bad);
  });

  it("s8: numeric priority is absent from the card face, present only in the drawer of the rule that has one", () => {
    // The drawer sentence appears exactly once -- for the legacy rule carrying priority 5 -- and the
    // header row carries no "priority" at all.
    const drawerMentions = html.match(/used only to settle a tie/g) ?? [];
    expect(drawerMentions.length).toBe(1);
    expect(html).toContain("Priority 5");
  });

  it("says plainly when the account may only read", () => {
    const readonly = render({ mayAuthor: false });
    expect(readonly).toContain("Writing or overriding one needs the practice");
    expect(readonly).not.toContain("+ Create rule");
  });

  it("an unreadable rules store renders the outage, never an empty centre", () => {
    const out = render({ rulesUnreadable: "The rules table did not answer." });
    expect(out).toContain("Your rules could not be read.");
    expect(out).not.toContain("+ Create rule");
  });
});

describe("clinics as first-class rule targets (s6/s8)", () => {
  const html = render();

  it("renders a panel per session with its identity line", () => {
    expect(html).toContain("Clinics &amp; sessions");
    expect(html).toContain("Wednesday Clinic");
    expect(html).toContain("08:30–13:00");
  });

  it("says which clinic is overridden and which inherits, with the source rule named", () => {
    expect(html).toContain("Set for this clinic");
    expect(html).toContain("Restore inherited behaviour");
    expect(html).toContain("Inherited");
    expect(html).toContain("Behaviour here is inherited from");
    expect(html).toContain("Override for this clinic");
  });

  it("the read-only account sees the composed view but no override or restore actions", () => {
    const readonly = render({ mayAuthor: false });
    expect(readonly).toContain("Clinics &amp; sessions");
    expect(readonly).not.toContain("Override for this clinic");
    expect(readonly).not.toContain("Restore inherited behaviour");
  });
});

describe("the clinic rule chain composes the way the engine decides", () => {
  it("orders by the engine's own keys, excludes rules that cannot meet a booking here, and skips paused ones", async () => {
    const { clinicRuleChain, clinicGoverningRule } = await import("@/lib/practice/booking-rule-constants");
    const chain = clinicRuleChain({ id: "s-fri", locationId: "l-tmr" }, rules as never, { appointmentType: () => "x" });
    // r-legacy is paused -> out. Order: dated holiday (32) above the session rule (24) above practice (0).
    expect(chain.map(e => e.rule.id)).toEqual(["r-holiday", "r-clinic", "r-practice"]);
    // The dated head is QUALIFIED -- it cannot caption the panel -- so the session rule governs.
    expect(chain[0].unqualified).toBe(false);
    expect(chain[0].qualifiers.join(" ")).toContain("2026-12-24 to 2026-12-26 only");
    expect(clinicGoverningRule(chain)?.id).toBe("r-clinic");
    // A session at another location without a session rule of its own inherits the practice rule.
    const wed = clinicRuleChain({ id: "s-wed", locationId: null }, rules as never);
    expect(wed.map(e => e.rule.id)).toEqual(["r-holiday", "r-practice"]);
    expect(clinicGoverningRule(wed)?.id).toBe("r-practice");
  });
});
