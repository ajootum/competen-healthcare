import { requireHqCapability } from "@/lib/hq/context";
import PdNotBuilt from "../../_components/PdNotBuilt";

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
  await requireHqCapability("hq.practice.operations.view");
  return (
    <PdNotBuilt
      name="Provisioning & Onboarding"
      spec="CPR-PD-001 §3"
      purpose="Pilot provisioning, the onboarding lifecycle and exception handling."
      willShow="each Practice's progress through provisioning and onboarding as a lifecycle rather than a technical saga, together with the exceptions that have stalled it and who owns them. The provisioning action itself already exists on the Technical Operations page and is re-parented, not duplicated."
    />
  );
}
