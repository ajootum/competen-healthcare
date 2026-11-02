// Checklist Studio: helpers shared by the HQ routes. Server only.
import { NextResponse } from "next/server";
import type { HqContext } from "@/lib/hq/context";
import { DEFINITION_KINDS, type DefinitionKind } from "./types";
import type { WriteResult } from "./write";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * hqApiGate admits a platform owner, who holds no appointment. The 890 design gives the owner NO database
 * short-circuit (appointments are required), so a Studio write also needs the capability to be HELD through a
 * live appointment. Returns a refusal response, or null.
 */
export function mustHold(ctx: HqContext, capability: string): NextResponse | null {
  return ctx.capabilities.includes(capability)
    ? null
    : refuse(403, "This step needs a Checklist Studio appointment that holds the right capability. A platform owner without that appointment can look but not change.");
}

export function kindOf(v: unknown): DefinitionKind | null {
  return DEFINITION_KINDS.includes(v as DefinitionKind) ? (v as DefinitionKind) : null;
}

export function respond<T extends object>(r: WriteResult<T>, extra: Record<string, unknown> = {}) {
  if (r.ok) return NextResponse.json({ ...r, ...extra });
  return refuse(r.status, r.error);
}
