// Checklist Studio: gives a platform owner the capabilities their OWN live appointments grant. Server only.
// See capabilities.ts for why. Wrap the result of hqApiGate / requireHqCapability; a refusal passes through.
import { NextResponse } from "next/server";
import type { HqContext } from "@/lib/hq/context";
import { effectiveCapabilities, STUDIO_CAPABILITIES } from "./capabilities";

/**
 * `extra`: capabilities beyond the Studio's that the calling page or route tests against ctx.capabilities (UNIFIED-GOVERNANCE-V1
 * item 5: the Document Template Studio review asks for hq.individual.config.manage). They are resolved the same way, through
 * the owner's own appointments, so an owner without one is told so rather than admitted.
 */
export async function withOwnAppointments<T extends HqContext | NextResponse>(gated: T, extra: readonly string[] = []): Promise<T> {
  if (gated instanceof NextResponse) return gated;
  const ctx = gated as HqContext;
  if (!ctx.isOwner) return gated;
  const candidates = extra.length ? [...new Set([...STUDIO_CAPABILITIES, ...extra])] : STUDIO_CAPABILITIES;
  const capabilities = await effectiveCapabilities(ctx, async (capability) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the RPC is not in the generated types
    const { data, error } = await (ctx.admin as any).rpc("individual_holds_capability", { p_person: ctx.userId, p_capability: capability });
    if (error) throw error;
    return data === true;
  }, candidates);
  return { ...ctx, capabilities } as T;
}
