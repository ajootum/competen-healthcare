"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Record a platform release (LCP-001 §7).
export default function DeployForm() {
  const router = useRouter();
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("stable");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!version.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/platform/deployments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: version.trim(), channel, notes: notes.trim() || null }) });
      const data = await res.json();
      if (data.ok) { setVersion(""); setNotes(""); router.refresh(); } else setMsg(data.error || "failed");
    } catch { setMsg("failed"); } finally { setBusy(false); }
  };
  const field = "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-400";
  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 max-w-md">
      <h3 className="font-semibold text-gray-900">Record a release</h3>
      <div className="flex gap-2">
        <input value={version} onChange={e => setVersion(e.target.value)} placeholder="version e.g. 2026.7.1" className={`${field} flex-1`} required />
        <select value={channel} onChange={e => setChannel(e.target.value)} className={field}>{["stable", "staged", "canary"].map(c => <option key={c} value={c}>{c}</option>)}</select>
      </div>
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="notes (optional)" className={`${field} w-full`} />
      <button type="submit" disabled={busy || !version.trim()} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2">{busy ? "Recording…" : "Record release"}</button>
      {msg && <p className="text-xs text-red-500">{msg}</p>}
    </form>
  );
}
