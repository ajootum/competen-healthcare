"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { focusRing, primaryBtn } from "../chrome";

// The person's two reminder switches (migration 374). In-app is on by default, email is off until the
// person opts in. They are independent: either can be on or off without the other. Saved together.

export default function ReminderSettings({ accent, inApp, email, horizonDays }: { accent: string; inApp: boolean; email: boolean; horizonDays: number }) {
  const router = useRouter();
  const [a, setA] = useState(inApp);
  const [e, setE] = useState(email);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/reminders", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inApp: a, email: e }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "Your reminder settings could not be saved." }); return; }
      setMsg({ ok: true, text: "Reminder settings saved." });
      router.refresh();
    } catch { setMsg({ ok: false, text: "Your reminder settings could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  const box = `mt-0.5 h-5 w-5 shrink-0 rounded border-gray-400 ${focusRing}`;
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 pointer-coarse:min-h-[var(--cmp-touch-min)]">
        <input type="checkbox" checked={a} onChange={ev => setA(ev.target.checked)} className={box} style={{ accentColor: accent }} />
        <span>
          <span className="block text-[14px] font-semibold text-gray-900">Show reminders in Competen Professional</span>
          <span className="block text-[12.5px] text-gray-600">Renewals due within {horizonDays} days appear on your home page and here.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 pointer-coarse:min-h-[var(--cmp-touch-min)]">
        <input type="checkbox" checked={e} onChange={ev => setE(ev.target.checked)} className={box} style={{ accentColor: accent }} />
        <span>
          <span className="block text-[14px] font-semibold text-gray-900">Also email me reminders</span>
          <span className="block text-[12.5px] text-gray-600">One email per expiry date, {horizonDays} days ahead, to your account email. Sent only where email is set up on Competen. Off unless you turn it on.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : "Save reminder settings"}</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
