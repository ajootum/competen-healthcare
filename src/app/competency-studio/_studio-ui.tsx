// Shared guard for the peer Competency Studio workspace (/competency-studio). The layout provides the
// shell + gate; each module page calls studioGuard() to resolve {admin, isSuper, hid} and enforce the
// broader author audience (super_admin / hospital_admin / educator / assessor) — the same roles the
// /api/studio* write routes already accept. Non-super callers are hospital-scoped by the loaders.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const STUDIO_ROLES = ["super_admin", "hospital_admin", "educator", "assessor"];

export async function studioGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const isSuper = roles.includes("super_admin");
  const hid = (profile?.hospital_id ?? null) as string | null;
  if (!roles.some(r => STUDIO_ROLES.includes(r))) redirect("/dashboard");
  return { admin, isSuper, hid, roles, userId: user.id, fullName: (profile?.full_name ?? null) as string | null };
}
