import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadPortfolio } from "@/lib/studio-data";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";
import { SECTION_BY_ID } from "./sections";
import SectionGrid from "./SectionGrid";

// Shared renderer for an Education Studio section page: header, section-scoped
// live KPI tiles from the real content portfolio, and the module grid.

export default async function SectionPage({ id }: { id: string }) {
  const { admin } = await requireEducatorAccess();
  const section = SECTION_BY_ID.get(id);
  if (!section) return null;
  const p = await loadPortfolio(admin);

  const TILES: Record<string, Tile[]> = {
    curriculum: [
      { label: "Frameworks", value: String(p.frameworks) },
      { label: "Domains", value: String(p.domains) },
      { label: "Competencies", value: String(p.competencies) },
      { label: "CPUs", value: String(p.cpus) },
    ],
    assessment: [
      { label: "Question Bank", value: String(p.questions), sub: `${p.questionBanks} banks` },
      { label: "Checklists", value: String(p.checklists), alert: p.checklists === 0, sub: p.checklists === 0 ? "author now" : undefined },
      { label: "Clinical Cases", value: String(p.cases) },
      { label: "OSCE Blueprints", value: String(p.osce) },
    ],
    content: [
      { label: "Courses", value: String(p.courses) },
      { label: "Knowledge Objects", value: String(p.knowledge) },
      { label: "Learning Resources", value: String(p.resources) },
      { label: "Clinical Cases", value: String(p.cases) },
    ],
    mapping: [
      { label: "Competencies", value: String(p.competencies) },
      { label: "Question Bank", value: String(p.questions) },
      { label: "Checklists", value: String(p.checklists), alert: p.checklists === 0 },
      { label: "Frameworks", value: String(p.frameworks) },
    ],
    cko: [
      { label: "CPUs", value: String(p.cpus) },
      { label: "Knowledge Objects", value: String(p.knowledge) },
      { label: "Clinical Cases", value: String(p.cases) },
      { label: "Shared Skills", value: "—", sub: "reusable components" },
    ],
    ai: [
      { label: "Competencies", value: String(p.competencies), sub: "grounding source" },
      { label: "Knowledge Objects", value: String(p.knowledge) },
      { label: "Question Bank", value: String(p.questions) },
      { label: "Clinical Cases", value: String(p.cases) },
    ],
    publishing: [
      { label: "Draft", value: String(p.pipeline.draft) },
      { label: "In Review / Validation", value: String(p.pipeline.review + p.pipeline.validation), alert: p.pipeline.review + p.pipeline.validation > 0 },
      { label: "Published", value: String(p.pipeline.published) },
      { label: "Retired", value: String(p.pipeline.retired) },
    ],
  };

  return (
    <div className="max-w-4xl">
      <Link href="/educator/studio" className="text-xs text-gray-400 hover:text-gray-600">← Education Studio</Link>
      <div className="mt-1">
        <EduHeader icon={section.icon} title={section.title} sub={section.sub} />
      </div>
      <StatTiles tiles={TILES[id] ?? []} />
      <SectionGrid modules={section.modules} />
      <p className="text-[10px] text-gray-400 mt-4">
        Modules link to real educator-accessible builders and live views. Modules marked soon have no backing store yet and would need their own spec.
      </p>
    </div>
  );
}
