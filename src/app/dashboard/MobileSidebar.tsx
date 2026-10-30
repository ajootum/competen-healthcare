"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Mirrors the desktop sidebar (Nurse Workspace mockup grouping, flattened).
const navItems = [
  { label: "Dashboard",               href: "/dashboard",              icon: "🏠" },
  { label: "Notifications",           href: "/dashboard/notifications", icon: "🔔" },
  { label: "Career Growth",           href: "/dashboard/career",       icon: "📈" },
  { label: "Learning Pathway",        href: "/dashboard/learning",     icon: "📚" },
  { label: "CPD Academy",             href: "/dashboard/courses",      icon: "🎓" },
  { label: "Question Bank",           href: "/dashboard/questions",    icon: "❓" },
  { label: "Simulation Lab",          href: "/dashboard/simulation",   icon: "🧪" },
  { label: "OSCE Platform",           href: "/dashboard/osce",         icon: "📋" },
  { label: "Clinical Skills Logbook", href: "/dashboard/logbook",      icon: "📖" },
  { label: "Competency Passport",     href: "/dashboard/passport",     icon: "🛂" },
  { label: "My CPUs",                 href: "/dashboard/cpu",          icon: "🏥" },
  { label: "Clinical Library",        href: "/dashboard/library",      icon: "🔎" },
  { label: "Knowledge Hub",           href: "/dashboard/knowledge",    icon: "🔬" },
  { label: "AI Copilot",              href: "/dashboard/copilot",      icon: "✨" },
  { label: "Assessments",             href: "/dashboard/assessments",  icon: "📝" },
  { label: "My Feedback",             href: "/dashboard/feedback",     icon: "💬" },
  { label: "Audit Centre",            href: "/dashboard/audit",        icon: "🛡️" },
  { label: "CPD Log",                 href: "/dashboard/cpd",          icon: "⏱️" },
  { label: "Certificates",            href: "/dashboard/certificates", icon: "🏆" },
  { label: "Settings",                href: "/dashboard/billing",      icon: "⚙️" },
];

type Props = {
  fullName: string;
  role: string;
  isAdmin: boolean;
  unread?: number;
  avatarUrl?: string | null;
  /**
   * The workspaces this person may switch to: the SAME server-side, RBAC-filtered list the desktop header's
   * "Switch workspace" menu offers (loadHeaderContext). Below md that header is not rendered, so without
   * this a Super Admin who lands here on a phone had no way into /super-admin but typing the URL.
   */
  workspaces?: { label: string; href: string; icon?: string }[];
  /** The one-tap jump the desktop banner offers ("Open Super Admin →"); null for a personal-only user. */
  primary?: { label: string; href: string } | null;
};

export default function MobileSidebar({ fullName, role, isAdmin, unread = 0, avatarUrl, workspaces = [], primary = null }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Focus moves in, Tab wraps inside, Escape dismisses, focus returns to the hamburger. aria-modal="true"
  // is a promise that the page behind is inert; without the trap it is a promise to assistive technology
  // that a keyboard user can immediately disprove by pressing Tab.
  const panel = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setOpen(false), []);
  useModalFocus(open, panel, closeDrawer);

  // Close the drawer on navigation (state adjustment during render, per React docs)
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const firstName = fullName.split(" ")[0] ?? "N";

  return (
    <>
      {/* Fixed top app bar — mobile only. A full-width bar (not a floating
          button) so the menu is always discoverable. */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[var(--cmp-app-surface)] border-b border-[var(--cmp-app-border)] flex items-center gap-3 px-3 shadow-sm">
        <button
          onClick={() => setOpen(true)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] transition-colors shrink-0"
          aria-label="Open menu"
        >
          <svg width="18" height="14" viewBox="0 0 16 12" fill="none">
            <rect width="16" height="2" rx="1" fill="currentColor"/>
            <rect y="5" width="16" height="2" rx="1" fill="currentColor"/>
            <rect y="10" width="16" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded bg-[var(--cmp-theme-accent)] flex items-center justify-center text-[var(--cmp-theme-on-accent)] font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-[var(--cmp-app-text)] font-semibold text-sm leading-tight truncate">Competen</span>
            <span className="block text-[var(--cmp-app-text-secondary)] text-[10px] leading-tight">Personal Workspace</span>
          </span>
        </Link>
        <span className="flex-1" />
        {/* The mobile half of the desktop "You're in your Personal Workspace · Open … →" banner: everyone
            lands here (PW-AC-01), so the person's primary functional workspace is one tap away. */}
        {primary && primary.href !== "/dashboard" && (
          <Link href={primary.href} aria-label={`Open ${primary.label}`}
            className="shrink-0 max-w-[9rem] truncate rounded-md bg-[var(--cmp-color-information)] px-2.5 py-1.5 text-xs font-medium text-white pointer-coarse:min-h-[var(--cp-touch)] flex items-center">
            {primary.label} →
          </Link>
        )}
        <Link href="/dashboard/notifications" aria-label="Notifications"
          className="relative w-10 h-10 rounded-lg flex items-center justify-center text-lg hover:bg-[var(--cmp-app-bg)] transition-colors shrink-0">
          🔔
          {unread > 0 && (
            <span className="absolute top-1 right-1 bg-[var(--cmp-color-critical)] text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-0.5 flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
        <Link href="/dashboard/billing" aria-label="Account settings" className="shrink-0">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
            <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-[var(--cmp-app-border)]" />
          ) : (
            <span className="w-8 h-8 rounded-full bg-[var(--cmp-theme-soft)] flex items-center justify-center text-[var(--cmp-theme-ink)] text-xs font-bold">
              {firstName[0]}
            </span>
          )}
        </Link>
      </header>

      {/* Overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer.
          A navigation drawer, not a dropdown: it covers the page behind an opaque overlay, so it is modal
          in behaviour and gets modal semantics -- the same treatment the public site's two mobile drawers
          already have, through the same hook. It stays MOUNTED and slides via translate-x, so the trap is
          keyed on `open` rather than on mounting; without that it would trap focus in an off-screen panel. */}
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="Main navigation" tabIndex={-1}
        aria-hidden={!open}
        className={`md:hidden fixed top-0 left-0 bottom-0 w-64 bg-[var(--cmp-app-surface)] border-r border-[var(--cmp-app-border)] z-50 flex flex-col py-6 px-4 transition-transform duration-300 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}>
        <div className="flex items-center justify-between mb-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[var(--cmp-theme-accent)] flex items-center justify-center text-[var(--cmp-theme-on-accent)] font-bold text-sm">C</div>
            <span className="text-[var(--cmp-app-text)] font-semibold text-sm">Competen</span>
          </Link>
          <button onClick={() => setOpen(false)} className="text-[var(--cmp-app-text-secondary)] hover:text-[var(--cmp-app-text)] transition-colors text-lg leading-none">✕</button>
        </div>

        <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
          {/* Switch workspace, first: the desktop header's menu, which this width does not render. */}
          {workspaces.filter(w => w.href !== "/dashboard").length > 0 && (
            <div className="mb-3 pb-3 border-b border-[var(--cmp-app-border)]">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--cmp-app-text-secondary)]">Switch workspace</p>
              {workspaces.filter(w => w.href !== "/dashboard").map(w => (
                <Link key={w.href} href={w.href} onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] transition-colors pointer-coarse:min-h-[var(--cp-touch)]">
                  <span className="text-sm leading-none w-5 text-center" aria-hidden>{w.icon ?? "▸"}</span>
                  <span className="flex-1">{w.label}</span>
                  <span className="text-[var(--cmp-app-text-secondary)]" aria-hidden>→</span>
                </Link>
              ))}
            </div>
          )}
          {navItems.map(({ label, href, icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link key={label} href={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active ? "bg-[var(--cmp-theme-soft)] text-[var(--cmp-theme-ink)] font-semibold ring-1 ring-[var(--cmp-theme-border)]" : "text-[var(--cmp-app-text-secondary)] hover:bg-[var(--cmp-app-bg)] hover:text-[var(--cmp-app-text)]"
                }`}>
                <span className="text-sm leading-none w-5 text-center">{icon}</span>
                <span className="flex-1">{label}</span>
                {href === "/dashboard/notifications" && unread > 0 && (
                  <span className="bg-[var(--cmp-color-critical)] text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-[var(--cmp-app-border)]">
          {isAdmin && (
            <Link href="/admin/dashboard"
              className="flex items-center gap-2.5 px-3 py-2 mb-1 rounded-lg text-sm text-[var(--cmp-role-revision-ink)] hover:bg-[var(--cmp-role-revision-soft)] transition-colors">
              <span className="w-5 text-center text-sm">🏛️</span>
              <span>Admin Panel</span>
            </Link>
          )}
          <div className="flex items-center gap-2 px-3 py-2">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
              <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-[var(--cmp-app-border)]" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[var(--cmp-theme-soft)] flex items-center justify-center text-[var(--cmp-theme-ink)] text-xs font-bold">
                {firstName[0]}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[var(--cmp-app-text)] text-xs font-medium truncate">{fullName}</p>
              <p className="text-[var(--cmp-app-text-secondary)] text-[10px] capitalize">{role.replace(/_/g, " ")}</p>
            </div>
          </div>
          {/* HWW-UI-002: "Sign Out is no longer displayed in the sidebar."
              CHECKED BEFORE REMOVING, because this is the MOBILE sidebar and stranding somebody with no
              way out would be far worse than the duplication: /dashboard renders GlobalHeader, and the
              header's user button carries no md:hidden -- it is present at every width, and sign out is
              inside the menu it opens. So this was a second door to the same place, not the only one. */}
        </div>
      </aside>
    </>
  );
}
