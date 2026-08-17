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
  await requireHqCapability("hq.practice.governance.view");
  return (
    <PdNotBuilt
      name="Governance & Risk"
      spec="CPR-PD-010 §1–3"
      purpose="Product risk, assurance, obligations, decisions and overdue governance actions. This module assesses; it does not operate day-to-day product workflows."
      willShow="the risk posture with its trend and its stated definition, high and critical risks, overdue treatments, ineffective or untested controls, expiring risk acceptances, obligation deadlines and pending approvals — prioritised by consequence and due state rather than by count."
    />
  );
}
