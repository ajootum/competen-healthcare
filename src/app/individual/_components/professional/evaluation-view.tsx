import Link from "next/link";
import { focusRing } from "../chrome";
import { ApiForm, Field, inputCls } from "./forms";
import { fmtDate } from "./bits";
import {
  CONFIDENCE_LABEL, DIMENSIONS, PROVENANCE, PROVENANCE_LABEL, SOURCE_KIND_LABEL, type Dimension, type Provenance,
} from "@/lib/individual/professional/evaluation-vocabulary";
import { FINDING_STATE_LABEL, type Comparison, type Finding, type Point, type Recommendation, type SourceRef } from "@/lib/individual/professional/evaluation";
import type { DecisionRow } from "@/lib/individual/professional/evaluation-store";

// ── MY PROFESSIONAL EVALUATION: SERVER-RENDERED PIECES ── COMPETEN-PROFESSIONAL-EVALUATION-01 ─────────────────────────────
//
// The six dimensions side by side and NEVER summed: each card says its state in words, what supports it (with every
// source one click away), its provenance mix, dates, framework versions, method and limitations. Provenance is always
// text, never colour alone. Missing evidence reads "Nothing recorded yet", never zero.

const STATE_STYLE: Record<Finding["state"], string> = {
  supported: "border-indigo-300 bg-indigo-50 text-indigo-900",
  limited: "border-amber-300 bg-amber-50 text-amber-900",
  not_recorded: "border-gray-300 bg-gray-50 text-gray-700",
  not_available: "border-gray-300 bg-white text-gray-600",
};
const PROV_STYLE: Record<Provenance, string> = {
  self_reported: "border-amber-300 bg-amber-50 text-amber-900",
  document_supported: "border-sky-300 bg-sky-50 text-sky-900",
  platform_recorded: "border-sky-300 bg-white text-sky-900",
  formative: "border-violet-300 bg-violet-50 text-violet-900",
  independent_decision: "border-green-400 bg-green-50 text-green-900",
  independent_other: "border-gray-400 bg-white text-gray-800",
};

export function ProvenanceLabel({ value }: { value: Provenance }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${PROV_STYLE[value]}`}>{PROVENANCE_LABEL[value]}</span>;
}

function SourceLine({ s }: { s: SourceRef }) {
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-gray-500">{SOURCE_KIND_LABEL[s.kind] ?? s.kind}</span>
        {s.href ? <Link href={s.href} className={`text-[13.5px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{s.title}</Link>
          : <span className="text-[13.5px] font-semibold text-gray-900">{s.title}</span>}
        <ProvenanceLabel value={s.provenance} />
      </div>
      <p className="mt-0.5 text-[12.5px] text-gray-600">
        {[s.date ? fmtDate(s.date) : "Undated", s.classText, s.method ? `Method: ${s.method}` : null, s.competency ? `Competency: ${s.competency}` : null,
          s.outcome ? `Outcome: ${s.outcome}` : null, s.frameworkVersion ? `Framework ${s.frameworkVersion}` : null, s.via].filter(Boolean).join(" · ")}
      </p>
    </li>
  );
}

export function SourceList({ sources, empty = "No records." }: { sources: readonly SourceRef[]; empty?: string }) {
  if (!sources.length) return <p className="text-[13px] text-gray-600">{empty}</p>;
  return <ul className="divide-y divide-gray-100">{sources.map(s => <SourceLine key={s.key} s={s} />)}</ul>;
}

function DimensionCard({ f, label, sources }: { f: Finding; label: string; sources: readonly SourceRef[] }) {
  const mine = sources.filter(s => f.sourceKeys.includes(s.key));
  return (
    <article className="flex flex-col rounded-xl border border-gray-200 p-4" aria-labelledby={`dim-${f.dimension}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`dim-${f.dimension}`} className="text-[14px] font-bold text-gray-900">{label}</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATE_STYLE[f.state]}`}>
          {f.dimension === "evidence_confidence" && f.confidence ? `${CONFIDENCE_LABEL[f.confidence]} confidence` : FINDING_STATE_LABEL[f.state]}
        </span>
      </div>
      <p className="mt-2 text-[13.5px] text-gray-800">{f.summary}</p>
      {Object.keys(f.provenance).length > 0 && f.dimension !== "evidence_confidence" && (
        <p className="mt-2 text-[12px] text-gray-600">{PROVENANCE.filter(p => f.provenance[p]).map(p => `${PROVENANCE_LABEL[p]}: ${f.provenance[p]}`).join(" · ")}</p>
      )}
      {(f.first || f.frameworkVersions.length > 0 || f.methods.length > 0 || f.verification) && (
        <p className="mt-1 text-[12px] text-gray-600">
          {[f.first ? `${fmtDate(f.first)}${f.last && f.last !== f.first ? ` to ${fmtDate(f.last)}` : ""}` : null,
            f.frameworkVersions.length ? `Framework ${f.frameworkVersions.join(", ")}` : null,
            f.methods.length ? `Methods: ${f.methods.slice(0, 4).join(", ")}` : null, f.verification ? `Verification: ${f.verification}` : null].filter(Boolean).join(" · ")}
        </p>
      )}
      {f.reasons && f.reasons.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{f.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
      {f.limitations.length > 0 && f.dimension !== "evidence_confidence" && (
        <ul className="mt-2 space-y-0.5 text-[12.5px] text-amber-900">{f.limitations.map(l => <li key={l}>Limitation: {l}</li>)}</ul>
      )}
      {mine.length > 0 && f.dimension !== "evidence_confidence" && (
        <details className="mt-3">
          <summary className={`cursor-pointer text-[13px] font-semibold text-indigo-800 ${focusRing}`}>Show the evidence ({mine.length})</summary>
          <SourceList sources={mine} />
        </details>
      )}
    </article>
  );
}

export function DimensionGrid({ findings, sources }: { findings: Record<Dimension, Finding>; sources: readonly SourceRef[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {DIMENSIONS.map(([d, label]) => findings[d] ? <DimensionCard key={d} f={findings[d]} label={label} sources={sources} /> : null)}
    </div>
  );
}

export function PointsView({ strengths, development, limitations }: { strengths: readonly Point[]; development: readonly Point[]; limitations: readonly string[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <h3 className="text-[13.5px] font-bold text-gray-900">Demonstrated strengths</h3>
        <p className="text-[12px] text-gray-500">From document-supported, formative or independently verified records only.</p>
        {strengths.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-gray-800">{strengths.map(p => <li key={p.text}>{p.text}</li>)}</ul>
          : <p className="mt-1 text-[13px] text-gray-600">None of the records in scope is document-supported, formative or verified yet. That says nothing about your competence.</p>}
      </div>
      <div>
        <h3 className="text-[13.5px] font-bold text-gray-900">Areas you are developing</h3>
        <p className="text-[12px] text-gray-500">In your own words: your needs, interests and open goals.</p>
        {development.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-gray-800">{development.map(p => <li key={p.text}>{p.text}</li>)}</ul>
          : <p className="mt-1 text-[13px] text-gray-600">You have not named an open need, interest or goal for this.</p>}
      </div>
      <div>
        <h3 className="text-[13.5px] font-bold text-gray-900">Evidence limitations</h3>
        <p className="text-[12px] text-gray-500">What the records cannot show.</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-amber-900">{limitations.map(l => <li key={l}>{l}</li>)}</ul>
      </div>
    </div>
  );
}

const DECISION_TEXT: Record<string, string> = { accepted: "Accepted", deferred: "Deferred", dismissed: "Dismissed" };

/** Recommendations. Live: follow links only. On a recorded snapshot: accept (optionally edited), defer or dismiss. */
export function RecommendationList({ recs, evaluationId, decisions, accent, createdHref }: {
  recs: readonly Recommendation[]; evaluationId: string | null; decisions?: ReadonlyMap<string, DecisionRow>; accent: string;
  createdHref?: (kind: string, id: string) => string;
}) {
  if (!recs.length) return <p className="text-[13.5px] text-gray-600">No next steps are suggested by the current rules. You can still plan, record or reflect whenever you like.</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {recs.map(r => {
        const d = decisions?.get(r.key);
        return (
          <li key={r.key} className="py-3">
            <p className="text-[14px] font-semibold text-gray-900">{d?.edited_title ?? r.title}</p>
            <p className="mt-0.5 text-[12.5px] text-gray-600">Why: {r.basis}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px]">
              {r.href && <Link href={r.href} className={`inline-flex min-h-[36px] items-center font-semibold ${focusRing}`} style={{ color: accent }}>{r.hrefLabel ?? "Open"} →</Link>}
              {d && (
                <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[12px] font-semibold text-gray-700">
                  {DECISION_TEXT[d.decision]} {fmtDate(d.decided_at)}{d.deferred_until ? `, until ${fmtDate(d.deferred_until)}` : ""}
                </span>
              )}
              {d?.created_kind && d.created_id && createdHref && (
                <Link href={createdHref(d.created_kind, d.created_id)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Open the {d.created_kind} you added</Link>
              )}
            </div>
            {evaluationId && (!d || d.decision !== "accepted") && (
              <details className="mt-2">
                <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 ${focusRing}`}>Accept, edit, defer or dismiss</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  <ApiForm action="/api/individual/professional/evaluation-decisions" submitLabel={r.creates ? `Accept: add ${r.creates.kind}` : "Accept"} accent={accent} reset={false}
                    savedText={r.creates ? `Added to your ${r.creates.kind === "need" ? "needs" : "plan"}. You can edit it there.` : "Accepted."}>
                    <input type="hidden" name="evaluationId" value={evaluationId} />
                    <input type="hidden" name="key" value={r.key} />
                    <input type="hidden" name="decision" value="accepted" />
                    {r.creates && (
                      <Field label={`Edit the ${r.creates.kind} title (optional)`} htmlFor={`edit-${r.key}`}>
                        <input id={`edit-${r.key}`} name="editedTitle" defaultValue={r.creates.title} minLength={3} maxLength={200} className={inputCls} />
                      </Field>
                    )}
                  </ApiForm>
                  <ApiForm action="/api/individual/professional/evaluation-decisions" submitLabel="Defer" accent={accent} reset={false} savedText="Deferred.">
                    <input type="hidden" name="evaluationId" value={evaluationId} />
                    <input type="hidden" name="key" value={r.key} />
                    <input type="hidden" name="decision" value="deferred" />
                    <Field label="Until (optional)" htmlFor={`defer-${r.key}`}><input id={`defer-${r.key}`} name="deferredUntil" type="date" className={inputCls} /></Field>
                  </ApiForm>
                  <ApiForm action="/api/individual/professional/evaluation-decisions" submitLabel="Dismiss" accent={accent} reset={false} savedText="Dismissed.">
                    <input type="hidden" name="evaluationId" value={evaluationId} />
                    <input type="hidden" name="key" value={r.key} />
                    <input type="hidden" name="decision" value="dismissed" />
                  </ApiForm>
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const STATE_SHORT = FINDING_STATE_LABEL;

export function ComparisonView({ cmp }: { cmp: Comparison }) {
  return (
    <div>
      {!cmp.sameScope && <p className="mb-2 text-[13px] font-semibold text-amber-900">These two evaluations are of different things, so the comparison shows records, not progress.</p>}
      <table className="w-full text-left text-[13.5px]">
        <caption className="sr-only">Each dimension in the earlier and the later evaluation</caption>
        <thead><tr className="border-b border-gray-200 text-[12px] uppercase tracking-[0.1em] text-gray-500">
          <th scope="col" className="py-2 font-bold">Dimension</th><th scope="col" className="py-2 font-bold">{fmtDate(cmp.earlier.at)}</th><th scope="col" className="py-2 font-bold">{fmtDate(cmp.later.at)}</th>
        </tr></thead>
        <tbody>
          {cmp.dimensions.map(d => (
            <tr key={d.dimension} className="border-b border-gray-100">
              <th scope="row" className="py-2 font-semibold text-gray-900">{DIMENSIONS.find(([k]) => k === d.dimension)?.[1]}</th>
              <td className="py-2">{d.dimension === "evidence_confidence" && cmp.confidence.before ? `${CONFIDENCE_LABEL[cmp.confidence.before]} confidence` : STATE_SHORT[d.before]} · {d.beforeCount} records</td>
              <td className={`py-2 ${d.changed ? "font-semibold" : ""}`}>{d.dimension === "evidence_confidence" && cmp.confidence.after ? `${CONFIDENCE_LABEL[cmp.confidence.after]} confidence` : STATE_SHORT[d.after]} · {d.afterCount} records{d.changed ? " (changed)" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div><h3 className="text-[13.5px] font-bold text-gray-900">Records in the later evaluation only ({cmp.added.length})</h3><SourceList sources={cmp.added} empty="None." /></div>
        <div><h3 className="text-[13.5px] font-bold text-gray-900">Records in the earlier evaluation only ({cmp.removed.length})</h3><SourceList sources={cmp.removed} empty="None." /></div>
      </div>
      <p className="mt-3 text-[12.5px] text-gray-500">A comparison shows what changed in your records and findings. It is not a score, and it does not say you are better or worse.</p>
    </div>
  );
}
