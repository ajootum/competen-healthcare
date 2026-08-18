import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, PLANE_REFUSED } from "@/lib/hq/pd-health";
import { HealthHeader, Panel, PlaneRefusal, ReadFailures, Explain, TechnicalOpsLink } from "../_components/health-ui";

// CPR-PD-008G — COMMUNICATIONS HEALTH.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THE SECOND OF THIS MODULE'S TWO REFUSED READS. Delivery state is recorded against every message
// Competen Practice sends; none of those tables is on the practice plane's allowlist. The distinction
// from a genuine absence is the entire content of this page, because a reader who concludes "we do not
// track delivery" would go and build something that already exists.

export const dynamic = "force-dynamic";

const COMMS = PLANE_REFUSED.find(r => r.spec === "PD-008G")!;

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Communications Health"
        spec="CPR-PD-008G"
        purpose="Email, SMS, WhatsApp and push delivery infrastructure health."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <PlaneRefusal what={COMMS.what} tables={COMMS.tables} why={COMMS.why} />

      <ReadFailures problems={h.problems} />

      <Panel title="What is recorded today, on the other side of the boundary">
        <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-gray-700">
          <li>• Each message carries a channel and a delivery state, so success and failure by channel are already facts.</li>
          <li>• Notifications carry their own state, which is what a reader would want beside message delivery rather than folded into it.</li>
          <li>• Channel configuration says which channels a practice has enabled, which is the denominator any delivery share would need.</li>
        </ul>
        <Explain summary="Why this module wants it at all, given Practice can see its own">
          A practice can see its own messages. What no practice can see is whether a channel is failing
          across many practices at once, which is exactly the question this module exists to answer and
          the one a single practice cannot ask. That is the argument for widening the read — and it is an
          owner decision, weighed against what the Practice product tells practitioners the platform sees.
        </Explain>
      </Panel>

      <Panel title="Changing any of this">
        <TechnicalOpsLink what="Channel configuration and provider credentials" />
      </Panel>
    </div>
  );
}
