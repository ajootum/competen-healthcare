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
  await requireHqCapability("hq.practice.commercial.view");
  return (
    <PdNotBuilt
      name="Conversion"
      spec="CPR-PD-007D"
      purpose="Trial-to-paid and plan-conversion funnel analysis."
      willShow="conversion out of trial and between plans, and the points at which it fails."
      absence="A Competen Practice subscription is unrepresentable in the schema today. plat_subscriptions keys on tenants(id) and practice_workspace has no tenant_id, so a Practice cannot be the subject of a subscription row; practice_plans carries no price and no currency; and UGX appears nowhere in the schema at all. Nothing here is a missing query — the commercial facts these views would read do not exist to be read."
    />
  );
}
