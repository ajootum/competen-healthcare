import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { loadNetworkProfile } from "@/lib/enterprise/networks";
import NetworkProfileClient from "./NetworkProfileClient";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function NetworkProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const data = await loadNetworkProfile(admin, id);
  if (!data) notFound();

  // Organisations available to add as members (not yet in any network).
  const { data: avail } = await admin.from("organisations").select("id, name, hq_country").is("enterprise_id", null).order("name").limit(500);
  return <NetworkProfileClient data={data} available={(avail ?? []).map((o: any) => ({ id: o.id, name: o.name, country: o.hq_country ?? "—" }))} />;
}
