import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { estateRolesOf } from "@/lib/roles";

// Office Governance System (OGS-000..010) shared kit. OGS is a horizontal governance platform service
// (offices, charters, appointments, delegations, meetings, decisions, analytics, audit). Reuses the shared
// QAW presentational/chart kit and adds an executive-scoped guard. Grounds in the existing governance
// stores (governance_committees = offices, committee_members = appointments, adm_delegations, change_requests,
// audit_log = governance events) — the full ogs_* charter/meeting/vote model is a next-phase migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

export { Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Gauge, Ring, Table, QuickActions, Foot, Provision, TONE, T, ragPct, NONE } from "@/app/quality-accreditation/_ui";

const ALLOWED = ["hospital_admin", "super_admin"];

// OGS guard — governance authority (executives / governance leaders) only.
export async function ogsGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");
  const cookieStore = await cookies();
  const selected = cookieStore.get("active_hospital")?.value ?? null;
  const isSuperRole = roles.includes("super_admin");
  let hid: string | null, isSuper: boolean;
  if (isSuperRole && selected && selected !== "all") { hid = selected; isSuper = false; }
  else if (isSuperRole) { hid = null; isSuper = true; }
  else { hid = profile?.hospital_id ?? null; isSuper = false; }
  return { admin, user, profile, roles, isSuper, hid, fullName: profile?.full_name ?? "Governance lead" };
}
