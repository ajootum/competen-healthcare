import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

// Audit Library (Quality & Governance). Per the spec, audit templates ARE the
// competencies' governed checklists — this page lists every competency that
// has checklist items, with its criteria profile and audit history, and
// launches any of the three audit types against it. No template copies exist.

export const dynamic = "force-dynamic";

export default async function AuditLibraryPage() {
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

  const [{ data: skills }, { data: auditsRaw }] = await Promise.all([
    admin.from("competency_skills")
      .select(`
        competency_id, name,
        framework_competencies!competency_id(name, framework_domains(name, frameworks(name))),
        skill_checklists(checklist_items(id, is_critical))
      `)
      .eq("is_active", true).limit(400),
    hospitalId
      ? admin.from("audits").select("competency_id, audit_type, compliance_pct, conducted_at")
          .eq("hospital_id", hospitalId).order("conducted_at", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [] }),
  ]);

  type Tpl = {
    id: string; name: string; domain: string; framework: string;
    skills: number; items: number; critical: number;
    audits: number; lastAudit: string | null; avgCompliance: number | null;
  };
  const tplMap = new Map<string, Tpl>();
  for (const s of skills ?? []) {
    const items = (s.skill_checklists ?? []).flatMap((cl: { checklist_items: { id: string; is_critical: boolean }[] }) => cl.checklist_items ?? []);
    if (!items.length) continue;
    const fc = s.framework_competencies as unknown as { name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
    const cur = tplMap.get(s.competency_id) ?? {
      id: s.competency_id,
      name: fc?.name ?? "Competency",
      domain: fc?.framework_domains?.name ?? "—",
      framework: fc?.framework_domains?.frameworks?.name ?? "—",
      skills: 0, items: 0, critical: 0, audits: 0, lastAudit: null, avgCompliance: null,
    };
    cur.skills++;
    cur.items += items.length;
    cur.critical += items.filter(i => i.is_critical).length;
    tplMap.set(s.competency_id, cur);
  }

  const auditAgg = new Map<string, { n: number; sum: number; withPct: number; last: string }>();
  for (const a of auditsRaw ?? []) {
    if (!a.competency_id) continue;
    const cur = auditAgg.get(a.competency_id) ?? { n: 0, sum: 0, withPct: 0, last: a.conducted_at };
    cur.n++;
    if (a.compliance_pct != null) { cur.sum += Number(a.compliance_pct); cur.withPct++; }
    auditAgg.set(a.competency_id, cur);
  }
  for (const [id, agg] of auditAgg) {
    const tpl = tplMap.get(id);
    if (!tpl) continue;
    tpl.audits = agg.n;
    tpl.lastAudit = agg.last?.slice(0, 10) ?? null;
    tpl.avgCompliance = agg.withPct ? Math.round(agg.sum / agg.withPct) : null;
  }

  const templates = [...tplMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totalItems = templates.reduce((n, t) => n + t.items, 0);
  const totalCritical = templates.reduce((n, t) => n + t.critical, 0);

  return (
    <div className="max-w-4xl">
      <Link href="/assessor/quality" className="text-xs text-gray-400 hover:text-gray-600">← Quality &amp; Governance</Link>
      <div className="mb-5 mt-1">
        <h1 className="text-xl font-bold text-gray-900">📚 Audit Library</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Audit templates are the competencies&apos; own governed checklists, referenced dynamically — one master checklist per competency, used everywhere.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5 max-w-md">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xl font-bold text-gray-900">{templates.length}</p>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Templates</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xl font-bold text-gray-900">{totalItems}</p>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Criteria items</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xl font-bold text-red-600">{totalCritical}</p>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Critical items</p>
        </div>
      </div>

      {templates.length ? (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm font-semibold text-gray-800">📋 {t.name}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{t.framework} · {t.domain}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {t.items} criteria across {t.skills} skill{t.skills === 1 ? "" : "s"}
                    {t.critical > 0 && <span className="text-red-600"> · {t.critical} critical</span>}
                    {t.audits > 0
                      ? <> · audited {t.audits}× {t.lastAudit ? `(last ${t.lastAudit})` : ""}{t.avgCompliance != null ? <> · avg <span className={t.avgCompliance >= 85 ? "text-green-600 font-semibold" : "text-amber-600 font-semibold"}>{t.avgCompliance}%</span></> : null}</>
                      : " · never audited"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link href={`/assessor/quality/concurrent?c=${t.id}`}
                    className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1.5 hover:bg-indigo-50 transition-colors">📋 Concurrent</Link>
                  <Link href={`/assessor/quality/retrospective?c=${t.id}`}
                    className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1.5 hover:bg-indigo-50 transition-colors">🗂️ Retrospective</Link>
                  <Link href={`/assessor/quality/clinical?c=${t.id}`}
                    className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1.5 hover:bg-indigo-50 transition-colors">🩹 Clinical</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
          <p className="font-semibold mb-1">No governed checklists yet</p>
          <p className="text-amber-700 text-xs leading-relaxed">
            The library is empty because no competency has checklist items authored yet. Templates are never created here —
            author a competency&apos;s master checklist in Studio (Checklists) and it appears in this library automatically,
            usable by direct observation, OSCE, simulation and all three audit types.
          </p>
        </div>
      )}

      <p className="text-[10px] text-gray-400 mt-4">
        Tenant-specific custom templates beyond competency checklists are not built — per the spec, checklist definitions live only on the Competency Framework.
      </p>
    </div>
  );
}
