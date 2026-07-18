import { requireAnalyticsAccess } from "@/lib/analytics";
import { ModuleHeader } from "../ui";
import BuilderClient, { type SavedDef, type Option } from "./BuilderClient";

// Report Builder module — parameterised report creation over whitelisted
// datasets (no arbitrary queries), with live preview, CSV export and saved
// definitions that feed the Report Library and Scheduled Reports.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ run?: string; dataset?: string }>;

export default async function ReportBuilderPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const params = await searchParams;

  const [{ data: defs }, { data: people }] = await Promise.all([
    hospitalId
      ? admin.from("report_definitions")
          .select("id, name, dataset, config, created_by_name, created_at")
          .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("profiles").select("id, full_name, specialization, role, roles").eq("hospital_id", hospitalId).order("full_name").limit(600)
      : Promise.resolve({ data: [] }),
  ]);

  const rolesOf = (p: { role: string | null; roles: string[] | null }) => (p.roles?.length ? p.roles : [p.role]).filter(Boolean) as string[];
  const assessors: Option[] = (people ?? [])
    .filter(p => rolesOf(p).some(r => ["assessor", "educator", "hospital_admin"].includes(r)))
    .map(p => ({ id: p.id, name: p.full_name }));
  const departments = [...new Set((people ?? [])
    .filter(p => rolesOf(p).includes("nurse"))
    .map(p => p.specialization ?? "General"))].sort();

  const saved: SavedDef[] = ((defs ?? []) as unknown as SavedDef[]);

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="🧱" title="Report Builder" sub="Build parameterised reports over governed datasets — preview live, export CSV, save to the library, schedule delivery." />
      <BuilderClient
        saved={saved}
        assessors={assessors}
        departments={departments}
        initialRunId={params.run ?? null}
        initialDataset={params.dataset ?? null}
      />
      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: datasets and columns are whitelisted server-side — there is no free-form query path, by design.
        For PDF, use the ⬇ PDF button (print-optimised). PowerPoint packs aren&apos;t built.
      </p>
    </div>
  );
}
