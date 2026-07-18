"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Evidence Validation Centre v2 (spec + mockup): left filter panel, smart
// queue, and a split review panel with tabs (Evidence / Checklist / History),
// inline image preview via signed URLs, a rule-based quality score, real risk
// flags (including duplicate detection), competency mapping and a per-entry
// activity feed. Priority is age-derived; decisions/escalations go through
// the audited /api/logbook workflow. No AI confidence is invented — the AI
// assist is a live Copilot handoff.

export type EvidenceEntry = {
  id: string; nurseId: string; nurseName: string; department: string; avatarUrl: string | null;
  skillName: string; competency: string | null; domain: string | null; framework: string | null;
  performedAt: string; location: string | null; supervision: string; notes: string | null;
  status: "pending" | "changes_requested" | "escalated";
  submittedAt: string;
  escalatedBy: string | null; escalationReason: string | null;
  evidence: { id: string; file_name: string; mime_type: string; size_bytes: number }[];
  checklist: string[];
  history: { status: string; created_at: string; verified_by_name: string | null }[];
  feed: { action: string; actor: string | null; at: string }[];
};

export type CentreKpis = {
  pending: number; reviewedToday: number; returned: number; aging: number; avgHours: number | null;
};

const SUP_LABEL: Record<string, string> = {
  observed: "Observed", assisted: "Assisted", supervised: "Supervised", independent: "Independent",
};
const FEED_LABEL: Record<string, string> = {
  log_skill: "Evidence submitted", upload_evidence: "Evidence file uploaded",
  escalate_skill_entry: "Escalated to senior assessor",
  verify_skill_entry: "Verified", reject_skill_entry: "Rejected",
  request_skill_entry_changes: "Returned for revision",
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";
const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86400000;
const prioOf = (e: EvidenceEntry): "high" | "medium" | "low" =>
  ageDays(e.submittedAt) > 3 ? "high" : ageDays(e.submittedAt) > 1 ? "medium" : "low";
const PRIO_UI = {
  high:   { label: "High",   cls: "bg-red-50 text-red-600" },
  medium: { label: "Medium", cls: "bg-amber-50 text-amber-700" },
  low:    { label: "Low",    cls: "bg-green-50 text-green-700" },
};
const fmtSize = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

// Rule-based completeness score (labelled as such — this is not an AI score)
function qualityOf(e: EvidenceEntry) {
  const criteria = [
    { label: "Evidence files attached", met: e.evidence.length > 0, weight: 40 },
    { label: "Learner notes provided", met: !!e.notes?.trim(), weight: 20 },
    { label: "Linked to a competency", met: !!e.competency, weight: 20 },
    { label: "Performed within 90 days", met: ageDays(e.performedAt) <= 90, weight: 20 },
  ];
  return { criteria, score: criteria.reduce((s, c) => s + (c.met ? c.weight : 0), 0) };
}

function riskFlagsOf(e: EvidenceEntry) {
  const flags: { text: string; bad: boolean }[] = [];
  flags.push(e.evidence.length === 0
    ? { text: "No evidence files attached", bad: true }
    : { text: "Evidence files attached", bad: false });
  flags.push(ageDays(e.performedAt) > 90
    ? { text: `Performed ${Math.round(ageDays(e.performedAt))} days ago — stale`, bad: true }
    : { text: "Within the 90-day validity window", bad: false });
  const dupe = e.history.find(h => h.status === "verified");
  flags.push(dupe
    ? { text: `Possible duplicate — same skill verified ${new Date(dupe.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`, bad: true }
    : { text: "No duplicate submissions detected", bad: false });
  flags.push(e.supervision === "independent" && !e.competency
    ? { text: "Independent practice claimed on unlinked skill", bad: true }
    : { text: `Supervision level: ${SUP_LABEL[e.supervision] ?? e.supervision}`, bad: false });
  return flags;
}

export default function EvidenceCentre({ entries, kpis, isSenior }: { entries: EvidenceEntry[]; kpis: CentreKpis; isSenior: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [evF, setEvF] = useState<Set<string>>(new Set());
  const [highOnly, setHighOnly] = useState(false);
  const [dept, setDept] = useState("all");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"evidence" | "checklist" | "history">("evidence");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ id: string; url: string; name: string } | null>(null);

  const live = entries.filter(e => !decided.has(e.id));
  const departments = [...new Set(live.map(e => e.department))].sort();

  const toggleSet = (set: Set<string>, val: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(val)) n.delete(val); else n.add(val);
    apply(n);
  };

  const matches = live.filter(e => {
    if (statusF.size > 0 && !statusF.has(e.status)) return false;
    if (highOnly && prioOf(e) !== "high") return false;
    if (evF.size > 0) {
      const hasPhoto = e.evidence.some(v => v.mime_type.startsWith("image/"));
      const hasDoc = e.evidence.some(v => v.mime_type === "application/pdf");
      const ok = (evF.has("photos") && hasPhoto) || (evF.has("documents") && hasDoc) || (evF.has("none") && e.evidence.length === 0);
      if (!ok) return false;
    }
    if (dept !== "all" && e.department !== dept) return false;
    const t = q.trim().toLowerCase();
    if (t && ![e.nurseName, e.skillName, e.competency ?? "", e.department].some(s => s.toLowerCase().includes(t))) return false;
    return true;
  });
  const filtered = sort === "oldest"
    ? matches.slice().sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    : matches.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  const open = openId ? live.find(e => e.id === openId) ?? null : null;

  function openEntry(id: string | null) {
    setOpenId(id);
    setTab("evidence");
    setPreview(null);
    setError(null);
  }

  async function decide(ids: string[], status: "verified" | "rejected" | "changes_requested" | "escalated") {
    setBusy(true); setError(null);
    for (const id of ids) {
      const res = await fetch("/api/logbook", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, comment: comment.trim() || undefined }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Decision failed");
        setBusy(false);
        return;
      }
      if (status !== "escalated") setDecided(prev => new Set(prev).add(id));
    }
    setComment("");
    setSelected(new Set());
    if (openId && ids.includes(openId) && status !== "escalated") openEntry(null);
    router.refresh();
    setBusy(false);
  }

  async function viewEvidence(fileId: string, mime: string, name: string) {
    const res = await fetch(`/api/evidence?id=${fileId}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) { setError(body.error ?? "Could not open the file"); return; }
    if (mime.startsWith("image/")) setPreview({ id: fileId, url: body.url, name });
    else window.open(body.url, "_blank", "noopener");
  }

  const KPI_TILES = [
    { icon: "📥", value: String(live.filter(e => e.status === "pending").length), label: "Pending Reviews", sub: "awaiting your review", tint: "bg-indigo-50" },
    { icon: "✅", value: String(kpis.reviewedToday), label: "Reviewed Today", sub: "completed", tint: "bg-green-50" },
    { icon: "🔄", value: String(live.filter(e => e.status === "changes_requested").length), label: "Returned for Revision", sub: "awaiting learner action", tint: "bg-amber-50" },
    { icon: "🚩", value: String(live.filter(e => prioOf(e) === "high").length), label: "High Priority", sub: "waiting 3+ days", tint: "bg-red-50" },
    { icon: "⏱️", value: kpis.avgHours !== null ? `${kpis.avgHours}h` : "—", label: "Avg Review Time", sub: kpis.avgHours !== null ? "submission → decision" : "no reviews yet", tint: "bg-blue-50" },
  ];

  const copilotPrompt = open
    ? `I'm an assessor reviewing logbook evidence. Entry: "${open.skillName}"${open.competency ? ` under the competency "${open.competency}"` : ""}${open.domain ? ` (${open.domain} domain)` : ""}, performed ${new Date(open.performedAt).toLocaleDateString()} at supervision level "${open.supervision}". Learner notes: "${open.notes ?? "none"}". Evidence: ${open.evidence.length ? open.evidence.map(v => v.file_name).join(", ") : "none"}. Expected observable skills for this competency: ${open.checklist.length ? open.checklist.join("; ") : "not defined"}. What should I check before verifying, and what would justify returning it?`
    : "";

  const quality = open ? qualityOf(open) : null;
  const flags = open ? riskFlagsOf(open) : [];

  return (
    <div className="max-w-[1500px]">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Evidence Validation Centre</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Review, verify and endorse competency evidence before it is added to the Competency Passport.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/reports/evidence"
            className="text-xs font-semibold text-gray-600 border border-gray-200 bg-white hover:border-indigo-300 px-3 py-2 rounded-lg transition-colors">
            ⬇ Export
          </a>
          <button onClick={() => filtered[0] && openEntry(filtered[0].id)} disabled={filtered.length === 0}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors">
            ＋ New Review
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPI_TILES.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-xl ${k.tint} flex items-center justify-center text-lg`}>{k.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 mt-2 leading-none">{k.value}</p>
            <p className="text-[11px] font-semibold text-gray-700 mt-1 leading-tight">{k.label}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {live.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm font-semibold text-gray-800">Queue clear — every submission is reviewed</p>
          <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto mt-4">
            <div><p className="text-xl font-extrabold text-green-600">{kpis.reviewedToday}</p><p className="text-[10px] text-gray-400">reviewed today</p></div>
            <div><p className="text-xl font-extrabold text-blue-600">{kpis.avgHours !== null ? `${kpis.avgHours}h` : "—"}</p><p className="text-[10px] text-gray-400">avg review time</p></div>
          </div>
          <Link href="/assessor/queue" className="inline-block mt-4 text-xs font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-4 py-2 rounded-lg transition-colors">
            Open Assessment Inbox →
          </Link>
        </div>
      ) : (
        <div className={`grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] ${open ? "xl:grid-cols-[200px_minmax(0,1fr)_340px]" : ""} gap-4 items-start`}>
          {/* Left filter panel */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 lg:sticky lg:top-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-800">Filters</h2>
              <button onClick={() => { setStatusF(new Set()); setEvF(new Set()); setHighOnly(false); setDept("all"); setQ(""); }}
                className="text-[10px] font-semibold text-indigo-600 hover:underline">Clear all</button>
            </div>
            <div className="flex flex-col gap-1.5 mb-3">
              {[
                { key: "pending", label: "Awaiting Review" },
                { key: "changes_requested", label: "Returned" },
                { key: "escalated", label: "Escalated" },
              ].map(s => (
                <label key={s.key} className="flex items-center gap-2 text-[11px] text-gray-600 select-none cursor-pointer">
                  <input type="checkbox" checked={statusF.has(s.key)} onChange={() => toggleSet(statusF, s.key, setStatusF)} className="accent-indigo-600" />
                  {s.label}
                </label>
              ))}
              <label className="flex items-center gap-2 text-[11px] text-gray-600 select-none cursor-pointer">
                <input type="checkbox" checked={highOnly} onChange={() => setHighOnly(h => !h)} className="accent-indigo-600" />
                High priority (3+ days)
              </label>
            </div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Evidence type</p>
            <div className="flex flex-col gap-1.5 mb-3">
              {[
                { key: "photos", label: "Photos" },
                { key: "documents", label: "Documents" },
                { key: "none", label: "No files attached" },
              ].map(s => (
                <label key={s.key} className="flex items-center gap-2 text-[11px] text-gray-600 select-none cursor-pointer">
                  <input type="checkbox" checked={evF.has(s.key)} onChange={() => toggleSet(evF, s.key, setEvF)} className="accent-indigo-600" />
                  {s.label}
                </label>
              ))}
            </div>
            <select value={dept} onChange={e => setDept(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] text-gray-600 bg-white mb-2">
              <option value="all">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] text-gray-600 bg-white">
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </select>
            <p className="text-[9px] text-gray-300 mt-3 leading-snug">
              Video evidence and AI confidence scoring aren&apos;t supported yet.
            </p>
          </div>

          {/* Queue */}
          <div className="min-w-0 flex flex-col gap-3">
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search evidence, learner or competency…"
              className="w-full border border-gray-200 bg-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100" />

            {selected.size > 0 && (
              <div className="bg-gray-900 text-white rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-3">
                <p className="text-xs font-semibold flex-1">{selected.size} selected</p>
                <button onClick={() => decide([...selected], "verified")} disabled={busy}
                  className="text-xs font-semibold bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors">
                  ✓ Verify selected
                </button>
                <button onClick={() => setSelected(new Set())} className="text-xs text-gray-300 hover:text-white">Clear</button>
              </div>
            )}

            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-900">Evidence Queue ({filtered.length})</h2>
              </div>
              {filtered.length === 0 ? (
                <p className="px-5 py-10 text-center text-xs text-gray-400">Nothing matches these filters.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filtered.map(e => {
                    const prio = PRIO_UI[prioOf(e)];
                    const photos = e.evidence.filter(v => v.mime_type.startsWith("image/")).length;
                    const docs = e.evidence.filter(v => v.mime_type === "application/pdf").length;
                    return (
                      <div key={e.id}
                        className={`px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${openId === e.id ? "bg-indigo-50/50" : "hover:bg-gray-50/60"}`}
                        onClick={() => openEntry(openId === e.id ? null : e.id)}>
                        <input type="checkbox" checked={selected.has(e.id)}
                          onChange={() => { const n = new Set(selected); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); setSelected(n); }}
                          onClick={ev => ev.stopPropagation()} className="accent-indigo-600 shrink-0" aria-label={`Select ${e.nurseName}`} />
                        {e.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                          <img src={e.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                            {initials(e.nurseName)}
                          </span>
                        )}
                        <div className="min-w-0 w-36 shrink-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{e.nurseName}</p>
                          <p className="text-[10px] text-gray-400 truncate">RN · {e.department}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{e.skillName}</p>
                          <p className="text-[10px] text-gray-400 truncate">{e.competency ?? "Free-text skill"}{e.domain ? ` · ${e.domain}` : ""}</p>
                        </div>
                        <div className="hidden sm:block w-20 shrink-0">
                          {e.evidence.length ? (
                            <p className="text-[10px] text-gray-600">{photos > 0 && `📷 ${photos} `}{docs > 0 && `📄 ${docs}`}</p>
                          ) : <p className="text-[10px] text-gray-300">no files</p>}
                          <p className="text-[9px] text-gray-400" suppressHydrationWarning>
                            {new Date(e.submittedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                          </p>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${prio.cls}`}>{prio.label}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          e.status === "changes_requested" ? "bg-amber-50 text-amber-700"
                          : e.status === "escalated" ? "bg-purple-50 text-purple-700"
                          : "bg-blue-50 text-blue-600"
                        }`}>{e.status === "changes_requested" ? "Returned" : e.status === "escalated" ? "⬆ Escalated" : "Awaiting"}</span>
                        <span className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg shrink-0 ${
                          openId === e.id ? "bg-indigo-600 text-white" : "text-indigo-700 border border-indigo-200"
                        }`}>Review</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-300">Priority is age-derived (3+ days = high). Quality scores are rule-based, not AI.</p>
          </div>

          {/* Review panel */}
          {open && (
            <div className="bg-white border border-gray-100 rounded-2xl p-4 xl:sticky xl:top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <div className="flex items-start justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-900">Evidence Details</h2>
                <button onClick={() => openEntry(null)} className="text-gray-300 hover:text-gray-600 text-sm">✕</button>
              </div>

              <div className="flex items-center gap-3 mb-3">
                {open.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                  <img src={open.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
                    {initials(open.nurseName)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900">{open.nurseName}</p>
                  <p className="text-[10px] text-gray-400">RN · {open.department} · {SUP_LABEL[open.supervision] ?? open.supervision}</p>
                </div>
                <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${PRIO_UI[prioOf(open)].cls}`}>
                  {PRIO_UI[prioOf(open)].label}
                </span>
              </div>

              {/* Competency mapping */}
              <div className="border-t border-gray-50 pt-2.5 mb-2.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Competency Mapping</p>
                <p className="text-xs text-gray-800 leading-snug">
                  {open.framework && <span className="text-gray-400">{open.framework} → </span>}
                  {open.domain && <span className="text-gray-400">{open.domain} → </span>}
                  {open.competency && <span className="font-semibold">{open.competency} → </span>}
                  {open.skillName}
                </p>
                <p className="text-[9px] text-gray-400 mt-0.5" suppressHydrationWarning>
                  Performed {new Date(open.performedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  {open.location ? ` · ${open.location}` : ""}
                </p>
              </div>

              {/* Quality score — rule-based */}
              {quality && (
                <div className="border-t border-gray-50 pt-2.5 mb-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Evidence Quality Score</p>
                    <span className={`text-sm font-extrabold ${quality.score >= 80 ? "text-green-600" : quality.score >= 50 ? "text-amber-600" : "text-red-500"}`}>
                      {quality.score}%
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {quality.criteria.map(c => (
                      <p key={c.label} className={`text-[10px] ${c.met ? "text-green-700" : "text-gray-400"}`}>
                        {c.met ? "✓" : "○"} {c.label}
                      </p>
                    ))}
                  </div>
                  <p className="text-[8px] text-gray-300 mt-1">Rule-based completeness — not an AI judgement.</p>
                </div>
              )}

              {/* Risk flags */}
              <div className="border-t border-gray-50 pt-2.5 mb-2.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Risk Flags</p>
                <div className="flex flex-col gap-0.5">
                  {flags.map(f => (
                    <p key={f.text} className={`text-[10px] leading-snug ${f.bad ? "text-red-600" : "text-green-700"}`} suppressHydrationWarning>
                      {f.bad ? "🔴" : "🟢"} {f.text}
                    </p>
                  ))}
                </div>
              </div>

              {/* Tabs: Evidence / Checklist / History */}
              <div className="border-t border-gray-50 pt-2.5 mb-2.5">
                <div className="flex gap-1 mb-2">
                  {([["evidence", `Evidence (${open.evidence.length})`], ["checklist", `Checklist (${open.checklist.length})`], ["history", `History (${open.history.length})`]] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)}
                      className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                        tab === key ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"
                      }`}>{label}</button>
                  ))}
                </div>

                {tab === "evidence" && (
                  <div>
                    {open.evidence.length === 0 ? (
                      <p className="text-[10px] text-amber-600">⚠️ No files attached — decide based on the record and your observation.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {open.evidence.map(v => (
                          <button key={v.id} onClick={() => viewEvidence(v.id, v.mime_type, v.file_name)}
                            className="text-left text-[11px] text-indigo-700 hover:underline truncate">
                            {v.mime_type.startsWith("image/") ? "📷" : "📄"} {v.file_name}
                            <span className="text-gray-300"> · {fmtSize(v.size_bytes)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {preview && (
                      <div className="mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed-URL evidence preview */}
                        <img src={preview.url} alt={preview.name} className="w-full rounded-lg border border-gray-100" />
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-[9px] text-gray-400 truncate">{preview.name}</p>
                          <button onClick={() => setPreview(null)} className="text-[9px] text-gray-400 hover:text-gray-600">Close preview</button>
                        </div>
                      </div>
                    )}
                    {open.notes && (
                      <p className="text-[10px] text-gray-500 italic leading-snug mt-2">Learner notes: &ldquo;{open.notes}&rdquo;</p>
                    )}
                  </div>
                )}

                {tab === "checklist" && (
                  open.checklist.length === 0 ? (
                    <p className="text-[10px] text-gray-400">No observable skills defined for this competency{open.competency ? "" : " — the entry isn't linked to one"}.</p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[9px] text-gray-400 mb-1">Reference — observable skills for {open.competency}:</p>
                      {open.checklist.map(s => <p key={s} className="text-[10px] text-gray-600">▫ {s}</p>)}
                    </div>
                  )
                )}

                {tab === "history" && (
                  open.history.length === 0 ? (
                    <p className="text-[10px] text-gray-400">No previous submissions of this skill by {open.nurseName.split(" ")[0]}.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {open.history.map((h, i) => (
                        <p key={i} className="text-[10px] text-gray-600" suppressHydrationWarning>
                          {h.status === "verified" ? "✅" : h.status === "rejected" ? "❌" : "🕐"} {h.status.replace(/_/g, " ")}
                          {" · "}{new Date(h.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          {h.verified_by_name ? ` · by ${h.verified_by_name}` : ""}
                        </p>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Escalation context */}
              {open.status === "escalated" && (
                <div className="bg-purple-50 border border-purple-100 rounded-lg px-3 py-2 mb-2.5">
                  <p className="text-[10px] font-bold text-purple-800">⬆ Escalated{open.escalatedBy ? ` by ${open.escalatedBy}` : ""}</p>
                  {open.escalationReason && <p className="text-[10px] text-purple-900/70 italic leading-snug mt-0.5">&ldquo;{open.escalationReason}&rdquo;</p>}
                </div>
              )}

              {/* AI assist — real handoff */}
              <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
                className="block text-center text-[11px] font-semibold text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 py-2 rounded-lg transition-colors mb-2.5">
                ✨ Ask AI Coach what to check →
              </Link>

              {/* Decision */}
              <div className="border-t border-gray-50 pt-2.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Verification Decision</p>
                {open.status === "escalated" && !isSenior ? (
                  <p className="text-[11px] text-purple-800 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2.5">
                    This entry is escalated — only a <b>senior assessor</b> (or admin) can decide it.
                  </p>
                ) : (
                  <>
                    <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                      placeholder="Assessor comments (visible to learner)…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 mb-2" />
                    {error && <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5 mb-2">{error}</p>}
                    <div className="grid grid-cols-3 gap-1.5">
                      <button onClick={() => decide([open.id], "verified")} disabled={busy}
                        className="text-[11px] font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2 rounded-lg transition-colors">
                        ✓ Verify
                      </button>
                      <button onClick={() => decide([open.id], "changes_requested")} disabled={busy}
                        className="text-[11px] font-semibold text-amber-700 border border-amber-200 hover:bg-amber-50 disabled:opacity-50 py-2 rounded-lg transition-colors">
                        🔄 Return
                      </button>
                      <button onClick={() => decide([open.id], "rejected")} disabled={busy}
                        className="text-[11px] font-semibold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 py-2 rounded-lg transition-colors">
                        ✕ Reject
                      </button>
                    </div>
                    {open.status !== "escalated" && (
                      <button onClick={() => decide([open.id], "escalated")} disabled={busy}
                        className="w-full mt-1.5 text-[11px] font-semibold text-purple-700 border border-purple-200 hover:bg-purple-50 disabled:opacity-50 py-2 rounded-lg transition-colors">
                        ⬆ Escalate to Senior Assessor
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Activity feed */}
              <div className="border-t border-gray-50 pt-2.5 mt-2.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Activity Feed</p>
                <div className="flex flex-col gap-0.5">
                  {open.feed.length === 0 ? (
                    <p className="text-[10px] text-gray-600" suppressHydrationWarning>
                      • Submitted {new Date(open.submittedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  ) : open.feed.map((f, i) => (
                    <p key={i} className="text-[10px] text-gray-600" suppressHydrationWarning>
                      • {FEED_LABEL[f.action] ?? f.action.replace(/_/g, " ")}{f.actor ? ` — ${f.actor}` : ""}
                      <span className="text-gray-300"> · {new Date(f.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
