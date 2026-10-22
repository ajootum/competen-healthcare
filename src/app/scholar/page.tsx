import ExperiencePage from "@/components/marketing/ExperiencePage";
import { SCHOLAR } from "@/lib/marketing/individual-family";
import { pageMetadata } from "@/lib/marketing/site";

// COMPETEN-WEB-IND-001 -- the canonical public home of Competen Scholar (owner decision, review GO:
// "/scholar and /professional canonical"). The Students AUDIENCE pathway lands here, the way the
// Practitioners pathway lands on /practice. /students, the old indexed route, permanently redirects here.
//
// pageMetadata, not a bare title/description -- see src/lib/marketing/site.ts for why.
export const metadata = pageMetadata({
  title: `${SCHOLAR.name} — ${SCHOLAR.headline.join(" ")}`,
  description: SCHOLAR.body,
  path: SCHOLAR.href,
  imageAlt: SCHOLAR.imageAlt,
});

export default function Page() { return <ExperiencePage e={SCHOLAR} />; }
