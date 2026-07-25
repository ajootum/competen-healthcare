"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// PW-012 preferences form — tabbed personal configuration bound to the per-browser pw_prefs cookie via
// /api/preferences. Genuinely persistent (survives reload). Controls the app can honor today are applied;
// theme/appearance is stored honestly as a saved preference (full theming is progressive).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Prefs = { theme?: string; density?: string; landing?: string; emailDigest?: string; notifyTasks?: boolean; notifyLearning?: boolean; notifySystem?: boolean; reducedMotion?: boolean; timezone?: string; notes?: string };

const TABS = ["General", "Notifications", "Display", "Language & Region", "Privacy & Data"];
const DEFAULTS: Prefs = { theme: "system", density: "standard", landing: "/dashboard", emailDigest: "daily", notifyTasks: true, notifyLearning: true, notifySystem: false, reducedMotion: false, timezone: "Africa/Nairobi", notes: "" };

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div><p className="text-[13px] font-medium text-gray-800">{label}</p>{hint && <p className="text-[11px] text-gray-400">{hint}</p>}</div>
      <button type="button" onClick={() => onChange(!on)} className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${on ? "bg-blue-600" : "bg-gray-300"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} /></button>
    </div>
  );
}
function Seg({ value, options, onChange }: { value: string; options: { v: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
      {options.map(o => <button key={o.v} type="button" onClick={() => onChange(o.v)} className={`text-[12px] font-medium rounded-md px-3 py-1.5 capitalize ${value === o.v ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"}`}>{o.label}</button>)}
    </div>
  );
}

export default function PreferencesForm({ initial, profile }: { initial: Prefs; profile: { name: string; role: string; email: string; specialization: string | null } }) {
  const router = useRouter();
  const [tab, setTab] = useState("General");
  const [p, setP] = useState<Prefs>({ ...DEFAULTS, ...initial });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof Prefs, v: any) => { setP(prev => ({ ...prev, [k]: v })); setDirty(true); setSaved(false); };

  const save = () => start(async () => {
    const r = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).catch(() => null);
    if (r?.ok) { setDirty(false); setSaved(true); router.refresh(); }
  });
  const reset = () => start(async () => {
    const r = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ __reset: true }) }).catch(() => null);
    if (r?.ok) { setP({ ...DEFAULTS }); setDirty(false); setSaved(true); router.refresh(); }
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-100 px-3 pt-2">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px ${tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>)}
      </div>

      <div className="p-5">
        {tab === "General" && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Profile &amp; Identity</p>
                <dl className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between"><dt className="text-gray-400">Display Name</dt><dd className="text-gray-800 font-medium">{profile.name}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-400">Role</dt><dd className="text-gray-800 capitalize">{profile.role}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-400">Specialization</dt><dd className="text-gray-800">{profile.specialization ?? "—"}</dd></div>
                </dl>
                <a href="/dashboard/billing" className="inline-block mt-2 text-[12px] font-medium text-blue-600 hover:underline">Edit profile →</a>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Default Landing Page</p>
                <select value={p.landing} onChange={e => set("landing", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="/dashboard">Dashboard</option>
                  <option value="/dashboard/tasks">Task &amp; Action Centre</option>
                  <option value="/dashboard/calendar">Calendar &amp; Schedule</option>
                  <option value="/dashboard/learning">My Learning Centre</option>
                  <option value="/dashboard/notifications">Notifications</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Where you land after signing in (applied when landing-routing ships).</p>
              </div>
            </div>
          </div>
        )}

        {tab === "Notifications" && (
          <div className="max-w-lg space-y-1">
            <Toggle on={!!p.notifyTasks} onChange={v => set("notifyTasks", v)} label="Task &amp; action alerts" hint="Overdue and due-soon tasks" />
            <Toggle on={!!p.notifyLearning} onChange={v => set("notifyLearning", v)} label="Learning reminders" hint="Mandatory training and CPD" />
            <Toggle on={!!p.notifySystem} onChange={v => set("notifySystem", v)} label="System updates" hint="Platform announcements" />
            <div className="flex items-center justify-between py-2 border-t border-gray-100 mt-2 pt-3">
              <div><p className="text-[13px] font-medium text-gray-800">Email digest</p><p className="text-[11px] text-gray-400">How often to receive an email summary</p></div>
              <Seg value={p.emailDigest ?? "daily"} options={[{ v: "daily", label: "Daily" }, { v: "weekly", label: "Weekly" }, { v: "none", label: "Off" }]} onChange={v => set("emailDigest", v)} />
            </div>
          </div>
        )}

        {tab === "Display" && (
          <div className="max-w-lg space-y-4">
            <div className="flex items-center justify-between"><div><p className="text-[13px] font-medium text-gray-800">Theme</p><p className="text-[11px] text-gray-400">Saved preference — full theming is progressive</p></div><Seg value={p.theme ?? "system"} options={[{ v: "light", label: "Light" }, { v: "dark", label: "Dark" }, { v: "system", label: "System" }]} onChange={v => set("theme", v)} /></div>
            <div className="flex items-center justify-between"><div><p className="text-[13px] font-medium text-gray-800">Density</p><p className="text-[11px] text-gray-400">Layout spacing</p></div><Seg value={p.density ?? "standard"} options={[{ v: "compact", label: "Compact" }, { v: "standard", label: "Standard" }, { v: "spacious", label: "Spacious" }]} onChange={v => set("density", v)} /></div>
            <Toggle on={!!p.reducedMotion} onChange={v => set("reducedMotion", v)} label="Reduce motion" hint="Minimise animations" />
          </div>
        )}

        {tab === "Language & Region" && (
          <div className="max-w-lg space-y-4">
            <div><p className="text-[13px] font-medium text-gray-800 mb-1">Time Zone</p>
              <select value={p.timezone} onChange={e => set("timezone", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {["Africa/Nairobi", "Africa/Kampala", "Africa/Lagos", "Europe/London", "UTC"].map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div><p className="text-[13px] font-medium text-gray-800 mb-1">Language</p><input value="English (UK)" disabled className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" /><p className="text-[11px] text-gray-400 mt-1">Additional locales are progressive.</p></div>
          </div>
        )}

        {tab === "Privacy & Data" && (
          <div className="max-w-lg space-y-4">
            <div><p className="text-[13px] font-medium text-gray-800 mb-1">Personal Notes</p><textarea value={p.notes} onChange={e => set("notes", e.target.value)} rows={4} maxLength={500} placeholder="Private notes about your setup or preferences…" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" /><p className="text-[11px] text-gray-400 mt-0.5 text-right">{(p.notes ?? "").length}/500</p></div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-[12px] text-gray-500">Preferences are stored in this browser. Cross-device sync, MFA settings and data export require a server-side preference store (progressive).</div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
        <span className="text-[12px] text-gray-400">{saved ? "✓ Saved to this browser" : dirty ? "Unsaved changes" : "All changes saved"}</span>
        <div className="flex items-center gap-2">
          <button onClick={reset} disabled={pending} className="text-[13px] font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-white disabled:opacity-50">Reset to defaults</button>
          <button onClick={save} disabled={!dirty || pending} className="text-[13px] font-medium text-white bg-blue-600 rounded-lg px-4 py-1.5 hover:bg-blue-500 disabled:opacity-40">{pending ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
