"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { ROLE_CONFIG, type AppRole, type WorkspaceLink } from "@/lib/roles";

export default function RoleSwitcher({ roles, activeRole, workspaces = [] }: {
  roles: AppRole[]; activeRole: AppRole; workspaces?: WorkspaceLink[];
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<AppRole | null>(null);
  const pathname = usePathname();

  // Which dedicated workspace (if any) we're currently inside — matched by path,
  // so the trigger and the "Active" marker reflect where the user actually is.
  const activeWs = workspaces.find(w => pathname === w.href || pathname.startsWith(w.href + "/"));

  // Nothing to switch between → render nothing.
  if (roles.length + workspaces.length <= 1) return null;

  async function switchTo(role: AppRole) {
    if (role === activeRole && !activeWs) { setOpen(false); return; }
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

  const currentIcon = activeWs ? activeWs.icon : ROLE_CONFIG[activeRole].icon;
  const currentLabel = activeWs ? activeWs.label : ROLE_CONFIG[activeRole].label;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors text-white"
      >
        <span>{currentIcon}</span>
        <span className="flex-1 text-left truncate">{currentLabel}</span>
        <span className="text-white/50 text-[10px]">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden max-h-[70vh] overflow-y-auto">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 pt-3 pb-1">Switch Portal</p>
            {roles.map(role => {
              const cfg = ROLE_CONFIG[role];
              const isActive = role === activeRole && !activeWs;
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

            {workspaces.length > 0 && (
              <>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 pt-3 pb-1 border-t border-gray-100">Workspaces</p>
                {workspaces.map(ws => {
                  const isActive = activeWs?.href === ws.href;
                  return (
                    <a
                      key={ws.href}
                      href={ws.href}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                        isActive
                          ? "bg-gray-50 text-gray-900 font-semibold"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span>{ws.icon}</span>
                      <span className="flex-1 text-left">{ws.label}</span>
                      {isActive && <span className="text-[10px] text-teal-600 font-bold">Active</span>}
                    </a>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
