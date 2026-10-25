"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The verifier's outcome on one record version (COMPETEN-PROFESSIONAL-PROFILE-01 part B). Posts to
// /api/hq/individual/verification, which re-checks the capability, and migration 451's trigger checks the
// appointment, independence and order again.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const field = "w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]";

export default function VerdictForm({ itemId, userId, methods, revokeOnly = false }: {
  itemId: string; userId: string; methods: readonly (readonly [string, string])[]; revokeOnly?: boolean;
}) {
  const router = useRouter();
  const [event, setEvent] = useState<"verified" | "declined" | "revoked">(revokeOnly ? "revoked" : "verified");
  const [method, setMethod] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/individual/verification", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, userId, event, method: event === "verified" ? method : undefined, validUntil: event === "verified" ? validUntil : undefined, reason }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be recorded. Nothing has changed." }); return; }
      setMsg({ ok: true, text: "Recorded." });
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be recorded. Check your connection." }); } finally { setBusy(false); }
  }

  const ready = event === "verified" ? !!method : reason.trim().length >= 3;
  return (
    <div className="space-y-2">
      {!revokeOnly && (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Outcome</legend>
          {(["verified", "declined"] as const).map(e => (
            <label key={e} className="flex items-center gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <input type="radio" name={`ev-${itemId}`} checked={event === e} onChange={() => setEvent(e)} className="h-4 w-4" />
              {e === "verified" ? "Confirm it" : "Could not confirm it"}
            </label>
          ))}
        </fieldset>
      )}
      {event === "verified" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[12.5px] font-semibold text-gray-700">How it was checked
            <select value={method} onChange={e => setMethod(e.target.value)} className={`${field} mt-1`}>
              <option value="">Choose…</option>
              {methods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-[12.5px] font-semibold text-gray-700">Valid until (optional)
            <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={`${field} mt-1`} />
          </label>
        </div>
      )}
      <label className="block text-[12.5px] font-semibold text-gray-700">{event === "verified" ? "Note (optional)" : "Reason (the person will see it)"}
        <textarea rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className={`${field} mt-1`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !ready} onClick={send}
          className={`${btn} ${event === "revoked" ? "border border-red-300 bg-white text-red-800 hover:bg-red-50" : "bg-teal-700 text-white hover:bg-teal-800"}`}>
          {busy ? "Recording…" : event === "verified" ? "Record as verified" : event === "declined" ? "Record as not verified" : "Revoke the verification"}
        </button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
