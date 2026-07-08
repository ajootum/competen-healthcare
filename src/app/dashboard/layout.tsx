import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import MobileSidebar from "./MobileSidebar";
import RoleSwitcher from "@/components/RoleSwitcher";
import { highestRole, type AppRole } from "@/lib/roles";

// Core navigation follows the Frontend User Structures spec: a short menu that
// answers "what am I competent in, what's next, what's pending, how do I grow".
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

const toolItems = [
  { label: "CPD Academy",    href: "/dashboard/courses",    icon: "🎓" },
  { label: "Question Bank",  href: "/dashboard/questions",  icon: "❓" },
  { label: "CPD Log",        href: "/dashboard/cpd",        icon: "⏱️" },
  { label: "Knowledge Hub",  href: "/dashboard/knowledge",  icon: "🔬" },
  { label: "AI Copilot",     href: "/dashboard/copilot",    icon: "🤖" },
  { label: "Simulation Lab", href: "/dashboard/simulation", icon: "🧪" },
  { label: "OSCE Platform",  href: "/dashboard/osce",       icon: "📋" },
  { label: "Audit Tools",    href: "/dashboard/audit",      icon: "📊" },
  { label: "Billing & Plan", href: "/dashboard/billing",    icon: "💳" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("full_name, role, roles")
    .eq("id", user.id)
    .single();

  const firstName = profile?.full_name?.split(" ")[0] ?? "Nurse";
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <MobileSidebar
        fullName={profile?.full_name ?? "Nurse"}
        role={profile?.role ?? "nurse"}
        isAdmin={profile?.role === "hospital_admin"}
      />

      <div className="flex">
        <aside className="hidden md:flex w-56 min-h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <Link href="/" className="flex items-center gap-2 mb-6 px-2">
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm">Competen</span>
          </Link>
          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {navItems.map(({ label, href, icon }) => (
              <Link key={label} href={href}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors">
                <span className="text-sm leading-none w-5 text-center">{icon}</span>
                <span>{label}</span>
              </Link>
            ))}
            <p className="px-3 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-teal-400/40">Tools</p>
            {toolItems.map(({ label, href, icon }) => (
              <Link key={label} href={href}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
                <span className="text-sm leading-none w-5 text-center">{icon}</span>
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="pt-4 border-t border-teal-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">
                {firstName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-teal-400/60 text-[10px]">Nurse</p>
              </div>
            </div>
            {userRoles.some(r => ["educator", "assessor"].includes(r)) && (
              <div className="mb-2">
                <RoleSwitcher roles={userRoles} activeRole={activeRole} />
              </div>
            )}
            <form action="/api/auth/logout" method="POST">
              <button type="submit"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-teal-100/50 hover:bg-teal-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span>
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        <main className="flex-1 md:ml-56 px-4 md:px-6 pt-16 md:pt-8 pb-8 min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}
