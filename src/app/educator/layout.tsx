import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import RoleSwitcher from "@/components/RoleSwitcher";
import { highestRole, type AppRole } from "@/lib/roles";

const NAV = [
  { label: "Dashboard",       href: "/educator",            icon: "🏠" },
  { label: "Validation",      href: "/educator",            icon: "✅" },
  { label: "My Courses",      href: "/educator/courses",    icon: "📚" },
  { label: "Question Bank",   href: "/educator/questions",  icon: "❓" },
  { label: "Student Progress",href: "/educator/students",   icon: "📈" },
  { label: "Senior Assessors",href: "/educator/seniors",    icon: "⭐" },
  { label: "Content Library", href: "/educator/library",    icon: "🗂️" },
  { label: "Bulk Import",      href: "/educator/import",     icon: "📥" },
  { label: "Assessor View",   href: "/assessor",            icon: "🔍" },
];

export default async function EducatorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("full_name, role, roles")
    .eq("id", user.id)
    .single();

  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  if (!userRoles.includes("educator")) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Educator access only</h1>
          <p className="text-gray-400 text-sm mt-1">This portal is for nurse educators and content creators.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <div className="flex">
        <aside className="hidden md:flex w-56 h-screen bg-[#1a0a38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <Link href="/" className="flex items-center gap-2 mb-6 px-2">
            <div className="w-7 h-7 rounded bg-purple-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm">Competen</span>
          </Link>

          <div className="px-3 mb-4">
            <span className="text-[10px] font-bold text-purple-400/70 uppercase tracking-widest">Educator Portal</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={href === "/educator"}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-purple-200/60 hover:bg-purple-900/40 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-purple-900/60 text-white font-medium" />
            ))}
            <div className="my-2 border-t border-purple-900/40" />
            <Link href="/dashboard"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-purple-200/30 hover:bg-purple-900/30 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span>Nurse Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-purple-900/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-bold">
                {profile?.full_name?.[0] ?? "E"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-purple-300/60 text-[10px]">Educator</p>
              </div>
            </div>
            {userRoles.length > 1 && (
              <div className="mb-2">
                <RoleSwitcher roles={userRoles} activeRole={activeRole} />
              </div>
            )}
            <form action="/api/auth/logout" method="POST">
              <button type="submit"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-purple-200/40 hover:bg-purple-900/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span>
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        <main className="flex-1 md:ml-56 px-4 md:px-6 py-8 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
