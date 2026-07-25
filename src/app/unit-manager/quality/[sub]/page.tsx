import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Every Quality & Safety sub-module (UMG-QS-002..011) now has its own real page as a static segment, which
// takes precedence over this dynamic route. This catch-all only receives unknown/typo paths — redirect them
// to the Quality & Safety Command Centre.
export default async function QualitySubRedirect({ params }: { params: Promise<{ sub: string }> }) {
  await params;
  redirect("/unit-manager/quality");
}
