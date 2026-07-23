import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SEARCH_SOURCES } from "@/lib/platform/search";
import SearchConsole from "./SearchConsole";

export const dynamic = "force-dynamic";

// Platform Search console (PFS-000 Search / PCS-000 Search Index) — one search box
// over every indexed platform entity (tenants, orgs, users, frameworks, competencies,
// workspaces, activity). Server-side Postgres ILIKE; a dedicated search engine
// (Elasticsearch/OpenSearch) stays an honest infra-scale gap.

export default async function PlatformSearchConsole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🔍</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Platform Search</h1><p className="text-sm text-gray-500">Unified search across every platform entity — tenants, users, frameworks and more.</p></div></div>
        <Link href="/super-admin/platform-ops" className="text-xs text-teal-700 hover:underline shrink-0">← Platform Operations</Link>
      </div>

      <SearchConsole sources={SEARCH_SOURCES} />

      <p className="text-[11px] text-gray-400 pb-4">Platform Search (PFS-000 Search / PCS-000 Search Index) runs one query across tenants, organisations, users, frameworks, competencies, workspaces and the audit trail using Postgres ILIKE — the stack&apos;s native full-text capability. Each source is fail-soft. A dedicated search engine (Elasticsearch / OpenSearch) with ranking, facets and typo-tolerance remains an honest infra-scale gap, not pretended-built.</p>
    </div>
  );
}
