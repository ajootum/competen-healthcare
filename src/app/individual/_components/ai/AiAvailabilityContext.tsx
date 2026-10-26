"use client";

import { createContext, useContext } from "react";
import { availabilityFromStanding, type AiAvailability } from "@/lib/individual/ai-availability";
import type { AiStanding } from "@/lib/ai/allowance";

// HFE-01 Wave 1 (D3, owner Option A): AI actions are shown disabled, with the reason, when AI is not available.
// The experience layout reads the engine's standing once (getAiStanding) and hands this slim copy down, so any AI
// action asks useAiAvailability(activity) instead of threading props. A presentation hint only: every route
// still runs its own gate and refuses on its own.

export type SlimStanding = Pick<AiStanding, "readable" | "policyPublished" | "activities" | "message">;

const Ctx = createContext<SlimStanding | null>(null);

export function AiAvailabilityProvider({ standing, children }: { standing: SlimStanding | null; children: React.ReactNode }) {
  return <Ctx.Provider value={standing}>{children}</Ctx.Provider>;
}

/** Availability of one activity, or null outside a provider (then the action stays enabled and the server decides). */
export function useAiAvailability(activity: string): AiAvailability | null {
  const s = useContext(Ctx);
  if (!s) return null;
  return availabilityFromStanding({ metered: false, level: "full", remaining: { band: "plenty", percent: null }, resetsAt: null, ...s } as AiStanding, activity);
}
