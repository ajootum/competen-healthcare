import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DeptManager from "./DeptManager";

export default async function DepartmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient().from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin","super_admin"].includes(profile.role)) redirect("/dashboard");

  const admin = createAdminClient();
  const hospitalId = profile.hospital_id;

  const { data: hospital } = await admin.from("hospitals").select("id, name, type, city, country, organisation_id").eq("id", hospitalId ?? "").single();

  const { data: departments } = await admin
    .from("departments")
    .select("id, name, specialty, is_active, created_at, units(id, name, unit_type, bed_count, is_active)")
    .eq("hospital_id", hospitalId ?? "")
    .order("name");

  const { data: staff } = await admin
    .from("profiles")
    .select("id, full_name, role, department_id, unit_id")
    .eq("hospital_id", hospitalId ?? "")
    .order("full_name");

  const staffByDept = (staff ?? []).reduce((acc, s) => {
    if (!s.department_id) return acc;
    if (!acc[s.department_id]) acc[s.department_id] = [];
    acc[s.department_id].push(s);
    return acc;
  }, {} as Record<string, NonNullable<typeof staff>>);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Departments & Units</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {hospital?.name} · {(departments ?? []).length} departments
          </p>
        </div>
        <DeptManager hospitalId={hospitalId ?? ""} />
      </div>

      {(departments ?? []).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🏢</p>
          <p className="text-gray-500 text-sm font-medium">No departments yet</p>
          <p className="text-gray-400 text-xs mt-1">Click &quot;+ Add&quot; to create your first department.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {(departments ?? []).map(dept => {
            const deptStaff = staffByDept[dept.id] ?? [];
            return (
              <div key={dept.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* Department header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 text-lg">🏢</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{dept.name}</p>
                        {!dept.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Inactive</span>}
                      </div>
                      {dept.specialty && <p className="text-xs text-gray-400 mt-0.5">{dept.specialty}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{(dept.units ?? []).length} units</span>
                    <span>{deptStaff.length} staff</span>
                  </div>
                </div>

                {/* Units */}
                {(dept.units ?? []).length > 0 && (
                  <div className="divide-y divide-gray-50">
                    {(dept.units ?? []).map((unit: { id: string; name: string; unit_type?: string; bed_count?: number; is_active?: boolean }) => {
                      const unitStaff = deptStaff.filter(s => s.unit_id === unit.id);
                      return (
                        <div key={unit.id} className="flex items-center gap-3 px-5 py-3 pl-14">
                          <span className="text-sm">📍</span>
                          <div className="flex-1">
                            <p className="text-sm text-gray-800 font-medium">{unit.name}</p>
                            <div className="flex gap-3 text-[10px] text-gray-400 mt-0.5">
                              {unit.unit_type && <span>{unit.unit_type}</span>}
                              {unit.bed_count && <span>{unit.bed_count} beds</span>}
                              <span>{unitStaff.length} staff</span>
                            </div>
                          </div>
                          {!unit.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Inactive</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Staff summary */}
                {deptStaff.length > 0 && (
                  <div className="px-5 py-3 bg-gray-50/50 border-t border-gray-50">
                    <div className="flex flex-wrap gap-1.5">
                      {deptStaff.slice(0, 6).map(s => (
                        <span key={s.id} className="text-[10px] bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                          {s.full_name}
                        </span>
                      ))}
                      {deptStaff.length > 6 && (
                        <span className="text-[10px] text-gray-400 px-2 py-0.5">+{deptStaff.length - 6} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
