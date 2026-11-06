import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { lifeosStore, readSignedInEmail, resolveHostSite, resolveLifeosShell } from "@/lib/lifeos/adapters/competen/guard";
import { previewInvitation } from "@/lib/lifeos/core/invitations";
import { Invite } from "@/lib/lifeos/ui/Invite";
import { ActivateAccess } from "@/lib/lifeos/ui/ActivateAccess";
import { LifeosApp } from "@/lib/lifeos/ui/LifeosApp";
import { SignIn } from "@/lib/lifeos/ui/SignIn";
import { isScreen } from "@/lib/lifeos/ui/nav";

// LIFEOS-API-001 step 5. The LifeOS interface. The gate is checked on the server first: off, this page does not exist.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "LifeOS" }, robots: { index: false, follow: false } };

export default async function LifeosPage({ params }: { params: Promise<{ screen?: string[] }> }) {
  const { screen } = await params;
  const name = screen?.[0];
  const inviteToken = screen?.length === 2 && name === "invite" ? screen[1] : null;
  if (!inviteToken && ((screen?.length ?? 0) > 1 || (name !== undefined && !isScreen(name)))) notFound();

  const host = await resolveHostSite();
  if (host.kind === "none") notFound();
  const site = host.kind === "tenant" ? host.site : null;

  const shell = await resolveLifeosShell();
  if (shell === "DISABLED") notFound();
  if (inviteToken) {
    const store = lifeosStore();
    const invite = store ? await previewInvitation(store, inviteToken).catch(() => null) : null;
    if (!invite) notFound();
    return <Invite token={inviteToken} {...invite} signedInEmail={await readSignedInEmail()} branding={site?.branding ?? {}} />;
  }
  // On a tenant's domain the person signs in under its name, and never leaves it.
  if (shell === "AUTH_REQUIRED" && site) return <SignIn branding={site.branding} name={site.name} />;
  if (shell === "AUTH_REQUIRED") redirect(`/login?next=${encodeURIComponent(name ? `/lifeos/${name}` : "/lifeos")}`);
  if (shell === "NO_ACCESS") return <ActivateAccess />;
  return <LifeosApp initialScreen={isScreen(name) ? name : "calendar"} branding={site?.branding ?? {}} tenantId={site?.tenantId ?? null} tenantName={site?.name ?? null} />;
}
