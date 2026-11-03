// Checklist Studio: gives a platform owner the capabilities their OWN live appointments grant. Server only.
// See capabilities.ts for why. Wrap the result of hqApiGate / requireHqCapability; a refusal passes through.
import { NextResponse } from "next/server";
import type { HqContext } from "@/lib/hq/context";
import { effectiveCapabilities } from "./capabilities";

export async function withOwnAppointments<T extends HqContext | NextResponse>(gated: T): Promise<T> {
  if (gated instanceof NextResponse) return gated;
  const ctx = gated as HqContext;
  if (!ctx.isOwner) return gated;
  const capabilities = await effectiveCapabilities(ctx, async (capability) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the RPC is not in the generated types
    const { data, error } = await (ctx.admin as any).rpc("individual_holds_capability", { p_person: ctx.userId, p_capability: capability });
    if (error) throw error;
    return data === true;
  });
  return { ...ctx, capabilities } as T;
}
