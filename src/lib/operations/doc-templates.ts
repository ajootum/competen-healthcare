// Operational document templates + generator (POS-109). Template DEFINITIONS live here (tenant-
// configurable templates are governed by POS-112 — an honest next-phase); the generated document
// INSTANCES persist in op_documents (migration 085). The generator is a PURE function: it takes the
// enriched operational patient (from loadPatientOps) plus context and returns a content snapshot —
// so a document reflects the live operational state at generation time and never fabricates data.
// Fields the operational store doesn't hold render as an honest "—" or are omitted.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type DocSection = { heading: string; lines: string[] };
export type DocTemplate = { key: string; name: string; docType: string; scope: "patient"; blurb: string; sign: boolean };

export const DOC_TEMPLATES: DocTemplate[] = [
  { key: "shift_summary", name: "Shift Summary", docType: "Shift", scope: "patient", blurb: "Current operational state, observations, team and priorities for handover.", sign: false },
  { key: "handover_summary", name: "Handover Summary", docType: "Handover", scope: "patient", blurb: "Structured SBAR handover generated from live state.", sign: true },
  { key: "admission_summary", name: "Admission Summary", docType: "Admission", scope: "patient", blurb: "Operational admission record — location, state, initial risks and plan.", sign: false },
  { key: "ward_round_summary", name: "Ward Round Summary", docType: "Ward Round", scope: "patient", blurb: "Summary, decisions and actions from the latest ward round.", sign: true },
  { key: "transfer_note", name: "Transfer Note", docType: "Transfer", scope: "patient", blurb: "Transfer details, current state and readiness.", sign: true },
  { key: "discharge_summary", name: "Discharge Summary", docType: "Discharge", scope: "patient", blurb: "Discharge plan, readiness and follow-up.", sign: true },
];

export const docTemplateByKey = (key: string) => DOC_TEMPLATES.find(t => t.key === key) ?? null;

const tc = (s: string | null) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const val = (v: any) => (v == null || v === "" ? "—" : String(v));

// Identity + location section shared by every document.
function idSection(pt: any): DocSection {
  return { heading: "Patient & Location", lines: [
    `Operational label: ${val(pt.label)}`,
    `Bed: ${val(pt.bed)}${pt.department ? ` · ${pt.department}` : ""}`,
    `Age: ${pt.age != null ? pt.age + "y" : "—"} · Consultant: ${val(pt.consultant)}`,
    `Operational status: ${tc(pt.opStatus)} · Stage: ${pt.stage ? tc(pt.stage) : "—"}`,
  ] };
}
function stateSection(pt: any): DocSection {
  return { heading: "Current State", lines: [
    `Clinical state: ${val(pt.state)} · Acuity: ${tc(pt.acuity)}`,
    `PEWS: ${pt.pews ?? "—"}${pt.pewsTrend?.length ? ` (trend ${pt.pewsTrend.map((t: any) => t.v).join("→")})` : ""}`,
    `Isolation: ${pt.isolation && pt.isolation !== "none" ? tc(pt.isolation) : "None"}`,
    `Last observation: ${fmt(pt.lastObs)} · Next review: ${fmt(pt.nextReview)}${pt.overdueObs ? " (OVERDUE)" : ""}`,
  ] };
}
function teamSection(pt: any): DocSection {
  return { heading: "Assigned Team", lines: [`Assigned nurse: ${pt.nurse ? pt.nurse : "Unassigned"}`, `Consultant: ${val(pt.consultant)}`] };
}
function risksSection(pt: any): DocSection {
  const lines: string[] = [];
  if (pt.flags?.length) pt.flags.forEach((f: string) => lines.push(`• ${f}`));
  (pt.alerts ?? []).forEach((a: any) => lines.push(`• Alert: ${tc(a.category)} (${a.severity})`));
  (pt.escalations ?? []).forEach((e: any) => lines.push(`• Escalation L${e.level} — ${e.status}`));
  if (!lines.length) lines.push("No active risks, alerts or escalations recorded.");
  return { heading: "Active Risks & Alerts", lines };
}
// Latest submitted form of a given template for this patient (payload), if any.
const formPayload = (forms: any[], key: string) => forms.find(f => f.template_key === key)?.payload ?? null;

export function generateDocContent(templateKey: string, pt: any, ctx: { forms?: any[]; movements?: any[] }): DocSection[] {
  const forms = ctx.forms ?? [];
  switch (templateKey) {
    case "shift_summary": {
      const su = formPayload(forms, "shift_update");
      const pri = su?.care_priorities?.length ? su.care_priorities.map((r: any) => `• ${r.text}${r.owner ? ` (${r.owner})` : ""}`) : ["No priorities recorded on the latest shift update."];
      return [idSection(pt), stateSection(pt), teamSection(pt), risksSection(pt),
        { heading: "Priorities", lines: pri },
        ...(su?.primary_concern ? [{ heading: "Primary Concern", lines: [su.primary_concern] }] : [])];
    }
    case "handover_summary": {
      const su = formPayload(forms, "shift_update");
      return [idSection(pt),
        { heading: "S — Situation", lines: [`${val(pt.label)} in ${val(pt.bed)}, ${val(pt.state)}, PEWS ${pt.pews ?? "—"}.`, su?.primary_concern ? `Primary concern: ${su.primary_concern}` : "Primary concern: —"] },
        { heading: "B — Background", lines: [`Stage ${pt.stage ? tc(pt.stage) : "—"}, consultant ${val(pt.consultant)}.`, su?.sbar ? String(su.sbar) : "Background per operational record."] },
        { heading: "A — Assessment", lines: [`Acuity ${tc(pt.acuity)}; ${pt.overdueObs ? "observations overdue; " : ""}${(pt.escalations?.length ? pt.escalations.length + " open escalation(s); " : "")}${pt.flags?.length ? "risks: " + pt.flags.join(", ") : "no active safety flags"}.`] },
        { heading: "R — Recommendation", lines: (su?.carry_forward?.length ? su.carry_forward.map((r: any) => `• ${r.text}${r.owner ? ` (${r.owner})` : ""}`) : ["Continue current plan; review at next observation."]) }];
    }
    case "admission_summary": {
      const ad = formPayload(forms, "admission");
      return [idSection(pt),
        { heading: "Admission Details", lines: [`Type: ${ad ? tc(ad.admission_type) : "—"} · Source: ${ad ? val(ad.admission_source) : "—"}`, `Service: ${ad ? val(ad.service) : "—"} · Consultant: ${val(pt.consultant)}`] },
        stateSection(pt),
        { heading: "Initial Risks", lines: ad?.immediate_risks ? [String(ad.immediate_risks)] : risksSection(pt).lines },
        { heading: "Plan", lines: [`Monitoring: ${ad ? val(ad.monitoring) : "—"}`, `Acuity: ${tc(pt.acuity)}`] }];
    }
    case "ward_round_summary": {
      const wr = formPayload(forms, "ward_round");
      return [idSection(pt),
        { heading: "Summary / Findings", lines: [wr?.summary ? String(wr.summary) : "No ward-round record found — generate after the round is documented."] },
        { heading: "Decisions", lines: wr?.decisions?.length ? wr.decisions.map((r: any) => `• ${r.text}`) : ["—"] },
        { heading: "Actions", lines: wr?.actions?.length ? wr.actions.map((r: any) => `• ${r.text}${r.owner ? ` (${r.owner})` : ""}`) : ["—"] },
        ...(wr?.next_review ? [{ heading: "Next Review", lines: [fmt(wr.next_review)] }] : [])];
    }
    case "transfer_note": {
      const tr = formPayload(forms, "transfer");
      return [idSection(pt), stateSection(pt),
        { heading: "Transfer Details", lines: [`Type: ${tr ? tc(tr.transfer_type) : "—"} · Priority: ${tr ? tc(tr.priority) : "—"}`, `Destination: ${tr ? val(tr.destination) : "—"}`, `Reason: ${tr ? val(tr.reason) : "—"}`] },
        { heading: "Readiness", lines: tr?.readiness?.length ? tr.readiness.map((x: string) => `✓ ${x}`) : ["Readiness checklist not recorded."] }];
    }
    case "discharge_summary": {
      const dc = formPayload(forms, "discharge_planning");
      return [idSection(pt),
        { heading: "Discharge Plan", lines: [`Destination: ${dc ? tc(dc.destination) : "—"} · Expected: ${dc ? fmt(dc.expected_date) : "—"}`, `Readiness: ${dc ? tc(dc.readiness) : "—"}`] },
        { heading: "Criteria", lines: dc?.criteria?.length ? dc.criteria.map((x: string) => `✓ ${x}`) : ["Criteria not recorded."] },
        stateSection(pt),
        { heading: "Barriers / Follow-up", lines: dc?.barriers?.length ? dc.barriers.map((r: any) => `• ${r.text}${r.owner ? ` (${r.owner})` : ""}`) : ["None recorded."] }];
    }
    default:
      return [idSection(pt), stateSection(pt)];
  }
}
