import { costText, type ActivityCost } from "@/lib/ai/activity-cost";
import { ENGAGEMENT_IS_NOT_LEARNING, NO_TARGETS, figureText, type EffectivenessCell, type EffectivenessReadout } from "./measures";

// ── PILOT EVALUATION REPORT EXPORT ── SALE-2026-11 R5, tracker row SALE-18 (owner directive s10, s15 "measured operational cost") ──
//
// The report the owner exports at pilot closure: the same aggregates the HQ readout shows, with every sample size, every
// suppressed cell and every caution kept beside its figure. Markdown for reading and filing, CSV for a spreadsheet.
// ⚠ AGGREGATES ONLY. Built from the readout (985, consented and floored) and the cost summary (ledger, audit codes, gateway
// latencies). It contains no learner id, no name and no content, because its inputs contain none.

export type ReportInput = { readout: EffectivenessReadout; cost: ActivityCost; generatedAt: string };

export const LIMITATIONS: readonly string[] = [
  "Population: only learners who granted collective analytics consent. Learners who did not are in no figure, so the figures describe a self-selected group.",
  "Suppression: every cell describing fewer learners than the CKRI minimum cohort is withheld. Counts are rounded, rates are computed from exact counts before rounding.",
  "Observational: no learner was assigned to a teaching flow at random. The standard and adaptive comparison is descriptive.",
  "Formative: understanding checks and practice answers are formative. Nothing here is a grade, an assessment or verified competence.",
  "Time is estimated from activity gaps, never measured from an open tab.",
  "Cost is the settled AI usage ledger only. With metering off nothing is recorded, which is reported as no data, never as zero.",
  "Small samples: one pilot cohort. Interpret every figure cautiously and do not generalise.",
];

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};
const n = (v: number | null) => (v === null ? "-" : String(v));

function cellLine(c: EffectivenessCell, floor: number): string {
  return `| ${esc(c.label)} | ${esc(figureText(c, floor))} | ${n(c.learners)} | ${n(c.numerator)} / ${n(c.denominator)} | ${esc(c.counts)} | ${esc(`${c.sample} ${c.caution}`)} |`;
}

/** Pure. The Markdown report. */
export function reportMarkdown(input: ReportInput): string {
  const { readout: r, cost } = input;
  const out: string[] = [
    "# Competen Scholar pilot evaluation (SALE-2026-11)",
    "",
    `Generated ${input.generatedAt}. Window: last ${r.days} days. Minimum cohort: ${r.floor} learners. Counts rounded to ${r.roundTo}.`,
    "",
    `> ${ENGAGEMENT_IS_NOT_LEARNING}`,
    `> ${NO_TARGETS}`,
    "",
    "## Learning outcomes",
    "",
  ];
  if (!r.measured) out.push(r.reason, "");
  else {
    const head = ["| Measure | Figure | Learners | Count | What is counted | Sample and caution |", "|---|---|---|---|---|---|"];
    out.push(...head, ...r.cells.filter(c => c.group === "outcome").map(c => cellLine(c, r.floor)), "");
    out.push("## Standard against adaptive flow", "", ...head, ...r.cells.filter(c => c.group === "comparison").map(c => cellLine(c, r.floor)), "");
    out.push(r.comparison.differencePoints === null ? r.comparison.reason ?? "" : `Difference (adaptive minus standard): ${r.comparison.differencePoints > 0 ? "+" : ""}${r.comparison.differencePoints} percentage points.`,
      "", `Basis: ${r.comparison.basis}`, "", `Caution: ${r.comparison.caution}`, "");
    out.push("## Learner experience (friction signals)", "", ...head, ...r.cells.filter(c => c.group === "friction").map(c => cellLine(c, r.floor)), "");
  }
  out.push("## AI cost and latency per useful activity", "", `Window: last ${cost.days} days. Metering: ${cost.meteringOn ? "on" : "off"}.`, "",
    "| Activity | Cost |", "|---|---|",
    `| Per evaluated answer | ${esc(costText(cost.perEvaluatedAnswer))} |`,
    `| Per completed session | ${esc(costText(cost.perCompletedSession))} |`,
    `| Per lesson taught | ${esc(costText(cost.perLessonTaught))} |`, "");
  if (cost.perCompletedSession.measured && cost.perCompletedSession.basis) out.push(`Per completed session: ${cost.perCompletedSession.basis}`, "");
  if (cost.perLessonTaught.measured && cost.perLessonTaught.basis) out.push(`Per lesson taught: ${cost.perLessonTaught.basis}`, "");
  out.push(cost.reuse.measured ? `Reuse: ${cost.reuse.percent}% of ${cost.reuse.served + cost.reuse.generated} lessons delivered were served from a saved lesson with no AI (${cost.reuse.served} served, ${cost.reuse.generated} generated).` : `Reuse: ${cost.reuse.reason}`, "");
  if (cost.latency.measured) {
    out.push("| Activity | Calls | p50 ms | p90 ms | Note |", "|---|---|---|---|---|",
      ...cost.latency.rows.map(l => `| ${esc(l.activity)} | ${l.n} | ${l.p50} | ${l.p90} | ${l.small ? "Small sample" : ""} |`), "");
  } else out.push(`Latency: ${cost.latency.reason}`, "");
  if (cost.truncated) out.push("Note: a source hit its read limit, so a figure may cover part of the window.", "");
  out.push("## Limitations", "", ...LIMITATIONS.map(l => `- ${l}`), "");
  return out.join("\n");
}

/** Pure. The CSV report: one row per figure, every row with its sample size and caution. */
export function reportCsv(input: ReportInput): string {
  const { readout: r, cost } = input;
  const rows: (string | number | null)[][] = [["section", "measure", "arm", "state", "figure", "learners", "numerator", "denominator", "rate", "value", "counts", "sample_note", "caution"]];
  if (!r.measured) rows.push(["outcomes", "", "", "not_measured", r.reason, null, null, null, null, null, "", "", ""]);
  else for (const c of r.cells) rows.push([c.group, c.measure, c.arm, c.state, figureText(c, r.floor), c.learners, c.numerator, c.denominator, c.rate, c.value, c.counts, c.sample, c.caution]);
  if (r.measured) rows.push(["comparison", "corrective_followup", "adaptive_minus_standard", r.comparison.differencePoints === null ? "not_compared" : "reported",
    r.comparison.differencePoints === null ? r.comparison.reason : `${r.comparison.differencePoints} points`, null, null, null, r.comparison.differencePoints, null, r.comparison.basis, "", r.comparison.caution]);
  const cost1 = (m: string, f: ActivityCost["perLessonTaught"]) =>
    rows.push(["cost", m, "usd", f.measured ? "reported" : cost.meteringOn ? "not_measured" : "metering_off", costText(f), null, f.measured ? f.usd : null, f.measured ? f.n : null, null, f.measured ? f.per : null, "", "", f.measured ? (f as { basis?: string }).basis ?? "" : ""]);
  cost1("per_evaluated_answer", cost.perEvaluatedAnswer);
  cost1("per_completed_session", cost.perCompletedSession);
  cost1("per_lesson_taught", cost.perLessonTaught);
  rows.push(["cost", "reuse_share", "served_from_saved", cost.reuse.measured ? "reported" : "not_measured", cost.reuse.measured ? `${cost.reuse.percent}%` : cost.reuse.reason, null,
    cost.reuse.measured ? cost.reuse.served : null, cost.reuse.measured ? cost.reuse.served + cost.reuse.generated : null, cost.reuse.measured ? cost.reuse.percent : null, null, "", "", ""]);
  if (cost.latency.measured) for (const l of cost.latency.rows) rows.push(["latency", l.activity, "p50_p90_ms", "reported", `${l.p50} / ${l.p90} ms`, null, null, l.n, null, l.p90, "", l.small ? "Small sample" : "", ""]);
  else rows.push(["latency", "", "", "not_measured", cost.latency.reason, null, null, null, null, null, "", "", ""]);
  for (const l of LIMITATIONS) rows.push(["limitation", "", "", "", l, null, null, null, null, null, "", "", ""]);
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
