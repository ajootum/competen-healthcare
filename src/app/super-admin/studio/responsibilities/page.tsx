import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ResponsibilitiesManager from "./ResponsibilitiesManager";

// Ownership & Responsibilities (User Account Architecture §15) — every
// published content object should have an identifiable, accountable owner.

export default async function ResponsibilitiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [{ data: resp }, { data: staff }, { data: frameworks }, { data: cpus }, { data: banks }] = await Promise.all([
    admin.from("content_responsibilities")
      .select("id, user_id, content_type, content_id, content_name, responsibility_type, review_due, start_date, profiles!user_id(full_name)")
      .eq("status", "active").order("created_at", { ascending: false }),
    admin.from("profiles").select("id, full_name, role").in("role", ["super_admin", "hospital_admin", "educator", "assessor"]).order("full_name"),
    admin.from("frameworks").select("id, name").eq("is_active", true).order("name"),
    admin.from("clinical_practice_units").select("id, name").order("name"),
    admin.from("question_banks").select("id, name").eq("is_active", true).order("name"),
  ]);

  const rows = (resp ?? []).map(r => ({
    id: r.id, content_type: r.content_type, content_id: r.content_id,
    content_name: r.content_name ?? "—",
    responsibility_type: r.responsibility_type,
    review_due: r.review_due, start_date: r.start_date,
    holder: (r.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
  }));

  const objects = [
    ...(frameworks ?? []).map(f => ({ type: "framework", id: f.id, label: `Framework · ${f.name}` })),
    ...(cpus ?? []).map(c => ({ type: "cpu", id: c.id, label: `CPU · ${c.name}` })),
    ...(banks ?? []).map(b => ({ type: "question_bank", id: b.id, label: `Question bank · ${b.name}` })),
  ];

  // Published CPUs without a product owner — the spec's headline rule
  const owned = new Set(rows.filter(r => r.content_type === "cpu" && r.responsibility_type === "product_owner").map(r => r.content_id));
  const orphanCpus = (cpus ?? []).filter(c => !owned.has(c.id));

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Ownership &amp; Responsibilities</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Ownership &amp; Responsibilities</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Roles define what people can do — responsibilities make them accountable for specific content.
        </p>
      </div>

      {orphanCpus.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800">
          ⚠️ {orphanCpus.length} CPU{orphanCpus.length !== 1 ? "s" : ""} without a Product Owner: {orphanCpus.map(c => c.name).join(", ")}
        </div>
      )}

      <ResponsibilitiesManager
        rows={rows as never}
        staff={(staff ?? []) as never}
        objects={objects as never}
      />
    </div>
  );
}
