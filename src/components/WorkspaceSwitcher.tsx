"use client";

import { useState } from "react";
import { ROLE_CONFIG, type AppRole } from "@/lib/roles";

// Permission-controlled workspace switcher. Renders the workspace pill; when
// the user holds more than one role it becomes a dropdown listing ONLY the
// workspaces their roles permit. The switch itself is enforced server-side
// (/api/auth/switch-role rejects roles the user doesn't hold and sets the
// httpOnly active_role cookie) — this UI never grants anything.

const WORKSPACE_LABEL: Record<AppRole, string> = {
  super_admin: "Platform Admin Workspace",
  hospital_admin: "Admin Workspace",
  educator: "Educator Workspace",
  assessor: "Assessor Workspace",
  nurse: "Clinician Workspace",
};

export default function WorkspaceSwitcher({ roles, activeRole, variant = "sidebar" }: {
  roles: AppRole[]; activeRole: AppRole; variant?: "sidebar" | "mobile" | "footer";
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<AppRole | null>(null);
  const multi = roles.length > 1;

  async function switchTo(role: AppRole) {
    if (role === activeRole) { setOpen(false); return; }
    setSwitching(role);
    const res = await fetch("/api/auth/switch-role", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      const { redirect } = await res.json();
      // HARD navigation, deliberately not router.push: in production the
      // client router serves prefetched RSC payloads computed with the OLD
      // active_role cookie — whose baked-in portal redirect bounces the user
      // straight back (the "jumping between workspaces" bug). A full page
      // load hits the server with the fresh cookie and clears the cache.
      window.location.assign(redirect);
      return;
    }
    setSwitching(null);
    setOpen(false);
  }

  const dropdown = open && multi && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div className={`absolute z-50 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden ${
        variant === "sidebar" ? "top-full left-0 right-0 mt-1"
          : variant === "footer" ? "bottom-full left-0 right-0 mb-1"
          : "top-full right-0 mt-1 w-56"}`}>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 pt-3 pb-1">Switch Workspace</p>
        {roles.map(role => {
          const cfg = ROLE_CONFIG[role];
          const isActive = role === activeRole;
          return (
            <button key={role} onClick={() => switchTo(role)} disabled={!!switching}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-colors ${
                isActive ? "bg-gray-50 text-gray-900 font-semibold" : "text-gray-700 hover:bg-gray-50"}`}>
              <span>{cfg.icon}</span>
              <span className="flex-1 text-left">{WORKSPACE_LABEL[role]}</span>
              {isActive && <span className="text-[9px] text-teal-600 font-bold uppercase">Active</span>}
              {switching === role && <span className="text-[9px] text-gray-400">Switching…</span>}
            </button>
          );
        })}
        <p className="text-[9px] text-gray-400 px-3 py-2 border-t border-gray-50">
          Only workspaces your roles permit are listed; access is enforced server-side.
        </p>
      </div>
    </>
  );

  if (variant === "footer") {
    // Always-visible control in the sidebar footer. Multi-role: opens the
    // permitted-workspace list (upward). Single-role: states the access level
    // plainly so the control's presence is never a mystery.
    if (!multi) {
      return (
        <p className="px-3 py-1.5 text-[10px] text-slate-500">
          Workspace access: <span className="text-slate-400 font-semibold">{WORKSPACE_LABEL[activeRole]}</span> only
        </p>
      );
    }
    return (
      <div className="relative">
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors text-white">
          <span>{ROLE_CONFIG[activeRole].icon}</span>
          <span className="flex-1 text-left truncate">Switch Workspace</span>
          <span className="text-white/50 text-[10px]">▲</span>
        </button>
        {dropdown}
      </div>
    );
  }

  if (variant === "mobile") {
    return (
      <span className="relative block">
        <button onClick={() => multi && setOpen(o => !o)}
          className={`block text-indigo-300/60 text-[10px] leading-tight text-left ${multi ? "hover:text-indigo-200" : "cursor-default"}`}>
          {WORKSPACE_LABEL[activeRole]}{multi && " ▾"}
        </button>
        {dropdown}
      </span>
    );
  }

  return (
    <div className="relative mx-2 mb-4">
      <button onClick={() => multi && setOpen(o => !o)}
        className={`w-full bg-indigo-600 rounded-lg px-3 py-2 text-left ${multi ? "hover:bg-indigo-500 transition-colors" : "cursor-default"}`}>
        <p className="text-white text-[11px] font-semibold flex items-center gap-1.5">
          <span>🛡️ {WORKSPACE_LABEL[activeRole]}</span>
          {multi && <span className="ml-auto text-indigo-200 text-[9px]">▾</span>}
        </p>
        {multi && <p className="text-indigo-200/70 text-[9px] mt-0.5">{roles.length} workspaces available</p>}
      </button>
      {dropdown}
    </div>
  );
}
