import { VERSION_STATUS_LABEL, VERSION_STATUS_NOTE, type VersionStatus } from "@/lib/knowledge/educator";
import { OSCE_DESIGN_CHECKLIST, OSCE_DIFFICULTY_LABEL, isOsceDifficulty, stationFieldsOf } from "@/lib/individual/scholar/osce";

// OSCE-AUTHORING-01 (owner, 31 Oct 2026). Where a knowledge version stands, said as one status (Draft, In clinical review,
// Approved, Published, Superseded, Rejected, Retired) with its text, never by colour alone, and a station read as a
// station by its reviewer and publisher, not as raw JSON. Server components: they show, they decide nothing.

const TONE: Record<VersionStatus, string> = {
  draft: "border-gray-400 bg-gray-50 text-gray-800",
  in_review: "border-amber-400 bg-amber-50 text-amber-950",
  approved: "border-sky-500 bg-sky-50 text-sky-950",
  rejected: "border-red-400 bg-red-50 text-red-900",
  published: "border-teal-600 bg-teal-50 text-teal-950",
  superseded: "border-gray-300 bg-white text-gray-600",
  retired: "border-gray-300 bg-white text-gray-600",
};

export function StatusChip({ status }: { status: VersionStatus }) {
  return (
    <span title={VERSION_STATUS_NOTE[status]} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${TONE[status]}`}>
      {VERSION_STATUS_LABEL[status]}<span className="sr-only">: {VERSION_STATUS_NOTE[status]}</span>
    </span>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (v ? <div><dt className="inline font-semibold text-gray-700">{k}: </dt><dd className="inline">{v}</dd></div> : null);
const List = ({ title, items }: { title: string; items: string[] }) => (items.length ? (
  <div><p className="font-semibold text-gray-700">{title}</p><ul className="ml-4 list-disc">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
) : null);

/** A station as its reviewer reads it: every authored part, the critical items marked in words, guidance kept apart. */
export function StationPreview({ content }: { content: unknown }) {
  const f = stationFieldsOf(content);
  const critical = f.checklist.filter(i => i.critical).length;
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[12.5px] text-gray-900">
      <dl className="grid gap-0.5 md:grid-cols-2">
        <Row k="Profession" v={f.profession} /><Row k="Programme" v={[f.programmeCode, f.programmeLabel].filter(Boolean).join(" · ")} />
        <Row k="Topic" v={f.topic} /><Row k="Body system" v={f.bodySystem} />
        <Row k="Difficulty" v={isOsceDifficulty(f.difficulty) ? OSCE_DIFFICULTY_LABEL[f.difficulty] : ""} /><Row k="Duration" v={`${f.durationMinutes} minutes`} />
      </dl>
      <List title="Learning outcomes" items={f.learningOutcomes} />
      <List title="Objectives" items={f.objectives} />
      <div><p className="font-semibold text-gray-700">Candidate instructions</p><p className="whitespace-pre-wrap">{f.candidateInstructions}</p></div>
      <div><p className="font-semibold text-gray-700">Scenario</p><p className="whitespace-pre-wrap">{f.scenario}</p></div>
      <List title="Expected candidate activities" items={f.expectedActivities} />
      <List title="Response sections" items={f.sections.length ? f.sections : ["(the Scholar defaults)"]} />
      <div>
        <p className="font-semibold text-gray-700">Checklist: {f.checklist.length} items, {critical} critical{f.checklist.length < OSCE_DESIGN_CHECKLIST.min || f.checklist.length > OSCE_DESIGN_CHECKLIST.max ? ` (outside the usual ${OSCE_DESIGN_CHECKLIST.min} to ${OSCE_DESIGN_CHECKLIST.max})` : ""}</p>
        <ol className="ml-5 list-decimal">{f.checklist.map(i => <li key={i.id}>{i.text}{i.critical && <strong className="ml-1 text-[var(--cmp-text-critical)]">Critical</strong>}{i.outcome && <span className="text-gray-600"> · outcome: {i.outcome}</span>}</li>)}</ol>
      </div>
      <List title="Suggested responses (shown to the learner only after a run)" items={f.suggestedResponses} />
      {f.assessmentGuidance && <div><p className="font-semibold text-gray-700">Scoring guidance (shown only after a run)</p><p className="whitespace-pre-wrap">{f.assessmentGuidance}</p></div>}
      <List title="References" items={f.references.map(r => (r.url ? `${r.label} (${r.url})` : r.label))} />
    </div>
  );
}
