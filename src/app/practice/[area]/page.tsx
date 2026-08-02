import { notFound } from "next/navigation";
import PracticeAreaPage from "@/components/marketing/PracticeAreaPage";
import { PRACTICE_AREAS, areaBySlug } from "@/lib/marketing/practice-content";
import { pageMetadata } from "@/lib/marketing/site";

// The six Competen Practice capability pages, generated from PRACTICE_AREAS.
//
// A dynamic route rather than six folders, because the catalogue is what the section navigation, the
// /practice cards and the sibling links are all built from. Six hand-written folders would let the two
// drift -- a page with no way in, or a card pointing at a 404 -- and nothing would notice until a visitor
// did. Here an entry in the catalogue IS the page.

export function generateStaticParams() {
  return PRACTICE_AREAS.map(a => ({ area: a.slug }));
}

// Anything not in the catalogue is a 404, not a blank page rendered from undefined.
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }) {
  const a = areaBySlug((await params).area);
  if (!a) return {};
  return pageMetadata({
    title: `${a.nav} — Competen Practice`,
    description: a.body,
    path: `/practice/${a.slug}`,
    image: "/images/og/practice.jpg",
    imageAlt: a.screens[0].alt,
  });
}

export default async function Page({ params }: { params: Promise<{ area: string }> }) {
  const a = areaBySlug((await params).area);
  if (!a) notFound();
  return <PracticeAreaPage a={a} />;
}
