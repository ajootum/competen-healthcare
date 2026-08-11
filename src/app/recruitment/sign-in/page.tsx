import ProductComingSoon from "@/components/marketing/ProductComingSoon";
import { pageMetadata } from "@/lib/marketing/site";

// Competen Recruitment's own entry screen -- see /individual/sign-in: same owner request, same shape,
// its own brand. ⚠ No password field; the page is honest that the product is being built.

export const metadata = pageMetadata({
  title: "Competen Recruitment — coming soon",
  description: "Opportunities, applications, interviews and offers on verified ground. We are building this site now.",
  path: "/recruitment/sign-in",
});

export default function RecruitmentSignInPage() {
  return (
    <ProductComingSoon p={{
      wordmark: "recruitment",
      name: "Competen Recruitment",
      accent: "#7C3AED",
      headline: "We are building this site.",
      body: "Competen Recruitment — opportunities, applications, interviews and offers on verified ground — is on its way. Here is what it will do:",
      points: [
        "Opportunities matched to verified capability",
        "Applications, interviews and offers in one place",
        "Built for healthcare recruitment",
      ],
      enquirySubject: "Competen Recruitment enquiry",
    }} />
  );
}
