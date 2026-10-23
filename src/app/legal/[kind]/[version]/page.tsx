import { notFound } from "next/navigation";
import type { Metadata } from "next";
import LegalDocumentPage from "@/components/legal/LegalDocumentPage";
import { LEGAL_KIND_LABEL, LEGAL_VERSIONS, isLegalKind, legalVersion } from "@/lib/legal/interim";

// /legal/<kind>/<version>: one version, permanently -- the URL stored with an acceptance (COMPETEN-LEGAL-001 s4).
export function generateStaticParams() {
  return LEGAL_VERSIONS.flatMap(v => [{ kind: "terms", version: v.version }, { kind: "privacy", version: v.version }]);
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ kind: string; version: string }> }): Promise<Metadata> {
  const { kind, version } = await params;
  return { title: isLegalKind(kind) ? `${LEGAL_KIND_LABEL[kind]} ${version}` : "Legal", robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ kind: string; version: string }> }) {
  const { kind, version } = await params;
  const v = legalVersion(version);
  if (!isLegalKind(kind) || !v) notFound();
  return <LegalDocumentPage kind={kind} v={v} permanent />;
}
