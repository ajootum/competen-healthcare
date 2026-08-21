"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BOOKING_CHANNELS, RULE_STATUSES, RULE_STATUS_CHIP, CONFIRMATION_MODES,
  PATIENT_ELIGIBILITY, BUILDER_SECTIONS, SPECIFICITY_DIMENSIONS,
  BOOKING_INTAKE_FIELDS, REQUIREMENT_LEVELS, REQUIREMENT_LEVEL_WHEN_UNSET,
  INTAKE_FIELDS_ALWAYS_REQUIRED, INTAKE_NOT_CONFIGURABLE,
  WALK_IN_QUEUE_POLICIES, DNA_ACTIONS, WAITING_LIST_CONTACT_NOTE,
  WAITING_LIST_NO_SCREEN_NOTE, QUEUE_PRIORITY_NO_SCREEN_NOTE,
} from "@/lib/practice/booking-rule-constants";
import { SESSION_APPOINTMENT_TYPES, appointmentTypeLabel, WEEKDAY_SHORT } from "@/lib/practice/practice-session-constants";
// ⚠ THE 24-HOUR CONTROL, NOT THE NATIVE TIME PICKER, which draws itself in the OPERATING SYSTEM's
// locale -- so a machine set to en-US renders "11:00 AM" on a screen whose every other clock is
// 24-hour. The value shape is unchanged ("10:00"), so nothing downstream moves. HHMM_RE is the same
// expression the control's own `pattern` attribute is compiled from -- imported, never re-typed.
import { TimeInput } from "@/components/ui/wall-clock";
import { HHMM_RE } from "@/lib/practice/practice-time";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 s7 -- LAYER 3's CENTRE WORKSPACE. THE RULE CARDS, THE BUILDER, AND WHY A RULE WON.
//
// AC-05: "Booking rules are created and displayed as SUMMARY CARDS, not edited primarily in one inline
// row." s7.1 lists what a card must communicate WITHOUT being opened -- name, status, scope, types,
// window, capacity, access, confirmation -- because a practitioner with four rules needs to see which
// one governs Friday without reading four forms. Every one of those lines is on the card below, and
// every one is computed from the rule rather than typed into a mock-up.
//
// ---- FIVE THINGS THIS SCREEN WILL NOT DO ------------------------------------------------------------
//
//   1. IT WILL NOT DECIDE ANYTHING. The "which rule would decide this?" panel asks the server and shows
//      what the server said. s13.1 requires the rule to be evaluated server-side, and a screen that
//      computed a verdict would be a second implementation of s11 to keep in step with the first.
//   2. IT WILL NOT DRAW A CONFLICT AS A WARNING. s11 says activation is BLOCKED until the conflict is
//      resolved, so a conflicted pair is drawn as a thing to fix, with what to do about it.
//   3. IT WILL NOT SHOW A BLANK WHERE A RULE NAME GOES. A rule written before the card model has no
//      name, and the card says that rather than printing an empty heading.
//   4. IT WILL NOT OFFER A BUILDER SECTION THIS BUILD CANNOT ENFORCE. s7.2 lists twelve; eight are real
//      inputs and four are drawn as what they are, with the phase that owns them.
//   5. IT WILL NOT OFFER A CHANNEL A BOOKING CANNOT ARRIVE THROUGH AS THOUGH IT COULD. A rule may be
//      written for all six (AC-06); the three with no door say so on the option itself.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const field = "mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800";
const labelCls = "flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500";

type Draft = Record<string, any>;

const blankDraft = (): Draft => ({
  name: "", description: "", status: "draft", priority: 0,
  effectiveFrom: "", effectiveTo: "",
  locationId: "", sessionTemplateId: "", appointmentType: "", channel: "",
  capacityTotal: "", capacityNew: "", capacityFollowUp: "", capacityUrgentReserve: "", overbookingAllowed: 0,
  patientEligibility: "any", minAgeYears: "", maxAgeYears: "",
  confirmationMode: "instant", followUpEarlyDays: "", followUpLateDays: "",
  leadTimeMinutes: 0, bookingHorizonDays: "", cancellationNoticeMinutes: 0, walkInDailyLimit: "",
  // ── MIGRATION 268. The defaults ARE the behaviour this product had before the columns existed, so a
  //    new rule created on this form decides exactly what it would have decided yesterday.
  requiredFields: {} as Record<string, string>,
  walkInCutoffMinutes: "", walkInQueuePolicy: "first_come",
  selfCancelAllowed: true, selfRescheduleAllowed: true, rescheduleNoticeMinutes: "",
  dnaThreshold: "", dnaAction: "none", waitingListEnabled: false,
  reason: "",
});

const draftFrom = (r: any): Draft => ({
  ...blankDraft(),
  name: r.name ?? "", description: r.description ?? "", status: r.status, priority: r.priority,
  effectiveFrom: r.effectiveFrom ?? "", effectiveTo: r.effectiveTo ?? "",
  locationId: r.locationId ?? "", sessionTemplateId: r.sessionTemplateId ?? "",
  appointmentType: r.appointmentType ?? "", channel: r.channel ?? "",
  capacityTotal: r.capacityTotal ?? "", capacityNew: r.capacityNew ?? "",
  capacityFollowUp: r.capacityFollowUp ?? "", capacityUrgentReserve: r.capacityUrgentReserve ?? "",
  overbookingAllowed: r.overbookingAllowed ?? 0,
  patientEligibility: r.patientEligibility ?? "any",
  minAgeYears: r.minAgeYears ?? "", maxAgeYears: r.maxAgeYears ?? "",
  confirmationMode: r.confirmationMode ?? "instant",
  followUpEarlyDays: r.followUpEarlyDays ?? "", followUpLateDays: r.followUpLateDays ?? "",
  leadTimeMinutes: r.leadTimeMinutes ?? 0, bookingHorizonDays: r.bookingHorizonDays ?? "",
  walkInDailyLimit: r.walkInDailyLimit ?? "",
  requiredFields: Object.fromEntries(Object.entries(
    (r.requiredInformation?.fields ?? {}) as Record<string, { level?: string }>,
  ).map(([k, v]) => [k, String(v?.level ?? "optional")])),
  walkInCutoffMinutes: r.walkInCutoffMinutes ?? "",
  walkInQueuePolicy: r.walkInQueuePolicy ?? "first_come",
  selfCancelAllowed: r.selfCancelAllowed !== false,
  selfRescheduleAllowed: r.selfRescheduleAllowed !== false,
  rescheduleNoticeMinutes: r.rescheduleNoticeMinutes ?? "",
  dnaThreshold: r.dnaThreshold ?? "", dnaAction: r.dnaAction ?? "none",
  waitingListEnabled: r.waitingListEnabled === true,
  reason: "",
});

/**
 * A later phase's surface, drawn as what it is. Never a control that shrugs.
 *
 * ⚠ `alreadyBuilt` IS DRAWN FIRST AND IN COLOUR, ABOVE THE "NOT BUILT" BADGE, AND THAT ORDER IS THE
 * POINT. This component used to print a title, a grey NOT BUILT chip, and a sentence -- and for
 * walk-ins the sentence said "there is no per-session walk-in limit ON THIS TABLE" while the control
 * for exactly that sat one layer away on the same screen. A qualification that only survives if the
 * reader parses a subordinate clause after reading a badge in capital letters is not a qualification.
 */
function NotBuilt({ title, phase, what, alreadyBuilt }: {
  title: string; phase: string; what: string; alreadyBuilt?: string | null;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] font-bold text-slate-600">{title}</p>
        <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {phase} — not built
        </span>
      </div>
      {alreadyBuilt && (
        <p className="mt-1.5 rounded bg-emerald-50 px-2 py-1.5 text-[11px] leading-relaxed text-emerald-900 ring-1 ring-emerald-200">
          <span className="font-bold">What you CAN set today: </span>{alreadyBuilt}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{what}</p>
    </div>
  );
}

/** A section that is built, and whose caption once said otherwise. The correction, drawn where it was. */
function WasSaidNotBuilt({ text }: { text: string }) {
  return (
    <p className="mt-1 rounded bg-emerald-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-emerald-900 ring-1 ring-emerald-200">
      <span className="font-bold">This screen used to say this was not built. </span>{text}
    </p>
  );
}

/** The one sentence a section says when its columns are not in this database. Never a dead control. */
function StoreAbsent({ note }: { note: string }) {
  return (
    <p className="mt-1.5 rounded-lg border border-dashed border-amber-300 bg-amber-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
      <span className="font-bold">Nothing here can be saved yet. </span>{note}
    </p>
  );
}

export default function RuleWorkspace({
  rules, conflicts, locations, sessions, mayAuthor, mayBook, rulesUnreadable, today,
}: {
  rules: any[]; conflicts: any[]; locations: any[]; sessions: any[];
  mayAuthor: boolean; mayBook: boolean; rulesUnreadable: string | null; today: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [probe, setProbe] = useState({
    channel: "practitioner", appointmentType: "new_consultation",
    date: today, time: "10:00", locationId: "",
  });
  const [decision, setDecision] = useState<any | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const set = (k: string, v: any) => setDraft(d => (d ? { ...d, [k]: v } : d));

  // ⚠ READ OFF THE RULES THEMSELVES, NOT ASSUMED. Every card carries whether migration 268 is applied in
  // this database, because the engine asked. When it is not, the three sections below draw a sentence
  // naming the file instead of controls that would silently save nothing -- which is the worse outcome:
  // a practitioner would leave believing a booking will be refused without a date of birth, and it will
  // not be.
  const sectionsConfigurable = rules.length === 0 ? true : rules[0].sectionsConfigurable !== false;
  const absentNote: string = rules.find((r: any) => r.sectionsAbsentNote)?.sectionsAbsentNote
    ?? "Competen Practice cannot store this yet, so it cannot be set here.";
  /** The correction sentence for a section this screen once captioned NOT BUILT. */
  const sectionNote = (key: string) =>
    BUILDER_SECTIONS.find(s => s.key === key)?.alreadyBuilt ?? "";

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/v1/practice/booking-rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setNotice(null);
    const { requiredFields, ...rest } = draft;
    // ⚠ THE MAP IS SENT ONLY WHEN THE COLUMNS EXIST, and it is sent in the engine's own shape rather
    // than the form's. The form keeps a flat { key: level } because that is what a select binds to; the
    // engine stores { fields: { key: { level } } } because a condition may hang off a field later. The
    // translation lives here, once, rather than in requiredInformationOf -- which would then have to
    // accept two shapes forever.
    const r = await post({
      action: "save_rule", ruleId: editingId, ...rest,
      ...(sectionsConfigurable
        ? {
          requiredInformation: {
            fields: Object.fromEntries(
              Object.entries(requiredFields as Record<string, string>)
                // A field left at the default is not sent at all. Storing "optional" for all fifteen
                // would make every rule's version diff unreadable and would record a choice nobody made.
                .filter(([, level]) => level !== REQUIREMENT_LEVEL_WHEN_UNSET)
                .map(([key, level]) => [key, { level }]),
            ),
          },
        }
        : {}),
    });
    setBusy(false);
    if (!r.ok) { setNotice({ kind: "err", text: r.data?.error?.message ?? "The rule was not saved." }); return; }
    setNotice({
      kind: "ok",
      text: r.data.rule.created
        ? "Rule created."
        : r.data.rule.changed.length === 0
          ? "Nothing changed, so the version did not move."
          : `Saved as version ${r.data.rule.version}. ${r.data.rule.changed.length} field${r.data.rule.changed.length === 1 ? "" : "s"} changed.`,
    });
    setDraft(null); setEditingId(null);
    router.refresh();
  }

  async function status(ruleId: string, next: string) {
    setBusy(true); setNotice(null);
    const r = await post({ action: "set_status", ruleId, status: next });
    setBusy(false);
    if (!r.ok) { setNotice({ kind: "err", text: r.data?.error?.message ?? "The rule was not changed." }); return; }
    router.refresh();
  }

  async function explain() {
    // ⚠ THE GUARD IS HERE BECAUSE THERE IS NO <form> ON THIS SCREEN. The button is type="button" with an
    // onClick, so the control's `pattern` never gets a submit to block and is decoration on this path.
    //
    // And the failure it prevents is not a wrong answer, it is a DEAD BUTTON: `new Date("...T9am:00")`
    // is an Invalid Date, and `.toISOString()` on one THROWS. Thrown here, the rejection escapes before
    // `setBusy(false)`, so the button would stay disabled with nothing on screen -- the product looking
    // broken rather than saying what is wrong.
    //
    // ⚠ THE DATE IS CHECKED TOO, AND THAT PART WAS ALREADY UNGUARDED. A date input can be CLEARED, and
    // an empty date reaches the same Invalid Date by the same route. That predates the control swap.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(probe.date)) {
      setDecisionError("Choose a date for the booking you want explained.");
      return;
    }
    if (!HHMM_RE.test(probe.time)) {
      setDecisionError("The time needs to be on the 24-hour clock, written as HH:MM — for example 09:00 or 14:30.");
      return;
    }
    setBusy(true); setDecision(null); setDecisionError(null);
    const r = await post({
      action: "evaluate", channel: probe.channel, appointmentType: probe.appointmentType,
      scheduledAt: new Date(`${probe.date}T${probe.time}:00`).toISOString(),
      locationId: probe.locationId || null,
    });
    setBusy(false);
    if (!r.ok) { setDecisionError(r.data?.error?.message ?? "No decision could be made."); return; }
    setDecision(r.data.decision);
  }

  if (rulesUnreadable)
    return (
      <p className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-gray-600">
        <span className="font-bold">Your booking rules could not be read.</span> {rulesUnreadable} This
        is not a count of nothing — it is no count at all, and nothing on this layer should be acted on
        until it loads.
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p className={`rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed ${
          notice.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
          {notice.text}
        </p>
      )}

      {/* ── s11's CONFLICTS. Not a warning: a thing that blocks activation until it is resolved. ─── */}
      {conflicts.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <h3 className="text-[13px] font-bold text-rose-900">
            {conflicts.length} pair{conflicts.length === 1 ? "" : "s"} of rules nothing can choose between
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-800/90">
            These are equally specific and equally important. Until one of them changes, any booking they
            both cover is refused rather than decided by whichever the engine happened to read first.
          </p>
          <ul className="mt-2 space-y-2">
            {conflicts.map((c, i) => (
              <li key={i} className="rounded-lg bg-white/70 px-3 py-2">
                <p className="text-[12px] font-bold text-rose-900">
                  {c.a.name ?? "An unnamed rule from before the card model"}
                  {" ↔ "}
                  {c.b.name ?? "An unnamed rule from before the card model"}
                </p>
                <p className="text-[10.5px] text-rose-800/80">
                  Both are a {c.rung.toLowerCase()} at priority {c.priority}. {c.resolution}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── s7.1's CARDS ────────────────────────────────────────────────────────────────────────── */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-[14px] text-violet-700">⚌</span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-gray-900">Your booking rules</h3>
            <p className="text-[11px] text-gray-500">
              The most specific rule that covers a booking is the one that decides it. Where two are
              equally specific, the higher priority wins.
            </p>
          </div>
          {mayAuthor && (
            <button type="button"
              onClick={() => { setDraft(blankDraft()); setEditingId(null); setNotice(null); }}
              className="ml-auto rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90">
              New rule
            </button>
          )}
        </div>

        {!mayAuthor && (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            You can see these rules and what they decide. Writing or overriding one needs the practice
            settings permission, which this account does not hold.
          </p>
        )}

        {rules.length === 0 ? (
          <p className="text-[12px] text-amber-700">
            No rule exists, so there is no notice period, no booking horizon and no capacity limit
            anywhere in this practice. Every internal booking is allowed by the platform-safe default.
          </p>
        ) : (
          <ul className="grid gap-2.5 lg:grid-cols-2">
            {rules.map(r => {
              const chip = RULE_STATUS_CHIP[r.status] ?? RULE_STATUS_CHIP.unreadable;
              return (
                <li key={r.id} className={`rounded-xl border px-3.5 py-3 ${
                  r.conflictsWith.length > 0 ? "border-rose-300 bg-rose-50/40"
                    : r.status === "active" ? "border-gray-200" : "border-dashed border-slate-300 bg-slate-50/60"}`}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-[13px] font-bold text-gray-900">
                      {r.name ?? <span className="italic font-semibold text-slate-500">Unnamed — written before the card model</span>}
                    </p>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${chip.chip}`}>
                      {chip.label}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-400">v{r.version} · priority {r.priority}</span>
                  </div>

                  {r.description && <p className="mt-0.5 text-[11px] text-gray-600">{r.description}</p>}

                  <dl className="mt-2 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[76px_minmax(0,1fr)]">
                    <dt className="font-semibold text-gray-500">Scope</dt>
                    <dd className="text-gray-800">{r.scopeLine}</dd>
                    <dt className="font-semibold text-gray-500">Types</dt>
                    <dd className="text-gray-800">
                      {r.appointmentType ? appointmentTypeLabel(r.appointmentType) : "Every appointment type"}
                    </dd>
                    <dt className="font-semibold text-gray-500">Window</dt>
                    <dd className="text-gray-800">{r.windowLine}</dd>
                    <dt className="font-semibold text-gray-500">Capacity</dt>
                    <dd className="text-gray-800">{r.capacityLine}</dd>
                    <dt className="font-semibold text-gray-500">Access</dt>
                    <dd className="text-gray-800">{r.channelLabel}</dd>
                    <dt className="font-semibold text-gray-500">Confirm</dt>
                    <dd className="text-gray-800">
                      {CONFIRMATION_MODES.find(c => c.code === r.confirmationMode)?.label ?? r.confirmationMode}
                    </dd>
                    <dt className="font-semibold text-gray-500">Patients</dt>
                    <dd className="text-gray-800">
                      {PATIENT_ELIGIBILITY.find(e => e.code === r.patientEligibility)?.label ?? r.patientEligibility}
                      {r.minAgeYears !== null || r.maxAgeYears !== null
                        ? ` · ${r.minAgeYears ?? 0} to ${r.maxAgeYears ?? 130} years` : ""}
                    </dd>
                    {/* ⚠ THE THREE NEW LINES ARE ONLY DRAWN WHERE THEY MEAN SOMETHING. With migration
                        268 unapplied they would every one of them print the platform default -- "no
                        cutoff, first come, nothing insisted on" -- which reads as a choice this practice
                        made rather than as a column that does not exist. */}
                    {r.sectionsConfigurable && (
                      <>
                        <dt className="font-semibold text-gray-500">Walk-ins</dt>
                        <dd className="text-gray-800">{r.walkInLine}</dd>
                        <dt className="font-semibold text-gray-500">Asks for</dt>
                        <dd className="text-gray-800">{r.requiredInformationLine}</dd>
                        <dt className="font-semibold text-gray-500">Changes</dt>
                        <dd className="text-gray-800">{r.cancellationLine}</dd>
                      </>
                    )}
                  </dl>

                  {!r.sectionsConfigurable && r.sectionsAbsentNote && (
                    <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[10.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                      {r.sectionsAbsentNote}
                    </p>
                  )}

                  <p className="mt-2 border-t border-black/5 pt-1.5 text-[10px] leading-relaxed text-gray-500">
                    <span className="font-semibold text-violet-700">{r.rung}</span> — {r.reasons.join(" ")}
                  </p>

                  {r.conflictsWith.length > 0 && (
                    <p className="mt-1.5 rounded bg-rose-100/70 px-2 py-1 text-[10.5px] font-semibold text-rose-800">
                      Deadlocked with {r.conflictsWith.length} other rule
                      {r.conflictsWith.length === 1 ? "" : "s"}. Bookings both cover are refused, not guessed.
                    </p>
                  )}

                  {mayAuthor && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" disabled={busy}
                        onClick={() => { setDraft(draftFrom(r)); setEditingId(r.id); setNotice(null); }}
                        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        Edit
                      </button>
                      {RULE_STATUSES.filter(s => s.code !== r.status && s.code !== "draft").map(s => (
                        <button key={s.code} type="button" disabled={busy}
                          onClick={() => status(r.id, s.code)}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                          {s.code === "active" ? "Put in force" : s.code === "paused" ? "Pause" : "Archive"}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── s7.2's BUILDER ──────────────────────────────────────────────────────────────────────── */}
      {draft && (
        <section className={card}>
          <h3 className="text-[14px] font-bold text-gray-900">
            {editingId ? "Edit this rule" : "New booking rule"}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            {editingId
              ? "Saving records a new version and keeps the old one, so a booking made under the current version can still be explained after this changes."
              : "A rule starts as a draft. It decides nothing until you put it in force."}
          </p>

          <div className="mt-3 space-y-4">
            {/* IDENTITY */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Identity</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className={`${labelCls} sm:col-span-2`}>Name
                  <input className={field} value={draft.name} maxLength={120}
                    onChange={e => set("name", e.target.value)} placeholder="TMR Friday Specialist Clinic" />
                </label>
                <label className={labelCls}>Status
                  <select className={field} value={draft.status} onChange={e => set("status", e.target.value)}>
                    {RULE_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Priority (higher wins a tie)
                  <input className={field} type="number" min={0} max={1000} value={draft.priority}
                    onChange={e => set("priority", e.target.value)} />
                </label>
                <label className={`${labelCls} sm:col-span-2 lg:col-span-4`}>Description
                  <input className={field} value={draft.description} maxLength={1000}
                    onChange={e => set("description", e.target.value)} />
                </label>
                <label className={labelCls}>In force from
                  <input className={field} type="date" value={draft.effectiveFrom}
                    onChange={e => set("effectiveFrom", e.target.value)} />
                </label>
                <label className={labelCls}>In force until
                  <input className={field} type="date" value={draft.effectiveTo}
                    onChange={e => set("effectiveTo", e.target.value)} />
                </label>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                A rule with BOTH dates set is a temporary exception and outranks your standing rules for
                those days. One date on its own is just a start date, and changes nothing about which
                rule wins.
              </p>
            </fieldset>

            {/* SCOPE */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Scope</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className={labelCls}>Location
                  <select className={field} value={draft.locationId} onChange={e => set("locationId", e.target.value)}>
                    <option value="">Whole practice</option>
                    {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Recurring session
                  <select className={field} value={draft.sessionTemplateId}
                    onChange={e => set("sessionTemplateId", e.target.value)}>
                    <option value="">Any session</option>
                    {sessions.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {WEEKDAY_SHORT[s.weekday]} · {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>Appointment type
                  <select className={field} value={draft.appointmentType}
                    onChange={e => set("appointmentType", e.target.value)}>
                    <option value="">Every type</option>
                    {SESSION_APPOINTMENT_TYPES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Booking channel
                  <select className={field} value={draft.channel} onChange={e => set("channel", e.target.value)}>
                    <option value="">Every channel</option>
                    {BOOKING_CHANNELS.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.label}{c.door ? "" : ` (${c.phase} — no booking can arrive this way yet)`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                Each thing you name here makes this rule more specific, and a more specific rule wins:{" "}
                {SPECIFICITY_DIMENSIONS.map(d => d.label).join(" beats ")}.
              </p>
            </fieldset>

            {/* WINDOW */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Booking window</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className={labelCls}>Opens this many days ahead
                  <input className={field} type="number" min={1} max={730} value={draft.bookingHorizonDays}
                    onChange={e => set("bookingHorizonDays", e.target.value)} placeholder="no limit" />
                </label>
                <label className={labelCls}>Closes this many minutes before
                  <input className={field} type="number" min={0} max={43200} value={draft.leadTimeMinutes}
                    onChange={e => set("leadTimeMinutes", e.target.value)} />
                </label>
                <label className={labelCls}>Cancellation notice (minutes)
                  <input className={field} type="number" min={0} max={43200} value={draft.cancellationNoticeMinutes}
                    onChange={e => set("cancellationNoticeMinutes", e.target.value)} />
                </label>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                The cancellation notice is recorded and reported. It never refuses a cancellation — a
                practice that cannot cancel a booking because of a policy setting is a practice with a
                wrong diary.
              </p>
            </fieldset>

            {/* CAPACITY */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Capacity, per session</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <label className={labelCls}>Total a session
                  <input className={field} type="number" min={0} max={500} value={draft.capacityTotal}
                    onChange={e => set("capacityTotal", e.target.value)} placeholder="no limit" />
                </label>
                <label className={labelCls}>New consultations
                  <input className={field} type="number" min={0} max={500} value={draft.capacityNew}
                    onChange={e => set("capacityNew", e.target.value)} placeholder="no limit" />
                </label>
                <label className={labelCls}>Follow-ups
                  <input className={field} type="number" min={0} max={500} value={draft.capacityFollowUp}
                    onChange={e => set("capacityFollowUp", e.target.value)} placeholder="no limit" />
                </label>
                <label className={labelCls}>Held for urgent
                  <input className={field} type="number" min={0} max={100} value={draft.capacityUrgentReserve}
                    onChange={e => set("capacityUrgentReserve", e.target.value)} placeholder="0" />
                </label>
                <label className={labelCls}>Overbooking allowed
                  <input className={field} type="number" min={0} max={50} value={draft.overbookingAllowed}
                    onChange={e => set("overbookingAllowed", e.target.value)} />
                </label>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                Counted against the session the appointment falls in, not the day. What you set aside
                cannot add up to more than the total — a reserve larger than the session is a rule that
                could never be satisfied.
              </p>
            </fieldset>

            {/* ELIGIBILITY */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Eligibility</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className={`${labelCls} sm:col-span-2`}>Which patients
                  <select className={field} value={draft.patientEligibility}
                    onChange={e => set("patientEligibility", e.target.value)}>
                    {PATIENT_ELIGIBILITY.map(e => <option key={e.code} value={e.code}>{e.label}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Youngest age
                  <input className={field} type="number" min={0} max={130} value={draft.minAgeYears}
                    onChange={e => set("minAgeYears", e.target.value)} placeholder="any" />
                </label>
                <label className={labelCls}>Oldest age
                  <input className={field} type="number" min={0} max={130} value={draft.maxAgeYears}
                    onChange={e => set("maxAgeYears", e.target.value)} placeholder="any" />
                </label>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                Eligibility decides WHOSE rule this is, not whether to refuse them. A booking this rule
                does not describe is decided by the next rule down, not turned away.
              </p>
            </fieldset>

            {/* FOLLOW-UPS AND CONFIRMATION */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Follow-ups and confirmation</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className={labelCls}>May be booked this early (days)
                  <input className={field} type="number" min={0} max={365} value={draft.followUpEarlyDays}
                    onChange={e => set("followUpEarlyDays", e.target.value)} placeholder="no limit" />
                </label>
                <label className={labelCls}>And this late (days)
                  <input className={field} type="number" min={0} max={365} value={draft.followUpLateDays}
                    onChange={e => set("followUpLateDays", e.target.value)} placeholder="no limit" />
                </label>
                <label className={`${labelCls} sm:col-span-2`}>Confirmation
                  <select className={field} value={draft.confirmationMode}
                    onChange={e => set("confirmationMode", e.target.value)}>
                    {CONFIRMATION_MODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>

            {/* ── s7.2's REQUIRED INFORMATION (migration 268) ─────────────────────────────────── */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Required information</legend>
              <WasSaidNotBuilt text={sectionNote("required_information")} />
              {!sectionsConfigurable ? (
                <StoreAbsent note={absentNote} />
              ) : (
                <>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500">
                    These are the questions a patient booking can ask, and they are the questions this
                    build has somewhere to put. A required answer that is missing refuses the booking on
                    the server — not only on the form. Leaving one alone means it is accepted if given and
                    demanded of nobody, which is what happened before this section existed.
                  </p>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {BOOKING_INTAKE_FIELDS.map(f => {
                      const fixed = INTAKE_FIELDS_ALWAYS_REQUIRED.includes(f.field_key);
                      const level = fixed ? "required"
                        : (draft.requiredFields[f.field_key] ?? REQUIREMENT_LEVEL_WHEN_UNSET);
                      return (
                        <div key={f.field_key} className="rounded-lg border border-gray-200 px-2.5 py-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[11.5px] font-semibold text-gray-800">{f.label}</p>
                            {fixed && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                                always asked
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{f.help}</p>
                          <select
                            className={`${field} disabled:bg-gray-50 disabled:text-gray-500`}
                            value={level} disabled={fixed}
                            onChange={e => set("requiredFields", { ...draft.requiredFields, [f.field_key]: e.target.value })}>
                            {REQUIREMENT_LEVELS.map(l => (
                              <option key={l.code} value={l.code}>{l.label}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  {/* ⚠ LISTED, NOT OMITTED. A section that offers most of what it names and says nothing
                      about the rest reads as complete. */}
                  <ul className="mt-1.5 space-y-1">
                    {INTAKE_NOT_CONFIGURABLE.map(n => (
                      <li key={n.what} className="rounded border border-dashed border-slate-300 bg-slate-50/70 px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-600">
                        <span className="font-bold">{n.what}: </span>{n.whyNot}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </fieldset>

            {/* ── s7.7's WALK-INS (migration 268) ─────────────────────────────────────────────── */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Walk-ins</legend>
              <WasSaidNotBuilt text={sectionNote("walk_ins")} />
              {!sectionsConfigurable ? (
                <StoreAbsent note={absentNote} />
              ) : (
                <>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <label className={labelCls}>Walk-ins a day (this rule)
                      <input className={field} type="number" min={0} max={200} value={draft.walkInDailyLimit}
                        onChange={e => set("walkInDailyLimit", e.target.value)} placeholder="no limit" />
                    </label>
                    <label className={labelCls}>Stop taking them this long before a session ends
                      <input className={field} type="number" min={1} max={720} value={draft.walkInCutoffMinutes}
                        onChange={e => set("walkInCutoffMinutes", e.target.value)} placeholder="no cutoff" />
                    </label>
                    <label className={`${labelCls} sm:col-span-2 lg:col-span-1`}>Who is seen first
                      <select className={field} value={draft.walkInQueuePolicy}
                        onChange={e => set("walkInQueuePolicy", e.target.value)}>
                        {WALK_IN_QUEUE_POLICIES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                      </select>
                    </label>
                  </div>
                  {draft.walkInQueuePolicy === "priority_then_first_come" && (
                    <p className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                      {QUEUE_PRIORITY_NO_SCREEN_NOTE}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                    Whether a session takes walk-ins at all, and how many it takes, is set on the session
                    itself under <span className="font-semibold">My Regular Practice</span>. The stricter
                    of the two limits refuses the walk-in, and the refusal names which one it was. An
                    authorised person may lift any of these with a reason, which is recorded before the
                    walk-in is booked.
                  </p>
                </>
              )}
            </fieldset>

            {/* ── s7.2's CANCELLATIONS (migrations 268 and 269) ───────────────────────────────── */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Cancellations and missed appointments</legend>
              <WasSaidNotBuilt text={sectionNote("cancellations")} />
              {!sectionsConfigurable ? (
                <StoreAbsent note={absentNote} />
              ) : (
                <>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex items-start gap-1.5 text-[11px] text-gray-700">
                      <input type="checkbox" className="mt-0.5" checked={draft.selfCancelAllowed !== false}
                        onChange={e => set("selfCancelAllowed", e.target.checked)} />
                      Patients may cancel their own booking
                    </label>
                    <label className="flex items-start gap-1.5 text-[11px] text-gray-700">
                      <input type="checkbox" className="mt-0.5" checked={draft.selfRescheduleAllowed !== false}
                        onChange={e => set("selfRescheduleAllowed", e.target.checked)} />
                      Patients may move their own booking
                    </label>
                    <label className={labelCls}>Notice to move it (minutes)
                      <input className={field} type="number" min={0} max={43200} value={draft.rescheduleNoticeMinutes}
                        onChange={e => set("rescheduleNoticeMinutes", e.target.value)}
                        placeholder="same as cancelling" />
                    </label>
                    <label className="flex items-start gap-1.5 text-[11px] text-gray-700">
                      <input type="checkbox" className="mt-0.5" checked={draft.waitingListEnabled === true}
                        onChange={e => set("waitingListEnabled", e.target.checked)} />
                      Offer freed time to a waiting list
                    </label>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className={labelCls}>After this many missed appointments
                      <input className={field} type="number" min={0} max={50} value={draft.dnaThreshold}
                        onChange={e => set("dnaThreshold", e.target.value)} placeholder="no rule" />
                    </label>
                    <label className={labelCls}>…this happens
                      <select className={field} value={draft.dnaAction}
                        onChange={e => set("dnaAction", e.target.value)}>
                        {DNA_ACTIONS.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                    The cancellation notice above is what a PATIENT is held to. It never refuses you — a
                    practice that cannot take a booking out of its own diary is a practice with a wrong
                    diary. Every cancellation now records who made it, why, and whether it was inside the
                    notice.
                  </p>
                  {draft.waitingListEnabled === true && (
                    // ⚠ SAID WHERE THE SWITCH IS, not in a footnote. A waiting list is the one thing here
                    // that can be believed into existence: "we'll let you know" is what it MEANS.
                    <p className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                      {WAITING_LIST_NO_SCREEN_NOTE} {WAITING_LIST_CONTACT_NOTE}
                    </p>
                  )}
                </>
              )}
            </fieldset>

            {/* WHAT IS NOT HERE (s7.2's remaining sections) */}
            <div className="grid gap-2 sm:grid-cols-2">
              {BUILDER_SECTIONS.filter(s => !s.built).map(s => (
                <NotBuilt key={s.key} title={s.title} phase={s.phase ?? "A later phase"} what={s.note}
                  alreadyBuilt={s.alreadyBuilt} />
              ))}
            </div>

            <label className={labelCls}>Why are you changing this? (kept with the version)
              <input className={field} value={draft.reason} maxLength={500}
                onChange={e => set("reason", e.target.value)} placeholder="Too many no-shows on unconfirmed first visits" />
            </label>

            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={save}
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {editingId ? "Save this version" : "Create rule"}
              </button>
              <button type="button" disabled={busy} onClick={() => { setDraft(null); setEditingId(null); }}
                className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── s11: "USERS MUST BE ABLE TO SEE WHY A RULE WON" ─────────────────────────────────────── */}
      <section className={card}>
        <h3 className="text-[14px] font-bold text-gray-900">Which rule would decide this?</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Describe a booking and the server evaluates it exactly as it would if somebody made it. Nothing
          is booked, and nothing on this page decides anything — the answer comes from the same code that
          refuses a real booking.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className={labelCls}>Channel
            <select className={field} value={probe.channel}
              onChange={e => setProbe(p => ({ ...p, channel: e.target.value }))}>
              {BOOKING_CHANNELS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>
          <label className={labelCls}>Appointment type
            <select className={field} value={probe.appointmentType}
              onChange={e => setProbe(p => ({ ...p, appointmentType: e.target.value }))}>
              {SESSION_APPOINTMENT_TYPES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <label className={labelCls}>Location
            <select className={field} value={probe.locationId}
              onChange={e => setProbe(p => ({ ...p, locationId: e.target.value }))}>
              <option value="">No location</option>
              {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className={labelCls}>Date
            <input className={field} type="date" value={probe.date}
              onChange={e => setProbe(p => ({ ...p, date: e.target.value }))} />
          </label>
          <label className={labelCls}>Time
            <TimeInput className={field} value={probe.time} placeholder="10:00"
              onChange={v => setProbe(p => ({ ...p, time: v }))} />
          </label>
        </div>
        <button type="button" disabled={busy || !mayBook} onClick={explain}
          className="mt-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Ask the engine
        </button>

        {decisionError && (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] leading-relaxed text-rose-800 ring-1 ring-rose-200">
            {decisionError}
          </p>
        )}

        {decision && (
          <div className="mt-2.5 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
            <p className="text-[12.5px] font-bold text-gray-900">
              {decision.decidedBy === "platform_default"
                ? "No rule covers this booking."
                : `“${decision.ruleName ?? "An unnamed rule from before the card model"}” would decide it, at version ${decision.ruleVersion}.`}
            </p>
            <p className="text-[10.5px] text-gray-500">{decision.rung}</p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-gray-700">
              {decision.why.map((w: string, i: number) => <li key={i}>· {w}</li>)}
            </ul>
            {decision.runnersUp.length > 0 && (
              <p className="mt-1.5 text-[10.5px] text-gray-500">
                Beaten: {decision.runnersUp.map((r: any) => `${r.name ?? "unnamed"} (${r.rung.toLowerCase()}, priority ${r.priority})`).join("; ")}.
              </p>
            )}
            {decision.capacity && (
              <p className="mt-1.5 text-[10.5px] text-gray-600">
                {decision.capacity.windowLabel} holds {decision.capacity.used}
                {decision.capacity.ceiling !== null ? ` of ${decision.capacity.ceiling}` : ""} so far.
              </p>
            )}
            {decision.refusals.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {decision.refusals.map((r: any, i: number) => (
                  <li key={i} className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900 ring-1 ring-amber-200">
                    {r.message}{r.overridable ? " An authorised override with a reason could lift this." : " This cannot be overridden."}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] font-semibold text-emerald-700">
                This booking would be allowed, and created as {decision.initialStatus === "CONFIRMED" ? "a confirmed appointment" : "a request"}.
              </p>
            )}
            {decision.notes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[10px] leading-relaxed text-gray-500">
                {decision.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
