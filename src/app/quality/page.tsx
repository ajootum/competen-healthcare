import SolutionPage from "@/components/marketing/SolutionPage";
import { bySlug } from "@/lib/marketing/solutions";

// WEB-STRAT-001 public landing page. Content is data; the layout is the shared SolutionPage template.
const s = bySlug("quality")!;

export const metadata = {
  title: `${s.headline.join(" ")} — Competen`,
  description: s.body,
};

export default function Page() { return <SolutionPage s={s} />; }
