import { requireEducatorAccess } from "@/lib/educator-access";
import { buildEvidenceCentre } from "@/lib/evidence-centre";
import EvidenceCentre from "@/app/assessor/logbook/EvidenceCentre";
import { EduHeader } from "../ui";

// Evidence Review (Educator Validation Centre) — the same live Evidence
// Validation Centre the assessor shell uses, in the educator shell. Educators
// are verifier roles: verify / return / reject / escalate all work here, with
// signed-URL previews, checklists, prior submissions and activity feeds.

export const dynamic = "force-dynamic";

export default async function EducatorEvidencePage() {
  const { userId } = await requireEducatorAccess();
  const { entries, kpis, isSenior } = await buildEvidenceCentre(userId);

  return (
    <div>
      <EduHeader icon="🖇️" title="Evidence Review" sub="Review and validate evidence submitted by learners — documents, images, media, checklists and history." />
      <EvidenceCentre entries={entries} kpis={kpis} isSenior={isSenior} />
    </div>
  );
}
