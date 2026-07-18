import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import { StatTiles, Card } from "../../reports/ui";

// Version Control (Assessment Studio) — real framework versions, publication
// states and the content change trail from the audit log. Item-level diffs
// aren't tracked and the page says so.

export const dynamic = "force-dynamic";

const PUB_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700", draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-100 text-amber-700", archived: "bg-gray-100 text-gray-400",
};

export default async function StudioVersionsPage() {
  const { admin } = await requireAnalyticsAccess();

  const [{ data: frameworks }, { data: cpus }, { data: trail }, { data: snapshots }] = await Promise.all([
    admin.from("frameworks")
      .select("id, name, library, is_active, pub_status, version_num")
      .order("name").limit(50),
    admin.from("clinical_practice_units").select("pub_status").limit(1000),
    admin.from("audit_log")
      .select("actor_name, action, entity_type, entity_name, created_at")
      .in("entity_type", ["framework", "clinical_practice_unit", "osce_exam", "report_definition", "audit"])
      .order("created_at", { ascending: false }).limit(15),
    admin.from("framework_versions")
      .select("version_num, published_by_name, published_at, frameworks!framework_id(name)")
      .order("published_at", { ascending: false }).limit(8),
  ]);

  const cpuAgg = new Map<string, number>();
  for (const c of cpus ?? []) cpuAgg.set(c.pub_status ?? "draft", (cpuAgg.get(c.pub_status ?? "draft") ?? 0) + 1);

  return (
    <div className="max-w-3xl">
      <Link href="/assessor/studio" className="text-xs text-gray-400 hover:text-gray-600">← Assessment Studio</Link>
      <div className="mb-5 mt-1">
        <h1 className="text-xl font-bold text-gray-900">🕘 Version Control</h1>
        <p className="text-gray-400 text-sm mt-0.5">Framework versions, publication states and the content change trail.</p>
      </div>

      <StatTiles tiles={[
        { label: "Frameworks", value: String((frameworks ?? []).length) },
        { label: "CPUs Published", value: String(cpuAgg.get("published") ?? 0), sub: `${cpuAgg.get("draft") ?? 0} draft` },
        { label: "Change Events", value: String((trail ?? []).length), sub: "recent, audit trail" },
        { label: "Lifecycle", value: "Governed", sub: "draft → review → published" },
      ]} />

      <Card title="Framework Versions" sub="semantic versions from the governance lifecycle">
        {(frameworks ?? []).length ? (
          <div className="space-y-1.5">
            {(frameworks ?? []).map(f => (
              <div key={f.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 text-[11px]">
                <span className="text-gray-800 font-medium flex-1 truncate">{f.name}</span>
                <span className="text-gray-400 capitalize">{f.library}</span>
                <span className="font-mono font-bold text-gray-700">v{f.version_num ?? 0}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${PUB_CLS[f.pub_status ?? (f.is_active ? "published" : "draft")] ?? "bg-gray-100 text-gray-500"}`}>
                  {(f.pub_status ?? (f.is_active ? "active" : "inactive")).replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No frameworks yet.</p>}
      </Card>

      {(snapshots ?? []).length > 0 && (
        <div className="mt-4">
          <Card title="Published Version Snapshots" sub="framework_versions — full snapshot at each publish">
            <ul className="space-y-1">
              {(snapshots ?? []).map((s, i) => (
                <li key={i} className="text-[11px] text-gray-600 flex items-center gap-2">
                  <span className="font-mono font-bold text-gray-700">v{s.version_num}</span>
                  <span className="flex-1 truncate">{(s.frameworks as unknown as { name: string } | null)?.name ?? "—"}</span>
                  <span className="text-gray-400">{s.published_by_name ?? "—"}</span>
                  <span className="text-gray-300" suppressHydrationWarning>{s.published_at ? new Date(s.published_at).toLocaleDateString() : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Card title="Content Change Trail" sub="from the audit log">
          {(trail ?? []).length ? (
            <ul className="space-y-1.5">
              {(trail ?? []).map((t, i) => (
                <li key={i} className="text-[11px] text-gray-600">
                  <span className="font-medium text-gray-800">{t.actor_name ?? "—"}</span>{" "}
                  {t.action.replace(/_/g, " ")}
                  {t.entity_name ? <span className="text-gray-500"> · {t.entity_name}</span> : null}
                  <span className="text-gray-300 ml-1" suppressHydrationWarning>
                    {new Date(t.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No content changes recorded yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: versions are semantic labels advanced by the governance lifecycle; item-level diffs and rollback aren&apos;t tracked.
        Framework lifecycle transitions (review/publish) run in the platform Studio under super-admin governance.
      </p>
    </div>
  );
}
