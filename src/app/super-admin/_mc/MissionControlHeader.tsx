"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Mission Control header (MC-001) — title block plus a REAL auto-refresh control
// that re-fetches the server-rendered dashboard on an interval via router.refresh().
export default function MissionControlHeader({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!auto) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(() => { setRefreshing(true); router.refresh(); setTimeout(() => setRefreshing(false), 800); }, 30000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, router]);

  const t = new Date(generatedAt);
  const time = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-gray-900">Competen Mission Control</h1>
          <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2.5 py-0.5">Super Admin Workspace</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">Operate, monitor and optimise the entire Competen platform</p>
      </div>
      <div className="flex flex-col items-end gap-1.5 text-xs">
        <span className="text-gray-400 tabular-nums">Last updated: {time}</span>
        <button onClick={() => setAuto(a => !a)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors ${auto ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-100 text-gray-500 border border-gray-200"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${auto ? (refreshing ? "bg-green-400 animate-ping" : "bg-green-500") : "bg-gray-400"}`} />
          Auto-refresh: {auto ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}
