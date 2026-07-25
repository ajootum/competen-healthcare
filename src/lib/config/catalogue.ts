// Module & Widget Configuration Catalogue (WCE-005) — the browsable reference over the platform's catalogue
// records. Composes the WCE-002 registry (registered objects + completeness) with the code-defined
// WIDGET_CATALOG (the detailed widget configuration contracts, §12). Computes the catalogue completeness
// score per object (§46). No new store: widget objects live in the registry (object_type WIDGET). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRegistry } from "@/lib/config/registry";
import { WIDGET_CATALOG, WIDGET_CATEGORIES, widgetObjectKey } from "@/lib/config/widget-catalog";

// §46 completeness — fraction of the catalogue-completeness elements defined on a registry object.
export function completeness(o: any): number {
  const needsData = ["WIDGET", "MODULE", "PAGE", "DASHBOARD", "REPORT"].includes(o.object_type);
  const elems = [
    !!o.display_name,
    !!o.description,
    !!o.configuration_owner,
    !!o.owner_team,
    o.object_type === "PLATFORM" || !!o.parent_object_key,        // placement
    !!o.safety_classification,
    !!o.configurability_class,
    !needsData || !!o.data_source_key,                            // data source (widgets/modules/pages)
  ];
  return Math.round((elems.filter(Boolean).length / elems.length) * 100);
}

export async function loadCatalogue(admin: any) {
  const reg = await loadRegistry(admin);
  const registered = new Map<string, any>((reg.provisioned ? reg.objects : []).map((o: any) => [o.object_key, o]));

  // Widget catalogue — contract from code, registration + completeness from the registry.
  const widgets = WIDGET_CATALOG.map(w => {
    const regObj = registered.get(widgetObjectKey(w.key));
    return { ...w, registered: !!regObj, completeness: regObj ? completeness(regObj) : 0 };
  });

  // Module catalogue — from registry MODULE objects.
  const moduleObjs = (reg.provisioned ? reg.objects : []).filter((o: any) => o.object_type === "MODULE");
  const modules = moduleObjs.map((o: any) => ({ key: o.object_key, name: o.display_name, parent: o.parent_object_key, configClass: o.configurability_class, safety: o.safety_classification, dataSource: o.data_source_key, completeness: completeness(o) }))
    .sort((a: any, b: any) => a.completeness - b.completeness);

  const allObjs = reg.provisioned ? reg.objects : [];
  const scores = allObjs.map(completeness);
  const avgCompleteness = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

  const stats = {
    registryProvisioned: reg.provisioned,
    catalogueRecords: allObjs.length,
    widgetsCatalogued: WIDGET_CATALOG.length,
    widgetsRegistered: widgets.filter(w => w.registered).length,
    modules: moduleObjs.length,
    categories: WIDGET_CATEGORIES.length,
    avgCompleteness,
    belowThreshold: scores.filter((s: number) => s < 70).length,   // §46 completeness threshold
  };

  return { stats, widgets, modules, categories: WIDGET_CATEGORIES };
}
