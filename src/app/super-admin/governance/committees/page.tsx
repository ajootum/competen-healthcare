import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CommitteesManager from "./CommitteesManager";

export default async function CommitteesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin"].includes(profile?.role ?? "")) redirect("/dashboard");

  const [{ data: committees }, { data: staff }] = await Promise.all([
    admin.from("governance_committees")
      .select("id, name, level, quorum, is_active, committee_members(id, role, profiles(id, full_name))")
      .order("level"),
    admin.from("profiles")
      .select("id, full_name, role")
      .in("role", ["hospital_admin", "educator", "assessor", "super_admin"])
      .order("full_name"),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Governance Committees</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Clinical governance bodies that review and approve competency content (Book I Ch.11).
        </p>
      </div>
      <CommitteesManager
        initialCommittees={(committees ?? []) as never}
        staff={(staff ?? []).map(s => ({ id: s.id, full_name: s.full_name, role: s.role }))}
      />
    </div>
  );
}
