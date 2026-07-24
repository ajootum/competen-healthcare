// Patient Operations Centre form templates (POS-106 §6). The controlled form catalogue that
// drives both the workflow catalogue on the command surface and the generic form drawer. Each
// template declares its structured fields (§6 field tables), the domain event it emits (§11.2)
// and whether it requires verification (§8.2). Field sets here are the operational CORE of each
// spec form — enough to capture the event faithfully; full tenant-configurable field templates
// are governed by POS-112 (an honest next-phase, noted on the surface). Submitting a template
// persists an op_form_instance, writes an immutable op_form_event, appends an op_movement_events
// timeline entry and turns "actions" rows into op_tasks — one entry, distributed everywhere.

export type PosField =
  | { key: string; label: string; type: "text" | "textarea" | "number" | "datetime"; required?: boolean; placeholder?: string; help?: string }
  | { key: string; label: string; type: "select"; required?: boolean; options: string[]; help?: string }
  | { key: string; label: string; type: "boolean"; required?: boolean; help?: string }
  | { key: string; label: string; type: "checklist"; items: string[]; help?: string }
  | { key: string; label: string; type: "actions"; help?: string }; // repeating rows → op_tasks

export type PosTemplate = {
  key: string;
  name: string;
  group: string;
  icon: string;
  eventType: string;      // §11.2 domain event
  verify?: boolean;       // requires verification by default (§8.2)
  quick?: boolean;        // surfaced as a Quick Action (§3)
  crossLink?: { label: string; href: string }; // state-mutating workflow actioned elsewhere
  note?: string;          // honest scope note shown in the drawer
  fields: PosField[];
};

// The seven active workflow groups (§3), in display order.
export const POS_GROUPS = [
  "Admission & Movement",
  "Shift & Review",
  "Risk, Safety & Escalation",
  "Communication & Coordination",
  "Devices & Equipment",
  "Tasks & Follow-up",
  "Discharge & Closure",
] as const;

const ACUITY = ["stable", "moderate", "high", "critical"];
const PRIORITY = ["routine", "urgent", "emergency"];

export const POS_TEMPLATES: PosTemplate[] = [
  // ── 1. Admission & Movement ─────────────────────────────────────────────────────────────────
  {
    key: "admission", name: "Admission", group: "Admission & Movement", icon: "➕",
    eventType: "patient.admitted", quick: true,
    crossLink: { label: "Open Admissions workflow", href: "/supervisor/patient-ops-center" },
    note: "Admission changes the census and occupies a bed (BR-002/003). It is actioned through the operational Admissions workflow, which writes op_patients and auto-logs the admission event. This surface records the operational decision; state transition happens in that single entry point.",
    fields: [
      { key: "admission_type", label: "Admission type", type: "select", required: true, options: ["emergency", "elective", "transfer", "day_case"] },
      { key: "admission_source", label: "Admission source", type: "text" },
      { key: "service", label: "Service / specialty", type: "text", required: true },
      { key: "consultant", label: "Consultant", type: "text" },
      { key: "acuity", label: "Acuity level", type: "select", required: true, options: ACUITY },
      { key: "monitoring", label: "Monitoring requirement", type: "text" },
      { key: "immediate_risks", label: "Immediate risks (screening)", type: "textarea", required: true },
      { key: "checklist", label: "Admission checklist", type: "checklist", items: ["Identity confirmed", "Bed prepared", "Initial risk screen", "Allergies checked", "Care plan initiated"] },
    ],
  },
  {
    key: "transfer", name: "Transfer", group: "Admission & Movement", icon: "🔄",
    eventType: "patient.transfer.requested", quick: true,
    note: "Records a transfer request and its readiness. Destination acceptance and bed/arrival state (BR-004) are confirmed by the receiving unit — that acceptance→completion handshake and bed re-occupancy are an honest next-phase of the flow engine.",
    fields: [
      { key: "transfer_type", label: "Transfer type", type: "select", required: true, options: ["internal", "external", "theatre", "recovery", "icu_stepup", "stepdown"] },
      { key: "destination", label: "Requested destination", type: "text", required: true },
      { key: "reason", label: "Transfer reason", type: "textarea", required: true },
      { key: "priority", label: "Priority", type: "select", required: true, options: PRIORITY },
      { key: "transport", label: "Transport requirement", type: "text" },
      { key: "escort", label: "Escort / competency requirement", type: "text" },
      { key: "readiness", label: "Readiness checklist", type: "checklist", items: ["Destination confirmed", "Handover prepared", "Transport arranged", "Equipment ready", "Documentation ready"] },
    ],
  },
  {
    key: "procedure", name: "Procedure", group: "Admission & Movement", icon: "🔪",
    eventType: "patient.procedure.updated",
    note: "Tracks the procedure workflow (planned → in procedure → recovery → returned). Chronological time validation and theatre scheduling integration are phased.",
    fields: [
      { key: "procedure_name", label: "Procedure name / type", type: "text", required: true },
      { key: "status", label: "Procedure status", type: "select", required: true, options: ["planned", "confirmed", "preparing", "ready", "departed", "in_procedure", "recovery", "returned"] },
      { key: "indication", label: "Indication", type: "text", required: true },
      { key: "responsible_clinician", label: "Responsible clinician", type: "text", required: true },
      { key: "location", label: "Location", type: "text", required: true },
      { key: "consent_status", label: "Consent status", type: "select", required: true, options: ["obtained", "pending", "not_required"] },
      { key: "checklist", label: "Pre-procedure checklist", type: "checklist", items: ["Consent verified", "Fasting confirmed", "Site marked", "Investigations available", "Equipment ready"] },
      { key: "post_actions", label: "Post-procedure actions", type: "actions" },
    ],
  },

  // ── 2. Shift & Review ───────────────────────────────────────────────────────────────────────
  {
    key: "shift_update", name: "Shift Update", group: "Shift & Review", icon: "🔁",
    eventType: "patient.shift_update.submitted", quick: true,
    fields: [
      { key: "condition_trend", label: "Condition and trend", type: "select", required: true, options: ["stable", "improving", "worsening", "critical"] },
      { key: "acuity", label: "Acuity / dependency", type: "select", required: true, options: ACUITY },
      { key: "primary_concern", label: "Primary concern", type: "text", required: true, help: "A single concise operational concern" },
      { key: "systems", label: "Systems summary", type: "textarea", required: true, help: "Respiratory / neuro / circulatory / mobility / skin / infection" },
      { key: "care_priorities", label: "Care priorities", type: "actions", help: "Owner + priority" },
      { key: "sbar", label: "SBAR handover", type: "textarea", help: "Situation · Background · Assessment · Recommendation" },
      { key: "carry_forward", label: "Carry-forward actions", type: "actions" },
    ],
  },
  {
    key: "ward_round", name: "Ward Round", group: "Shift & Review", icon: "🩺",
    eventType: "patient.ward_round.completed", verify: true, quick: true,
    fields: [
      { key: "round_type", label: "Round type", type: "select", required: true, options: ["consultant", "post_take", "board", "multidisciplinary"] },
      { key: "lead_clinician", label: "Lead clinician", type: "text", required: true },
      { key: "summary", label: "Current summary / findings", type: "textarea", required: true },
      { key: "decisions", label: "Decisions", type: "actions", help: "Category + decision" },
      { key: "actions", label: "Actions", type: "actions", help: "Owner + due + priority" },
      { key: "next_review", label: "Next review", type: "datetime" },
    ],
  },
  {
    key: "clinical_review", name: "Clinical Review", group: "Shift & Review", icon: "🔎",
    eventType: "patient.review.completed", verify: true,
    fields: [
      { key: "review_type", label: "Review type / reason", type: "text", required: true },
      { key: "reviewer", label: "Reviewer", type: "text", required: true },
      { key: "findings", label: "Concern / findings / assessment", type: "textarea", required: true },
      { key: "actions", label: "Decisions / actions", type: "actions" },
      { key: "escalation_required", label: "Escalation required", type: "boolean", required: true },
      { key: "outcome", label: "Outcome", type: "select", required: true, options: ["resolved", "monitoring", "escalated", "review_scheduled"] },
      { key: "next_review", label: "Next review", type: "datetime" },
    ],
  },
  {
    key: "observation_summary", name: "Observation Summary", group: "Shift & Review", icon: "🌡️",
    eventType: "patient.monitoring_summary.updated",
    fields: [
      { key: "monitoring_plan", label: "Monitoring plan / frequency", type: "text", required: true },
      { key: "latest_score", label: "Latest score / trend", type: "text" },
      { key: "threshold_triggered", label: "Threshold triggered", type: "boolean", required: true },
      { key: "abnormal", label: "Abnormal parameters", type: "textarea" },
      { key: "clinician_notified", label: "Clinician notified", type: "boolean" },
      { key: "exception_reason", label: "Exception reason (missed / late)", type: "text" },
    ],
  },
  {
    key: "todays_goals", name: "Today's Goals", group: "Shift & Review", icon: "🎯",
    eventType: "patient.goals.updated",
    fields: [
      { key: "goal_category", label: "Goal category", type: "select", required: true, options: ["clinical", "mobility", "nutrition", "discharge", "psychosocial", "safety"] },
      { key: "goal", label: "Goal description", type: "text", required: true, help: "Specific and measurable" },
      { key: "target", label: "Target date/time", type: "datetime", required: true },
      { key: "priority", label: "Priority", type: "select", required: true, options: ["low", "medium", "high"] },
      { key: "barrier", label: "Dependency / barrier", type: "text" },
      { key: "goals", label: "Additional goals", type: "actions" },
    ],
  },

  // ── 3. Risk, Safety & Escalation ────────────────────────────────────────────────────────────
  {
    key: "risk_assessment", name: "Risk Assessment", group: "Risk, Safety & Escalation", icon: "⚠️",
    eventType: "patient.risk.updated",
    fields: [
      { key: "risk_type", label: "Risk type / tool", type: "select", required: true, options: ["falls", "pressure_injury", "vte", "sepsis", "deterioration", "nutrition", "delirium"] },
      { key: "risk_level", label: "Score / risk level", type: "select", required: true, options: ["low", "moderate", "high", "very_high"] },
      { key: "factors", label: "Contributing factors", type: "textarea" },
      { key: "preventive_actions", label: "Preventive actions", type: "actions", help: "Owner + due / review" },
      { key: "next_review", label: "Next review", type: "datetime", required: true },
    ],
  },
  {
    key: "escalation", name: "Escalation", group: "Risk, Safety & Escalation", icon: "🚨",
    eventType: "patient.escalation.raised", quick: true,
    note: "Raising here records the escalation event and creates an op_escalation. Acknowledgement / response SLA measurement and tiered routing rules (§12) run in the Clinical Safety escalation workflow.",
    fields: [
      { key: "category", label: "Category / trigger", type: "text", required: true },
      { key: "severity", label: "Severity", type: "select", required: true, options: ["low", "moderate", "high", "critical"] },
      { key: "level", label: "Escalation level", type: "select", required: true, options: ["1", "2", "3", "4"] },
      { key: "recipient", label: "Recipient / team", type: "text", required: true },
      { key: "requested_action", label: "Requested action", type: "textarea", required: true },
    ],
  },

  // ── 4. Communication & Coordination ─────────────────────────────────────────────────────────
  {
    key: "family_communication", name: "Family Communication", group: "Communication & Coordination", icon: "👪",
    eventType: "patient.communication.recorded",
    fields: [
      { key: "comm_type", label: "Communication type", type: "select", required: true, options: ["update", "meeting", "phone", "consent_discussion", "concern"] },
      { key: "person", label: "Person contacted / relationship", type: "text", required: true },
      { key: "information", label: "Information / questions / concerns", type: "textarea", required: true, help: "Minimum necessary data" },
      { key: "follow_up", label: "Follow-up actions", type: "actions" },
      { key: "outcome", label: "Outcome", type: "select", required: true, options: ["informed", "further_discussion", "concern_raised", "consent_obtained"] },
    ],
  },
  {
    key: "operational_note", name: "Operational Note", group: "Communication & Coordination", icon: "📝",
    eventType: "patient.note.recorded", quick: true,
    fields: [
      { key: "note_type", label: "Note type / subject", type: "text", required: true },
      { key: "note", label: "Structured note", type: "textarea", required: true },
      { key: "follow_up", label: "Follow-up actions", type: "actions" },
      { key: "visibility", label: "Visibility", type: "select", required: true, options: ["unit", "team", "supervisors", "restricted"] },
    ],
  },
  {
    key: "care_coordination", name: "Care Coordination", group: "Communication & Coordination", icon: "🤝",
    eventType: "patient.coordination.recorded",
    fields: [
      { key: "discipline", label: "Discipline / service", type: "text", required: true },
      { key: "need", label: "Coordination need", type: "textarea", required: true },
      { key: "responsible", label: "Responsible service / person", type: "text", required: true },
      { key: "appointment", label: "Appointment / review time", type: "datetime" },
      { key: "actions", label: "Follow-up actions", type: "actions" },
      { key: "status", label: "Status", type: "select", required: true, options: ["requested", "accepted", "in_progress", "completed"] },
    ],
  },

  // ── 5. Devices & Equipment ──────────────────────────────────────────────────────────────────
  {
    key: "device_record", name: "Device Record", group: "Devices & Equipment", icon: "🩹",
    eventType: "patient.device.added",
    fields: [
      { key: "device_type", label: "Device type / location", type: "text", required: true },
      { key: "indication", label: "Indication", type: "text", required: true },
      { key: "inserted_at", label: "Insertion date", type: "datetime", required: true },
      { key: "status", label: "Status", type: "select", required: true, options: ["active", "monitoring", "blocked", "removed"] },
      { key: "care_frequency", label: "Care frequency", type: "text" },
      { key: "review_target", label: "Review / removal target", type: "datetime" },
    ],
  },
  {
    key: "equipment_dependency", name: "Equipment Dependency", group: "Devices & Equipment", icon: "🔌",
    eventType: "patient.equipment.updated",
    fields: [
      { key: "equipment_type", label: "Equipment type / asset", type: "text", required: true },
      { key: "start_at", label: "Start time", type: "datetime", required: true },
      { key: "required_competency", label: "Required competency", type: "text" },
      { key: "status", label: "Status", type: "select", required: true, options: ["in_use", "standby", "fault", "replaced"] },
      { key: "fault_actions", label: "Fault / replacement actions", type: "actions" },
    ],
  },

  // ── 6. Tasks & Follow-up ────────────────────────────────────────────────────────────────────
  {
    key: "patient_task", name: "Patient Task", group: "Tasks & Follow-up", icon: "✅",
    eventType: "patient.task.created", quick: true,
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "category", label: "Category", type: "text", required: true },
      { key: "priority", label: "Priority", type: "select", required: true, options: ["low", "medium", "high", "urgent"] },
      { key: "assigned_to", label: "Assigned role / person", type: "text", required: true },
      { key: "due_at", label: "Due date/time", type: "datetime", required: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },

  // ── 7. Discharge & Closure ──────────────────────────────────────────────────────────────────
  {
    key: "discharge_planning", name: "Discharge Planning", group: "Discharge & Closure", icon: "🏠",
    eventType: "patient.discharge.plan_updated", quick: true, verify: true,
    note: "Records and tracks the discharge plan and readiness. Final discharge (encounter close + bed release, BR-005) is completed in the operational flow when all mandatory checks pass — that completion step is phased.",
    fields: [
      { key: "expected_date", label: "Expected discharge date", type: "datetime", required: true },
      { key: "destination", label: "Discharge destination", type: "select", required: true, options: ["home", "home_with_support", "residential_care", "another_facility", "rehabilitation"] },
      { key: "readiness", label: "Readiness level", type: "select", required: true, options: ["not_ready", "partial", "ready", "blocked"] },
      { key: "criteria", label: "Clinical / nursing criteria", type: "checklist", items: ["Medically stable", "Medicines reconciled", "Follow-up arranged", "Equipment arranged", "Transport arranged", "Education provided"] },
      { key: "barriers", label: "Barriers", type: "actions", help: "Category + owner + plan" },
    ],
  },
];

export const templateByKey = (key: string) => POS_TEMPLATES.find(t => t.key === key) ?? null;
