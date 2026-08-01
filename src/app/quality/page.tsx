import SolutionPage from "@/components/marketing/SolutionPage";
import { templated } from "@/lib/marketing/solutions";

// WEB-STRAT-001 public landing page. Content is data; the layout is the shared SolutionPage template.
const s = templated("quality");

export const metadata = {
  title: `${s.template.headline.join(" ")} — Competen`,
  description: s.body,
};

export default function Page() { return <SolutionPage s={s} />; }
