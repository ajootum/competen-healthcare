import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// COMP-ENT-UX-001 s7: unauthorised routes fail CLOSED and land somewhere that says what to do next.
//
// ⚠ WHY THIS EXISTS. The outer /enterprise layout stopped rendering its own gate for AUTH_REQUIRED
// (the gateway spec moved that state into the children), and this page's own gate contributes null
// for every non-READY state -- which for a signed-out visitor would have rendered a BLANK 200, the
// exact dead-end shape the walkthroughs keep finding. A signed-out visitor here goes to the public
// gateway at /enterprise, whose dominant action is the sign-in door.
//
// ⚠ ONLY the signed-out state is answered here. NO_TENANT and REFUSED stay with the outer layout's
// honest sentences, and READY stays with the page -- this file adds a floor, it moves no gate.
// Redirecting to /enterprise is not the recorded loop (page.tsx's lesson): that loop was /enterprise
// redirecting to ITSELF for non-members; from a child path, /enterprise renders the gateway.

export const dynamic = "force-dynamic";

export default async function EnterpriseWorkforceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/enterprise");
  return <>{children}</>;
}
