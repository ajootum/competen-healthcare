import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Auth + role gate shared by the Educator Validation Centre module pages.
export async function requireEducatorAccess() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id, full_name").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  return { admin, hospitalId: me?.hospital_id ?? null, userId: user!.id, name: me?.full_name ?? "Educator", roles };
}
