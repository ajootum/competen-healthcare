"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BOOKING_CHANNELS, RULE_STATUSES, RULE_STATUS_CHIP, CONFIRMATION_MODES,
  PATIENT_ELIGIBILITY, BUILDER_SECTIONS,
  BOOKING_INTAKE_FIELDS, REQUIREMENT_LEVELS, REQUIREMENT_LEVEL_WHEN_UNSET,
  INTAKE_FIELDS_ALWAYS_REQUIRED, INTAKE_NOT_CONFIGURABLE,
  WALK_IN_QUEUE_POLICIES, DNA_ACTIONS, WAITING_LIST_CONTACT_NOTE,
  WAITING_LIST_NO_SCREEN_NOTE, QUEUE_PRIORITY_NO_SCREEN_NOTE,
  RULE_CATEGORIES, ruleCategory, RULE_FILTER_CHIPS, ruleCategoryKeys,
  RULE_COMPOSER_SECTIONS, type RuleComposerSection,
  clinicRuleChain, clinicGoverningRule, minuteOfDayAsClock,
  plainWindow, plainCapacity, plainWalkIn, plainCancellation, plainRequiredInformation,
  type RequiredInformation, type RequirementLevel,
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
// CPR-RULES-HFE-001 -- THE RULES CENTRE. Categorised, searchable, and authored by intent.
//
// The practitioner's question order is frozen (s2): what do I want to control -> where should it apply
// -> what changes -> when does it apply -> what will happen. The composer below asks in that order and
// only opens the sections the chosen task needs. Specificity, tie-breaking and priority remain ENGINE
// concerns: this screen never computes a verdict (the "which rule would decide this?" panel asks the
// server), never draws a conflict as a mere warning (activation is blocked until it is resolved), and
// hides numeric priority everywhere except the Advanced path (s8).
//
// ---- WHAT THE REDESIGN DID NOT CHANGE --------------------------------------------------------------
//
//   The save payload, the route, the evaluator, the versioning and every engine sentence are exactly
//   what they were. A category is presentation: every path writes the same rule shape through the same
//   save, and a hidden section's values ride through an edit untouched because the whole draft is
//   always submitted (s15's no-data-loss rule).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const field = "mt-0.5 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800";
const labelCls = "flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500";
const badgeCls = "rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700";

type Draft = Record<string, any>;

const blankDraft = (): Draft => ({
  name: "", description: "", status: "draft", priority: 0,
  effectiveFrom: "", effectiveTo: "",
  locationId: "", sessionTemplateId: "", appointmentType: "", channel: "",
  capacityTotal: "", capacityNew: "", capacityFollowUp: "", capacityUrgentReserve: "", overbookingAllowed: 0,
  patientEligibility: "any", minAgeYears: "", maxAgeYears: "",
  confirmationMode: "instant", followUpEarlyDays: "", followUpLateDays: "",
  leadTimeMinutes: 0, bookingHorizonDays: "", visibility: "internal", cancellationNoticeMinutes: 0, walkInDailyLimit: "",
  // The defaults ARE the behaviour this product had before these sections existed, so a new rule
  // created on this form decides exactly what it would have decided before them.
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
  leadTimeMinutes: r.leadTimeMinutes ?? 0, bookingHorizonDays: r.bookingHorizonDays ?? "", visibility: r.visibility ?? "internal",
  // ⚠ READ FROM THE CARD, WHICH NOW CARRIES IT. While it did not, this line did not exist, the draft
  // opened at 0, and the first save silently wrote 0 over a real notice period.
  cancellationNoticeMinutes: r.cancellationNoticeMinutes ?? 0,
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

/** "" -> null, anything else -> its number. The draft stores what an input binds to. */
const numOrNull = (v: any): number | null =>
  v === "" || v === null || v === undefined ? null : Number(v);

/** Which composer sections a stored rule actually constrains, so an edit opens what matters. */
function sectionsSetByRule(r: any): RuleComposerSection[] {
  const out: RuleComposerSection[] = [];
  if (r.bookingHorizonDays !== null || (r.leadTimeMinutes ?? 0) > 0 || (r.visibility ?? "internal") !== "internal")
    out.push("window");
  if (r.capacityTotal !== null || r.capacityNew !== null || r.capacityFollowUp !== null
    || (r.capacityUrgentReserve ?? 0) > 0 || (r.overbookingAllowed ?? 0) > 0) out.push("capacity");
  if ((r.patientEligibility ?? "any") !== "any" || r.minAgeYears !== null || r.maxAgeYears !== null)
    out.push("eligibility");
  if ((r.confirmationMode ?? "instant") !== "instant" || r.followUpEarlyDays !== null || r.followUpLateDays !== null)
    out.push("confirmation");
  if (Object.keys(r.requiredInformation?.fields ?? {}).length > 0) out.push("required_information");
  if (r.walkInDailyLimit !== null || r.walkInCutoffMinutes !== null
    || (r.walkInQueuePolicy ?? "first_come") !== "first_come") out.push("walk_ins");
  if (r.selfCancelAllowed === false || r.selfRescheduleAllowed === false
    || r.rescheduleNoticeMinutes !== null || (r.cancellationNoticeMinutes ?? 0) > 0
    || r.dnaThreshold !== null || r.waitingListEnabled === true) out.push("cancellations");
  return out;
}

/** s9's column words, shorter than the stored levels' own labels so the matrix scans. */
const LEVEL_SHORT: Record<string, string> = {
  off: "Don’t ask", optional: "Optional", required: "Required",
};

/** A closing notice in the practitioner's units. */
const plainLead = (m: number) =>
  m <= 0 ? null
    : m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}`
      : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}`
        : `${m} min`;

/** The one sentence a section says when this deployment cannot store it yet. Never a dead control. */
function StoreAbsent({ note }: { note: string }) {
  return (
    <p className="mt-1.5 rounded-lg border border-dashed border-amber-300 bg-amber-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
      <span className="font-bold">Nothing here can be saved yet. </span>{note}
    </p>
  );
}

export default function RuleWorkspace({
  rules, conflicts, locations, sessions, mayAuthor, mayBook, rulesUnreadable, today,
  view = "full", nextAvailable = null, timezone = null,
  onlineSessions = null, readyLocationKeys = null,
}: {
  rules: any[]; conflicts: any[]; locations: any[]; sessions: any[];
  mayAuthor: boolean; mayBook: boolean; rulesUnreadable: string | null; today: string;
  /**
   * CPR-SETUP-HFE-001 s9: the same workspace serves two destinations. "clinics" renders the
   * clinic-first panels (routine booking setup, no Rules Centre required); "advanced" renders the
   * Rules Centre, chooser and explainability. The COMPOSER renders in both, because Override on a
   * clinic panel opens it -- one component, one save path, whichever door it was reached through.
   */
  view?: "full" | "clinics" | "advanced";
  /**
   * CPR-BOOK-HFE-002 s6: each clinic's next patient-bookable time, keyed by session id, computed
   * server-side from the same preview the diary reads. Null when the page did not compute it.
   */
  nextAvailable?: Record<string, string> | null;
  timezone?: string | null;
  /**
   * Which sessions the OFFERING engine says patients can actually be offered (mode admits patients
   * and the location's window is public-ready) -- computed server-side by publicOfferingGate. Null
   * when the page did not (or could not) compute it: the ON/OFF badge is then omitted rather than
   * guessed, because the card-rule visibility this component holds is NOT the offering truth.
   */
  onlineSessions?: string[] | null;
  readyLocationKeys?: string[] | null;
}) {
  const showClinics = view !== "advanced";
  const showCentre = view !== "clinics";
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [chooser, setChooser] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [probe, setProbe] = useState({
    channel: "practitioner", appointmentType: "new_consultation",
    date: today, time: "10:00", locationId: "",
  });
  const [decision, setDecision] = useState<any | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const set = (k: string, v: any) => setDraft(d => (d ? { ...d, [k]: v } : d));

  // ⚠ READ OFF THE RULES THEMSELVES, NOT ASSUMED. When this deployment cannot store the newer
  // sections, the sections draw a sentence instead of controls that would silently save nothing --
  // which is the worse outcome: a practitioner would leave believing a booking will be refused
  // without a date of birth, and it will not be.
  const sectionsConfigurable = rules.length === 0 ? true : rules[0].sectionsConfigurable !== false;
  const absentNote: string = rules.find((r: any) => r.sectionsAbsentNote)?.sectionsAbsentNote
    ?? "Competen Practice cannot store this yet, so it cannot be set here.";

  const editingRule = editingId ? rules.find((r: any) => r.id === editingId) ?? null : null;
  const activeCategory = category ? ruleCategory(category) : null;

  /** The sections this composer shows. Scopes the ASK only -- the save always submits everything. */
  const visible: Set<string> = useMemo(() => {
    if (showAll || activeCategory?.advanced) return new Set<string>(RULE_COMPOSER_SECTIONS);
    if (activeCategory) return new Set<string>(activeCategory.sections);
    if (editingRule) {
      const s = sectionsSetByRule(editingRule);
      return new Set<string>(s.length > 0 ? s : RULE_COMPOSER_SECTIONS);
    }
    return new Set<string>(RULE_COMPOSER_SECTIONS);
  }, [showAll, activeCategory, editingRule]);

  // s8: numeric priority is hidden from ordinary workflows. It appears on the Advanced path, and on a
  // rule that already carries a non-zero one -- hiding a load-bearing value from its own editor would
  // make an edit silently unexplainable.
  const priorityVisible = activeCategory?.advanced === true
    || (editingId !== null && Number(draft?.priority ?? 0) !== 0);
  const statusVisible = activeCategory?.advanced === true;

  // ── s4's landing: search, chips, groups, summary ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r: any) => {
      if (chip !== "all" && !ruleCategoryKeys(r).includes(chip)) return false;
      if (!q) return true;
      const hay = [
        r.name, r.description, r.scopeLine, r.sessionName, r.locationName,
        r.appointmentType ? appointmentTypeLabel(r.appointmentType) : "",
        r.channelLabel, ...ruleCategoryKeys(r),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rules, search, chip]);

  // s8's visual hierarchy, as the reading order: practice defaults, then location, then clinic and
  // session, then the dated exceptions that outrank all three for their dates.
  const groups = useMemo(() => {
    const of = (r: any) =>
      r.effectiveFrom && r.effectiveTo ? "exceptions"
        : r.sessionTemplateId ? "clinics"
          : r.locationId ? "locations" : "practice";
    const defs: { key: string; title: string; hint: string | null }[] = [
      { key: "practice", title: "Practice-wide rules", hint: "The baseline every clinic inherits unless something more local overrides it." },
      { key: "locations", title: "Location rules", hint: null },
      { key: "clinics", title: "Clinic & session rules", hint: null },
      { key: "exceptions", title: "Temporary exceptions", hint: "Outrank the standing rules above, for their dates only." },
    ];
    return defs
      .map(d => ({ ...d, items: filtered.filter((r: any) => of(r) === d.key) }))
      .filter(d => d.items.length > 0);
  }, [filtered]);

  const counts = useMemo(() => ({
    active: rules.filter((r: any) => r.status === "active").length,
    drafts: rules.filter((r: any) => r.status === "draft").length,
    exceptions: rules.filter((r: any) => r.effectiveFrom && r.effectiveTo).length,
    conflicts: conflicts.length,
  }), [rules, conflicts]);

  function openCreate(catKey: string) {
    const cat = ruleCategory(catKey);
    setDraft(blankDraft());
    setEditingId(null);
    setCategory(catKey);
    setShowAll(false);
    setTemporary(cat?.focus === "dates");
    setChooser(false);
    setNotice(null);
  }

  function openEdit(r: any) {
    setDraft(draftFrom(r));
    setEditingId(r.id);
    setCategory(null);
    setShowAll(false);
    setTemporary(Boolean(r.effectiveFrom && r.effectiveTo));
    setChooser(false);
    setNotice(null);
  }

  /**
   * s6/s8's OVERRIDE, under a winner-takes-all engine: the new clinic rule starts as a COPY of the
   * rule currently governing this clinic, scoped to the session. Every field the practitioner does not
   * touch therefore keeps deciding exactly what it decides today -- a session rule created EMPTY would
   * instead strip every practice-wide constraint from the bookings it wins, silently.
   */
  function openOverride(s: any, governor: any | null, prefill?: Record<string, any>) {
    const d = governor ? draftFrom(governor) : blankDraft();
    d.sessionTemplateId = s.id;
    d.locationId = s.locationId ?? "";
    d.name = s.name;
    d.description = "";
    d.status = "draft";
    d.priority = 0;
    d.effectiveFrom = ""; d.effectiveTo = "";
    d.reason = "";
    Object.assign(d, prefill ?? {});
    setDraft(d);
    setEditingId(null);
    setCategory("clinic_session");
    setShowAll(false);
    setTemporary(false);
    setChooser(false);
    setNotice(null);
  }

  function closeComposer() {
    setDraft(null); setEditingId(null); setCategory(null); setShowAll(false);
  }

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
    // than the form's. The form keeps a flat { key: level } because that is what a control binds to;
    // the engine stores { fields: { key: { level } } } because a condition may hang off a field later.
    // The translation lives here, once, rather than in requiredInformationOf -- which would then have
    // to accept two shapes forever.
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
    // ⚠ THE CONSEQUENCE LEADS, THE REASON FOLLOWS -- 2026-08-28, owner, mid-pilot-acceptance. The raw
    // engine sentence stated the reason and never the OUTCOME, so a person scanning for "did it
    // register?" had to infer it. "Not saved" answers that question first.
    if (!r.ok) { setNotice({ kind: "err", text: `Not saved — ${r.data?.error?.message ?? "the rule was not saved."}` }); return; }
    setNotice({
      kind: "ok",
      text: r.data.rule.created
        ? (draft.status === "draft"
          ? "Rule created as a draft. Put it in force from its card when you are ready."
          : "Rule created.")
        : r.data.rule.changed.length === 0
          ? "Nothing changed, so the version did not move."
          : `Saved as version ${r.data.rule.version}. ${r.data.rule.changed.length} field${r.data.rule.changed.length === 1 ? "" : "s"} changed.`,
    });
    closeComposer();
    router.refresh();
  }

  async function status(ruleId: string, next: string) {
    setBusy(true); setNotice(null);
    const r = await post({ action: "set_status", ruleId, status: next });
    setBusy(false);
    if (!r.ok) { setNotice({ kind: "err", text: `Not changed — ${r.data?.error?.message ?? "the rule was not changed."}` }); return; }
    router.refresh();
  }

  async function explain() {
    // ⚠ THE GUARD IS HERE BECAUSE THERE IS NO <form> ON THIS SCREEN. The button is type="button" with
    // an onClick, so the control's `pattern` never gets a submit to block. And the failure it prevents
    // is a DEAD BUTTON: `.toISOString()` on an Invalid Date THROWS, the rejection escapes before
    // `setBusy(false)`, and the button stays disabled with nothing on screen.
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
        <span className="font-bold">Your rules could not be read.</span> {rulesUnreadable} This is not a
        count of nothing — it is no count at all, and nothing on this layer should be acted on until it
        loads.
      </p>
    );

  // ── The review sentences (s11's step 5): computed from the draft, in the same functions the cards
  //    use, so the preview and the card can never disagree about what a value means. ────────────────
  const review: string[] = [];
  if (draft) {
    const targetBits: string[] = [];
    const loc = locations.find((l: any) => l.id === draft.locationId);
    const ses = sessions.find((s: any) => s.id === draft.sessionTemplateId);
    if (ses) targetBits.push(`the ${WEEKDAY_SHORT[ses.weekday]} session “${ses.name}”`);
    if (loc) targetBits.push(loc.name);
    if (draft.appointmentType) targetBits.push(appointmentTypeLabel(draft.appointmentType));
    if (draft.channel) targetBits.push(BOOKING_CHANNELS.find(c => c.code === draft.channel)?.label ?? draft.channel);
    review.push(targetBits.length === 0
      ? "Applies to your whole practice — the baseline everything else inherits."
      : `Applies to ${targetBits.join(" · ")}. For the bookings it covers, it overrides your practice-wide rules.`);
    review.push(draft.effectiveFrom && draft.effectiveTo
      ? `A temporary exception from ${draft.effectiveFrom} to ${draft.effectiveTo}. For those dates it outranks your standing rules; outside them it does nothing.`
      : draft.effectiveFrom
        ? `A standing rule, in force from ${draft.effectiveFrom}.`
        : "A standing rule.");
    if (visible.has("window"))
      review.push(plainWindow(numOrNull(draft.bookingHorizonDays), Number(draft.leadTimeMinutes) || 0));
    if (visible.has("capacity"))
      review.push(plainCapacity({
        total: numOrNull(draft.capacityTotal), newPatients: numOrNull(draft.capacityNew),
        followUp: numOrNull(draft.capacityFollowUp), urgentReserve: numOrNull(draft.capacityUrgentReserve),
        overbooking: Number(draft.overbookingAllowed) || 0, walkInDailyLimit: numOrNull(draft.walkInDailyLimit),
      }));
    if (visible.has("eligibility")) {
      const el = PATIENT_ELIGIBILITY.find(e => e.code === draft.patientEligibility);
      const ages = draft.minAgeYears !== "" || draft.maxAgeYears !== ""
        ? ` · ${draft.minAgeYears || 0} to ${draft.maxAgeYears || 130} years` : "";
      review.push(`For ${(el?.label ?? "any patient").toLowerCase()}${ages}. A booking this rule does not describe is decided by your other rules, not turned away.`);
    }
    if (visible.has("confirmation")) {
      const cm = CONFIRMATION_MODES.find(c => c.code === draft.confirmationMode);
      review.push(cm ? `Confirmation: ${cm.blurb.toLowerCase()}` : "");
    }
    if (visible.has("walk_ins") && sectionsConfigurable)
      review.push(plainWalkIn({
        dailyLimit: numOrNull(draft.walkInDailyLimit), cutoffMinutes: numOrNull(draft.walkInCutoffMinutes),
        queuePolicy: draft.walkInQueuePolicy,
      }));
    if (visible.has("cancellations") && sectionsConfigurable)
      review.push(plainCancellation({
        noticeMinutes: Number(draft.cancellationNoticeMinutes) || 0,
        rescheduleNoticeMinutes: numOrNull(draft.rescheduleNoticeMinutes),
        selfCancelAllowed: draft.selfCancelAllowed !== false,
        selfRescheduleAllowed: draft.selfRescheduleAllowed !== false,
        dnaThreshold: numOrNull(draft.dnaThreshold), dnaAction: draft.dnaAction,
        waitingListEnabled: draft.waitingListEnabled === true,
      }));
    if (visible.has("required_information") && sectionsConfigurable) {
      const req: RequiredInformation = {
        fields: Object.fromEntries(
          Object.entries(draft.requiredFields as Record<string, string>)
            .filter(([, level]) => level !== REQUIREMENT_LEVEL_WHEN_UNSET)
            .map(([key, level]) => [key, { level: level as RequirementLevel }]),
        ),
      };
      review.push(`Asks for: ${plainRequiredInformation(req)}`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && !draft && (
        <p className={`rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed ${
          notice.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
          {notice.text}
        </p>
      )}

      {/* ── CONFLICTS. Not a warning: a thing that blocks activation until it is resolved. ───────── */}
      {showCentre && conflicts.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <h3 className="text-[13px] font-bold text-rose-900">
            {conflicts.length} pair{conflicts.length === 1 ? "" : "s"} of rules nothing can choose between
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-800/90">
            These cover the same bookings and are equally important, so neither can win. Until one of
            them changes, any booking they both cover is refused rather than decided by chance.
          </p>
          <ul className="mt-2 space-y-2">
            {conflicts.map((c, i) => (
              <li key={i} className="rounded-lg bg-white/70 px-3 py-2">
                <p className="text-[12px] font-bold text-rose-900">
                  {c.a.name ?? "An unnamed rule"}
                  {" ↔ "}
                  {c.b.name ?? "An unnamed rule"}
                </p>
                <p className="text-[10.5px] text-rose-800/80">
                  Both are a {c.rung.toLowerCase()} at priority {c.priority}. {c.resolution}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── s4's RULES CENTRE LANDING ─────────────────────────────────────────────────────────────── */}
      {showCentre && (
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-[14px] text-violet-700">⚌</span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-gray-900">Rules</h3>
            <p className="text-[11px] text-gray-500">
              Control how your practice, clinics and bookings operate.
            </p>
          </div>
          {mayAuthor && (
            <button type="button"
              onClick={() => { setChooser(true); closeComposer(); setNotice(null); }}
              className="ml-auto rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90">
              + Create rule
            </button>
          )}
        </div>

        {!mayAuthor && (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            You can see these rules and what they decide. Writing or overriding one needs the practice
            settings permission, which this account does not hold.
          </p>
        )}

        {/* Summary figures: what is in force, what is waiting, and what needs attention. */}
        <div className="mb-3 flex flex-wrap gap-1.5 text-[10.5px] font-semibold">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 ring-1 ring-emerald-200">
            {counts.active} active
          </span>
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-600 ring-1 ring-slate-200">
            {counts.drafts} draft{counts.drafts === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-cyan-800 ring-1 ring-cyan-200">
            {counts.exceptions} temporary exception{counts.exceptions === 1 ? "" : "s"}
          </span>
          <span className={`rounded-full px-2 py-0.5 ring-1 ${counts.conflicts > 0
            ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>
            {counts.conflicts} conflict{counts.conflicts === 1 ? "" : "s"}
          </span>
        </div>

        {rules.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            <input
              type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search rules by name, clinic, location or type"
              className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
            />
            <div className="flex flex-wrap gap-1">
              {RULE_FILTER_CHIPS.map(c => (
                <button key={c.key} type="button" onClick={() => setChip(c.key)}
                  aria-pressed={chip === c.key}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    chip === c.key
                      ? "bg-violet-600 text-white"
                      : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <p className="text-[12px] text-amber-700">
            No rule exists, so there is no notice period, no booking horizon and no capacity limit
            anywhere in this practice. Every internal booking is allowed by the platform-safe default.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            Nothing matches that search and filter. The rules are still here — clear one or both to see
            them.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map(g => (
              <div key={g.key}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{g.title}</h4>
                  <span className="text-[10px] text-gray-400">{g.items.length}</span>
                  {g.hint && <span className="hidden sm:inline text-[10px] text-gray-400">— {g.hint}</span>}
                </div>
                <ul className="grid gap-2.5 lg:grid-cols-2">
                  {g.items.map((r: any) => {
                    const chipStyle = RULE_STATUS_CHIP[r.status] ?? RULE_STATUS_CHIP.unreadable;
                    const lead = plainLead(r.leadTimeMinutes ?? 0);
                    return (
                      <li key={r.id} className={`rounded-xl border px-3.5 py-3 ${
                        r.conflictsWith.length > 0 ? "border-rose-300 bg-rose-50/40"
                          : r.status === "active" ? "border-gray-200" : "border-dashed border-slate-300 bg-slate-50/60"}`}>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <p className="text-[13px] font-bold text-gray-900">
                            {r.name ?? <span className="italic font-semibold text-slate-500">Unnamed rule</span>}
                          </p>
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${chipStyle.chip}`}>
                            {chipStyle.label}
                          </span>
                        </div>

                        {r.description && <p className="mt-0.5 text-[11px] text-gray-600">{r.description}</p>}

                        {/* s4: structured badges instead of paragraphs. Every one is a stored value. */}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <span className={badgeCls}>{r.scopeLine}</span>
                          {r.effectiveFrom && r.effectiveTo && (
                            <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 ring-1 ring-cyan-200">
                              {r.effectiveFrom} → {r.effectiveTo}
                            </span>
                          )}
                          {r.visibility === "public" && <span className={badgeCls}>Public booking</span>}
                          {r.visibility === "link_only" && <span className={badgeCls}>Anyone with the link</span>}
                          {r.bookingHorizonDays !== null && <span className={badgeCls}>Opens {r.bookingHorizonDays}d ahead</span>}
                          {lead && <span className={badgeCls}>Closes {lead} before</span>}
                          {r.capacityTotal !== null && <span className={badgeCls}>{r.capacityTotal} places</span>}
                          {r.walkInDailyLimit !== null && <span className={badgeCls}>{r.walkInDailyLimit} walk-ins a day</span>}
                          <span className={badgeCls}>
                            {CONFIRMATION_MODES.find(c => c.code === r.confirmationMode)?.label ?? r.confirmationMode}
                          </span>
                        </div>

                        {/* s12: everything the rule says, one open away, in the same plain sentences. */}
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-[10.5px] font-semibold text-[var(--cp-primary)]">
                            Everything this rule says
                          </summary>
                          <dl className="mt-1.5 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[76px_minmax(0,1fr)]">
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
                            <dt className="font-semibold text-gray-500">Patients</dt>
                            <dd className="text-gray-800">
                              {PATIENT_ELIGIBILITY.find(e => e.code === r.patientEligibility)?.label ?? r.patientEligibility}
                              {r.minAgeYears !== null || r.maxAgeYears !== null
                                ? ` · ${r.minAgeYears ?? 0} to ${r.maxAgeYears ?? 130} years` : ""}
                            </dd>
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
                        </details>

                        {/* s12's "why does this apply?", off the card face and one open away. */}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[10.5px] font-semibold text-[var(--cp-primary)]">
                            Why does this rule apply?
                          </summary>
                          <p className="mt-1 text-[10.5px] leading-relaxed text-gray-600">
                            <span className="font-semibold text-violet-700">{r.rung}</span> — {r.reasons.join(" ")}{" "}
                            The most local rule that covers a booking is the one that decides it.
                          </p>
                          <p className="mt-0.5 text-[10px] text-gray-400">
                            Version {r.version}.{Number(r.priority) !== 0
                              ? ` Priority ${r.priority} — used only to settle a tie between two equally local rules.` : ""}
                          </p>
                        </details>

                        {!r.sectionsConfigurable && r.sectionsAbsentNote && (
                          <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[10.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                            {r.sectionsAbsentNote}
                          </p>
                        )}

                        {r.conflictsWith.length > 0 && (
                          <p className="mt-1.5 rounded bg-rose-100/70 px-2 py-1 text-[10.5px] font-semibold text-rose-800">
                            Deadlocked with {r.conflictsWith.length} other rule
                            {r.conflictsWith.length === 1 ? "" : "s"}. Bookings both cover are refused, not guessed.
                          </p>
                        )}

                        {mayAuthor && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button type="button" disabled={busy}
                              onClick={() => openEdit(r)}
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
              </div>
            ))}
          </div>
        )}
      </section>

      )}

      {/* ── s6: CLINICS & SESSIONS AS FIRST-CLASS RULE TARGETS ───────────────────────────────────
          The composed projection, at the level the engine actually composes: which rule governs this
          clinic, what it says, and who would decide instead. Override copies the governing rule so an
          untouched setting keeps deciding exactly what it decides today; Restore archives the clinic's
          own rule so the inherited one governs again. */}
      {showClinics && sessions.length > 0 && (
        <section className={card}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-[14px] text-violet-700">▦</span>
            <div className="min-w-0">
              <h3 className="text-[14px] font-bold text-gray-900">Clinics &amp; sessions</h3>
              <p className="text-[11px] text-gray-500">
                What each of your recurring clinics inherits, and what is set for it alone. What a
                clinic IS — its day, time, place and capacity — lives on{" "}
                <Link href="/practice/setup/availability-changes"
                  className="font-semibold text-[var(--cp-primary)] hover:underline">
                  My Regular Practice
                </Link>; this is how it behaves.
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {sessions.map((s: any) => {
              const chain = clinicRuleChain(
                { id: s.id, locationId: s.locationId ?? null }, rules as never,
                { appointmentType: appointmentTypeLabel },
              );
              const governor: any = clinicGoverningRule(chain);
              const overridden = governor !== null && governor.sessionTemplateId === s.id;
              // ⚠ FROM THE OFFERING ENGINE, NEVER FROM THE CARD RULE'S visibility -- the two answer
              // different questions, and the first version of this badge answered the wrong one.
              const online: boolean | null = onlineSessions ? onlineSessions.includes(s.id) : null;
              const windowReady = readyLocationKeys
                ? readyLocationKeys.includes((s.locationId as string | null) ?? "practice") : null;
              const nextAt = online ? nextAvailable?.[s.id] ?? null : null;
              const qualified = chain.filter(e => !e.unqualified);
              return (
                <li key={s.id} className="rounded-xl border border-gray-200">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3.5 py-2.5">
                      <span className="text-[12.5px] font-bold text-gray-900">{s.name}</span>
                      <span className="text-[10.5px] text-gray-500">
                        {WEEKDAY_SHORT[s.weekday]} · {minuteOfDayAsClock(s.startsMinute)}–{minuteOfDayAsClock(s.endsMinute)}
                      </span>
                      <span className="ml-auto flex flex-wrap items-center gap-1">
                        {online !== null ? (
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                            online ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                            {online ? "Online booking ON" : "Online booking OFF"}
                          </span>
                        ) : null}
                        {!governor && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">
                            Needs setup
                          </span>
                        )}
                        {overridden ? (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">
                            Set for this clinic
                          </span>
                        ) : governor ? (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                            Inherited
                          </span>
                        ) : null}
                      </span>
                    </summary>
                    <div className="border-t border-gray-100 px-3.5 py-2.5">
                      {/* s8's source sentence: the effective value first, its origin with it. */}
                      <p className="text-[11px] leading-relaxed text-gray-600">
                        {overridden ? (
                          <>Behaviour here is set by{" "}
                            <span className="font-semibold text-violet-700">{governor.name ?? "an unnamed rule"}</span>,
                            written for this clinic. Restoring inherited behaviour retires it so your wider
                            rules govern again.</>
                        ) : governor ? (
                          <>Behaviour here is inherited from{" "}
                            <span className="font-semibold text-gray-800">{governor.name ?? "an unnamed rule"}</span>
                            {" "}({governor.locationId ? governor.locationName ?? "a location rule" : "practice-wide"}).
                            Overriding writes this clinic its own rule, starting from those values.</>
                        ) : (
                          <>No booking rule covers this clinic yet, so its behaviour is not set here.
                            Choose how far ahead patients may book and whether it has a capacity
                            limit.</>
                        )}
                      </p>

                      {governor && (
                        <dl className="mt-2 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[86px_minmax(0,1fr)]">
                          <dt className="font-semibold text-gray-500">Booking</dt>
                          <dd className="text-gray-800">
                            {governor.windowLine}{" "}
                            {governor.visibility === "public" ? "Listed on your booking page."
                              : governor.visibility === "link_only" ? "Offered to anyone with the link."
                                : "Internal only — never offered to patients."}
                          </dd>
                          <dt className="font-semibold text-gray-500">Capacity</dt>
                          <dd className="text-gray-800">{governor.capacityLine}</dd>
                          <dt className="font-semibold text-gray-500">Confirm</dt>
                          <dd className="text-gray-800">
                            {CONFIRMATION_MODES.find(c => c.code === governor.confirmationMode)?.label ?? governor.confirmationMode}
                          </dd>
                          <dt className="font-semibold text-gray-500">Patients</dt>
                          <dd className="text-gray-800">
                            {PATIENT_ELIGIBILITY.find(e => e.code === governor.patientEligibility)?.label ?? governor.patientEligibility}
                            {governor.minAgeYears !== null || governor.maxAgeYears !== null
                              ? ` · ${governor.minAgeYears ?? 0} to ${governor.maxAgeYears ?? 130} years` : ""}
                          </dd>
                          {governor.sectionsConfigurable && (
                            <>
                              <dt className="font-semibold text-gray-500">Walk-ins</dt>
                              <dd className="text-gray-800">{governor.walkInLine}</dd>
                              <dt className="font-semibold text-gray-500">Changes</dt>
                              <dd className="text-gray-800">{governor.cancellationLine}</dd>
                              <dt className="font-semibold text-gray-500">Asks for</dt>
                              <dd className="text-gray-800">{governor.requiredInformationLine}</dd>
                            </>
                          )}
                        </dl>
                      )}

                      {online && nextAvailable && (
                        <p className="mt-1.5 text-[11px] font-semibold text-gray-800">
                          {nextAt
                            ? `Next available: ${new Date(nextAt).toLocaleString("en-GB", {
                              weekday: "short", day: "numeric", month: "short",
                              hour: "2-digit", minute: "2-digit",
                              ...(timezone ? { timeZone: timezone } : {}),
                            })}`
                            : "No time is offerable in the next fortnight."}
                        </p>
                      )}

                      {s.capacity !== null && (
                        <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
                          The session itself holds {s.capacity} place{s.capacity === 1 ? "" : "s"} — set
                          where the session is, on My Regular Practice. The stricter of the session and
                          the rule applies.
                        </p>
                      )}

                      {qualified.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Also applies here
                          </p>
                          <ul className="mt-0.5 space-y-0.5 text-[10.5px] text-gray-600">
                            {qualified.map(e => (
                              <li key={e.rule.id}>
                                · <span className="font-semibold">{e.rule.name ?? "An unnamed rule"}</span>
                                {" "}— {e.qualifiers.join(", ")}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {mayAuthor && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {/* The cause decides the door, whatever governs the clinic's behaviour: a
                              session whose MODE shuts patients out is fixed on the session itself; a
                              location whose WINDOW is not public is fixed in the per-location booking
                              editor. Both truths come from the offering engine, via props. */}
                          {online === false && (
                            windowReady === false ? (
                              <Link href="/practice/setup/availability?step=4"
                                className="rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90">
                                Open online booking for this location →
                              </Link>
                            ) : (
                              <Link href="/practice/setup/availability-changes"
                                className="rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90">
                                Allow patient booking on this clinic →
                              </Link>
                            )
                          )}
                          {overridden ? (
                            <>
                              <button type="button" disabled={busy} onClick={() => openEdit(governor)}
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                Edit this clinic&apos;s rule
                              </button>
                              <button type="button" disabled={busy}
                                onClick={() => status(governor.id, "archived")}
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                Restore inherited behaviour
                              </button>
                            </>
                          ) : governor ? (
                            <>
                              <button type="button" disabled={busy} onClick={() => openOverride(s, governor)}
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                Override for this clinic
                              </button>
                              <button type="button" disabled={busy} onClick={() => openEdit(governor)}
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                Edit the inherited rule
                              </button>
                            </>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => openOverride(s, null)}
                              className="rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                              Set up booking for this clinic →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── s5's CREATE-RULE CHOOSER: what do you want to control? ───────────────────────────────── */}
      {showCentre && chooser && (
        <section className={card}>
          <h3 className="text-[14px] font-bold text-gray-900">What do you want to control?</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Pick the task. You will only be asked about the settings that task needs.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {RULE_CATEGORIES.map(c => (
              <button key={c.key} type="button" onClick={() => openCreate(c.key)}
                className={`rounded-xl border p-3 text-left hover:bg-violet-50/40 ${
                  c.advanced ? "border-dashed border-slate-300" : "border-gray-200"}`}>
                <p className="text-[12.5px] font-bold text-gray-900">{c.title}</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">{c.blurb}</p>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setChooser(false)}
            className="mt-3 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
        </section>
      )}

      {/* ── s11's GUIDED COMPOSER ─────────────────────────────────────────────────────────────────── */}
      {draft && (
        <section className={card}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-[14px] font-bold text-gray-900">
              {editingId ? "Edit this rule" : activeCategory ? `New rule — ${activeCategory.title}` : "New rule"}
            </h3>
            {!activeCategory?.advanced && (
              <button type="button" onClick={() => setShowAll(v => !v)}
                className="ml-auto text-[10.5px] font-semibold text-[var(--cp-primary)] hover:underline">
                {showAll ? "Show only what this task needs" : "Show every section"}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            {editingId
              ? "Saving records a new version and keeps the old one, so a booking made under the current version can still be explained after this changes."
              : "A rule starts as a draft. It decides nothing until you put it in force."}
          </p>

          <div className="mt-3 space-y-4">
            {/* 1 · WHAT IT IS CALLED */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">1 · What it is called</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                <label className={labelCls}>Name
                  <input className={field} value={draft.name} maxLength={120}
                    onChange={e => set("name", e.target.value)} placeholder="TMR Friday Specialist Clinic" />
                </label>
                <label className={labelCls}>Description
                  <input className={field} value={draft.description} maxLength={1000}
                    onChange={e => set("description", e.target.value)} />
                </label>
                {statusVisible && (
                  <label className={labelCls}>Status
                    <select className={field} value={draft.status} onChange={e => set("status", e.target.value)}>
                      {RULE_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                    </select>
                  </label>
                )}
                {priorityVisible && (
                  <label className={labelCls}>Priority (settles a tie between two equally local rules)
                    <input className={field} type="number" min={0} max={1000} value={draft.priority}
                      onChange={e => set("priority", e.target.value)} />
                  </label>
                )}
              </div>
              {editingRule?.legacy && (
                <p className="mt-1 text-[10.5px] leading-relaxed text-amber-800">
                  This rule has no name yet. Giving it one changes nothing about what it decides — it
                  only makes it possible to tell apart from the others.
                </p>
              )}
            </fieldset>

            {/* 2 · WHERE IT APPLIES */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">2 · Where it applies</legend>
              {activeCategory?.focus === "session" && (
                <p className="mt-1 text-[10.5px] font-semibold text-violet-700">
                  Pick the clinic or session this rule is for.
                </p>
              )}
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {activeCategory?.focus === "session" ? (
                  <>
                    <label className={`${labelCls} rounded-lg ring-2 ring-violet-200 p-1 -m-1`}>Clinic or session
                      <select className={field} value={draft.sessionTemplateId}
                        onChange={e => set("sessionTemplateId", e.target.value)}>
                        <option value="">Choose a session</option>
                        {sessions.map((s: any) => (
                          <option key={s.id} value={s.id}>
                            {WEEKDAY_SHORT[s.weekday]} · {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelCls}>Location
                      <select className={field} value={draft.locationId} onChange={e => set("locationId", e.target.value)}>
                        <option value="">Whole practice</option>
                        {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
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
                  </>
                )}
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
                        {c.label}{c.door ? "" : " (not available yet)"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                Anything you leave as &ldquo;whole practice&rdquo; or &ldquo;any&rdquo; stays governed by
                your practice-wide rules. Each thing you name makes this rule the more local one — and
                the most local rule that covers a booking is the one that decides it.
              </p>
            </fieldset>

            {/* 3 · WHEN IT APPLIES */}
            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">3 · When it applies</legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="When it applies">
                <button type="button" aria-pressed={!temporary}
                  onClick={() => { setTemporary(false); set("effectiveTo", ""); }}
                  className={`rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${
                    !temporary ? "bg-violet-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
                  Standing rule
                </button>
                <button type="button" aria-pressed={temporary}
                  onClick={() => setTemporary(true)}
                  className={`rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${
                    temporary ? "bg-violet-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
                  Temporary exception
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className={labelCls}>{temporary ? "From" : "In force from (optional)"}
                  <input className={field} type="date" value={draft.effectiveFrom}
                    onChange={e => set("effectiveFrom", e.target.value)} />
                </label>
                {temporary && (
                  <label className={labelCls}>Until
                    <input className={field} type="date" value={draft.effectiveTo}
                      onChange={e => set("effectiveTo", e.target.value)} />
                  </label>
                )}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                {temporary
                  ? "A temporary exception has BOTH dates and outranks your standing rules for those days only. Outside its dates it does nothing."
                  : "A standing rule applies until you pause or archive it. A start date on its own changes nothing about which rule wins."}
              </p>
            </fieldset>

            {/* 4 · WHAT IT CHANGES — only the sections this task needs (s5). */}
            {visible.has("window") && (
              <fieldset>
                <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Booking window</legend>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {/*
                    ⚠ THE PLACEHOLDER SAYS "not set" AND NEVER "unlimited". A missing horizon is
                    MISSING, not unlimited: a publicly bookable session whose horizon resolves nowhere
                    offers no public times at all.
                  */}
                  <label className={labelCls}>Opens this many days ahead
                    <input className={field} type="number" min={1} max={730} value={draft.bookingHorizonDays}
                      onChange={e => set("bookingHorizonDays", e.target.value)} placeholder="not set" />
                  </label>
                  <label className={labelCls}>Who may be offered these times
                    <select className={field} value={draft.visibility}
                      onChange={e => set("visibility", e.target.value)}>
                      <option value="internal">Internal only — never offered to patients</option>
                      <option value="link_only">Anyone with the link</option>
                      <option value="public">Public — listed on the booking page</option>
                    </select>
                  </label>
                  <label className={labelCls}>Closes this many minutes before
                    <input className={field} type="number" min={0} max={43200} value={draft.leadTimeMinutes}
                      onChange={e => set("leadTimeMinutes", e.target.value)} />
                  </label>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                  A box left unset falls to whichever other rule covers the booking. A publicly bookable
                  session must get its opening horizon from one of them — with no horizon anywhere, no
                  public times are offered at all.
                </p>
              </fieldset>
            )}

            {visible.has("capacity") && (
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
            )}

            {visible.has("eligibility") && (
              <fieldset>
                <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Which patients</legend>
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
                  This decides WHOSE rule this is, not whether to refuse them. A booking this rule does
                  not describe is decided by the next rule down, not turned away.
                </p>
              </fieldset>
            )}

            {visible.has("confirmation") && (
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
            )}

            {/* s9's BOOKING INFORMATION MATRIX — three states, one row per question. */}
            {visible.has("required_information") && (
              <fieldset>
                <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Booking information</legend>
                {!sectionsConfigurable ? (
                  <StoreAbsent note={absentNote} />
                ) : (
                  <>
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500">
                      Choose what patients are asked to provide when booking. A required answer that is
                      missing refuses the booking on the server — not only on the form. A question left
                      at &ldquo;Optional&rdquo; is accepted if given and demanded of nobody.
                    </p>

                    {/* The matrix (md and up): one row per question, three radio columns. */}
                    <div className="mt-2 hidden md:block">
                      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,96px)] items-end gap-x-2 border-b border-gray-200 pb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Information</span>
                        {REQUIREMENT_LEVELS.map(l => (
                          <span key={l.code} className="justify-self-center text-center text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                            title={l.blurb}>
                            {LEVEL_SHORT[l.code]}
                          </span>
                        ))}
                      </div>
                      {BOOKING_INTAKE_FIELDS.map(f => {
                        const fixed = INTAKE_FIELDS_ALWAYS_REQUIRED.includes(f.field_key);
                        const level = fixed ? "required"
                          : (draft.requiredFields[f.field_key] ?? REQUIREMENT_LEVEL_WHEN_UNSET);
                        return (
                          <div key={f.field_key}
                            className="grid grid-cols-[minmax(0,1fr)_repeat(3,96px)] items-center gap-x-2 border-b border-gray-100 py-1.5">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold text-gray-800">
                                {f.label}
                                {fixed && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                                    always asked
                                  </span>
                                )}
                              </p>
                              <p className="text-[9.5px] leading-snug text-gray-400">{f.help}</p>
                            </div>
                            {REQUIREMENT_LEVELS.map(l => (
                              <label key={l.code} className="justify-self-center">
                                <input type="radio" name={`ri-${f.field_key}`} value={l.code}
                                  checked={level === l.code} disabled={fixed}
                                  aria-label={`${f.label}: ${LEVEL_SHORT[l.code]}`}
                                  onChange={() => set("requiredFields", { ...draft.requiredFields, [f.field_key]: l.code })} />
                              </label>
                            ))}
                          </div>
                        );
                      })}
                    </div>

                    {/* Below md (s13): one card per question with a segmented control, never a
                        horizontally compressed four-column form. */}
                    <div className="mt-2 space-y-1.5 md:hidden">
                      {BOOKING_INTAKE_FIELDS.map(f => {
                        const fixed = INTAKE_FIELDS_ALWAYS_REQUIRED.includes(f.field_key);
                        const level = fixed ? "required"
                          : (draft.requiredFields[f.field_key] ?? REQUIREMENT_LEVEL_WHEN_UNSET);
                        return (
                          <div key={f.field_key} className="rounded-lg border border-gray-200 px-2.5 py-2">
                            <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold text-gray-800">
                              {f.label}
                              {fixed && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                                  always asked
                                </span>
                              )}
                            </p>
                            <div className="mt-1.5 grid grid-cols-3 overflow-hidden rounded-lg border border-gray-200"
                              role="group" aria-label={f.label}>
                              {REQUIREMENT_LEVELS.map(l => (
                                <button key={l.code} type="button" disabled={fixed}
                                  aria-pressed={level === l.code}
                                  onClick={() => set("requiredFields", { ...draft.requiredFields, [f.field_key]: l.code })}
                                  className={`px-1 py-1.5 text-[10.5px] font-semibold ${
                                    level === l.code ? "bg-violet-600 text-white"
                                      : "bg-white text-gray-600"} disabled:opacity-60`}>
                                  {LEVEL_SHORT[l.code]}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* ⚠ LISTED, NOT OMITTED. A section that offers most of what it names and says
                        nothing about the rest reads as complete. The sentences are the production
                        ones -- capability language, no build history. */}
                    <ul className="mt-1.5 space-y-1">
                      {INTAKE_NOT_CONFIGURABLE.map(n => (
                        <li key={n.what} className="rounded border border-dashed border-slate-300 bg-slate-50/70 px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-600">
                          {n.plain}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </fieldset>
            )}

            {visible.has("walk_ins") && (
              <fieldset>
                <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Walk-ins</legend>
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
                      Whether a session takes walk-ins at all, and how many it takes, is set on the
                      session itself — that is what the session IS, and it lives with the session.{" "}
                      <Link href="/practice/setup/availability-changes"
                        className="font-semibold text-[var(--cp-primary)] hover:underline">
                        Open My Regular Practice →
                      </Link>{" "}
                      The stricter of the two limits refuses the walk-in, and the refusal names which one
                      it was. An authorised person may lift any of these with a reason, which is recorded
                      before the walk-in is booked.
                    </p>
                  </>
                )}
              </fieldset>
            )}

            {visible.has("cancellations") && (
              <fieldset>
                <legend className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Cancellations and missed appointments</legend>
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
                      <label className={labelCls}>Notice to cancel (minutes)
                        <input className={field} type="number" min={0} max={43200} value={draft.cancellationNoticeMinutes}
                          onChange={e => set("cancellationNoticeMinutes", e.target.value)} />
                      </label>
                      <label className={labelCls}>Notice to move it (minutes)
                        <input className={field} type="number" min={0} max={43200} value={draft.rescheduleNoticeMinutes}
                          onChange={e => set("rescheduleNoticeMinutes", e.target.value)}
                          placeholder="same as cancelling" />
                      </label>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                      <label className="flex items-start gap-1.5 pt-4 text-[11px] text-gray-700">
                        <input type="checkbox" className="mt-0.5" checked={draft.waitingListEnabled === true}
                          onChange={e => set("waitingListEnabled", e.target.checked)} />
                        Offer freed time to a waiting list
                      </label>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                      The notice is what a PATIENT is held to when cancelling or moving their own
                      booking. It never refuses you or your staff — a practice that cannot correct its
                      own diary is a practice with a wrong diary. Every cancellation records who made it,
                      why, and whether it was inside the notice.
                    </p>
                    {draft.waitingListEnabled === true && (
                      // ⚠ SAID WHERE THE SWITCH IS, not in a footnote. A waiting list is the one thing
                      // here that can be believed into existence: "we'll let you know" is what it MEANS.
                      <p className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                        {WAITING_LIST_NO_SCREEN_NOTE} {WAITING_LIST_CONTACT_NOTE}
                      </p>
                    )}
                  </>
                )}
              </fieldset>
            )}

            {/* What cannot be configured yet, shown only where somebody went looking for everything. */}
            {(showAll || activeCategory?.advanced) && BUILDER_SECTIONS.filter(s => !s.built).map(s => (
              <div key={s.key} className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-bold text-slate-600">{s.title}</p>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                    Not available yet
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{s.note}</p>
              </div>
            ))}

            {/* 5 · REVIEW — the plain-language effect, from the same sentences the cards use. */}
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">
                What this rule will do
              </p>
              <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-gray-700">
                {review.filter(Boolean).map((line, i) => <li key={i}>· {line}</li>)}
              </ul>
              {!editingId && !statusVisible && (
                <p className="mt-1.5 text-[10px] text-gray-500">
                  It is created as a draft and decides nothing until you put it in force from its card.
                </p>
              )}
            </div>

            <label className={labelCls}>Why are you changing this? (kept with the version)
              <input className={field} value={draft.reason} maxLength={500}
                onChange={e => set("reason", e.target.value)} placeholder="Too many no-shows on unconfirmed first visits" />
            </label>

            {/* ⚠ THE ANSWER APPEARS WHERE THE QUESTION WAS ASKED — 2026-08-28, owner, mid-pilot-
                acceptance: a notice rendered only at the top of a long page put the refusal off-screen
                and the editor read as a dead button. The notice renders here, beside the button that
                produced it. */}
            {notice && (
              <p role="status" className={`rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed ${
                notice.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                  : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
                {notice.text}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={save}
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {editingId ? "Save this version" : statusVisible ? "Create rule" : "Save draft"}
              </button>
              <button type="button" disabled={busy} onClick={closeComposer}
                className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── EXPLAINABILITY: "USERS MUST BE ABLE TO SEE WHY A RULE WON" ──────────────────────────── */}
      {showCentre && (
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
                : `“${decision.ruleName ?? "An unnamed rule"}” would decide it, at version ${decision.ruleVersion}.`}
            </p>
            <p className="text-[10.5px] text-gray-500">{decision.rung}</p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-gray-700">
              {decision.why.map((w: string, i: number) => <li key={i}>· {w}</li>)}
            </ul>
            {decision.runnersUp.length > 0 && (
              <p className="mt-1.5 text-[10.5px] text-gray-500">
                Beaten: {decision.runnersUp.map((r: any) => `${r.name ?? "unnamed"} (${r.rung.toLowerCase()})`).join("; ")}.
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
      )}
    </div>
  );
}
