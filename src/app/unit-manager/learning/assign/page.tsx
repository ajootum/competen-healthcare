import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LearningTabs from "../LearningTabs";
import AssignmentConsole from "./AssignmentConsole";
import { estateRolesOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Learning assignment surface (LDS-001 / UMG-005) — assign courses to an audience, which auto-creates
// enrolments, then manage completion. Real over learning_courses / learning_assignments /
// learning_enrolments (migration 089). Manager-gated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";

export default async function AssignLearning() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  let provisioned = true;
  let courses: any[] = [], roleList: string[] = [], assignments: any[] = [], enrolments: any[] = [];
  try {
    const cRes = isSuper
      ? await admin.from("learning_courses").select("id, title, mandatory").eq("active", true).order("created_at", { ascending: false }).limit(300)
      : await admin.from("learning_courses").select("id, title, mandatory").eq("active", true).or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`).order("created_at", { ascending: false }).limit(300);
    if (cRes.error) throw cRes.error;
    courses = cRes.data ?? [];

    const [staffRes, aRes, ecRes, eRes] = await Promise.all([
      admin.from("profiles").select("role").eq("hospital_id", hid ?? NONE).limit(5000),
      scope(admin.from("learning_assignments").select("id, name, assignment_type, mandatory, due_date, audience, created_at")).order("created_at", { ascending: false }).limit(30),
      scope(admin.from("learning_enrolments").select("assignment_id, status")).limit(20000),
      scope(admin.from("learning_enrolments").select("id, status, user:profiles!user_id(full_name), course:learning_courses!course_id(title)")).order("created_at", { ascending: false }).limit(20),
    ]);
    roleList = [...new Set(((staffRes.data ?? []) as any[]).map(p => p.role).filter(Boolean))].sort();
    const counts = new Map<string, { total: number; completed: number }>();
    ((ecRes.data ?? []) as any[]).forEach(e => { const g = counts.get(e.assignment_id) ?? { total: 0, completed: 0 }; g.total++; if (e.status === "completed") g.completed++; counts.set(e.assignment_id, g); });
    assignments = ((aRes.data ?? []) as any[]).map(a => ({ id: a.id, name: a.name ?? "Assignment", type: a.assignment_type, mandatory: a.mandatory, due: a.due_date, audience: a.audience?.role === "all" || !a.audience?.role ? "All staff" : a.audience.role.replace(/_/g, " "), total: counts.get(a.id)?.total ?? 0, completed: counts.get(a.id)?.completed ?? 0 }));
    enrolments = ((eRes.data ?? []) as any[]).map(e => ({ id: e.id, status: e.status, name: e.user?.full_name ?? "—", course: e.course?.title ?? "Course" }));
  } catch { provisioned = false; }

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Learning Oversight &amp; Development</h1><p className="text-sm text-gray-500">Assign Learning — assign courses to a role or the whole unit and track completion.</p></div>
      <LearningTabs />
      {!provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Learning operations store not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 089 (learning_courses / learning_assignments / learning_enrolments) to enable assignment.</p></div>
      ) : (
        <AssignmentConsole courses={courses} roles={roleList} assignments={assignments} enrolments={enrolments} />
      )}
    </div>
  );
}
