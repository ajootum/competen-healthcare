import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import WardConfigClient from "./WardConfigClient";

export const dynamic = "force-dynamic";

// Ward Configuration (SSW-001) — the Director of Nursing's setup surface for bed
// capacity, mandatory staffing standards and the clinical round schedule. These
// feed the Shift Command Centre's real ratio-compliance and planned-round
// timeline. Any operational supervisor may view; only the Director of Nursing
// (or an admin) may edit. Degrades gracefully before migration 046 is applied.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";

export default async function WardConfigPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, org_role, org_roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const orgRoles: string[] = (profile?.org_roles?.length ? profile.org_roles : [profile?.org_role]).filter(Boolean);
  const canEdit = roles.includes("hospital_admin") || isSuper || orgRoles.includes("director_of_nursing");
  const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const probe = await admin.from("op_staffing_standards").select("id").limit(1);
  const configReady = !(probe.error && /does not exist|schema cache/i.test(probe.error.message ?? ""));

  const [bedsRes, deptRes, stdRes, roundRes] = await Promise.all([
    scope(admin.from("op_beds").select("*, departments!department_id(name)").order("label")).limit(500),
    admin.from("departments").select("id, name").eq("hospital_id", hid ?? "").order("name"),
    configReady ? scope(admin.from("op_staffing_standards").select("*, departments!department_id(name)").order("shift_type")) : Promise.resolve({ data: [] }),
    configReady ? scope(admin.from("op_round_schedule").select("*, departments!department_id(name)").order("at_time")) : Promise.resolve({ data: [] }),
  ]);

  return (
    <WardConfigClient
      canEdit={canEdit}
      configReady={configReady}
      beds={bedsRes.data ?? []}
      departments={deptRes.data ?? []}
      standards={stdRes.data ?? []}
      rounds={roundRes.data ?? []}
    />
  );
}
