import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import WorkforceConsole from "./WorkforceConsole";

export const dynamic = "force-dynamic";

// Workforce Assignment Engine console (CDN-001). Position Library → Templates →
// Positions → Assign & Provision. Server-loads the catalogue + supporting data;
// degrades gracefully with a migration notice until 037 is applied.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PositionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id, organisation_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const hid = profile?.hospital_id ?? null;

  // Probe the workforce tables — if absent, show the migration notice.
  const probe = await admin.from("position_library").select("id").limit(1);
  const ready = !(probe.error && /does not exist|schema cache/i.test(probe.error.message ?? ""));

  let library: any[] = [], templates: any[] = [], positions: any[] = [], assignments: any[] = [];
  if (ready) {
    const [lib, tpl, pos, asg] = await Promise.all([
      admin.from("position_library").select("*").order("created_at", { ascending: false }),
      admin.from("position_templates").select("*").order("version", { ascending: false }),
      admin.from("positions").select("*, position_templates!template_id(version, status, workspaces), departments!department_id(name)").order("created_at", { ascending: false }),
      admin.from("workforce_assignments").select("*, positions!position_id(title, hospital_id), profiles!employee_id(full_name)").order("created_at", { ascending: false }),
    ]);
    library = lib.data ?? [];
    templates = tpl.data ?? [];
    positions = pos.data ?? [];
    assignments = (asg.data ?? []).filter((r: any) => roles.includes("super_admin") || r.positions?.hospital_id === hid);
  }

  // Supporting data for the forms (scoped to the caller's hospital + master library).
  const [emps, depts, fws, ress, cpus, assessors] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, roles").eq("hospital_id", hid ?? "").order("full_name").limit(500),
    admin.from("departments").select("id, name").eq("hospital_id", hid ?? "").order("name"),
    admin.from("frameworks").select("id, name, hospital_id").or(`hospital_id.eq.${hid ?? "00000000-0000-0000-0000-000000000000"},hospital_id.is.null`).order("name"),
    admin.from("learning_resources").select("id, title, hospital_id").or(`hospital_id.eq.${hid ?? "00000000-0000-0000-0000-000000000000"},hospital_id.is.null`).eq("is_active", true).order("title").limit(200),
    admin.from("clinical_practice_units").select("id, name").order("name").limit(200),
    admin.from("profiles").select("id, full_name, roles, role").eq("hospital_id", hid ?? "").order("full_name").limit(500),
  ]);

  const assessorList = (assessors.data ?? []).filter((p: any) => (p.roles?.length ? p.roles : [p.role]).some((r: string) => r === "assessor"));

  return (
    <WorkforceConsole
      ready={ready}
      data={{ library, templates, positions, assignments }}
      support={{
        employees: emps.data ?? [],
        departments: depts.data ?? [],
        frameworks: fws.data ?? [],
        resources: ress.data ?? [],
        cpus: cpus.data ?? [],
        assessors: assessorList,
      }}
    />
  );
}
