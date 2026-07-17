import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import VerifyQueue, { type PendingEntry } from "./VerifyQueue";

// Logbook Verification — supervisors review workers' self-logged skills
// (Skills Logbook Redesign spec: log → review → approve/reject/request changes).

export default async function LogbookVerificationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { data: raw } = await admin.from("skill_log_entries")
    .select("id, skill_name, performed_at, location, supervision_level, notes, status, created_at, profiles!nurse_id(full_name), framework_competencies!competency_id(name)")
    .eq("status", "pending").neq("nurse_id", user.id)
    .order("created_at", { ascending: true }).limit(100);

  const entries: PendingEntry[] = ((raw ?? []) as unknown as {
    id: string; skill_name: string; performed_at: string; location: string | null;
    supervision_level: string; notes: string | null; created_at: string;
    profiles: { full_name: string } | null; framework_competencies: { name: string } | null;
  }[]).map(e => ({
    id: e.id, skillName: e.skill_name, nurseName: e.profiles?.full_name ?? "—",
    competencyName: e.framework_competencies?.name ?? null,
    performedAt: e.performed_at, location: e.location,
    supervision: e.supervision_level, notes: e.notes, loggedAt: e.created_at,
  }));

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Logbook Verification</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Skills your workers logged themselves, awaiting your review. Verified entries join their professional record.
        </p>
      </div>
      <VerifyQueue entries={entries} />
    </div>
  );
}
