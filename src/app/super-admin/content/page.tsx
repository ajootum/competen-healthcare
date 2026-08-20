import { requireHqCapability } from "@/lib/hq/context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import FrameworkActions from "./FrameworkActions";

// The Studio lands straight in the framework workspace (the header there has a
// framework switcher and a + New button); this route just picks the landing
// framework — the core library first, else the first by name.

export default async function ContentHubPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Per-page guard (PLAT-ARCH-SURVEY-001 s2.5). Next 16: a layout auth check "will not prevent nested
  // route segments and Server Actions from being accessed" -- so the gate lives here, not upstairs.
  const { admin } = await requireHqCapability("hq.learning.content.view");
  const { data: frameworks } = await admin
    .from("frameworks")
    .select("id, name, library")
    .eq("is_active", true)
    .order("name");

  const landing = (frameworks ?? []).find(f => f.library === "core") ?? (frameworks ?? [])[0];
  if (landing) redirect(`/super-admin/content/${landing.id}`);

  return (
    <div className="max-w-md mx-auto text-center py-20">
      <p className="text-4xl mb-3">📐</p>
      <h1 className="text-lg font-bold text-gray-900">Clinical Knowledge &amp; Competency Studio</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">No frameworks yet — create the first one to start building.</p>
      <FrameworkActions />
    </div>
  );
}
