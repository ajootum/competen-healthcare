import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OrgManager from "./OrgManager";

const TYPE_COLORS: Record<string, string> = {
  government:  "bg-blue-100 text-blue-700",
  private:     "bg-green-100 text-green-700",
  ngo:         "bg-purple-100 text-purple-700",
  faith_based: "bg-amber-100 text-amber-700",
  academic:    "bg-rose-100 text-rose-700",
};

const FACILITY_ICON: Record<string, string> = {
  hospital:          "🏥",
  clinic:            "🏪",
  health_center:     "🏠",
  nursing_home:      "🏡",
  diagnostic_center: "🔬",
};

const COUNTRY_FLAGS: Record<string, string> = {
  "Kenya": "🇰🇪", "Uganda": "🇺🇬", "Tanzania": "🇹🇿", "Nigeria": "🇳🇬",
  "Ghana": "🇬🇭", "South Africa": "🇿🇦", "Ethiopia": "🇪🇹", "Rwanda": "🇷🇼",
  "Zambia": "🇿🇲", "Zimbabwe": "🇿🇼", "Malawi": "🇲🇼", "Mozambique": "🇲🇿",
  "Botswana": "🇧🇼", "Namibia": "🇳🇦", "Senegal": "🇸🇳", "Cameroon": "🇨🇲",
  "Côte d'Ivoire": "🇨🇮", "Mali": "🇲🇱", "Sudan": "🇸🇩", "Egypt": "🇪🇬",
  "Morocco": "🇲🇦", "Tunisia": "🇹🇳", "Algeria": "🇩🇿",
};

export default async function OrganisationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: orgs } = await admin
    .from("organisations")
    .select("id, name, group_name, type, hq_country, region, description, is_active")
    .order("name");

  const { data: hospitals } = await admin
    .from("hospitals")
    .select("id, name, type, country, city, tier, organisation_id")
    .order("country")
    .order("name");

  const { data: staff } = await admin
    .from("profiles")
    .select("id, role, hospital_id")
    .in("role", ["nurse", "assessor", "educator", "hospital_admin"]);

  // Facilities grouped: org → country → facilities[]
  type Facility = { id: string; name: string; type?: string; country: string; city?: string; tier?: string; organisation_id?: string };
  const facilityByOrg = (hospitals ?? []).reduce((acc, h) => {
    const key = h.organisation_id ?? "__none__";
    if (!acc[key]) acc[key] = {};
    const cKey = h.country ?? "Unknown";
    if (!acc[key][cKey]) acc[key][cKey] = [];
    acc[key][cKey].push(h as Facility);
    return acc;
  }, {} as Record<string, Record<string, Facility[]>>);

  // Staff counts per hospital
  const staffByHospital = (staff ?? []).reduce((acc, s) => {
    if (!s.hospital_id) return acc;
    if (!acc[s.hospital_id]) acc[s.hospital_id] = { nurse: 0, assessor: 0, educator: 0, hospital_admin: 0 };
    acc[s.hospital_id][s.role as keyof typeof acc[string]]++;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  // All countries represented
  const allCountries = [...new Set((hospitals ?? []).map(h => h.country).filter(Boolean))].sort();

  const totalFacilities = (hospitals ?? []).length;
  const linkedFacilities = (hospitals ?? []).filter(h => h.organisation_id).length;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Organisations</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {(orgs ?? []).length} groups · {totalFacilities} facilities · {allCountries.length} countries
          </p>
        </div>
        <OrgManager />
      </div>

      {/* Country footprint summary */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Country footprint</p>
        <div className="flex flex-wrap gap-2">
          {allCountries.map(c => {
            const count = (hospitals ?? []).filter(h => h.country === c).length;
            return (
              <span key={c} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs font-medium text-gray-700">
                <span>{COUNTRY_FLAGS[c] ?? "🌍"}</span>
                <span>{c}</span>
                <span className="text-gray-400">({count})</span>
              </span>
            );
          })}
          {!allCountries.length && <p className="text-xs text-gray-400 italic">No facilities added yet</p>}
        </div>
      </div>

      {/* Organisation groups */}
      <div className="flex flex-col gap-6">
        {(orgs ?? []).map(org => {
          const byCountry = facilityByOrg[org.id] ?? {};
          const countries = Object.keys(byCountry).sort();
          const totalFacil = countries.reduce((s, c) => s + (byCountry[c]?.length ?? 0), 0);
          const totalNurses = countries.reduce((s, c) =>
            s + (byCountry[c] ?? []).reduce((fs, f) => fs + (staffByHospital[f.id]?.nurse ?? 0), 0), 0);

          return (
            <div key={org.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {/* Org header */}
              <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-xl shrink-0">🏛️</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900">{org.name}</p>
                      {!org.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactive</span>}
                    </div>
                    {org.group_name && <p className="text-xs text-gray-400">{org.group_name}</p>}
                    {org.description && <p className="text-xs text-gray-400 mt-0.5 max-w-md">{org.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">{totalFacil} facilit{totalFacil !== 1 ? "ies" : "y"}</p>
                    <p className="text-[10px] text-gray-400">{countries.length} countr{countries.length !== 1 ? "ies" : "y"} · {totalNurses} nurses</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg capitalize ${TYPE_COLORS[org.type] ?? "bg-gray-100 text-gray-600"}`}>
                    {org.type.replace("_", " ")}
                  </span>
                </div>
              </div>

              {/* Countries within this org */}
              {countries.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {countries.map(country => {
                    const facilities = byCountry[country] ?? [];
                    const flag = COUNTRY_FLAGS[country] ?? "🌍";
                    const countryNurses = facilities.reduce((s, f) => s + (staffByHospital[f.id]?.nurse ?? 0), 0);
                    const countryAssessors = facilities.reduce((s, f) => s + (staffByHospital[f.id]?.assessor ?? 0), 0);

                    return (
                      <div key={country}>
                        {/* Country header */}
                        <div className="flex items-center justify-between px-5 py-2.5 pl-14 bg-gray-50/50 border-b border-gray-50">
                          <div className="flex items-center gap-2">
                            <span>{flag}</span>
                            <p className="text-sm font-semibold text-gray-700">{country}</p>
                            <span className="text-[10px] text-gray-400">{facilities.length} facilit{facilities.length !== 1 ? "ies" : "y"}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-gray-400">
                            {countryNurses > 0 && <span>{countryNurses} nurses</span>}
                            {countryAssessors > 0 && <span>{countryAssessors} assessors</span>}
                          </div>
                        </div>

                        {/* Facilities in this country */}
                        {facilities.map(f => {
                          const fs = staffByHospital[f.id] ?? {};
                          return (
                            <div key={f.id} className="flex items-center gap-3 px-5 py-3 pl-20 hover:bg-gray-50/30 transition-colors">
                              <span className="text-base">{FACILITY_ICON[f.type ?? "hospital"] ?? "🏥"}</span>
                              <div className="flex-1">
                                <p className="text-sm text-gray-800 font-medium">{f.name}</p>
                                <p className="text-[10px] text-gray-400">{f.city ? `${f.city} · ` : ""}{f.type?.replace("_", " ")}</p>
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                                {(fs.nurse ?? 0) > 0 && <span>{fs.nurse} nurses</span>}
                                {(fs.assessor ?? 0) > 0 && <span>{fs.assessor} assessors</span>}
                              </div>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${
                                f.tier === "enterprise" ? "bg-purple-100 text-purple-700"
                                : f.tier === "professional" ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-500"
                              }`}>{f.tier}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-4 pl-14 text-xs text-gray-400 italic">
                  No facilities linked to this organisation yet — use the Facilities tab in &quot;+ Add&quot; to add them
                </div>
              )}
            </div>
          );
        })}

        {/* Unlinked facilities */}
        {(facilityByOrg["__none__"] && Object.keys(facilityByOrg["__none__"]).length > 0) && (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/30">
              <p className="text-xs font-semibold text-amber-700">⚠ Unlinked Facilities</p>
              <p className="text-[10px] text-gray-400 mt-0.5">These facilities are not linked to any organisation group</p>
            </div>
            {Object.entries(facilityByOrg["__none__"] ?? {}).map(([country, facilities]) => (
              <div key={country}>
                <div className="px-5 py-2 bg-gray-50/50 border-b border-gray-50">
                  <p className="text-xs font-semibold text-gray-500">{COUNTRY_FLAGS[country] ?? "🌍"} {country}</p>
                </div>
                {facilities.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-5 py-3 pl-10">
                    <span>{FACILITY_ICON[f.type ?? "hospital"] ?? "🏥"}</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{f.name}</p>
                      <p className="text-[10px] text-gray-400">{f.city}</p>
                    </div>
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">No org linked</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!(orgs ?? []).length && (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <p className="text-3xl mb-3">🏛️</p>
            <p className="text-gray-500 text-sm font-medium">No organisations yet</p>
            <p className="text-gray-400 text-xs mt-1">Click &quot;+ Add&quot; to create your first organisation group.</p>
          </div>
        )}
      </div>
    </div>
  );
}
