import type { ReactNode } from "react";

// CP-UI-TABLE-001 -- THE CLINICAL BANDED RECORD TABLE.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// s2's GLOBAL RULE: REPEATED CLINICAL DATA = BANDED RECORD TABLE. One header per dataset, one record
// per row, subtle zebra, horizontal separators only, primary information left-most, status as a
// compact badge, actions at the far right.
//
// ⚠ s12: BUILD THE SHARED COMPONENT FIRST, THEN MIGRATE TABS TO IT, and "do not duplicate CSS/layout
// rules independently inside each encounter tab". That instruction is the reason this file exists
// rather than a fourth hand-rolled table -- Diagnoses, Treatment, Procedures and Investigations had
// three different row shapes between them this morning, and the drift was invisible until the tabs
// were seen side by side.
//
// ⚠ AND IT REVERSES A DESIGN FROM EARLIER THE SAME DAY. Treatment was rebuilt into cards a few hours
// before this standard arrived, against a comp that showed cards. s1 and s6 supersede that in as many
// words: "migrated away from visually heavy independent cards", "do not repeat a large bordered card
// around every treatment". Newest document wins.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * s11's rowState vocabulary.
 *
 * ⚠ `warning` AND `error` ARE FOR CLINICALLY ACTIONABLE ISSUES ONLY (s4, s6). Everything else is
 * `normal`. A warning tint spent on an ordinary row is a warning nobody reads on the row that matters,
 * and s6 is explicit that "clinically important warnings must remain immediately visible".
 */
export type RowState =
  | "normal" | "primary" | "selected" | "warning" | "error" | "completed" | "stopped";

export type RecordColumn<T> = {
  key: string;
  label: string;
  /**
   * s9's responsive rule. `primary` and `status` survive at every width; `secondary` columns move
   * beneath the primary line on narrow screens rather than forcing a horizontal scrollbar.
   */
  priority?: "primary" | "status" | "secondary";
  align?: "left" | "right";
  render: (row: T) => ReactNode;
};

export type ClinicalRecord<T> = {
  id: string;
  data: T;
  state?: RowState;
  /**
   * s2 and s6's second line: safety or context that cannot fit cleanly into columns. Rendered inside
   * the SAME logical record, attached to its row, so one record still reads as one record.
   */
  secondaryText?: ReactNode;
  actions?: ReactNode;
  /** s10: an explicit name for the row's state, because colour alone may not carry it. */
  stateLabel?: string;
  /**
   * s3.1 and s11's expandable detail -- a correction form, a result, a drawer's worth of record.
   *
   * ⚠ "EXPANDED CONTENT REMAINS VISUALLY ATTACHED TO ITS PARENT ROW" (s3.1). It is drawn inside the
   * same tbody, on the same surface, with no separator above it, so a form that is editing row four
   * cannot be read as belonging to row five.
   */
  expandedContent?: ReactNode;
};

const SURFACE: Record<RowState, string> = {
  // ⚠ SUBTLE ON PURPOSE (s4): "banding organizes rows rather than decorating them".
  normal: "",
  primary: "bg-[var(--cp-primary)]/[0.06]",
  selected: "bg-[var(--cp-primary)]/[0.06]",
  // s4: warning/error OVERRIDE ordinary banding. s12: "clinical meaning overrides visual uniformity".
  warning: "bg-[var(--cmp-surface-warning)]",
  error: "bg-[var(--cmp-surface-critical)]",
  completed: "",
  stopped: "",
};

const ACCENT: Record<RowState, string> = {
  normal: "transparent",
  primary: "var(--cp-primary)",
  selected: "var(--cp-primary)",
  warning: "var(--cmp-text-warning)",
  error: "var(--cmp-text-critical)",
  completed: "transparent",
  stopped: "transparent",
};

const overridesBanding = (s: RowState) => s === "warning" || s === "error";

export const REC_TH =
  "px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500";
export const REC_TD = "px-3 py-2.5 align-middle text-[12.5px] text-gray-800";

/**
 * s4: "No empty table shell. Show a concise empty-state message plus the relevant add action."
 * A header row over nothing is a table pretending to be a dataset.
 */
export function ClinicalRecordTable<T>({ columns, records, empty, label }: {
  columns: RecordColumn<T>[];
  records: ClinicalRecord<T>[];
  /** Rendered INSTEAD of the table when there is nothing. Never an empty shell. */
  empty: ReactNode;
  /** The accessible name for the table, e.g. "Diagnoses recorded in this encounter". */
  label: string;
}) {
  if (records.length === 0) return <>{empty}</>;

  // s2: "Keep row actions consistently at the far right." The column is added by the component rather
  // than by each caller, so no tab can put them somewhere else or forget the header cell.
  const hasActions = records.some(r => r.actions);
  const span = columns.length + (hasActions ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-gray-50/80">
          <tr>
            {columns.map(c => (
              <th key={c.key} scope="col"
                className={`${REC_TH} ${c.align === "right" ? "text-right" : ""} ${
                  // s9: secondary columns fold away on narrow widths rather than scrolling sideways.
                  c.priority === "secondary" ? "hidden md:table-cell" : ""}`}>
                {c.label}
              </th>
            ))}
            {hasActions && <th scope="col" className={`${REC_TH} text-right`}>Actions</th>}
          </tr>
        </thead>
        {/* ⚠ ONE <tbody> PER RECORD, AS SIBLINGS -- NOT ONE WRAPPING THEM ALL. Several tbody elements
            in a table are valid HTML; a tbody inside a tbody is not, and the browser silently reshapes
            invalid nesting, which is one of the three things that produce a React hydration error. */}
        {records.map((r, i) => {
            const state = r.state ?? "normal";
            // ⚠ THE STRIPE IS SKIPPED WHERE THE STATE PAINTS ITS OWN SURFACE. Zebra under a warning
            // tint would make one warning look like two different colours depending on whether it
            // landed on an odd or an even row -- s4's "warning overrides banding", literally.
            const painted = overridesBanding(state) || state === "primary" || state === "selected";
            const zebra = painted ? "" : i % 2 === 1 ? "bg-gray-50/60" : "bg-white";
            const rowClass = `border-l-[3px] transition-colors ${SURFACE[state]} ${zebra}`;
            return (
              // ⚠ ONE RECORD IS ONE <tbody>, NOT TWO LOOSE ROWS. The second line is a row of its own so
              // the columns above it stay aligned, and grouping the pair keeps "one record, one row"
              // true for a screen reader and for the zebra, which counts records rather than lines.
              <tbody key={r.id} className="border-t border-gray-100">
                <tr style={{ borderLeftColor: ACCENT[state] }} className={`${rowClass} hover:bg-gray-50/80`}>
                  {columns.map((c, ci) => (
                    <td key={c.key}
                      className={`${REC_TD} ${c.align === "right" ? "text-right whitespace-nowrap" : ""} ${
                        c.priority === "secondary" ? "hidden md:table-cell" : ""}`}>
                      {/* ⚠ s10: THE ROW STATE IS NAMED, NOT ONLY COLOURED. "Do not rely on row
                          background colour alone to communicate status." The label rides on the first
                          cell so a screen reader meets it with the record, and so the row still says
                          what it is in greyscale or at high zoom. */}
                      {ci === 0 && r.stateLabel && <span className="sr-only">{r.stateLabel}. </span>}
                      {c.render(r.data)}
                    </td>
                  ))}
                  {hasActions && (
                    <td className={`${REC_TD} text-right whitespace-nowrap`}>{r.actions}</td>
                  )}
                </tr>
                {r.expandedContent && (
                  <tr style={{ borderLeftColor: ACCENT[state] }} className={rowClass}>
                    <td colSpan={span} className="px-3 pb-3 pt-0">{r.expandedContent}</td>
                  </tr>
                )}
                {r.secondaryText && (
                  // s2: "Allow a muted secondary line within a row where safety/context information
                  // cannot fit cleanly into columns." Same surface as its parent, no top border, so it
                  // reads as part of that record rather than as a record of its own.
                  <tr style={{ borderLeftColor: ACCENT[state] }} className={rowClass}>
                    <td colSpan={span} className="px-3 pb-2 pt-0 text-[11px] text-gray-500">
                      {r.secondaryText}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
      </table>
    </div>
  );
}
