import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// Organisation & Workforce Structure (UMW-WFM-009 §7).
export default function StructureConfig() {
  return <ConfigPlaceholder
    title="Configuration · Organisation & Structure"
    subtitle="Hierarchy, unit types, workforce groups, positions and role mappings."
    banner="Workforce-structure mappings need a structure-config store. Enterprise Administration is authoritative for legal organisational entities and HRIS for workforce taxonomy — UMW-WFM-009 stores workforce-use mappings, not duplicate master records (§7). Organisational scope is available today from the departments/units master."
    sections={[
      { heading: "Configuration objects (§7)", items: ["Organisational scope", "Unit type (ward/ICU/theatre/…)", "Workforce group", "Position template", "Reporting line", "Float relationship", "Cross-cover relationship"] },
      { heading: "Rules", items: ["Reference active Enterprise entity", "Map to HRIS taxonomy", "No circular hierarchy", "Float requires competency + contract validation", "Cross-cover may be time-bound + approved"] },
      { heading: "Widget (CFG-STR-01)", items: ["Hierarchy coverage", "Complete / incomplete mappings", "Open missing mappings", "Bulk map"] },
    ]}
    footer="Organisation & Structure (UMW-WFM-009 §7) — next-phase pending a structure-config store."
  />;
}
