// Data Source & Integration Mapper (NCP-010) — the metadata-driven integration layer over the WCE-002
// registry. This first pass surfaces the REAL, grounded slice: the supported connector catalogue (§5), the
// data sources actually referenced by registry objects (data_source_key), and the data-source binding
// COVERAGE — which configurable objects are bound to a source vs unbound (the gap the registry already
// flags). The deep visual mapping designer, transformation engine, live connectors, scheduler and monitoring
// are honest next-phase. No new store — reads the registry.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRegistry } from "@/lib/config/registry";

// NCP-010 §5 supported connectors, grouped for the catalogue.
export const CONNECTORS: { group: string; icon: string; items: string[] }[] = [
  { group: "Platform", icon: "⚙️", items: ["Platform Data Services", "Calculated datasets"] },
  { group: "API", icon: "🔌", items: ["REST APIs", "GraphQL", "Webhooks"] },
  { group: "Database", icon: "🗄️", items: ["SQL Server", "PostgreSQL", "MySQL"] },
  { group: "Healthcare", icon: "🏥", items: ["FHIR R4 / R5", "HL7 v2"] },
  { group: "File", icon: "📁", items: ["CSV", "Excel", "SFTP", "Azure Blob", "Amazon S3"] },
  { group: "Streaming", icon: "🌊", items: ["Kafka", "RabbitMQ"] },
  { group: "Directory", icon: "🪪", items: ["LDAP / Active Directory", "Custom SDK connectors"] },
];

const CONFIGURABLE = ["MODULE", "WIDGET", "PAGE", "DASHBOARD", "REPORT", "METRIC"];

export async function loadIntegrationMapper(admin: any) {
  const reg: any = await loadRegistry(admin);
  if (!reg.provisioned) return { provisioned: false as const };
  const objects = reg.objects as any[];

  const configurable = objects.filter(o => CONFIGURABLE.includes(o.object_type));
  const bound = configurable.filter(o => o.data_source_key);
  const unbound = configurable.filter(o => !o.data_source_key);

  // Data sources actually referenced by registry objects.
  const usage = new Map<string, number>();
  for (const o of objects) if (o.data_source_key) usage.set(o.data_source_key, (usage.get(o.data_source_key) ?? 0) + 1);
  const sources = [...usage.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);

  const connectorTypes = CONNECTORS.reduce((n, g) => n + g.items.length, 0);
  const stats = {
    sources: sources.length,
    connectorTypes,
    bound: bound.length,
    unbound: unbound.length,
    configurable: configurable.length,
    coverage: configurable.length ? Math.round((bound.length / configurable.length) * 100) : 0,
  };

  // Unbound configurable objects grouped by type — the binding gap to close.
  const gapByType = new Map<string, number>();
  for (const o of unbound) gapByType.set(o.object_type, (gapByType.get(o.object_type) ?? 0) + 1);
  const gap = [...gapByType.entries()].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n);
  const unboundList = unbound.slice(0, 40).map(o => ({ key: o.object_key, label: o.display_name ?? o.object_key, type: o.object_type }));

  return { provisioned: true as const, stats, connectors: CONNECTORS, sources, gap, unboundList };
}
