import { createAdminClientOrNull } from "@/lib/supabase/server";
import { platformFlag } from "@/lib/practice/provisioning";
import { JOURNEYS, JOURNEY_GATES, type PracticeJourney } from "./practice-site";

// WHERE A JOURNEY BUTTON POINTS ONCE ITS JOURNEY IS OPEN.
//
// JOURNEY_GATES already decided that flipping a flag replaces the "not open yet" PANEL with a live action.
// It never reached the BUTTONS, so with practice_sign_in on, the header's "Practice Login" still went to
// the explainer at /practice/login and the visitor had to find the "Sign in" link on it and click again.
// Two clicks to reach a form that was open the whole time, and the second click is the one nobody expects
// -- a person who clicks "Practice Login" has already said what they want.
//
// So the gate resolves the HREF as well as the panel, in one place, from the same flag. The explainer page
// stays exactly where it is: it is still linked from the journey cards, and it is still what someone
// reading about the product wants. What changes is that a button labelled sign-in performs a sign-in.
//
// A journey with no gate is returned untouched and reads no flag -- `book` and `patient-login` have no
// destination to be routed to, and a flag wired to nothing is worse than no flag.
export async function resolvedJourneys(): Promise<PracticeJourney[]> {
  const gated = JOURNEYS.filter(j => JOURNEY_GATES[j.key]);
  if (gated.length === 0) return JOURNEYS;

  const admin = createAdminClientOrNull();
  const flags = [...new Set(gated.map(j => JOURNEY_GATES[j.key].flag))];
  // platformFlag logs and returns false on a read failure, so a database problem closes the buttons back
  // to the explainer rather than taking the marketing page down. Closed is the safe direction: the
  // explainer works whatever the flag says, and /practice/sign-in refuses on its own anyway.
  const open = new Map(await Promise.all(flags.map(async f => [f, await platformFlag(admin, f)] as const)));

  return JOURNEYS.map(j => {
    const gate = JOURNEY_GATES[j.key];
    return gate && open.get(gate.flag) ? { ...j, href: gate.action.href } : j;
  });
}
