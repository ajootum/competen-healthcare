"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard",           href: "/dashboard",              icon: "🏠" },
  { label: "Competency Passport", href: "/dashboard/passport",     icon: "🧠" },
  { label: "Learning Pathway",    href: "/dashboard/learning",     icon: "📚" },
  { label: "My CPUs",             href: "/dashboard/cpu",          icon: "🏥" },
  { label: "Assessments",         href: "/dashboard/assessments",  icon: "📝" },
  { label: "Skills Logbook",      href: "/dashboard/logbook",      icon: "📖" },
  { label: "Feedback",            href: "/dashboard/feedback",     icon: "💬" },
  { label: "Certificates",        href: "/dashboard/certificates", icon: "🏆" },
  { label: "Clinical Library",    href: "/dashboard/library",      icon: "🔎" },
  { label: "Career Growth",       href: "/dashboard/career",       icon: "📈" },
];

type Props = {
  fullName: string;
  role: string;
  isAdmin: boolean;
};

export default function MobileSidebar({ fullName, role, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const firstName = fullName.split(" ")[0] ?? "N";

  return (
    <>
      {/* Hamburger button — only visible on mobile */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-4 left-4 z-30 w-9 h-9 rounded-lg bg-[#0a2e38] flex items-center justify-center text-white shadow-lg"
        aria-label="Open menu"
      >
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <rect width="16" height="2" rx="1" fill="white"/>
          <rect y="5" width="16" height="2" rx="1" fill="white"/>
          <rect y="10" width="16" height="2" rx="1" fill="white"/>
        </svg>
      </button>

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

        <nav className="flex flex-col gap-0.5 flex-1">
          {navItems.map(({ label, href, icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link key={label} href={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active ? "bg-teal-700/60 text-white" : "text-teal-100/70 hover:bg-teal-800/50 hover:text-white"
                }`}>
                <span className="text-sm leading-none w-5 text-center">{icon}</span>
                <span>{label}</span>
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
            <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">
              {firstName[0]}
            </div>
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
