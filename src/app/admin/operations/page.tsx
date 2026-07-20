import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OperationsConsole from "./OperationsConsole";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const dynamic = "force-dynamic";

// Clinical Operations Engine — Shift Operations Centre (COE-001, Phase 1).
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OperationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { ready, data, support } = await loadOpsConsoleData(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  return <OperationsConsole ready={ready} data={data} support={support} />;
}
