import { reportTemplateById } from "@/lib/practice/report-templates";
import type { WorkspaceContext } from "@/lib/practice/access";

// CPR-MOB-001 s14 row 3 -- "Recent reports: vertical list with format/date/download".
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE RECENT LIST IS THE AUDIT TRAIL. Nothing stores a generated report (owner's decision,
// 2026-08-15): practice.report_generated and practice.report_exported ARE the record that a report was
// produced, so this reads them rather than a reports table that does not exist. That is also why the
// row's action is REGENERATE and never "download the file you made" -- there is no file to fetch, and
// a link implying otherwise would hand somebody yesterday's figures under today's date.
//
// ⚠ A SECOND COPY OF ONE READ, KNOWINGLY. The desktop Reports tab does this same select inline in
// intelligence/ReportsV2Area.tsx. Both read an append-only table and neither computes anything, so
// they cannot disagree about a figure -- but they can drift about WHICH events count as a generation.
// The fold belongs in src/lib/practice (one exported reader, both callers importing it), which is
// outside this phase's file ownership; it is reported rather than done here.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RecentReport = {
  /** null for a raw data export, which is not a template. */
  templateId: string | null;
  activityId: string | null;
  name: string;
  /**
   * ⚠ s14 ASKS EACH ROW FOR ITS FORMAT AND THE TRAIL CANNOT ALWAYS SAY. generateReport writes its
   * audit row BEFORE the route chooses csv or xlsx -- and the print view produces the same row with
   * no format at all -- so practice.report_generated genuinely does not carry one. The two
   * practice.report_exported emitters (the activity CSV and the financial CSV) only ever write CSV,
   * so those rows can say so truthfully. Everything else reads "not recorded", which is the fact.
   * Recording the format would mean the engine accepting it as an argument: an engine change, and
   * outside this phase.
   */
  format: string;
  /** Minute precision, as stored -- not re-zoned, because the trail is the record. */
  when: string;
  fromDay: string | null;
  toDay: string | null;
  identified: boolean;
};

export async function recentReports(
  admin: any, ctx: WorkspaceContext, limit = 8,
): Promise<RecentReport[]> {
  const { data } = await admin.from("practice_audit_event")
    .select("payload, occurred_at, event_type").eq("workspace_id", ctx.workspaceId)
    .in("event_type", ["practice.report_generated", "practice.report_exported"])
    .order("occurred_at", { ascending: false }).limit(limit);

  return ((data ?? []) as any[]).map(r => ({
    templateId: r.payload?.templateId ?? null,
    activityId: r.payload?.activityId ?? null,
    name: r.payload?.templateId
      ? (reportTemplateById(r.payload.templateId)?.name ?? r.payload.templateId)
      : r.event_type === "practice.report_exported"
        ? (r.payload?.kind === "financial" ? "Financial report" : "Practice activity export")
        : "Report",
    format: r.event_type === "practice.report_exported" ? "CSV" : "not recorded",
    when: String(r.occurred_at).slice(0, 16).replace("T", " "),
    fromDay: r.payload?.fromDay ?? null,
    toDay: r.payload?.toDay ?? null,
    identified: r.payload?.identified === true,
  }));
}
