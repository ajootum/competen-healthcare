"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CROSS_EXPERIENCE_FEATURE, CROSS_EXPERIENCE_NOTICE } from "@/lib/individual/scholar/config";

// The person's own choice to let the Scholar assistant read their Professional development needs and plan goals
// (migration 700). OFF until they turn it on. Turning it off works at once, deletes nothing, and is always allowed.

export default function CrossExperienceConsent({ granted, accent }: { granted: boolean; accent: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = CROSS_EXPERIENCE_NOTICE;

  async function choose(grant: boolean) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/scholar/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: CROSS_EXPERIENCE_FEATURE, grant }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: json?.error ?? "Your choice could not be saved. Nothing has changed." }); return; }
      setMsg({ ok: true, text: grant ? "Turned on. Your assistant can now use your development plan when you ask it something." : "Turned off. Your assistant no longer reads your development plan." });
      router.refresh();
    } catch { setMsg({ ok: false, text: "Your choice could not be saved. Check your connection and try again." }); }
    finally { setBusy(false); }
  }

  const btn = "inline-flex min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center justify-center rounded-lg px-4 text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
  return (
    <section aria-labelledby="cx-consent" className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-gray-700">
      <h2 id="cx-consent" className="text-[14px] font-semibold text-gray-900">{n.heading}</h2>
      <p className="mt-1"><span className="font-semibold text-gray-800">Status:</span> {granted ? "On" : "Off"}</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div><p className="font-semibold text-gray-800">What it shares</p><ul className="ml-4 list-disc">{n.shares.map(x => <li key={x}>{x}</li>)}</ul></div>
        <div><p className="font-semibold text-gray-800">What it never shares</p><ul className="ml-4 list-disc">{n.never.map(x => <li key={x}>{x}</li>)}</ul></div>
      </div>
      <p className="mt-2">{n.how}</p>
      <p className="mt-1">{n.off}</p>
      <div className="mt-3">
        {granted
          ? <button type="button" disabled={busy} onClick={() => void choose(false)} className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>{busy ? "Saving…" : "Turn off"}</button>
          : <button type="button" disabled={busy} onClick={() => void choose(true)} className={`${btn} text-white`} style={{ background: accent }}>{busy ? "Saving…" : "Turn on"}</button>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </section>
  );
}
