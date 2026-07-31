"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cardClass } from "@/components/ui/primitives";

// POS-001H — fire a test notification across every channel and show the
// per-channel delivery result inline.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DOT: Record<string, string> = { sent: "bg-[var(--cmp-color-success)]", failed: "bg-[var(--cmp-color-error)]", skipped: "bg-gray-300", queued: "bg-[var(--cmp-color-warning)]" };
const TONE: Record<string, string> = { sent: "text-[var(--cmp-text-success)]", failed: "text-[var(--cmp-text-error)]", skipped: "text-gray-400", queued: "text-[var(--cmp-text-warning)]" };

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
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">Test Delivery</h2>
        <button onClick={send} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2 disabled:opacity-60">{busy ? "Sending…" : "Send test to me"}</button>
      </div>
      {err && <p className="text-xs text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2 mb-2">{err}</p>}
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
