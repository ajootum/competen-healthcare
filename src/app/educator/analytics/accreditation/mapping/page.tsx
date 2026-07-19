import { requireEducatorAccess } from "@/lib/educator-access";
import SoonModule from "../SoonModule";

// Module 4 — Regulatory Mapping. No regulatory-mapping store yet.
export const dynamic = "force-dynamic";

export default async function Mapping() {
  await requireEducatorAccess();
  return (
    <SoonModule active="mapping"
      note="No regulatory-mapping store exists. Mapping regulatory requirements to programmes, curricula, competencies, CPUs and policies (with cross-framework comparison and version intelligence) is on the roadmap."
      kpis={["Mapped", "Partial", "Unmapped", "Conflicts", "Coverage"]}
      needs={[
        "A mapping table linking each regulatory requirement to internal objects.",
        "Cross-framework comparison to detect gaps, overlaps and conflicts.",
        "Impact analysis so a regulation change flags affected curricula.",
      ]}
      links={[["Curriculum blueprint", "/educator/studio/mapping"], ["Framework builder", "/educator/studio/frameworks"]]} />
  );
}
