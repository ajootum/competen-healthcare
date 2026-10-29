import { connection } from "next/server";
import ScholarLanding from "@/components/marketing/ScholarLanding";
import { SCHOLAR } from "@/lib/marketing/individual-family";
import { pageMetadata } from "@/lib/marketing/site";
import { selfRegistrationEnabled } from "@/lib/individual/join";
import { createAdminClientOrNull } from "@/lib/supabase/server";

// COMPETEN-WEB-IND-001 -- the canonical public home of Competen Scholar (owner decision, review GO:
// "/scholar and /professional canonical"). The Students AUDIENCE pathway lands here, the way the
// Practitioners pathway lands on /practice. /students, the old indexed route, permanently redirects here.
// SCHOLAR-WEB-REDESIGN-01 (29 Oct 2026): a benefits landing page (ScholarLanding), no product demonstration.
//
// pageMetadata, not a bare title/description -- see src/lib/marketing/site.ts for why.
export const metadata = pageMetadata({
  title: `${SCHOLAR.name} — ${SCHOLAR.headline.join(" ")}`,
  description: SCHOLAR.body,
  path: SCHOLAR.href,
  image: "/images/og/scholar.jpg",
  imageAlt: SCHOLAR.imageAlt,
});

// ⚠ FORCE-DYNAMIC for the same reason as /practice: Get Started follows a launch flag, and a flag read at
// build time is baked into the page, not a flag. No client (no service key) or a failed read is CLOSED --
// selfRegistrationEnabled never throws -- so the page then offers the invitation route, never a sign-up.
export const dynamic = "force-dynamic";

export default async function Page() {
  await connection();
  const joinOpen = await selfRegistrationEnabled(createAdminClientOrNull());
  return <ScholarLanding joinOpen={joinOpen} />;
}
