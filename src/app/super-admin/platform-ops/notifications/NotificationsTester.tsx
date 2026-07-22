"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// POS-001H — fire a test notification across every channel and show the
// per-channel delivery result inline.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DOT: Record<string, string> = { sent: "bg-green-500", failed: "bg-rose-500", skipped: "bg-gray-300", queued: "bg-amber-500" };
const TONE: Record<string, string> = { sent: "text-green-600", failed: "text-rose-600", skipped: "text-gray-400", queued: "text-amber-600" };

export default function NotificationsTester() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

  async function send() {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/notifications/test", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setResult(j.deliveries ?? []); router.refresh(); }
      else setErr(j.error ?? "Failed");
    } catch { setErr("Request failed"); }
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">Test Delivery</h2>
        <button onClick={send} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2 disabled:opacity-60">{busy ? "Sending…" : "Send test to me"}</button>
      </div>
      {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{err}</p>}
      {result && (
        <div className="space-y-1.5">
          {result.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[d.status] ?? "bg-gray-300"}`} />
              <span className="text-gray-700 capitalize w-20">{d.channel.replace("_", "-")}</span>
              <span className={`capitalize font-medium ${TONE[d.status] ?? "text-gray-500"}`}>{d.status}</span>
              <span className="text-[11px] text-gray-400 ml-auto truncate">{d.error ?? (d.provider ? `via ${d.provider}` : "")}</span>
            </div>
          ))}
        </div>
      )}
      {!result && !err && <p className="text-[11px] text-gray-400">Sends across every channel and records the per-channel result. In-app delivers; provider-less channels report an honest skip.</p>}
    </div>
  );
}
