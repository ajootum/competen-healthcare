import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MobileSidebar from "./MobileSidebar";

const navItems = [
  { label: "Dashboard",           href: "/dashboard",            icon: "⊞" },
  { label: "CPD Academy",         href: "/dashboard/courses",    icon: "📚" },
  { label: "Question Bank",       href: "/dashboard/questions",  icon: "❓" },
  { label: "Competency Passport", href: "/dashboard/passport",   icon: "🪪" },
  { label: "CPD Log",             href: "/dashboard/cpd",        icon: "⏱️" },
  { label: "Knowledge Hub",       href: "/dashboard/knowledge",  icon: "🔬" },
  { label: "AI Copilot",          href: "/dashboard/copilot",    icon: "🤖" },
  { label: "Simulation Lab",      href: "/dashboard/simulation", icon: "🏥" },
  { label: "OSCE Platform",       href: "/dashboard/osce",       icon: "📋" },
  { label: "Audit Tools",         href: "/dashboard/audit",      icon: "📊" },
  { label: "Billing & Plan",      href: "/dashboard/billing",    icon: "💳" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const firstName = profile?.full_name?.split(" ")[0] ?? "Nurse";
  const isAdmin = profile?.role === "hospital_admin";

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      {/* Mobile sidebar (client component handles open/close) */}
      <MobileSidebar
        fullName={profile?.full_name ?? "Nurse"}
        role={profile?.role ?? "nurse"}
        isAdmin={isAdmin}
      />

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-56 min-h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <Link href="/" className="flex items-center gap-2 mb-6 px-2">
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm">Competen</span>
          </Link>
          <nav className="flex flex-col gap-0.5 flex-1">
            {navItems.map(({ label, href, icon }) => (
              <Link key={label} href={href}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors">
                <span className="text-sm leading-none w-5 text-center">{icon}</span>
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="pt-4 border-t border-teal-800/60">
            {isAdmin && (
              <Link href="/admin/dashboard"
                className="flex items-center gap-2.5 px-3 py-2 mb-1 rounded-lg text-sm text-amber-300/80 hover:bg-amber-800/20 hover:text-amber-200 transition-colors">
                <span className="text-sm w-5 text-center">🏛️</span>
                <span>Admin Panel</span>
              </Link>
            )}
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">
                {firstName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-teal-400/60 text-[10px] capitalize">{profile?.role?.replace(/_/g, " ")}</p>
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

        {/* Main content — offset for desktop sidebar, top padding on mobile for hamburger */}
        <main className="flex-1 md:ml-56 px-4 md:px-6 pt-16 md:pt-8 pb-8 min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}
