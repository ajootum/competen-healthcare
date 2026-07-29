/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-109 — Competency Package Manager. Loads competency packages (competency_packages +
// competency_package_items, migration 130) with their contents, KPIs and type distribution. Packages
// are the deployable unit the Marketplace (CST-110) distributes. All real, read on demand.

const NONE = "00000000-0000-0000-0000-000000000000";

export const PACKAGE_TYPES = [
  { key: "specialty", label: "Clinical Specialty" }, { key: "orientation", label: "Orientation" }, { key: "mandatory", label: "Mandatory Training" },
  { key: "role", label: "Role-based" }, { key: "leadership", label: "Leadership" }, { key: "accreditation", label: "Accreditation" },
  { key: "simulation", label: "Simulation" }, { key: "assessment", label: "Assessment" }, { key: "learning", label: "Learning Pathway" }, { key: "deployment", label: "Deployment" },
];
export const PKG_TYPE_LABEL: Record<string, string> = Object.fromEntries(PACKAGE_TYPES.map(t => [t.key, t.label]));
export const STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-100", published: "text-teal-600 bg-teal-50 border-teal-100", archived: "text-gray-400 bg-gray-50 border-gray-100" };
export const ITEM_TYPE_LABEL: Record<string, string> = { competency: "Competency", framework: "Framework", assessment: "Assessment", cpu: "CPU", learning_pathway: "Learning path", checklist: "Checklist", skill: "Skill" };

export type PackageItem = { id: string; item_type: string; item_label: string | null; is_required: boolean };
export type Package = { id: string; name: string; description: string | null; package_type: string; version: string; status: string; created_by_name: string | null; created_at: string; items: PackageItem[]; itemCount: number };

export async function loadPackages(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("competency_packages").select("id, name, description, package_type, version, status, created_by_name, created_at").order("created_at", { ascending: false }).limit(1000));
  if (res.error) return { provisioned: false as const };
  const packages = (res.data ?? []) as any[];

  const itemsByPkg = new Map<string, PackageItem[]>();
  if (packages.length) {
    const { data: items } = await admin.from("competency_package_items").select("id, package_id, item_type, item_label, is_required").in("package_id", packages.map(p => p.id)).limit(20000);
    for (const it of (items ?? []) as any[]) { const a = itemsByPkg.get(it.package_id) ?? []; a.push({ id: it.id, item_type: it.item_type, item_label: it.item_label, is_required: it.is_required }); itemsByPkg.set(it.package_id, a); }
  }

  const full: Package[] = packages.map(p => { const its = itemsByPkg.get(p.id) ?? []; return { ...p, items: its, itemCount: its.length }; });
  const count = (s: string) => full.filter(p => p.status === s).length;
  const typeDist = PACKAGE_TYPES.map(t => ({ key: t.key, label: t.label, n: full.filter(p => p.package_type === t.key).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);

  return {
    provisioned: true as const,
    empty: full.length === 0,
    kpis: {
      total: full.length,
      published: count("published"),
      draft: count("draft"),
      archived: count("archived"),
      items: [...itemsByPkg.values()].reduce((s, a) => s + a.length, 0),
    },
    typeDist,
    packages: full,
  };
}
