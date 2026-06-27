import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OrgManager from "./OrgManager";

export default async function OrganisationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: orgs } = await admin
    .from("organisations")
    .select("id, name, group_name, type, country, region, is_active, created_at")
    .order("country")
    .order("name");

  const { data: hospitals } = await admin
    .from("hospitals")
    .select("id, name, type, country, city, tier, organisation_id")
    .order("country")
    .order("name");

  // Group hospitals by organisation
  const hospitalsByOrg = (hospitals ?? []).reduce((acc, h) => {
    const key = h.organisation_id ?? "__none__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(h);
    return acc;
  }, {} as Record<string, typeof hospitals>);

  const TYPE_COLORS: Record<string, string> = {
    government:   "bg-blue-100 text-blue-700",
    private:      "bg-green-100 text-green-700",
    ngo:          "bg-purple-100 text-purple-700",
    faith_based:  "bg-amber-100 text-amber-700",
    academic:     "bg-rose-100 text-rose-700",
  };

  const FACILITY_ICON: Record<string, string> = {
    hospital:            "🏥",
    clinic:              "🏪",
    health_center:       "🏠",
    nursing_home:        "🏡",
    diagnostic_center:   "🔬",
  };

  // Countries represented
  const countries = [...new Set([
    ...(orgs ?? []).map(o => o.country),
    ...(hospitals ?? []).map(h => h.country),
  ])].sort();

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Organisations</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {(orgs ?? []).length} organisations · {(hospitals ?? []).length} facilities · {countries.length} countries
          </p>
        </div>
        <OrgManager />
      </div>

      {/* Country summary chips */}
      <div className="flex flex-wrap gap-2 mb-8">
        {countries.map(c => (
          <span key={c} className="px-3 py-1 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-600">
            🌍 {c}
          </span>
        ))}
      </div>

      {/* Organisations with their facilities */}
      {(orgs ?? []).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🏛️</p>
          <p className="text-gray-500 text-sm font-medium">No organisations yet</p>
          <p className="text-gray-400 text-xs mt-1">Click &quot;+ Add Organisation&quot; to create your first group.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {(orgs ?? []).map(org => {
            const facilities = hospitalsByOrg[org.id] ?? [];
            return (
              <div key={org.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-rose-600 text-lg shrink-0">🏛️</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{org.name}</p>
                        {org.group_name && (
                          <span className="text-xs text-gray-400">({org.group_name})</span>
                        )}
                        {!org.is_active && (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Inactive</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {org.region ? `${org.region}, ` : ""}{org.country}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${TYPE_COLORS[org.type] ?? "bg-gray-100 text-gray-600"}`}>
                      {org.type.replace("_", " ")}
                    </span>
                    <span className="text-xs text-gray-400">{facilities.length} facilit{facilities.length !== 1 ? "ies" : "y"}</span>
                  </div>
                </div>
                {facilities.length > 0 && (
                  <div className="divide-y divide-gray-50">
                    {facilities.map(f => (
                      <div key={f.id} className="flex items-center gap-3 px-5 py-3 pl-14">
                        <span className="text-sm">{FACILITY_ICON[f.type ?? "hospital"] ?? "🏥"}</span>
                        <div className="flex-1">
                          <p className="text-sm text-gray-800 font-medium">{f.name}</p>
                          <p className="text-[10px] text-gray-400">{f.city ? `${f.city}, ` : ""}{f.country}</p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded capitalize ${
                          f.tier === "enterprise" ? "bg-purple-100 text-purple-700"
                          : f.tier === "professional" ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600"
                        }`}>{f.tier}</span>
                        <span className="text-[10px] text-gray-400 capitalize">{f.type?.replace("_", " ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Unlinked facilities */}
          {(hospitalsByOrg["__none__"] ?? []).length > 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Unlinked Facilities</p>
              </div>
              <div className="divide-y divide-gray-50">
                {(hospitalsByOrg["__none__"] ?? []).map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-sm">{FACILITY_ICON[f.type ?? "hospital"] ?? "🏥"}</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{f.name}</p>
                      <p className="text-[10px] text-gray-400">{f.city ? `${f.city}, ` : ""}{f.country}</p>
                    </div>
                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">No organisation</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
