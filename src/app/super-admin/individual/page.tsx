import { requireHqCapability } from "@/lib/hq/context";
import { individualAppEnabled } from "@/lib/individual/gate";
import { EXPERIENCES, EXPERIENCE_KEYS } from "@/lib/individual/experiences";
import IndividualAccessBoard from "./IndividualAccessBoard";

/**
 * Competen HQ — Individual pilot access. COMPETEN-IND-ACCESS-001 s4, owner rulings D8 and D9.
 *
 * The permanent workflow for inviting a person into the Competen Individual pilot: find their EXISTING
 * Competen account by email, grant Competen Scholar, Competen Professional or both (with the 18+
 * confirmation Scholar requires and an optional last day of access), and end an experience. It replaces
 * granting by SQL. Every write goes through /api/hq/individual/grants(/end), which re-check everything.
 *
 * ⚠ THE CAPABILITY, ENFORCED ON THE PAGE. hq.individual.pilot.grant -- the right the Individual Product
 * Administrator appointment holds, through the existing HQ machinery (D9). requireHqCapability refuses
 * regardless of hq_config.mode, the same choice the appointments page made and for the same reason: this
 * screen writes access. The route is declared in HQ_ROUTE_INTENT (spaces.ts) and the sidebar link is
 * filtered by the same capability; neither of those authorizes anything -- this call does.
 *
 * ⚠ THE RELEASE GATE STILL DECIDES. With `individual_app` off the API refuses every lookup and grant (404),
 * so the screen says Individual is switched off here and offers nothing to press. Holding the right does
 * not open the product.
 *
 * ⚠ AN EXISTING ACCOUNT ONLY. The grant adds Competen Individual to the identity the person already has;
 * it never creates an account, a platform membership or any other product's access (COMP-ARCH-PSA-001 s40).
 */
export default async function IndividualPilotAccessPage() {
  const ctx = await requireHqCapability("hq.individual.pilot.grant");
  const enabled = await individualAppEnabled(ctx.admin);
  return (
    <IndividualAccessBoard
      enabled={enabled}
      experiences={EXPERIENCE_KEYS.map(k => ({ key: k, name: EXPERIENCES[k].name, accent: EXPERIENCES[k].accent }))}
    />
  );
}
