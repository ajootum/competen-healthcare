import { mapModel, type MapSource, type StudioArea } from "@/lib/competency/studio-areas";

// FRAMEWORK-DESIGN-STUDIO-02 S4: the visual framework map. Areas are columns (they stack on a narrow screen: the grid
// wraps by available width, no breakpoint), each holding domain cards, each holding competency chips with the code, the
// name, the criteria count and the review status. Read-only and pure CSS: no library. Real lists (list semantics), every
// chip a button (keyboard focus, Enter / Space to select). The statuses are the ones the server already worked out.

export function FrameworkMap({ domains, areas, activeId, onSelect, status }: {
  domains: MapSource[]; areas?: StudioArea[]; activeId: string | null; onSelect: (competencyId: string) => void;
  status: Record<string, { label: string; dot: string }>;
}) {
  const columns = mapModel(domains, areas);
  const total = domains.reduce((s, d) => s + d.competencies.length, 0);
  return (
    <section aria-label="Framework map" className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-[12.5px] text-gray-600">{areas?.length ? `${areas.length} ${areas.length === 1 ? "Area" : "Areas"}, ` : ""}{domains.length} {domains.length === 1 ? "domain" : "domains"}, {total} {total === 1 ? "competency" : "competencies"}. Choose a competency to open it in the editor.</p>
      {!domains.length ? <p className="mt-3 text-[13.5px] text-gray-600">This framework has no domain yet.</p> : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] items-start gap-4">
          {columns.map(col => (
            <li key={col.key} className="min-w-0">
              <section aria-labelledby={`map-a-${col.key}`} className={`rounded-xl border p-3 ${col.unassigned ? "border-dashed border-gray-300 bg-gray-50" : "border-gray-200 bg-gray-50/60"}`}>
                <h3 id={`map-a-${col.key}`} className="break-words text-[12.5px] font-bold uppercase tracking-[0.1em] text-gray-800">{col.title} <span className="font-normal normal-case tracking-normal text-gray-500">· {col.domains.length} {col.domains.length === 1 ? "domain" : "domains"}</span></h3>
                {!col.domains.length ? <p className="mt-2 text-[12.5px] text-gray-600">No domain in this Area yet.</p> : (
                  <ul className="mt-2 space-y-3">
                    {col.domains.map(d => (
                      <li key={d.id} className="min-w-0">
                        <section aria-labelledby={`map-d-${d.id}`} className="rounded-lg border border-gray-200 bg-white p-2.5">
                          <h4 id={`map-d-${d.id}`} className="break-words text-[13.5px] font-semibold text-gray-900">{d.name} <span className="text-[12px] font-normal text-gray-500">· {d.chips.length}</span></h4>
                          {!d.chips.length ? <p className="mt-1 text-[12.5px] text-gray-600">No competency.</p> : (
                            <ul className="mt-2 space-y-1.5">
                              {d.chips.map(c => (
                                <li key={c.id}>
                                  <button type="button" onClick={() => onSelect(c.id)} aria-current={c.id === activeId ? "true" : undefined}
                                    className={`flex w-full min-w-0 items-start gap-2 rounded-lg border px-2 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)] ${c.id === activeId ? "border-teal-700 bg-teal-50" : "border-gray-200 hover:bg-gray-50"}`}>
                                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${status[c.status]?.dot ?? "bg-gray-400"}`} />
                                    <span className="min-w-0 flex-1">
                                      <span className="block break-words text-[13px] text-gray-900">{c.name}</span>
                                      <span className="block break-words font-mono text-[11.5px] text-gray-600">{c.code ?? "no code"} · {c.criteria} {c.criteria === 1 ? "criterion" : "criteria"} · {status[c.status]?.label ?? c.status}</span>
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
