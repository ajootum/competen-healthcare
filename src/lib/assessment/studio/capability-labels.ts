// Checklist Studio: plain names for the capabilities a Studio step can need, for the refusal message. Pure.
import { CAP } from "./transitions";

const LABEL: Record<string, string> = {
  [CAP.view]: "the right to view Checklist Studio",
  [CAP.author]: "the right to author checklists",
  [CAP.review]: "the right to review checklists",
  [CAP.publish]: "the right to publish checklists",
  [CAP.assign]: "the right to assign assessors",
  [CAP.assess]: "the right to assess with a checklist",
  [CAP.domainReview]: "the right to give domain review",
};

/** The label of a capability, or the capability code itself when it is not one the Studio knows. */
export function capabilityLabel(capability: string): string {
  return LABEL[capability] ?? `the capability ${capability}`;
}
