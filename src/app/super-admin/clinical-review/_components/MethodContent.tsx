/* eslint-disable @typescript-eslint/no-explicit-any */
import { EVIDENCE_KIND_LABEL, METHOD_KIND_LABEL, OUTCOME_CLASS_LABEL } from "@/lib/competency/verification-config";

// The exact content of an assessment method version, for its independent clinical reviewer (migration 690). The
// reviewer approves the criteria, the checklist, the components with their pass levels and weights, the outcomes, the
// evidence required, the validity and the decision guidance, for this exact version. A criterion pinned to a competency
// criterion says so. Missing parts are said to be missing, never left blank.

const none = <span className="italic text-[var(--cmp-text-muted,#6b7280)]">None recorded</span>;
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const H = ({ children }: { children: React.ReactNode }) => <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{children}</h3>;

/** `m` is the queue item's methodContent: `{ method, version_no, content, applies }`. */
export function MethodContent({ m, components, levels, scales }: { m: any; components: Record<string, string>; levels: Record<string, string>; scales: Record<string, string> }) {
  const c = m?.content ?? {};
  const criteria: any[] = Array.isArray(c.criteria) ? c.criteria : [];
  const checklist: any[] = Array.isArray(c.checklist) ? c.checklist : [];
  const comps: any[] = Array.isArray(c.components) ? c.components : [];
  const outcomes: any[] = Array.isArray(c.outcomes) ? c.outcomes : [];
  const evidence: any[] = Array.isArray(c.requiredEvidence) ? c.requiredEvidence : [];
  const levelIds: string[] = Array.isArray(c.levelIds) ? c.levelIds : [];
  const frameworks: string[] = Array.isArray(m?.applies?.frameworks) ? m.applies.frameworks : [];
  const competencies: { name: string; framework: string }[] = Array.isArray(m?.applies?.competencies) ? m.applies.competencies : [];
  const label = (code: string | null | undefined) => (code ? components[code] ?? code : "Not tied to a component");
  // Criteria and checklist items grouped by component, in the order the method lists them.
  const groups = new Map<string, { criteria: any[]; checklist: any[] }>();
  const slot = (k: string | null | undefined) => { const key = k ?? ""; if (!groups.has(key)) groups.set(key, { criteria: [], checklist: [] }); return groups.get(key)!; };
  for (const k of criteria) slot(k?.component).criteria.push(k);
  for (const k of checklist) slot(k?.component).checklist.push(k);
  const source = (k: any) => (
    <>
      {k.sourceRef ? <span className="text-[12px] text-gray-500"> · source {k.sourceRef}</span> : null}
      {k.criterionId ? <span className="ml-1 rounded-full border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-900">from the competency criteria</span> : null}
    </>
  );
  return (
    <div className="space-y-4 text-[13.5px]">
      <section>
        <H>Summary</H>
        <p className="text-gray-800">{txt(c.summary) ?? none}</p>
        <p className="text-gray-700">{m?.method?.kind ? `${METHOD_KIND_LABEL[m.method.kind as keyof typeof METHOD_KIND_LABEL] ?? m.method.kind} · ` : ""}Method {txt(m?.method?.code) ?? "code not recorded"}, version {m?.version_no ?? "not recorded"}</p>
      </section>
      <section>
        <H>Applies to</H>
        {frameworks.length || competencies.length ? (
          <ul className="list-disc pl-5">
            {frameworks.map((f, i) => <li key={`f${i}`}>Every competency in the framework {f}</li>)}
            {competencies.map((k, i) => <li key={`c${i}`}>{k.name} <span className="text-gray-500">({k.framework})</span></li>)}
          </ul>
        ) : none}
      </section>
      <section>
        <H>Criteria and checklist, by component ({criteria.length} criteria, {checklist.length} checklist items)</H>
        {groups.size ? [...groups].map(([key, g]) => (
          <div key={key || "none"} className="mt-2 rounded-lg border border-gray-200 p-3">
            <h4 className="font-semibold text-gray-900">{label(key || null)}</h4>
            {g.criteria.length > 0 && (
              <ul className="mt-1 space-y-1">{g.criteria.map(k => (
                <li key={k.id} className="text-gray-800">{k.text}{source(k)}
                  <span className={`ml-1 text-[12px] font-semibold ${k.required === false ? "text-gray-500" : "text-gray-900"}`}>{k.required === false ? "Not required" : "Required"}</span></li>))}</ul>
            )}
            {g.checklist.length > 0 && (
              <>
                <p className="mt-2 text-[12px] font-semibold text-gray-500">Checklist</p>
                <ul className="space-y-1">{g.checklist.map(k => (
                  <li key={k.id} className="text-gray-800">{k.text}{source(k)}
                    {k.critical ? <span className="ml-1 text-[12px] font-semibold text-[var(--cmp-text-critical,#991b1b)]">Critical</span> : null}</li>))}</ul>
              </>
            )}
          </div>
        )) : none}
      </section>
      <section>
        <H>Components ({comps.length})</H>
        {comps.length ? (
          <div className="overflow-x-auto">
            <table className="mt-1 w-full text-left text-[13px]">
              <thead><tr className="text-[12px] text-gray-500"><th className="py-1 pr-2">Component</th><th className="pr-2">Pass level</th><th className="pr-2">Mandatory</th><th className="pr-2">Safety-critical</th><th>Weight</th></tr></thead>
              <tbody>{comps.map(k => (
                <tr key={k.code} className="border-t border-gray-100">
                  <td className="py-1 pr-2">{label(k.code)}</td>
                  <td className="pr-2">{k.passLevelId ? levels[k.passLevelId] ?? "A level that is no longer listed" : "Not set"}</td>
                  <td className="pr-2">{k.mandatory ? "Yes" : "No"}</td>
                  <td className="pr-2">{k.safetyCritical ? <span className="font-semibold text-[var(--cmp-text-critical,#991b1b)]">Yes</span> : "No"}</td>
                  <td>{k.weight ?? "Not set"}</td>
                </tr>))}</tbody>
            </table>
          </div>
        ) : <p className="text-gray-700">No components: the method decides as a whole, with no component results.</p>}
      </section>
      <section>
        <H>Scale and levels</H>
        <p className="text-gray-800">{c.scaleId ? scales[c.scaleId] ?? "A scale that is no longer listed" : "No scale set"}{levelIds.length ? ` · ${levelIds.map(l => levels[l] ?? "a level").join(", ")}` : ""}</p>
      </section>
      <section>
        <H>Outcomes</H>
        {outcomes.length ? <ul className="list-disc pl-5">{outcomes.map(o => (
          <li key={o.code}>{o.label} <span className="text-[12px] text-gray-500">({OUTCOME_CLASS_LABEL[o.class as keyof typeof OUTCOME_CLASS_LABEL] ?? o.class})</span>{txt(o.description) ? <span className="text-gray-700"> -- {o.description}</span> : null}</li>))}</ul> : none}
      </section>
      <section>
        <H>Evidence required</H>
        <p className="text-gray-800">At least {c.minEvidence ?? 0} evidence item{c.minEvidence === 1 ? "" : "s"} in all.</p>
        {evidence.length ? <ul className="list-disc pl-5">{evidence.map((e, i) => (
          <li key={i}>{e.kind === "any" ? "Any kind" : EVIDENCE_KIND_LABEL[e.kind as keyof typeof EVIDENCE_KIND_LABEL] ?? e.kind}: at least {e.min}{txt(e.description) ? ` -- ${e.description}` : ""}</li>))}</ul> : null}
      </section>
      <section>
        <H>Validity, workflow and second assessor</H>
        <ul className="list-disc pl-5">
          <li>{c.validity?.months ? `Valid for ${c.validity.months} months, renewed by ${c.validity.renewal === "evidence_review" ? "evidence review" : c.validity.renewal === "reassessment" ? "reassessment" : "a renewal route that is not set"}` : "No expiry set"}</li>
          {c.reassessment?.waitDays ? <li>Wait {c.reassessment.waitDays} days before reassessment</li> : null}
          <li>Assignment: {c.workflow?.assignment === "self_claim" ? "an assessor claims the request" : "an administrator assigns the assessor"}{c.workflow?.allowFurtherEvidence ? " · further evidence may be asked for" : " · further evidence may not be asked for"}</li>
          <li>{c.workflow?.secondAssessor ? <span className="font-semibold">A second appointed assessor must confirm a verified or partial outcome</span> : "No second assessor"}</li>
        </ul>
      </section>
      <section>
        <H>Decision guidance</H>
        <p className="whitespace-pre-line text-gray-800">{txt(c.decisionGuidance) ?? none}</p>
      </section>
    </div>
  );
}
