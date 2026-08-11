import SolutionPage from "@/components/marketing/SolutionPage";
import { PRODUCT_PAGES } from "@/lib/marketing/products";
import { pageMetadata } from "@/lib/marketing/site";

// The Competen Recruitment PRODUCT page -- WEB-HOME-001 s10, adopted 2026-08-11 with the owner's
// condition: ⚠ A MARKETING PAGE ONLY, WITH NO SIGN-IN. See /individual/page.tsx -- same decision, same
// reason, same path to becoming real.
const s = PRODUCT_PAGES.recruitment;

export const metadata = pageMetadata({
  title: `Competen Recruitment — ${s.body}`,
  description: s.body,
  path: "/recruitment",
  imageAlt: s.template.imageAlt,
});

export default function Page() { return <SolutionPage s={s} />; }
