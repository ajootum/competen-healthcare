import ProductComingSoon from "@/components/marketing/ProductComingSoon";
import { pageMetadata } from "@/lib/marketing/site";

// Competen Individual's own entry screen -- the owner's request, 2026-08-11: the Student and
// Professional gates lead HERE, product-branded like /practice/sign-in, not to the generic /login with
// a notice. ⚠ No password field: the product is not built, and the page says so before anything else.
// Both audience pathways (Students, Professionals) gate into this ONE site, by the owner's mapping.

export const metadata = pageMetadata({
  title: "Competen Individual — coming soon",
  description: "Your professional record, learning and competency passport. We are building this site now.",
  path: "/individual/sign-in",
});

export default function IndividualSignInPage() {
  return (
    <ProductComingSoon p={{
      wordmark: "individual",
      name: "Competen Individual",
      accent: "#0F766E",
      headline: "We are building this site.",
      body: "Competen Individual — your professional record, learning and competency passport — is on its way. Here is what it will hold for you:",
      points: [
        "Your competency passport, verified",
        "Learning and development in one place",
        "Credentials and achievements that travel with you",
      ],
      enquirySubject: "Competen Individual enquiry",
    }} />
  );
}
