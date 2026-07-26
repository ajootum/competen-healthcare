import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// Hospital Executive Workspace kit (HEX-000..012). Reuses the shared presentational + chart kit from the
// Quality & Accreditation workspace (same design language) and adds an executive-scoped guard. Executive
// dashboards aggregate across domains, so modules mostly compose existing tenant-scoped loaders.
/* eslint-disable @typescript-eslint/no-explicit-any */

export { Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Gauge, Ring, Table, QuickActions, Foot, Provision, TONE, T, ragPct, NONE } from "@/app/quality-accreditation/_ui";

const ALLOWED = ["hospital_admin", "super_admin"];

// Executive guard — hospital leadership only. Returns the scope every module needs.
export async function hexGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");
  const cookieStore = await cookies();
  const hospitalCookie = cookieStore.get("active_hospital")?.value ?? null;
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? hospitalCookie ?? null;
  return { admin, user, profile, roles, isSuper, hid, fullName: profile?.full_name ?? "Executive" };
}
