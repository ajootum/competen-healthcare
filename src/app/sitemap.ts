import type { MetadataRoute } from "next";
import { abs, indexablePages } from "@/lib/marketing/site";

// The sitemap, generated from the same catalogues as the routes (see src/lib/marketing/site.ts).
//
// No lastModified. Next would let us stamp one, but the honest value is "when did this page's content
// last change", and nothing here tracks that -- so it would either be the build time, which tells a
// crawler every page changed on every deploy and trains it to ignore the field, or a hardcoded date that
// rots. An absent lastModified is treated as unknown, which is exactly what it is.

export default function sitemap(): MetadataRoute.Sitemap {
  return indexablePages().map(p => ({
    url: abs(p.path),
    priority: p.priority,
    changeFrequency: p.changeFrequency,
  }));
}
