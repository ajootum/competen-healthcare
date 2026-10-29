"use client";

import { useMemo, useState } from "react";
import { CompetencyEditor, SubmitReview } from "./AuthoringControls";
import { ReviewButton } from "./ReviewDialog";

// CFCA-STUDIO-UX-02, the Competencies tab of one framework: a compact searchable explorer (domains, competencies,
// selection) beside ONE active competency. Its fields are edited with the existing CompetencyEditor (the same governed
// update, authorship recorded first). Its criteria are shown one component at a time, in their source words and order.
// Statuses are worked out on the server (the existing 395 rule) and passed in, never inferred here.

export type StudioStatus = "eligible" | "in_review" | "approved" | "changes_requested" | "framework_locked" | "unreadable";
export type StudioCompetency = {
  id: string; code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null;
  riskCategory: string; sortOrder: number; cpuId: string | null; status: StudioStatus; statusText: string;
  criteria: { component: string | null; text: string; sourceRef: string | null }[];
};
export type StudioDomain = { id: string; name: string; competencies: StudioCompetency[]; cpus: { id: string; label: string }[] };

const DOT: Record<StudioStatus, string> = {
  eligible: "bg-teal-600", in_review: "bg-blue-600", approved: "bg-violet-600", changes_requested: "bg-amber-500", framework_locked: "bg-gray-400", unreadable: "bg-red-500",
};
const CHIP: Record<StudioStatus, [string, string]> = {
  eligible: ["Ready for review", "bg-teal-50 text-teal-900"], in_review: ["In review", "bg-blue-50 text-blue-900"], approved: ["Reviewed", "bg-violet-50 text-violet-900"],
  changes_requested: ["Needs attention", "bg-amber-50 text-amber-900"], framework_locked: ["Locked", "bg-gray-100 text-gray-800"], unreadable: ["State unreadable", "bg-red-50 text-red-900"],
};
const link = "text-[13px] font-semibold text-teal-800 hover:underline disabled:opacity-50";

export default function StudioWorkspace({ frameworkId, domains, levels, components, editable, initialId }: {
  frameworkId: string; domains: StudioDomain[]; levels: { id: string; score: number; label: string }[];
  components: Record<string, string>; editable: boolean; initialId: string | null;
}) {
  const all = useMemo(() => domains.flatMap(d => d.competencies.map(c => ({ c, d }))), [domains]);
  const [active, setActive] = useState<string | null>(initialId && all.some(x => x.c.id === initialId) ? initialId : all[0]?.c.id ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(all.find(x => x.c.id === (initialId ?? all[0]?.c.id))?.d.id ? [all.find(x => x.c.id === (initialId ?? all[0]?.c.id))!.d.id] : []));
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const query = q.trim().toLowerCase();
  const match = (c: StudioCompetency) => !query || c.name.toLowerCase().includes(query) || (c.code ?? "").toLowerCase().includes(query);
  const cur = all.find(x => x.c.id === active) ?? null;

  function choose(id: string) {
    setActive(id);
    const u = new URL(window.location.href); u.searchParams.set("c", id); window.history.replaceState(null, "", u.toString());
  }
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
      <aside aria-label="Competency explorer" className="flex max-h-[calc(100vh-12rem)] flex-col rounded-2xl border border-gray-200 bg-white md:sticky md:top-4">
        <div className="border-b border-gray-100 p-4">
          <div className="flex items-baseline justify-between"><h2 className="text-[15px] font-bold text-gray-900">Competency explorer</h2><span className="text-[12px] text-gray-500">{domains.length} domains</span></div>
          <label className="sr-only" htmlFor="cx-q">Find a competency or code</label>
          <input id="cx-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a competency or code…" className="mt-3 block w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)]" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {domains.map(d => {
            const comps = d.competencies.filter(match);
            if (query && !comps.length) return null;
            const isOpen = query ? true : open.has(d.id);
            return (
              <div key={d.id}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(s => toggle(s, d.id))}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13.5px] font-semibold text-gray-900 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                  <span><span aria-hidden className="mr-1.5 inline-block w-3 text-gray-500">{isOpen ? "▾" : "▸"}</span>{d.name}</span>
                  <span className="text-[12px] font-normal text-gray-500">{d.competencies.length}</span>
                </button>
                {isOpen && comps.map(c => (
                  <div key={c.id} className={`mx-2 mb-1 flex items-start gap-2 rounded-lg px-2 py-2 ${c.id === active ? "border-l-4 border-teal-700 bg-teal-50/70" : "hover:bg-gray-50"}`}>
                    <input type="checkbox" aria-label={`Select ${c.name}`} className="mt-1" checked={picked.has(c.id)} onChange={() => setPicked(s => toggle(s, c.id))} />
                    <button type="button" onClick={() => choose(c.id)} aria-current={c.id === active ? "true" : undefined} className="min-w-0 flex-1 text-left">
                      <span className="block text-[13.5px] text-gray-900">{c.name}</span>
                      <span className="block font-mono text-[11.5px] text-gray-500">{c.code ?? "no code"} · {c.criteria.length} criteria</span>
                    </button>
                    <span title={CHIP[c.status][0]} aria-label={CHIP[c.status][0]} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="border-t border-gray-100 p-4">
          <p className="flex flex-wrap gap-3 text-[11.5px] text-gray-600">
            {(["eligible", "in_review", "approved", "changes_requested"] as StudioStatus[]).map(s => <span key={s} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${DOT[s]}`} />{CHIP[s][0]}</span>)}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12.5px] text-gray-700">{picked.size} selected</span>
            <ReviewButton frameworkId={frameworkId} scope={{ kind: "competencies", ids: [...picked] }} label="Review selected →" className={link} disabled={!picked.size || !editable} />
          </div>
        </div>
      </aside>

      <section aria-label="Competency" className="min-w-0 rounded-2xl border border-gray-200 bg-white">
        {!cur ? <p className="p-6 text-[13.5px] text-gray-600">This framework has no competency yet. Add one from Overview &amp; governance.</p> : (
          <>
            <div className="border-b border-gray-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">{cur.d.name} / <span className="font-mono">{cur.c.code ?? "no code"}</span></p>
                <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${CHIP[cur.c.status][1]}`}>{CHIP[cur.c.status][0]}</span>
              </div>
              <h2 className="mt-1 text-[20px] font-bold text-gray-900">{cur.c.name}</h2>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-gray-600">{cur.c.statusText} · {cur.c.criteria.length} source criteria</p>
                <ReviewButton frameworkId={frameworkId} scope={{ kind: "domain", domainId: cur.d.id }} label="Review this domain →" className={link} disabled={!editable} />
              </div>
            </div>
            <div className="space-y-5 p-5">
              <Criteria key={cur.c.id} criteria={cur.c.criteria} components={components} />
              {editable ? (
                <details className="rounded-xl border border-gray-200 p-4" open={false}>
                  <summary className="cursor-pointer text-[14px] font-semibold text-gray-900">Edit name, description, outcomes, level and risk</summary>
                  <p className="mt-1 text-[12.5px] text-gray-600">Saving changes the content version. A reviewed or pending version then needs review again.</p>
                  <div className="mt-3"><CompetencyEditor key={cur.c.id} c={cur.c} levels={levels} approved={cur.c.status === "approved"} cpus={cur.d.cpus} /></div>
                </details>
              ) : <p className="text-[13px] text-gray-600">The framework is under governance review or archived, so its content is not edited here.</p>}
              {editable && (cur.c.status === "eligible" || cur.c.status === "changes_requested") && <SubmitReview competencyId={cur.c.id} />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Criteria({ criteria, components }: { criteria: StudioCompetency["criteria"]; components: Record<string, string> }) {
  const codes = [...Object.keys(components).filter(k => criteria.some(c => c.component === k)), ...(criteria.some(c => !c.component) ? [""] : [])];
  const [tab, setTab] = useState(codes[0] ?? "");
  if (!criteria.length) return <p className="text-[13px] text-gray-600">No assessment criteria are recorded for this competency.</p>;
  const shown = criteria.filter(c => (c.component ?? "") === tab);
  const prefix = (code: string) => (code === "clinical_skills" ? "S" : code === "knowledge" ? "K" : code === "knowledge_application" ? "A" : "C");
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[15px] font-bold text-gray-900">Assessment criteria</h3><span className="text-[12px] text-gray-500">One section at a time · source wording</span></div>
      <div role="tablist" aria-label="Assessment components" className="mt-2 flex flex-wrap gap-2">
        {codes.map(code => {
          const n = criteria.filter(c => (c.component ?? "") === code).length;
          return <button key={code || "none"} role="tab" type="button" aria-selected={tab === code} onClick={() => setTab(code)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${tab === code ? "border-teal-900 bg-teal-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>
            {code ? components[code] ?? code : "Not classified"} {n}</button>;
        })}
      </div>
      <ol role="tabpanel" className="mt-3 space-y-2">
        {shown.map((c, i) => (
          <li key={i} className="flex gap-3" title={c.sourceRef ?? undefined}>
            <span className="mt-0.5 inline-flex h-7 min-w-9 items-center justify-center rounded-md bg-teal-50 px-1.5 font-mono text-[11.5px] font-semibold text-teal-900">{prefix(tab)}{i + 1}</span>
            <span className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13.5px] text-gray-900">{c.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
