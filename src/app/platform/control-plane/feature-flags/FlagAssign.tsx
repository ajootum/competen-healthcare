"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Set a scoped assignment for one feature flag (LCP-001 §9).
export default function FlagAssign({ flagKey }: { flagKey: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState("tenant");
  const [scopeRef, setScopeRef] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/platform/flags/assign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagKey, scopeType, scopeRef: scopeType === "global" ? null : scopeRef.trim(), enabled }),
      });
      const data = await res.json();
      if (data.ok) { setMsg("saved"); setScopeRef(""); router.refresh(); setTimeout(() => setOpen(false), 600); }
      else setMsg(data.error || "failed");
    } catch { setMsg("failed"); } finally { setBusy(false); }
  };

  const field = "text-xs border border-gray-200 rounded px-2 py-1 bg-white";
  if (!open) return <button onClick={() => setOpen(true)} className="text-[11px] text-violet-600 hover:underline shrink-0">+ assign</button>;
  return (
    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
      <select className={field} value={scopeType} onChange={e => setScopeType(e.target.value)}>
        {["tenant", "plan", "country", "cohort", "global"].map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {scopeType !== "global" && <input className={`${field} w-32`} value={scopeRef} onChange={e => setScopeRef(e.target.value)} placeholder={scopeType === "tenant" ? "tenant id" : scopeType === "plan" ? "plan code" : scopeType === "country" ? "ISO-2" : "cohort"} />}
      <select className={field} value={enabled ? "on" : "off"} onChange={e => setEnabled(e.target.value === "on")}>
        <option value="on">on</option><option value="off">off</option>
      </select>
      <button onClick={submit} disabled={busy || (scopeType !== "global" && !scopeRef.trim())} className="text-[11px] font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded px-2 py-1">save</button>
      <button onClick={() => setOpen(false)} className="text-[11px] text-gray-400">cancel</button>
      {msg && <span className={`text-[10px] ${msg === "saved" ? "text-green-600" : "text-red-500"}`}>{msg}</span>}
    </div>
  );
}
