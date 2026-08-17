import { requireHqCapability } from "@/lib/hq/context";
import PdNotBuilt from "../_components/PdNotBuilt";

// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ hq.practice.operations.view is the only Practice HQ capability that exists and is enforced today.
// Build 2 replaces it with the per-module matrix. A capability no migration has created would lock
// this workspace shut for everybody, silently.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.practitioners.view");
  return (
    <PdNotBuilt
      name="Practitioners"
      spec="CPR-PD-004 §1–3"
      purpose="The landlord-side view of the people entitled to Competen Practice, and the drill-through into Practitioner 360."
      willShow="the practitioner estate — name and approved identifier, Practice membership, profession, market, plan context, lifecycle and activation state — and a per-person 360 covering onboarding progress, engagement, commercial state, support history and access. Identity resolves from the central Competen identity model rather than a second store, and no route into patient records is permitted."
    />
  );
}
