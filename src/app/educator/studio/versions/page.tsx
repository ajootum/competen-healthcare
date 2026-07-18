import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadPortfolio } from "@/lib/studio-data";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";

// Version Control & Governance (Education Studio) — real object versions,
// publication states, drafts, review dates and the content change trail from
// the audit log. Item-level diffs aren't tracked and it says so.

export const dynamic = "force-dynamic";

const PUB_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700", draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-100 text-amber-700", archived: "bg-gray-100 text-gray-400", retired: "bg-gray-100 text-gray-400",
};

export default async function VersionsPage() {
  const { admin } = await requireEducatorAccess();
  const p = await loadPortfolio(admin);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: frameworks }, { data: cpus }, { data: dueKo }, { data: dueFw }, { data: trail }] = await Promise.all([
    admin.from("frameworks").select("id, name, library, pub_status, version_num, review_date").order("name").limit(50),
    admin.from("clinical_practice_units").select("id, name, code, pub_status, version_num").order("name").limit(50),
    admin.from("knowledge_objects").select("id, title, review_date").not("review_date", "is", null).lte("review_date", today).limit(50),
    admin.from("frameworks").select("id, name, review_date").not("review_date", "is", null).lte("review_date", today).limit(50),
    admin.from("audit_log")
      .select("actor_name, action, entity_type, entity_name, created_at")
      .in("entity_type", ["framework", "clinical_practice_unit", "competency_score", "knowledge_object", "audit", "report_definition"])
      .order("created_at", { ascending: false }).limit(15),
  ]);
  const dueForReview = (dueKo ?? []).length + (dueFw ?? []).length;

  return (
    <div className="max-w-3xl">
      <Link href="/educator/studio/publishing" className="text-xs text-gray-400 hover:text-gray-600">← Publishing & Governance</Link>
      <div className="mt-1"><EduHeader icon="🕘" title="Version Control & Governance" sub="Object versions, publication states, review dates and the content change trail." /></div>
      <StatTiles tiles={[
        { label: "Published", value: String(p.pipeline.published) },
        { label: "Draft / In Review", value: String(p.pipeline.draft + p.pipeline.review + p.pipeline.validation), alert: p.pipeline.draft + p.pipeline.review > 0 },
        { label: "Due for Review", value: String(dueForReview), alert: dueForReview > 0 },
        { label: "Change Events", value: String((trail ?? []).length), sub: "recent" },
      ]} />

      <Card title="Framework Versions" sub="semantic versions from the governance lifecycle">
        {(frameworks ?? []).length ? (
          <div className="space-y-1">
            {(frameworks ?? []).map(f => (
              <div key={f.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 text-[11px]">
                <span className="text-gray-800 font-medium flex-1 truncate">{f.name}</span>
                <span className="text-gray-400 capitalize">{f.library}</span>
                {f.review_date && f.review_date <= today && <span className="text-[9px] text-red-500">review due</span>}
                <span className="font-mono font-bold text-gray-700">v{f.version_num ?? 0}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${PUB_CLS[f.pub_status ?? "draft"] ?? "bg-gray-100"}`}>{(f.pub_status ?? "draft").replace("_", " ")}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No frameworks.</p>}
      </Card>

      <div className="mt-4">
        <Card title="CPU Versions">
          {(cpus ?? []).length ? (
            <div className="space-y-1">
              {(cpus ?? []).map(c => (
                <div key={c.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 text-[11px]">
                  {c.code && <span className="font-mono text-gray-400">{c.code}</span>}
                  <span className="text-gray-800 font-medium flex-1 truncate">{c.name}</span>
                  <span className="font-mono font-bold text-gray-700">v{c.version_num ?? 0}</span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${PUB_CLS[c.pub_status ?? "draft"] ?? "bg-gray-100"}`}>{(c.pub_status ?? "draft").replace("_", " ")}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No CPUs.</p>}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Content Change Trail" sub="from the audit log — every governed action">
          {(trail ?? []).length ? (
            <ul className="space-y-1.5">
              {(trail ?? []).map((t, i) => (
                <li key={i} className="text-[11px] text-gray-600">
                  <span className="font-medium text-gray-800">{t.actor_name ?? "—"}</span> {t.action.replace(/_/g, " ")}
                  {t.entity_name ? <span className="text-gray-500"> · {t.entity_name}</span> : null}
                  <span className="text-gray-300 ml-1" suppressHydrationWarning>{new Date(t.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No changes recorded yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Versions are semantic labels advanced by the governance lifecycle (super-admin Studio); item-level diffs and rollback aren&apos;t tracked.
        Publishing transitions run under super-admin governance. The audit trail above is the compliance record.
      </p>
    </div>
  );
}
