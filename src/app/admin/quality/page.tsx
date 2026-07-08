import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import QualityManager from "./QualityManager";
import { indicatorStatus } from "@/lib/ckcm";

// EQOS — Competen Quality (Ch.41-44): Quality Objects with multi-framework
// standards, indicators with live status, and improvement projects.

export default async function QualityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) redirect("/dashboard");

  const [
    { data: domains },
    { data: frameworks },
    { data: qos },
    { data: standards },
    { data: indicators },
    { data: measurements },
    { data: improvements },
  ] = await Promise.all([
    admin.from("quality_domains").select("id, code, name").order("sort_order"),
    admin.from("quality_frameworks").select("id, code, name").eq("is_active", true),
    admin.from("quality_objects")
      .select("id, code, title, description, status, domain_id, review_date")
      .neq("status", "retired").order("created_at", { ascending: false }),
    admin.from("quality_standards").select("id, quality_object_id, framework_id, reference_code, title"),
    admin.from("quality_indicators")
      .select("id, quality_object_id, code, name, unit, direction, target_value, escalation_value")
      .eq("is_active", true).order("created_at"),
    admin.from("indicator_measurements")
      .select("indicator_id, value, period").order("period", { ascending: false }),
    admin.from("improvement_objects")
      .select("id, code, title, quality_object_id, methodology, status, aim_statement, target_date, outcome_summary")
      .order("created_at", { ascending: false }),
  ]);

  // Latest measurement per indicator
  const latest = new Map<string, { value: number; period: string }>();
  for (const m of measurements ?? []) {
    if (!latest.has(m.indicator_id)) latest.set(m.indicator_id, { value: Number(m.value), period: m.period });
  }

  const indicatorRows = (indicators ?? []).map(i => {
    const l = latest.get(i.id);
    return {
      ...i,
      target_value: i.target_value == null ? null : Number(i.target_value),
      escalation_value: i.escalation_value == null ? null : Number(i.escalation_value),
      latest_value: l?.value ?? null,
      latest_period: l?.period ?? null,
      status: indicatorStatus(l?.value ?? null, i.target_value == null ? null : Number(i.target_value),
        i.escalation_value == null ? null : Number(i.escalation_value), i.direction),
    };
  });

  const onTarget = indicatorRows.filter(r => r.status === "on_target").length;
  const breaches = indicatorRows.filter(r => r.status === "breach").length;
  const activeImprovements = (improvements ?? []).filter(i => !["closed", "abandoned", "sustained"].includes(i.status)).length;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Quality</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Enterprise Quality Operating System — Quality Objects, computable standards, indicators and improvement (EQOS Ch.41-44).
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Quality Objects", value: (qos ?? []).length, color: "text-teal-600" },
          { label: "Indicators on target", value: `${onTarget}/${indicatorRows.length}`, color: "text-green-600" },
          { label: "Escalation breaches", value: breaches, color: breaches > 0 ? "text-red-600" : "text-gray-400" },
          { label: "Active improvements", value: activeImprovements, color: "text-violet-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <QualityManager
        domains={(domains ?? []) as never}
        frameworks={(frameworks ?? []) as never}
        qos={(qos ?? []) as never}
        standards={(standards ?? []) as never}
        indicators={indicatorRows as never}
        improvements={(improvements ?? []) as never}
      />
    </div>
  );
}
