import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OperationsConsole from "@/app/admin/operations/OperationsConsole";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const dynamic = "force-dynamic";

// Supervisor operational sections (Patient Ops / Staff Ops / Coordination /
// Safety / Tasks) — reuse the Clinical Operations console, opening the tab that
// matches the requested sidebar section. Gated to operational coordinators.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION_TAB: Record<string, string> = {
  ward: "Ward", shifts: "Shifts", assignments: "Assignments", safety: "Safety", care: "Care", command: "Command",
};

export default async function SupervisorOperationsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { ready, data, support } = await loadOpsConsoleData(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  return <OperationsConsole ready={ready} data={data} support={support} initialTab={SECTION_TAB[section ?? "command"] ?? "Command"} />;
}
