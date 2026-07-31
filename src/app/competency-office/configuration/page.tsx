import { fetchCmoSuite } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-020 Competency Configuration & Rules — no-code configuration of governance, scoring, approvals and AI policies.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_ICON: Record<string, string> = { scoring: "🎯", workflow: "🔄", approval: "✅", notification: "🔔", ai: "🤖", rules: "📐", general: "⚙️" };

export default async function ConfigurationPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-020 · Competency Office" title="Competency Configuration & Rules" sub="No-code configuration of competency governance, workflows, scoring, approvals, notifications, AI policies and business rules." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Configuration & Rules" part="part 2" /></div>;

  const cfg = d.config;
  const CATS = ["scoring", "workflow", "approval", "notification", "ai", "rules", "general"];
  const byCategory = CATS.map(c => ({ category: c, items: cfg.filter((i: any) => i.category === c) })).filter(g => g.items.length);

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Config Items" value={cfg.length} sub="settings" />
        <Kpi label="Active" value={cfg.filter((c: any) => c.status === "active").length} sub="live" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Inherited" value={cfg.filter((c: any) => c.source === "inherited").length} sub="from platform" tone="text-[var(--cmp-text-information)]" />
        <Kpi label="Local Overrides" value={cfg.filter((c: any) => c.source === "local").length} sub="tenant-specific" tone="text-[var(--cmp-text-warning)]" />
        <Kpi label="Categories" value={byCategory.length} sub="config domains" />
        <Kpi label="AI Policies" value={cfg.filter((c: any) => c.category === "ai").length} sub="governed" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {byCategory.map((g: any) => (
          <Card key={g.category} title={`${CAT_ICON[g.category] ?? "⚙️"} ${g.category.charAt(0).toUpperCase() + g.category.slice(1)}`} right={<span className="text-[11px] text-gray-400">{g.items.length}</span>}>
            <div className="space-y-1.5">{g.items.map((i: any) => (
              <div key={i.id} className="flex items-center gap-2 text-[12px]"><div className="min-w-0 flex-1"><p className="text-gray-800 leading-tight truncate">{i.name}</p><p className="text-[10px] text-gray-400 font-mono">{i.config_key}</p></div><span className="text-gray-700 font-medium text-[11px] text-right truncate max-w-[40%]">{i.value}</span><Pill text={i.source} tone={i.source === "inherited" ? "blue" : "amber"} /></div>
            ))}</div>
          </Card>
        ))}
      </div>

      <Foot>CMO-020 — competency configuration over cmo_config (scoring / workflow / approval / notification / AI / rules). Settings and inherited-vs-local source are real; the no-code rules-engine editors and the Draft→Publish→Rollback pipeline (composing with the platform WCE) are the next phase.</Foot>
    </div>
  );
}
