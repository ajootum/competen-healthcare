import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import SidebarToggle from "@/components/SidebarToggle";
import WorkspaceSidebar from "./_components/WorkspaceSidebar";
import { highestRole, type AppRole } from "@/lib/roles";

// Sidebar IA aligned to the Mission Control model (MC-001). The nav config and
// its Clinical Knowledge Platform branch live in the WorkspaceSidebar client
// component (it swaps to the CKP shell on /super-admin/ckp routes).

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, role, roles")
    .eq("id", user.id)
    .single();

  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;
  // Dedicated org-role workspaces this user can switch into (normally none for landlord-only super admins).
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);

  if (!userRoles.includes("super_admin")) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Super Admin only</h1>
          <p className="text-gray-400 text-sm mt-1">This portal is for platform administrators.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Go to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0f1923] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <WorkspaceSidebar profileName={profile?.full_name ?? null} roles={userRoles} activeRole={activeRole} workspaces={workspaces} />
        </aside>

        {/* Pages stay readable at max-w-6xl; a workspace page opts out of the
            cap by rendering data-wide on its root (rule in globals.css). */}
        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 py-8 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
