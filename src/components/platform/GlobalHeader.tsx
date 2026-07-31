"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SidebarToggle from "@/components/SidebarToggle";
import ShortcutBinder from "./ShortcutBinder";

// Platform Global Header (PUI-002 + HWW-UI-002) — ONE header, every workspace.
//
// The specs' design decision, verbatim: move the workspace switcher, user profile, preferences and sign out
// OUT of the sidebar and into the global header, and reserve the sidebar exclusively for workflow navigation.
// Because "header behaviour is identical across all Competen workspaces" is an acceptance criterion, this is
// a single component that every layout renders — not a pattern each layout re-implements. Workspaces vary
// only by the title they pass in.
//
// Layout, per PUI-002 s"Global Header Standard":
//   left   sidebar toggle, Competen logo, workspace title
//   centre page title + breadcrumbs
//   right  notifications, messages, workspace selector, unit selector, user menu
//
// Accessibility (PUI-005): every menu is a real button with aria-expanded/aria-haspopup, closes on Escape
// and on outside click, restores focus to its trigger, and every control meets the 44px touch target.

export type HeaderUser = { name: string; roleLabel: string; org?: string | null };
export type HeaderWorkspace = { label: string; href: string; icon?: string; current?: boolean };
export type HeaderUnit = { id: string; name: string };
export type Crumb = { label: string; href?: string };

// PUI-002 "User Menu Standard" — the same eight entries in every workspace.
const USER_LINKS: { label: string; href: string; icon: string }[] = [
  { label: "Personal Workspace", href: "/dashboard", icon: "⊞" },
  { label: "Competency Passport", href: "/dashboard/passport", icon: "🎖" },
  { label: "Learning", href: "/dashboard/learning", icon: "📚" },
  { label: "Profile", href: "/dashboard/profile", icon: "👤" },
  { label: "Preferences", href: "/dashboard/preferences", icon: "⚙" },
  { label: "Help & Support", href: "/dashboard/help", icon: "?" },
];

// Closes a popover on Escape or an outside click, and hands focus back to the trigger.
function useDismiss(open: boolean, close: () => void, triggerRef: React.RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); triggerRef.current?.focus(); } };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !triggerRef.current?.contains(t)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open, close, triggerRef]);
  return ref;
}

const CONTROL = "inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[13px] text-gray-600 hover:bg-gray-100 transition-colors";
const PANEL = "absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50";

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
      {n > 99 ? "99+" : n}
      <span className="cmp-sr-only"> unread</span>
    </span>
  );
}

export default function GlobalHeader({
  workspaceTitle, workspaceHref = "/dashboard", pageTitle, breadcrumbs = [],
  user, workspaces = [], units = [], activeUnitId = null,
  notifications = 0, messages = 0, showSidebarToggle = true,
}: {
  workspaceTitle: string;
  workspaceHref?: string;
  pageTitle?: string;
  breadcrumbs?: Crumb[];
  user: HeaderUser;
  workspaces?: HeaderWorkspace[];
  units?: HeaderUnit[];
  activeUnitId?: string | null;
  notifications?: number;
  messages?: number;
  showSidebarToggle?: boolean;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState<null | "user" | "workspace" | "unit">(null);
  const close = () => setMenu(null);

  const userBtn = useRef<HTMLButtonElement>(null);
  const wsBtn = useRef<HTMLButtonElement>(null);
  const unitBtn = useRef<HTMLButtonElement>(null);
  const userPanel = useDismiss(menu === "user", close, userBtn);
  const wsPanel = useDismiss(menu === "workspace", close, wsBtn);
  const unitPanel = useDismiss(menu === "unit", close, unitBtn);

  const activeUnit = units.find(u => u.id === activeUnitId) ?? null;
  const initials = (user.name || "?").split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();

  const selectUnit = async (id: string | null) => {
    close();
    await fetch("/api/context/unit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unit: id }),
    }).catch(() => undefined);
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 h-14 flex items-center gap-2 px-3 md:px-4"
      style={{ fontFamily: "var(--cmp-font-sans)" }}>
      {/* PUI-005 s2: binds the documented shortcuts. Mounted here so every workspace gets them. */}
      <ShortcutBinder />
      {/* ── Left: toggle + logo + workspace title ── */}
      {showSidebarToggle && <SidebarToggle variant="header" />}
      <Link href={workspaceHref} className="flex items-center gap-2 min-w-0 shrink-0">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ background: "var(--cmp-color-primary)" }} aria-hidden>C</span>
        <span className="min-w-0 hidden sm:block">
          <span className="block text-gray-900 font-semibold text-sm leading-tight truncate">Competen</span>
          <span className="block text-gray-400 text-[10px] leading-tight truncate">{workspaceTitle}</span>
        </span>
      </Link>

      {/* ── Centre: page title + breadcrumbs ── */}
      <div className="flex-1 min-w-0 hidden lg:block pl-4">
        {pageTitle && <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{pageTitle}</p>}
        {breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1 text-[11px] text-gray-400">
              {breadcrumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>›</span>}
                  {c.href ? <Link href={c.href} className="hover:text-gray-600 hover:underline">{c.label}</Link> : <span>{c.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
      <span className="flex-1 lg:hidden" />

      {/* ── Right: notifications, messages, workspace, unit, user ── */}
      <Link href="/dashboard/notifications" data-touch-target aria-label={`Notifications${notifications ? `, ${notifications} unread` : ""}`}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
        <span aria-hidden>🔔</span><Badge n={notifications} />
      </Link>
      <Link href="/dashboard/messages" data-touch-target aria-label={`Messages${messages ? `, ${messages} unread` : ""}`}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
        <span aria-hidden>✉</span><Badge n={messages} />
      </Link>

      {/* Workspace selector — changes the functional workspace (role). RBAC-filtered upstream: this list is
          built server-side from what the user may actually enter, so it can never offer a forbidden one. */}
      {workspaces.length > 0 && (
        <div className="relative hidden md:block">
          <button ref={wsBtn} type="button" data-touch-target
            aria-haspopup="menu" aria-expanded={menu === "workspace"}
            onClick={() => setMenu(m => (m === "workspace" ? null : "workspace"))}
            className={`${CONTROL} border border-gray-200`}>
            <span aria-hidden>🧑‍⚕️</span>
            <span className="max-w-[9rem] truncate">{workspaceTitle}</span>
            <span className="text-gray-400" aria-hidden>▾</span>
          </button>
          {menu === "workspace" && (
            <div ref={wsPanel} role="menu" aria-label="Switch workspace" className={PANEL}>
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Switch workspace</p>
              {workspaces.map(w => (
                <Link key={w.href} href={w.href} role="menuitem" onClick={close}
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50">
                  <span className="w-4 text-center" aria-hidden>{w.icon ?? "▸"}</span>
                  <span className="flex-1 truncate">{w.label}</span>
                  {w.current && <span className="text-teal-600" aria-label="current">✓</span>}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unit / location selector — independent of workspace, so a user changes WHERE they are working
          without changing WHO they are working as. Rendered only when the tenant actually has units. */}
      {units.length > 0 && (
        <div className="relative hidden lg:block">
          <button ref={unitBtn} type="button" data-touch-target
            aria-haspopup="menu" aria-expanded={menu === "unit"}
            onClick={() => setMenu(m => (m === "unit" ? null : "unit"))}
            className={`${CONTROL} border border-gray-200`}>
            <span aria-hidden>📍</span>
            <span className="max-w-[8rem] truncate">{activeUnit?.name ?? "All units"}</span>
            <span className="text-gray-400" aria-hidden>▾</span>
          </button>
          {menu === "unit" && (
            <div ref={unitPanel} role="menu" aria-label="Select unit" className={`${PANEL} max-h-80 overflow-y-auto`}>
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Working location</p>
              <button type="button" role="menuitem" onClick={() => selectUnit(null)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 text-left">
                <span className="flex-1">All units</span>
                {!activeUnitId && <span className="text-teal-600" aria-label="current">✓</span>}
              </button>
              {units.map(u => (
                <button key={u.id} type="button" role="menuitem" onClick={() => selectUnit(u.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 text-left">
                  <span className="flex-1 truncate">{u.name}</span>
                  {u.id === activeUnitId && <span className="text-teal-600" aria-label="current">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* User menu — the ONLY place sign out lives, platform-wide (HWW-UI-002 acceptance criterion). */}
      <div className="relative">
        <button ref={userBtn} type="button" data-touch-target
          aria-haspopup="menu" aria-expanded={menu === "user"}
          onClick={() => setMenu(m => (m === "user" ? null : "user"))}
          className="inline-flex items-center gap-2 h-9 pl-1 pr-2 rounded-lg hover:bg-gray-100 transition-colors">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ background: "var(--cmp-color-primary-dark)" }} aria-hidden>{initials}</span>
          <span className="hidden xl:block text-left min-w-0">
            <span className="block text-[12px] font-medium text-gray-900 leading-tight truncate max-w-[8rem]">{user.name}</span>
            <span className="block text-[10px] text-gray-400 leading-tight truncate max-w-[8rem]">{user.roleLabel}</span>
          </span>
          <span className="text-gray-400 text-xs" aria-hidden>▾</span>
          <span className="cmp-sr-only">Account menu for {user.name}</span>
        </button>

        {menu === "user" && (
          <div ref={userPanel} role="menu" aria-label="Account" className={PANEL}>
            <div className="px-3 py-2.5 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
              <p className="text-[11px] text-gray-500 truncate">{user.roleLabel}</p>
              {user.org && <p className="text-[10px] text-gray-400 truncate">{user.org}</p>}
            </div>

            {workspaces.length > 0 && (
              <div className="md:hidden border-b border-gray-100 py-1">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Switch workspace</p>
                {workspaces.map(w => (
                  <Link key={w.href} href={w.href} role="menuitem" onClick={close}
                    className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50">
                    <span className="w-4 text-center" aria-hidden>{w.icon ?? "▸"}</span>
                    <span className="flex-1 truncate">{w.label}</span>
                    {w.current && <span className="text-teal-600" aria-label="current">✓</span>}
                  </Link>
                ))}
              </div>
            )}

            <div className="py-1">
              {USER_LINKS.map(l => (
                <Link key={l.href} href={l.href} role="menuitem" onClick={close}
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50">
                  <span className="w-4 text-center text-gray-400" aria-hidden>{l.icon}</span>
                  <span>{l.label}</span>
                </Link>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-1">
              <form action="/api/auth/logout" method="POST">
                <button type="submit" role="menuitem"
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left hover:bg-red-50"
                  style={{ color: "var(--cmp-text-error)" }}>
                  <span className="w-4 text-center" aria-hidden>↩</span>
                  <span>Sign Out</span>
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
