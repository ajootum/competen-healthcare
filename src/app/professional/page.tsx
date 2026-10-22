import ExperiencePage from "@/components/marketing/ExperiencePage";
import { PROFESSIONAL } from "@/lib/marketing/individual-family";
import { pageMetadata } from "@/lib/marketing/site";

// COMPETEN-WEB-IND-001 -- the canonical public home of Competen Professional. The Professionals AUDIENCE
// pathway lands here. /professionals, the old indexed route, permanently redirects here.
export const metadata = pageMetadata({
  title: `${PROFESSIONAL.name} — ${PROFESSIONAL.headline.join(" ")}`,
  description: PROFESSIONAL.body,
  path: PROFESSIONAL.href,
  imageAlt: PROFESSIONAL.imageAlt,
});

export default function Page() { return <ExperiencePage e={PROFESSIONAL} />; }
