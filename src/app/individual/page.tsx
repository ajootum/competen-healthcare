import SolutionPage from "@/components/marketing/SolutionPage";
import { PRODUCT_PAGES } from "@/lib/marketing/products";
import { pageMetadata } from "@/lib/marketing/site";

// The Competen Individual PRODUCT page -- WEB-HOME-001 s10, adopted 2026-08-11 with the owner's
// condition: ⚠ A MARKETING PAGE ONLY, WITH NO SIGN-IN. The product does not exist yet (no code, no data
// model), so a sign-in button here would be a door to nowhere and the CTA is a conversation instead.
// When the product ships, this page gains its gate and the `live` flag in products.ts flips.
const s = PRODUCT_PAGES.individual;

export const metadata = pageMetadata({
  title: `Competen Individual — ${s.body}`,
  description: s.body,
  path: "/individual",
  imageAlt: s.template.imageAlt,
});

export default function Page() { return <SolutionPage s={s} />; }
