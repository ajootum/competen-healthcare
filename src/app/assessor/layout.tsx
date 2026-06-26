import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const NAV = [
  { label: "Dashboard",     href: "/assessor",         icon: "🏠" },
  { label: "Audit Tools",   href: "/assessor/assess",  icon: "📋" },
  { label: "My Nurses",     href: "/assessor/nurses",  icon: "👩‍⚕️" },
  { label: "OSCE Sessions", href: "/assessor/osce",    icon: "🩺" },
  { label: "History",       href: "/assessor/history", icon: "📁" },
];

export default async function AssessorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile || !["assessor", "hospital_admin", "super_admin"].includes(profile.role)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Assessor access only</h1>
          <p className="text-gray-400 text-sm mt-1">This portal is for clinical assessors and supervisors.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <div className="flex">
        <aside className="hidden md:flex w-56 min-h-screen bg-[#0f172a] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <Link href="/" className="flex items-center gap-2 mb-6 px-2">
            <div className="w-7 h-7 rounded bg-indigo-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="text-white font-semibold text-sm">Competen</span>
          </Link>

          <div className="px-3 mb-4">
            <span className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest">Assessor Portal</span>
          </div>

          <nav className="flex flex-col gap-0.5 flex-1">
            {NAV.map(({ label, href, icon }) => (
              <Link key={label} href={href}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-indigo-900/40 hover:text-white transition-colors">
                <span className="w-5 text-center text-sm">{icon}</span>
                <span>{label}</span>
              </Link>
            ))}
            <div className="my-2 border-t border-slate-800/60" />
            <Link href="/dashboard"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-indigo-900/30 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span>Nurse Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-slate-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                {profile?.full_name?.[0] ?? "A"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-indigo-300/60 text-[10px]">Assessor</p>
              </div>
            </div>
            <form action="/api/auth/logout" method="POST">
              <button type="submit"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800/30 hover:text-white transition-colors">
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
