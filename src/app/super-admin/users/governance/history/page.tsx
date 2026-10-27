import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { VERSION_STATUS_LABEL, loadStudio } from "@/lib/hq/governance-studio";
import OrgChart from "../_components/OrgChart";

/**
 * Competen HQ — structure history (Addendum V1.2, migration 620). Every published and superseded version of a
 * structure, exactly as it was published. Read-only, on the same right as the governance screen beside it
 * (hq.platform.users.view, through the /super-admin/users prefix). Drafts and reviews are not shown here: they are
 * not part of the record until published, and they live in the Studio.
 */
export default async function GovernanceHistoryPage({ searchParams }: { searchParams: Promise<{ structure?: string; version?: string }> }) {
  const ctx = await requireHqCapability("hq.platform.users.view");
  const sp = await searchParams;
  const load = await loadStudio(ctx.admin, { structure: sp.structure ?? null, version: sp.version ?? null });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[12px] font-semibold tracking-wide text-indigo-800 uppercase">Organisation &amp; Governance Studio</p>
        <h1 className="text-xl font-bold text-gray-900">Structure history</h1>
        <p className="text-gray-500 text-sm mt-1 max-w-3xl">
          Each published version, as it was published. A later version never rewrites an earlier one, and appointments and
          decisions keep the version they were made under. Current structure: <Link href="/super-admin/users/governance" className="text-teal-700 hover:underline">Scholar governance</Link>.
        </p>
      </header>
      {load.state !== "ok" ? (
        <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
          {load.state === "absent" ? load.reason : `The history could not be read. This is not an empty history. (${load.error})`}
        </p>
      ) : (() => {
        const record = load.versions.filter(v => v.status === "published" || v.status === "superseded");
        const shown = load.selected && (load.selected.status === "published" || load.selected.status === "superseded") ? load.selected : load.published;
        const qs = (structure: string, version?: string) => `?structure=${encodeURIComponent(structure)}${version ? `&version=${version}` : ""}`;
        return (
          <>
            <nav aria-label="Structures" className="flex flex-wrap gap-2 text-[12px]">
              {load.structures.map(s => (
                <Link key={s.code} href={qs(s.code)} aria-current={load.structure?.code === s.code ? "page" : undefined}
                  className={`rounded-lg border px-3 py-1.5 min-h-9 ${load.structure?.code === s.code ? "border-teal-600 text-teal-800" : "border-gray-200 text-gray-700"} bg-white`}>{s.name}</Link>
              ))}
            </nav>
            {record.length === 0 ? <p className="text-sm text-gray-500">No version of this structure has been published yet.</p> : (
              <ol className="space-y-1 text-sm">
                {record.map(v => (
                  <li key={v.id}>
                    <Link href={qs(load.structure!.code, v.id)} aria-current={shown?.id === v.id ? "page" : undefined}
                      className={`block rounded-lg border px-3 py-2 bg-white ${shown?.id === v.id ? "border-teal-600" : "border-gray-200"}`}>
                      <span className="font-semibold text-gray-900">v{v.versionNo} · {v.title}</span>
                      <span className="text-gray-600"> · {VERSION_STATUS_LABEL[v.status]} · effective {v.effectiveFrom ?? "not recorded"}{v.supersededAt ? ` · superseded ${v.supersededAt.slice(0, 10)}` : ""}</span>
                      {v.approvalBasis && <span className="block text-[12px] text-gray-500">Basis: {v.approvalBasis}{v.selfApproved ? " · approved by an owner who also edited it" : ""}</span>}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            {shown && <OrgChart def={shown.definition} relationTypes={load.relationTypes} showRetired />}
          </>
        );
      })()}
    </div>
  );
}
