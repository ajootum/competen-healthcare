"use client";
import { useState } from "react";

type Log = {
  id: string;
  activity_type: string;
  title: string;
  hours: number;
  cpd_points: number;
  activity_date: string;
  verified: boolean;
};

const activityIcons: Record<string, string> = {
  course:       "📚",
  workshop:     "🔧",
  conference:   "🎤",
  self_study:   "📖",
  simulation:   "🏥",
  osce:         "📋",
};

export default function CPDClient({ initialLogs, totalHours, targetHours }: {
  initialLogs: Log[]; totalHours: number; targetHours: number | null;
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [total, setTotal] = useState(totalHours);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    activity_type: "course",
    title: "",
    hours: "",
    cpd_points: "1",
    activity_date: new Date().toISOString().split("T")[0],
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSubmitError(null);
    const res = await fetch("/api/cpd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setSubmitError(err.error ?? "Could not log the activity. Please try again.");
    }
    if (res.ok) {
      const newLog: Log = {
        id: crypto.randomUUID(),
        activity_type: form.activity_type,
        title: form.title,
        hours: parseFloat(form.hours),
        cpd_points: parseInt(form.cpd_points),
        activity_date: form.activity_date,
        verified: false,
      };
      setLogs(prev => [newLog, ...prev]);
      setTotal(t => t + parseFloat(form.hours));
      setForm({ activity_type: "course", title: "", hours: "", cpd_points: "1", activity_date: new Date().toISOString().split("T")[0] });
      setShowForm(false);
    }
    setLoading(false);
  }

  // Annual target is org-configured (hospitals.cpd_target_hours) — never invented.
  const pct = targetHours ? Math.min(100, Math.round((total / targetHours) * 100)) : null;

  return (
    <div>
      {/* Progress toward target */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="font-semibold text-gray-900">Annual CPD Progress</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {targetHours ? `Target: ${targetHours} hours/year` : "No annual target set by your organisation yet"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-teal-600">{total.toFixed(1)}</p>
            <p className="text-xs text-gray-400">hours logged</p>
          </div>
        </div>
        {pct !== null && targetHours && (
          <>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-gray-400">{pct}% complete</span>
              <span className="text-xs text-gray-400">{Math.max(0, targetHours - total).toFixed(1)}h remaining</span>
            </div>
          </>
        )}
      </div>

      {/* Log button */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-900 text-sm">Activity Log</h2>
        <button onClick={() => setShowForm(true)}
          className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors">
          + Log Activity
        </button>
      </div>

      {/* Log form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-teal-200 p-5 mb-4 flex flex-col gap-4">
          <h3 className="font-semibold text-gray-900 text-sm">New CPD Activity</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Activity Type</label>
              <select value={form.activity_type} onChange={e => setForm({ ...form, activity_type: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 bg-white">
                {["course", "workshop", "conference", "self_study", "simulation", "osce"].map(t => (
                  <option key={t} value={t}>{t.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Date</label>
              <input type="date" value={form.activity_date} onChange={e => setForm({ ...form, activity_date: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Title / Description</label>
            <input required type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. BLS refresher course"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Hours</label>
              <input required type="number" min="0.5" step="0.5" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })}
                placeholder="2.0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">CPD Points</label>
              <input type="number" min="1" value={form.cpd_points} onChange={e => setForm({ ...form, cpd_points: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
            </div>
          </div>
          {submitError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{submitError}</p>
          )}
          <div className="flex gap-3">
            <button type="submit" disabled={loading}
              className="bg-teal-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60 transition-colors">
              {loading ? "Saving…" : "Save Activity"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="border border-gray-200 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:border-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Logs list */}
      {logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400">
          <p className="text-3xl mb-2">⏱️</p>
          <p>No CPD activities logged yet.</p>
          <p className="text-xs mt-1">Click &quot;Log Activity&quot; to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-4 p-4">
              <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-lg shrink-0">
                {activityIcons[log.activity_type] ?? "📄"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{log.title}</p>
                <p className="text-xs text-gray-400 capitalize">{log.activity_type.replace("_", " ")} · {log.activity_date}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-teal-600">{log.hours}h</p>
                <p className="text-xs text-gray-400">{log.cpd_points} pts</p>
              </div>
              {log.verified && (
                <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded font-medium">Verified</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
