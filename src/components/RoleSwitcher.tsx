"use client";
import { useState } from "react";
import { ROLE_CONFIG, type AppRole } from "@/lib/roles";

export default function RoleSwitcher({ roles, activeRole }: { roles: AppRole[]; activeRole: AppRole }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<AppRole | null>(null);

  if (roles.length <= 1) return null;

  async function switchTo(role: AppRole) {
    if (role === activeRole) { setOpen(false); return; }
    setSwitching(role);
    const res = await fetch("/api/auth/switch-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      const { redirect } = await res.json();
      // Hard navigation — router.push replays prefetched payloads computed
      // with the old active_role cookie and bounces back (prod-only loop).
      window.location.assign(redirect);
      return;
    }
    setSwitching(null);
    setOpen(false);
  }

  const current = ROLE_CONFIG[activeRole];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors text-white"
      >
        <span>{current.icon}</span>
        <span className="flex-1 text-left truncate">{current.label}</span>
        <span className="text-white/50 text-[10px]">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 pt-3 pb-1">Switch Portal</p>
            {roles.map(role => {
              const cfg = ROLE_CONFIG[role];
              const isActive = role === activeRole;
              return (
                <button
                  key={role}
                  onClick={() => switchTo(role)}
                  disabled={!!switching}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-gray-50 text-gray-900 font-semibold"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span>{cfg.icon}</span>
                  <span className="flex-1 text-left">{cfg.label}</span>
                  {isActive && <span className="text-[10px] text-teal-600 font-bold">Active</span>}
                  {switching === role && <span className="text-[10px] text-gray-400">Switching…</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
