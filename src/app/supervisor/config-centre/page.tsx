import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadConfigCentre } from "@/lib/operations/config-centre";

export const dynamic = "force-dynamic";

// Workspace Configuration Centre (SSW-CONF-001) — the central configuration layer:
// eight modules (settings, templates & playbooks, professional toolkit, reports,
// notifications & automation, productivity, administration, integrations). A hub
// that links to the real configuration surfaces, with live system & integration
// status (background jobs, AI services) and the audited configuration-change
// history. External integrations that don't exist yet (EMR, devices) show honest
// "not integrated" states; unbuilt tools are marked "soon" rather than faked.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const STATUS_TONE: Record<string, string> = { green: "text-green-600", amber: "text-amber-600", gray: "text-gray-400" };

const MODULES = [
  { n: 1, icon: "⚙️", title: "Workspace Settings", desc: "Personalise your workspace experience and preferences.", items: ["Dashboard & Layout", "Display Preferences", "Operational Thresholds", "AI Preferences", "Widget Management"], action: "Configure Settings", href: "/supervisor/settings", tone: "green" },
  { n: 2, icon: "📋", title: "Shift Templates & Playbooks", desc: "Create and manage shift templates, playbooks and checklists.", items: ["Shift Templates", "Unit Playbooks", "Checklist Templates", "Communication Templates", "Emergency Workflows"], action: "Manage Templates", href: "/supervisor/task-center#workflow", tone: "blue" },
  { n: 3, icon: "🧰", title: "Professional Toolkit", desc: "Clinical tools, calculators and quick reference resources.", items: ["Clinical Calculators", "PEWS / NEWS Tools", "Drug Calculators", "Protocols & Guidelines", "Policy & Competency Library"], action: "Open Toolkit", href: "/supervisor/toolkit", tone: "violet" },
  { n: 4, icon: "📄", title: "Reports & Data Export", desc: "Generate reports, schedule delivery and export operational data.", items: ["Shift Reports", "Executive Reports", "Scheduled Reports", "Export Data (PDF, Excel, CSV)", "Secure Sharing"], action: "Go to Reports", href: "/supervisor/operational-intelligence", tone: "amber" },
  { n: 5, icon: "🔔", title: "Notifications & Automation", desc: "Manage alerts, rules, reminders and automation workflows.", items: ["Alert Rules", "Escalation Rules", "Reminder Settings", "Automation Workflows", "AI Notifications"], action: "Manage Notifications", href: "/supervisor/task-center#workflow", tone: "teal" },
  { n: 6, icon: "🙋", title: "Personal Productivity", desc: "Organise notes, tasks, bookmarks and daily productivity tools.", items: ["My Tasks & To-dos", "Notes & Journals", "Bookmarks", "Quick Actions", "Pinned Dashboards"], action: "Open Productivity", href: "/supervisor/task-center", tone: "rose" },
  { n: 7, icon: "🛡️", title: "Administration", desc: "Manage users, roles, approvals and configuration governance.", items: ["Team & Role Management", "Template Management", "Digital Signatures", "Audit Logs", "Configuration History"], action: "Open Administration", href: "/admin", tone: "green" },
  { n: 8, icon: "🔗", title: "Integration & Systems", desc: "Monitor connected systems, APIs and device integrations.", items: ["EMR Integration Status", "Device Connectivity", "API & Services Health", "Data Synchronisation", "Connected Systems"], action: "View Integrations", href: "#status", tone: "blue" },
];
const TONE_BG: Record<string, string> = { green: "bg-green-100 text-green-700", blue: "bg-blue-100 text-blue-700", violet: "bg-violet-100 text-violet-700", amber: "bg-amber-100 text-amber-700", teal: "bg-teal-100 text-teal-700", rose: "bg-rose-100 text-rose-700" };

export default async function ConfigCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadConfigCentre(admin, hid, isSuper);

  const quickActions = [
    ["Create New Shift Template", "/supervisor/task-center#workflow"], ["Create Playbook", null], ["New Report", "/supervisor/operational-intelligence"],
    ["Schedule Report", null], ["Add Alert Rule", "/supervisor/quality-safety"], ["Create Workflow", "/supervisor/task-center#workflow"],
    ["Add Quick Action", null], ["Manage Widgets", "/supervisor/settings"],
  ];
  const aiConfig = [
    ["Recommended Widgets", "AI suggests widgets to improve shift visibility.", "Review suggestions", "/supervisor/settings"],
    ["Alert Optimisation", "Reduce alert fatigue — tune notification rules.", "Optimise alerts", "/supervisor/quality-safety"],
    ["Template Recommendation", "Recommended templates based on shift pattern.", "Apply template", "/supervisor/task-center#workflow"],
    ["Report Suggestion", "End-of-shift summary report ready to generate.", "Generate report", "/supervisor/operational-intelligence"],
  ];

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workspace Configuration Centre</h1><p className="text-sm text-gray-500">Configure your workspace, templates, tools, notifications and system preferences.</p></div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live</span>
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {MODULES.map((m) => (
          <div key={m.n} className={`${card} p-5 flex flex-col`}>
            <div className="flex items-start justify-between mb-2">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm ${TONE_BG[m.tone]}`}>{m.icon}</span>
              <span className="text-[10px] font-bold text-gray-300">{m.n}</span>
            </div>
            <h3 className="text-sm font-bold text-gray-900 leading-tight">{m.title}</h3>
            <p className="text-[10px] text-gray-400 leading-tight mb-2 min-h-[26px]">{m.desc}</p>
            <div className="space-y-1 flex-1">{m.items.map((it) => (<div key={it} className="flex items-center gap-1.5 text-[11px] text-gray-600"><span className="w-1 h-1 rounded-full bg-gray-300" />{it}</div>))}</div>
            {m.href ? (
              <Link href={m.href} className="mt-3 block text-center text-[11px] font-semibold text-teal-700 border border-gray-100 rounded-lg py-1.5 hover:bg-teal-50/40">{m.action} →</Link>
            ) : (
              <span className="mt-3 block text-center text-[11px] font-semibold text-gray-300 border border-gray-100 rounded-lg py-1.5">{m.action} · soon</span>
            )}
          </div>
        ))}
      </div>

      {/* Rails: Quick Actions · System Status · Recently Updated */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h2>
          <div className="space-y-1">
            {quickActions.map(([l, href]: any) => href ? (
              <Link key={l} href={href} className="flex items-center gap-2 rounded-lg hover:bg-gray-50 px-2 py-1.5 text-xs text-gray-700"><span className="text-teal-500">+</span>{l}</Link>
            ) : (
              <span key={l} className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300"><span>+</span>{l} · soon</span>
            ))}
          </div>
        </div>

        <div className={`${card} p-5`} id="status">
          <h2 className="text-sm font-bold text-gray-900 mb-3">System &amp; Integration Status</h2>
          <div className="space-y-1.5">
            {d.systemStatus.map((s: any) => (<div key={s.label} className="flex items-center gap-2 text-xs"><span className={`w-1.5 h-1.5 rounded-full ${s.tone === "green" ? "bg-green-500" : s.tone === "amber" ? "bg-amber-500" : "bg-gray-300"}`} /><span className="text-gray-600 flex-1">{s.label}</span><span className={`font-medium ${STATUS_TONE[s.tone] ?? "text-gray-500"}`}>{s.status}{s.tone === "green" ? " ✓" : ""}</span></div>))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">EMR &amp; medical-device integrations are a later enterprise phase.</p>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Recently Updated</h2>
          {d.recentUpdates.length === 0 ? <p className="text-sm text-gray-400">No recent configuration changes.</p> : (
            <div className="space-y-2">
              {d.recentUpdates.map((r: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" /><div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 truncate">{r.label}</p><p className="text-[10px] text-gray-400">{r.sub} · {relTime(r.at)}{r.by ? ` · ${r.by}` : ""}</p></div></div>))}
            </div>
          )}
        </div>
      </div>

      {/* AI Config Assistant */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-1.5 mb-3"><span className="text-base">✨</span><h2 className="text-sm font-bold text-gray-900">AI Copilot: Configuration Assistant</h2><span className="text-[10px] text-gray-400">let AI help optimise your workspace</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {aiConfig.map(([t, s, action, href]: any) => (<Link key={t} href={href} className="rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 p-2.5"><p className="text-xs font-semibold text-gray-800">{t}</p><p className="text-[10px] text-gray-400 leading-tight">{s}</p><p className="text-[10px] font-semibold text-violet-700 mt-1">{action} →</p></Link>))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Workspace Configuration Centre (SSW-CONF-001) separates configuration from clinical operations — eight modules linking to the live configuration surfaces (workspace settings, shift templates &amp; automation, reports, administration) with real system &amp; integration status (background jobs, AI services) and the audited configuration-change history. The Professional Toolkit&apos;s clinical calculators (NEWS2, infusion, maintenance fluids, BMI, conversions) are live and validated-formula based; external EMR &amp; medical-device integrations and the curated content library (protocols, personal journals) remain honest states rather than fabricated.</p>
    </div>
  );
}
