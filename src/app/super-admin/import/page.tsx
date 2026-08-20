import { requireHqCapability } from "@/lib/hq/context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BulkImport from "@/components/BulkImport";

export default async function ImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Per-page guard (PLAT-ARCH-SURVEY-001 s2.5). Next 16: a layout auth check "will not prevent nested
  // route segments and Server Actions from being accessed" -- so the gate lives here, not upstairs.
  const { admin } = await requireHqCapability("hq.learning.import.view");
  const { data: hospitals } = await admin
    .from("hospitals")
    .select("id, name, country")
    .order("country").order("name");

  const list = (hospitals ?? []).map(h => ({
    id: h.id as string,
    name: h.name as string,
    country: (h as Record<string, string>).country ?? "",
  }));

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Bulk Import Users</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Assign users to facilities and update their roles in bulk across any facility on the platform.
        </p>
      </div>
      <BulkImport hospitals={list} />
    </div>
  );
}
