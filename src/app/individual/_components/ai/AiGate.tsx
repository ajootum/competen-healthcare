"use client";

import { useId } from "react";
import type { ExperienceKey } from "@/lib/individual/experiences";
import { useAiAvailability } from "./AiAvailabilityContext";
import { AiUnavailableNote } from "./AiAvailability";

// HFE-01 Wave 1 (D3): wrap an AI action. While the activity is not available, the action is disabled and
// described by the shared reason shown beneath it. The route behind the action still refuses on its own.
export function AiGate({ activity, experience, children }: {
  activity: string; experience: ExperienceKey;
  children: (g: { off: boolean; describedBy: string | undefined }) => React.ReactNode;
}) {
  const id = `ai-why-${useId().replace(/:/g, "")}`;
  const a = useAiAvailability(activity);
  const off = !!a && !a.available;
  return (
    <>
      {children({ off, describedBy: off ? id : undefined })}
      {a && !a.available && <AiUnavailableNote id={id} reason={a.reason} experience={experience} className="mt-2" />}
    </>
  );
}
