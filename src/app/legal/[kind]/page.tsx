import { notFound } from "next/navigation";
import type { Metadata } from "next";
import LegalDocumentPage from "@/components/legal/LegalDocumentPage";
import { CURRENT_LEGAL_VERSION, LEGAL_KIND_LABEL, isLegalKind } from "@/lib/legal/interim";

// /legal/terms and /legal/privacy: the CURRENT version (COMPETEN-LEGAL-001 s4).
export function generateStaticParams() { return [{ kind: "terms" }, { kind: "privacy" }]; }
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  return { title: isLegalKind(kind) ? LEGAL_KIND_LABEL[kind] : "Legal", robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isLegalKind(kind)) notFound();
  return <LegalDocumentPage kind={kind} v={CURRENT_LEGAL_VERSION} permanent={false} />;
}
