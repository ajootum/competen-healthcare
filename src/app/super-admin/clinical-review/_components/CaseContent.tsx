/* eslint-disable @typescript-eslint/no-explicit-any */

// The exact content of a clinical case version, for its independent clinical reviewer (migration 422). Everything a
// learner would never see before answering is shown here -- the key, the rationales, the consequences, the safety
// criteria -- because the reviewer approves all of it. Missing parts are said to be missing, never left blank.

const none = <span className="italic text-[var(--cmp-text-muted,#6b7280)]">None recorded</span>;
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function CaseContent({ c }: { c: any }) {
  const facts: any[] = Array.isArray(c?.facts) ? c.facts : [];
  const stages: any[] = Array.isArray(c?.stages) ? c.stages : [];
  const dps: any[] = Array.isArray(c?.decisionPoints) ? c.decisionPoints : [];
  const prog: any[] = Array.isArray(c?.progression) ? c.progression : [];
  const safety: any[] = Array.isArray(c?.safetyCriteria) ? c.safetyCriteria : [];
  const label = (id: string) => facts.find(f => f?.id === id)?.label ?? id;
  const title = (id: string) => stages.find(s => s?.id === id)?.title ?? id;
  return (
    <div className="space-y-4 text-[13.5px]">
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Patient and opening</h3>
        <p className="text-gray-800">{c?.patient ? `${c.patient.ageBand || "Age band not set"} · ${c.patient.setting || "Setting not set"} · ${c.patient.presentingComplaint || "No presenting complaint"}` : none}</p>
        <p className="text-gray-700">Learner opening: {txt(c?.learnerIntro) ?? none}</p>
      </section>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Findings ({facts.length})</h3>
        {facts.length ? (
          <table className="mt-1 w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500"><th className="py-1 pr-2">Finding</th><th className="pr-2">Value</th><th className="pr-2">Revealed</th><th>Safety-critical</th></tr></thead>
            <tbody>{facts.map(f => (
              <tr key={f.id} className="border-t border-gray-100"><td className="py-1 pr-2">{f.label}</td><td className="pr-2 font-medium">{f.value}{f.unit ? ` ${f.unit}` : ""}</td>
                <td className="pr-2">{f.revealedAt === "start" ? "At the start" : f.revealedAt === "request" ? "Only when asked for" : `On reaching ${title(f.revealedAt)}`}</td>
                <td>{f.safetyCritical ? <span className="font-semibold text-[var(--cmp-text-critical,#991b1b)]">Yes</span> : "No"}</td></tr>))}</tbody>
          </table>
        ) : none}
      </section>
      {stages.map(s => (
        <section key={s.id} className="rounded-lg border border-gray-200 p-3">
          <h3 className="font-semibold text-gray-900">{s.title}</h3>
          {dps.filter(d => d?.stageId === s.id).map(d => (
            <div key={d.id} className="mt-2">
              <p className="text-gray-900">{d.prompt || none} <span className="text-[12px] text-gray-500">({d.kind}{d.dimension ? `, ${d.dimension}` : ""})</span></p>
              {d.kind === "free_text" ? <p className="mt-1 text-gray-700">Expected: {txt(d.expectedResponse) ?? none}</p> : (
                <ul className="mt-1 space-y-1">{(d.options ?? []).map((o: any) => (
                  <li key={o.id} className={o.correct ? "font-medium text-[var(--cmp-text-success,#166534)]" : "text-gray-800"}>
                    {o.correct ? "Key: " : "Not the key: "}{o.text} <span className="font-normal text-gray-600">-- {txt(o.rationale) ?? txt(d.rationale) ?? "no rationale"}</span>
                  </li>))}</ul>
              )}
              {d.permittedReveals?.length ? <p className="mt-1 text-[12.5px] text-gray-600">May ask for: {d.permittedReveals.map(label).join(", ")}</p> : null}
            </div>
          ))}
        </section>
      ))}
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Progression</h3>
        {prog.length ? <ul className="list-disc pl-5">{prog.map((t, i) => (
          <li key={i}>From {title(t.from)}, {t.isDefault ? "otherwise" : `on ${(t.onOptions ?? []).join(" or ")}`}, to {title(t.to)}{t.consequenceFactIds?.length ? `, revealing ${t.consequenceFactIds.map(label).join(", ")}` : ""}</li>))}</ul>
          : <p className="text-gray-700">The stages run in order.</p>}
      </section>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Safety criteria</h3>
        {safety.length ? <ul className="list-disc pl-5">{safety.map(x => <li key={x.id}>{x.text}{x.mustSelect?.length ? ` (must choose ${x.mustSelect.join(", ")})` : ""}{x.mustNotSelect?.length ? ` (must not choose ${x.mustNotSelect.join(", ")})` : ""}</li>)}</ul> : none}
      </section>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Debrief and references</h3>
        <p className="text-gray-800">{txt(c?.feedback?.debrief) ?? none}</p>
        {Array.isArray(c?.references) && c.references.length ? <ul className="list-disc pl-5">{c.references.map((r: any, i: number) => <li key={i}>{r.citation}</li>)}</ul> : <p>{none}</p>}
      </section>
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Variation boundaries</h3>
        {c?.variation?.rules?.length ? <ul className="list-disc pl-5">{c.variation.rules.map((r: any, i: number) => <li key={i}>{label(r.factId)}: {r.values?.length ? r.values.join(", ") : `${r.range?.min} to ${r.range?.max}`}</li>)}</ul> : <p className="text-gray-700">No variation: delivered exactly as written.</p>}
      </section>
    </div>
  );
}
