import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AssessmentSession, { type NurseOption } from "./AssessmentSession";

// Clinical Competency Assessment (Enterprise Clinical Assessment Engine spec):
// server shell fetches the logged-in assessor's profile and the hospital's
// nurses for the real session-details pickers, then mounts the client
// workspace. The old audit tools live on at /dashboard/audit/concurrent and
// /dashboard/audit/chart.

export default async function ClinicalAssessmentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles")
    .select("id, full_name, role, hospital_id")
    .eq("id", user.id).single();

  let nurseQuery = admin.from("profiles")
    .select("id, full_name, role")
    .eq("role", "nurse")
    .order("full_name");
  if (me?.hospital_id) nurseQuery = nurseQuery.eq("hospital_id", me.hospital_id);
  const { data: nurses } = await nurseQuery.limit(200);

  return (
    <AssessmentSession
      assessorName={me?.full_name ?? "—"}
      assessorRole={(me?.role ?? "").replace(/_/g, " ")}
      nurses={(nurses ?? []) as NurseOption[]}
    />
  );
}
