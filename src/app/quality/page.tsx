import SolutionPage from "@/components/marketing/SolutionPage";
import { templated } from "@/lib/marketing/solutions";
import { pageMetadata } from "@/lib/marketing/site";

// WEB-STRAT-001 public landing page. Content is data; the layout is the shared SolutionPage template.
const s = templated("quality");

// pageMetadata, not a bare title/description: a page that sets only those keeps the ROOT layout's
// og:title and og:description, so it reads correctly in a search result and unfurls in a chat app as the
// generic site card. See src/lib/marketing/site.ts.
export const metadata = pageMetadata({
  title: `${s.template.headline.join(" ")} — Competen`,
  description: s.body,
  path: "/quality",
  imageAlt: s.template.imageAlt,
});

export default function Page() { return <SolutionPage s={s} />; }
