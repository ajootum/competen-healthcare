import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { loadFacilityProfile } from "@/lib/enterprise/facilities";
import FacilityProfileClient from "./FacilityProfileClient";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function FacilityProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.executive.enterprise.view");

  const data = await loadFacilityProfile(admin, id);
  if (!data) notFound();
  return <FacilityProfileClient data={data} />;
}
