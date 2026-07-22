"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// IAM console (SYS-001.2) — real identity lifecycle actions via the existing
// super-admin user APIs:
//   Create User    → POST /api/super-admin/users {email, full_name, role,
//                    mode: invite|password} — invite sends a set-password
//                    email; password mode returns a ONE-TIME temp password
//                    (shown once here, never stored).
//   Account Action → POST /api/super-admin/users/actions {userId, action:
//                    suspend|unsuspend|send_reset|resend_invite} — suspension
//                    is a REAL Supabase Auth ban (sign-in genuinely blocked),
//                    self-suspension is server-rejected.
// Every action is audit-logged server-side.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const PORTALS: Record<string, string> = { nurse: "Nurse", educator: "Educator", assessor: "Assessor", hospital_admin: "Hospital Admin", super_admin: "Super Admin" };
const ACTIONS: Record<string, string> = { suspend: "Suspend (block sign-in)", unsuspend: "Reinstate", send_reset: "Send password reset", resend_invite: "Re-send invitation" };

type Picker = { id: string; label: string };

const TABS = [
  { key: "create", label: "Create User", icon: "➕" },
  { key: "action", label: "Account Action", icon: "🔐" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function IamConsole({ users }: { users: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("create");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string, sticky = false) => { setMsg({ k, t }); if (!sticky) setTimeout(() => setMsg(null), 6000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  async function act() {
    let url = "", body: any = {}, missing = "";
    if (tab === "create") {
      if (!String(form.email ?? "").trim()) missing = "email";
      else if (!String(form.full_name ?? "").trim()) missing = "full name";
      url = "/api/super-admin/users";
      body = { email: String(form.email).trim(), full_name: String(form.full_name).trim(), role: form.role || "nurse", mode: form.mode || "invite" };
    } else {
      if (!form.userId) missing = "user";
      else if (!form.action) missing = "action";
      url = "/api/super-admin/users/actions";
      body = { userId: form.userId, action: form.action };
    }
    if (missing) { toast("err", `${missing} is required`); return; }

    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({} as any));
      if (r.ok) {
        if (tab === "create" && j.tempPassword) {
          // Shown ONCE — the API never returns it again.
          toast("ok", `User created. One-time temporary password: ${j.tempPassword} — copy it now, it is not stored.`, true);
        } else {
          toast("ok", tab === "create" ? "Invitation sent — the user sets their own password" : `${ACTIONS[form.action] ?? "Action"} applied`);
        }
        setForm({});
        router.refresh();
      } else toast("err", j.error ?? "Action failed");
    } catch { toast("err", "Network error — nothing was changed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">IAM Console</h2>
        <div className="flex gap-1">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      {msg && <p className={`text-xs rounded-lg px-3 py-2 mx-5 mt-3 break-all ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</p>}

      <div className="p-5">
        {tab === "create" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Email *</label><input type="email" value={form.email ?? ""} onChange={set("email")} className={input} placeholder="user@hospital.org" /></div>
            <div><label className={label}>Full name *</label><input value={form.full_name ?? ""} onChange={set("full_name")} className={input} placeholder="e.g. Jane Mutoni" /></div>
            <div><label className={label}>Portal role</label><select value={form.role ?? "nurse"} onChange={set("role")} className={input}>{Object.entries(PORTALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Mode</label><select value={form.mode ?? "invite"} onChange={set("mode")} className={input}><option value="invite">Invite — user sets password via email</option><option value="password">Temporary password — shown once</option></select></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Creates the auth identity and profile together (rolled back atomically on failure). Fine-grained org roles are assigned afterwards in Enterprise → People.</p>
          </div>
        )}

        {tab === "action" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>User *</label><select value={form.userId ?? ""} onChange={set("userId")} className={input}><option value="">— Select user —</option>{users.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></div>
            <div><label className={label}>Action *</label><select value={form.action ?? ""} onChange={set("action")} className={input}><option value="">— Select action —</option>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Suspension is a real Supabase Auth ban — sign-in is genuinely blocked until reinstated. You cannot suspend your own account (server-enforced). All actions are audit-logged.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : TABS.find(t => t.key === tab)!.label}</button>
          <button onClick={() => { setForm({}); setMsg(null); }} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real identity lifecycle — audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
