import { requireHqCapability } from "@/lib/hq/context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UsersWorkspace, { type AuditEntry, type ClassificationEntry } from "./UsersWorkspace";
import { loadDirectory } from "./load-directory";
import { directoryStats, parseDirectoryFilters, queryDirectory } from "@/lib/hq/user-directory-query";
import { viewMatches } from "@/lib/hq/account-classification";

// Landlord Portal — User Management (Design System spec §6). The rows are built in ./load-directory.ts.
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
  const pageIds = result.rows.map(u => u.id);

  // History for the drawer, for this page's people only: what they did, and how their account was classified.
  const [{ data: audit }, { data: classAudit }] = await Promise.all([
    pageIds.length
      ? admin.from("audit_log")
          .select("id, actor_id, actor_name, action, entity_type, entity_name, created_at")
          .in("actor_id", pageIds)
          .order("created_at", { ascending: false }).limit(400)
      : Promise.resolve({ data: [] }),
    pageIds.length
      ? admin.from("audit_log")
          .select("id, actor_name, entity_id, old_value, new_value, created_at")
          .eq("action", "hq_account_classified").in("entity_id", pageIds)
          .order("created_at", { ascending: false }).limit(400)
      : Promise.resolve({ data: [] }),
  ]);

  const auditByActor = new Map<string, AuditEntry[]>();
  for (const e of (audit ?? []) as { id: string; actor_id: string | null; action: string; entity_type: string | null; entity_name: string | null; created_at: string }[]) {
    if (!e.actor_id) continue;
    const list = auditByActor.get(e.actor_id) ?? [];
    if (list.length < 15) list.push({
      id: e.id, action: e.action, entityType: e.entity_type ?? null,
      entityName: e.entity_name ?? null, at: e.created_at,
    });
    auditByActor.set(e.actor_id, list);
  }

  const classHistory = new Map<string, ClassificationEntry[]>();
  type ClassAuditRow = { id: string; actor_name: string | null; entity_id: string; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null; created_at: string };
  for (const e of (classAudit ?? []) as ClassAuditRow[]) {
    const list = classHistory.get(e.entity_id) ?? [];
    if (list.length < 10) list.push({
      id: e.id, at: e.created_at, by: e.actor_name ?? "System (migration 650)",
      from: String(e.old_value?.account_type ?? "unclassified"), to: String(e.new_value?.account_type ?? ""),
      reason: typeof e.new_value?.reason === "string" ? e.new_value.reason : null,
    });
    classHistory.set(e.entity_id, list);
  }

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
      classificationHistory={Object.fromEntries(classHistory)}
      auditByActor={Object.fromEntries(auditByActor)}
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
