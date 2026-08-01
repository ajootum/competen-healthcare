import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Layer, Mod, Status } from "../_engines";
import { loadQieModules, qieSummary, type QieModule } from "@/lib/qie/engines";
import { cardClass } from "@/components/ui/primitives";

// QIE-000 — Quality Intelligence Engine (platform architecture).
//
// The spec describes thirteen engines turning operational events into quality intelligence. Most of that
// capability already exists here under other names: pa_kpis/pa_kpi_values are the metrics engine,
// pa_predictions the predictive engine, pa_benchmarks the benchmarking engine, domain_events the event
// spine, HEX the executive service, WCE the configuration engine. Building qie_* copies would create a
// second source of truth for numbers a hospital makes decisions on — worse than the fragmentation it
// would claim to fix. So QIE is a COMPOSING LAYER over the real stores.
//
// Which makes the badge vocabulary do real work: QIE currently OWNS nothing. Twelve modules are "Linked"
// (the capability is live and lives in another workspace), and one is a genuine gap. That is a more
// useful thing to show a platform owner than thirteen green tiles would be.
//
// EVERY STATE IS MEASURED AT REQUEST TIME against the live database, not declared in a constant — so a
// module that becomes real the day someone seeds its table starts saying so by itself.

export const dynamic = "force-dynamic";

// Live and owned elsewhere is LINKED, not Live: the distinction is the whole architecture.
const badgeFor = (m: QieModule): Status =>
  m.state === "gap" ? "gap" : m.state === "empty" ? "partial" : m.href ? "linked" : "real";

const toMod = (m: QieModule): Mod => ({
  code: m.id, icon: ICON[m.id] ?? "◆", label: m.name,
  desc: `${m.purpose} — ${m.provider}. ${m.detail}.`,
  href: m.href ?? undefined, status: badgeFor(m),
});

const ICON: Record<string, string> = {
  "QIE-001": "📥", "QIE-002": "📊", "QIE-003": "📈", "QIE-004": "🔮", "QIE-005": "🔍", "QIE-006": "💡",
  "QIE-007": "🎓", "QIE-008": "⚖️", "QIE-009": "🏛️", "QIE-010": "🤖", "QIE-011": "⚙️", "QIE-012": "🛡️",
};

export default async function QualityIntelligencePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const mods = await loadQieModules(admin, profile?.hospital_id ?? null, true);
  const s = qieSummary(mods);
  const byId = (...ids: string[]) => mods.filter(m => ids.includes(m.id)).map(toMod);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-gray-300 tracking-widest">QIE-000</p>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Quality Intelligence Engine</h1>
          <p className="text-sm text-gray-500">Operational events become quality intelligence. One trusted source, composed from the engines that already produce it.</p>
        </div>
        <Link href="/super-admin" className="text-xs text-[var(--cmp-text-information)] hover:underline shrink-0">← Platform</Link>
      </div>

      {/* The architecture stated plainly, because a hub that hides it invites a second copy of everything. */}
      <div className={cardClass}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {[
            { n: s.live, l: "Backed by real data", c: "text-[var(--cmp-text-success)]" },
            { n: s.empty, l: "Store exists, empty", c: "text-[var(--cmp-text-warning)]" },
            { n: s.gap, l: "Not built", c: "text-gray-400" },
            { n: s.total, l: "Engines in the spec", c: "text-gray-900" },
          ].map(x => (
            <div key={x.l}>
              <p className={`text-2xl font-bold leading-none tabular-nums ${x.c}`}>{x.n}</p>
              <p className="text-[11px] text-gray-500 mt-1">{x.l}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          QIE is a <strong>composing layer</strong>, not a parallel stack. The metrics, predictions and benchmarks below
          are the ones Performance Analytics already calculates; the event spine is <code className="text-[10px]">domain_events</code>;
          the executive service is the Hospital Executive Workspace. Duplicating them into <code className="text-[10px]">qie_*</code> tables
          would give a hospital two different answers to the same question. <strong>&ldquo;Linked&rdquo; means the capability is live and
          owned by another workspace</strong> — QIE itself owns nothing yet, and says so rather than showing thirteen green tiles.
          Every count is read from the live database on each request.
        </p>
      </div>

      <Layer title="Capture & Measure" mods={byId("QIE-001", "QIE-002", "QIE-003")} accent="information" />
      <Layer title="Predict & Explain" mods={byId("QIE-004", "QIE-005")} accent="information" />
      <Layer title="Act & Learn" mods={byId("QIE-006", "QIE-007", "QIE-008")} accent="information" />
      <Layer title="Serve & Govern" mods={byId("QIE-009", "QIE-010", "QIE-011", "QIE-012")} accent="information" />

      {s.gap > 0 && (
        <div className={cardClass}>
          <h2 className="text-sm font-bold text-gray-900 mb-1">What is genuinely missing</h2>
          <p className="text-[11px] text-gray-500 mb-2">
            Listed separately from the linked modules because the difference matters: everything above works today
            somewhere on this platform. These do not exist at all.
          </p>
          <div className="space-y-2">
            {mods.filter(m => m.state === "gap").map(m => (
              <div key={m.id} className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3">
                <p className="text-xs font-semibold text-gray-700">{m.id} — {m.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{m.purpose}</p>
                <p className="text-[10px] text-gray-400 mt-1">{m.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
