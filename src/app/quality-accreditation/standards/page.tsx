import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Accreditation Standards (QAS-002) — the governed standards library
// (SafeCare / JCI / national), mapped to quality objects.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export default async function StandardsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin", "assessor"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin"); const hid = profile?.hospital_id ?? null;

  // Standards belong to quality_objects (hospital-owned), so scope via those.
  const objQ = admin.from("quality_objects").select("id, title, status, review_date").order("title").limit(3000);
  const { data: objs } = await (isSuper ? objQ : objQ.eq("hospital_id", hid ?? NONE));
  const objIds = (objs ?? []).map((o: any) => o.id);
  const objById = new Map((objs ?? []).map((o: any) => [o.id, o]));

  let standards: any[] = [];
  if (objIds.length) {
    const { data } = await admin.from("quality_standards").select("id, reference_code, title, quality_object_id").in("quality_object_id", objIds).order("reference_code").limit(3000);
    standards = data ?? [];
  }
  const card = "bg-white rounded-xl border border-gray-200 p-5";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accreditation Standards</h1>
          <p className="text-sm text-gray-500 mt-1">{standards.length} standards across {objIds.length} quality objects.</p>
        </div>
        <Link href="/admin/accreditation" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Accreditation programme →</Link>
      </div>

      <div className={card}>
        {standards.length === 0 && <p className="text-sm text-gray-400">No standards defined yet. Standards are authored against quality objects in the quality workspace.</p>}
        <div className="divide-y">
          {standards.map((s: any) => {
            const obj: any = objById.get(s.quality_object_id);
            return (
              <div key={s.id} className="py-2.5 flex items-center gap-3">
                {s.reference_code && <span className="text-xs font-mono text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5 shrink-0">{s.reference_code}</span>}
                <span className="text-sm text-gray-800">{s.title}</span>
                <span className="ml-auto text-xs text-gray-400">{obj?.title ?? ""}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
