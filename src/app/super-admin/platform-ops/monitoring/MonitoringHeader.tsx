"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Monitoring header — breadcrumb, title, last-updated and a real manual refresh
// (router.refresh re-runs the live health probes server-side).
export default function MonitoringHeader({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const time = new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Monitoring &amp; Operations</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2 mt-0.5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitoring &amp; Operations</h1>
          <p className="text-sm text-gray-500">Live platform health, active alerts, event stream and operational jobs.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="tabular-nums">Probed at {time}</span>
          <button onClick={() => { setBusy(true); router.refresh(); setTimeout(() => setBusy(false), 800); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50">
            <span className={busy ? "animate-spin" : ""}>↻</span> Re-run probes
          </button>
        </div>
      </div>
    </div>
  );
}
