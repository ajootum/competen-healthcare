"use client";
import { useState, useEffect } from "react";
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
};

export default function MobileSidebar({ fullName, role, isAdmin, unread = 0, avatarUrl }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

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
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[#0a2e38] flex items-center gap-3 px-3 shadow-lg">
        <button
          onClick={() => setOpen(true)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white hover:bg-teal-800/50 transition-colors shrink-0"
          aria-label="Open menu"
        >
          <svg width="18" height="14" viewBox="0 0 16 12" fill="none">
            <rect width="16" height="2" rx="1" fill="white"/>
            <rect y="5" width="16" height="2" rx="1" fill="white"/>
            <rect y="10" width="16" height="2" rx="1" fill="white"/>
          </svg>
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight truncate">Competen</span>
            <span className="block text-teal-400/60 text-[10px] leading-tight">Nurse Workspace</span>
          </span>
        </Link>
        <span className="flex-1" />
        <Link href="/dashboard/notifications" aria-label="Notifications"
          className="relative w-10 h-10 rounded-lg flex items-center justify-center text-lg hover:bg-teal-800/50 transition-colors shrink-0">
          🔔
          {unread > 0 && (
            <span className="absolute top-1 right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-0.5 flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
        <Link href="/dashboard/billing" aria-label="Account settings" className="shrink-0">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
            <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-teal-700" />
          ) : (
            <span className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">
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

      {/* Drawer */}
      <aside className={`md:hidden fixed top-0 left-0 bottom-0 w-64 bg-[#0a2e38] z-50 flex flex-col py-6 px-4 transition-transform duration-300 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}>
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm">Competen</span>
          </Link>
          <button onClick={() => setOpen(false)} className="text-teal-300/60 hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
          {navItems.map(({ label, href, icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link key={label} href={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active ? "bg-teal-700/60 text-white" : "text-teal-100/70 hover:bg-teal-800/50 hover:text-white"
                }`}>
                <span className="text-sm leading-none w-5 text-center">{icon}</span>
                <span className="flex-1">{label}</span>
                {href === "/dashboard/notifications" && unread > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-teal-800/60">
          {isAdmin && (
            <Link href="/admin/dashboard"
              className="flex items-center gap-2.5 px-3 py-2 mb-1 rounded-lg text-sm text-amber-300/80 hover:bg-amber-800/20 transition-colors">
              <span className="w-5 text-center text-sm">🏛️</span>
              <span>Admin Panel</span>
            </Link>
          )}
          <div className="flex items-center gap-2 px-3 py-2">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
              <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-teal-700" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">
                {firstName[0]}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{fullName}</p>
              <p className="text-teal-400/60 text-[10px] capitalize">{role.replace(/_/g, " ")}</p>
            </div>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button type="submit"
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/50 hover:bg-teal-800/30 hover:text-white transition-colors">
              <span className="w-5 text-center">↩</span>
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
