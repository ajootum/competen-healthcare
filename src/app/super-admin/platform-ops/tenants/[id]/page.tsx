import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { loadTenantProfile } from "@/lib/platform/tenants";
import TenantProfileClient from "./TenantProfileClient";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TenantProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const data = await loadTenantProfile(admin, id);
  if (!data) notFound();
  return <TenantProfileClient data={data} />;
}
