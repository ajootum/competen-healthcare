import SolutionPage from "@/components/marketing/SolutionPage";
import { templated } from "@/lib/marketing/solutions";
import { pageMetadata } from "@/lib/marketing/site";

// The organisation pathway -- WEB-HOME-001 s20's "Hospitals is replaced by the broader organisation
// pathway", adopted 2026-08-11. /hospitals permanently redirects here; see that file for why it must.
const s = templated("organisations");

export const metadata = pageMetadata({
  title: `${s.template.headline.join(" ")} — Competen`,
  description: s.body,
  path: "/organisations",
  imageAlt: s.template.imageAlt,
});

export default function Page() { return <SolutionPage s={s} />; }
