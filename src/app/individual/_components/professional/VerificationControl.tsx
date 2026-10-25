"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls } from "./forms";

// The person's verification actions on one record version (COMPETEN-PROFESSIONAL-PROFILE-01 part B): ask
// Competen to verify it, withdraw the request, or dispute an outcome. Optional: nothing waits on it.

const small = "inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50";

export default function VerificationControl({ itemId, actions, accent }: { itemId: string; actions: ("request" | "withdraw" | "dispute")[]; accent: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(action: "request" | "withdraw" | "dispute") {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/verification", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, action, reason: action === "dispute" ? reason : undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That did not work. Try again." }); return; }
      setMsg({ ok: true, text: action === "request" ? "Sent to Competen for verification." : action === "withdraw" ? "Request withdrawn." : "Dispute sent." });
      setDisputing(false); setReason("");
      router.refresh();
    } catch { setMsg({ ok: false, text: "That did not work. Check your connection." }); } finally { setBusy(false); }
  }

  if (!actions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {actions.includes("request") && <button type="button" disabled={busy} className={small} style={{ color: accent }} onClick={() => act("request")}>Ask Competen to verify</button>}
      {actions.includes("withdraw") && <button type="button" disabled={busy} className={small} onClick={() => act("withdraw")}>Withdraw verification request</button>}
      {actions.includes("dispute") && !disputing && <button type="button" disabled={busy} className={small} onClick={() => setDisputing(true)}>Dispute the outcome</button>}
      {disputing && (
        <div className="w-full space-y-2">
          <label htmlFor={`dispute-${itemId}`} className="block text-[12.5px] font-semibold text-gray-800">Why do you dispute it?</label>
          <textarea id={`dispute-${itemId}`} rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || reason.trim().length < 3} className={small} onClick={() => act("dispute")}>Send dispute</button>
            <button type="button" className={small} onClick={() => setDisputing(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</span>}
    </div>
  );
}
