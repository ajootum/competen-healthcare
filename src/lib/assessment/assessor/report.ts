// Assessor workspace: the data behind the report page. Pure shaping on top of loadInstance().
/* eslint-disable @typescript-eslint/no-explicit-any */
import { evalField, evaluate, orderedItems, PRIMARY, type Evaluation, type OutcomeClass } from "@/lib/assessment/core";
import { type Admin, type Res, fail, humanize, okRes } from "./common";
import { loadInstance, type CommentView, type EvidenceView, type LoadedInstance } from "./instances";

export interface ReportData {
  loaded: LoadedInstance;
  subjectName: string | null;
  assessorName: string | null;
  /** the stored outcome applied over a fresh evaluation, so the page shows what was recorded */
  evaluation: Evaluation | null;
  metadata: { label: string; value: string | null }[];
  strengths: { text: string; itemKey?: string }[];
  gaps: { text: string; itemKey?: string }[];
  safetyConcerns: CommentView[];
  recommendations: CommentView[];
  generalComments: CommentView[];
  itemComments: Record<string, string>;
  evidenceRefs: { label: string; kind?: string; itemKey?: string; added?: string }[];
}

const day = (t: string | null | undefined) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

/** The recorded outcome laid over a fresh evaluation. The database backstop may have replaced the engine's outcome. Pure. */
export function withRecordedOutcome(ev: Evaluation, rec: { outcome_code: string; outcome_class: string; backstop_applied: boolean }, labelOf: (code: string) => string | null): Evaluation {
  if (rec.outcome_code === ev.outcome.code && rec.outcome_class === ev.class) return ev;
  const gate = rec.backstop_applied ? (rec.outcome_class === "negative" ? "gate:criticalFail" : "gate:mandatoryMissing") : ev.decided_by;
  return { ...ev, outcome: { code: rec.outcome_code, label: labelOf(rec.outcome_code) ?? rec.outcome_code, class: rec.outcome_class as OutcomeClass }, class: rec.outcome_class as OutcomeClass, decided_by: gate };
}

export function evidenceRefsOf(evidence: EvidenceView[], codeOf: (key: string) => string | null): ReportData["evidenceRefs"] {
  return evidence.map(e => ({
    label: `${e.item_key ? `${codeOf(e.item_key) ?? "Item"}: ` : ""}${e.kind === "note" ? (e.note ?? "Note") : `${humanize(e.ref_kind ?? "record")} ${e.ref_id ?? ""}`}`.trim(),
    kind: e.kind, itemKey: e.item_key ?? undefined, added: day(e.created_at) ?? undefined,
  }));
}

export async function loadReport(admin: Admin, actor: string, instanceId: string): Promise<Res<ReportData>> {
  const l = await loadInstance(admin, actor, instanceId);
  if (!l.ok) return l;
  const loaded = l.value;
  if (loaded.instance.status !== "submitted" || !loaded.outcome) return fail(409, "The report is available once the assessment is submitted.");
  const { def, rules, version } = loaded.definition;
  let ev: Evaluation | null = null;
  try {
    ev = withRecordedOutcome(evaluate(def, rules, loaded.responses, { evidenceCounts: loaded.evidenceCounts }), loaded.outcome, code => rules.outcomes.find(o => o.code === code)?.label ?? null);
  } catch { ev = null; }

  const ids = [loaded.instance.subject_user_id, loaded.instance.respondent_id].filter(Boolean) as string[];
  const prof = await admin.from("profiles").select("id, full_name").in("id", ids);
  const nm = new Map<string, string | null>((prof.data ?? []).map((p: any) => [p.id as string, p.full_name ?? null]));
  const subjectName = loaded.instance.subject_user_id ? nm.get(loaded.instance.subject_user_id) ?? null : null;
  const assessorName = loaded.instance.respondent_id ? nm.get(loaded.instance.respondent_id) ?? null : null;
  const ins = await admin.from("asmt_instrument").select("code, name").eq("id", version.instrument_id).maybeSingle();
  const snap = loaded.instance.respondent_snapshot as any;

  const items = orderedItems(def);
  const codeOf = (k: string) => items.find(i => i.stable_key === k)?.code ?? null;
  const gaps: ReportData["gaps"] = [];
  for (const i of items) {
    const e = evalField(i, PRIMARY, loaded.responses, rules.defaults);
    if (e.status === "unsatisfactory") gaps.push({ text: `${i.code}: ${i.prompt} (${e.why})`, itemKey: i.stable_key });
    else if (e.status === "missing" && (i.mandatory || i.critical)) gaps.push({ text: `${i.code}: ${i.prompt} (not answered)`, itemKey: i.stable_key });
  }
  const byKind = (k: string) => loaded.comments.filter(c => c.kind === k);
  const strengths: ReportData["strengths"] = byKind("strength").map(c => ({ text: c.body, itemKey: c.item_key ?? undefined }));
  const itemComments: Record<string, string> = {};
  for (const c of loaded.comments) if (c.item_key && c.kind === "comment") itemComments[c.item_key] = itemComments[c.item_key] ? `${itemComments[c.item_key]} / ${c.body}` : c.body;

  const metadata: ReportData["metadata"] = [
    { label: "Person assessed", value: subjectName },
    { label: "Assessor", value: assessorName },
    { label: "Assessor authority", value: snap?.positionCode ? `${humanize(String(snap.positionCode))}, holding ${snap.capability ?? "the assess capability"}` : null },
    { label: "Authority recorded", value: day(snap?.capturedAt) },
    { label: "Checklist", value: ins.data ? `${ins.data.code}, ${ins.data.name}` : null },
    { label: "Version", value: `${version.version_no}${version.content_hash ? ` (content ${version.content_hash.slice(0, 8)})` : ""}` },
    { label: "Methods", value: version.method_codes.length ? version.method_codes.map(humanize).join(", ") : null },
    { label: "Started", value: day(loaded.instance.started_at) },
    { label: "Submitted", value: day(loaded.instance.submitted_at) },
    { label: "Engine", value: `${loaded.outcome.engine_version}${loaded.outcome.backstop_applied ? ", database safeguard applied" : ""}` },
  ];
  return okRes({
    loaded, subjectName, assessorName, evaluation: ev, metadata, strengths, gaps,
    safetyConcerns: byKind("safety_concern"), recommendations: byKind("recommendation"), generalComments: loaded.comments.filter(c => !c.item_key && c.kind === "comment"),
    itemComments, evidenceRefs: evidenceRefsOf(loaded.evidence, codeOf),
  });
}
