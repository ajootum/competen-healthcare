"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Simulation & OSCE Centre (client). Live sessions, scheduling, scenario
// library (curated briefs + governed cases), real results and analytics, and
// an AI scenario designer (Claude, assessor-reviewed). The live console is the
// Conduct Assessment cockpit with the session's method prefilled.

export type SimKpis = { upcoming: number; pendingScoring: number; completedToday: number; awaitingValidation: number; library: number; osceActive: number };
export type SimSession = { id: string; nurseId: string; nurse: string; assessor: string; mine: boolean; at: string; location: string | null; note: string | null };
export type SimResult = { id: string; nurse: string; competency: string; score: number; at: string | null; validated: boolean };
export type LibraryBrief = { id: number; title: string; category: string; difficulty: string; duration: string; patient: string; complaint: string; vitals: Record<string, string>; skills: string[] };
export type LibraryCase = { id: string; title: string; difficulty: string | null; status: string; cpu: string | null };
export type SimAnalytics = { sims30: number; passRate30: number | null; avg30: number | null; gaps: { name: string; fails: number }[] };
export type PickOption = { id: string; name: string };

const DIFF_CLS: Record<string, string> = {
  Easy: "bg-green-100 text-green-700", Medium: "bg-amber-100 text-amber-700", Hard: "bg-red-100 text-red-600",
  beginner: "bg-green-100 text-green-700", intermediate: "bg-amber-100 text-amber-700", advanced: "bg-red-100 text-red-600",
};

export default function SimCentre({ kpis, upcoming, overdue, results, briefs, cases, analytics, nurses, competencies, hasHospital }: {
  kpis: SimKpis; upcoming: SimSession[]; overdue: SimSession[]; results: SimResult[];
  briefs: LibraryBrief[]; cases: LibraryCase[]; analytics: SimAnalytics;
  nurses: PickOption[]; competencies: PickOption[]; hasHospital: boolean;
}) {
  const router = useRouter();
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedNurse, setSchedNurse] = useState("");
  const [schedAt, setSchedAt] = useState("");
  const [schedLocation, setSchedLocation] = useState("Sim Lab");
  const [schedNote, setSchedNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [openBrief, setOpenBrief] = useState<number | null>(null);
  const [aiName, setAiName] = useState("");
  const [aiComp, setAiComp] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);

  function scheduleFor(title: string) {
    setSchedNote(title);
    setSchedOpen(true);
    document.getElementById("sim-schedule")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function createSession() {
    if (!schedNurse || !schedAt) { setError("Pick a learner and a date/time."); return; }
    setBusy(true); setError(null); setOk(null);
    const res = await fetch("/api/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nurse_id: schedNurse, method: "simulation",
        scheduled_for: new Date(schedAt).toISOString(),
        location: schedLocation.trim() || null, note: schedNote.trim() || null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setOk("Session scheduled — the learner has been notified.");
      setSchedNurse(""); setSchedAt(""); setSchedNote("");
      router.refresh();
    } else setError(d.error ?? "Could not schedule the session");
    setBusy(false);
  }

  async function cancelSession(id: string) {
    if (!confirm("Cancel this simulation session?")) return;
    await fetch("/api/schedule", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "cancelled" }),
    });
    router.refresh();
  }

  async function aiDraft() {
    if (!aiName.trim()) { setError("Name the scenario first."); return; }
    setAiBusy(true); setError(null);
    const res = await fetch("/api/ai/simulation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_name: aiName, competency_id: aiComp || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.answer) setAiText(d.answer);
    else setError(d.error ?? "AI draft failed");
    setAiBusy(false);
  }

  const KPI: { label: string; value: string; sub?: string; href?: string; alert?: boolean }[] = [
    { label: "Upcoming Sessions", value: String(kpis.upcoming) },
    { label: "Pending Scoring", value: String(kpis.pendingScoring), sub: "past-due sessions", alert: kpis.pendingScoring > 0 },
    { label: "Completed Today", value: String(kpis.completedToday) },
    { label: "Validation Required", value: String(kpis.awaitingValidation), sub: "awaiting educator" },
    { label: "Scenario Library", value: String(kpis.library) },
    { label: "Active OSCEs", value: String(kpis.osceActive), href: "/assessor/osce" },
  ];

  const fmtAt = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="max-w-[1150px]">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Simulation &amp; OSCE Centre</h1>
          <p className="text-gray-400 text-sm mt-0.5">Assess, validate and advance clinical competence through simulation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/simulation" className="text-xs font-semibold text-gray-600 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            Learner Practice Lab ↗
          </Link>
          <button onClick={() => { setSchedOpen(v => !v); setOk(null); }}
            className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            {schedOpen ? "Close scheduler" : "＋ Schedule Simulation"}
          </button>
        </div>
      </div>

      {!hasHospital && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800 mb-5">
          Your account is not linked to a hospital — ask a hospital administrator to link you before running simulations.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-4">
        {KPI.map(k => {
          const inner = (
            <>
              <p className={`text-lg font-bold ${k.alert ? "text-red-600" : "text-gray-900"}`}>{k.value}</p>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-tight">{k.label}</p>
              {k.sub && <p className="text-[8px] text-gray-400 mt-0.5">{k.sub}</p>}
              {k.href && <p className="text-[8px] text-indigo-500 mt-0.5">open →</p>}
            </>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} className={`bg-white border rounded-xl px-3 py-2.5 hover:border-indigo-300 transition-colors ${k.alert ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>{inner}</Link>
          ) : (
            <div key={k.label} className={`bg-white border rounded-xl px-3 py-2.5 ${k.alert ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>{inner}</div>
          );
        })}
      </div>

      {/* Soon chips */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {["Standardized Patients", "Equipment & Resources", "Moderation", "Recording Review (AI Co-Assessor)"].map(t => (
          <span key={t} className="text-[11px] text-gray-300 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 select-none" title="Not available yet — no backing store">
            {t} <span className="text-[8px] font-bold uppercase">soon</span>
          </span>
        ))}
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>}
      {ok && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">✓ {ok}</p>}

      {/* Scheduler */}
      {schedOpen && (
        <div id="sim-schedule" className="bg-white border border-indigo-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-bold text-gray-900 mb-3">Schedule a simulation session</p>
          <div className="grid md:grid-cols-4 gap-2 mb-2">
            <select value={schedNurse} onChange={e => setSchedNurse(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
              <option value="">Learner…</option>
              {nurses.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <input type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 text-gray-600 focus:outline-none focus:border-indigo-400" />
            <input value={schedLocation} onChange={e => setSchedLocation(e.target.value)} placeholder="Location"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
            <input value={schedNote} onChange={e => setSchedNote(e.target.value)} placeholder="Scenario / note"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
          </div>
          <button onClick={createSession} disabled={busy}
            className="text-xs font-bold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            {busy ? "Scheduling…" : "Schedule session"}
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        {/* Sessions */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Upcoming Simulation Sessions</p>
          {upcoming.length ? (
            <div className="space-y-2">
              {upcoming.map(s => (
                <div key={s.id} className="border border-gray-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-800 flex-1">{s.nurse}</span>
                    {s.mine && (
                      <Link href={`/assessor/assess?nurse=${s.nurseId}&s=${s.id}`}
                        className="text-[10px] font-bold text-white bg-indigo-600 px-2.5 py-1 rounded-lg hover:bg-indigo-700">▶ Start</Link>
                    )}
                    <button onClick={() => cancelSession(s.id)} className="text-[10px] text-gray-300 hover:text-red-500">✕</button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5" suppressHydrationWarning>
                    {fmtAt(s.at)} · {s.location ?? "no location"} · {s.assessor}{s.note ? ` · ${s.note}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No simulation sessions scheduled.</p>}

          {overdue.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1.5">Pending scoring (past due)</p>
              {overdue.map(s => (
                <div key={s.id} className="flex items-center gap-2 text-[11px] text-gray-600 py-1">
                  <span className="flex-1">{s.nurse} <span className="text-gray-400" suppressHydrationWarning>· {fmtAt(s.at)}</span></span>
                  {s.mine && (
                    <Link href={`/assessor/assess?nurse=${s.nurseId}&s=${s.id}`} className="text-indigo-600 font-semibold hover:underline">Score now</Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent results */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Recent Simulation Results</p>
          {results.length ? (
            <div className="space-y-1.5">
              {results.map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[11px]">
                  <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${r.score >= 3 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>{r.score}</span>
                  <span className="text-gray-800 font-medium truncate">{r.nurse}</span>
                  <span className="text-gray-400 truncate flex-1">{r.competency}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${r.validated ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"}`}>
                    {r.validated ? "validated" : "awaiting"}
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No simulation assessments recorded yet.</p>}
          <p className="text-[9px] text-gray-400 mt-2.5">Validation is the educator decision run — validated results update the Competency Passport automatically.</p>
        </div>

        {/* Analytics */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Performance (Last 30 Days)</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div><p className="text-lg font-bold text-gray-900">{analytics.sims30}</p><p className="text-[9px] text-gray-400 uppercase font-bold">Sims scored</p></div>
            <div><p className="text-lg font-bold text-gray-900">{analytics.passRate30 != null ? `${analytics.passRate30}%` : "—"}</p><p className="text-[9px] text-gray-400 uppercase font-bold">Pass rate</p></div>
            <div><p className="text-lg font-bold text-gray-900">{analytics.avg30 ?? "—"}</p><p className="text-[9px] text-gray-400 uppercase font-bold">Avg score</p></div>
          </div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Competency Gaps (failing sims)</p>
          {analytics.gaps.length ? (
            <ul className="space-y-1">
              {analytics.gaps.map(g => (
                <li key={g.name} className="flex items-center gap-2 text-[11px] text-gray-600">
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="text-[9px] font-bold bg-red-50 text-red-600 rounded px-1.5 py-0.5">{g.fails} fail{g.fails === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No failing simulation scores on record.</p>}
        </div>
      </div>

      {/* Library */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <p className="text-sm font-bold text-gray-900">Simulation Library</p>
          <p className="text-[10px] text-gray-400">{briefs.length} curated briefs · {cases.length} governed case stud{cases.length === 1 ? "y" : "ies"}</p>
        </div>
        <div className="grid md:grid-cols-2 gap-2 mb-3">
          {briefs.map(b => (
            <div key={b.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setOpenBrief(openBrief === b.id ? null : b.id)} className="text-xs font-semibold text-gray-800 text-left flex-1 hover:text-indigo-700">
                  {b.title}
                </button>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${DIFF_CLS[b.difficulty] ?? "bg-gray-100 text-gray-600"}`}>{b.difficulty}</span>
                <span className="text-[9px] text-gray-400">{b.duration}</span>
                <button onClick={() => scheduleFor(b.title)}
                  className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2 py-0.5 hover:bg-indigo-50">Schedule</button>
              </div>
              {openBrief === b.id && (
                <div className="mt-2 text-[11px] text-gray-600 space-y-1">
                  <p><span className="font-semibold">Patient:</span> {b.patient}</p>
                  <p><span className="font-semibold">Presentation:</span> {b.complaint}</p>
                  <p><span className="font-semibold">Vitals:</span> {Object.entries(b.vitals).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
                  <p><span className="font-semibold">Skills:</span> {b.skills.join(", ")}</p>
                </div>
              )}
            </div>
          ))}
        </div>
        {cases.length > 0 && (
          <>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Governed case studies</p>
            <div className="flex flex-wrap gap-1.5">
              {cases.map(c => (
                <button key={c.id} onClick={() => scheduleFor(c.title)} title="Schedule a session on this case"
                  className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-indigo-300 transition-colors">
                  {c.title}{c.cpu ? ` · ${c.cpu}` : ""}{c.difficulty ? ` · ${c.difficulty}` : ""}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* AI scenario designer */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <p className="text-sm font-bold text-gray-900 mb-1">✨ AI Scenario Designer</p>
        <p className="text-[10px] text-gray-400 mb-2.5">Claude drafts a scenario grounded in governed competency content — you review and edit before use. It never scores or replaces assessor judgement.</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={aiName} onChange={e => setAiName(e.target.value)} placeholder="Scenario name (e.g. Post-partum haemorrhage)"
            className="flex-1 min-w-[200px] text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
          <select value={aiComp} onChange={e => setAiComp(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400 max-w-[260px]">
            <option value="">Link competency (optional)…</option>
            {competencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={aiDraft} disabled={aiBusy}
            className="text-xs font-bold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {aiBusy ? "Drafting…" : "Draft scenario"}
          </button>
        </div>
        {aiText && (
          <div className="mt-3 bg-indigo-50/60 border border-indigo-100 rounded-lg p-3">
            <p className="text-[11px] text-gray-700 whitespace-pre-wrap max-h-72 overflow-y-auto">{aiText}</p>
            <p className="text-[8px] text-gray-400 mt-1.5">Generated by Claude — review before use in assessment.</p>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-400">
        Honest scope: the live assessment console is the Conduct Assessment cockpit (Start opens it with the session linked, method simulation);
        evidence captured in-session lands in the Evidence Validation Centre. Standardized-patient management, equipment inventory,
        recording storage/AI recording review and score moderation have no backing store yet and are marked soon.
        OSCE examinations run in the <Link href="/assessor/osce" className="text-indigo-500 hover:underline">OSCE Management Centre</Link>.
      </p>
    </div>
  );
}
