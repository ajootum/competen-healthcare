import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { buildEvidenceCentre } from "@/lib/evidence-centre";
import EvidenceCentre from "./EvidenceCentre";

// Evidence Validation Centre (Evidence Validation Centre spec): the assessor's
// centralised review workflow — smart queue with filters, a split review panel
// with evidence viewer links, competency mapping, timeline and decision
// actions, and live KPIs including real average review time. The data
// assembly lives in @/lib/evidence-centre, shared with the educator shell.

export default async function EvidenceValidationCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { entries, kpis, isSenior } = await buildEvidenceCentre(user.id);
  return <EvidenceCentre entries={entries} kpis={kpis} isSenior={isSenior} />;
}
