"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Platform Operations header — title + last-updated + a real manual refresh.
export default function PlatformOpsHeader({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const time = new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Operations</h1>
        <p className="text-sm text-gray-500">Operate, monitor and optimize the Competen platform.</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="tabular-nums">Last updated: {time}</span>
        <button onClick={() => { setBusy(true); router.refresh(); setTimeout(() => setBusy(false), 800); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50">
          <span className={busy ? "animate-spin" : ""}>↻</span> Refresh
        </button>
      </div>
    </div>
  );
}
