import { redirect } from "next/navigation";
import { connection } from "next/server";
import ProductComingSoon from "@/components/marketing/ProductComingSoon";
import { pageMetadata } from "@/lib/marketing/site";
import { createClient, createAdminClientOrNull } from "@/lib/supabase/server";
import { individualAppEnabled } from "@/lib/individual/gate";
import { entryDestination, requestedExperience, signInHref } from "@/lib/individual/entry";

// Competen Individual's own entry screen -- the owner's request, 2026-08-11: the Student and
// Professional gates lead HERE, product-branded like /practice/sign-in, not to the generic /login with
// a notice. Both audience pathways (Scholar, Professional) gate into this ONE door, by the owner's mapping.
//
// ⚠ TWO STATES, DECIDED BY THE RELEASE GATE ON THE SERVER -- COMPETEN-IND-ACCESS-001 s3 and s5.
//
//   OFF (the default; an absent, failed or unreadable flag, or no service key): the coming-soon screen,
//   byte-for-byte what this door rendered before. No password field, nothing that suggests the product
//   can be entered. Implementing routing does not open Individual.
//
//   ON: the door becomes a thin funnel into the ONE Competen sign-in, the way /enterprise/sign-in is --
//   /login?next=/individual/scholar (or /professional, or /individual/home with no experience named).
//   A person already signed in skips the form and goes straight to the destination. Either way the
//   destination re-checks gate 3 on arrival; this page grants nothing and holds no credential field.
//
// ⚠ ?experience= IS A DESTINATION, NOT A CLAIM. It picks one of three fixed paths (entry.ts) and is never
// echoed into a redirect.

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Competen Individual — coming soon",
  description: "Your professional record, learning and competency passport. We are building this site now.",
  path: "/individual/sign-in",
});

export default async function IndividualSignInPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection(); // request time only -- see src/lib/individual/guard.ts
  // OrNull: a missing service key is OFF, never a throwing constructor (500).
  const admin = createAdminClientOrNull();
  if (admin && (await individualAppEnabled(admin))) {
    const experience = requestedExperience((await searchParams).experience);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    redirect(user ? entryDestination(experience) : signInHref(experience));
  }

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
