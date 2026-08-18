import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, HEALTH_REFUSALS } from "@/lib/hq/pd-health";
import { HealthHeader, Panel, AbsentList, ReadFailures, Explain } from "../_components/health-ui";

// CPR-PD-008I — SECURITY SIGNALS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ PART OF THIS ABSENCE IS DELIBERATE AND MUST NOT READ AS A GAP TO CLOSE. s8I is explicit that this
// page must not replace the security operations function. So the correct end state is NOT "every
// security signal, here" — it is a small number of signals that genuinely bear on whether the PRODUCT is
// healthy, with everything else staying where it is owned. A page that quietly grew into a second
// security console would be a defect even if every figure on it were real.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Security Signals"
        spec="CPR-PD-008I"
        purpose="Product-health-relevant security signals, without replacing the security operations function."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          No Practice-scoped security signal series exists — and this page is meant to stay small anyway.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          The specification asks for the security signals that bear on product health, and says in the
          same breath that this must not become the security operations function. Nothing here is
          measured today. The thing worth noticing is that closing the gap does not mean filling this
          page: it means choosing the two or three signals a Product Director should act on.
        </p>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel title="The signals that would belong here, and the ones that would not">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[12px] font-semibold text-gray-900">Would belong: a product-health reading</p>
            <ul className="mt-1 flex flex-col gap-1 text-[11.5px] leading-relaxed text-gray-700">
              <li>• A sustained rise in authentication failures, because it usually means something in the sign-in path broke rather than that anyone is under attack.</li>
              <li>• Lockouts, because a lockout is a practitioner who cannot work, which is a health outcome whatever its cause.</li>
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-gray-900">Would not: an operations reading</p>
            <ul className="mt-1 flex flex-col gap-1 text-[11.5px] leading-relaxed text-gray-700">
              <li>• Individual suspicious sessions, credential findings, or anything naming a person — that is an investigation, with a different audience and a different authority.</li>
              <li>• The estate&apos;s security posture, which belongs to the workspaces that own it and is not a property of this product.</li>
            </ul>
          </div>
        </div>
        <Explain summary="Why the line is drawn at &ldquo;can the Director act on it&rdquo;">
          A Product Director changes the product: a sign-in path, a lockout policy, a rate limit. A signal
          they cannot act on by changing the product is one they would forward to somebody else, and a
          screen whose function is forwarding is better replaced by the alert that would have gone
          straight there.
        </Explain>
      </Panel>

      <Panel title="What is measured today">
        <AbsentList items={[HEALTH_REFUSALS.security()]} />
      </Panel>
    </div>
  );
}
