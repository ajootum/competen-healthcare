"use client";

import { useRouter } from "next/navigation";

// WCE-003 organisation-scope selector (§9). Platform + Hospital scopes are wired (matching the WCE-001
// Designer's real coverage); Enterprise / Unit / Role / User are resolver-supported but honest next-phase
// selectors. The active scope stays visible throughout the composer.
export default function ScopePicker({ scopeType, scopeRef, hospitals }: { scopeType: string; scopeRef: string | null; hospitals: { id: string; name: string }[] }) {
  const router = useRouter();
  const go = (type: string, ref: string | null) => router.push(`/super-admin/platform-ops/composer?scope=${type}${ref ? `&ref=${ref}` : ""}`);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500">Scope:</span>
      <button onClick={() => go("platform", null)} className={`text-xs rounded-lg px-3 py-1.5 font-medium ${scopeType === "platform" ? "bg-teal-700 text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>Platform</button>
      <select value={scopeType === "hospital" ? (scopeRef ?? "") : ""} onChange={e => e.target.value ? go("hospital", e.target.value) : go("platform", null)}
        className={`text-xs rounded-lg px-2.5 py-1.5 border ${scopeType === "hospital" ? "border-teal-300 bg-teal-50 text-teal-800" : "border-gray-200 text-gray-600"}`}>
        <option value="">Hospital…</option>
        {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <span className="text-[10px] text-gray-500">Enterprise · Unit · Role · User scopes — next-phase</span>
    </div>
  );
}
