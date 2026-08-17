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
  await requireHqCapability("hq.practice.health.view");
  return (
    <PdNotBuilt
      name="Communications Health"
      spec="CPR-PD-008G"
      purpose="Email, SMS, WhatsApp and push delivery infrastructure health."
      willShow="delivery, bounce and failure behaviour per channel and per provider."
      absence="No reliability instrumentation exists for Competen Practice. Availability, Apdex, P95 latency and error rate are recorded nowhere, so a health state computed from them would be invented rather than observed. Three adjacent signals ARE real and can be built on when this module is: AI request latency, job-run durations and sync-transaction age."
    />
  );
}
