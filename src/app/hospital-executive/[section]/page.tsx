import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Every Hospital Executive module now has a dedicated route (HEX-001..012). This catch-all only handles
// unknown/legacy paths (e.g. an old bookmark to /settings or /scorecard) → send them to the dashboard.
export default async function ExecutiveSectionFallback({ params }: { params: Promise<{ section: string }> }) {
  await params;
  redirect("/hospital-executive");
}
