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

// Anything not in the catalogue is a 404, not a blank page rendered from undefined. The body's own
// `notFound()` is the load-bearing guard; this makes it a build-time fact as well as a runtime one.
export const dynamicParams = false;

// PER-REQUEST, for the same reason /practice and /practice/login are: the header's journey buttons are
// resolved against the launch flags, and a flag baked in at build time is a constant with extra steps --
// flipping the ladder would need a deploy, and until then a button would point at the wrong door.
//
// It also removes the build-time PRERENDER that made these pages dangerous to the app: every slug used to
// be written to a static file, so a slug matching an authenticated route (`/practice/setup`) was served
// as marketing in production while dev served the real page. The slug is renamed and assertion 7a guards
// it, but a route that no longer prerenders cannot shadow anything in the first place.
export const dynamic = "force-dynamic";

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
