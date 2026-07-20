import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OperationsConsole from "@/app/admin/operations/OperationsConsole";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const dynamic = "force-dynamic";

// Unit Performance (UMG-002) & Workforce Management (UMG-003) reuse the Clinical
// Operations console at unit level, opening the requested section's tab.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION_TAB: Record<string, string> = { command: "Command", shifts: "Shifts", ward: "Ward", assignments: "Assignments", safety: "Safety", care: "Care" };

export default async function UnitManagerOperationsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { ready, data, support } = await loadOpsConsoleData(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  return <OperationsConsole ready={ready} data={data} support={support} initialTab={SECTION_TAB[section ?? "command"] ?? "Command"} />;
}
