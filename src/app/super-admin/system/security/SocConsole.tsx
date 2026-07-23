"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// SOC response console (SYS-001.3) — controlled containment actions. The spec's
// automated responses (session revocation, temporary lock, token invalidation)
// map to the one real, reversible containment we can take: a Supabase Auth ban
// on a compromised account, via POST /api/super-admin/users/actions. This is a
// deliberate, human-approved action (SYS-002 principle: AI/automation may
// recommend but must not silently execute destructive actions) — audit-logged
// and reversible (reinstate). Password reset forces re-authentication.

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const RESPONSES: Record<string, string> = {
  suspend: "Contain — block sign-in (Auth ban)",
  send_reset: "Force re-authentication (password reset)",
  unsuspend: "Release containment (reinstate)",
};

type Picker = { id: string; label: string };

export default function SocConsole({ users }: { users: Picker[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };

  async function run() {
    if (!userId) { toast("err", "select a user"); return; }
    if (!action) { toast("err", "select a response"); return; }
    if (action === "suspend" && !confirming) { setConfirming(true); return; }
    setBusy(true); setConfirming(false);
    try {
      const r = await fetch("/api/super-admin/users/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, action }) });
      if (r.ok) { toast("ok", `${RESPONSES[action] ?? "Response"} applied — audit-logged`); setUserId(""); setAction(""); router.refresh(); }
      else toast("err", (await r.json().catch(() => ({}))).error ?? "Response failed");
    } catch { toast("err", "Network error — nothing was changed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Response &amp; Containment</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
      </div>
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div><label className={label}>Affected identity</label><select value={userId} onChange={e => { setUserId(e.target.value); setConfirming(false); }} className={input}><option value="">— Select user —</option>{users.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></div>
        <div><label className={label}>Response action</label><select value={action} onChange={e => { setAction(e.target.value); setConfirming(false); }} className={input}><option value="">— Select response —</option>{Object.entries(RESPONSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div>
          <button onClick={run} disabled={busy} className={`w-full text-sm font-semibold text-white rounded-lg px-4 py-2 disabled:opacity-60 ${confirming ? "bg-rose-600 hover:bg-rose-700" : "bg-teal-600 hover:bg-teal-700"}`}>
            {busy ? "Applying…" : confirming ? "Confirm containment" : "Apply response"}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-3">Containment is a real, reversible Supabase Auth ban — sign-in is blocked until released. Human-approved and audit-logged; automation may recommend but never silently executes. You cannot suspend your own account.</p>
    </div>
  );
}
