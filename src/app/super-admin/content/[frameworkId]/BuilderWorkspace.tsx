"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FrameworkActions from "../FrameworkActions";

export type Dimension = { key: string; present: boolean; detail: string };
export type SkillNode = { id: string; name: string; active: boolean; reusable: boolean };
export type CompetencyNode = {
  id: string; number: string; name: string; code: string | null; description: string | null;
  riskCategory: string | null; cpuId: string | null; cpuName: string | null;
  status: string; completeness: number; dimensions: Dimension[];
  skills: SkillNode[];
  stats: { knowledge: number; knowledgePublished: number; cases: number; evidence: number; methods: number; mcqs: number; criticalRules: number };
  owner: string | null; addedAt: string | null; sortOrder: number;
};
export type DomainNode = {
  id: string; number: number; name: string; competencies: CompetencyNode[];
  skillCount: number; cpuCount: number; completeness: number; sortOrder: number;
};
export type FrameworkOption = { id: string; name: string; library: string };
type Stats = {
  domains: number; domainsWithContent: number;
  competencies: number; competenciesPublished: number; competenciesDraft: number;
  skills: number; skillsReusable: number; skillsCustom: number;
  cpus: number; cpusLinked: number; cpusUnlinked: number;
  completeness: number;
};

// Health indicators (spec §3D)
const STATUS_UI: Record<string, { label: string; dot: string; pill: string }> = {
  published:  { label: "Published",  dot: "bg-green-500",  pill: "bg-green-100 text-green-700" },
  approved:   { label: "Approved",   dot: "bg-blue-500",   pill: "bg-blue-100 text-blue-700" },
  review:     { label: "Review",     dot: "bg-amber-400",  pill: "bg-amber-100 text-amber-700" },
  draft:      { label: "Draft",      dot: "bg-slate-400",  pill: "bg-slate-100 text-slate-600" },
  incomplete: { label: "Incomplete", dot: "bg-orange-500", pill: "bg-orange-100 text-orange-700" },
};
// Board columns follow the authoring pipeline, least → most finished.
const STATUS_ORDER = ["incomplete", "draft", "review", "approved", "published"];

// Content-type icons shown under a competency name
const CONTENT_ICONS: { key: keyof CompetencyNode["stats"] | "cpu"; icon: string; label: string }[] = [
  { key: "cpu", icon: "🏥", label: "CPU linked" },
  { key: "knowledge", icon: "🫀", label: "Knowledge objects" },
  { key: "methods", icon: "🩺", label: "Assessment methods" },
  { key: "mcqs", icon: "❓", label: "MCQ bank" },
  { key: "cases", icon: "🧑‍⚕️", label: "Case studies" },
  { key: "evidence", icon: "📎", label: "Evidence requirements" },
  { key: "criticalRules", icon: "⛔", label: "Critical-failure rules" },
];

// Below 2xl the workspace is too narrow to carry all columns without starving
// the Name column, so Type and Added drop out (both are in the context panel).
// Every class token appears literally so Tailwind's scanner can see it.
const ROW = "grid-cols-[1fr_88px_112px_40px_36px] 2xl:grid-cols-[1fr_70px_90px_130px_50px_90px_36px] gap-3";
const WIDE_ONLY = "hidden 2xl:block";

const bar = (pct: number) =>
  pct >= 85 ? "bg-green-500" : pct >= 60 ? "bg-teal-500" : pct >= 40 ? "bg-amber-500" : "bg-orange-500";

const ago = (iso: string | null) => {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString();
};

export default function BuilderWorkspace({
  frameworkId, frameworkName, libraryLabel, pubStatus, version, stats, domains, owners, allFrameworks,
}: {
  frameworkId: string; frameworkName: string; libraryLabel: string; pubStatus: string;
  version: number; stats: Stats; domains: DomainNode[]; owners: string[]; allFrameworks: FrameworkOption[];
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(domains[0] ? [domains[0].id] : []));
  const [selected, setSelected] = useState<CompetencyNode | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [view, setView] = useState<"tree" | "board">("tree");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | { kind: "domain" | "competency"; id: string; value: string }>(null);
  const [adding, setAdding] = useState<null | { type: "domain" } | { type: "competency"; domainId: string }>(null);
  const [draft, setDraft] = useState("");

  // Ctrl+K / Cmd+K focuses the global search (spec §3E)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const q = search.trim().toLowerCase();
  const matches = (c: CompetencyNode) =>
    (statusFilter === "all" || c.status === statusFilter) &&
    (typeFilter === "all" || (c.riskCategory ?? "core") === typeFilter) &&
    (ownerFilter === "all" || c.owner === ownerFilter) &&
    (!q || c.name.toLowerCase().includes(q) || (c.code ?? "").toLowerCase().includes(q) ||
      c.skills.some(s => s.name.toLowerCase().includes(q)));

  const noFilters = !q && statusFilter === "all" && typeFilter === "all" && ownerFilter === "all";
  const visible = useMemo(() => domains
    .map(d => ({ ...d, competencies: d.competencies.filter(matches) }))
    .filter(d => d.competencies.length > 0 || noFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domains, q, statusFilter, typeFilter, ownerFilter]);

  const types = useMemo(
    () => [...new Set(domains.flatMap(d => d.competencies.map(c => c.riskCategory ?? "core")))].sort(),
    [domains]);

  const toggle = (id: string) => setExpanded(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ── Mutations (all against existing content APIs) ──
  async function api(method: string, path: string, body?: unknown): Promise<boolean> {
    setErr(null);
    const res = await fetch(path, {
      method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `Request failed (${res.status})`);
      return false;
    }
    return true;
  }

  async function add(endpoint: string, body: Record<string, unknown>) {
    setBusy(true);
    const ok = await api("POST", `/api/content/${endpoint}`, body);
    setBusy(false);
    if (ok) { setAdding(null); setDraft(""); router.refresh(); }
  }

  async function saveRename() {
    if (!editing || !editing.value.trim()) return;
    const ep = editing.kind === "domain" ? "domains" : "competencies";
    setBusy(true);
    const ok = await api("PATCH", `/api/content/${ep}?id=${editing.id}`, { name: editing.value.trim() });
    setBusy(false);
    if (ok) { setEditing(null); router.refresh(); }
  }

  async function remove(kind: "domain" | "competency", id: string, label: string) {
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return;
    const ep = kind === "domain" ? "domains" : "competencies";
    setBusy(true);
    const ok = await api("DELETE", `/api/content/${ep}?id=${id}`);
    setBusy(false);
    if (ok) router.refresh();
  }

  async function duplicate(c: CompetencyNode, domainId: string) {
    setBusy(true);
    const ok = await api("POST", "/api/content/competencies",
      { name: `${c.name} (copy)`, description: c.description ?? undefined, domain_id: domainId });
    setBusy(false);
    if (ok) router.refresh();
  }

  // Reorder by renumbering the whole sibling list — imported/legacy rows can
  // carry colliding sort_orders, so a pairwise swap is not reliable. Rows whose
  // number is already correct are skipped, so healed lists cost ~2 requests.
  async function move(kind: "domain" | "competency", list: { id: string; sortOrder: number }[], idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const order = [...list];
    const [item] = order.splice(idx, 1);
    order.splice(j, 0, item);
    const ep = kind === "domain" ? "domains" : "competencies";
    setBusy(true);
    let ok = true;
    for (let i = 0; i < order.length && ok; i++) {
      if (order[i].sortOrder !== i + 1) {
        ok = await api("PATCH", `/api/content/${ep}?id=${order[i].id}`, { sort_order: i + 1 });
      }
    }
    setBusy(false);
    if (ok) router.refresh();
  }

  async function publish() {
    if (!window.confirm(`Publish “${frameworkName}” as v${version + 1}? A full snapshot is saved to version history.`)) return;
    setBusy(true);
    const ok = await api("PATCH", "/api/content/lifecycle", { frameworkId, action: "publish" });
    setBusy(false);
    if (ok) router.refresh();
  }

  function exportJson() {
    const payload = { framework: frameworkName, version, pubStatus, exportedAt: new Date().toISOString(), stats, domains };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${frameworkName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-v${version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const MenuItem = ({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) => (
    <button onClick={() => { setMenuFor(null); onClick(); }}
      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${danger ? "text-red-600" : "text-gray-700"}`}>
      {children}
    </button>
  );

  const ActionsCell = ({ id, children }: { id: string; children: React.ReactNode }) => (
    <div className="relative flex justify-center" onClick={e => e.stopPropagation()}>
      <button onClick={() => setMenuFor(menuFor === id ? null : id)}
        className="text-gray-300 hover:text-gray-600 text-sm px-1 rounded" title="Actions">⋮</button>
      {menuFor === id && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuFor(null)} />
          <div className="absolute right-0 top-6 z-30 w-44 bg-white border border-gray-100 rounded-lg shadow-lg py-1">
            {children}
          </div>
        </>
      )}
    </div>
  );

  const STAT_CARDS = [
    { icon: "📖", tint: "bg-indigo-50", value: stats.domains, label: "Domains", sub: `${stats.domainsWithContent} with content · ${stats.domains - stats.domainsWithContent} empty` },
    { icon: "🎯", tint: "bg-blue-50", value: stats.competencies, label: "Competencies", sub: `${stats.competenciesPublished} published · ${stats.competenciesDraft} draft` },
    { icon: "✋", tint: "bg-green-50", value: stats.skills, label: "Skills", sub: `${stats.skillsReusable} reusable · ${stats.skillsCustom} custom` },
    { icon: "🏥", tint: "bg-amber-50", value: stats.cpus, label: "CPUs", sub: `${stats.cpusLinked} linked · ${stats.cpusUnlinked} unlinked` },
  ];

  const QUICK_LINKS = [
    { icon: "📄", label: "Import CPU Doc", sub: "Authored Word file", href: "/super-admin/studio/import" },
    { icon: "🏥", label: "CPU Structure", sub: "Practices & units", href: `/super-admin/content/${frameworkId}/cpus` },
    { icon: "✋", label: "Skill Library", sub: "Reusable skills", href: "/super-admin/studio/skills" },
    { icon: "🫀", label: "Knowledge Object", sub: "Governed content", href: "/super-admin/studio/knowledge" },
    { icon: "🧑‍⚕️", label: "Case Study", sub: "Worked scenarios", href: "/super-admin/studio/cases" },
    { icon: "❓", label: "Question Bank", sub: "Governed MCQs", href: "/super-admin/studio/questions" },
    { icon: "🤖", label: "AI Assistant", sub: "Grounded, cited", href: "/super-admin/assistant" },
  ];

  const input = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  const hdrBtn = "text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] 2xl:grid-cols-[1fr_340px] gap-5">
      <div className="min-w-0">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <select value={frameworkId} onChange={e => router.push(`/super-admin/content/${e.target.value}`)}
            title="Switch framework"
            className="text-xl font-bold text-gray-900 bg-transparent focus:outline-none cursor-pointer max-w-[300px] -ml-1">
            {allFrameworks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {version > 0 && <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">v{version}</span>}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${STATUS_UI[pubStatus]?.pill ?? STATUS_UI.draft.pill}`}>
            {pubStatus.replace("_", " ")}
          </span>
          <span className="text-[10px] text-gray-400">{libraryLabel}</span>
          <FrameworkActions compact />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/super-admin/studio/import" className={hdrBtn}>Import</Link>
            <button onClick={exportJson} className={hdrBtn}>Export</button>
            <a href="#version-history" className={hdrBtn}>Version History</a>
            <button onClick={publish} disabled={busy}
              className="text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
              Publish Framework
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          {STAT_CARDS.map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className={`w-8 h-8 rounded-lg ${s.tint} flex items-center justify-center text-sm mb-2`}>{s.icon}</div>
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-[11px] text-gray-500 font-medium">{s.label}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
          <div className="bg-white rounded-xl border border-gray-100 p-4 col-span-2 lg:col-span-1">
            <p className="text-[10px] text-gray-400 font-medium mb-1">Framework completeness</p>
            <p className="text-2xl font-bold text-gray-900">{stats.completeness}%</p>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden my-1.5">
              <div className={`h-full rounded-full ${bar(stats.completeness)}`} style={{ width: `${Math.max(stats.completeness, 2)}%` }} />
            </div>
            <p className="text-[9px] text-gray-400">Across 6 tracked content dimensions</p>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search competencies, skills, codes…"
              className={`${input} w-full pr-14`} />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-300 border border-gray-200 rounded px-1 py-0.5">Ctrl K</kbd>
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={input}>
            <option value="all">All status</option>
            {Object.entries(STATUS_UI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {types.length > 1 && (
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={`${input} capitalize`}>
              <option value="all">All types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {owners.length > 0 && (
            <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className={input}>
              <option value="all">All owners</option>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <div className="flex items-center gap-3 text-xs">
            <button onClick={() => setExpanded(new Set(domains.map(d => d.id)))} className="text-gray-400 hover:text-gray-600">Expand all</button>
            <button onClick={() => setExpanded(new Set())} className="text-gray-400 hover:text-gray-600">Collapse all</button>
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold ml-auto">
            <button onClick={() => setView("tree")}
              className={`px-3 py-1.5 ${view === "tree" ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>Tree</button>
            <button onClick={() => setView("board")}
              className={`px-3 py-1.5 ${view === "board" ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>Board</button>
          </div>
          <button onClick={() => { setAdding({ type: "domain" }); setDraft(""); }}
            className="text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg">+ Add Domain</button>
        </div>

        {err && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">
            {err} <button onClick={() => setErr(null)} className="underline ml-1">dismiss</button>
          </p>
        )}

        {adding?.type === "domain" && (
          <div className="flex gap-2 mb-3">
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="New domain name"
              onKeyDown={e => e.key === "Enter" && draft.trim() && add("domains", { name: draft.trim(), framework_id: frameworkId })}
              className={`${input} flex-1`} />
            <button disabled={busy || !draft.trim()} onClick={() => add("domains", { name: draft.trim(), framework_id: frameworkId })}
              className="bg-teal-600 text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-50">Add</button>
            <button onClick={() => setAdding(null)} className="text-sm text-gray-400 px-2">Cancel</button>
          </div>
        )}

        {view === "board" ? (
          /* ── Board view: authoring pipeline ── */
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {STATUS_ORDER.map(st => {
              const ui = STATUS_UI[st];
              const cards = visible.flatMap(d => d.competencies).filter(c => c.status === st);
              return (
                <div key={st} className="bg-gray-50/70 rounded-xl p-2.5 min-h-[220px]">
                  <div className="flex items-center gap-1.5 px-1 mb-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${ui.dot}`} />
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{ui.label}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{cards.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {cards.map(c => (
                      <button key={c.id} onClick={() => setSelected(c)}
                        className={`bg-white rounded-lg border p-2.5 text-left transition-colors ${
                          selected?.id === c.id ? "border-teal-400" : "border-gray-100 hover:border-gray-300"}`}>
                        <p className="text-[9px] font-mono text-gray-400">{c.number}</p>
                        <p className="text-xs text-gray-800 leading-snug">{c.name}</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${bar(c.completeness)}`} style={{ width: `${Math.max(c.completeness, 2)}%` }} />
                          </div>
                          <span className="text-[9px] font-semibold text-gray-500">{c.completeness}%</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Tree view ── */
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className={`hidden md:grid ${ROW} px-4 py-2 bg-gray-50/70 text-[10px] font-bold text-gray-400 uppercase tracking-wider`}>
              <span>Name</span><span className={WIDE_ONLY}>Type</span><span>Status</span>
              <span>Completeness</span><span className="text-center">CPU</span><span className={WIDE_ONLY}>Added</span><span />
            </div>

            {visible.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-gray-400">
                {domains.length === 0 ? "No domains yet — add the first one above." : "No matches."}
              </p>
            )}

            <div className="divide-y divide-gray-50">
              {visible.map((d, di) => {
                const isOpen = expanded.has(d.id);
                return (
                  <div key={d.id}>
                    {/* Domain row */}
                    <div role="button" onClick={() => toggle(d.id)}
                      className={`w-full grid ${ROW} px-4 py-3 hover:bg-gray-50/60 transition-colors items-center text-left cursor-pointer`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-gray-300 text-xs w-3">{isOpen ? "▾" : "▸"}</span>
                        <div className="w-6 h-6 rounded bg-teal-50 text-teal-700 text-[11px] font-bold flex items-center justify-center shrink-0">{d.number}</div>
                        <div className="min-w-0" onClick={e => editing?.id === d.id && e.stopPropagation()}>
                          {editing?.id === d.id ? (
                            <input autoFocus value={editing.value}
                              onChange={e => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditing(null); }}
                              className="border border-teal-300 rounded px-2 py-0.5 text-sm w-full" />
                          ) : (
                            <p className="text-sm font-semibold text-gray-800 truncate">{d.name}</p>
                          )}
                          <p className="text-[10px] text-gray-400">{d.competencies.length} competencies · {d.skillCount} skills · {d.cpuCount} CPUs</p>
                        </div>
                      </div>
                      <span className={`text-[10px] text-gray-400 ${WIDE_ONLY}`}>Domain</span>
                      <span />
                      <div className="hidden md:flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${bar(d.completeness)}`} style={{ width: `${Math.max(d.completeness, 2)}%` }} />
                        </div>
                        <span className="text-[11px] font-bold text-gray-600 w-8 text-right">{d.completeness}%</span>
                      </div>
                      <span className="text-[11px] text-gray-500 text-center hidden md:block">{d.cpuCount}</span>
                      <span className={WIDE_ONLY} />
                      <ActionsCell id={d.id}>
                        <MenuItem onClick={() => setEditing({ kind: "domain", id: d.id, value: d.name })}>✏️ Rename</MenuItem>
                        <MenuItem onClick={() => { setAdding({ type: "competency", domainId: d.id }); setDraft(""); setExpanded(p => new Set(p).add(d.id)); }}>＋ Add competency</MenuItem>
                        <MenuItem onClick={() => move("domain", domains, domains.findIndex(x => x.id === d.id), -1)}>↑ Move up</MenuItem>
                        <MenuItem onClick={() => move("domain", domains, domains.findIndex(x => x.id === d.id), 1)}>↓ Move down</MenuItem>
                        <MenuItem danger onClick={() => remove("domain", d.id, d.name)}>🗑 Delete domain</MenuItem>
                      </ActionsCell>
                    </div>

                    {/* Competency rows */}
                    {isOpen && (
                      <div className="bg-gray-50/30">
                        {d.competencies.map(c => {
                          const st = STATUS_UI[c.status] ?? STATUS_UI.draft;
                          const isSel = selected?.id === c.id;
                          const fullList = domains[di]?.id === d.id ? domains[di].competencies : d.competencies;
                          return (
                            <div key={c.id} role="button" onClick={() => setSelected(c)}
                              className={`w-full grid ${ROW} px-4 py-2.5 items-center text-left border-l-2 transition-colors cursor-pointer ${
                                isSel ? "bg-teal-50/60 border-teal-500" : "border-transparent hover:bg-white"}`}>
                              <div className="flex items-center gap-2.5 min-w-0 pl-6">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
                                <span className="text-[10px] font-mono text-gray-400 w-7 shrink-0">{c.number}</span>
                                <div className="min-w-0" onClick={e => editing?.id === c.id && e.stopPropagation()}>
                                  {editing?.id === c.id ? (
                                    <input autoFocus value={editing.value}
                                      onChange={e => setEditing({ ...editing, value: e.target.value })}
                                      onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditing(null); }}
                                      className="border border-teal-300 rounded px-2 py-0.5 text-sm w-full" />
                                  ) : (
                                    <p className="text-sm text-gray-800 truncate">{c.name}</p>
                                  )}
                                  <div className="flex items-center gap-1 mt-0.5">
                                    {CONTENT_ICONS.map(ci => {
                                      const has = ci.key === "cpu" ? !!c.cpuId : c.stats[ci.key as keyof typeof c.stats] > 0;
                                      return (
                                        <span key={ci.key} title={`${ci.label}${has ? "" : " — missing"}`}
                                          className={`text-[9px] ${has ? "opacity-100" : "opacity-20 grayscale"}`}>{ci.icon}</span>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                              <span className={`text-[10px] text-gray-500 capitalize ${WIDE_ONLY}`}>{c.riskCategory ?? "core"}</span>
                              <span className="hidden md:block">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${st.pill}`}>{st.label}</span>
                              </span>
                              <div className="hidden md:flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-gray-200/70 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${bar(c.completeness)}`} style={{ width: `${Math.max(c.completeness, 2)}%` }} />
                                </div>
                                <span className="text-[11px] font-semibold text-gray-600 w-8 text-right">{c.completeness}%</span>
                              </div>
                              <span className="text-[11px] text-gray-400 text-center hidden md:block">{c.cpuId ? "1" : "–"}</span>
                              <span className={`text-[10px] text-gray-400 ${WIDE_ONLY}`}>{ago(c.addedAt)}</span>
                              <ActionsCell id={c.id}>
                                <MenuItem onClick={() => setEditing({ kind: "competency", id: c.id, value: c.name })}>✏️ Rename</MenuItem>
                                <MenuItem onClick={() => duplicate(c, d.id)}>⧉ Duplicate</MenuItem>
                                <MenuItem onClick={() => move("competency", fullList, fullList.findIndex(x => x.id === c.id), -1)}>↑ Move up</MenuItem>
                                <MenuItem onClick={() => move("competency", fullList, fullList.findIndex(x => x.id === c.id), 1)}>↓ Move down</MenuItem>
                                <MenuItem danger onClick={() => remove("competency", c.id, c.name)}>🗑 Delete</MenuItem>
                              </ActionsCell>
                            </div>
                          );
                        })}

                        {adding?.type === "competency" && adding.domainId === d.id ? (
                          <div className="flex gap-2 px-4 py-2.5 pl-16">
                            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="New competency"
                              onKeyDown={e => e.key === "Enter" && draft.trim() && add("competencies", { name: draft.trim(), domain_id: d.id })}
                              className={`${input} flex-1`} />
                            <button disabled={busy || !draft.trim()} onClick={() => add("competencies", { name: draft.trim(), domain_id: d.id })}
                              className="bg-teal-600 text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-50">Add</button>
                            <button onClick={() => setAdding(null)} className="text-sm text-gray-400 px-2">✕</button>
                          </div>
                        ) : (
                          <button onClick={() => { setAdding({ type: "competency", domainId: d.id }); setDraft(""); }}
                            className="w-full text-left px-4 py-2 pl-16 text-xs text-teal-600 hover:bg-white transition-colors">+ add competency</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Create / AI Assistant */}
        <div className="mt-4 bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Quick create / AI assistant</p>
          <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-2">
            <button onClick={() => { setAdding({ type: "domain" }); setDraft(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 rounded-lg p-2.5 text-left transition-colors">
              <p className="text-sm">➕</p>
              <p className="text-[11px] font-semibold text-gray-700 mt-1">Add Domain</p>
              <p className="text-[9px] text-gray-400">Structure first</p>
            </button>
            {QUICK_LINKS.map(l => (
              <Link key={l.label} href={l.href}
                className="border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 rounded-lg p-2.5 transition-colors">
                <p className="text-sm">{l.icon}</p>
                <p className="text-[11px] font-semibold text-gray-700 mt-1">{l.label}</p>
                <p className="text-[9px] text-gray-400">{l.sub}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 px-1">
          {Object.entries(STATUS_UI).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />{v.label}
            </span>
          ))}
          <span className="text-[10px] text-gray-300">|</span>
          {CONTENT_ICONS.map(c => (
            <span key={c.key} className="flex items-center gap-1 text-[10px] text-gray-400">{c.icon} {c.label}</span>
          ))}
        </div>
      </div>

      {/* Context panel */}
      <div className="hidden xl:block">
        <div className="sticky top-6">
          {selected
            ? <ContextPanel c={selected} frameworkId={frameworkId} onClose={() => setSelected(null)} />
            : (
              <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
                <p className="text-3xl mb-2">🗂️</p>
                <p className="text-sm font-semibold text-gray-700">Select a competency</p>
                <p className="text-xs text-gray-400 mt-1">Its completeness breakdown, content, owner and actions appear here.</p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function ContextPanel({ c, frameworkId, onClose }: { c: CompetencyNode; frameworkId: string; onClose: () => void }) {
  const st = STATUS_UI[c.status] ?? STATUS_UI.draft;
  const [copied, setCopied] = useState(false);

  const QUICK_STATS: [string, string | number][] = [
    ["Skills", c.skills.length],
    ["Reusable skills", c.skills.filter(s => s.reusable).length],
    ["Knowledge objects", c.stats.knowledge ? `${c.stats.knowledgePublished}/${c.stats.knowledge}` : 0],
    ["Assessment methods", c.stats.methods],
    ["MCQ bank", c.stats.mcqs ? `${c.stats.mcqs} Qs` : 0],
    ["Case studies", c.stats.cases],
    ["Evidence items", c.stats.evidence],
    ["Critical rules", c.stats.criticalRules],
    ["CPUs linked", c.cpuId ? 1 : 0],
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden max-h-[calc(100vh-3rem)] overflow-y-auto">
      <div className="p-5 border-b border-gray-50">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-gray-900 leading-snug">{c.name}</p>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-sm shrink-0">✕</button>
        </div>
        <span className={`inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded ${st.pill}`}>{st.label}</span>
      </div>

      {c.code && (
        <div className="px-5 py-3 border-b border-gray-50">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Code</p>
          <button onClick={() => { navigator.clipboard.writeText(c.code!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            className="text-xs font-mono text-gray-700 hover:text-teal-700 flex items-center gap-1.5">
            {c.code} <span className="text-[9px] text-gray-400">{copied ? "copied" : "⧉"}</span>
          </button>
        </div>
      )}

      <div className="px-5 py-3 border-b border-gray-50">
        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Type</p>
        <p className="text-xs text-gray-700 capitalize">{c.riskCategory ?? "core"} competency{c.cpuName ? ` · ${c.cpuName}` : ""}</p>
      </div>

      {c.description && (
        <div className="px-5 py-3 border-b border-gray-50">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Description</p>
          <p className="text-xs text-gray-600 leading-relaxed">{c.description}</p>
        </div>
      )}

      {/* Completeness breakdown */}
      <div className="px-5 py-4 border-b border-gray-50">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold ${bar(c.completeness)}`}>
            {c.completeness}%
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Completeness</p>
            <p className="text-[10px] text-gray-500">{c.dimensions.filter(d => d.present).length}/{c.dimensions.length} dimensions present</p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {c.dimensions.map(d => (
            <div key={d.key} className="flex items-center gap-2 text-[11px]">
              <span className={d.present ? "text-green-500" : "text-orange-400"}>{d.present ? "✓" : "○"}</span>
              <span className="flex-1 text-gray-600">{d.key}</span>
              <span className="text-gray-400">{d.detail}</span>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-gray-300 mt-2 leading-relaxed">
          Policies, References and Analytics are not tracked by the schema yet — they are excluded rather than estimated.
        </p>
      </div>

      {/* Quick stats */}
      <div className="px-5 py-4 border-b border-gray-50">
        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2">Quick stats</p>
        <div className="flex flex-col gap-1">
          {QUICK_STATS.map(([label, val]) => (
            <div key={label} className="flex justify-between text-[11px]">
              <span className="text-gray-500">{label}</span>
              <span className={`font-semibold ${val === 0 ? "text-gray-300" : "text-gray-800"}`}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Owner */}
      <div className="px-5 py-3 border-b border-gray-50 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Owner</p>
          <p className="text-[11px] text-gray-700">{c.owner ?? <span className="text-orange-500">Unassigned</span>}</p>
        </div>
        <div>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Added</p>
          <p className="text-[11px] text-gray-700">{ago(c.addedAt)}</p>
        </div>
      </div>

      {/* Skills */}
      {c.skills.length > 0 && (
        <div className="px-5 py-4 border-b border-gray-50">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2">Skills ({c.skills.length})</p>
          <div className="flex flex-wrap gap-1">
            {c.skills.map(s => (
              <span key={s.id} title={s.reusable ? "Reusable library skill" : "Custom skill"}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  s.reusable ? "bg-teal-50 border-teal-100 text-teal-700" : "bg-white border-gray-200 text-gray-600"
                } ${s.active ? "" : "line-through opacity-50"}`}>{s.name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4 flex flex-col gap-2">
        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Actions</p>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/super-admin/studio/skills" className="text-center text-[11px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 py-2 rounded-lg">✋ Skills</Link>
          <Link href={`/super-admin/content/${frameworkId}/cpus`} className="text-center text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 py-2 rounded-lg">🏥 CPU</Link>
          <Link href="/super-admin/studio/knowledge" className="text-center text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 py-2 rounded-lg">🫀 Knowledge</Link>
          <Link href="/super-admin/studio/questions" className="text-center text-[11px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 py-2 rounded-lg">❓ Questions</Link>
          <Link href="/super-admin/studio/cases" className="text-center text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 py-2 rounded-lg">🧑‍⚕️ Cases</Link>
          <Link href="/super-admin/studio/responsibilities" className="text-center text-[11px] font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg">🧾 Owner</Link>
        </div>
      </div>
    </div>
  );
}
