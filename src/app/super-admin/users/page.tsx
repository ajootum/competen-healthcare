import { requireHqCapability } from "@/lib/hq/context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UsersWorkspace from "./UsersWorkspace";
import { loadDirectory } from "./load-directory";
import { directoryStats, parseDirectoryFilters, parseUserParam, queryDirectory } from "@/lib/hq/user-directory-query";
import { viewMatches } from "@/lib/hq/account-classification";

// Landlord Portal — User Management (Design System spec §6). The rows are built in ./load-directory.ts.
// HQ users directory (2 Nov 2026): the profile opens over the list from ?user=<id> and loads its own detail from
// /api/super-admin/users/[id], so the per-page audit reads this file used to make for the drawer are gone.
// HQ-USERS-CLASSIFY-01: the filters, the account view and the pagination run HERE, on the server, so the browser
// receives one page. The URL is the whole query. With no ?view the configured default applies
// (hq_config.users_default_view, Active Humans unless changed), or All Accounts while migration 650 is absent.

export default async function AllUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Per-page guard (PLAT-ARCH-SURVEY-001 s2.5). Next 16: a layout auth check "will not prevent nested
  // route segments and Server Actions from being accessed" -- so the gate lives here, not upstairs.
  const { admin, isOwner, capabilities } = await requireHqCapability("hq.platform.users.view");

  const [dir, sp] = await Promise.all([loadDirectory(admin), searchParams]);
  const filters = parseDirectoryFilters(sp, dir.defaultView);
  const result = queryDirectory(dir.users, filters);
  // The profile that ?user= names, even when the current filters would not list it (a shared link, or a filter changed
  // behind an open profile). The full directory is already in memory here, so this is a lookup, not a read.
  const focusId = parseUserParam(sp);
  const focusUser = focusId ? dir.users.find(u => u.id === focusId) ?? null : null;

  return (
    <UsersWorkspace
      users={result.rows}
      total={result.total}
      page={result.page}
      pages={result.pages}
      viewCounts={result.viewCounts}
      stats={directoryStats(dir.users.filter(u => viewMatches(filters.view, u)))}
      filters={{ ...filters, page: result.page }}
      defaultView={dir.defaultView}
      classificationAvailable={dir.classificationAvailable}
      participationAvailable={dir.participationAvailable}
      focusUser={focusUser}
      hospitals={dir.hospitals}
      organisations={dir.organisations}
      departments={dir.departments}
      currentUserId={user.id}
      canManage={isOwner}
      canReset={isOwner || capabilities.includes("hq.platform.users.reset")}
      readable={dir.readable}
      authComplete={dir.authComplete}
    />
  );
}
