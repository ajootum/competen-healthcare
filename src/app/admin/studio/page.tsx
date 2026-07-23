import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BrandingEditor from "./BrandingEditor";
import FrameworkLibrary from "./FrameworkLibrary";
import RulesEditor from "./RulesEditor";
import PanelManager from "./PanelManager";

export default async function StudioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, hospital_id, organisation_id")
    .eq("id", user.id)
    .single();

  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) redirect("/dashboard");

  const hospitalId = profile.hospital_id ?? "";

  const [
    { data: hospital },
    { data: allFrameworks },
    { data: rules },
    { data: activeCycles },
    { data: assessors },
  ] = await Promise.all([
    admin.from("hospitals")
      .select("id, name, logo_url, accent_color")
      .eq("id", hospitalId)
      .returns<{ id: string; name: string; logo_url?: string | null; accent_color?: string | null }[]>()
      .single(),

    admin.from("frameworks")
      .select("id, name, library, scope, parent_framework_id, owner_id")
      .eq("is_active", true)
      .returns<{ id: string; name: string; library: string; scope?: string | null; parent_framework_id?: string | null; owner_id?: string | null }[]>()
      .order("library").order("name"),

    admin.from("framework_rules")
      .select("framework_id, min_passing_score, min_passing_pct")
      .eq("hospital_id", hospitalId),

    admin.from("competency_cycles")
      .select(`
        id, cycle_type, min_assessors, consensus_rule,
        profiles!nurse_id(full_name),
        cycle_assessors(assessor_id, profiles!assessor_id(full_name))
      `)
      .eq("hospital_id", hospitalId)
      .eq("status", "active")
      .returns<{
        id: string; cycle_type: string; min_assessors?: number | null; consensus_rule?: string | null;
        profiles: { full_name: string } | null;
        cycle_assessors?: { assessor_id: string; profiles: { full_name: string } | null }[];
      }[]>(),

    admin.from("profiles")
      .select("id, full_name")
      .eq("hospital_id", hospitalId)
      .eq("role", "assessor")
      .order("full_name"),
  ]);

  // Split frameworks into master vs adopted-by-this-hospital
  const masterFrameworks = (allFrameworks ?? []).filter(
    f => !f.scope || f.scope === "master"
  );
  const adoptedFrameworks = (allFrameworks ?? []).filter(
    f => f.scope === "hospital" && f.owner_id === hospitalId
  );

  // Active cycles with multi-assessor (min_assessors > 1)
  const panelCycles = (activeCycles ?? [])
    .filter(c => (c.min_assessors ?? 1) > 1)
    .map(c => ({
      id: c.id,
      cycle_type: c.cycle_type,
      min_assessors: c.min_assessors ?? 1,
      consensus_rule: c.consensus_rule ?? "any",
      nurse_name: (c.profiles as { full_name: string } | null)?.full_name ?? "Unknown",
      panel: (c.cycle_assessors ?? []).map(ca => ({
        assessor_id: ca.assessor_id,
        assessor_name: (ca.profiles as { full_name: string } | null)?.full_name ?? null,
      })),
    }));

  // Only show published frameworks in Rules Editor
  const ruleFrameworks = [...masterFrameworks, ...adoptedFrameworks]
    .filter(() => true); // show all active

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Administrator Studio</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Configure branding, adopt frameworks from the master library, set pass rules, and manage assessment panels.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {hospital && <BrandingEditor hospital={hospital} />}

        <FrameworkLibrary
          masterFrameworks={masterFrameworks}
          adoptedFrameworks={adoptedFrameworks}
        />

        <RulesEditor
          frameworks={ruleFrameworks}
          initialRules={(rules ?? []).map(r => ({
            framework_id: r.framework_id,
            min_passing_score: r.min_passing_score,
            min_passing_pct: r.min_passing_pct,
          }))}
        />

        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
            Assessment Panels ({panelCycles.length})
          </h2>
          <PanelManager
            cycles={panelCycles}
            assessors={(assessors ?? []).map(a => ({ id: a.id, full_name: a.full_name }))}
          />
        </div>
      </div>
    </div>
  );
}
