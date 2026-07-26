import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Every Quality & Accreditation module now has a dedicated route (QAW-001..014). This catch-all only
// handles unknown/legacy paths (e.g. an old bookmark to /settings) → send them back to the dashboard.
export default async function QualitySectionFallback({ params }: { params: Promise<{ section: string }> }) {
  await params;
  redirect("/quality-accreditation");
}
