"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// OSCE Management Centre (client). Live exam operations: builder, lifecycle,
// attendance, station scoring, results matrix, CSV export. Soon-chips mark
// modules with no backing store; the AI station designer is real Claude
// generation the assessor reviews and edits.

export type OsceKpis = {
  active: number; runningToday: number; candidates: number; assessors: number; stations: number;
  completion: number | null; passRate: number | null; alpha: number | null; alphaExam: string | null; missing: number;
};
export type ExamRow = {
  id: string; title: string; programme: string | null; date: string | null; status: string;
  stations: number; candidates: number; expected: number; recorded: number; passRate: number | null; isToday: boolean;
};
export type ExamDetail = {
  id: string; title: string; programme: string | null; date: string | null; status: string; notes: string | null;
  stations: { id: string; no: number; name: string; competency: string | null; assessor: string | null; duration: number; brief: string | null; equipment: string | null; recorded: number }[];
  candidates: { nurseId: string; name: string; status: string; avg: number | null; passed: number; missing: number }[];
  results: { stationId: string; nurseId: string; score: number }[];
  readiness: { label: string; ok: boolean }[];
  readyPct: number;
};
export type ActivityRow = { who: string; action: string; what: string; at: string };
export type PickOption = { id: string; name: string };

const STATUS_UI: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-600",
  published: "bg-blue-100 text-blue-700",
  running:   "bg-green-100 text-green-700",
  completed: "bg-indigo-100 text-indigo-700",
  cancelled: "bg-red-100 text-red-600",
};
const ACTION_LABEL: Record<string, string> = {
  create_osce: "created OSCE", update_osce: "updated OSCE", complete_osce: "completed OSCE",
  record_osce_score: "recorded a score for", ai_osce_design: "drafted a station with AI for",
};
const SCORE_CLS = (v: number) => v >= 3 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600";

type BuilderStation = { name: string; competency_id: string; assessor_id: string; duration: string; brief: string; aiText?: string; aiBusy?: boolean };

export default function OsceCentre({ kpis, rows, detail, nurses, assessors, competencies, activity, hasHospital }: {
  kpis: OsceKpis; rows: ExamRow[]; detail: ExamDetail | null;
  nurses: PickOption[]; assessors: PickOption[]; competencies: PickOption[];
  activity: ActivityRow[]; hasHospital: boolean;
}) {
  const router = useRouter();
  const [showBuilder, setShowBuilder] = useState(false);
  const [title, setTitle] = useState("");
  const [programme, setProgramme] = useState("");
  const [examDate, setExamDate] = useState("");
  const [stations, setStations] = useState<BuilderStation[]>([{ name: "", competency_id: "", assessor_id: "", duration: "10", brief: "" }]);
  const [candSel, setCandSel] = useState<Set<string>>(new Set());
  const [candQuery, setCandQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lifecycleActions, setLifecycleActions] = useState<string[] | null>(null);
  const [scoreStation, setScoreStation] = useState("");
  const [scoreNurse, setScoreNurse] = useState("");
  const [scoreNote, setScoreNote] = useState("");
  const [scoreBusy, setScoreBusy] = useState(false);

  const filteredNurses = useMemo(() => {
    const q = candQuery.trim().toLowerCase();
    return q ? nurses.filter(n => n.name.toLowerCase().includes(q)) : nurses;
  }, [nurses, candQuery]);

  const open = (id: string | null) =>
    router.push(id ? `/assessor/osce?x=${id}` : "/assessor/osce", { scroll: false });

  function setStation(i: number, patch: Partial<BuilderStation>) {
    setStations(prev => prev.map((s, j) => j === i ? { ...s, ...patch } : s));
  }

  async function aiDraft(i: number) {
    const s = stations[i];
    if (!s.name.trim()) { setError("Name the station first, then ask AI for a draft."); return; }
    setStation(i, { aiBusy: true });
    setError(null);
    const res = await fetch("/api/ai/osce", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ station_name: s.name, competency_id: s.competency_id || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.answer) setStation(i, { aiText: d.answer, aiBusy: false });
    else { setError(d.error ?? "AI draft failed"); setStation(i, { aiBusy: false }); }
  }

  async function createExam() {
    setBusy(true); setError(null);
    const res = await fetch("/api/osce/exams", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title, programme, exam_date: examDate || null,
        stations: stations.filter(s => s.name.trim()).map(s => ({
          name: s.name, competency_id: s.competency_id || null, assessor_id: s.assessor_id || null,
          duration_minutes: parseInt(s.duration) || 10, brief: s.brief || (s.aiText ?? ""),
        })),
        candidate_ids: [...candSel],
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setShowBuilder(false);
      setTitle(""); setProgramme(""); setExamDate("");
      setStations([{ name: "", competency_id: "", assessor_id: "", duration: "10", brief: "" }]);
      setCandSel(new Set());
      router.push(`/assessor/osce?x=${d.id}`, { scroll: false });
      router.refresh();
    } else setError(d.error ?? "Could not create the OSCE");
    setBusy(false);
  }

  async function moveStatus(id: string, status: string) {
    if ((status === "cancelled" || status === "completed") &&
        !confirm(status === "completed"
          ? "Complete this OSCE? Results feed the assessment engine and candidates are notified."
          : "Cancel this OSCE?")) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/osce/exams", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setLifecycleActions(d.actions ?? null); router.refresh(); }
    else setError(d.error ?? "Status change failed");
    setBusy(false);
  }

  async function recordScore(score: number) {
    if (!scoreStation || !scoreNurse) { setError("Pick a station and a candidate first."); return; }
    setScoreBusy(true); setError(null);
    const res = await fetch("/api/osce/results", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ station_id: scoreStation, nurse_id: scoreNurse, score, notes: scoreNote }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setScoreNote(""); router.refresh(); }
    else setError(d.error ?? "Could not record the score");
    setScoreBusy(false);
  }

  async function setAttendance(nurseId: string, status: string) {
    if (!detail) return;
    await fetch("/api/osce/candidates", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exam_id: detail.id, nurse_id: nurseId, status }),
    });
    router.refresh();
  }

  const KPI: { label: string; value: string; sub?: string; alert?: boolean }[] = [
    { label: "Active OSCEs", value: String(kpis.active) },
    { label: "Running Today", value: String(kpis.runningToday) },
    { label: "Candidates", value: String(kpis.candidates) },
    { label: "Assessors", value: String(kpis.assessors) },
    { label: "Stations", value: String(kpis.stations) },
    { label: "Completion", value: kpis.completion != null ? `${kpis.completion}%` : "—", sub: kpis.completion == null ? "no live exams" : undefined },
    { label: "Pass Rate", value: kpis.passRate != null ? `${kpis.passRate}%` : "—", sub: kpis.passRate == null ? "no results yet" : undefined },
    { label: "Reliability Index", value: kpis.alpha != null ? kpis.alpha.toFixed(2) : "—", sub: kpis.alpha != null ? `Cronbach α · ${kpis.alphaExam}` : "needs ≥3 complete candidates" },
    { label: "Missing Scores", value: String(kpis.missing), alert: kpis.missing > 0 },
  ];

  return (
    <div className="max-w-[1200px]">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">OSCE Management Centre</h1>
          <p className="text-gray-400 text-sm mt-0.5">Plan, run and score OSCEs — results feed the assessment engine and, after educator validation, the competency passport.</p>
        </div>
        <button onClick={() => setShowBuilder(v => !v)}
          className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
          {showBuilder ? "Close builder" : "＋ New OSCE"}
        </button>
      </div>

      {!hasHospital && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800 mb-5">
          Your account is not linked to a hospital — ask a hospital administrator to link you before running OSCEs.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-9 gap-2 mb-5">
        {KPI.map(k => (
          <div key={k.label} className={`bg-white border rounded-xl px-3 py-2.5 ${k.alert ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>
            <p className={`text-lg font-bold ${k.alert ? "text-red-600" : "text-gray-900"}`}>{k.value}</p>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-tight">{k.label}</p>
            {k.sub && <p className="text-[8px] text-gray-400 mt-0.5">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Tab row — real sections vs soon chips */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">Overview</span>
        {["Stations", "Candidates", "Live OSCE", "Results", "Reports"].map(t => (
          <span key={t} className="text-[11px] text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-1.5" title="Open an exam below to work in this section">{t} ↓</span>
        ))}
        {["Blueprints", "Circuits", "Quality Review"].map(t => (
          <span key={t} className="text-[11px] text-gray-300 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 select-none" title="Not available yet — no backing store">
            {t} <span className="text-[8px] font-bold uppercase">soon</span>
          </span>
        ))}
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>}
      {lifecycleActions && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-[10px] font-bold text-green-800 uppercase tracking-wider mb-1">Automatic workflow</p>
          <ul className="text-xs text-green-700 space-y-0.5">{lifecycleActions.map((a, i) => <li key={i}>✅ {a}</li>)}</ul>
          <button onClick={() => setLifecycleActions(null)} className="text-[10px] text-green-600 hover:underline mt-1">dismiss</button>
        </div>
      )}

      {/* Builder */}
      {showBuilder && (
        <div className="bg-white border border-indigo-200 rounded-xl p-5 mb-5">
          <p className="text-sm font-bold text-gray-900 mb-3">New OSCE</p>
          <div className="grid md:grid-cols-3 gap-3 mb-4">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Exam title *"
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400" />
            <input value={programme} onChange={e => setProgramme(e.target.value)} placeholder="Programme (e.g. BSc Nursing — Year 3)"
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400" />
            <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-600 focus:outline-none focus:border-indigo-400" />
          </div>

          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Stations</p>
          <div className="space-y-3 mb-2">
            {stations.map((s, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-3">
                <div className="grid md:grid-cols-[1fr_1fr_1fr_80px_auto] gap-2">
                  <input value={s.name} onChange={e => setStation(i, { name: e.target.value })} placeholder={`Station ${i + 1} name`}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
                  <select value={s.competency_id} onChange={e => setStation(i, { competency_id: e.target.value })}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
                    <option value="">Link competency (feeds engine)…</option>
                    {competencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={s.assessor_id} onChange={e => setStation(i, { assessor_id: e.target.value })}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
                    <option value="">Examiner…</option>
                    {assessors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <input value={s.duration} onChange={e => setStation(i, { duration: e.target.value })} placeholder="min"
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
                  <div className="flex gap-1">
                    <button onClick={() => aiDraft(i)} disabled={s.aiBusy} title="AI-draft scenario, checklist & equipment (you review and edit)"
                      className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2 hover:bg-indigo-50 disabled:opacity-50">
                      {s.aiBusy ? "…" : "✨ AI"}
                    </button>
                    {stations.length > 1 && (
                      <button onClick={() => setStations(prev => prev.filter((_, j) => j !== i))}
                        className="text-[10px] text-gray-400 border border-gray-200 rounded-lg px-2 hover:text-red-500">×</button>
                    )}
                  </div>
                </div>
                <textarea value={s.brief} onChange={e => setStation(i, { brief: e.target.value })} rows={s.brief ? 3 : 1}
                  placeholder="Station brief / scenario (or use ✨ AI and edit)…"
                  className="mt-2 w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:border-indigo-400" />
                {s.aiText && !s.brief && (
                  <div className="mt-2 bg-indigo-50/60 border border-indigo-100 rounded-lg p-2.5">
                    <p className="text-[11px] text-gray-700 whitespace-pre-wrap max-h-44 overflow-y-auto">{s.aiText}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button onClick={() => setStation(i, { brief: s.aiText ?? "" })}
                        className="text-[10px] font-semibold text-indigo-600 hover:underline">Use as brief</button>
                      <span className="text-[8px] text-gray-400">Generated by Claude — review before use.</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setStations(prev => [...prev, { name: "", competency_id: "", assessor_id: "", duration: "10", brief: "" }])}
            className="text-[11px] font-semibold text-indigo-600 hover:underline mb-4">＋ Add station</button>

          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Candidates ({candSel.size} selected)</p>
          <input value={candQuery} onChange={e => setCandQuery(e.target.value)} placeholder="Search clinicians…"
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 mb-2 w-full md:w-72 focus:outline-none focus:border-indigo-400" />
          <div className="flex flex-wrap gap-1.5 mb-4 max-h-36 overflow-y-auto">
            {filteredNurses.map(n => (
              <button key={n.id}
                onClick={() => setCandSel(prev => { const s = new Set(prev); if (s.has(n.id)) s.delete(n.id); else s.add(n.id); return s; })}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  candSel.has(n.id) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
                {n.name}
              </button>
            ))}
            {!filteredNurses.length && <span className="text-xs text-gray-400">No clinicians match.</span>}
          </div>

          <button onClick={createExam} disabled={busy || !title.trim()}
            className="text-sm font-bold text-white bg-indigo-600 rounded-lg px-5 py-2.5 hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            {busy ? "Creating…" : "Create OSCE (draft)"}
          </button>
        </div>
      )}

      {/* Selected exam detail */}
      {detail && (
        <div className="bg-white border border-indigo-200 rounded-xl p-5 mb-5">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-bold text-gray-900">{detail.title}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${STATUS_UI[detail.status] ?? "bg-gray-100 text-gray-600"}`}>{detail.status}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {detail.programme ?? "No programme"} · {detail.date ?? "no date"} · {detail.stations.length} stations · {detail.candidates.length} candidates
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {detail.status === "draft" && (
                <button onClick={() => moveStatus(detail.id, "published")} disabled={busy}
                  className="text-xs font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">Publish</button>
              )}
              {detail.status === "published" && (
                <button onClick={() => moveStatus(detail.id, "running")} disabled={busy}
                  className="text-xs font-semibold text-white bg-green-600 px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50">▶ Start</button>
              )}
              {detail.status === "running" && (
                <button onClick={() => moveStatus(detail.id, "completed")} disabled={busy}
                  className="text-xs font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">⏹ Complete & process</button>
              )}
              {["draft", "published", "running"].includes(detail.status) && (
                <button onClick={() => moveStatus(detail.id, "cancelled")} disabled={busy}
                  className="text-xs font-semibold text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50">Cancel</button>
              )}
              <a href={`/api/reports/osce?exam=${detail.id}`}
                className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50">⬇ CSV</a>
              <button onClick={() => open(null)} className="text-xs text-gray-400 hover:text-gray-600 px-1">✕ close</button>
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-4">
            <div className="space-y-4 min-w-0">
              {/* Stations */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Stations</p>
                <div className="space-y-1.5">
                  {detail.stations.map(s => (
                    <details key={s.id} className="border border-gray-100 rounded-lg px-3 py-2">
                      <summary className="flex items-center gap-2 cursor-pointer text-xs flex-wrap">
                        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold flex items-center justify-center shrink-0">{s.no}</span>
                        <span className="font-semibold text-gray-800">{s.name}</span>
                        <span className="text-gray-400">{s.duration} min</span>
                        {s.competency && <span className="text-[9px] bg-teal-50 text-teal-700 rounded px-1.5 py-0.5">🎯 {s.competency}</span>}
                        {s.assessor ? <span className="text-[9px] text-gray-400">👤 {s.assessor}</span> : <span className="text-[9px] text-amber-600">no examiner</span>}
                        <span className="flex-1" />
                        <span className="text-[9px] text-gray-400">{s.recorded}/{detail.candidates.length} scored</span>
                      </summary>
                      {(s.brief || s.equipment) && (
                        <div className="mt-2 pl-7 text-[11px] text-gray-600 whitespace-pre-wrap">
                          {s.brief}{s.equipment ? `\n\nEquipment: ${s.equipment}` : ""}
                        </div>
                      )}
                    </details>
                  ))}
                  {!detail.stations.length && <p className="text-xs text-gray-400">No stations yet.</p>}
                </div>
              </div>

              {/* Live scoring */}
              {["published", "running"].includes(detail.status) && (
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Record a station score</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={scoreStation} onChange={e => setScoreStation(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
                      <option value="">Station…</option>
                      {detail.stations.map(s => <option key={s.id} value={s.id}>S{s.no} — {s.name}</option>)}
                    </select>
                    <select value={scoreNurse} onChange={e => setScoreNurse(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
                      <option value="">Candidate…</option>
                      {detail.candidates.filter(c => c.status !== "absent").map(c => <option key={c.nurseId} value={c.nurseId}>{c.name}</option>)}
                    </select>
                    <span className="flex gap-1">
                      {[0, 1, 2, 3, 4, 5, 6].map(v => (
                        <button key={v} onClick={() => recordScore(v)} disabled={scoreBusy}
                          className={`w-7 h-7 rounded text-xs font-bold border transition-colors disabled:opacity-40 ${
                            v >= 3 ? "border-green-200 text-green-700 hover:bg-green-50" : "border-red-200 text-red-600 hover:bg-red-50"}`}>
                          {v}
                        </button>
                      ))}
                    </span>
                    <input value={scoreNote} onChange={e => setScoreNote(e.target.value)} placeholder="Note (optional)"
                      className="flex-1 min-w-[140px] text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-400" />
                  </div>
                  <p className="text-[9px] text-gray-400 mt-1.5">0–6 Benner scale · ≥3 passes · saving again overwrites your earlier score for that station.</p>
                </div>
              )}

              {/* Results matrix */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Results</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[9px] text-gray-400 uppercase tracking-wider">
                        <th className="py-1.5 pr-2">Candidate</th>
                        <th className="py-1.5 pr-2">Attendance</th>
                        {detail.stations.map(s => <th key={s.id} className="py-1.5 pr-1 text-center" title={s.name}>S{s.no}</th>)}
                        <th className="py-1.5 pr-2 text-center">Avg</th>
                        <th className="py-1.5 text-center">Passed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {detail.candidates.map(c => {
                        const scoreOf = new Map(detail.results.filter(r => r.nurseId === c.nurseId).map(r => [r.stationId, r.score]));
                        return (
                          <tr key={c.nurseId}>
                            <td className="py-1.5 pr-2 font-medium text-gray-800">{c.name}</td>
                            <td className="py-1.5 pr-2">
                              {["completed", "cancelled"].includes(detail.status) ? (
                                <span className="text-[10px] text-gray-500 capitalize">{c.status.replace("_", " ")}</span>
                              ) : (
                                <span className="flex gap-1">
                                  {(["checked_in", "absent"] as const).map(st => (
                                    <button key={st} onClick={() => setAttendance(c.nurseId, c.status === st ? "registered" : st)}
                                      className={`text-[9px] px-1.5 py-0.5 rounded border ${
                                        c.status === st
                                          ? st === "absent" ? "bg-red-500 text-white border-red-500" : "bg-green-500 text-white border-green-500"
                                          : "text-gray-400 border-gray-200 hover:border-gray-400"}`}>
                                      {st === "checked_in" ? "in" : "absent"}
                                    </button>
                                  ))}
                                </span>
                              )}
                            </td>
                            {detail.stations.map(s => {
                              const v = scoreOf.get(s.id);
                              return (
                                <td key={s.id} className="py-1.5 pr-1 text-center">
                                  {v != null
                                    ? <span className={`inline-block w-6 rounded text-[10px] font-bold py-0.5 ${SCORE_CLS(v)}`}>{v}</span>
                                    : <span className="text-gray-200">·</span>}
                                </td>
                              );
                            })}
                            <td className="py-1.5 pr-2 text-center font-bold text-gray-800">{c.avg ?? "—"}</td>
                            <td className="py-1.5 text-center text-gray-600">{c.passed}/{detail.stations.length}</td>
                          </tr>
                        );
                      })}
                      {!detail.candidates.length && (
                        <tr><td colSpan={4 + detail.stations.length} className="py-4 text-center text-gray-400">No candidates registered.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Readiness rail */}
            <div className="space-y-3">
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">OSCE Readiness — {detail.readyPct}%</p>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${detail.readyPct}%` }} />
                </div>
                <ul className="space-y-1 text-[11px]">
                  {detail.readiness.map(r => (
                    <li key={r.label} className={`flex items-center gap-1.5 ${r.ok ? "text-gray-700" : "text-gray-400"}`}>
                      <span>{r.ok ? "✅" : "○"}</span>{r.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">On completion</p>
                <ul className="text-[10px] text-gray-500 space-y-1">
                  <li>📝 Station results with linked competencies feed the assessment engine (method: OSCE)</li>
                  <li>🧮 Consensus &amp; rollups recompute</li>
                  <li>🔔 Candidates notified</li>
                  <li>🧾 Audit trail written</li>
                  <li className="text-gray-400">🛂 Passport updates after the educator decision run</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overview grid */}
      <div className="grid lg:grid-cols-3 gap-4 mb-5">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Today&apos;s OSCEs</p>
          {rows.filter(r => r.isToday || r.status === "running").length ? (
            <div className="space-y-2">
              {rows.filter(r => r.isToday || r.status === "running").slice(0, 4).map(r => (
                <button key={r.id} onClick={() => open(r.id)} className="w-full text-left border border-gray-100 rounded-lg px-3 py-2 hover:border-indigo-200 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-800 flex-1 truncate">{r.title}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_UI[r.status]}`}>{r.status}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{r.candidates} candidates · {r.stations} stations{r.programme ? ` · ${r.programme}` : ""}</p>
                </button>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">Nothing scheduled today.</p>}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Recent Activity</p>
          {activity.length ? (
            <ul className="space-y-1.5">
              {activity.map((a, i) => (
                <li key={i} className="text-[11px] text-gray-600">
                  <span className="font-medium text-gray-800">{a.who}</span> {ACTION_LABEL[a.action] ?? a.action} <span className="font-medium">{a.what}</span>
                  <span className="text-gray-300 ml-1" suppressHydrationWarning>{new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No OSCE activity yet.</p>}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Live OSCE Command Centre</p>
          {rows.some(r => r.status === "running") ? (
            <div className="space-y-2">
              {rows.filter(r => r.status === "running").map(r => (
                <button key={r.id} onClick={() => open(r.id)} className="w-full text-left border border-green-200 bg-green-50/50 rounded-lg px-3 py-2 hover:border-green-300 transition-colors">
                  <p className="text-xs font-semibold text-gray-800">{r.title}</p>
                  <div className="h-1.5 bg-white rounded-full overflow-hidden my-1.5">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${r.expected ? Math.round(r.recorded / r.expected * 100) : 0}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-500">{r.recorded}/{r.expected} scores in{r.expected - r.recorded > 0 ? ` · ${r.expected - r.recorded} missing` : " · complete"}</p>
                </button>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No exam is running. Start a published exam to open the live board.</p>}
        </div>
      </div>

      {/* Active OSCEs table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-900">All OSCEs</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[9px] text-gray-400 uppercase tracking-wider bg-gray-50/60">
                <th className="px-4 py-2">OSCE Title</th>
                <th className="px-2 py-2">Programme</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2 text-center">Candidates</th>
                <th className="px-2 py-2 text-center">Stations</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Progress</th>
                <th className="px-2 py-2 text-center">Pass Rate</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{r.title}</td>
                  <td className="px-2 py-2.5 text-gray-500">{r.programme ?? "—"}</td>
                  <td className="px-2 py-2.5 text-gray-500">{r.date ?? "—"}</td>
                  <td className="px-2 py-2.5 text-center text-gray-600">{r.candidates}</td>
                  <td className="px-2 py-2.5 text-center text-gray-600">{r.stations}</td>
                  <td className="px-2 py-2.5"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_UI[r.status]}`}>{r.status}</span></td>
                  <td className="px-2 py-2.5 min-w-[90px]">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${r.expected ? Math.round(r.recorded / r.expected * 100) : 0}%` }} />
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center text-gray-600">{r.passRate != null ? `${r.passRate}%` : "—"}</td>
                  <td className="px-2 py-2.5"><button onClick={() => open(r.id)} className="text-indigo-600 font-semibold hover:underline">Open</button></td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No OSCEs yet — create the first one with ＋ New OSCE.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: the blueprint builder, drag-and-drop circuit designer and quality review/appeals moderation have no backing store yet and are marked soon.
        The Reliability Index is a real Cronbach&apos;s α computed from complete score matrices. Station AI drafts are generated by Claude for assessor review.
        Completing an OSCE feeds the assessment engine; formal outcomes and passport updates follow the educator decision run.
      </p>
    </div>
  );
}
