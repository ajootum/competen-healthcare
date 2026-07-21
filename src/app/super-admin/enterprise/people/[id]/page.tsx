import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { loadPersonProfile } from "@/lib/enterprise/people";
import { ASSIGNABLE_ROLES, EMPLOYMENT_TYPES, ACCOUNT_STATUSES } from "@/lib/enterprise/people";
import PersonProfileClient from "./PersonProfileClient";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const data = await loadPersonProfile(admin, id);
  if (!data) notFound();
  return <PersonProfileClient data={data} assignableRoles={ASSIGNABLE_ROLES} employmentTypes={EMPLOYMENT_TYPES} accountStatuses={[...ACCOUNT_STATUSES]} />;
}
