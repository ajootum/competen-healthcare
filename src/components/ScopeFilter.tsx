"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Real header hospital-scope filter for the executive / quality workspaces. Loads its own options from
// /api/exec-scope, and on change writes the `active_hospital` cookie + refreshes — the server guards
// (qaGuard / hexGuard) re-read the cookie and re-scope every loader. For a single-hospital admin it
// renders an honest static label rather than a non-functional control.
type Opt = { id: string; name: string };

export default function ScopeFilter() {
  const router = useRouter();
  const [state, setState] = useState<{ hospitals: Opt[]; current: string; canScope: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/exec-scope").then(r => r.json()).then(d => setState(d.error ? { hospitals: [], current: "all", canScope: false } : d)).catch(() => setState({ hospitals: [], current: "all", canScope: false }));
  }, []);

  const chip = "inline-flex items-center gap-1.5 text-[12px] border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white";
  if (!state) return <span className={`${chip} text-gray-300`}>🏥 …</span>;

  const name = state.current === "all" ? "All hospitals" : (state.hospitals.find(h => h.id === state.current)?.name ?? "Selected hospital");
  if (!state.canScope) return <span className={`${chip} text-gray-500`} title="Scoped to your hospital">🏥 {name}</span>;

  function set(v: string) {
    document.cookie = `active_hospital=${v};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  }
  return (
    <span className={`${chip} text-gray-700 gap-1 pr-1`}>
      <span aria-hidden>🏥</span>
      <select value={state.current} onChange={e => set(e.target.value)} aria-label="Hospital scope" className="bg-transparent text-[12px] text-gray-700 focus:outline-none cursor-pointer max-w-[180px]">
        <option value="all">All hospitals</option>
        {state.hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
    </span>
  );
}
