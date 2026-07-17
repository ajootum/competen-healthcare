"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type SkillNode = { id: string; name: string; active: boolean };
export type CompetencyNode = {
  id: string; name: string; description: string | null; riskCategory: string | null;
  cpuId: string | null; cpuName: string | null; cpuPublished: boolean; practiceId: string | null;
  skills: SkillNode[]; mcqs: number;
};
export type DomainNode = {
  id: string; name: string; competencies: CompetencyNode[];
  cpuCount: number; practiceCount: number; skillCount: number; completeness: number; published: boolean;
};

const barColor = (pct: number) =>
  pct >= 85 ? "bg-green-500" : pct >= 60 ? "bg-teal-500" : pct >= 40 ? "bg-amber-500" : "bg-red-400";

const STATUS_BADGE: Record<string, string> = {
  published: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-500",
  in_review: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export default function BuilderWorkspace({
  frameworkId, frameworkName, libraryLabel, pubStatus, version, updatedAt, totals, domains,
}: {
  frameworkId: string; frameworkName: string; libraryLabel: string; pubStatus: string;
  version: number; updatedAt: string | null;
  totals: { domains: number; competencies: number; skills: number; cpus: number; mcqs: number; completeness: number };
  domains: DomainNode[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(domains[0] ? [domains[0].id] : []));
  const [openComp, setOpenComp] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ domain: DomainNode; comp: CompetencyNode } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<null | { type: "domain" } | { type: "competency"; domainId: string } | { type: "skill"; competencyId: string }>(null);
  const [draft, setDraft] = useState("");

  const q = search.trim().toLowerCase();
  const visibleDomains = useMemo(() => domains.filter(d => {
    if (statusFilter === "published" && !d.published) return false;
    if (statusFilter === "draft" && d.published) return false;
    if (!q) return true;
    return d.name.toLowerCase().includes(q) ||
      d.competencies.some(c => c.name.toLowerCase().includes(q) || c.skills.some(s => s.name.toLowerCase().includes(q)));
  }), [domains, statusFilter, q]);

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const collapseAll = () => setExpanded(new Set());
  const expandAll = () => setExpanded(new Set(domains.map(d => d.id)));

  async function add(endpoint: string, body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/content/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) { setAdding(null); setDraft(""); router.refresh(); }
  }

  const STAT = [
    { label: `${libraryLabel}`, big: totals.domains, sub: "Domains", badge: pubStatus, icon: "📖", tint: "bg-indigo-50" },
    { label: "Competencies", big: totals.competencies, sub: "defined", icon: "🎯", tint: "bg-blue-50" },
    { label: "Skills", big: totals.skills.toLocaleString(), sub: "reusable", icon: "✋", tint: "bg-green-50" },
    { label: "CPUs", big: totals.cpus, sub: "practice units", icon: "🏥", tint: "bg-amber-50" },
    { label: "Completeness", big: `${totals.completeness}%`, sub: "CPU-linked", icon: "◔", tint: "bg-teal-50", ring: true },
    { label: "Last updated", big: timeAgo(updatedAt), sub: version ? `v${version}` : "unversioned", icon: "🕐", tint: "bg-gray-50", small: true },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
      <div className="min-w-0">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {STAT.map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className={`w-7 h-7 rounded-lg ${s.tint} flex items-center justify-center text-sm`}>{s.icon}</div>
                {s.badge && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded capitalize ${STATUS_BADGE[s.badge] ?? "bg-gray-100 text-gray-500"}`}>{s.badge.replace("_", " ")}</span>}
              </div>
              <p className={`font-bold text-gray-900 ${s.small ? "text-sm" : "text-2xl"}`}>{s.big}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{s.label}{s.sub ? ` · ${s.sub}` : ""}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search domains, competencies, skills…"
            className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30">
            <option value="all">All status</option>
            <option value="published">Published</option>
            <option value="draft">Draft / partial</option>
          </select>
          <Link href={`/super-admin/content/${frameworkId}/cpus`}
            className="text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-lg transition-colors">
            🧩 CPU Structure
          </Link>
          <button onClick={() => { setAdding({ type: "domain" }); setDraft(""); }}
            className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg transition-colors">
            + Add Domain
          </button>
        </div>

        {/* Structure header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Framework Structure</h2>
          <div className="flex items-center gap-3 text-xs">
            <button onClick={collapseAll} className="text-gray-400 hover:text-gray-600">Collapse all</button>
            <button onClick={expandAll} className="text-gray-400 hover:text-gray-600">Expand all</button>
          </div>
        </div>

        {adding?.type === "domain" && (
          <div className="flex gap-2 mb-3">
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="New domain name"
              onKeyDown={e => e.key === "Enter" && draft.trim() && add("domains", { name: draft.trim(), framework_id: frameworkId })}
              className="flex-1 border border-teal-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
            <button disabled={busy || !draft.trim()} onClick={() => add("domains", { name: draft.trim(), framework_id: frameworkId })}
              className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-50">Add</button>
            <button onClick={() => setAdding(null)} className="text-sm text-gray-400 px-3">Cancel</button>
          </div>
        )}

        {/* Tree */}
        <div className="flex flex-col gap-2">
          {visibleDomains.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-sm text-gray-400">
              {domains.length === 0 ? "No domains yet — add the first one above." : "No matches."}
            </div>
          )}
          {visibleDomains.map((d, i) => {
            const isOpen = expanded.has(d.id);
            return (
              <div key={d.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* Domain row */}
                <button onClick={() => toggle(d.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 transition-colors text-left">
                  <span className="text-gray-300 text-xs w-3">{isOpen ? "▾" : "▸"}</span>
                  <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center text-sm font-bold text-teal-700 shrink-0">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{d.name}</p>
                    <p className="text-[10px] text-gray-400">{d.competencies.length} competenc{d.competencies.length === 1 ? "y" : "ies"} · {d.skillCount} skills · {d.cpuCount} CPUs</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 w-40 shrink-0">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor(d.completeness)}`} style={{ width: `${Math.max(d.completeness, 3)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-600 w-9 text-right">{d.completeness}%</span>
                  </div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${d.published ? STATUS_BADGE.published : STATUS_BADGE.draft}`}>
                    {d.published ? "Published" : "Draft"}
                  </span>
                </button>

                {/* Competencies */}
                {isOpen && (
                  <div className="border-t border-gray-50 divide-y divide-gray-50">
                    {d.competencies.length === 0 && (
                      <p className="px-5 py-3 text-xs text-gray-400">No competencies yet.</p>
                    )}
                    {d.competencies.map(c => {
                      const compOpen = openComp === c.id;
                      const isSel = selected?.comp.id === c.id;
                      return (
                        <div key={c.id} className={isSel ? "bg-teal-50/40" : ""}>
                          <div className="flex items-center gap-2.5 px-5 py-2.5">
                            <button onClick={() => setOpenComp(compOpen ? null : c.id)} className="text-gray-300 text-[10px] w-3">{compOpen ? "▾" : "▸"}</button>
                            <button onClick={() => setSelected({ domain: d, comp: c })} className="flex-1 min-w-0 text-left">
                              <p className="text-sm text-gray-800 truncate">{c.name}</p>
                              <p className="text-[10px] text-gray-400">
                                {c.skills.length} skills{c.cpuName ? ` · ${c.cpuName}` : " · no CPU"}{c.mcqs ? ` · ${c.mcqs} MCQ bank${c.mcqs !== 1 ? "s" : ""}` : ""}
                              </p>
                            </button>
                            {c.cpuId
                              ? <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${c.cpuPublished ? STATUS_BADGE.published : STATUS_BADGE.draft}`}>{c.cpuPublished ? "Published" : "Draft"}</span>
                              : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 shrink-0">Unlinked</span>}
                          </div>
                          {/* Skill chips */}
                          {compOpen && (
                            <div className="px-5 pb-3 pl-11">
                              {c.skills.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {c.skills.map(s => (
                                    <span key={s.id} className={`text-[11px] px-2 py-1 rounded-md border ${s.active ? "bg-white border-gray-200 text-gray-700" : "bg-gray-50 border-gray-100 text-gray-400 line-through"}`}>{s.name}</span>
                                  ))}
                                </div>
                              ) : <p className="text-[11px] text-gray-400">No skills yet.</p>}
                              {adding?.type === "skill" && adding.competencyId === c.id ? (
                                <div className="flex gap-2 mt-2">
                                  <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="New skill"
                                    onKeyDown={e => e.key === "Enter" && draft.trim() && add("skills", { name: draft.trim(), competency_id: c.id })}
                                    className="flex-1 border border-teal-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
                                  <button disabled={busy || !draft.trim()} onClick={() => add("skills", { name: draft.trim(), competency_id: c.id })} className="bg-teal-600 text-white text-xs font-semibold px-3 rounded-lg disabled:opacity-50">Add</button>
                                  <button onClick={() => setAdding(null)} className="text-xs text-gray-400 px-1">✕</button>
                                </div>
                              ) : (
                                <button onClick={() => { setAdding({ type: "skill", competencyId: c.id }); setDraft(""); }} className="text-[11px] text-teal-600 hover:underline mt-2">+ add skill</button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Add competency */}
                    {adding?.type === "competency" && adding.domainId === d.id ? (
                      <div className="flex gap-2 px-5 py-2.5">
                        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="New competency"
                          onKeyDown={e => e.key === "Enter" && draft.trim() && add("competencies", { name: draft.trim(), domain_id: d.id })}
                          className="flex-1 border border-teal-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
                        <button disabled={busy || !draft.trim()} onClick={() => add("competencies", { name: draft.trim(), domain_id: d.id })} className="bg-teal-600 text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-50">Add</button>
                        <button onClick={() => setAdding(null)} className="text-sm text-gray-400 px-2">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setAdding({ type: "competency", domainId: d.id }); setDraft(""); }} className="w-full text-left px-5 py-2 text-xs text-teal-600 hover:bg-teal-50/50 transition-colors">+ add competency</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right context panel */}
      <div className="hidden xl:block">
        <div className="sticky top-6">
          {selected ? (
            <ContextPanel domain={selected.domain} comp={selected.comp} frameworkId={frameworkId} onClose={() => setSelected(null)} />
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
              <p className="text-3xl mb-2">🗂️</p>
              <p className="text-sm font-semibold text-gray-700">Select a competency</p>
              <p className="text-xs text-gray-400 mt-1">Click any competency in the tree to see its content coverage, CPU link and completeness here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextPanel({ domain, comp, frameworkId, onClose }: {
  domain: DomainNode; comp: CompetencyNode; frameworkId: string; onClose: () => void;
}) {
  const activeSkills = comp.skills.filter(s => s.active).length;
  const skillPct = comp.skills.length ? Math.round((activeSkills / comp.skills.length) * 100) : 0;

  // Coverage checklist — real signals where we have them; "not tracked" is honest, not a fake zero.
  const rows: { label: string; value: string; ok: boolean | null }[] = [
    { label: "Skills", value: `${activeSkills}/${comp.skills.length}`, ok: comp.skills.length > 0 && activeSkills === comp.skills.length },
    { label: "Linked CPU", value: comp.cpuName ?? "—", ok: !!comp.cpuId },
    { label: "CPU published", value: comp.cpuId ? (comp.cpuPublished ? "Yes" : "Draft") : "—", ok: comp.cpuPublished },
    { label: "Risk classified", value: comp.riskCategory ?? "—", ok: !!comp.riskCategory },
    { label: "Knowledge (MCQ banks)", value: comp.mcqs ? `${comp.mcqs}` : "0", ok: comp.mcqs > 0 },
    { label: "OSCE stations", value: "not tracked", ok: null },
    { label: "Simulations", value: "not tracked", ok: null },
    { label: "Learning resources", value: "not tracked", ok: null },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="p-5 border-b border-gray-50">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-gray-900 leading-snug">{comp.name}</p>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-sm shrink-0">✕</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{domain.name}</span>
          {comp.cpuId
            ? <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${comp.cpuPublished ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{comp.cpuPublished ? "Published" : "Draft"}</span>
            : <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium">Unlinked</span>}
        </div>
      </div>

      {comp.description && (
        <div className="p-5 border-b border-gray-50">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Summary</p>
          <p className="text-xs text-gray-600 leading-relaxed">{comp.description}</p>
        </div>
      )}

      <div className="p-5 border-b border-gray-50">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Skill completeness</p>
          <span className="text-xs font-bold text-gray-700">{skillPct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${barColor(skillPct)}`} style={{ width: `${Math.max(skillPct, 3)}%` }} />
        </div>
      </div>

      <div className="p-5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Content coverage</p>
        <div className="flex flex-col gap-1.5">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-2 text-xs">
              <span className={r.ok === null ? "text-gray-300" : r.ok ? "text-green-500" : "text-amber-500"}>
                {r.ok === null ? "○" : r.ok ? "✓" : "⚠"}
              </span>
              <span className="flex-1 text-gray-600">{r.label}</span>
              <span className={`font-medium ${r.ok === null ? "text-gray-300 italic" : "text-gray-700"}`}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 border-t border-gray-50 flex gap-2">
        {comp.cpuId && (
          <Link href={`/super-admin/content/${frameworkId}/cpus`}
            className="flex-1 text-center text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 py-2 rounded-lg transition-colors">
            Open CPU
          </Link>
        )}
        <Link href={`/super-admin/content/${frameworkId}/cpus`}
          className="flex-1 text-center text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg transition-colors">
          Edit structure
        </Link>
      </div>
    </div>
  );
}
