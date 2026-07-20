import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";

// Internal-staff workspaces (PLA-001) — Customer Success, Support, Finance and
// the rest of the platform-operations org. Landlord-gated.

const NAV = [
  { label: "Customer Success", href: "/platform/staff/customer-success", icon: "🤝" },
  { label: "Support",          href: "/platform/staff/support",          icon: "🎧" },
  { label: "Finance",          href: "/platform/staff/finance",          icon: "💷" },
  { label: "Product",          href: "/platform/staff/product",          icon: "🧭" },
  { label: "Engineering",      href: "/platform/staff/engineering",      icon: "💻" },
  { label: "AI Operations",    href: "/platform/staff/ai-ops",           icon: "✨" },
  { label: "Quality",          href: "/platform/staff/quality",          icon: "🔬" },
  { label: "Security",         href: "/platform/staff/security",         icon: "🛡️" },
];

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const caller = await getLandlordCaller();
  if (!caller) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Landlord access only</h1>
          <p className="text-gray-400 text-sm mt-1">Internal-staff workspaces are for platform operators.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#120f22] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-violet-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0"><span className="block text-white font-semibold text-sm leading-tight">Competen</span><span className="block text-violet-300/60 text-[10px] leading-tight">Platform Staff</span></span>
          <span className="flex-1" />
          <Link href="/platform/control-plane" className="text-[11px] text-violet-100/70 border border-violet-900 rounded-lg px-2.5 py-1">Control Plane</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map(({ label, href }) => (
            <Link key={label} href={href} className="shrink-0 text-[11px] text-violet-100/80 bg-violet-900/40 hover:bg-violet-800/50 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#120f22] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/platform/control-plane" className="flex items-center gap-2 mb-5 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-violet-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm" data-sb-label>Competen</span>
          </Link>
          <div className="px-3 mb-4" data-sb-label><span className="text-[10px] font-bold text-violet-400/70 uppercase tracking-widest">Platform Staff</span></div>
          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon }) => (
              <NavLink key={label} href={href} icon={icon} label={label}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-violet-100/60 hover:bg-violet-900/40 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-violet-800/50 text-white font-medium" />
            ))}
            <div className="my-2 border-t border-violet-900/40" />
            <Link href="/platform/control-plane" data-sb-item title="Control Plane" className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-violet-100/40 hover:bg-violet-900/40 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">🧭</span><span data-sb-label>Control Plane</span>
            </Link>
          </nav>
          <div className="pt-4 border-t border-violet-900/50">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold">{caller.fullName?.[0] ?? "S"}</div>
              <div className="flex-1 min-w-0" data-sb-label><p className="text-white text-xs font-medium truncate">{caller.fullName ?? "Operator"}</p><p className="text-violet-300/60 text-[10px]">Platform Staff</p></div>
            </div>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-violet-100/50 hover:bg-violet-900/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span><span data-sb-label>Sign out</span>
              </button>
            </form>
          </div>
        </aside>
        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-8 pb-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}
