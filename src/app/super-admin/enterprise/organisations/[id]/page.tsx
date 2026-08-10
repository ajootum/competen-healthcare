import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { loadOrgProfile } from "@/lib/enterprise/organisations";
import OrgProfileClient from "./OrgProfileClient";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function OrgProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.executive.enterprise.view");

  const data = await loadOrgProfile(admin, id);
  if (!data) notFound();

  return <OrgProfileClient data={data} />;
}
