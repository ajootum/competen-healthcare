import { notFound } from "next/navigation";
import { experiencePage } from "../shell-context";

// The Professional module pages' own check, on top of the foundation's (COMPETEN-IND-007).
//
// experiencePage() answers "is this experience live and its terms accepted" and returns null when the
// experience layout is rendering a governed state instead. A Professional module additionally exists
// ONLY in Competen Professional: /individual/scholar/cpd is not a page, so it is a 404 rather than a
// Scholar screen showing Professional data (ADR-016 decision 6 mounts shared modules in every
// experience -- these are not shared modules).
export async function professionalPage(param: string) {
  const page = await experiencePage(param);
  if (!page) return null;
  if (page.experience !== "professional") notFound();
  return page;
}
