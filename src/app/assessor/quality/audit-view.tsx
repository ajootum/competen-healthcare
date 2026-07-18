import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AuditRunner, { type AuditTemplate } from "./AuditRunner";

// Shared server view for the three audit types (concurrent / retrospective /
// clinical). Templates are the competencies' own governed checklists —
// referenced dynamically per the spec, never copied into audit config.

export const TYPE_META = {
  concurrent: {
    title: "Concurrent Reviews", icon: "📋",
    blurb: "Observe care in real time and check it against the competency's governed checklist.",
    subject: "nurse" as const,
  },
  retrospective: {
    title: "Retrospective Reviews", icon: "🗂️",
    blurb: "Review historical records and documentation against competency-derived criteria.",
    subject: "record" as const,
  },
  clinical: {
    title: "Clinical Audits", icon: "🩹",
    blurb: "Evaluate unit or service compliance against competency-derived standards.",
    subject: "area" as const,
  },
};

export default async function AuditTypeView({ type, preselect }: {
  type: keyof typeof TYPE_META; preselect?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const myRoles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!myRoles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  const hospitalId = me?.hospital_id ?? null;

  const [{ data: skills }, { data: nurses }, { data: pastRaw }] = await Promise.all([
    admin.from("competency_skills")
      .select("id, name, competency_id, framework_competencies!competency_id(name), skill_checklists(checklist_items(id, item, is_critical, sort_order))")
      .eq("is_active", true).limit(300),
    hospitalId
      ? admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name").limit(400)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("audits")
          .select("id, title, area, record_ref, compliance_pct, items_met, items_not_met, conducted_by_name, conducted_at, profiles!nurse_id(full_name)")
          .eq("hospital_id", hospitalId).eq("audit_type", type)
          .order("conducted_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] }),
  ]);

  // Group checklist items per competency → dynamic audit templates.
  const tplMap = new Map<string, AuditTemplate>();
  for (const s of skills ?? []) {
    const items = (s.skill_checklists ?? []).flatMap((cl: { checklist_items: { id: string; item: string; is_critical: boolean; sort_order: number }[] }) =>
      [...(cl.checklist_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)
        .map(it => ({ id: it.id, item: it.item, critical: !!it.is_critical, skill: s.name as string })));
    if (!items.length) continue;
    const compName = (s.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    const cur = tplMap.get(s.competency_id) ?? { competencyId: s.competency_id, name: compName, items: [] };
    cur.items = [...cur.items, ...items];
    tplMap.set(s.competency_id, cur);
  }
  const templates = [...tplMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const meta = TYPE_META[type];
  const past = pastRaw ?? [];

  return (
    <div className="max-w-4xl">
      <Link href="/assessor/quality" className="text-xs text-gray-400 hover:text-gray-600">← Quality &amp; Governance</Link>
      <div className="mb-5 mt-1">
        <h1 className="text-xl font-bold text-gray-900">{meta.icon} {meta.title}</h1>
        <p className="text-gray-400 text-sm mt-0.5">{meta.blurb}</p>
      </div>

      {templates.length ? (
        <AuditRunner
          type={type}
          subjectKind={meta.subject}
          templates={templates}
          nurses={(nurses ?? []).map(n => ({ id: n.id, name: n.full_name }))}
          preselect={preselect}
        />
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800 mb-5">
          No competency has a governed checklist yet — audit criteria come from competency checklists
          (built in Studio), so add checklist items to a competency first.
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-bold text-gray-900">Recent {meta.title.toLowerCase()}</p>
          <a href="/api/reports/quality" className="text-[10px] text-indigo-600 font-semibold hover:underline">⬇ Export all audits CSV</a>
        </div>
        {past.length ? (
          <div className="divide-y divide-gray-50">
            {past.map(a => (
              <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 truncate">{a.title}</p>
                  <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                    {new Date(a.conducted_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" · "}{a.conducted_by_name ?? "—"}
                    {(a.profiles as unknown as { full_name: string } | null)?.full_name ? ` · subject: ${(a.profiles as unknown as { full_name: string }).full_name}` : ""}
                    {a.area ? ` · ${a.area}` : ""}{a.record_ref ? ` · ref ${a.record_ref}` : ""}
                  </p>
                </div>
                <span className="text-[10px] text-gray-400">{a.items_met}✓ {a.items_not_met}✗</span>
                {a.compliance_pct != null && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${Number(a.compliance_pct) >= 85 ? "bg-green-100 text-green-700" : Number(a.compliance_pct) >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                    {Number(a.compliance_pct)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-xs text-gray-400">No {type} audits conducted yet.</p>
        )}
      </div>
    </div>
  );
}
