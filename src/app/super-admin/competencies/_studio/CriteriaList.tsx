// CFCA-STUDIO-P1 (migration 670): a competency's assessment criteria, grouped by component (Clinical Skills,
// Knowledge, Knowledge Application, ...) in the source order, each in its own words. Shown on Competency Authoring
// and to the clinical reviewer. Criteria with no component (skills made before 670) are listed as "Not classified".

export type Criterion = { component: string | null; text: string; sourceRef?: string | null };

export function CriteriaList({ criteria, components, open = false }: { criteria: Criterion[]; components: Record<string, string>; open?: boolean }) {
  if (!criteria.length) return null;
  const order = [...Object.keys(components), ...new Set(criteria.map(c => c.component ?? "").filter(c => c && !(c in components)))];
  const groups = [...order, ""].map(code => ({ code, items: criteria.filter(c => (c.component ?? "") === code) })).filter(g => g.items.length);
  return (
    <details className="mt-1" open={open}>
      <summary className="cursor-pointer text-[12.5px] text-gray-700">Assessment criteria ({criteria.length})</summary>
      <div className="mt-2 space-y-2">
        {groups.map(g => (
          <section key={g.code || "none"} aria-label={g.code ? components[g.code] ?? g.code : "Not classified"}>
            <h4 className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{g.code ? components[g.code] ?? g.code : "Not classified"} ({g.items.length})</h4>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] text-gray-800">
              {g.items.map((c, i) => <li key={i} title={c.sourceRef ?? undefined}>{c.text}</li>)}
            </ol>
          </section>
        ))}
      </div>
    </details>
  );
}
