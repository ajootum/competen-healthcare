import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Every Learning & Development sub-module (Mandatory, Professional Development, Career Pathways, Education
// Planning, Learning Analytics, Assign Learning) now has its own real page as a static segment, which takes
// precedence over this dynamic route. This catch-all only receives unknown/typo paths — redirect them to the
// Learning Dashboard.
export default async function LearningSubRedirect({ params }: { params: Promise<{ sub: string }> }) {
  await params;
  redirect("/unit-manager/learning");
}
