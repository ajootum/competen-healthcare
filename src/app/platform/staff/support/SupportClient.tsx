"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Ticket = { id: string; subject: string; status: string; priority: string; tenant_name: string | null; requester_name: string | null; created_at: string | null };
const statusCls: Record<string, string> = { open: "bg-blue-100 text-blue-700", pending: "bg-amber-100 text-amber-700", resolved: "bg-green-100 text-green-700", closed: "bg-gray-100 text-gray-500" };
const prioCls: Record<string, string> = { urgent: "text-red-600", high: "text-amber-600", normal: "text-gray-500", low: "text-gray-400" };
const NEXT: Record<string, string[]> = { open: ["pending", "resolved", "closed"], pending: ["resolved", "closed"], resolved: ["closed", "open"], closed: ["open"] };

export default function SupportClient({ tickets, tenants }: { tickets: Ticket[]; tenants: { id: string; name: string }[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/platform/support/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: subject.trim(), tenantId: tenantId || null, priority }) });
      if ((await res.json()).ok) { setSubject(""); setTenantId(""); router.refresh(); }
    } finally { setBusy(false); }
  };
  const setStatus = async (id: string, status: string) => {
    await fetch("/api/platform/support/tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    router.refresh();
  };

  const field = "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-400";
  return (
    <div className="grid lg:grid-cols-3 gap-5 items-start">
      <form onSubmit={create} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-gray-900">New ticket</h3>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className={`${field} w-full`} required />
        <select value={tenantId} onChange={e => setTenantId(e.target.value)} className={`${field} w-full`}>
          <option value="">No tenant</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} className={`${field} w-full`}>
          {["low", "normal", "high", "urgent"].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="submit" disabled={busy || !subject.trim()} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2">{busy ? "Creating…" : "Create ticket"}</button>
      </form>

      <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Queue</h3>
        {tickets.length === 0 && <p className="text-sm text-gray-400">No tickets. Create one to get started.</p>}
        <div className="divide-y divide-gray-100">
          {tickets.map(t => (
            <div key={t.id} className="py-2.5 flex items-center gap-3 text-sm">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusCls[t.status]}`}>{t.status}</span>
              <span className="font-medium text-gray-800 truncate flex-1">{t.subject}</span>
              <span className={`text-[10px] uppercase ${prioCls[t.priority]}`}>{t.priority}</span>
              {t.tenant_name && <span className="text-xs text-gray-400 hidden md:inline">{t.tenant_name}</span>}
              <select className="text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white" value="" onChange={e => e.target.value && setStatus(t.id, e.target.value)}>
                <option value="">→</option>
                {(NEXT[t.status] ?? []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
