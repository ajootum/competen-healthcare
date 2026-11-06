import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolveLifeosShell } from "@/lib/lifeos/adapters/competen/guard";
import { ActivateAccess } from "@/lib/lifeos/ui/ActivateAccess";
import { LifeosApp } from "@/lib/lifeos/ui/LifeosApp";
import { isScreen } from "@/lib/lifeos/ui/nav";

// LIFEOS-API-001 step 5. The LifeOS interface. The gate is checked on the server first: off, this page does not exist.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "LifeOS" }, robots: { index: false, follow: false } };

export default async function LifeosPage({ params }: { params: Promise<{ screen?: string[] }> }) {
  const { screen } = await params;
  const name = screen?.[0];
  if ((screen?.length ?? 0) > 1 || (name !== undefined && !isScreen(name))) notFound();

  const shell = await resolveLifeosShell();
  if (shell === "DISABLED") notFound();
  if (shell === "AUTH_REQUIRED") redirect(`/login?next=${encodeURIComponent(name ? `/lifeos/${name}` : "/lifeos")}`);
  if (shell === "NO_ACCESS") return <ActivateAccess />;
  return <LifeosApp initialScreen={isScreen(name) ? name : "calendar"} />;
}
