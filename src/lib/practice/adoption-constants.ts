// CPR-ADOPT-001 + CPR-GROWTH-001 - the vocabularies both specifications turn on.
//
// Pure module: no I/O, no React. The engines act on these and the harness asserts against them, so neither
// re-states a list the other could disagree with.

// ── CPR-GROWTH-001 section 2: the practitioner success pipeline ─────────────────────────────────────
//
// ⚠ NINE MILESTONES, EACH ONCE PER PRACTICE. Migration 283 puts a unique index on
// (workspace_id, event_key) precisely because of that, which makes emission idempotent: an emitter may fire
// on every booking and only the first lands. Section 8 asks for "reliable" events, and a rule that survives
// being called twice is more reliable than a scheduler that must be called exactly once.
export const ACTIVATION_EVENTS: { key: string; milestone: string; why: string }[] = [
  { key: "practice.created",          milestone: "Account created",       why: "Acquisition" },
  { key: "practice.setup_completed",  milestone: "Practice configured",   why: "Readiness" },
  { key: "booking.link_created",      milestone: "Booking link generated", why: "Distribution asset" },
  { key: "booking.link_shared",       milestone: "Booking link shared",   why: "Intent to acquire patients" },
  { key: "booking.first_received",    milestone: "First booking",         why: "Core activation" },
  { key: "booking.tenth_received",    milestone: "10th booking",          why: "Habit formation" },
  { key: "followup.first_created",    milestone: "First follow-up",       why: "Value expansion" },
  { key: "encounter.first_closed",    milestone: "First encounter closed", why: "Continuity adoption" },
  { key: "close_day.first_completed", milestone: "First Close My Day",    why: "Admin-saving adoption" },
  { key: "intelligence.first_action", milestone: "First insight actioned", why: "Advanced value" },
];

export const ACTIVATION_EVENT_KEYS = ACTIVATION_EVENTS.map(e => e.key);

/**
 * ⚠ THE NORTH STAR IS NOT PAYMENT - section 1 says so in as many words: "a practitioner is Activated when
 * the practice is configured, a booking link is created and shared, and the first patient booking is
 * received. Payment alone is not activation." Four events, all of them, and the definition lives here so
 * that a dashboard cannot quietly redefine it to something easier to hit.
 */
export const ACTIVATION_DEFINITION = [
  "practice.setup_completed",
  "booking.link_created",
  "booking.link_shared",
  "booking.first_received",
];

// ── CPR-ADOPT-001 section 1: the adoption ladder ────────────────────────────────────────────────────
//
// ⚠ DERIVED, NEVER STORED. Each stage is defined by a SIGNAL, so a practice's stage is a function of the
// events above. Migration 283 deliberately creates no ladder table: a stored stage is a second source of
// truth that drifts the moment an event is backfilled, and the screen would then show a rung the data does
// not support.
//
// `signal: null` marks a stage this product cannot yet evidence. Section 1 names "recurring calendar use"
// and "repeat patient identified" as signals, and neither has an event in section 2's pipeline - so the
// stage is listed, and it is honest about having no signal rather than borrowing a neighbouring one.
export const ADOPTION_LADDER: {
  stage: number; name: string; perception: string; value: string; signal: string | null;
}[] = [
  { stage: 1, name: "Booking",      perception: "Booking tool",         value: "Patients self-book and the schedule begins to populate", signal: "booking.first_received" },
  { stage: 2, name: "Calendar",     perception: "Calendar organiser",   value: "Daily and weekly clinic visibility",                     signal: null },
  { stage: 3, name: "Patients",     perception: "Patient register",     value: "Known patients accumulate automatically",                signal: null },
  { stage: 4, name: "Follow-ups",   perception: "Follow-up assistant",  value: "Due and overdue patients become visible",                signal: "followup.first_created" },
  { stage: 5, name: "Encounters",   perception: "Practice memory",      value: "Lightweight encounter history",                          signal: "encounter.first_closed" },
  { stage: 6, name: "Close My Day", perception: "End-of-day assistant", value: "Exceptions closed in batch",                             signal: "close_day.first_completed" },
  { stage: 7, name: "Intelligence", perception: "Practice intelligence", value: "Trends and actionable insights",                        signal: "intelligence.first_action" },
];

// ── CPR-ADOPT-001 section 3: Close My Day quick actions ─────────────────────────────────────────────
//
// ⚠ "No change" IS A CLINICAL ASSERTION, NOT A SKIP. Section 7: "a Seen status must not imply that
// diagnoses, medications or investigations were reviewed unless explicitly confirmed". Choosing No change
// is that explicit confirmation and is recorded as one - which is exactly why it is an ACTION here and not
// the absence of one. `defer` is the option for "I have not decided", and it takes a reason.
export const CLOSE_ACTIONS: { code: string; label: string; confirmsReview: boolean; opensCapture: boolean }[] = [
  { code: "no_change",      label: "No change",           confirmsReview: true,  opensCapture: false },
  { code: "new_diagnosis",  label: "New diagnosis",       confirmsReview: true,  opensCapture: true  },
  { code: "treatment",      label: "Treatment changed",   confirmsReview: true,  opensCapture: true  },
  { code: "investigation",  label: "Investigation ordered", confirmsReview: true, opensCapture: true  },
  { code: "procedure",      label: "Procedure performed", confirmsReview: true,  opensCapture: true  },
  { code: "follow_up",      label: "Follow-up scheduled", confirmsReview: true,  opensCapture: true  },
  { code: "other",          label: "Other / note",        confirmsReview: true,  opensCapture: true  },
  { code: "defer",          label: "Defer",               confirmsReview: false, opensCapture: false },
];

export const CLOSE_ACTION_CODES = CLOSE_ACTIONS.map(a => a.code);
/** The one action that records a decision without asserting anything clinical, so it needs a reason. */
export const DEFER_ACTION = "defer";

// ── CPR-GROWTH-001 section 4: the customer success work queue ───────────────────────────────────────
//
// ⚠ RULES OVER EVENTS, NOT OVER DATES. Section 8: "practitioner-facing prompts are driven by real usage
// rather than fixed dates alone". Each rule below reads the event ledger, so a practice that did the thing
// is never chased for not having done it.
export const RISK_RULES: {
  state: "green" | "amber" | "red"; code: string; rule: string; action: string;
}[] = [
  { state: "red",   code: "setup_incomplete",   rule: "Setup incomplete",                        action: "Concierge onboarding outreach." },
  { state: "amber", code: "link_not_shared",    rule: "Setup complete but link not shared",      action: "Offer help placing the link or QR on WhatsApp and reception materials." },
  { state: "amber", code: "shared_no_booking",  rule: "Link shared but no booking yet",          action: "Check availability, booking rules and the patient-facing page." },
  { state: "green", code: "activated",          rule: "First booking received",                  action: "No intervention. Invite a referral at a suitable milestone." },
];

// ⚠ "Previously active, now inactive" IS IN SECTION 4 AND IS NOT IN THE LIST ABOVE. It needs a usage
// recency signal, and the activation ledger records only FIRST occurrences - by design, since the unique
// index makes every milestone once-per-practice. Detecting a practice that has gone quiet needs a different
// source, so the rule is named here rather than implemented against data that cannot answer it.
export const UNIMPLEMENTED_RISK_RULES = [
  { code: "went_quiet", rule: "Previously active, now inactive", why: "needs a usage-recency signal; the activation ledger records first occurrences only" },
];
