/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-021 — Competency Governance Marketplace & External Standards Exchange.
// "How can organisations discover, adopt and exchange trusted governance resources while keeping local
// accountability?" Over the real package store (authoring/publishing stays in Studio Marketplace — cross-linked):
//   • configuration_packages (mig 095) — shareable governance/competency packages: publisher, category
//     (governance/clinical/workforce/…), semantic version, license (proprietary/open/subscription/enterprise),
//     visibility (private/enterprise/public = marketplace availability), members[] (bundled object_keys) and
//     manifest.complete + manifest.missing (the §4.2 "governance before sharing" completeness check).
// From them: the marketplace catalog by domain, the shared-vs-private split, publication readiness (complete),
// licensing, and publisher count. Adoption lifecycle (§7) + governance roles (§6) render as reference. No migration.

type Admin = any;
const VIS_RANK: Record<string, number> = { public: 0, enterprise: 1, private: 2 };

export async function loadGovernanceMarketplace(admin: Admin) {
  const { data, error } = await admin
    .from("configuration_packages")
    .select("package_key, package_name, publisher, category, version, license, pricing_model, visibility, members, manifest")
    .limit(1000);

  const pkgs = (error ? [] : data ?? []) as any[];

  const byCategory = new Map<string, number>();
  const byVisibility: Record<string, number> = { private: 0, enterprise: 0, public: 0 };
  const byLicense = new Map<string, number>();
  const publishers = new Set<string>();
  let complete = 0;
  for (const p of pkgs) {
    byCategory.set(p.category || "general", (byCategory.get(p.category || "general") ?? 0) + 1);
    if (p.visibility in byVisibility) byVisibility[p.visibility]++;
    byLicense.set(p.license || "proprietary", (byLicense.get(p.license || "proprietary") ?? 0) + 1);
    if (p.publisher) publishers.add(p.publisher);
    if (p.manifest?.complete === true) complete++;
  }
  const shared = byVisibility.enterprise + byVisibility.public;

  const packages = pkgs
    .map((p) => ({
      key: p.package_key,
      name: p.package_name,
      publisher: p.publisher ?? "—",
      category: p.category ?? "general",
      version: p.version ?? "1.0.0",
      license: p.license ?? "proprietary",
      visibility: p.visibility ?? "private",
      members: Array.isArray(p.members) ? p.members.length : 0,
      complete: p.manifest?.complete === true,
      missing: Array.isArray(p.manifest?.missing) ? p.manifest.missing.length : 0,
    }))
    .sort((a, b) => (VIS_RANK[a.visibility] ?? 9) - (VIS_RANK[b.visibility] ?? 9) || a.name.localeCompare(b.name));

  return {
    provisioned: pkgs.length > 0,
    kpis: {
      packages: pkgs.length,
      shared,
      public: byVisibility.public,
      complete,
      incomplete: pkgs.length - complete,
      publishers: publishers.size,
      governance: byCategory.get("governance") ?? 0,
    },
    categories: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    byVisibility,
    licenses: [...byLicense.entries()].map(([license, count]) => ({ license, count })).sort((a, b) => b.count - a.count),
    packages: packages.slice(0, 14),
  };
}
