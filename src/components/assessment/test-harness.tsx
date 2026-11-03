// Test support only (not exported from the folder index): a host that owns the responses, as a real page does.
import { useState } from "react";
import { AssessmentRunner, type AssessmentRunnerProps } from "./AssessmentRunner";
import type { Responses } from "@/lib/assessment/core";

export function Host({ initial, onResponses, ...rest }: Omit<AssessmentRunnerProps, "responses" | "onChange"> & { initial?: Responses; onResponses?: (r: Responses) => void }) {
  const [responses, setResponses] = useState<Responses>(initial ?? {});
  return <AssessmentRunner {...rest} responses={responses} onChange={(next) => { setResponses(next); onResponses?.(next); }} />;
}
