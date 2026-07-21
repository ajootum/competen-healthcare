"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Executive context bar (MC-004 §3). Time range and auto-refresh are REAL and
// drive the dashboard; the remaining CPF-001 dimensions (Enterprise / Region /
// Environment / Compare / Saved Views) are shown as an honest placeholder until
// the Dashboard Context & Reporting Framework (CPF-001) is provisioned.
const RANGES = [{ v: 7, l: "Last 7 Days" }, { v: 30, l: "Last 30 Days" }, { v: 90, l: "Last 90 Days" }];
const chip = "flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 min-w-[9rem]";
const lab = "text-[9px] font-semibold text-gray-400 uppercase tracking-wide";

export default function ExecutiveContextBar({ rangeDays, generatedAt }: { rangeDays: number; generatedAt: string }) {
  const router = useRouter();
  const [auto, setAuto] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!auto) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(() => { setRefreshing(true); router.refresh(); setTimeout(() => setRefreshing(false), 800); }, 30000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auto, router]);

  const time = new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className={chip}>
        <span className={lab}>Time Range</span>
        <select value={rangeDays} onChange={e => router.push(`/super-admin/command-centre?range=${e.target.value}`)} className="text-sm font-medium text-gray-800 bg-transparent focus:outline-none -ml-0.5">
          {RANGES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
      </label>
      <div className={`${chip} opacity-60`} title="Activates with CPF-001 (Dashboard Context Framework)">
        <span className={lab}>Enterprise · Region · Compare</span>
        <span className="text-sm font-medium text-gray-400">All · CPF-001</span>
      </div>
      <div className="ml-auto flex items-end gap-2">
        <span className="text-[11px] text-gray-400 pb-1.5 tabular-nums">Updated {time}</span>
        <button onClick={() => setAuto(a => !a)}
          className={`flex flex-col gap-0.5 rounded-lg border px-3 py-1.5 ${auto ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"}`}>
          <span className={lab}>Auto Refresh</span>
          <span className={`text-sm font-medium inline-flex items-center gap-1.5 ${auto ? "text-green-700" : "text-gray-500"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${auto ? (refreshing ? "bg-green-400 animate-ping" : "bg-green-500") : "bg-gray-400"}`} />{auto ? "Live" : "Off"}
          </span>
        </button>
      </div>
    </div>
  );
}
