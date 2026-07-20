"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";

// Lifecycle + subscription controls for one tenant row (LCP-001 §3/§4).
const LIFECYCLE: Record<string, string[]> = {
  prospect: ["trial", "active", "archived"],
  trial: ["active", "suspended", "archived"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: ["active"],
};

export default function TenantActions({ tenantId, status, plan, plans }: { tenantId: string; status: string; plan: string | null; plans: { code: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const post = async (url: string, body: any) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.ok) { setMsg("✓"); router.refresh(); } else { setMsg(data.error || "failed"); }
    } catch { setMsg("failed"); } finally { setBusy(false); }
  };

  const transitions = LIFECYCLE[status] ?? [];
  const sel = "text-xs border border-gray-200 rounded px-1.5 py-1 bg-white disabled:opacity-50";

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <select className={sel} disabled={busy} value={plan ?? ""} title="Change plan"
        onChange={e => e.target.value && post(`/api/platform/tenants/${tenantId}/subscription`, { planCode: e.target.value })}>
        <option value="" disabled>{plan ?? "set plan"}</option>
        {plans.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
      </select>
      {transitions.length > 0 && (
        <select className={sel} disabled={busy} value="" title="Change lifecycle"
          onChange={e => e.target.value && post(`/api/platform/tenants/${tenantId}/status`, { status: e.target.value })}>
          <option value="">lifecycle…</option>
          {transitions.map(s => <option key={s} value={s}>→ {s}</option>)}
        </select>
      )}
      {msg && <span className={`text-[10px] ${msg === "✓" ? "text-green-600" : "text-red-500"}`}>{msg}</span>}
    </div>
  );
}
