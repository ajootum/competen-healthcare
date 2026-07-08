import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MetadataManager from "./MetadataManager";

export default async function MetadataPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [{ data: taxonomies }, { data: terms }, { data: tags }] = await Promise.all([
    admin.from("taxonomies").select("id, kind, label").order("label"),
    admin.from("taxonomy_terms").select("id, taxonomy_id, value, code, sort_order").order("sort_order"),
    admin.from("tags").select("id, name, category").order("category").order("name"),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Metadata &amp; Taxonomy</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Controlled vocabularies and governed tags — the common language of the CKCM (Book I Ch.13).
        </p>
      </div>
      <MetadataManager
        taxonomies={taxonomies ?? []}
        terms={terms ?? []}
        tags={tags ?? []}
      />
    </div>
  );
}
