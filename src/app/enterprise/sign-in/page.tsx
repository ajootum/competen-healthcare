import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// /enterprise/sign-in -- the Enterprise door at the spec's named path (COMP-ACCESS-ARCH-001 s13),
// a THIN WRAPPER that funnels to the one identity.
//
// ⚠ NO CREDENTIAL FIELD OF ITS OWN, AND NO RENDERED BODY EITHER -- here is why both are right.
// Enterprise has no separate authentication system and must not grow one here (IMP s1: compose, do
// not rebuild). And this route sits inside src/app/enterprise/, whose layout renders its OWN
// branded gate page INSTEAD of children for every non-READY state -- so any body written here would
// be unreachable content, a page pretending to render.
//
// ⚠ WHAT A VISITOR ACTUALLY SEES, MEASURED LIVE (GET /enterprise/sign-in -> 200), not assumed:
//
//   unauthenticated -> the layout's Enterprise gate page renders AT THIS PATH, whose "Sign in" CTA
//                      is /login?next=/enterprise -- the door IS the branded funnel to the one
//                      identity. The redirect below never reaches the browser in this state: the
//                      layout's output is complete without children, so the page's thrown redirect
//                      is not flushed. (This differs from the /enterprise page's recorded lesson,
//                      where a thrown redirect DID beat the layout -- measured here, both kept.)
//   no tenant / refused -> the layout's honest sentence, same as everywhere under /enterprise.
//   authenticated member (READY) -> children render, so the redirect below fires and the person
//                      lands on the shell at its canonical path rather than a duplicate of it.
//
// This path exists so the spec's named entry (ARCH s13, ".../enterprise/sign-in") resolves, and so
// the day subdomains arrive the mapping target is already real.

export const dynamic = "force-dynamic";

export default async function EnterpriseSignInPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? "/enterprise" : "/login?next=/enterprise");
}
